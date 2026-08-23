// @vitest-environment node
/**
 * link-google attaches a Google identity to the caller's account, which makes
 * it the one function where a verification slip is an account takeover: skip
 * the audience check and a token minted for any other app opens the door. So
 * every gate is pinned here - caller, issuer, audience, expiry, verified email -
 * plus the exact identity row shape handed to admin_link_identity().
 *
 * runtime.mjs is mocked so no Supabase client is built, and fetch is mocked so
 * Google is never called.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

type RpcArgs = {
  p_user_id: string;
  p_provider: string;
  p_provider_id: string;
  p_identity_data: Record<string, unknown>;
};
type RpcResult = { data: unknown; error: { message: string } | null };
type UserResult = { data: { user: { id: string; email: string } | null }; error: { message: string } | null };

const mocks = vi.hoisted(() => ({
  getUser: vi.fn<() => Promise<UserResult>>(),
  rpc: vi.fn<(fn: string, args: RpcArgs) => Promise<RpcResult>>(),
  secrets: {} as Record<string, string>,
}));

vi.mock("../../server/functions/runtime.mjs", () => ({
  corsHeaders: { "Access-Control-Allow-Origin": "*" },
  json: (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  env: (name: string, fallback?: string) => mocks.secrets[name] ?? fallback,
  callerClient: () => ({ auth: { getUser: mocks.getUser } }),
  adminClient: () => ({ rpc: mocks.rpc }),
}));

import handler from "../../server/functions/link-google.mjs";

const CLIENT_ID = "123-abc.apps.googleusercontent.com";
const CALLER = { id: "11111111-1111-1111-1111-111111111111", email: "owner@example.com" };

/** A token with three dot-separated segments; the content is never decoded locally. */
const TOKEN = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln";

function validClaims(overrides: Record<string, unknown> = {}) {
  return {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    sub: "1029384756",
    email: "Merchant@Gmail.com",
    email_verified: "true",
    exp: String(Math.floor(Date.now() / 1000) + 600),
    name: "Merchant Person",
    given_name: "Merchant",
    family_name: "Person",
    picture: "https://lh3.googleusercontent.com/a/photo",
    ...overrides,
  };
}

function googleAnswers(status: number, body: unknown) {
  const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function request(body: unknown, auth: string | null = "Bearer caller-jwt") {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) headers.Authorization = auth;
  return new Request("http://localhost/functions/v1/link-google", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function call(body: unknown, auth?: string | null) {
  const res = await handler(request(body, auth));
  return { status: res.status, body: (await res.json()) as { ok: boolean; error?: string; email?: string } };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  mocks.getUser.mockReset();
  mocks.rpc.mockReset();
  for (const k of Object.keys(mocks.secrets)) delete mocks.secrets[k];
  mocks.secrets.GOOGLE_CLIENT_ID = CLIENT_ID;
  mocks.getUser.mockResolvedValue({ data: { user: CALLER }, error: null });
  mocks.rpc.mockResolvedValue({ data: { ok: true, already: false }, error: null });
});

describe("who is asking", () => {
  it("answers the preflight", async () => {
    const res = await handler(new Request("http://localhost/x", { method: "OPTIONS" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("rejects a GET", async () => {
    const res = await handler(new Request("http://localhost/x", { method: "GET" }));
    expect(res.status).toBe(405);
  });

  it("returns 401 without an Authorization header", async () => {
    const fetchMock = googleAnswers(200, validClaims());
    const { status, body } = await call({ idToken: TOKEN }, null);
    expect(status).toBe(401);
    expect(body.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the session does not resolve to a user", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: "invalid JWT" } });
    googleAnswers(200, validClaims());
    const { status, body } = await call({ idToken: TOKEN });
    expect(status).toBe(401);
    expect(body.ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("what they are presenting", () => {
  it("refuses when the server has no client id configured", async () => {
    delete mocks.secrets.GOOGLE_CLIENT_ID;
    const fetchMock = googleAnswers(200, validClaims());
    const { status, body } = await call({ idToken: TOKEN });
    expect(status).toBe(200);
    expect(body).toEqual({ ok: false, error: "Google sign-in is not configured on the server yet." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a missing or malformed token without calling Google", async () => {
    const fetchMock = googleAnswers(200, validClaims());
    for (const body of [{}, { idToken: "" }, { idToken: "not-a-jwt" }, "{not json"]) {
      const { status, body: out } = await call(body);
      expect(status).toBe(200);
      expect(out.ok).toBe(false);
      expect(out.error).toMatch(/No Google sign-in/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("reports a token Google rejects as expired", async () => {
    googleAnswers(400, { error: "invalid_token" });
    const { status, body } = await call({ idToken: TOKEN });
    expect(status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/expired/i);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a token for a different audience", async () => {
    googleAnswers(200, validClaims({ aud: "999-other.apps.googleusercontent.com" }));
    const { body } = await call({ idToken: TOKEN });
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/different app/i);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("accepts any id in a comma-separated client id list", async () => {
    mocks.secrets.GOOGLE_CLIENT_ID = `web-1.apps.googleusercontent.com, ${CLIENT_ID}`;
    googleAnswers(200, validClaims());
    const { body } = await call({ idToken: TOKEN });
    expect(body.ok).toBe(true);
  });

  it("refuses a token from a non-Google issuer", async () => {
    googleAnswers(200, validClaims({ iss: "https://evil.example.com" }));
    const { body } = await call({ idToken: TOKEN });
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/did not come from Google/i);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a token whose exp is in the past even if Google answered 200", async () => {
    googleAnswers(200, validClaims({ exp: String(Math.floor(Date.now() / 1000) - 5) }));
    const { body } = await call({ idToken: TOKEN });
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/expired/i);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses an unverified email", async () => {
    googleAnswers(200, validClaims({ email_verified: "false" }));
    const { body } = await call({ idToken: TOKEN });
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/not verified/i);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("treats an unreachable Google as a retryable failure, not a bad token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNRESET");
      }),
    );
    const { status, body } = await call({ idToken: TOKEN });
    expect(status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/reach Google/i);
  });
});

describe("linking", () => {
  it("links the CALLER with the identity row GoTrue would have written", async () => {
    const fetchMock = googleAnswers(200, validClaims());
    const { status, body } = await call({ idToken: TOKEN });

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, email: "merchant@gmail.com", already: false });

    // Google was asked about this exact token, and nothing else was logged.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(TOKEN)}`,
    );

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = mocks.rpc.mock.calls[0];
    expect(fn).toBe("admin_link_identity");
    expect(args.p_user_id).toBe(CALLER.id); // never anything from the body
    expect(args.p_provider).toBe("google");
    expect(args.p_provider_id).toBe("1029384756");
    expect(args.p_identity_data).toEqual({
      iss: "https://accounts.google.com",
      sub: "1029384756",
      email: "merchant@gmail.com",
      email_verified: true,
      phone_verified: false,
      name: "Merchant Person",
      full_name: "Merchant Person",
      given_name: "Merchant",
      family_name: "Person",
      picture: "https://lh3.googleusercontent.com/a/photo",
      avatar_url: "https://lh3.googleusercontent.com/a/photo",
      provider_id: "1029384756",
    });
  });

  it("ignores any userId smuggled into the body", async () => {
    googleAnswers(200, validClaims());
    await call({ idToken: TOKEN, userId: "22222222-2222-2222-2222-222222222222" });
    expect(mocks.rpc.mock.calls[0][1].p_user_id).toBe(CALLER.id);
  });

  it("reports an already-linked identity as ok", async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, already: true }, error: null });
    googleAnswers(200, validClaims());
    const { body } = await call({ idToken: TOKEN });
    expect(body).toEqual({ ok: true, email: "merchant@gmail.com", already: true });
  });

  it("surfaces the database's own sentence when the Google account belongs to someone else", async () => {
    const sentence = "That Google account is already connected to another CatalogShare account.";
    mocks.rpc.mockResolvedValue({ data: null, error: { message: sentence } });
    googleAnswers(200, validClaims());
    const { status, body } = await call({ idToken: TOKEN });
    expect(status).toBe(200);
    expect(body).toEqual({ ok: false, error: sentence });
  });

  it("surfaces the disconnect-first sentence", async () => {
    const sentence = "This account already has a different Google account connected. Disconnect it first.";
    mocks.rpc.mockResolvedValue({ data: null, error: { message: sentence } });
    googleAnswers(200, validClaims());
    const { body } = await call({ idToken: TOKEN });
    expect(body).toEqual({ ok: false, error: sentence });
  });

  it("hides an internal database error behind a generic sentence", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'relation "auth.identities" does not exist' } });
    googleAnswers(200, validClaims());
    const { status, body } = await call({ idToken: TOKEN });
    expect(status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/Could not connect the Google account/);
    expect(body.error).not.toMatch(/relation/);
  });
});
