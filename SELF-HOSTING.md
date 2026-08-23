# Moving off Supabase

**The migration is done.** As of 22 Aug 2026 the app runs entirely on the
self-hosted backend at 103.233.65.233. Supabase is no longer in the request
path — the shipped bundle contains zero references to `supabase.co`.

Migrated: 43 accounts, 14 companies, 85 products, 30 invoices, 29 subscriptions,
2,584 analytics events, 6 suggestions, 18 surveys, and 77 image files.

**Every account was issued a new password.** Supabase does not export bcrypt
hashes to a service_role key, so they could not come across. The list is in
`supabase-export/PASSWORDS.txt` (gitignored) — hand them out, then wire SMTP so
people can reset their own.

The Supabase project is untouched and is the rollback: restore the two values
from `.env.supabase-backup` and rebuild.

---

## What is running

| Piece | What replaced it | Where |
|---|---|---|
| Database | System PostgreSQL 16, database `catalogshare` | `127.0.0.1:5432` |
| Auth | GoTrue `v2.177.0` (the same service Supabase runs) | `127.0.0.1:9999` |
| Data API | PostgREST `v12.2.3` (ditto) | `127.0.0.1:3002` |
| Storage | Purpose-built Node service + nginx (uploads, list, remove; reads off disk) | `127.0.0.1:5013` |
| Backups | `pg_dump` + uploads, nightly at 02:30 | `/var/backups/catalogshare` |
| Public entry | nginx on the existing certificate | `https://app.catalogshare.online/backend` |

Both services are `network_mode: host` and bind **loopback only**, so nothing is
reachable from the internet except through nginx. Compose file and secrets live
in `/opt/catalogshare-backend/`.

There is no separate `api.` hostname on purpose: that needs a DNS record and a
second certificate. `supabase-js` builds `${url}/auth/v1/…` and
`${url}/rest/v1/…`, so pointing it at `…/backend` lands on the right services,
and being same-origin removes CORS preflights entirely.

### Verified end to end

Against the public URL, not just locally:

- `POST /backend/auth/v1/signup` creates a user, `role: authenticated`
- `POST /backend/auth/v1/token?grant_type=password` issues a JWT
- That JWT reaches `auth.uid()` inside RLS — `companies` correctly returns `[]`
  for a user who owns none
- `validate_coupon` runs as the signed-in user and answers correctly
- `credit_ad_reward` is **permission denied** for both `anon` and
  `authenticated`. It mints currency; only `service_role` may call it.

### Schema

All 26 migrations plus the three new ones applied: 17 tables, the
`wallet_balances` view, and all 12 functions the app calls by name. Every column
that was missing from the Supabase project — `invoices.advance_payment`,
`invoices.updated_at`, `invoices.deleted_at`, `companies.trial_started_at` — is
present here. **Estimate sync works against this database out of the box.**

Four things Supabase provided implicitly had to be recreated (`supabase/`
migrations assume them): the `storage` schema, the `supabase_realtime`
publication, a legacy `password_reset_otps` table, and `auth.uid()` /
`auth.role()` in a form that reads *both* the legacy and JSON JWT claim GUCs.

One real bug surfaced while doing it: `20260304000001_company_analytics_rls.sql`
writes a policy against `companies.user_id`, a column that does not exist — the
column is `owner_id`. That migration therefore failed on Supabase too, which
means **company owners have never been able to read their own analytics**; only
master admins could. The corrected policy is applied on the self-hosted
database.

---

## What still depends on Supabase

Do not switch until these are dealt with.

### 1. Merchant accounts — the blocker
14 merchants exist only in the Supabase project. Migrating them needs the
`service_role` key or the database password so the `auth.users` rows (including
the bcrypt password hashes, which transfer as-is) can be exported.

Without that, the options are: everyone re-registers, or accounts are recreated
and everyone resets their password — and password reset needs SMTP, see below.

### 2. Storage — DONE
A purpose-built replacement is running (`supabase/selfhost-storage-server.mjs`,
deployed to `/opt/catalogshare-storage/server.mjs`). The app uses one public
bucket and four operations — `.upload()`, `.getPublicUrl()`, and from the
account-deletion function `.list()` and `.remove()`. getPublicUrl never hits
the network, and reads come straight off disk via nginx — so this is a few
hundred lines rather than the full `storage-api` container, which brings S3
abstraction, image transformation and multi-tenancy to serve "write a file,
serve it back".

**Two things broke photo uploads after the move, both fixed 23 Aug 2026:**

1. supabase-js sends a `File`/`Blob` as **multipart/form-data** (a
   `cacheControl` field plus the file in an unnamed part), not as the raw body.
   The first version of the service wrote the request body to disk verbatim, so
   every photo chosen in the app would have been stored inside its multipart
   envelope and served back broken. The service now parses the envelope (and
   still accepts a raw body for ArrayBuffer uploads and curl).
2. storage-js adds an `x-upsert` header to every upload. The Android app runs
   from `https://localhost`, so the WebView preflights the upload, and nginx's
   `Access-Control-Allow-Headers` did not name `x-upsert` — the WebView dropped
   the POST before sending it and the app reported "check your connection".
   The access log is the tell: an `OPTIONS` for the object with no `POST` after
   it. The allowed-header list now lives in one `$cors_allow_headers` variable
   in the nginx config and covers everything supabase-js sends.

Verified against the live URL through the real supabase-js client
(`src/test/storageServer.test.ts` does the same against a local instance):
anonymous upload rejected (401), multipart upload stored byte-identical, public
read returns the bytes, duplicate refused unless `upsert`, path traversal
refused, `.html` refused, list/remove work. That `.html` rule matters — the
bucket is served from our own origin, so an uploadable HTML or crafted SVG would
be stored XSS on app.catalogshare.online.

The 77 files that were on Supabase's CDN were copied across by
`scripts/migrate-storage.mjs`; nothing is served from Supabase any more.

### 3. Edge functions
Five are called from the client and must be re-hosted as small Node services:
`create-razorpay-order`, `verify-razorpay-payment`, `send-emails`,
`delete-company`, `delete-own-account`. Plus `check-expired-subscriptions` on a
timer. The AdMob SSV endpoint is already self-hosted and is the pattern to copy.

### 3a. AdMob rewarded ads — the SSV service must point at THIS backend
The rewarded-ad reward is credited only by the server-side-verification callback
(`catalogshare-ssv`, `/opt/catalogshare-ssv/server.mjs`, env `/etc/catalogshare/ssv.env`),
which Google calls after it confirms the ad was watched. That service was left
pointing at the dead Supabase project (`SUPABASE_URL=…supabase.co`) with an empty
service-role key, so **every reward logged "NOT CREDITED — not configured" and no
Coins were ever awarded**. Fixed 23 Aug 2026: `ssv.env` now reads
```
PORT=5010
SUPABASE_URL=http://127.0.0.1:8088          # the internal gateway, NOT the public URL
SUPABASE_SERVICE_ROLE_KEY=<same key as /opt/catalogshare-functions/functions.env>
```
The box cannot reach its own public IP, so the internal gateway is mandatory here
just as it is for the functions host. After editing, `sudo systemctl restart
catalogshare-ssv` — the log should say `supabase configured: true`. Verify a real
credit with `curl -s -X POST http://127.0.0.1:8088/rest/v1/rpc/credit_ad_reward
-H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json'
-d '{"p_transaction_id":"test-1","p_user_id":"<uuid>","p_reward_amount":10}'` → `{"ok":true,…}`.

### 4. SMTP
GoTrue runs with `GOTRUE_MAILER_AUTOCONFIRM=true`, so signup works without
email. That also means **password reset and email confirmation do not work**.
Wire SMTP and turn autoconfirm off in the same change — not before, or new
registrations stall waiting for an email that never arrives.

### 5. Realtime
Not deployed. This is the one gap that costs nothing: the client already falls
back to refreshing on focus, resume, reconnect and a five-minute interval,
because websockets are unreliable on Indian mobile networks anyway.

---

## Switching the app

Two values in `.env`, then rebuild:

```
VITE_SUPABASE_URL="https://app.catalogshare.online/backend"
VITE_SUPABASE_PUBLISHABLE_KEY="<ANON_KEY from /opt/catalogshare-backend/.env>"
```

The anon key is a signed JWT with `role: anon` and is meant to ship in the
client bundle — it grants nothing that RLS does not already allow. The
`service_role` key in that same file must never leave the server.

Roll back by putting the old two values back and rebuilding.

## Operating it

```bash
cd /opt/catalogshare-backend
sudo docker compose ps
sudo docker compose logs auth --tail 50
sudo docker compose restart rest

sudo -u postgres psql -d catalogshare        # direct SQL, no dashboard needed
sudo -u postgres pg_dump catalogshare | gzip > backup.sql.gz
```

## Backups

Running nightly at 02:30 via `catalogshare-backup.timer`: 14 daily database
dumps, 8 weekly snapshots of uploads, and the config/secrets (a restore without
those is a database nothing can connect to). It fails loudly if the dump comes
out suspiciously small — a backup that silently produces a 20-byte file is worse
than no backup, because it looks like one.

```bash
sudo /usr/local/bin/catalogshare-backup     # run one now
ls -lah /var/backups/catalogshare/
```

These live on the same disk as the database, which protects against a bad
migration but not a dead server. Copying them off-box is the next improvement.

---

## Google sign-in

Merchants can sign in (and sign up) with a Google account, on the website and
in the Android app, and an existing email-and-password account can attach a
Google account from **Account → Sign-in methods**. Nothing in the app shows a
Google button until the server is configured, so this can be set up at any
time without a release.

### How the pieces fit

| Surface | Mechanism |
|---|---|
| Website sign-in / sign-up | GoTrue's own OAuth redirect: browser → Google → `https://app.catalogshare.online/backend/auth/v1/callback` → back to the app |
| Android sign-in / sign-up | Google Credential Manager hands the app an **id token**; the app posts it to GoTrue's `grant_type=id_token` |
| Website "connect Google" | GoTrue's link-identity redirect (`GOTRUE_SECURITY_MANUAL_LINKING_ENABLED=true`) |
| Android "connect Google" | The `link-google` function verifies the id token with Google, then calls `admin_link_identity()` as the service role. Google refuses to show its consent page inside a WebView, so the redirect flow is not an option in the app |

An existing email/password account that signs in with a Google account of the
**same, verified** address is linked automatically by GoTrue — no settings
visit needed. The "connect" flow exists for accounts whose Google address is
different.

### Operator steps

1. **Google Cloud Console → APIs & Services → Credentials**, in one project:
   - **OAuth consent screen**: External. While it is in *Testing*, only listed
     test users can sign in; *email* and *profile* scopes do not need
     verification to go to Production.
   - **Create credentials → OAuth client ID → Web application**
     - Authorized JavaScript origin: `https://app.catalogshare.online`
     - Authorized redirect URI: `https://app.catalogshare.online/backend/auth/v1/callback`
     - Keep the **client ID** and **client secret**.
   - **OAuth client ID → Android**, one per signing certificate, package
     `in.catalogshare.app`:
     - Upload key: `2D:03:1F:13:9F:D9:9C:90:1F:1F:74:AB:C6:3A:0C:AD:32:B1:E7:9A`
     - Debug key (local builds): `86:7B:8C:DA:26:83:48:BE:47:A3:02:4E:E9:C3:47:59:E0:10:D2:14`
     - **Play App Signing key** — Play Console → *Test and release → Setup →
       App signing* → SHA-1. Required for the Play Store build even though the
       upload key is registered; without it Credential Manager fails with
       `[28444] Developer console is not set up correctly`.
     The Android clients are only registered with Google; nothing from them is
     pasted anywhere. The app uses the **Web** client id on every platform.
2. **Admin console → Integrations → Google sign-in**: paste the Web client ID
   and client secret. The console also lists every value above with a copy
   button, plus a live "enabled on the server" probe.
3. Wait a minute. `catalogshare-smtp.timer` runs the reconcile script, which
   copies the two values into `/opt/catalogshare-backend/.env`, mirrors the
   client id into `app_settings.auth.google_web_client_id` (what the app reads
   to decide whether to show the button), and restarts GoTrue with the
   provider on. The script only flips the provider on when **both** values are
   present — GoTrue will not start a provider with a blank secret, and a
   half-configured one would take every sign-in down at the next restart.
4. Verify:

   ```bash
   curl -s https://app.catalogshare.online/backend/auth/v1/settings | grep -o '"google":[a-z]*'
   # "google":true
   ```

Changes in Google Cloud can take a few hours to propagate to Credential
Manager on devices; a token that is "for a different app" means the app's
`webClientId` and the server's `GOOGLE_CLIENT_ID` do not match.

### Apply the migration

`supabase/migrations/20260823000000_google_sign_in.sql` seeds the two
`integration_secrets` rows, the public `app_settings.auth` row and the
`admin_link_identity()` function. It is idempotent:

```bash
sudo -u postgres psql -d catalogshare -f 20260823000000_google_sign_in.sql
```

The last SELECT prints a row per object; every status must read `OK`.
