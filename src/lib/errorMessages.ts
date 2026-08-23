/**
 * Turning thrown values into a sentence a person can act on.
 *
 * Two things kept going wrong at the call sites this replaces:
 *  1. `catch (err: any) { toast.error(err.message) }` throws a second time when
 *     the rejection value is not an object (fetch can reject with a string, and
 *     `Promise.reject()` with nothing at all).
 *  2. GoTrue's wording is written for developers. "Invalid login credentials"
 *     tells a merchant nothing about what to do next.
 */

/** The message carried by a thrown value, or "" when there isn't one. */
export function errorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  return rawMessage(error) || fallback;
}

function rawMessage(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
    const description = (error as { error_description?: unknown }).error_description;
    if (typeof description === "string") return description;
  }
  return "";
}

/**
 * Auth failures, rewritten for the person staring at the form.
 *
 * Supabase deliberately returns the same "Invalid login credentials" for a
 * wrong password and an email that was never registered (it will not confirm
 * which addresses exist), so the copy has to cover both without guessing.
 */
export function authErrorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  const raw = rawMessage(error);
  if (!raw) return fallback;
  const text = raw.toLowerCase();

  // Offline / DNS / server unreachable. Checked first: the browser's wording
  // varies per engine ("Failed to fetch", "Load failed", "NetworkError").
  if (
    text.includes("failed to fetch") ||
    text.includes("load failed") ||
    text.includes("networkerror") ||
    text.includes("network request failed") ||
    text.includes("fetch failed")
  ) {
    return "Can't reach the server. Check your internet connection and try again.";
  }

  if (text.includes("invalid login credentials") || text.includes("invalid credentials")) {
    return "That email and password don't match. If you haven't registered yet, create an account first.";
  }
  if (text.includes("email not confirmed")) {
    return "Confirm your email first — open the verification link we sent to your inbox.";
  }
  if (text.includes("already registered") || text.includes("already exists")) {
    return "An account with this email already exists. Log in instead, or use a different email.";
  }

  // Google sign-in and account linking. These come before the generic
  // "token"/"expired" matches below, which would otherwise describe a rejected
  // id token as a mistyped email code.
  if (text.includes("provider is not enabled") || text.includes("unsupported provider") || text.includes("provider could not be found")) {
    return "Google sign-in isn't switched on yet. Use your email and password.";
  }
  if (text.includes("already linked") || text.includes("already connected")) {
    return "That Google account is already connected to another CatalogShare account.";
  }
  if (text.includes("manual linking is disabled") || text.includes("linking is disabled")) {
    return "Connecting accounts isn't available right now. Please try again later.";
  }
  if (text.includes("at least one identity") || text.includes("cannot unlink")) {
    return "That is the only way into this account, so it can't be disconnected.";
  }
  if (text.includes("multiple accounts with the same email")) {
    return "More than one account uses this email address. Please contact support.";
  }
  if (text.includes("id token") || text.includes("id_token") || text.includes("audience")) {
    return "Google didn't accept that sign-in. Please try again.";
  }
  if (text.includes("access_denied") || text.includes("access denied")) {
    return "Google sign-in was cancelled before it finished.";
  }
  // Anything else that already names Google is a sentence the link-google
  // function wrote for the user (e.g. "That Google sign-in has expired. Try
  // again."). Pass it through verbatim so the generic "expired"/"token"
  // branches below don't rewrite it into the email-code copy.
  if (text.includes("google")) {
    return raw;
  }

  if (text.includes("expired")) {
    return "That code has expired. Send yourself a new one and try again.";
  }
  if (text.includes("token") || text.includes("otp")) {
    return "That code isn't right. Check the email again — codes are case-sensitive.";
  }
  if (text.includes("password should be at least") || text.includes("password is too short")) {
    return "Password must be at least 6 characters.";
  }
  if (text.includes("weak password") || text.includes("pwned")) {
    return "That password is too easy to guess. Try a longer one.";
  }
  if (text.includes("rate limit") || text.includes("too many requests") || text.includes("for security purposes")) {
    return "Too many attempts. Wait about a minute, then try again.";
  }
  if (text.includes("unable to validate email") || text.includes("invalid email")) {
    return "That email address doesn't look right.";
  }
  if (text.includes("signups not allowed") || text.includes("signup is disabled")) {
    return "New registrations are closed right now. Please contact support.";
  }

  return raw;
}
