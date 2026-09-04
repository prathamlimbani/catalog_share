/**
 * Client side of the WhatsApp OTP flow.
 *
 * Thin on purpose. Everything that decides anything — whether a number is free,
 * how many codes may be sent, whether a code is right, what verifying it
 * authorises — happens in the `send-otp` and `verify-otp` functions under the
 * service role. This module's whole job is to make the call and turn whatever
 * comes back into a message a merchant can act on.
 *
 * There is deliberately no client-side "is this code right" and no local record
 * of a code having been verified: both would be checks an attacker can simply
 * skip. `user_security` is the record, it is written only by the server, and it
 * is readable (never writable) by the account it belongs to.
 */

import { supabase } from "@/integrations/supabase/client";
import { toIndianMobile } from "@/lib/phone";

/**
 * These tables are newer than the checked-in generated types, so the typed
 * client refuses the name. Same approach the rest of the settings layer takes:
 * describe the shape actually used and cast once.
 */
interface LooseFrom {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: unknown,
      ): {
        maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
  };
}

export type OtpPurpose = "register" | "login" | "reset" | "change_number" | "phone_login";

export interface OtpSendResult {
  ok: boolean;
  /** Where it went, when it went. */
  channel?: "whatsapp" | "email";
  alsoEmailed?: boolean;
  expiresInMinutes?: number;
  resendAfterSeconds?: number;
  /** Set when `ok` is false. Already merchant-readable. */
  error?: string;
  /** Machine-readable cause, for the few cases the UI treats differently. */
  reason?: string;
  /** Seconds to wait, when the refusal was a rate limit. */
  retryAfter?: number;
}

export interface OtpVerifyResult {
  ok: boolean;
  error?: string;
  reason?: string;
  attemptsLeft?: number;
  /**
   * Single-use magic-link token, returned ONLY for `phone_login`.
   *
   * Redeemed by the caller with `supabase.auth.verifyOtp({ token_hash, type:
   * "magiclink" })`, so the session comes from GoTrue with its own expiry and
   * refresh handling. It exists for a few seconds between the code being
   * accepted and the session being created, and it is the whole credential in
   * that window — never log it, never persist it.
   */
  tokenHash?: string;
}

/**
 * Pull a usable message out of a functions.invoke failure.
 *
 * supabase-js reports a non-2xx as a FunctionsHttpError whose `message` is the
 * useless "Edge Function returned a non-2xx status code" — the real reason is
 * in the response body, which it hands over only through `context`. Without
 * this every rate limit and every wrong number reads as the same generic
 * failure, which is precisely the state the OTP screen must never be in.
 */
async function bodyOf(error: unknown): Promise<Record<string, unknown> | null> {
  const context = (error as { context?: unknown })?.context;
  if (!context) return null;
  try {
    // A Response, in every version that carries one.
    if (typeof (context as Response).json === "function") {
      return (await (context as Response).json()) as Record<string, unknown>;
    }
  } catch {
    /* body already read, or not JSON */
  }
  if (typeof context === "object") return context as Record<string, unknown>;
  return null;
}

function messageFrom(body: Record<string, unknown> | null, fallback: string): string {
  const error = body?.error;
  return typeof error === "string" && error ? error : fallback;
}

/**
 * Ask for a code.
 *
 * `phone` may be in any shape; it is normalised to the ten digits the server
 * wants before the call, and refused here when it cannot be — a round trip to
 * be told the number is malformed is a round trip the merchant waits through.
 */
export async function sendOtp(
  purpose: OtpPurpose,
  phone: string,
  options: { email?: string | null } = {},
): Promise<OtpSendResult> {
  const number = toIndianMobile(phone);
  if (!number) {
    return {
      ok: false,
      reason: "bad_number",
      error: "Enter a 10-digit Indian mobile number, starting 6, 7, 8 or 9.",
    };
  }

  try {
    const { data, error } = await supabase.functions.invoke("send-otp", {
      body: { purpose, phone: number, email: options.email ?? null },
    });

    if (error) {
      const body = await bodyOf(error);
      return {
        ok: false,
        error: messageFrom(body, "Could not send the code. Please try again."),
        reason: typeof body?.reason === "string" ? body.reason : undefined,
        retryAfter: typeof body?.retryAfter === "number" ? body.retryAfter : undefined,
      };
    }

    const payload = (data ?? {}) as Record<string, unknown>;
    return {
      ok: payload.success === true,
      channel: payload.channel as OtpSendResult["channel"],
      alsoEmailed: payload.alsoEmailed === true,
      expiresInMinutes: Number(payload.expiresInMinutes) || undefined,
      resendAfterSeconds: Number(payload.resendAfterSeconds) || undefined,
      error: payload.success === true ? undefined : "Could not send the code. Please try again.",
    };
  } catch (err) {
    console.warn("[otp] send failed:", err);
    return {
      ok: false,
      reason: "network",
      error: "Could not reach CatalogShare. Check your connection and try again.",
    };
  }
}

/**
 * Submit a code.
 *
 * `newPassword` is only meaningful for the `reset` purpose, where verifying the
 * code and setting the password are ONE server call. Splitting them would leave
 * a window in which a correct code authorises a separate, unauthenticated
 * "change this password" request — which is the whole account.
 */
export async function verifyOtp(
  purpose: OtpPurpose,
  phone: string,
  code: string,
  options: { newPassword?: string } = {},
): Promise<OtpVerifyResult> {
  const number = toIndianMobile(phone);
  if (!number) return { ok: false, error: "That number is not valid." };

  try {
    const { data, error } = await supabase.functions.invoke("verify-otp", {
      body: {
        purpose,
        phone: number,
        code: String(code ?? "").replace(/\D/g, ""),
        ...(options.newPassword ? { newPassword: options.newPassword } : {}),
      },
    });

    if (error) {
      const body = await bodyOf(error);
      return {
        ok: false,
        error: messageFrom(body, "That code could not be checked. Please try again."),
        reason: typeof body?.reason === "string" ? body.reason : undefined,
        attemptsLeft:
          typeof body?.attemptsLeft === "number" ? (body.attemptsLeft as number) : undefined,
      };
    }

    const payload = (data ?? {}) as Record<string, unknown>;
    return {
      ok: payload.success === true,
      tokenHash: typeof payload.tokenHash === "string" ? payload.tokenHash : undefined,
      error: payload.success === true ? undefined : "That code is not right.",
    };
  } catch (err) {
    console.warn("[otp] verify failed:", err);
    return {
      ok: false,
      reason: "network",
      error: "Could not reach CatalogShare. Check your connection and try again.",
    };
  }
}

/** What the server has recorded about this account's verification state. */
export interface SecurityState {
  phone: string | null;
  phoneVerified: boolean;
  lastTwoFactorAt: number;
  twoFactorExempt: boolean;
}

export const UNKNOWN_SECURITY: SecurityState = {
  phone: null,
  phoneVerified: false,
  lastTwoFactorAt: 0,
  twoFactorExempt: false,
};

/**
 * Read the signed-in account's verification state.
 *
 * Returns null — not a default — when the row cannot be read, so callers can
 * tell "not verified" from "we do not know yet". Treating the second as the
 * first is how a verified merchant gets asked to verify again on every flaky
 * connection.
 */
export async function fetchSecurityState(
  userId: string | null | undefined,
): Promise<SecurityState | null> {
  if (!userId) return null;
  try {
    const { data, error } = await (supabase as unknown as LooseFrom)
      .from("user_security")
      .select("phone, phone_verified_at, last_2fa_at, two_factor_exempt")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ...UNKNOWN_SECURITY };

    const row = data as Record<string, unknown>;
    return {
      phone: typeof row.phone === "string" ? row.phone : null,
      phoneVerified: Boolean(row.phone_verified_at),
      lastTwoFactorAt: row.last_2fa_at ? Date.parse(String(row.last_2fa_at)) || 0 : 0,
      twoFactorExempt: row.two_factor_exempt === true,
    };
  } catch (err) {
    console.warn("[otp] could not read the security row:", err);
    return null;
  }
}
