/**
 * Host for the ported Supabase Edge Functions.
 *
 * One Node process serving every function, routed by name at
 * /functions/v1/<name> - the exact path supabase-js builds for
 * `functions.invoke("<name>")`, so the client needs no change at all beyond the
 * base URL it was already given.
 *
 * One process rather than one per function because these are low-traffic and
 * share a config surface; six systemd units to hold six mostly-idle Node
 * runtimes would cost about 300MB on a box with 3.6GB free.
 */

import { createServer } from "node:http";
import { corsHeaders, toWebRequest, sendWebResponse, startSecretRefresh, refreshSecrets, secretsAge } from "./runtime.mjs";

import createRazorpayOrder from "./create-razorpay-order.mjs";
import verifyRazorpayPayment from "./verify-razorpay-payment.mjs";
import sendEmails from "./send-emails.mjs";
import deleteCompany from "./delete-company.mjs";
import deleteOwnAccount from "./delete-own-account.mjs";
import checkExpiredSubscriptions from "./check-expired-subscriptions.mjs";
import publishLegal from "./publish-legal.mjs";
import linkGoogle from "./link-google.mjs";

const PORT = Number(process.env.PORT ?? 5014);

const ROUTES = {
  "create-razorpay-order": createRazorpayOrder,
  "verify-razorpay-payment": verifyRazorpayPayment,
  "send-emails": sendEmails,
  "delete-company": deleteCompany,
  "delete-own-account": deleteOwnAccount,
  "check-expired-subscriptions": checkExpiredSubscriptions,
  "publish-legal": publishLegal,
  "link-google": linkGoogle,
};

function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

const server = createServer((req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;

  if (path === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end(`ok: ${Object.keys(ROUTES).join(", ")}\n`);
  }

  // The browser preflights every invoke; answering it here keeps each handler
  // from having to remember to.
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    return res.end();
  }

  // The LAST segment, not the first.
  //
  // A function calling another with supabase-js requests
  // `${SUPABASE_URL}/functions/v1/<name>`, so taking the first segment yields
  // "functions" and 404s - which would have made every email this system sends
  // fail silently, since the callers swallow invoke errors.
  const segments = path.replace(/^\/+|\/+$/g, "").split("/");
  const name = segments[segments.length - 1] ?? "";
  const handler = ROUTES[name];
  if (!handler) {
    res.writeHead(404, { "Content-Type": "application/json", ...corsHeaders });
    return res.end(JSON.stringify({ error: `Unknown function: ${name}` }));
  }

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("error", (err) => {
    log(`[fn] ${name} request error:`, err.message);
    if (!res.headersSent) {
      res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders });
      res.end(JSON.stringify({ error: "Bad request" }));
    }
  });

  req.on("end", async () => {
    const started = Date.now();
    try {
      const webReq = await toWebRequest(req, Buffer.concat(chunks));
      const webRes = await handler(webReq);
      await sendWebResponse(res, webRes);
      log(`[fn] ${name} ${webRes.status} ${Date.now() - started}ms`);
    } catch (err) {
      // A handler that throws must not take the process down with it - these
      // share one runtime, so an unhandled rejection in the email function
      // would stop payments from being verified.
      log(`[fn] ${name} threw:`, err?.stack ?? err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json", ...corsHeaders });
        res.end(JSON.stringify({ error: "Internal error" }));
      }
    }
  });
});

process.on("unhandledRejection", (err) => log("[fn] unhandled rejection:", err));
process.on("uncaughtException", (err) => log("[fn] uncaught exception:", err?.stack ?? err));

startSecretRefresh();

server.listen(PORT, "127.0.0.1", () => {
  log(`[fn] listening on 127.0.0.1:${PORT}`);
  log(`[fn] routes: ${Object.keys(ROUTES).join(", ")}`);
  for (const [k, v] of Object.entries({
    SUPABASE_URL: process.env.SUPABASE_URL,
    RESEND_API_KEY: process.env.RESEND_API_KEY ? "set" : "MISSING",
    RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID ? "set" : "MISSING",
    RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET ? "set" : "MISSING",
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? "set" : "MISSING",
  })) {
    log(`[fn]   ${k}: ${v}`);
  }
});
