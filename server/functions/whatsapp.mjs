/**
 * WhatsApp delivery through Fast2SMS.
 *
 * API shape, verified against the LIVE API on 2026-08-27 (their published docs
 * differ from it in two places — see notes 3 and 4):
 *
 *     GET https://www.fast2sms.com/dev/whatsapp
 *         ?message_id=<their numeric id for the approved template>
 *         &numbers=<10-digit Indian mobile>
 *         &variables_values=<pipe-separated, positional>
 *     Authorization: <API key>            (a bare header, NOT "Bearer ...")
 *
 *     → { "return": true,  "request_id": "...", "message": ["...sent..."] }
 *     → { "return": false, "errors_keys": [...], "errors": {...}, "message": [...] }
 *
 * Four things about that are easy to get wrong and expensive when you do:
 *
 *  1. `numbers` is a TEN DIGIT INDIAN NUMBER. Not E.164, not +91-prefixed, not
 *     91-prefixed. Sending "919663559022" is a silently different recipient
 *     from "9663559022". `toIndianMobile` below is the only place a number is
 *     allowed to become an API argument.
 *
 *  2. `variables_values` is POSITIONAL. There are no names in it, so a template
 *     whose variables are ordered [otp, minutes] and a caller who passes
 *     {minutes, otp} produce a perfectly deliverable message telling the
 *     merchant their code is "10". That is why the order lives in the database
 *     next to the message_id, and why `renderVariables` reads it from there
 *     rather than trusting the caller's object order.
 *
 *  3. Fast2SMS answers with a `return` boolean, NOT the `status` field their
 *     documentation shows, and `message` comes back as an ARRAY. Both shapes are
 *     accepted below, because a business error (unapproved template, no balance,
 *     a bad number) can arrive as HTTP 200 and checking `res.ok` alone reports
 *     every one of those as a success.
 *
 *  4. `phone_number_id` is OPTIONAL and is NOT Meta's Phone Number ID. Passing
 *     Meta's id (the one on the WABA dashboard) is rejected outright with
 *     "WhatsApp Phone Number ID is invalid or not connected" and nothing sends.
 *     Fast2SMS routes on whichever number the account has connected, so the
 *     parameter is omitted unless someone has explicitly set a Fast2SMS-issued
 *     value. Verified against the live API on 2026-08-27.
 *
 * Adding the payment-reminder and payment-received templates later is an INSERT
 * into `whatsapp_templates`, not a change here.
 */

import { adminClient, env } from "./runtime.mjs";

const ENDPOINT = "https://www.fast2sms.com/dev/whatsapp";

const TEMPLATE_CACHE_MS = 30_000;
let cache = { at: 0, rows: [] };

export function invalidateTemplates() {
  cache = { at: 0, rows: [] };
}

async function loadTemplates() {
  if (cache.rows.length && Date.now() - cache.at < TEMPLATE_CACHE_MS) return cache.rows;
  try {
    const db = adminClient();
    const { data, error } = await db.from("whatsapp_templates").select("*");
    if (error) throw error;
    cache = { at: Date.now(), rows: data ?? [] };
  } catch (err) {
    console.warn("[wa] could not load whatsapp templates:", err.message);
  }
  return cache.rows;
}

export async function getTemplate(purpose) {
  const rows = await loadTemplates();
  return rows.find((r) => r.purpose === purpose) ?? null;
}

/**
 * A ten-digit Indian mobile number, or null.
 *
 * Accepts every shape a person or a database actually holds one in — `+91 96635
 * 59022`, `0919663559022`, `9663559022` — and returns the ten digits Fast2SMS
 * wants. Anything that is not a valid Indian mobile comes back null rather than
 * a best guess: a wrong number here means somebody else's phone receives a code
 * for this account.
 *
 * Indian mobile numbers start 6, 7, 8 or 9. That check is what rejects a
 * landline, a truncated paste, and the "1234567890" someone types to get past a
 * required field.
 */
export function toIndianMobile(raw) {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return null;

  // Strip the country code / trunk prefix, longest first.
  if (digits.length === 13 && digits.startsWith("091")) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);

  if (digits.length !== 10) return null;
  if (!/^[6-9]/.test(digits)) return null;
  return digits;
}

/**
 * Turn a named object into the pipe-separated positional string.
 *
 * Missing values become empty strings rather than the literal "undefined",
 * which is what a naive join produces and what a merchant would then read in
 * their WhatsApp message.
 *
 * A pipe inside a value would shift every later variable along by one, so it is
 * stripped. None of the values sent through here (a code, a number of minutes,
 * a plan name, an amount) can legitimately contain one.
 */
export function renderVariables(template, values) {
  const order = Array.isArray(template?.variables) ? template.variables : [];
  return order
    .map((name) => String(values?.[name] ?? "").replace(/\|/g, " ").trim())
    .join("|");
}

/**
 * Send one templated WhatsApp message.
 *
 * @param {string} purpose  a row in whatsapp_templates ('otp', 'payment_reminder', …)
 * @param {string} phone    any shape; normalised to a 10-digit Indian mobile
 * @param {Record<string,string|number>} values  named, mapped to positions by the template
 *
 * Never throws — the callers are signup, login and payment flows, and none of
 * them should fail because a message could not be delivered.
 */
export async function sendWhatsApp(purpose, phone, values) {
  const apiKey = env("FAST2SMS_API_KEY");
  const phoneNumberId = env("FAST2SMS_PHONE_NUMBER_ID");

  if (!apiKey) {
    return { ok: false, reason: "not_configured", error: "FAST2SMS_API_KEY is not set" };
  }

  const number = toIndianMobile(phone);
  if (!number) {
    return { ok: false, reason: "bad_number", error: "Not a valid 10-digit Indian mobile number" };
  }

  const template = await getTemplate(purpose);
  if (!template) {
    return { ok: false, reason: "no_template", error: `No WhatsApp template for "${purpose}"` };
  }
  // A blank message_id is how the migration marks a template that has been
  // planned but not yet approved by Meta. Firing the request anyway would burn
  // a Fast2SMS call to be told the same thing.
  if (!template.message_id || template.active === false) {
    return {
      ok: false,
      reason: "not_provisioned",
      error: `The "${purpose}" WhatsApp template has no Fast2SMS message id yet`,
    };
  }

  const params = new URLSearchParams({
    message_id: String(template.message_id),
    numbers: number,
  });
  // Only when explicitly configured — see note 4 in the header. An empty value
  // is the normal, working state.
  if (phoneNumberId) params.set("phone_number_id", String(phoneNumberId));
  const variables = renderVariables(template, values);
  if (variables) params.set("variables_values", variables);

  try {
    const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
      method: "GET",
      // A bare key. Fast2SMS does not use the "Bearer" scheme, and adding it
      // produces an authorization failure that reads like a wrong key.
      headers: { Authorization: apiKey, "cache-control": "no-cache" },
    });

    const body = await res.json().catch(() => ({}));

    // `return: false` (their real field) or `status: false` (the documented
    // one) both mean a business error, and both can arrive as HTTP 200.
    // Trusting res.ok alone would count those as delivered.
    const rejected = body?.return === false || body?.status === false;
    if (!res.ok || rejected) {
      // `message` is an array in their error responses and a string in some
      // others; `errors` carries the per-field detail worth logging.
      const raw = body?.message ?? body?.errors ?? `Fast2SMS HTTP ${res.status}`;
      const error = Array.isArray(raw) ? raw.join("; ") : typeof raw === "object" ? JSON.stringify(raw) : String(raw);
      console.error(`[wa] ${purpose} to ${mask(number)} failed:`, error);
      return { ok: false, reason: "provider_error", error };
    }

    return { ok: true, requestId: body?.request_id ?? null };
  } catch (err) {
    console.error(`[wa] ${purpose} to ${mask(number)} threw:`, err?.message ?? err);
    return { ok: false, reason: "network", error: err?.message ?? "Network error" };
  }
}

/**
 * A number safe to write in a log.
 *
 * Logs get pasted into support tickets and shipped to whoever runs the box.
 * The last four digits are enough to match a merchant's "is it going to the
 * number ending 9022?" without recording the number itself.
 */
export function mask(phone) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return `******${digits.slice(-4)}`;
}

/**
 * Whether WhatsApp can send at all right now. For the console's status line.
 *
 * The API key is the only thing actually required — see note 4 in the header.
 */
export function whatsappConfigured() {
  return Boolean(env("FAST2SMS_API_KEY"));
}
