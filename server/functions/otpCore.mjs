/**
 * Shared machinery for issuing and checking one-time codes.
 *
 * Split out of the two handlers because the rules that matter are the ones both
 * sides have to agree on: how long a code lives, how many guesses it gets, and
 * what "the code matches" actually means.
 *
 * WHAT IS STORED
 * A SHA-256 hash of the code, never the code. There is no operation that needs
 * to read one back — verification only ever compares — and a table of live
 * plaintext OTPs turns one leaked backup into every account on the platform.
 *
 * WHY THE COMPARISON IS TIMING-SAFE
 * A six-digit code is a million possibilities, and the attempt limit is the only
 * thing standing between an attacker and walking them. `===` on a hash leaks how
 * many leading bytes matched through timing, which under a patient attacker
 * turns a million-guess problem into a much smaller one. `timingSafeEqual` costs
 * nothing here and removes the question.
 *
 * WHY ATTEMPTS ARE COUNTED BEFORE THE COMPARISON
 * If the counter were bumped after a failed match, a client that hangs up
 * mid-request gets a free guess. Counting first means every request that reaches
 * the comparison has already paid for it.
 */

import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { adminClient } from "./runtime.mjs";

/** Defaults, mirroring the seed in the migration. Used when app_settings is unreadable. */
export const DEFAULT_AUTH_SETTINGS = {
  phoneLoginEnabled: true,
  phoneLoginClaimsUnverified: true,
  emailVerificationEnabled: false,
  whatsappVerificationEnabled: true,
  twoFactorEnabled: false,
  whatsappResetEnabled: true,
  otpLength: 6,
  otpTtlMinutes: 10,
  otpMaxAttempts: 5,
  otpResendSeconds: 45,
  otpHourlyLimit: 6,
};

const SETTINGS_CACHE_MS = 30_000;
let settingsCache = { at: 0, value: { ...DEFAULT_AUTH_SETTINGS } };

function intOr(raw, fallback, min, max) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** The auth switches, as set by the admin console. */
export async function authSettings() {
  if (Date.now() - settingsCache.at < SETTINGS_CACHE_MS) return settingsCache.value;

  try {
    const db = adminClient();
    const { data, error } = await db
      .from("app_settings")
      .select("value")
      .eq("key", "auth")
      .maybeSingle();
    if (error) throw error;

    const v = data?.value ?? {};
    settingsCache = {
      at: Date.now(),
      value: {
        phoneLoginEnabled: v.phone_login_enabled !== false,
        phoneLoginClaimsUnverified: v.phone_login_claims_unverified !== false,
        emailVerificationEnabled: v.email_verification_enabled === true,
        whatsappVerificationEnabled: v.whatsapp_verification_enabled !== false,
        twoFactorEnabled: v.two_factor_enabled === true,
        whatsappResetEnabled: v.whatsapp_reset_enabled !== false,
        // Bounded rather than trusted. A typo in the console that made the TTL
        // 0 would reject every code the instant it was sent, and one that made
        // it 100000 would leave codes valid for two months.
        otpLength: intOr(v.otp_length, 6, 4, 8),
        otpTtlMinutes: intOr(v.otp_ttl_minutes, 10, 1, 60),
        otpMaxAttempts: intOr(v.otp_max_attempts, 5, 1, 20),
        otpResendSeconds: intOr(v.otp_resend_seconds, 45, 0, 600),
        otpHourlyLimit: intOr(v.otp_hourly_limit, 6, 1, 100),
      },
    };
  } catch (err) {
    console.warn("[otp] auth settings unavailable, using defaults:", err.message);
  }
  return settingsCache.value;
}

export function invalidateAuthSettings() {
  settingsCache = { at: 0, value: settingsCache.value };
}

/**
 * `login` is the SECOND factor after a password. `phone_login` is a login in its
 * own right — no password at all — and the two must never be confused: one is
 * presented to somebody who has already proven a credential, the other to
 * anybody who can type a number. That is why `phone_login` gets the same
 * anti-enumeration and rate-limit treatment as `reset`.
 */
export const PURPOSES = ["register", "login", "reset", "change_number", "phone_login"];

/**
 * A numeric code of the configured length.
 *
 * `randomInt` from node:crypto, not `Math.random()`. Math.random is seeded from
 * a predictable source and is not a security primitive; an OTP generated from
 * it is guessable given enough observed codes.
 *
 * Leading zeros are preserved by padding, because a code rendered as "042913"
 * and compared as 42913 is a bug that only shows up for 10% of users.
 */
export function generateCode(length) {
  const max = 10 ** length;
  return String(randomInt(0, max)).padStart(length, "0");
}

export function hashCode(code) {
  return createHash("sha256").update(String(code), "utf8").digest("hex");
}

/** Constant-time hash comparison. */
export function hashesMatch(a, b) {
  const bufA = Buffer.from(String(a ?? ""), "utf8");
  const bufB = Buffer.from(String(b ?? ""), "utf8");
  // timingSafeEqual throws on a length mismatch, which would itself leak. Both
  // are hex SHA-256, so unequal lengths mean malformed input, not a near miss.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Whether another code may be sent to this number right now.
 *
 * Two limits, for two different problems:
 *
 *  - the RESEND cooldown stops a merchant hammering "resend" and ending up with
 *    five valid codes and no idea which one to type;
 *  - the HOURLY cap is a spend control. Every WhatsApp message costs money, and
 *    an unthrottled OTP endpoint is somebody else's free SMS gateway.
 */
export async function checkSendAllowance(db, { purpose, phone }, settings) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data, error } = await db
    .from("auth_otps")
    .select("created_at")
    .eq("phone", phone)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(settings.otpHourlyLimit + 1);

  // Fail OPEN on a failed read. The alternative is that a database hiccup locks
  // every merchant out of signing up, which is a far worse outcome than a
  // handful of extra messages.
  if (error) {
    console.warn("[otp] allowance check failed, allowing:", error.message);
    return { allowed: true };
  }

  const rows = data ?? [];
  if (rows.length >= settings.otpHourlyLimit) {
    const oldest = new Date(rows[rows.length - 1].created_at).getTime();
    const retryAfter = Math.max(1, Math.ceil((oldest + 3_600_000 - Date.now()) / 1000));
    return {
      allowed: false,
      reason: "hourly_limit",
      retryAfter,
      message: `Too many codes requested for this number. Try again in ${Math.ceil(retryAfter / 60)} minutes.`,
    };
  }

  if (rows.length > 0 && settings.otpResendSeconds > 0) {
    const lastAt = new Date(rows[0].created_at).getTime();
    const waited = (Date.now() - lastAt) / 1000;
    if (waited < settings.otpResendSeconds) {
      const retryAfter = Math.ceil(settings.otpResendSeconds - waited);
      return {
        allowed: false,
        reason: "cooldown",
        retryAfter,
        message: `A code was just sent. You can ask for another in ${retryAfter} seconds.`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Invalidate every live code for a (purpose, phone).
 *
 * Called before issuing a new one so only the newest code works. Without it, a
 * merchant who requests twice can successfully type the FIRST code, which makes
 * "the code expired, request a new one" advice wrong and confusing.
 */
export async function consumeOutstanding(db, purpose, phone) {
  await db
    .from("auth_otps")
    .update({ consumed_at: new Date().toISOString() })
    .eq("purpose", purpose)
    .eq("phone", phone)
    .is("consumed_at", null);
}

/**
 * Look up the account behind a verified phone number.
 *
 * Only VERIFIED numbers resolve. An unverified row is a claim, not a fact, and
 * letting one identify an account for password reset would let anyone who typed
 * a victim's number into their own signup form take the victim's account.
 */
export async function userIdForVerifiedPhone(db, phone) {
  const { data, error } = await db
    .from("user_security")
    .select("user_id")
    .eq("phone", phone)
    .not("phone_verified_at", "is", null)
    .maybeSingle();
  if (error) {
    console.warn("[otp] phone lookup failed:", error.message);
    return null;
  }
  return data?.user_id ?? null;
}

/**
 * The account whose COMPANY carries this number, when nobody has proven it yet.
 *
 * This is what lets the existing merchant base use phone login at all: before
 * this feature there was no way to verify a number, so every one of them is
 * unverified. It treats "can receive a code on the number stored against the
 * company" as proof of ownership of that account.
 *
 * Three refusals keep that from being a way in:
 *
 *  - MORE THAN ONE company on the number → null. Two merchants sharing a number
 *    makes "which account" unanswerable, and picking one is picking a victim.
 *  - The owner ALREADY has a different verified number → null. Otherwise a stale
 *    company row would override a number its owner has actually proven, which is
 *    an account takeover with extra steps.
 *  - The setting is off → the caller never gets here.
 */
export async function userIdForCompanyPhone(db, phone) {
  const { data, error } = await db
    .from("companies")
    .select("owner_id, phone")
    .or(`phone.eq.+91${phone},phone.eq.${phone},phone.eq.91${phone}`);

  if (error) {
    console.warn("[otp] company phone lookup failed:", error.message);
    return null;
  }

  const owners = [...new Set((data ?? []).map((r) => r.owner_id).filter(Boolean))];
  if (owners.length !== 1) return null;
  const ownerId = owners[0];

  const { data: existing, error: securityError } = await db
    .from("user_security")
    .select("phone, phone_verified_at")
    .eq("user_id", ownerId)
    .maybeSingle();

  if (securityError) {
    console.warn("[otp] security row lookup failed:", securityError.message);
    return null;
  }
  if (existing?.phone_verified_at && existing.phone !== phone) return null;

  return ownerId;
}

/** Resolve the caller's user id from their Authorization header, or null. */
export async function callerUserId(req) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  try {
    const db = adminClient();
    const { data, error } = await db.auth.getUser(token);
    if (error) return null;
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Upsert the security row for a user.
 *
 * Written ONLY from the functions host with the service role — `user_security`
 * grants no INSERT or UPDATE to authenticated users at all. A client that could
 * write `phone_verified_at` would have defeated the whole feature.
 */
export async function markPhoneVerified(db, userId, phone) {
  const now = new Date().toISOString();
  const { error } = await db
    .from("user_security")
    .upsert(
      { user_id: userId, phone, phone_verified_at: now, updated_at: now },
      { onConflict: "user_id" },
    );
  if (error) throw error;
}

export async function markTwoFactorPassed(db, userId) {
  const now = new Date().toISOString();
  const { error } = await db
    .from("user_security")
    .upsert({ user_id: userId, last_2fa_at: now, updated_at: now }, { onConflict: "user_id" });
  if (error) throw error;
}
