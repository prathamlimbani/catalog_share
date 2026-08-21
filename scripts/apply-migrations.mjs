/**
 * Apply the pending SQL migrations to the live Supabase project.
 *
 * The anon key in .env cannot run DDL, and neither can the service_role key over
 * PostgREST — PostgREST exposes tables and functions, not arbitrary SQL. There
 * are exactly two credentials that can, and this script takes either:
 *
 *   1. A Supabase personal access token (starts `sbp_`), from
 *      https://supabase.com/dashboard/account/tokens
 *      Used against the Management API. This is the easy one.
 *
 *        SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/apply-migrations.mjs
 *
 *   2. The database password, from
 *      Dashboard -> Project Settings -> Database -> Database password
 *      Used with psql. Requires psql on PATH (it is not on Windows by default,
 *      but it IS installed on the app server, so this path is usually run there).
 *
 *        SUPABASE_DB_PASSWORD=xxx node scripts/apply-migrations.mjs
 *
 * Order matters and is fixed below: the monetization tables reference plan ids
 * that only become valid once the first file widens the CHECK constraints.
 *
 * Every file is idempotent, so a partial run is recovered by running again.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? "yoiqsyjitpchkbodkvpa";

/**
 * Dependency order, not alphabetical.
 *   1 widens the plan CHECK constraints and adds the sync columns
 *   2 seeds plan_ad_policy with ids those constraints must already allow
 *   3 seeds the plans table, and its upsert function rewrites those constraints
 */
const FILES = [
  "supabase/APPLY-MISSING-MIGRATIONS.sql",
  "supabase/migrations/20260821000000_monetization.sql",
  "supabase/migrations/20260821010000_plans_table.sql",
];

const token = process.env.SUPABASE_ACCESS_TOKEN ?? "";
const dbPassword = process.env.SUPABASE_DB_PASSWORD ?? "";

function die(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (!token && !dbPassword) {
  die(
    [
      "No credential provided. Set ONE of:",
      "",
      "  SUPABASE_ACCESS_TOKEN=sbp_...   (https://supabase.com/dashboard/account/tokens)",
      "  SUPABASE_DB_PASSWORD=...        (Project Settings -> Database)",
      "",
      "Example:",
      "  SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/apply-migrations.mjs",
    ].join("\n"),
  );
}

const sqlFiles = FILES.map((rel) => {
  const path = resolve(root, rel);
  if (!existsSync(path)) die(`Missing migration file: ${rel}`);
  return { rel, path, sql: readFileSync(path, "utf8") };
});

/**
 * Run one file through the Management API.
 *
 * The endpoint executes the whole body as a single request, which is what we
 * want: these files use DO blocks and dollar-quoted function bodies that a naive
 * split on ";" would tear in half.
 */
async function runViaManagementApi({ rel, sql }) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    },
  );

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} — ${text.slice(0, 800)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return parsed;
}

function runViaPsql({ rel, path }) {
  // The session pooler on 5432 speaks the normal protocol and is reachable from
  // networks that block 5432 to the primary host.
  const host = process.env.SUPABASE_DB_HOST ?? "aws-1-ap-south-1.pooler.supabase.com";
  const user = process.env.SUPABASE_DB_USER ?? `postgres.${PROJECT_REF}`;
  const conn = `postgresql://${user}:${encodeURIComponent(dbPassword)}@${host}:5432/postgres`;

  const result = spawnSync(
    "psql",
    [conn, "-v", "ON_ERROR_STOP=1", "-f", path],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );

  if (result.error) {
    throw new Error(
      `psql could not be run (${result.error.message}). Install postgresql-client, or use SUPABASE_ACCESS_TOKEN instead.`,
    );
  }
  if (result.status !== 0) {
    throw new Error(result.stderr?.slice(0, 1200) || `psql exited ${result.status}`);
  }
  return result.stdout;
}

const mode = token ? "Management API" : "psql";
console.log(`\nApplying ${sqlFiles.length} migrations to ${PROJECT_REF} via ${mode}\n`);

let failed = false;

for (const file of sqlFiles) {
  const label = basename(file.rel);
  process.stdout.write(`  ${label} ... `);
  try {
    const out = token ? await runViaManagementApi(file) : runViaPsql(file);
    console.log("OK");

    // Each file ends with a verification SELECT. Surface it, because "the
    // statement ran" and "the objects exist" are different claims.
    const rows = Array.isArray(out) ? out : null;
    if (rows?.length) {
      for (const row of rows) {
        const name = row.object ?? row.thing ?? Object.values(row)[0];
        const status = row.status ?? Object.values(row)[1];
        if (name && status) {
          console.log(`      ${String(status).padEnd(8)} ${name}`);
          if (String(status) !== "OK") failed = true;
        }
      }
    } else if (typeof out === "string" && out.trim()) {
      console.log(
        out
          .trim()
          .split("\n")
          .slice(-12)
          .map((l) => `      ${l}`)
          .join("\n"),
      );
    }
  } catch (err) {
    failed = true;
    console.log("FAILED");
    console.error(`      ${err.message}\n`);
    // Keep going: the files are independent enough that a later one may still
    // apply, and seeing every failure at once beats one per run.
  }
}

console.log(
  failed
    ? "\nOne or more migrations reported a problem. Everything here is idempotent — fix the cause and run again.\n"
    : "\nAll migrations applied and verified.\n",
);

process.exit(failed ? 1 : 0);
