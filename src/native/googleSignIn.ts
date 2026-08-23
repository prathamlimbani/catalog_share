/**
 * Google sign-in on the device.
 *
 * On Android this is Google's Credential Manager through
 * @capgo/capacitor-social-login: the OS shows the account sheet, the user taps
 * an account, and Google hands back an OpenID Connect id token minted for our
 * Web client id. That token is all the rest of the app needs - GoTrue verifies
 * it server-side and opens (or links) the session. No OAuth redirect, no
 * browser tab, and no Google page inside the WebView (which Google blocks).
 *
 * On the web this module does nothing: the browser build uses GoTrue's own
 * redirect flow (see @/lib/googleAuth), so the plugin is never even imported
 * there. The import is dynamic for that reason - the plugin and its Capacitor
 * bridge stay out of the website bundle entirely.
 */

import { isNative } from "./platform";

export interface GoogleIdToken {
  idToken: string;
  /** The address Google reports, for display only - the token is the truth. */
  email: string | null;
}

/** The plugin is loaded on first use and initialised once per client id. */
let initialisedFor: string | null = null;

async function plugin() {
  const mod = await import("@capgo/capacitor-social-login");
  return mod.SocialLogin;
}

/**
 * Whether a thrown value means "the user closed the sheet".
 *
 * The plugin rejects with `code: "USER_CANCELLED"`; Credential Manager's own
 * wording varies by Play Services version ("canceled", "cancelled", status
 * code 13 on older devices). None of those deserve an error toast.
 */
export function isGoogleCancel(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = String((err as { code?: unknown }).code ?? "").toUpperCase();
  const message = String((err as { message?: unknown }).message ?? "").toLowerCase();
  return (
    code.includes("CANCEL") ||
    code === "13" ||
    message.includes("cancel") ||
    message.includes("canceled") ||
    message.includes("user_cancelled") ||
    /\b13\b/.test(message)
  );
}

/**
 * Ask Google for an id token.
 *
 * Resolves null when the user dismissed the account picker, so callers can
 * simply return; throws for everything else, with the plugin's message intact
 * (it names the misconfiguration - a SHA-1 not registered in Google Cloud,
 * for instance - which is exactly what an operator needs to read).
 */
export async function getGoogleIdToken(webClientId: string): Promise<GoogleIdToken | null> {
  if (!isNative) return null;
  if (!webClientId) throw new Error("Google sign-in isn't set up yet.");

  const SocialLogin = await plugin();

  if (initialisedFor !== webClientId) {
    await SocialLogin.initialize({ google: { webClientId, mode: "online" } });
    initialisedFor = webClientId;
  }

  try {
    // Deliberately NO `scopes` option. The capgo plugin's Android provider
    // rejects any explicit scopes array unless MainActivity is subclassed to
    // implement its ModifiedMainActivityForSocialLoginPlugin marker — "You
    // CANNOT use scopes without modifying the main activity" — which fires
    // before the account sheet ever opens and kills every native Google path.
    // The default request already asks for openid/email/profile and returns an
    // id token, which is all we need; extra scopes would only matter for
    // calling Google APIs, which this app never does.
    const { result } = await SocialLogin.login({ provider: "google", options: {} });

    if (result.responseType !== "online" || !result.idToken) {
      throw new Error("Google did not return a sign-in token. Please try again.");
    }

    return { idToken: result.idToken, email: result.profile?.email ?? null };
  } catch (err) {
    if (isGoogleCancel(err)) return null;
    throw err;
  }
}

/**
 * Forget the Google session on the device, so the next sign-in shows the
 * account picker again instead of silently reusing the last account.
 * Best-effort: there is nothing useful to do if it fails.
 */
export async function signOutOfGoogle(): Promise<void> {
  if (!isNative || initialisedFor === null) return;
  try {
    const SocialLogin = await plugin();
    await SocialLogin.logout({ provider: "google" });
  } catch {
    /* already signed out, or the plugin is unavailable */
  }
}
