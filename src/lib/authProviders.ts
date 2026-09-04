/**
 * Which sign-in providers the server is set up for.
 *
 * Google sign-in needs a Web OAuth client id on the device (the Android
 * Credential Manager flow asks Google for a token minted for that id) and the
 * matching client secret on the server. The id is public by nature - it ships
 * in every APK - so it lives in `app_settings.auth`, which the client may read
 * with the anon key, and is filled in from the admin console rather than baked
 * into a build. Until it is filled in, the app shows no Google button at all:
 * a button that opens a sign-in Google then rejects is worse than no button.
 *
 * Reads FAIL CLOSED. A network error here hides the Google option for that
 * screen; email and password keep working regardless.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface AuthProvidersConfig {
  /** The Web-application OAuth client id, or "" when Google sign-in is off. */
  googleWebClientId: string;
}

export const NO_PROVIDERS: AuthProvidersConfig = { googleWebClientId: "" };

/**
 * Google sign-in is off by product decision, not by missing credentials.
 *
 * The owner asked for registration and login to go back to email and password
 * only (25 Aug 2026) and to add Google later. This is the ONE switch: while it
 * is false `coerce` reports no client id, so `useGoogleSignInConfig().enabled`
 * is false and `GoogleButton` renders null on every screen — Register, Login
 * and the Account page — without a single one of them knowing why.
 *
 * Flip to true to bring it back. Nothing was deleted, so that is the whole
 * change on the client; the server still has to have the OAuth credentials and
 * SMTP set for `selfhost-smtp-reconcile.sh` to enable the provider.
 */
export const GOOGLE_SIGN_IN_ENABLED = false;

/** The generated types predate this row; describe exactly what we read and cast. */
type Loose = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<{ data: { value?: unknown } | null; error: unknown }>;
      };
    };
  };
};

let current: AuthProvidersConfig = NO_PROVIDERS;
let loaded = false;
let inflight: Promise<AuthProvidersConfig> | null = null;

function coerce(raw: unknown): AuthProvidersConfig {
  // The kill switch wins over whatever the server says, so turning the provider
  // on in the admin console cannot put the button back by surprise.
  if (!GOOGLE_SIGN_IN_ENABLED) return NO_PROVIDERS;
  const v = (raw ?? {}) as Record<string, unknown>;
  const id = typeof v.google_web_client_id === "string" ? v.google_web_client_id.trim() : "";
  return { googleWebClientId: id };
}

/** The last loaded configuration. Synchronous; NO_PROVIDERS until loaded. */
export function authProviders(): AuthProvidersConfig {
  return current;
}

export function isGoogleSignInConfigured(): boolean {
  return current.googleWebClientId !== "";
}

/**
 * Fetch the providers row once per session.
 *
 * A failed fetch is not remembered as "loaded", so the next screen that asks
 * gets another try - otherwise one flaky request at cold start would hide
 * Google sign-in until the app restarts.
 */
export async function loadAuthProviders(force = false): Promise<AuthProvidersConfig> {
  // Nothing to ask the server for while the switch is off, and one fewer
  // request on every cold start of the login screen.
  if (!GOOGLE_SIGN_IN_ENABLED) {
    current = NO_PROVIDERS;
    loaded = true;
    return current;
  }
  if (loaded && !force) return current;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const { data, error } = await (supabase as unknown as Loose)
        .from("app_settings")
        .select("value")
        .eq("key", "auth")
        .maybeSingle();
      if (error) throw error;
      current = coerce(data?.value);
      loaded = true;
    } catch (err) {
      console.warn("[auth] could not load sign-in providers:", err);
      current = NO_PROVIDERS;
    } finally {
      inflight = null;
    }
    return current;
  })();

  return inflight;
}

/** Test hook: forget everything loaded so far. */
export function resetAuthProvidersForTests(): void {
  current = NO_PROVIDERS;
  loaded = false;
  inflight = null;
}

/**
 * Google sign-in availability for a screen.
 *
 * `enabled` is false while loading, so a button bound to it never flashes on
 * and then off; the email form is always there to use in the meantime.
 */
export function useGoogleSignInConfig(): { loading: boolean; webClientId: string; enabled: boolean } {
  const [state, setState] = useState<{ loading: boolean; webClientId: string }>(() => ({
    loading: !loaded,
    webClientId: current.googleWebClientId,
  }));

  useEffect(() => {
    let active = true;
    void loadAuthProviders().then((config) => {
      if (active) setState({ loading: false, webClientId: config.googleWebClientId });
    });
    return () => {
      active = false;
    };
  }, []);

  return { loading: state.loading, webClientId: state.webClientId, enabled: state.webClientId !== "" };
}
