/**
 * Check a one-time code and apply what it authorises.
 *
 * The check and the effect are in one place on purpose. A "verify" endpoint
 * that only answers yes/no leaves the actual privileged step — marking a number
 * verified, changing a password — to a second call the client makes, and a
 * client that can make that second call directly does not need the first one.
 * So each purpose does its own work here, under the service role, and the
 * client is only ever told that it worked.
 *
 * ORDER OF OPERATIONS, and why it is this way:
 *
 *   1. find the newest live code for (purpose, phone)
 *   2. bump the attempt counter FIRST — a client that hangs up mid-request must
 *      not get a free guess
 *   3. compare in constant time
 *   4. mark consumed, THEN apply the effect
 *
 * Consuming before applying means a code can never be spent twice, even if two
 * requests arrive together: the second finds nothing live. The cost is that a
 * failure in step 4 burns the code — the merchant asks for another. That is the
 * right way round; the alternative is a replayable code.
 */

import { corsHeaders, adminClient, json } from "./runtime.mjs";
import { toIndianMobile, mask } from "./whatsapp.mjs";
import {
  PURPOSES,
  authSettings,
  callerUserId,
  hashCode,
  hashesMatch,
  markPhoneVerified,
  markTwoFactorPassed,
} from "./otpCore.mjs";

/**
 * Mint a session for a user who has just proven they hold the number.
 *
 * GoTrue's admin `generate_link` produces a single-use magic-link token WITHOUT
 * sending any email. The `hashed_token` goes back to the client, which redeems
 * it through the ordinary `verifyOtp({ token_hash, type: "magiclink" })` call —
 * so the session is issued by GoTrue itself, with its own expiry and refresh
 * handling, and this function never has to mint or sign anything.
 *
 * It is only ever reached AFTER the WhatsApp code has been checked. A token
 * handed out any earlier would be a password.
 */
async function mintLoginToken(db, userId) {
  const { data: userData, error: userError } = await db.auth.admin.getUserById(userId);
  if (userError || !userData?.user?.email) {
    console.error("[otp] cannot mint a session, no email on the account:", userError?.message);
    return null;
  }

  const { data, error } = await db.auth.admin.generateLink({
    type: "magiclink",
    email: userData.user.email,
  });
  if (error) {
    console.error("[otp] generateLink failed:", error.message);
    return null;
  }

  // supabase-js nests it under `properties`; the raw REST shape has it at the
  // top level. Accept both so a client-library bump cannot silently break login.
  return data?.properties?.hashed_token ?? data?.hashed_token ?? null;
}

const NEEDS_SESSION = new Set(["register", "login", "change_number"]);

/** Deliberately identical for every rejection except a spent attempt budget. */
const WRONG_CODE = "That code is not right. Check the message and try again.";

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const purpose = String(body.purpose ?? "").trim();
    const code = String(body.code ?? "").replace(/\D/g, "");

    if (!PURPOSES.includes(purpose)) {
      return json({ error: `purpose must be one of: ${PURPOSES.join(", ")}` }, 400);
    }

    const phone = toIndianMobile(body.phone);
    if (!phone) return json({ error: "Enter a 10-digit Indian mobile number." }, 400);
    if (!code) return json({ error: "Enter the code from your WhatsApp message." }, 400);

    const settings = await authSettings();
    const db = adminClient();

    let callerId = null;
    if (NEEDS_SESSION.has(purpose)) {
      callerId = await callerUserId(req);
      if (!callerId) return json({ error: "You need to be signed in for that." }, 401);
    }

    // ------------------------------------------------------- find the live code
    const { data: rows, error: readError } = await db
      .from("auth_otps")
      .select("id, user_id, code_hash, attempts, expires_at, email")
      .eq("purpose", purpose)
      .eq("phone", phone)
      .is("consumed_at", null)
      .order("created_at", { ascending: false })
      .limit(1);

    if (readError) {
      console.error("[otp] verify read failed:", readError.message);
      return json({ error: "Could not check that code just now. Please try again." }, 500);
    }

    const otp = rows?.[0];
    if (!otp) {
      return json({ error: "That code has expired or was already used. Ask for a new one." }, 400);
    }

    if (new Date(otp.expires_at).getTime() < Date.now()) {
      await db.from("auth_otps").update({ consumed_at: new Date().toISOString() }).eq("id", otp.id);
      return json({ error: "That code has expired. Ask for a new one." }, 400);
    }

    // A code issued to one account must not be usable by another session, even
    // with the right digits — otherwise a signed-in attacker who can read a
    // victim's message completes the victim's step inside their own account.
    if (NEEDS_SESSION.has(purpose) && otp.user_id && otp.user_id !== callerId) {
      console.warn(`[otp] ${purpose} code for ${mask(phone)} presented by a different session`);
      return json({ error: WRONG_CODE }, 400);
    }

    // ------------------------------------------------- spend an attempt, then check
    const attempts = (otp.attempts ?? 0) + 1;
    await db.from("auth_otps").update({ attempts }).eq("id", otp.id);

    if (attempts > settings.otpMaxAttempts) {
      await db.from("auth_otps").update({ consumed_at: new Date().toISOString() }).eq("id", otp.id);
      return json(
        { error: "Too many wrong tries. Ask for a new code.", reason: "attempts_exhausted" },
        429,
      );
    }

    if (!hashesMatch(otp.code_hash, hashCode(code))) {
      const left = settings.otpMaxAttempts - attempts;
      return json(
        {
          error: left > 0 ? `${WRONG_CODE} ${left} ${left === 1 ? "try" : "tries"} left.` : WRONG_CODE,
          reason: "mismatch",
          attemptsLeft: Math.max(0, left),
        },
        400,
      );
    }

    // ------------------------------------------------------------- spend the code
    await db.from("auth_otps").update({ consumed_at: new Date().toISOString() }).eq("id", otp.id);

    // ------------------------------------------------------------- apply the effect
    switch (purpose) {
      case "register":
      case "change_number": {
        try {
          await markPhoneVerified(db, callerId, phone);
        } catch (err) {
          // 23505 on user_security_phone_verified_idx: somebody else verified
          // this number in the seconds between the code being sent and typed.
          // send-otp checks for that up front, so this is the narrow race — but
          // it must read as "that number is taken", not as a 500.
          if (String(err?.code) === "23505") {
            return json(
              {
                error:
                  "That WhatsApp number has just been verified on another CatalogShare account. Use a different number.",
                reason: "number_taken",
              },
              409,
            );
          }
          throw err;
        }
        // Keep the company row in step when there is one. At `register` time
        // there usually is not — the company is created in step 2, from the
        // same number — so a missing row is a normal outcome, not an error.
        const { error: companyError } = await db
          .from("companies")
          .update({ phone: `+91${phone}` })
          .eq("owner_id", callerId);
        if (companyError) {
          console.warn("[otp] company phone not updated:", companyError.message);
        }
        console.log(`[otp] ${mask(phone)} verified for ${callerId}`);
        return json({ success: true, phoneVerified: true }, 200);
      }

      case "login": {
        await markTwoFactorPassed(db, callerId);
        return json({ success: true, twoFactorPassed: true }, 200);
      }

      case "phone_login": {
        if (!otp.user_id) {
          return json({ error: "That code is no longer valid. Ask for a new one." }, 400);
        }

        // The number is proven now, so record it. This is what turns the
        // existing merchant base's unverified numbers into verified ones —
        // they verify by using them, once.
        try {
          await markPhoneVerified(db, otp.user_id, phone);
        } catch (err) {
          if (String(err?.code) === "23505") {
            return json(
              {
                error:
                  "That number has just been verified on another account. Sign in with your email instead.",
                reason: "number_taken",
              },
              409,
            );
          }
          throw err;
        }

        const tokenHash = await mintLoginToken(db, otp.user_id);
        if (!tokenHash) {
          return json(
            {
              error:
                "Your number is confirmed, but we could not finish signing you in. Try your email and password.",
              reason: "session_failed",
            },
            500,
          );
        }

        console.log(`[otp] phone_login succeeded for ${mask(phone)}`);
        return json({ success: true, tokenHash, phoneVerified: true }, 200);
      }

      case "reset": {
        // Six, matching MIN_PASSWORD_LENGTH in Register.tsx and
        // ForgotPassword.tsx. A stricter rule here than the form enforces means
        // the merchant is refused AFTER their code has been spent, which reads
        // as "the code was wrong" and is the worst possible way to be told.
        const newPassword = String(body.newPassword ?? "");
        if (newPassword.length < 6) {
          // The code is already spent by this point, deliberately: a client that
          // could retry with a different password after a valid code would be
          // holding a reusable one. Say so plainly so the merchant knows to ask
          // for another rather than assuming the code was wrong.
          return json(
            {
              error:
                "That code was correct, but the new password must be at least 6 characters. Ask for a fresh code and try again.",
              reason: "weak_password",
            },
            400,
          );
        }

        if (!otp.user_id) {
          return json({ error: "That code is no longer valid. Ask for a new one." }, 400);
        }

        const { error: updateError } = await db.auth.admin.updateUserById(otp.user_id, {
          password: newPassword,
        });
        if (updateError) {
          console.error("[otp] password reset failed:", updateError.message);
          return json({ error: "Could not set the new password. Please try again." }, 500);
        }

        console.log(`[otp] password reset completed for ${mask(phone)}`);
        return json({ success: true, passwordChanged: true }, 200);
      }

      default:
        return json({ error: "Unsupported purpose" }, 400);
    }
  } catch (err) {
    console.error("[otp] verify failed:", err?.stack ?? err);
    return json({ error: "Internal server error" }, 500);
  }
}
