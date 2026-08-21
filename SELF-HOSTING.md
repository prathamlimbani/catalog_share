# Moving off Supabase

A self-hosted backend is **running and verified** on 103.233.65.233. This
document is what it is, what still depends on Supabase, and how to switch.

The app is not pointed at it yet, for one reason: **the 14 existing merchants'
login accounts are still in the Supabase project**, and nothing can move them
without credentials for that project. Switching today means every merchant has
to register again. That is the whole gate — everything else is done.

---

## What is running

| Piece | What replaced it | Where |
|---|---|---|
| Database | System PostgreSQL 16, database `catalogshare` | `127.0.0.1:5432` |
| Auth | GoTrue `v2.177.0` (the same service Supabase runs) | `127.0.0.1:9999` |
| Data API | PostgREST `v12.2.3` (ditto) | `127.0.0.1:3002` |
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

### 2. Storage — product images
One bucket, `product-images`, used for product photos, company logos, UPI QR
codes and invoice PDFs. `storage-api` is not deployed yet, so **new uploads
would fail**. Existing images keep loading, because their URLs point at
Supabase's CDN — which also means deleting the Supabase project breaks every
image already uploaded.

### 3. Edge functions
Five are called from the client and must be re-hosted as small Node services:
`create-razorpay-order`, `verify-razorpay-payment`, `send-emails`,
`delete-company`, `delete-own-account`. Plus `check-expired-subscriptions` on a
timer. The AdMob SSV endpoint is already self-hosted and is the pattern to copy.

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

**Back it up.** Supabase was doing that silently; nothing is doing it now. A
nightly `pg_dump` to a second location is the minimum this needs before it holds
real merchant data.
