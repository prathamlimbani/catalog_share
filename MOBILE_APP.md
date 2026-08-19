# CatalogShare Android — architecture & handover

The website and the Android app are **one codebase, one build pipeline**. There is no second
project to keep in sync. Capacitor 8 wraps the existing Vite bundle in a native shell; anything
that needs to behave differently on device goes through a small, explicit native layer rather than
being sprinkled through the pages.

| | |
|---|---|
| Package name (permanent) | `in.catalogshare.app` |
| minSdk / targetSdk | 24 (Android 7.0) / 36 (Android 16) |
| Web build for the app | `npm run build:app` (Vite `--mode app`) |
| Full release | `npm run android:release` → `.aab` |
| Release runbook | [RELEASE.md](./RELEASE.md) |

---

## 1. The native layer (`src/native/`)

Everything device-specific lives here. Pages import from it; they never call a Capacitor plugin
directly. Each module degrades to a no-op on the web, so the same page code runs in both targets.

| Module | Responsibility |
|---|---|
| `platform.ts` | `isNative` / `isAndroid` / `isAppBuild`. **Never** user-agent sniffing — that breaks on tablets and foldables. |
| `prefs.ts` | Durable key/value on Android SharedPreferences. Also the Supabase auth storage adapter. |
| `net.ts` | Real connectivity, plus `canReachServer()` for captive-portal wifi that reports "connected" but cannot reach the API. |
| `files.ts` | Save / share / WhatsApp. The only correct way to hand a file to the user on Android. |
| `ads.ts` | AdMob. The single place ads are turned on or off. |
| `adsConfig.ts` | **The one file you edit to go live with real AdMob ids.** |
| `bootstrap.ts` | Boot sequence: status bar, keyboard, hardware back button, auth listener, splash. |

### Why the auth session moved off `localStorage`

Android evicts a WebView's `localStorage` under storage pressure. That would silently sign a
merchant out and, worse, orphan the offline estimates keyed to their account. The session now lives
in SharedPreferences via `supabaseStorageAdapter`; the browser build still uses `localStorage`.

---

## 2. Offline estimates

This is the core requirement and the part with the most moving pieces. **Estimates work with no
network at all** — create, edit, number, preview, PDF, share. Everything else is online-only with
an explicit offline state rather than a failure.

```
  UI  ──►  lib/offline/estimates.ts  ──►  IndexedDB          (instant, always succeeds)
                                            │
                                            ├─► outbox
                                            │
                        lib/sync/syncEngine.ts  ──►  Supabase   (when a connection exists)
```

### Local stores (`src/lib/offline/db.ts`)

| Store | Holds |
|---|---|
| `estimates` | Full mirror of `public.invoices` + `_dirty` / `_deleted` / `_syncedAt` / `_localOnly` |
| `products` | Read-only mirror so the item picker works offline |
| `company` | The company row **with the logo inlined as a data URI** |
| `outbox` | Ordered queue of writes waiting for the server |
| `meta` | Sync cursors and the local number counter |

The logo matters more than it sounds: a remote `<img>` inside the PDF capture target renders blank
and stalls html2canvas with no network, so offline PDFs would ship unbranded.

### Numbering

Online estimates keep the familiar `INV-0007`. Offline ones are tagged with a per-device suffix,
`INV-K3F-0007`, so two devices on the same account cannot mint the same number while both are
disconnected. On sync, a unique-violation (`23505`) triggers a renumber-and-retry against the
`next_invoice_number` RPC — the estimate is **never** dropped, and the user is told it was renumbered.

### Conflicts

A locally-modified row always wins until it has been pushed; the pull phase skips `_dirty` rows
entirely. Nothing the user typed is discarded silently.

### What had to change to make this possible

The estimate form previously gated Save on every line item having a real `product_id`, so an
offline user — with an empty product mirror — literally could not save. There is now a **Custom
item** row type (`CUSTOM_ITEM` in `InvoiceForm.tsx`) and the gate is `item.name.trim()`.

---

## 3. Ads — the free/paid split

The contract is one line, in `src/lib/entitlement.ts`:

```ts
adsEnabled: !isPaid
```

Nothing else in the app decides whether ads show. `useEntitlement()` calls
`applyEntitlement(adsEnabled)`, which either initialises AdMob or tears every banner down. The
moment a payment lands, ads disappear — not on the next launch.

**Trial users are on the `free` plan and therefore see ads.** That is the only unambiguous reading
of "ads for free users, none for paid users"; if you want trial users ad-free, change
`adsEnabled` in `entitlement.ts` to `!isPaid && !trialActive` and nothing else.

Ads never appear on: the PDF/preview screen, anywhere in the payment or receipt flow, the legal
pages, the More tab, or the trial-expired lock screen.

Interstitials are capped at one per 3 saved estimates, minimum 90 s apart, never in the first 30 s
after launch (`AD_FREQUENCY` in `adsConfig.ts`). This app is a work tool and Play rejects apps whose
ads interrupt the task the user opened them to do.

### Offline entitlement

The plan is cached in SharedPreferences and honoured offline for up to 7 days past the last
successful fetch — never past the actual subscription expiry. A paying merchant on a flight does
not suddenly start seeing ads; someone who turns off mobile data does not get a free permanent
upgrade.

---

## 4. Entitlement — one source of truth

Before this there were **eight** different plan checks scattered across the app, and they
disagreed. A ₹499 `support` subscriber was locked out of Call Support and Premium Skins and was
labelled "Free Plan" in emails. Every gate now routes through `getEntitlement()`:

```
plan · planName · isPaid · expiresAt · daysRemaining
adsEnabled · estimatesUnlocked · trialActive · trialMsRemaining
productLimit · premiumThemes · premiumSkins · supportPhoneUnlocked
```

Plan ids, prices and limits live in `src/lib/plans.ts` and nowhere else.

---

## 5. Payment → receipt → download → dashboard

1. **Checkout** — Razorpay, as before (a deliberate product decision for the India market).
2. **Receipt** — `/billing/receipt/:paymentId`. Polls the `subscriptions` row for up to 15 s, since
   the webhook can land after the redirect, then falls back to "we'll email your receipt".
3. **Download** — renders the receipt to a PDF and hands it to the Android share sheet.
4. **Done** → `/dashboard`, with ads already torn down.

### Security work that came with it

The old flow discarded `razorpay_signature`, created no order, computed the amount client-side, and
granted the plan with a browser-issued `UPDATE companies SET subscription_plan…`. Anyone could give
themselves Pro from a console. Also present was a hardcoded backdoor granting a paid plan to a
specific email address — and `companies.email` is owner-editable, so any user could claim it.

- The backdoor is **deleted**.
- `supabase/functions/create-razorpay-order` looks the price up server-side.
- `supabase/functions/verify-razorpay-payment` verifies the HMAC and is the only thing that writes
  the plan, using the service-role key.
- The migration adds a trigger that **rejects** any client write to `subscription_plan`,
  `subscription_expires_at`, `owner_id` or `trial_started_at`.

---

## 6. Navigation & multi-screen

One adaptive shell (`AdminLayout.tsx`), by breakpoint rather than by device, so a foldable that
changes width mid-session simply re-renders into the other layout:

- **< 1024 px** — compact header + fixed bottom tab bar (Estimates · Products · Store · Billing · More)
- **≥ 1024 px** — persistent left sidebar, no tab bar

Supporting fixes: `viewport-fit=cover` (without it every `env(safe-area-inset-*)` rule resolved to
0), `100dvh` instead of `100vh`, an `xs` breakpoint that was used but never defined, and
`adjustResize` + `resizeableActivity` on the Activity for split-screen and rotation.

---

## 7. Legal pages

Each exists **twice** — in-app for the user, and as a standalone static page because Play requires
URLs reachable without installing the app.

| Document | In-app | Public URL |
|---|---|---|
| Terms & Conditions | `/terms` | `/legal/terms.html` |
| Privacy Policy | `/privacy` | `/legal/privacy.html` |
| Return & Refund | `/refund` | `/legal/refund.html` |
| Account Deletion | `/account-deletion` | `/legal/account-deletion.html` |

Account deletion is a real flow, not just a policy page: type `DELETE` to confirm, then
`delete-own-account` removes storage objects, products, invoices, analytics, the company row and
the auth user. It resolves the target purely from the verified JWT and never reads a user id from
the request body.

---

## 8. What YOU still have to do

Ordered by what blocks a Play release.

### Blocking

1. **Run the base migration.**
   `supabase/migrations/20260819000000_mobile_app_sync_and_plans.sql` — adds `invoices.updated_at`
   (the sync cursor), `companies.trial_started_at`, the real plan ids, the atomic
   `next_invoice_number` RPC, and drops the `password_reset_otps` table whose SELECT policy was
   `USING (true)` for anon (i.e. anyone could read every password-reset code).
   Until it runs, sync falls back to full pulls and ₹399/₹499 keep being stored as growth/pro.

2. **Deploy the edge functions:**
   ```
   supabase functions deploy create-razorpay-order
   supabase functions deploy verify-razorpay-payment
   supabase functions deploy delete-own-account
   ```
   Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` as function secrets.

3. **Make one real test payment**, confirm the plan activates, then run the SECOND migration:
   `supabase/migrations/20260819000001_lock_subscription_columns.sql`.

   > **Order matters here.** That migration installs a trigger making the edge function the only
   > thing that can grant a paid plan. The app calls `verify-razorpay-payment` first and falls
   > back to a direct client write if it is unreachable — so applying the lock before deploying
   > the function would take real money and fail to activate the plan.

4. **Publish the legal pages** at `https://catalogshare.online/legal/…` — they are in `public/`, so
   deploying the site is enough.

5. **Back up the upload keystore.** `C:\catalogshare-keys\catalogshare-upload.jks`. If you lose it
   and have not enabled Play App Signing, you can never update the app again. Enable Play App
   Signing during your first upload.

### Before you start earning from ads

6. **Real AdMob ids** — create the app + one banner + one interstitial unit in AdMob, paste the
   three ids into `src/native/adsConfig.ts`, set `USE_LIVE_ADS = true`, then run
   `npm run android:manifest-ids` (it copies the App ID into the manifest so the two cannot drift —
   a mismatch there hard-crashes the app at launch).

   Until then the app serves Google's official **test** ads: real creatives, zero revenue, and no
   risk of an AdMob policy strike while you are testing.

### Worth doing soon

7. **App Links** — publish `/.well-known/assetlinks.json` with the SHA-256 of your *Play App
   Signing* certificate so shared store links open in the app. Verify with
   `adb shell pm get-app-links in.catalogshare.app`.

8. **`Pricing.tsx` still advertises only Free/₹199/₹349** while the app sells ₹399 and ₹499, and the
   ₹499 card claims "Monthly auto pay through Razorpay" when the code takes a one-time charge with a
   hardcoded 30-day expiry and no mandate. That is a mis-selling exposure — fix the copy or
   implement Razorpay Subscriptions.

9. **Remaining server-side hardening** (not app-blocking, but real):
   - `send-emails` has no authentication and unescaped interpolation — an open branded-email relay
     on a verified domain.
   - Storage UPDATE/DELETE policies are scoped only by `bucket_id`, so any authenticated seller can
     overwrite another seller's **UPI QR code** at the deterministic path `qr/{owner_id}.{ext}`.
   - `check-expired-subscriptions` is unauthenticated and its anon JWT is committed in a migration.

---

## 9. Commands

```bash
npm run dev                  # website dev server
npm run typecheck            # tsc --noEmit
npm test                     # vitest

npm run build                # website bundle
npm run build:app            # app bundle (strips the master-admin console)
npm run cap:sync             # build:app + copy into android/

npm run android:debug        # installable debug APK
npm run android:release      # signed .aab for Play
npm run android:apk          # signed .apk for sideloading / testing
npm run android:manifest-ids # sync the AdMob App ID into AndroidManifest.xml
```

The app build is not just the website build with a different name: `--mode app` aliases the
platform-owner console to a stub, so its bundle, the recharts dependency, the admin RPC names and
its one-tap destructive actions never ship inside the APK.
