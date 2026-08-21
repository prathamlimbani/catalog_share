# Data audit — 21 August 2026

Sources cross-checked:
- `full-database-backup-2026-08-21T13-46-45-624Z.json` (Supabase export, **anon** key)
- `Master_Data_Export_2026-08-21.xlsx` (master admin Excel export)
- `catalogshare_snapshot` on 103.233.65.233 (what was loaded from the above)

## Verdict

Structurally the data is sound. **No duplicate IDs, no orphaned records, no
broken references, no unparseable dates** across all four sheets. Where the two
exports overlap they agree exactly — 14 companies, 85 products, 18 surveys.

Two real problems, one of them urgent, and both are about *coverage and content*
rather than corruption.

---

## 🔴 Urgent — profanity on a live public storefront

```
https://app.catalogshare.online/store/1234567890   → HTTP 200, publicly reachable
```

| Field | Value |
|---|---|
| Company | `1234567890` (name is just digits) |
| Company ID | `e4a076e0-b8d7-4aa6-b14a-c7ee409de66c` |
| Owner email | dhairyaaptel709.30@gmail.com |
| Created | 19 Aug 2026, 03:04 |
| Product | name `demo`, **category `lund`**, price 500 |
| Product ID | `bd8409a0-104e-4b98-a5c7-1935378e6db0` |

`lund` is Hindi profanity. It is a product *category*, so it renders as a
visible heading on the public storefront, and the same storefront is reachable
on the old Vercel domain too.

**Why this matters right now:** you are about to submit to Google Play, and the
content rating declares user-generated content. A reviewer who opens a
storefront link and finds this can fail the submission on inappropriate content.

**Suggested fix** — delete the whole test account. Run in the Supabase SQL editor:
```sql
-- Check first
select id, name, slug from public.companies
where id = 'e4a076e0-b8d7-4aa6-b14a-c7ee409de66c';

-- Then delete; products cascade
delete from public.companies
where id = 'e4a076e0-b8d7-4aa6-b14a-c7ee409de66c';
```
Also delete the matching auth user for dhairyaaptel709.30@gmail.com from
Authentication → Users, or the account will simply recreate a company.

**Worth doing beyond this one row:** a category/product-name blocklist at
insert time. This got published because nothing validates the field.

### Also placeholder, but harmless
- `Toolscope` has a product literally named **"Sample"** (`3f8ac84e…`), category `pen`, marked **Trending**. Being trending means it is surfaced prominently. Probably wants deleting.
- `demo app account` and `spectrum studio` have zero products — empty storefronts.

---

## 🟠 Important — both exports are incomplete, in different ways

Neither file is a full backup. Together they are still missing data.

| Table | JSON (anon key) | Excel | Truth |
|---|---|---|---|
| companies | 14 | 14 | ✅ complete |
| products | 85 | 85 | ✅ complete |
| surveys | 18 | 18 | ✅ complete |
| suggestions | 6 | *no sheet* | ✅ complete (JSON only) |
| analytics_events | **0** | **1000** | ⚠️ capped |
| auth users | **0** | *no sheet* | ❌ **missing entirely** |
| user_roles | **0** | *no sheet* | ❌ **missing entirely** |
| subscriptions | **0** | *no sheet* | ❌ **missing entirely** |
| invoices | **0** | *no sheet* | ❌ **missing entirely** |

**The analytics cap:** the Excel returned exactly 1000 rows — PostgREST's default
limit. It kept the *newest* events (2026-04-11 → 2026-08-21), so everything
before 11 April is absent. To get the rest, page the export with
`.range(0, 999)`, `.range(1000, 1999)` … or raise the limit.

**The missing tables:** the JSON was taken with the anon key, so RLS filtered out
everything the anonymous role cannot read. Those tables are not empty in
Supabase — they were simply invisible to the exporter. **You currently have no
backup of your user accounts, roles, subscriptions or invoices.** Re-run the
export with the `service_role` key, or take a real `pg_dump` from
Supabase → Settings → Database.

---

## 🟢 Checked and fine

- **Referential integrity** — every product's store slug resolves to a real company. No orphans.
- **IDs** — 1,117 IDs checked across four sheets, all unique, all valid UUIDs.
- **Dates** — all 1,000 analytics timestamps parsed cleanly.
- **Prices of ₹0 are not an error.** 63 of 85 products are at zero, which looks alarming until you group by company: SRI VIJAYALAXMI TRADERS is 45/45 and SRI VIJAYALAXMI ENTERPRISE is 5/5. That is a wholesaler quoting on request, not missing data. Left alone.
- **Missing GST / address** — 9 of 14 companies have no GST number and 4 no address. Both are optional fields, so this is adoption, not corruption. Worth prompting for in onboarding if you want GST on invoices.
- **Event mix** — 973 page views, 20 product clicks, 7 WhatsApp clicks. A 2% product click-through and 0.7% WhatsApp conversion is low; worth watching once you have the full history.

## What is on the server now

Database `catalogshare_snapshot` on 103.233.65.233 (role `catalogshare`):

| Table | Rows | From |
|---|---|---|
| `companies` | 14 | JSON |
| `products` | 85 | JSON |
| `suggestions` | 6 | JSON |
| `surveys` | 18 | JSON |
| `analytics_events_export` | 1000 | Excel — recovered, capped |
| `_backup_metadata` | 1 | records the gaps above |

The live app still runs on Supabase; nothing reads this database.
