/**
 * Work out WHY a request failed, when the browser will only say "Failed to
 * fetch".
 *
 * That message covers DNS failure, a refused connection, a TLS handshake the
 * device would not accept, and a blocked CORS preflight - four completely
 * different problems with completely different fixes. The app reported all of
 * them as "check your internet connection", which sent us hunting in the wrong
 * place more than once: the server was fine and the request was never sent.
 *
 * Each probe is chosen so that its result narrows the cause:
 *
 *   reachable        a plain GET with no custom headers, so no preflight and no
 *                    auth. If this fails, the device cannot reach or trust the
 *                    host at all - DNS, network, or a certificate the device
 *                    rejects.
 *   preflightOk      an OPTIONS with the headers supabase-js sends. If the plain
 *                    GET worked and this did not, CORS is the problem and the
 *                    server needs to answer the preflight.
 *   apiOk            a real authenticated-shaped call. If the first two passed
 *                    and this failed, the backend itself is unhealthy.
 */

const BASE = import.meta.env.VITE_SUPABASE_URL ?? "";

export interface ConnectionReport {
  base: string;
  reachable: boolean;
  preflightOk: boolean;
  apiOk: boolean;
  /** One sentence naming the most likely cause, for a human to act on. */
  diagnosis: string;
  detail: string;
}

async function timed(fn: () => Promise<Response>, ms = 8000): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fn();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkConnection(): Promise<ConnectionReport> {
  const report: ConnectionReport = {
    base: BASE,
    reachable: false,
    preflightOk: false,
    apiOk: false,
    diagnosis: "",
    detail: "",
  };

  if (!BASE) {
    report.diagnosis = "The app was built without a backend URL.";
    report.detail = "VITE_SUPABASE_URL is empty in this build.";
    return report;
  }

  // 1. Can we reach the host at all? No custom headers, so no preflight is
  //    triggered and a failure here is network or TLS, never CORS.
  const health = await timed(() => fetch(`${BASE}/auth/v1/health`, { cache: "no-store" }));
  report.reachable = Boolean(health && health.ok);

  // 2. Does the preflight pass? This is the one that silently broke the app.
  if (report.reachable) {
    const pre = await timed(() =>
      fetch(`${BASE}/auth/v1/token?grant_type=password`, {
        method: "OPTIONS",
        headers: {
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "authorization,apikey,content-type",
        },
      }),
    );
    report.preflightOk = Boolean(pre && (pre.ok || pre.status === 204));
  }

  // 3. Does a real call get through and come back readable?
  if (report.preflightOk) {
    const api = await timed(() =>
      fetch(`${BASE}/rest/v1/plans?select=id&limit=1`, {
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ""}`,
        },
      }),
    );
    report.apiOk = Boolean(api && api.ok);
  }

  if (!report.reachable) {
    report.diagnosis = "This device cannot reach the server.";
    report.detail =
      "No response from " +
      BASE +
      ". Either there is no internet, or this device does not trust the site's security certificate. Open " +
      BASE.replace("/backend", "") +
      " in the phone's browser - if that also fails, it is the connection or the certificate, not the app.";
  } else if (!report.preflightOk) {
    report.diagnosis = "The server is up but is refusing the app's requests.";
    report.detail =
      "The health check succeeded but the CORS preflight did not, so the browser blocks every signed request before sending it. The server needs to answer OPTIONS on /auth/v1/.";
  } else if (!report.apiOk) {
    report.diagnosis = "The server is reachable but the API is not responding correctly.";
    report.detail = "Connection and CORS are fine; the data API returned an error.";
  } else {
    report.diagnosis = "The connection is fine.";
    report.detail =
      "Reachable, CORS fine, API responding. If sign-in still fails, it is the email or password rather than the connection.";
  }

  return report;
}
