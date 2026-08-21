/**
 * Move every merchant's ORIGINAL password across from Supabase.
 *
 *     SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/migrate-passwords.mjs
 *   or
 *     SUPABASE_DB_PASSWORD=xxx      node scripts/migrate-passwords.mjs
 *
 * Run it on the server, where psql can reach the local database.
 *
 * WHAT THIS DOES, AND WHY IT IS THE RIGHT ANSWER
 * Nobody can recover a plaintext password - not us, not Supabase, not anyone.
 * They are bcrypt hashes: deliberately one-way, which is the entire point of
 * storing them that way. Asking for "the old passwords" has no answer.
 *
 * But the HASH is all that is needed. Copy the hash and the merchant's existing
 * password keeps working exactly as before. They are never told anything, never
 * asked to reset, and never learn that anything moved. Which is what you
 * actually want.
 *
 * The catch is access: the hash lives in auth.users, which Supabase does not
 * expose through PostgREST at all ("Only the following schemas are exposed:
 * public, graphql_public") and which the admin API deliberately omits. Reading
 * it needs one of exactly two credentials:
 *
 *   - a personal access token (sbp_...) from
 *     https://supabase.com/dashboard/account/tokens, used against the
 *     Management API, which can run arbitrary SQL; or
 *   - the database password, from Project Settings -> Database.
 *
 * A service_role key (sb_secret_...) is NOT enough. It has already been tried.
 *
 * SAFE: it only ever UPDATEs the password of a user that already exists locally
 * and is matched by id. It creates nothing, deletes nothing, and touches no
 * other column. Re-running it is harmless.
 */

import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? "yoiqsyjitpchkbodkvpa";
const TARGET_DB = process.env.TARGET_DB ?? "catalogshare";
const token = process.env.SUPABASE_ACCESS_TOKEN ?? "";
const dbPassword = process.env.SUPABASE_DB_PASSWORD ?? "";
const dryRun = process.argv.includes("--dry-run");

if (!token && !dbPassword) {
  console.error(
    [
      "",
      "Needs ONE of these. A service_role key cannot read password hashes.",
      "",
      "  SUPABASE_ACCESS_TOKEN=sbp_...   https://supabase.com/dashboard/account/tokens",
      "  SUPABASE_DB_PASSWORD=...        Project Settings -> Database",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const QUERY = `
  SELECT id, email, encrypted_password
    FROM auth.users
   WHERE encrypted_password IS NOT NULL
     AND encrypted_password <> ''
     AND deleted_at IS NULL
`;

async function readViaManagementApi() {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: QUERY }),
    },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} - ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function readViaPsql() {
  const host = process.env.SUPABASE_DB_HOST ?? "aws-1-ap-south-1.pooler.supabase.com";
  const user = process.env.SUPABASE_DB_USER ?? `postgres.${PROJECT_REF}`;
  const conn = `postgresql://${user}:${encodeURIComponent(dbPassword)}@${host}:5432/postgres`;
  const r = spawnSync(
    "psql",
    [conn, "-tA", "-F", "", "-c", `${QUERY.replace(/\s+/g, " ")}`],
    { encoding: "utf8" },
  );
  if (r.error) throw new Error(`psql could not run: ${r.error.message}`);
  if (r.status !== 0) throw new Error(r.stderr?.slice(0, 800) || `psql exited ${r.status}`);
  return r.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [id, email, encrypted_password] = line.split("");
      return { id, email, encrypted_password };
    });
}

console.log(`\nReading password hashes from ${PROJECT_REF}\n`);

let rows;
try {
  rows = token ? await readViaManagementApi() : readViaPsql();
} catch (err) {
  console.error(`  FAILED: ${err.message}\n`);
  process.exit(1);
}

const usable = rows.filter((r) => r?.id && r?.encrypted_password?.startsWith("$2"));
console.log(`  ${rows.length} users read, ${usable.length} with a usable bcrypt hash`);

if (usable.length !== rows.length) {
  // Worth saying out loud rather than quietly importing fewer.
  console.log(`  ${rows.length - usable.length} skipped (no hash, or not bcrypt)`);
}

if (dryRun) {
  console.log("\n  Dry run. Re-run without --dry-run to apply.\n");
  process.exit(0);
}

const quote = (s) => {
  let tag = "pw";
  while (String(s).includes(`$${tag}$`)) tag += "x";
  return `$${tag}$${s}$${tag}$`;
};

// Matched on id, not email: a merchant who changed their address on one side
// would otherwise be silently skipped or, worse, matched to the wrong account.
const sql = [
  "BEGIN;",
  ...usable.map(
    (u) =>
      `UPDATE auth.users SET encrypted_password = ${quote(u.encrypted_password)}, updated_at = now() WHERE id = ${quote(u.id)};`,
  ),
  "COMMIT;",
  "",
  "SELECT count(*) AS users_with_original_password FROM auth.users WHERE encrypted_password LIKE '$2%';",
  "",
].join("\n");

const dir = mkdtempSync(join(tmpdir(), "cspw-"));
const file = join(dir, "restore-passwords.sql");
writeFileSync(file, sql, "utf8");

const r = spawnSync(
  "sudo",
  ["-n", "-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-q", "-d", TARGET_DB, "-f", file],
  { encoding: "utf8" },
);

if (r.status !== 0) {
  console.error(`\n  FAILED to apply: ${(r.stderr || "").slice(0, 800)}\n`);
  process.exit(1);
}

console.log(r.stdout.trim());
console.log(
  [
    "",
    `  ${usable.length} accounts restored to their ORIGINAL passwords.`,
    "",
    "  Nobody needs to be told anything - every merchant's existing password",
    "  works again. Delete supabase-export/PASSWORDS.txt; it is now wrong.",
    "",
  ].join("\n"),
);
