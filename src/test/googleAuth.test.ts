/**
 * The pieces of Google sign-in that do not need a Google: reading the error
 * GoTrue leaves in the URL after a failed redirect, picking the Google
 * identity out of a user's identities, and the platform split in
 * signInWithGoogle / linkGoogleAccount.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UserIdentity } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({
  isNative: { value: false },
  getGoogleIdToken: vi.fn(),
  auth: {
    signInWithIdToken: vi.fn(),
    signInWithOAuth: vi.fn(),
    linkIdentity: vi.fn(),
    getUserIdentities: vi.fn(),
    unlinkIdentity: vi.fn(),
  },
  functions: { invoke: vi.fn() },
}));

vi.mock("@/native/platform", () => ({
  get isNative() {
    return mocks.isNative.value;
  },
}));
vi.mock("@/native/googleSignIn", () => ({ getGoogleIdToken: mocks.getGoogleIdToken }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: mocks.auth, functions: mocks.functions },
}));

import {
  googleIdentityOf,
  identityEmail,
  linkGoogleAccount,
  oauthErrorFromLocation,
  signInWithGoogle,
  unlinkGoogleAccount,
} from "@/lib/googleAuth";

const identity = (provider: string, email?: string): UserIdentity =>
  ({
    id: `${provider}-id`,
    identity_id: `${provider}-identity`,
    user_id: "u1",
    provider,
    identity_data: email ? { email } : {},
    created_at: "",
    last_sign_in_at: "",
    updated_at: "",
  }) as UserIdentity;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isNative.value = false;
  window.history.replaceState(null, "", "/login");
});

describe("oauthErrorFromLocation", () => {
  it("returns null when the URL carries no error", () => {
    expect(oauthErrorFromLocation()).toBeNull();
  });

  it("reads error_description from the query string and strips it", () => {
    window.history.replaceState(null, "", "/login?error=access_denied&error_description=User+said+no&keep=1");
    expect(oauthErrorFromLocation()).toBe("User said no");
    expect(window.location.search).toBe("?keep=1");
  });

  it("reads the error from the hash, the shape GoTrue uses for implicit failures", () => {
    window.history.replaceState(null, "", "/login#error=server_error&error_code=500&error_description=Unexpected%20failure");
    expect(oauthErrorFromLocation()).toBe("Unexpected failure");
    expect(window.location.hash).toBe("");
  });

  it("falls back to the error code when there is no description", () => {
    window.history.replaceState(null, "", "/login?error=access_denied");
    expect(oauthErrorFromLocation()).toBe("access_denied");
  });
});

describe("googleIdentityOf / identityEmail", () => {
  it("finds the Google identity and its address", () => {
    const google = identity("google", "me@gmail.com");
    expect(googleIdentityOf([identity("email", "me@co.in"), google])).toBe(google);
    expect(identityEmail(google)).toBe("me@gmail.com");
  });

  it("answers null when there is none", () => {
    expect(googleIdentityOf([identity("email")])).toBeNull();
    expect(googleIdentityOf(null)).toBeNull();
    expect(identityEmail(null)).toBeNull();
  });
});

describe("signInWithGoogle", () => {
  it("on the web starts GoTrue's redirect flow back to the given path", async () => {
    mocks.auth.signInWithOAuth.mockResolvedValue({ data: { url: "x" }, error: null });
    const result = await signInWithGoogle({ webClientId: "web-id", redirectPath: "/register" });
    expect(result).toEqual({ session: null, cancelled: false });
    expect(mocks.auth.signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "google",
        options: expect.objectContaining({ redirectTo: `${window.location.origin}/register` }),
      }),
    );
    expect(mocks.getGoogleIdToken).not.toHaveBeenCalled();
  });

  it("on the device exchanges the id token for a session", async () => {
    mocks.isNative.value = true;
    mocks.getGoogleIdToken.mockResolvedValue({ idToken: "tok", email: "me@gmail.com" });
    mocks.auth.signInWithIdToken.mockResolvedValue({ data: { session: { user: { id: "u1" } } }, error: null });
    const result = await signInWithGoogle({ webClientId: "web-id", redirectPath: "/login" });
    expect(mocks.getGoogleIdToken).toHaveBeenCalledWith("web-id");
    expect(mocks.auth.signInWithIdToken).toHaveBeenCalledWith({ provider: "google", token: "tok" });
    expect(result.cancelled).toBe(false);
    expect(result.session?.user.id).toBe("u1");
    expect(mocks.auth.signInWithOAuth).not.toHaveBeenCalled();
  });

  it("reports a dismissed account picker as cancelled, not as an error", async () => {
    mocks.isNative.value = true;
    mocks.getGoogleIdToken.mockResolvedValue(null);
    expect(await signInWithGoogle({ webClientId: "web-id", redirectPath: "/login" })).toEqual({
      session: null,
      cancelled: true,
    });
    expect(mocks.auth.signInWithIdToken).not.toHaveBeenCalled();
  });

  it("throws GoTrue's error so the caller can translate it", async () => {
    mocks.isNative.value = true;
    mocks.getGoogleIdToken.mockResolvedValue({ idToken: "tok", email: null });
    mocks.auth.signInWithIdToken.mockResolvedValue({ data: { session: null }, error: new Error("Bad ID token") });
    await expect(signInWithGoogle({ webClientId: "web-id", redirectPath: "/login" })).rejects.toThrow("Bad ID token");
  });
});

describe("linkGoogleAccount", () => {
  it("on the device hands the id token to the link-google function", async () => {
    mocks.isNative.value = true;
    mocks.getGoogleIdToken.mockResolvedValue({ idToken: "tok", email: "me@gmail.com" });
    mocks.functions.invoke.mockResolvedValue({ data: { ok: true, email: "me@gmail.com" }, error: null });
    const result = await linkGoogleAccount({ webClientId: "web-id" });
    expect(mocks.functions.invoke).toHaveBeenCalledWith("link-google", { body: { idToken: "tok" } });
    expect(result).toEqual({ email: "me@gmail.com", redirected: false, cancelled: false });
  });

  it("surfaces the function's own message when it declines", async () => {
    mocks.isNative.value = true;
    mocks.getGoogleIdToken.mockResolvedValue({ idToken: "tok", email: null });
    mocks.functions.invoke.mockResolvedValue({
      data: { ok: false, error: "That Google account is already connected to another CatalogShare account." },
      error: null,
    });
    await expect(linkGoogleAccount({ webClientId: "web-id" })).rejects.toThrow(/already connected/);
  });

  it("on the web uses GoTrue's link redirect back to the account screen", async () => {
    mocks.auth.linkIdentity.mockResolvedValue({ data: {}, error: null });
    const result = await linkGoogleAccount({ webClientId: "web-id" });
    expect(result).toEqual({ email: null, redirected: true, cancelled: false });
    expect(mocks.auth.linkIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "google",
        options: expect.objectContaining({ redirectTo: `${window.location.origin}/account` }),
      }),
    );
    expect(mocks.functions.invoke).not.toHaveBeenCalled();
  });
});

describe("unlinkGoogleAccount", () => {
  it("unlinks exactly the Google identity", async () => {
    const google = identity("google", "me@gmail.com");
    mocks.auth.getUserIdentities.mockResolvedValue({ data: { identities: [identity("email"), google] }, error: null });
    mocks.auth.unlinkIdentity.mockResolvedValue({ data: {}, error: null });
    await unlinkGoogleAccount();
    expect(mocks.auth.unlinkIdentity).toHaveBeenCalledWith(google);
  });

  it("refuses when nothing is connected", async () => {
    mocks.auth.getUserIdentities.mockResolvedValue({ data: { identities: [identity("email")] }, error: null });
    await expect(unlinkGoogleAccount()).rejects.toThrow(/No Google account/);
    expect(mocks.auth.unlinkIdentity).not.toHaveBeenCalled();
  });
});
