/**
 * Which verification steps this deployment requires.
 *
 * Lives in `app_settings.auth`, which is PUBLICLY readable — and has to be. The
 * login and registration screens have to know whether to render an OTP step
 * before anyone is signed in, so a policy that needed a session would make the
 * setting unreadable exactly where it is used. Nothing here is secret: it is a
 * list of which steps exist, not any credential.
 *
 * The same row already carries `google_web_client_id`, written by
 * selfhost-smtp-reconcile.sh. This module reads that too so there is one place
 * that knows what the auth row contains.
 *
 * Kept synchronous for readers, like trialConfig was and estimateCredits is:
 * screens render against the last loaded value rather than awaiting one, and a
 * `loadAuthConfig()` on app start fills it in.
 */

import { supabase } from "@/integrations/supabase/client";

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

export interface AuthConfig {
  /**
   * Whether a merchant must confirm their email address.
   *
   * OFF by default, and that is the point of "email is optional now". While it
   * is false the app never blocks anyone on a confirmation link — the failure
   * that killed registration for a day when Resend went live and GoTrue's
   * autoconfirm flipped.
   */
  emailVerificationEnabled: boolean;
  /** Whether the WhatsApp number must be verified by OTP. The permanent channel. */
  whatsappVerificationEnabled: boolean;
  /** Whether a WhatsApp code is required to finish signing in. */
  twoFactorEnabled: boolean;
  /** Whether password reset may be done by WhatsApp OTP. */
  whatsappResetEnabled: boolean;
  /** Whether the login screen offers signing in with a mobile number. */
  phoneLoginEnabled: boolean;
  otpLength: number;
  otpTtlMinutes: number;
  otpMaxAttempts: number;
  otpResendSeconds: number;
  /** The Google web client id, or "" while Google sign-in is off. */
  googleWebClientId: string;
}

/**
 * What applies before the row has loaded, and if it never does.
 *
 * Every gate defaults OFF. A config read that fails must not invent a
 * verification step the merchant cannot pass — being unable to reach the
 * settings is not a reason to lock someone out of their own account.
 */
export const DEFAULT_AUTH_CONFIG: AuthConfig = {
  emailVerificationEnabled: false,
  whatsappVerificationEnabled: false,
  twoFactorEnabled: false,
  whatsappResetEnabled: false,
  phoneLoginEnabled: false,
  otpLength: 6,
  otpTtlMinutes: 10,
  otpMaxAttempts: 5,
  otpResendSeconds: 45,
  googleWebClientId: "",
};

let current: AuthConfig = { ...DEFAULT_AUTH_CONFIG };

type Listener = () => void;
const listeners = new Set<Listener>();

export function onAuthConfigChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The settings as last loaded. Synchronous, for render paths. */
export function authConfig(): AuthConfig {
  return current;
}

function intOr(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function coerce(raw: unknown): AuthConfig {
  const v = (raw ?? {}) as Record<string, unknown>;
  return {
    emailVerificationEnabled: v.email_verification_enabled === true,
    whatsappVerificationEnabled: v.whatsapp_verification_enabled === true,
    twoFactorEnabled: v.two_factor_enabled === true,
    whatsappResetEnabled: v.whatsapp_reset_enabled === true,
    phoneLoginEnabled: v.phone_login_enabled === true,
    otpLength: intOr(v.otp_length, 6, 4, 8),
    otpTtlMinutes: intOr(v.otp_ttl_minutes, 10, 1, 60),
    otpMaxAttempts: intOr(v.otp_max_attempts, 5, 1, 20),
    otpResendSeconds: intOr(v.otp_resend_seconds, 45, 0, 600),
    googleWebClientId: typeof v.google_web_client_id === "string" ? v.google_web_client_id : "",
  };
}

/** Install a config. Ignores nothing-shaped input rather than blanking the gates. */
export function applyAuthConfig(raw: unknown): void {
  if (raw === null || raw === undefined) return;
  const next = coerce(raw);
  const changed = (Object.keys(next) as (keyof AuthConfig)[]).some((k) => next[k] !== current[k]);
  current = next;
  if (!changed) return;
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* a listener must not break the auth gates */
    }
  });
}

let loaded = false;
let inFlight: Promise<AuthConfig> | null = null;

/**
 * Fetch the settings once per session.
 *
 * Concurrent callers share the request: the login screen, the registration
 * screen and the app shell all want this on first paint, and three identical
 * queries before anyone is signed in is three chances to be rate limited.
 */
export async function loadAuthConfig(force = false): Promise<AuthConfig> {
  if (loaded && !force && !inFlight) return current;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const { data, error } = await (supabase as unknown as LooseFrom)
        .from("app_settings")
        .select("value")
        .eq("key", "auth")
        .maybeSingle();
      if (error) throw error;
      applyAuthConfig((data as { value?: unknown } | null)?.value);
      loaded = true;
    } catch (err) {
      console.warn("[auth] settings unavailable, every gate stays off:", err);
    } finally {
      inFlight = null;
    }
    return current;
  })();

  return inFlight;
}
