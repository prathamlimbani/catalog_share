/**
 * Issue a one-time code over WhatsApp (and optionally email).
 *
 * WHO MAY ASK, and why it differs per purpose:
 *
 *   register       signed in. Signup creates the account first, so a session
 *                  always exists by the time the phone is verified. Requiring it
 *                  means this endpoint cannot be used as an anonymous SMS pump.
 *   login          signed in. The password has already been checked; this is the
 *                  second factor, not the first.
 *   change_number  signed in, obviously.
 *   reset          NOT signed in — being locked out is the entire point.
 *   phone_login    NOT signed in — signing in IS the point. No password is
 *                  involved, so the code is the whole credential.
 *
 * The last two are the open doors, so they get the tightest rate limits and the
 * most careful responses.
 *
 * WHAT THE RESPONSE MAY REVEAL
 * For `reset` and `phone_login`, the answer is identical whether or not the
 * number belongs to an account. Anything else turns this endpoint into a "is
 * this person a CatalogShare merchant?" oracle for anyone with a phone book. The
 * code is simply not sent when there is nobody to send it to.
 */

import { corsHeaders, adminClient, json } from "./runtime.mjs";
import { sendWhatsApp, toIndianMobile, mask } from "./whatsapp.mjs";
import { sendMail } from "./mailer.mjs";
import {
  PURPOSES,
  authSettings,
  callerUserId,
  checkSendAllowance,
  consumeOutstanding,
  generateCode,
  hashCode,
  userIdForCompanyPhone,
  userIdForVerifiedPhone,
} from "./otpCore.mjs";

/** Purposes that require the caller to already be signed in. */
const NEEDS_SESSION = new Set(["register", "login", "change_number"]);

function otpEmailHtml(code, minutes, purpose) {
  const what =
    purpose === "reset"
      ? "reset your password"
      : purpose === "login"
        ? "finish signing in"
        : "verify your number";
  return [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;padding:28px">',
    '<h2 style="margin:0 0 8px;font-size:20px;color:#111827">Your CatalogShare code</h2>',
    `<p style="margin:0 0 20px;color:#4b5563;line-height:1.6">Use this code to ${what}.</p>`,
    `<p style="margin:0 0 20px;font-size:34px;letter-spacing:10px;font-weight:800;color:#111827">${code}</p>`,
    `<p style="margin:0 0 8px;color:#4b5563;line-height:1.6">It expires in ${minutes} minutes.</p>`,
    '<p style="margin:0;color:#9ca3af;font-size:13px;line-height:1.6">If you did not ask for this, ignore this email — nothing has changed on your account.</p>',
    "</div>",
  ].join("");
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const purpose = String(body.purpose ?? "").trim();
    const rawPhone = body.phone;

    if (!PURPOSES.includes(purpose)) {
      return json({ error: `purpose must be one of: ${PURPOSES.join(", ")}` }, 400);
    }

    // Normalised once, here, and never again downstream. Every later comparison
    // — rate limits, verification, the unique index on verified numbers — is
    // against this exact string, so "+91 96635 59022" and "9663559022" have to
    // become the same value before anything is looked up.
    const phone = toIndianMobile(rawPhone);
    if (!phone) {
      return json(
        { error: "Enter a 10-digit Indian mobile number, starting 6, 7, 8 or 9." },
        400,
      );
    }

    const settings = await authSettings();
    const db = adminClient();

    // ------------------------------------------------------------ who is asking
    let userId = null;
    if (NEEDS_SESSION.has(purpose)) {
      userId = await callerUserId(req);
      if (!userId) return json({ error: "You need to be signed in for that." }, 401);
    }

    if (purpose === "reset" && !settings.whatsappResetEnabled) {
      return json({ error: "Password reset by WhatsApp is switched off." }, 403);
    }
    if (purpose === "phone_login" && !settings.phoneLoginEnabled) {
      return json({ error: "Signing in with a mobile number is switched off." }, 403);
    }

    // ------------------------------------------------------ is the number free
    // A number may only be VERIFIED against one account. Without this, two
    // merchants can both claim the same WhatsApp number and a reset code becomes
    // ambiguous — and the account it lands on is whichever the database returns
    // first, which is not a security property anybody chose.
    if (purpose === "register" || purpose === "change_number") {
      const owner = await userIdForVerifiedPhone(db, phone);
      if (owner && owner !== userId) {
        return json(
          {
            error:
              "That WhatsApp number is already verified on another CatalogShare account. Sign in to that account, or use a different number.",
          },
          409,
        );
      }
    }

    // ------------------------------------------------------------- rate limits
    const allowance = await checkSendAllowance(db, { purpose, phone }, settings);
    if (!allowance.allowed) {
      return json(
        { error: allowance.message, reason: allowance.reason, retryAfter: allowance.retryAfter },
        429,
      );
    }

    // -------------------------------------------------- who the code belongs to
    let targetUserId = userId;
    let targetEmail = typeof body.email === "string" ? body.email.trim() : null;

    if (purpose === "reset" || purpose === "phone_login") {
      targetUserId = await userIdForVerifiedPhone(db, phone);

      // Nobody has PROVEN this number. For a login we may still be able to find
      // the account it belongs to: before this feature existed there was no way
      // to verify a number, so the whole existing merchant base is unverified
      // and would otherwise be permanently unable to use phone login. See
      // `userIdForCompanyPhone` for the three cases it refuses.
      if (!targetUserId && purpose === "phone_login" && settings.phoneLoginClaimsUnverified) {
        targetUserId = await userIdForCompanyPhone(db, phone);
        if (targetUserId) {
          console.log(`[otp] phone_login will claim unverified number ${mask(phone)}`);
        }
      }

      if (!targetUserId) {
        // Deliberately indistinguishable from success. See the header note.
        console.warn(`[otp] ${purpose} requested for unknown number ${mask(phone)}`);
        return json(
          {
            success: true,
            channel: "whatsapp",
            expiresInMinutes: settings.otpTtlMinutes,
            resendAfterSeconds: settings.otpResendSeconds,
          },
          200,
        );
      }
    }

    // ------------------------------------------------------------ issue the code
    const code = generateCode(settings.otpLength);
    const expiresAt = new Date(Date.now() + settings.otpTtlMinutes * 60_000).toISOString();

    // Only the newest code may work — see consumeOutstanding.
    await consumeOutstanding(db, purpose, phone);

    const { data: row, error: insertError } = await db
      .from("auth_otps")
      .insert({
        purpose,
        user_id: targetUserId,
        phone,
        email: targetEmail,
        code_hash: hashCode(code),
        channel: "whatsapp",
        expires_at: expiresAt,
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("[otp] could not store the code:", insertError.message);
      return json({ error: "Could not issue a code just now. Please try again." }, 500);
    }

    // ---------------------------------------------------------------- deliver it
    const wa = await sendWhatsApp("otp", phone, {
      otp: code,
      minutes: settings.otpTtlMinutes,
    });

    if (wa.requestId) {
      await db.from("auth_otps").update({ request_id: wa.requestId }).eq("id", row.id);
    }

    // Email is the OPTIONAL second copy now, not the channel. It is attempted
    // only when there is an address and email verification is switched on, and
    // its failure is never the request's failure.
    let emailed = false;
    if (targetEmail && settings.emailVerificationEnabled) {
      const mail = await sendMail({
        to: targetEmail,
        subject: `${code} is your CatalogShare code`,
        html: otpEmailHtml(code, settings.otpTtlMinutes, purpose),
        text: `Your CatalogShare code is ${code}. It expires in ${settings.otpTtlMinutes} minutes.`,
      });
      emailed = mail.ok;
    }

    if (!wa.ok && !emailed) {
      // Nothing was delivered, so the stored code is unreachable. Burn it rather
      // than leaving a live code nobody has — the next attempt should issue a
      // fresh one, and the resend cooldown should not count this against them.
      await db
        .from("auth_otps")
        .update({ consumed_at: new Date().toISOString() })
        .eq("id", row.id);

      console.error(`[otp] ${purpose} to ${mask(phone)} undeliverable:`, wa.error);
      return json(
        {
          error:
            wa.reason === "not_configured"
              ? "WhatsApp is not connected yet. Ask CatalogShare support to finish setup."
              : wa.reason === "not_provisioned"
                ? "The WhatsApp code template is not approved yet. Ask CatalogShare support."
                : "We could not send the code to that number. Check it is on WhatsApp and try again.",
          reason: wa.reason,
        },
        502,
      );
    }

    console.log(`[otp] ${purpose} sent to ${mask(phone)} (wa:${wa.ok} email:${emailed})`);
    return json(
      {
        success: true,
        channel: wa.ok ? "whatsapp" : "email",
        alsoEmailed: emailed,
        expiresInMinutes: settings.otpTtlMinutes,
        resendAfterSeconds: settings.otpResendSeconds,
      },
      200,
    );
  } catch (err) {
    console.error("[otp] send failed:", err?.stack ?? err);
    return json({ error: "Internal server error" }, 500);
  }
}
