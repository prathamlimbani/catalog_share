/**
 * publish-legal
 *
 * Regenerates the standalone /legal/*.html pages from the `legal_documents`
 * table.
 *
 * WHY THESE FILES STILL EXIST when the app renders the same documents itself:
 * the URLs https://app.catalogshare.online/legal/privacy.html and its three
 * siblings are registered in Play Console and in the Data Safety form. Google
 * fetches them, and so do people who were sent the link months ago. Serving
 * those from the single-page app would make a legal notice depend on JavaScript
 * executing, which is a bad property for the one page a reviewer is most likely
 * to open with a hostile eye. So they stay static, and this function is what
 * stops them drifting from the database the console edits.
 *
 * WHERE THEY ARE WRITTEN: a directory outside the web release, because
 * scripts/deploy-web.sh atomically swaps the whole site root on every deploy. A
 * file written into the current release would silently revert to the bundled
 * copy the next time the site was deployed - the exact class of bug this whole
 * change is meant to remove. nginx serves /legal/ from the persistent directory
 * with `location ^~`, so it wins over the release directory regardless.
 */

import { writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { corsHeaders, json, adminClient, callerClient, env } from "./runtime.mjs";

const OUT_DIR = env("LEGAL_PUBLISH_DIR", "/var/www/catalogshare-legal");
const SITE = env("PUBLIC_SITE_URL", "https://app.catalogshare.online");

/** The four with a short in-app path. Everything else lives only at /legal/<slug>. */
const SHORT_PATHS = {
  privacy: "/privacy",
  terms: "/terms",
  refund: "/refund",
  "account-deletion": "/account-deletion",
};

// ---------------------------------------------------------------------------
// Sanitising, again, on this side
//
// The React app sanitises before rendering, but nothing of ours runs when nginx
// serves a static file - the browser gets exactly these bytes. So a document
// written by a compromised admin session would execute on our own origin unless
// it is cleaned HERE too. Same allow-list as src/lib/sanitizeHtml.ts.
//
// This is a tokeniser rather than a DOM: Node has no DOMParser and pulling in
// jsdom to clean four documents would be a large dependency in a payment-
// handling process. It is deliberately conservative - anything it cannot parse
// confidently is dropped rather than passed through.
// ---------------------------------------------------------------------------

const ALLOWED_TAGS = new Set([
  "p", "br", "hr", "div", "span",
  "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "strong", "b", "em", "i", "u", "small", "sup", "sub",
  "a", "blockquote", "code", "pre",
  "table", "thead", "tbody", "tr", "th", "td",
]);

const DROP_WITH_CONTENT = new Set([
  "script", "style", "iframe", "object", "embed", "form", "input", "button",
  "select", "textarea", "link", "meta", "base", "svg", "math", "template", "noscript",
]);

const ALLOWED_CLASSES = new Set(["note", "pill", "meta", "docs", "action", "btn", "callout"]);

const ALLOWED_ATTRS = {
  a: new Set(["href", "title", "target", "rel"]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan", "scope"]),
};

const VOID_TAGS = new Set(["br", "hr"]);

function safeHref(raw) {
  const value = String(raw).trim();
  if (!value) return null;
  if (value.startsWith("/") || value.startsWith("#")) return value;
  if (!value.includes(":")) return value;
  const scheme = value.slice(0, value.indexOf(":")).toLowerCase();
  return ["http", "https", "mailto", "tel"].includes(scheme) ? value : null;
}

function escapeAttr(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cleanAttributes(tag, raw) {
  const out = [];
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m;
  while ((m = re.exec(raw))) {
    const name = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? "";

    if (name.startsWith("on")) continue;

    if (name === "class") {
      const kept = value.split(/\s+/).filter((c) => ALLOWED_CLASSES.has(c)).join(" ");
      if (kept) out.push(`class="${escapeAttr(kept)}"`);
      continue;
    }

    if (name === "href" && tag === "a") {
      const href = safeHref(value);
      if (href) out.push(`href="${escapeAttr(href)}"`);
      continue;
    }

    if (ALLOWED_ATTRS[tag]?.has(name)) out.push(`${name}="${escapeAttr(value)}"`);
  }
  return out.length ? " " + out.join(" ") : "";
}

export function sanitizeHtml(html) {
  if (!html) return "";
  let out = "";
  let i = 0;
  /** Names of drop-with-content tags we are currently inside. */
  const skipping = [];

  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      if (!skipping.length) out += html.slice(i);
      break;
    }
    if (!skipping.length) out += html.slice(i, lt);

    const gt = html.indexOf(">", lt);
    if (gt === -1) break; // Unterminated tag: drop the remainder rather than guess.

    const inner = html.slice(lt + 1, gt);
    i = gt + 1;

    // Comments and doctypes carry nothing we want to keep.
    if (inner.startsWith("!")) continue;

    const closing = inner.startsWith("/");
    const nameMatch = /^\/?\s*([a-zA-Z][a-zA-Z0-9]*)/.exec(inner);
    if (!nameMatch) continue;
    const tag = nameMatch[1].toLowerCase();

    if (skipping.length) {
      if (closing && skipping[skipping.length - 1] === tag) skipping.pop();
      else if (!closing && DROP_WITH_CONTENT.has(tag)) skipping.push(tag);
      continue;
    }

    if (DROP_WITH_CONTENT.has(tag)) {
      if (!closing && !inner.trimEnd().endsWith("/")) skipping.push(tag);
      continue;
    }

    if (!ALLOWED_TAGS.has(tag)) continue; // Unwrap: the tag goes, its text stays.

    if (closing) {
      if (!VOID_TAGS.has(tag)) out += `</${tag}>`;
      continue;
    }

    const attrs = cleanAttributes(tag, inner);
    if (VOID_TAGS.has(tag)) out += `<${tag}>`;
    else out += `<${tag}${attrs}>`;
  }

  return out;
}

// ---------------------------------------------------------------------------
// The page template
//
// Lifted verbatim from the hand-written files it replaces, so republishing does
// not restyle a document that nobody edited.
// ---------------------------------------------------------------------------

const STYLE = `<style>
  :root{
    color-scheme: light dark;
    --bg:#fafafa;--fg:#14181f;--card:#ffffff;--muted:#6a7181;--border:#e5e7eb;
    --primary:#f97415;--accent:#fef0e6;--accent-fg:#954004;
  }
  @media (prefers-color-scheme: dark){
    :root{--bg:#0e1015;--fg:#e7ebef;--card:#171a21;--muted:#98a4b3;--border:#303540;
      --primary:#f97a1f;--accent:#492912;--accent-fg:#fac49e;}
  }
  *{box-sizing:border-box}
  html{-webkit-text-size-adjust:100%}
  body{margin:0;background:var(--bg);color:var(--fg);
    font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;
    font-size:16px;line-height:1.6;
    padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right)}
  header{position:sticky;top:0;z-index:10;background:var(--card);border-bottom:1px solid var(--border);
    padding-top:env(safe-area-inset-top)}
  .bar{max-width:46rem;margin:0 auto;padding:.8rem 1rem;display:flex;align-items:baseline;gap:.6rem;flex-wrap:wrap}
  .brand{font-weight:700;color:var(--primary);text-decoration:none;font-size:1rem;
    font-family:'Space Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif}
  h1,h2,h3{font-family:'Space Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif}
  h1{font-size:1.05rem;margin:0;font-weight:600}
  main{max-width:46rem;margin:0 auto;padding:1.5rem 1rem calc(3rem + env(safe-area-inset-bottom))}
  h2{font-size:1.1rem;margin:1.75rem 0 .5rem;font-weight:600}
  h3{font-size:.95rem;margin:1.15rem 0 .35rem;font-weight:600}
  p,li{color:var(--muted);font-size:.95rem}
  p{margin:0 0 .75rem}
  ul,ol{margin:0 0 .85rem;padding-left:1.35rem}
  li{margin-bottom:.4rem}
  li::marker{color:var(--primary)}
  strong{color:var(--fg);font-weight:600}
  a{color:var(--primary)}
  .meta{display:flex;flex-wrap:wrap;gap:.5rem;margin:0 0 1.25rem}
  .pill{background:var(--card);border:1px solid var(--border);border-radius:999px;
    padding:.25rem .7rem;font-size:.75rem;color:var(--muted);font-weight:500}
  .note{background:var(--accent);border:1px solid var(--border);border-left:3px solid var(--primary);
    border-radius:.65rem;padding:.9rem 1rem;margin:0 0 1rem}
  .note p,.note strong{color:var(--accent-fg);margin:0}
  nav.docs{display:flex;flex-wrap:wrap;gap:.35rem 1.15rem;margin-top:1.25rem;font-size:.9rem}
  hr{border:0;border-top:1px solid var(--border);margin:2rem 0}
  footer{color:var(--muted);font-size:.78rem;margin-top:1.25rem}
  @media (max-width:380px){body{font-size:15px}}
</style>`;

function formatDate(value) {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function renderPage(doc, all) {
  const effective = formatDate(doc.effective_date);
  const updated = doc.updated_at
    ? new Date(doc.updated_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : null;

  const pills = [
    effective ? `<span class="pill">Effective date: ${escapeHtml(effective)}</span>` : "",
    updated ? `<span class="pill">Last updated: ${escapeHtml(updated)}</span>` : "",
  ].filter(Boolean).join("\n    ");

  const nav = all
    .map((d) => `    <a href="/legal/${encodeURIComponent(d.slug)}.html">${escapeHtml(d.title)}</a>`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="description" content="${escapeAttr(doc.summary || doc.title)}">
<link rel="canonical" href="${SITE}/legal/${encodeURIComponent(doc.slug)}.html">
<title>${escapeHtml(doc.title)} — CatalogShare</title>
${STYLE}
</head>
<body>
<header>
  <div class="bar">
    <a class="brand" href="${SITE}">CatalogShare</a>
    <h1>${escapeHtml(doc.title)}</h1>
  </div>
</header>
<main>
${pills ? `  <div class="meta">\n    ${pills}\n  </div>\n` : ""}
${sanitizeHtml(doc.body_html)}

  <hr>
  <nav class="docs">
${nav}
  </nav>
  <footer>CatalogShare, India &middot; catalogshare123@gmail.com</footer>
</main>
</body>
</html>
`;
}

export function renderIndex(all) {
  const items = all
    .map(
      (d) =>
        `    <li><a href="/legal/${encodeURIComponent(d.slug)}.html">${escapeHtml(d.title)}</a>` +
        (d.summary ? ` &mdash; ${escapeHtml(d.summary)}` : "") +
        `</li>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="description" content="CatalogShare legal documents.">
<title>Legal — CatalogShare</title>
${STYLE}
</head>
<body>
<header>
  <div class="bar">
    <a class="brand" href="${SITE}">CatalogShare</a>
    <h1>Legal</h1>
  </div>
</header>
<main>
  <p>The documents governing your use of CatalogShare.</p>
  <ul>
${items}
  </ul>
  <footer>CatalogShare, India &middot; catalogshare123@gmail.com</footer>
</main>
</body>
</html>
`;
}

/**
 * Write atomically.
 *
 * A legal page half-written is a legal page that says something nobody
 * approved. Rename is atomic within a filesystem, so a reader gets either the
 * old document or the new one.
 */
async function writeAtomic(path, contents) {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, contents, "utf8");
  await rename(tmp, path);
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseAdmin = adminClient();
    const supabaseCaller = callerClient(req.headers.get("Authorization"));

    const { data: { user: caller } = {}, error: callerError } = await supabaseCaller.auth.getUser();
    if (callerError || !caller) return json({ error: "Unauthorized" }, 401);

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "admin");
    if (!roles || roles.length === 0) return json({ error: "Forbidden: admin role required" }, 403);

    let body = {};
    try {
      body = await req.json();
    } catch {
      // An empty body means "republish everything", which is the useful default
      // for a button labelled exactly that.
    }

    const { data: docs, error } = await supabaseAdmin
      .from("legal_documents")
      .select("slug, title, summary, body_html, effective_date, is_published, updated_at, sort_order")
      .eq("is_published", true)
      .order("sort_order", { ascending: true });

    if (error) return json({ error: `Could not read legal_documents: ${error.message}` }, 500);
    if (!docs?.length) return json({ written: [], note: "No published documents to write." });

    await mkdir(OUT_DIR, { recursive: true });

    // The nav on every page lists every published document, so a single-slug
    // request still needs the full set to render one page correctly.
    const targets = body?.slug ? docs.filter((d) => d.slug === body.slug) : docs;
    if (body?.slug && targets.length === 0) {
      return json({ written: [], note: `"${body.slug}" is not published, so no file was written.` });
    }

    const written = [];
    for (const doc of targets) {
      await writeAtomic(join(OUT_DIR, `${doc.slug}.html`), renderPage(doc, docs));
      written.push(`${doc.slug}.html`);
    }

    // The index lists every document, so it is rebuilt whenever any page is.
    await writeAtomic(join(OUT_DIR, "index.html"), renderIndex(docs));
    written.push("index.html");

    return json({ written, directory: OUT_DIR, shortPaths: SHORT_PATHS });
  } catch (err) {
    return json({ error: err?.message ?? "publish-legal failed" }, 500);
  }
}
