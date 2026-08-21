/**
 * Move everything out of the Supabase project into the self-hosted database.
 *
 * Run it ON THE SERVER (103.233.65.233), where it can reach both: Supabase over
 * the internet, and the local `catalogshare` database through psql.
 *
 *     SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/migrate-from-supabase.mjs
 *
 * Get the token from https://supabase.com/dashboard/account/tokens. It is the
 * only thing this needs, and it is the only thing that has been blocking the
 * migration - the anon key cannot read auth.users, by design.
 *
 * Add --dry-run to see the counts without writing anything.
 *
 * WHY PASSWORDS SURVIVE
 * GoTrue stores bcrypt hashes and both sides run GoTrue, so `encrypted_password`
 * copies across verbatim and every merchant keeps the password they already
 * have. That is what turns this from "everyone resets their password" - which
 * would also need SMTP, which is not wired up yet - into a switch nobody
 * notices. It is the single most important line in this file.
 *
 * SAFE TO RE-RUN
 * Every insert is ON CONFLICT DO NOTHING keyed on the primary key, so a partial
 * run is fixed by running again. Nothing is deleted from Supabase; the old
 * project stays intact as the rollback.
 */

import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? "yoiqsyjitpchkbodkvpa";
const TARGET_DB = process.env.TARGET_DB ?? "catalogshare";
const token = process.env.SUPABASE_ACCESS_TOKEN ?? "";
const dryRun = process.argv.includes("--dry-run");

if (!token) {
  console.error(
    [
      "",
      "SUPABASE_ACCESS_TOKEN is required.",
      "  https://supabase.com/dashboard/account/tokens -> Generate new token",
      "",
      "  SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/migrate-from-supabase.mjs",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

/** Run SQL on the SOURCE (Supabase) through the Management API. */
async function source(sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`source query failed: HTTP ${res.status} - ${text.slice(0, 400)}`);
  try {
    return JSON.parse(text);
  } catch {
    return [];
  }
}

/** Run SQL on the TARGET (local) through psql. */
function target(sqlFile) {
  const result = spawnSync(
    "sudo",
    ["-n", "-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-q", "-d", TARGET_DB, "-f", sqlFile],
    { encoding: "utf8" },
  );
  if (result.error) throw new Error(`psql could not run: ${result.error.message}`);
  if (result.status !== 0) throw new Error(result.stderr?.slice(0, 1500) || `psql exited ${result.status}`);
  return result.stdout;
}

const lit = (v) => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return `${quote(JSON.stringify(v))}::jsonb`;
  return quote(String(v));
};

/** Dollar-quoted so a merchant's apostrophe or newline cannot break the file. */
function quote(s) {
  let tag = "q";
  while (s.includes(`$${tag}$`)) tag += "q";
  return `$${tag}$${s}$${tag}$`;
}

/**
 * Tables in dependency order.
 *
 * auth.users first: companies.owner_id references it, and every other table
 * hangs off companies. Getting this order wrong is a wall of foreign key
 * violations rather than a subtle bug, which is the good kind of wrong.
 */
const PLAN = [
  {
    name: "auth.users",
    select: `SELECT id, aud, role, email, encrypted_password, email_confirmed_at,
                    invited_at, confirmation_sent_at, recovery_sent_at,
                    last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
                    is_super_admin, created_at, updated_at, phone,
                    phone_confirmed_at, banned_until, deleted_at
               FROM auth.users WHERE deleted_at IS NULL`,
    into: "auth.users",
    conflict: "(id)",
  },
  { name: "companies",        select: "SELECT * FROM public.companies",        into: "public.companies",        conflict: "(id)" },
  { name: "products",         select: "SELECT * FROM public.products",         into: "public.products",         conflict: "(id)" },
  { name: "user_roles",       select: "SELECT * FROM public.user_roles",       into: "public.user_roles",       conflict: "(id)" },
  { name: "invoices",         select: "SELECT * FROM public.invoices",         into: "public.invoices",         conflict: "(id)" },
  { name: "subscriptions",    select: "SELECT * FROM public.subscriptions",    into: "public.subscriptions",    conflict: "(id)" },
  { name: "suggestions",      select: "SELECT * FROM public.suggestions",      into: "public.suggestions",      conflict: "(id)" },
  { name: "surveys",          select: "SELECT * FROM public.surveys",          into: "public.surveys",          conflict: "(id)" },
  { name: "analytics_events", select: "SELECT * FROM public.analytics_events", into: "public.analytics_events", conflict: "(id)" },
];

console.log(`\nMigrating ${PROJECT_REF} -> local ${TARGET_DB}${dryRun ? "  (dry run)" : ""}\n`);

const dir = mkdtempSync(join(tmpdir(), "csmig-"));
const summary = [];
let failed = false;

for (const step of PLAN) {
  process.stdout.write(`  ${step.name.padEnd(18)} `);
  let rows;
  try {
    rows = await source(step.select);
  } catch (err) {
    console.log(`READ FAILED - ${err.message.slice(0, 160)}`);
    failed = true;
    continue;
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    console.log("0 rows");
    summary.push({ table: step.name, rows: 0, written: 0 });
    continue;
  }

  const columns = Object.keys(rows[0]);
  const values = rows
    .map((r) => `(${columns.map((c) => lit(r[c])).join(", ")})`)
    .join(",\n  ");

  // The target column list is written explicitly so a schema that has gained a
  // column since does not shift every value one place to the left.
  const sql =
    `INSERT INTO ${step.into} (${columns.map((c) => `"${c}"`).join(", ")})\nVALUES\n  ${values}\n` +
    `ON CONFLICT ${step.conflict} DO NOTHING;\n`;

  const file = join(dir, `${step.name.replace(".", "_")}.sql`);
  writeFileSync(file, sql, "utf8");

  if (dryRun) {
    console.log(`${rows.length} rows (not written)`);
    summary.push({ table: step.name, rows: rows.length, written: 0 });
    continue;
  }

  try {
    target(file);
    console.log(`${rows.length} rows -> written`);
    summary.push({ table: step.name, rows: rows.length, written: rows.length });
  } catch (err) {
    console.log(`WRITE FAILED`);
    console.error(`      ${err.message.slice(0, 600)}\n`);
    summary.push({ table: step.name, rows: rows.length, written: 0 });
    failed = true;
    // Keep going: a later table may still import, and seeing every failure in
    // one run beats discovering them one at a time.
  }
}

if (!dryRun) {
  // GoTrue refuses to sign in a user whose identity row is missing, even with a
  // valid password - the password check passes and the lookup then fails, which
  // presents as "invalid credentials" and is extremely hard to diagnose.
  const identities = join(dir, "identities.sql");
  writeFileSync(
    identities,
    `INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
     SELECT u.id, u.id,
            jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
            'email', u.id::text, u.last_sign_in_at, u.created_at, u.updated_at
       FROM auth.users u
      WHERE NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id AND i.provider = 'email')
     ON CONFLICT DO NOTHING;`,
    "utf8",
  );
  process.stdout.write("  auth.identities    ");
  try {
    target(identities);
    console.log("backfilled");
  } catch (err) {
    console.log(`FAILED - ${err.message.slice(0, 200)}`);
    failed = true;
  }
}

console.log("\n  ---");
for (const s of summary) console.log(`  ${s.table.padEnd(18)} ${String(s.rows).padStart(6)} read  ${String(s.written).padStart(6)} written`);

console.log(
  failed
    ? "\nSome steps failed. Nothing was deleted from Supabase - fix the cause and run again.\n"
    : dryRun
      ? "\nDry run complete. Re-run without --dry-run to write.\n"
      : "\nMigration complete. Verify a real merchant can sign in BEFORE switching the app over.\n",
);

process.exit(failed ? 1 : 0);
