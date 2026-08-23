import { adminClient, callerClient, corsHeaders, env, json } from "./runtime.mjs";

/**
 * link-google — attach a Google account to the CALLER's existing account.
 *
 * WHY THIS EXISTS
 * GoTrue has a link-identity endpoint, but it is a browser redirect through
 * Google's consent page, and Google refuses to run that page inside a WebView
 * ("disallowed_useragent"). The Android app gets its Google id token from the
 * system's Credential Manager instead, and sends it here.
 *
 * SECURITY
 * Two things are verified before a single row is written:
 *
 *  1. Who is asking: the caller's own JWT, resolved through the anon client so
 *     RLS-grade identity applies. The target user is ALWAYS the caller. There
 *     is no userId input, and none may ever be added.
 *  2. What they are presenting: the id token is sent to Google's tokeninfo
 *     endpoint, which checks the signature and expiry. On top of that this
 *     function checks the issuer, that the audience is OUR client id (a token
 *     minted for some other app must not open doors here), and that Google
 *     vouches for the email. Only then is admin_link_identity() called - that
 *     function trusts its arguments entirely, which is why the service role
 *     alone may execute it.
 *
 * The token itself is never logged: it is a bearer credential for the user's
 * Google account for as long as it is valid.
 *
 * RESPONSE SHAPE
 * Always HTTP 200 with { ok, email? , error? } for anything the user can act
 * on, so the app can show `error` verbatim without digging into a FunctionsHttpError.
 * 401 only when there is no usable session; 500 only for the unexpected.
 */

const TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
const GOOGLE_TIMEOUT_MS = 10_000;

/** Client ids the server will accept as the token's audience. */
function acceptedAudiences() {
  return String(env("GOOGLE_CLIENT_ID", "") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Ask Google what a token is. Returns the claims, or a string naming why they
 * could not be trusted. Anything network-shaped is reported as such rather than
 * as a bad token: the user cannot fix our outbound connectivity by re-tapping.
 */
async function inspectToken(idToken) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GOOGLE_TIMEOUT_MS);
  try {
    const res = await fetch(`${TOKENINFO_URL}?id_token=${encodeURIComponent(idToken)}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    // tokeninfo answers 400 for an invalid, expired or malformed token.
    if (res.status === 400) return { error: "That Google sign-in has expired. Try again." };
    if (!res.ok) return { error: "Google did not answer. Try again in a moment." };
    return { claims: await res.json() };
  } catch {
    return { error: "Could not reach Google to check the sign-in. Try again in a moment." };
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ ok: false, error: "Sign in first." }, 401);
    }

    const {
      data: { user: caller },
      error: callerError,
    } = await callerClient(authHeader).auth.getUser();
    if (callerError || !caller) {
      return json({ ok: false, error: "Your session has expired. Sign in again." }, 401);
    }

    let body = {};
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "No Google sign-in was received." });
    }
    const idToken = typeof body?.idToken === "string" ? body.idToken.trim() : "";
    if (!idToken || idToken.split(".").length !== 3) {
      return json({ ok: false, error: "No Google sign-in was received." });
    }

    const audiences = acceptedAudiences();
    if (audiences.length === 0) {
      return json({ ok: false, error: "Google sign-in is not configured on the server yet." });
    }

    const inspected = await inspectToken(idToken);
    if (inspected.error) return json({ ok: false, error: inspected.error });
    const claims = inspected.claims ?? {};

    if (!GOOGLE_ISSUERS.has(String(claims.iss ?? ""))) {
      return json({ ok: false, error: "That sign-in did not come from Google." });
    }
    if (!audiences.includes(String(claims.aud ?? ""))) {
      // A valid Google token for a different app. Most likely the wrong client
      // id was pasted into the console; say so in the logs, not to the user.
      console.warn("[link-google] token audience does not match the configured client id");
      return json({ ok: false, error: "That Google sign-in was issued for a different app." });
    }
    const exp = Number(claims.exp ?? 0);
    if (!Number.isFinite(exp) || exp * 1000 <= Date.now()) {
      return json({ ok: false, error: "That Google sign-in has expired. Try again." });
    }
    if (String(claims.email_verified) !== "true" || !claims.email) {
      return json({ ok: false, error: "Google has not verified that email address, so it cannot be used to sign in." });
    }
    if (!claims.sub) {
      return json({ ok: false, error: "Google did not identify the account. Try again." });
    }

    const email = String(claims.email).toLowerCase();
    const name = claims.name ? String(claims.name) : null;
    const picture = claims.picture ? String(claims.picture) : null;

    // The same shape GoTrue writes for a Google identity, so the rest of the
    // system (and GoTrue itself, on the next Google sign-in) sees nothing odd.
    const identityData = {
      iss: String(claims.iss),
      sub: String(claims.sub),
      email,
      email_verified: true,
      phone_verified: false,
      name,
      full_name: name,
      given_name: claims.given_name ? String(claims.given_name) : null,
      family_name: claims.family_name ? String(claims.family_name) : null,
      picture,
      avatar_url: picture,
      provider_id: String(claims.sub),
    };

    const { data, error } = await adminClient().rpc("admin_link_identity", {
      p_user_id: caller.id,
      p_provider: "google",
      p_provider_id: String(claims.sub),
      p_identity_data: identityData,
    });

    if (error) {
      // The function RAISEs full sentences for the two cases a person can act
      // on; anything else is ours to fix and gets the generic line.
      const message = String(error.message ?? "");
      const actionable = /already|Disconnect/i.test(message);
      if (!actionable) console.error("[link-google] admin_link_identity failed:", message);
      return json({
        ok: false,
        error: actionable ? message : "Could not connect the Google account. Please try again.",
      });
    }

    console.log(`[link-google] linked google identity to ${caller.id}${data?.already ? " (already linked)" : ""}`);
    return json({ ok: true, email, already: Boolean(data?.already) });
  } catch (err) {
    console.error("[link-google] error:", err?.message ?? err);
    return json({ ok: false, error: "Internal server error" }, 500);
  }
}
