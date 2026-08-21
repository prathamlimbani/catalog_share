/**
 * Export everything out of the Supabase project using a secret (service_role)
 * key, and generate the SQL that loads it into the self-hosted database.
 *
 *     SUPABASE_SECRET_KEY=sb_secret_xxx node scripts/export-supabase.mjs
 *
 * Writes two things next to each other in ./supabase-export/:
 *   - <table>.json     the raw rows, which is a real backup in its own right
 *   - load.sql         the SQL to apply to the self-hosted database
 *   - PASSWORDS.txt    the temporary password issued to each account
 *
 * WHY PASSWORDS ARE REISSUED
 * Supabase's admin API deliberately does not return `encrypted_password`, so
 * bcrypt hashes cannot be exported with a service_role key - only with the
 * database password or an sbp_ management token. Every account therefore gets a
 * fresh temporary password, generated here and printed once.
 *
 * User IDs ARE preserved, which is the part that actually matters: every
 * company row points at its owner by UUID, so recreating accounts with new IDs
 * would silently orphan all 14 catalogues from their owners.
 *
 * Nothing is deleted from Supabase. The project remains the rollback.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const URL_BASE = process.env.SUPABASE_URL ?? "https://yoiqsyjitpchkbodkvpa.supabase.co";
const SECRET = process.env.SUPABASE_SECRET_KEY ?? "";
const OUT = "supabase-export";

if (!SECRET) {
  console.error("\nSUPABASE_SECRET_KEY is required (the sb_secret_... value).\n");
  process.exit(1);
}

const headers = { apikey: SECRET, Authorization: `Bearer ${SECRET}` };

/**
 * PostgREST caps a response at 1000 rows, which is exactly how the previous
 * "full backup" silently lost most of the analytics. Page explicitly.
 */
async function fetchAll(table) {
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${URL_BASE}/rest/v1/${table}?select=*&order=id`, {
      headers: { ...headers, Range: `${from}-${from + PAGE - 1}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${table}: HTTP ${res.status} ${body.slice(0, 200)}`);
    }
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

async function fetchUsers() {
  const users = [];
  for (let page = 1; ; page += 1) {
    const res = await fetch(`${URL_BASE}/auth/v1/admin/users?page=${page}&per_page=200`, { headers });
    if (!res.ok) throw new Error(`users: HTTP ${res.status}`);
    const body = await res.json();
    const batch = body.users ?? [];
    users.push(...batch);
    if (batch.length < 200) return users;
  }
}

function quote(s) {
  let tag = "q";
  while (String(s).includes(`$${tag}$`)) tag += "q";
  return `$${tag}$${s}$${tag}$`;
}

const lit = (v) => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) {
    // Postgres array literal. Empty arrays must still be typed or the insert
    // cannot infer the element type.
    if (v.length === 0) return "'{}'";
    if (v.every((x) => x === null || typeof x === "string" || typeof x === "number")) {
      return `ARRAY[${v.map((x) => (x === null ? "NULL" : quote(String(x)))).join(",")}]::text[]`;
    }
    return `${quote(JSON.stringify(v))}::jsonb`;
  }
  if (typeof v === "object") return `${quote(JSON.stringify(v))}::jsonb`;
  return quote(String(v));
};

/** Dependency order: companies reference auth.users, everything else companies. */
const TABLES = [
  "companies",
  "products",
  "user_roles",
  "invoices",
  "subscriptions",
  "suggestions",
  "surveys",
  "analytics_events",
];

/** Target columns that are NOT NULL but absent from the source export. */
const BACKFILL = {
  invoices: ["updated_at"],
};

mkdirSync(OUT, { recursive: true });

console.log(`\nExporting ${URL_BASE}\n`);

const users = await fetchUsers();
writeFileSync(join(OUT, "auth_users.json"), JSON.stringify(users, null, 2));
console.log(`  auth users        ${String(users.length).padStart(6)}`);

const data = {};
for (const t of TABLES) {
  try {
    data[t] = await fetchAll(t);
    writeFileSync(join(OUT, `${t}.json`), JSON.stringify(data[t], null, 2));
    console.log(`  ${t.padEnd(18)}${String(data[t].length).padStart(6)}`);
  } catch (err) {
    data[t] = [];
    console.log(`  ${t.padEnd(18)}  FAILED  ${err.message.slice(0, 120)}`);
  }
}

// -------------------------------------------------------------- invoice numbers
//
// The target enforces UNIQUE (company_id, invoice_number); Supabase does not,
// and the live data has three invoices all numbered INV-0001 for one company.
//
// Renumbering the later ones is the lossy-looking option that actually loses
// nothing. `ON CONFLICT DO NOTHING` would silently discard real invoices, and
// an invoice a customer has already been sent a copy of is not something to
// drop quietly. The oldest keeps the original number, since that is the one
// most likely to have been sent.
{
  const seen = new Map();
  const renumbered = [];
  const rows = (data.invoices ?? []).slice().sort((a, b) =>
    String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
  );
  for (const r of rows) {
    const key = `${r.company_id}|${r.invoice_number}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > 1) {
      const from = r.invoice_number;
      r.invoice_number = `${from}-${n}`;
      renumbered.push({ id: r.id, from, to: r.invoice_number, date: r.invoice_date });
    }
  }
  if (renumbered.length) {
    console.log(`\n  renumbered ${renumbered.length} duplicate invoice number(s):`);
    for (const x of renumbered) console.log(`    ${x.from} -> ${x.to}   (${x.date}, id ${x.id.slice(0, 8)})`);
    writeFileSync(join(OUT, "RENUMBERED-INVOICES.txt"),
      renumbered.map((x) => `${x.id}  ${x.date}  ${x.from} -> ${x.to}`).join("\n") + "\n");
  }
}

// ---------------------------------------------------------------- passwords
const passwords = [];
const userSql = users
  .map((u) => {
    const temp = randomBytes(6).toString("base64url").replace(/[-_]/g, "x");
    passwords.push({ email: u.email ?? "(none)", password: temp, last_sign_in_at: u.last_sign_in_at });
    // crypt(..., gen_salt('bf')) produces exactly the bcrypt format GoTrue
    // expects, so these accounts can sign in immediately without GoTrue ever
    // seeing the plaintext.
    return `  ('00000000-0000-0000-0000-000000000000', ${lit(u.id)}, ${lit(u.email)}, crypt(${quote(temp)}, gen_salt('bf')), ${lit(u.created_at)}, ${lit(u.updated_at)}, ${lit(u.last_sign_in_at)}, ${lit(u.app_metadata ?? {})}, ${lit(u.user_metadata ?? {})})`;
  })
  .join(",\n");

writeFileSync(
  join(OUT, "PASSWORDS.txt"),
  [
    "Temporary passwords for the self-hosted backend.",
    "",
    "Supabase does not export password hashes, so every account was reissued one.",
    "User IDs are unchanged, so each merchant's catalogue is still attached to them.",
    "",
    "Sorted by last sign-in: the ones at the top are the accounts actually in use.",
    "",
    ...passwords
      .sort((a, b) => String(b.last_sign_in_at ?? "").localeCompare(String(a.last_sign_in_at ?? "")))
      .map((p) => `${(p.last_sign_in_at ?? "never").slice(0, 10).padEnd(12)} ${p.email.padEnd(40)} ${p.password}`),
    "",
  ].join("\n"),
);

// ------------------------------------------------------------------- SQL
const parts = [
  `-- Generated by scripts/export-supabase.mjs`,
  `-- Loads the Supabase export into the self-hosted database.`,
  `-- Re-runnable: every insert is ON CONFLICT DO NOTHING.`,
  ``,
  `BEGIN;`,
  ``,
  `-- Accounts first. Everything else references them.`,
  `-- instance_id is NOT optional. GoTrue scopes every user lookup by it, so a`,
  `-- NULL means the password hash is never even reached: the lookup finds`,
  `-- nothing and the API answers "invalid login credentials", which reads as a`,
  `-- wrong password and sends you hunting in entirely the wrong place.`,
  `INSERT INTO auth.users (instance_id, id, email, encrypted_password, created_at, updated_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data)`,
  `VALUES`,
  userSql,
  `ON CONFLICT (id) DO NOTHING;`,
  ``,
  `-- GoTrue refuses to sign a user in whose identity row is missing: the`,
  `-- password check passes and the lookup then fails, which surfaces as`,
  `-- "invalid credentials" and is very hard to diagnose.`,
  `INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, created_at, updated_at)`,
  `SELECT u.id, u.id,`,
  `       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),`,
  `       'email', u.id::text, u.created_at, u.updated_at`,
  `  FROM auth.users u`,
  ` WHERE NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id AND i.provider = 'email')`,
  `ON CONFLICT DO NOTHING;`,
  ``,
  `-- Confirm every address. Password reset needs SMTP, which is not wired up`,
  `-- yet, so an unconfirmed account would be unable to sign in AND unable to`,
  `-- fix itself.`,
  `-- confirmed_at is deliberately NOT set: in current GoTrue it is a GENERATED`,
  `-- column derived from email_confirmed_at, and assigning it fails the whole`,
  `-- transaction.`,
  `UPDATE auth.users SET email_confirmed_at = COALESCE(email_confirmed_at, created_at, now()),`,
  `                      aud = 'authenticated', role = 'authenticated'`,
  ` WHERE email_confirmed_at IS NULL OR aud IS NULL OR role IS NULL;`,
  ``,
];

// json_populate_recordset maps JSON keys to columns BY NAME and silently drops
// keys the target does not have. That matters more than it sounds: the live
// Supabase schema has drifted from this repo's migrations - `subscription_tier`
// on companies exists in no migration file - so a hand-built column list breaks
// on the first such column and would break again on the next one. This is
// immune to drift in both directions: unknown columns are ignored, missing ones
// arrive as NULL.
for (const t of TABLES) {
  const rows = data[t] ?? [];
  if (!rows.length) {
    parts.push(`-- ${t}: no rows`, ``);
    continue;
  }
  const payload = JSON.stringify(rows);
  let tag = "csjson";
  while (payload.includes(`$${tag}$`)) tag += "x";

  // Columns the TARGET requires but the SOURCE has never had.
  //
  // invoices.updated_at is the sync cursor, added by 20260819000000 and NOT
  // NULL - but Supabase never got that migration, so every exported row is
  // missing it. json_populate_recordset writes NULL for an absent key, and a
  // NULL beats the column DEFAULT, so the load fails on the first row.
  //
  // Relaxing the constraint for the duration of the insert and backfilling from
  // created_at is better than making the column nullable for good: the cursor
  // depends on it always being set.
  const backfill = BACKFILL[t];
  if (backfill) {
    for (const col of backfill) {
      parts.push(`ALTER TABLE public.${t} ALTER COLUMN ${col} DROP NOT NULL;`);
    }
  }

  parts.push(
    `INSERT INTO public.${t}`,
    `SELECT * FROM json_populate_recordset(null::public.${t}, $${tag}$${payload}$${tag}$::json)`,
    `ON CONFLICT (id) DO NOTHING;`,
  );

  if (backfill) {
    for (const col of backfill) {
      parts.push(
        `UPDATE public.${t} SET ${col} = COALESCE(${col}, created_at, now()) WHERE ${col} IS NULL;`,
        `ALTER TABLE public.${t} ALTER COLUMN ${col} SET NOT NULL;`,
      );
    }
  }
  parts.push(``);
}

parts.push(`COMMIT;`, ``);
parts.push(
  `SELECT 'auth.users' AS t, count(*)::text FROM auth.users`,
  ...TABLES.map((t) => `UNION ALL SELECT '${t}', count(*)::text FROM public.${t}`),
  `ORDER BY 1;`,
  ``,
);

writeFileSync(join(OUT, "load.sql"), parts.join("\n"));

console.log(`\n  wrote ${OUT}/load.sql and ${OUT}/PASSWORDS.txt`);
console.log(`\n  Nothing was deleted from Supabase - it stays as the rollback.\n`);
