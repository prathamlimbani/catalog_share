/**
 * Email delivery, provider-agnostic.
 *
 * Everything used to go straight to `api.resend.com` with a hardcoded key and a
 * hardcoded From address. That made Resend a single point of failure for
 * password resets, receipts and every admin notification, and switching to the
 * Microsoft 365 mailbox the business already pays for was a code change.
 *
 * Now the accounts live in `email_providers`: one row per mailbox, exactly one
 * marked active, and the rest available as fallbacks. A send tries the active
 * provider first and, only if that fails, walks the others in `sort_order`
 * until one works. That ordering matters — a fallback is for an outage, not a
 * preference, so the active provider is always attempted first even when it is
 * the slowest.
 *
 * TWO TRANSPORTS, on purpose:
 *
 *   'smtp'       — nodemailer, works with M365, Gmail/Workspace, Zoho, SES,
 *                  Brevo, a company mail server, anything.
 *   'resend_api' — Resend's HTTPS API. Kept because outbound port 465/587 is
 *                  blocked by default on a lot of VPS hosts, and an HTTPS call
 *                  goes out where SMTP does not. It is the difference between
 *                  "email works" and a support ticket about firewall rules.
 *
 * The outcome of every attempt is written back to the provider row, so the
 * console can say "M365 last failed at 14:02: 535 auth failed" instead of the
 * operator learning about it from a merchant who never got their receipt.
 */

import { adminClient, env } from "./runtime.mjs";

/**
 * Cache of the provider list.
 *
 * Short, because the whole point is that the console can switch provider and
 * have it take effect without a restart — the same promise `env()` makes for
 * integration secrets. Thirty seconds is under the "within a minute" the
 * console already claims.
 */
const PROVIDER_CACHE_MS = 30_000;
let cache = { at: 0, rows: [] };

/** Force the next send to re-read. Called after the console writes a provider. */
export function invalidateProviders() {
  cache = { at: 0, rows: [] };
}

async function loadProviders() {
  if (cache.rows.length && Date.now() - cache.at < PROVIDER_CACHE_MS) return cache.rows;

  try {
    const db = adminClient();
    const { data, error } = await db
      .from("email_providers")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) throw error;
    cache = { at: Date.now(), rows: data ?? [] };
  } catch (err) {
    // Keep whatever was loaded before rather than blanking it: a failed read
    // must not take email down over a hiccup, which is the same rule
    // refreshSecrets() follows.
    console.warn("[mail] could not load email providers:", err.message);
  }
  return cache.rows;
}

/**
 * The providers to try, in order: active first, then the rest by sort_order.
 *
 * A provider with no password can never send, so it is dropped here rather than
 * attempted and logged as a failure — an operator reading the log should see
 * real problems, not rows they have not filled in yet.
 */
function attemptOrder(rows) {
  const usable = rows.filter(
    (r) => r && r.password && (r.transport === "resend_api" || r.host),
  );
  const active = usable.filter((r) => r.active);
  const rest = usable.filter((r) => !r.active);
  return [...active, ...rest];
}

/**
 * The last-resort provider, built from integration_secrets.
 *
 * Only used when `email_providers` is empty or unreachable — a deployment where
 * this migration has not been applied yet. Without it, applying the code before
 * the SQL would stop every email on the platform.
 */
function legacyProvider() {
  const password = env("SMTP_PASS") || env("RESEND_API_KEY");
  if (!password) return null;
  return {
    id: "legacy",
    label: "integration_secrets",
    host: env("SMTP_HOST", "smtp.resend.com"),
    port: Number(env("SMTP_PORT", "465")) || 465,
    secure: String(env("SMTP_PORT", "465")) === "465",
    username: env("SMTP_USER", "resend"),
    password,
    from_email: env("SMTP_FROM", "noreply@catalogshare.online"),
    from_name: env("SMTP_FROM_NAME", "CatalogShare"),
    reply_to: env("SUPPORT_EMAIL", ""),
    transport: "smtp",
  };
}

function fromHeader(provider) {
  const address = provider.from_email || "noreply@catalogshare.online";
  const name = provider.from_name || "CatalogShare";
  return `${name} <${address}>`;
}

/**
 * nodemailer, imported only when an SMTP provider is actually used.
 *
 * Dynamic for the reason pdf-lib is dynamic in send-emails.mjs: this module
 * shares a process with payment verification, and a static import of a package
 * that has not been installed yet would stop the whole host from booting rather
 * than failing the one branch that needs it. On a box where only the Resend API
 * path is configured, nodemailer never has to be present at all.
 */
let nodemailerModule;
async function getNodemailer() {
  if (!nodemailerModule) nodemailerModule = (await import("nodemailer")).default;
  return nodemailerModule;
}

/** One transporter per provider, keyed by the settings that define it. */
const transporters = new Map();

async function transporterFor(provider) {
  const key = [
    provider.id,
    provider.host,
    provider.port,
    provider.secure,
    provider.username,
    provider.password,
  ].join("|");

  const existing = transporters.get(provider.id);
  if (existing && existing.key === key) return existing.transport;

  const nodemailer = await getNodemailer();
  const transport = nodemailer.createTransport({
    host: provider.host,
    port: Number(provider.port) || 587,
    // Implicit TLS on 465, STARTTLS everywhere else. Getting this backwards is
    // the single most common SMTP misconfiguration and it presents as a hang,
    // not an error, so the port is used as a sanity check on the flag.
    secure: provider.secure === true || Number(provider.port) === 465,
    auth: { user: provider.username, pass: provider.password },
    // M365 in particular is slow to greet; the default 2 minutes would hold a
    // request open long past the point the caller has given up.
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });

  transporters.set(provider.id, { key, transport });
  return transport;
}

async function sendViaSmtp(provider, message) {
  const transport = await transporterFor(provider);
  const info = await transport.sendMail({
    from: fromHeader(provider),
    to: message.to,
    replyTo: message.replyTo || provider.reply_to || undefined,
    subject: message.subject,
    html: message.html,
    text: message.text,
    attachments: (message.attachments ?? []).map((a) => ({
      filename: a.filename,
      // Attachments arrive base64 because that is what the Resend API wants;
      // nodemailer wants bytes, so the encoding is declared rather than the
      // string being passed through as a body.
      content: a.content,
      encoding: "base64",
    })),
  });
  return info.messageId ?? null;
}

async function sendViaResendApi(provider, message) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.password}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromHeader(provider),
      to: Array.isArray(message.to) ? message.to : [message.to],
      reply_to: message.replyTo || provider.reply_to || undefined,
      subject: message.subject,
      html: message.html,
      text: message.text,
      attachments: message.attachments?.length ? message.attachments : undefined,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.message || body?.error?.message || `Resend HTTP ${res.status}`);
  }
  return body.id ?? null;
}

/** Record what happened, so the console can show it. Never throws. */
async function noteOutcome(providerId, error) {
  if (providerId === "legacy") return;
  try {
    const db = adminClient();
    await db
      .from("email_providers")
      .update(
        error
          ? { last_error: String(error).slice(0, 500), last_error_at: new Date().toISOString() }
          : { last_ok_at: new Date().toISOString(), last_error: null },
      )
      .eq("id", providerId);
  } catch {
    /* telemetry must never fail a send that already worked */
  }
}

/**
 * Send one email.
 *
 * @param {{to: string|string[], subject: string, html?: string, text?: string,
 *          replyTo?: string, attachments?: Array<{filename: string, content: string}>}} message
 * @returns {Promise<{ok: boolean, provider?: string, id?: string|null, error?: string,
 *                    tried?: Array<{provider: string, error: string}>}>}
 *
 * Never throws. Email is a side effect of almost everything that calls it —
 * a payment being verified, an account being created — and an email that
 * cannot be sent must not roll back the thing it was reporting on.
 */
export async function sendMail(message) {
  if (!message?.to || !message?.subject) {
    return { ok: false, error: "sendMail needs at least `to` and `subject`" };
  }

  const rows = await loadProviders();
  let order = attemptOrder(rows);

  if (!order.length) {
    const legacy = legacyProvider();
    if (legacy) order = [legacy];
  }

  if (!order.length) {
    return {
      ok: false,
      error:
        "No email provider is configured. Add one under Integrations → Email in the admin console.",
    };
  }

  const tried = [];
  for (const provider of order) {
    try {
      const id =
        provider.transport === "resend_api"
          ? await sendViaResendApi(provider, message)
          : await sendViaSmtp(provider, message);

      void noteOutcome(provider.id, null);
      if (tried.length) {
        // Worth a line in the log: mail went out, but the account the operator
        // chose is broken and they would otherwise never find out.
        console.warn(
          `[mail] sent via fallback "${provider.id}" after ${tried.length} failure(s):`,
          tried.map((t) => `${t.provider}: ${t.error}`).join("; "),
        );
      }
      return { ok: true, provider: provider.id, id, tried };
    } catch (err) {
      const error = err?.message ?? String(err);
      tried.push({ provider: provider.id, error });
      void noteOutcome(provider.id, error);
      // Drop a transporter that failed: an SMTP connection that has gone bad
      // stays bad, and reusing it makes every retry fail the same way.
      transporters.delete(provider.id);
    }
  }

  console.error("[mail] every provider failed:", tried);
  return {
    ok: false,
    error: tried[0]?.error ?? "Email delivery failed",
    tried,
  };
}

/** Whether any provider could send right now. Used by the console's status line. */
export async function mailerReady() {
  const rows = await loadProviders();
  return attemptOrder(rows).length > 0 || legacyProvider() !== null;
}
