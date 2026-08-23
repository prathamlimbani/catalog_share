/**
 * Runtime shim that lets the Supabase Edge Functions run on Node with almost no
 * change to their bodies.
 *
 * Deno gives a handler a Web `Request` and expects a Web `Response`. Node 20
 * has both globally (undici), so the handlers keep that exact shape and the
 * port is mostly: swap `Deno.env.get(...)` for `env(...)`, and import
 * `createClient` from the npm package instead of a URL.
 *
 * Keeping the handler signature identical is deliberate. These functions handle
 * payment verification and account deletion; a rewrite would be a rewrite of
 * the security-critical parts, and the point of this move is to change WHERE
 * they run, not WHAT they do.
 */

import { createClient } from "@supabase/supabase-js";

/**
 * A WebSocket for supabase-js to hold, on a Node that has none.
 *
 * None of these functions use realtime. supabase-js builds a RealtimeClient
 * eagerly inside `createClient()` anyway, and from v2.49 it THROWS on Node 20
 * when no global WebSocket exists rather than degrading. Because every handler
 * begins with `adminClient()`, that single throw took down all six functions at
 * once - payment verification, email, account deletion - each surfacing as a
 * generic "Internal server error" that named nothing.
 *
 * Node 22 has a global WebSocket and needs none of this, so the import is
 * skipped there and this whole block disappears the day the host is upgraded.
 */
let wsTransport;
if (typeof globalThis.WebSocket === "undefined") {
  try {
    wsTransport = (await import("ws")).default;
  } catch {
    // Left undefined deliberately: createClient will throw with Google's own
    // explanatory message, which is more useful than one invented here.
    console.warn('[fn] no global WebSocket and the "ws" package is missing - run: npm i ws');
  }
}

/** Merged into every client so the transport decision is made in one place. */
const REALTIME_OPTIONS = wsTransport ? { realtime: { transport: wsTransport } } : {};

/**
 * Credentials loaded from `integration_secrets`, refreshed in the background.
 *
 * Held in a plain map and read synchronously so that `env()` keeps its existing
 * signature: every handler already calls `env("RAZORPAY_KEY_SECRET")` and would
 * otherwise need rewriting to be async. The refresh is what makes the admin
 * console able to change a credential without an SSH session or a restart.
 */
let dbSecrets = {};
let secretsLoadedAt = 0;

const SECRET_REFRESH_MS = 60_000;

/**
 * Read config: database first, then the process environment.
 *
 * The DB wins because it is the surface an operator can actually edit. The env
 * file remains the fallback, so a database that is unreachable at boot leaves
 * payments working on whatever was last deployed rather than failing closed on
 * a config read.
 */
export function env(name, fallback = undefined) {
  const fromDb = dbSecrets[name];
  if (fromDb !== undefined && fromDb !== "") return fromDb;

  const v = process.env[name];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    return undefined;
  }
  return v;
}

/** Pull the credentials in. Safe to call repeatedly. */
export async function refreshSecrets() {
  try {
    const url = process.env.SUPABASE_URL || "http://127.0.0.1:8088";
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!key) return;

    const res = await fetch(`${url}/rest/v1/integration_secrets?select=key,value`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const rows = await res.json();
    const next = {};
    for (const r of rows) if (r?.key) next[r.key] = r.value ?? "";
    dbSecrets = next;
    secretsLoadedAt = Date.now();
  } catch (err) {
    // Keep whatever was loaded before. A failed refresh must never blank a
    // working credential - that would take payments down over a hiccup.
    console.warn("[fn] could not refresh integration secrets:", err.message);
  }
}

export function secretsAge() {
  return secretsLoadedAt ? Date.now() - secretsLoadedAt : null;
}

/** Start the background refresh. Called once by the host. */
export function startSecretRefresh() {
  void refreshSecrets();
  const t = setInterval(() => void refreshSecrets(), SECRET_REFRESH_MS);
  // Do not hold the process open on this alone.
  t.unref?.();
  return () => clearInterval(t);
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders, ...extra },
  });
}

/**
 * The internal origin these functions talk to.
 *
 * Not the public URL: this box cannot reach its own public IP, so a request to
 * app.catalogshare.online from here goes nowhere. nginx serves an internal-only
 * gateway on 127.0.0.1:8088 with the same /rest/v1 and /auth/v1 layout.
 */
export const SUPABASE_URL = env("SUPABASE_URL", "http://127.0.0.1:8088");
export const ANON_KEY = env("SUPABASE_ANON_KEY", "");
export const SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY", "");

/** Full-privilege client. Bypasses RLS - use only where that is intended. */
export function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...REALTIME_OPTIONS,
  });
}

/**
 * A client acting AS the caller, so RLS applies to it.
 *
 * Every function that reads something on the user's behalf must use this, not
 * the admin client: it is what stops one merchant asking a function for another
 * merchant's data.
 */
export function callerClient(authHeader) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader ?? "" } },
    auth: { autoRefreshToken: false, persistSession: false },
    ...REALTIME_OPTIONS,
  });
}

/** Convert a Node request into the Web Request the handlers expect. */
export async function toWebRequest(req, bodyBuffer) {
  const url = `http://localhost${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else if (v !== undefined) headers.set(k, v);
  }
  const init = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD" && bodyBuffer?.length) {
    init.body = bodyBuffer;
  }
  return new Request(url, init);
}

/** Write a Web Response back out through the Node response. */
export async function sendWebResponse(res, webRes) {
  const buf = Buffer.from(await webRes.arrayBuffer());
  const headers = {};
  webRes.headers.forEach((v, k) => {
    headers[k] = v;
  });
  res.writeHead(webRes.status, headers);
  res.end(buf);
}
