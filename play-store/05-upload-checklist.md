# Upload checklist — v1.0.8 (versionCode 9)

## The bundle

| Field | Value |
|---|---|
| File | `release-output/catalogshare-1.0.8-vc9-release.aab` |
| Size | 14.7 MB |
| versionName | 1.0.8 |
| versionCode | **9** (was 8 — Play rejects a re-used or lower code) |
| Package | `in.catalogshare.app` |
| minSdk | 24 (Android 7.0) |
| targetSdk | 36 (Android 16) |
| Signed | ✅ `jar verified` |
| Upload cert | CN=CatalogShare, O=CatalogShare, L=Surat, ST=Gujarat, C=IN — valid to 2054-01-04 |
| Upload cert SHA-256 | `5C:CB:07:24:D0:B7:29:D1:26:04:CE:30:A3:E3:2D:2A:54:A3:2E:B3:4F:8B:E4:14:40:CE:C7:B6:C5:EE:9B:50` |

## Before you upload

- [ ] **Create the demo account** for reviewers (App content → App access). Without it a reviewer sees only a login wall, which is a common rejection.
- [ ] **Create the feature graphic** (1024 × 500) — Play will not publish without it.
- [ ] **Capture phone screenshots** — at least 2, ideally 6.
- [ ] Decide on the AdMob question below.

## After the first upload — App Links

Your Android App Links will not verify until this file exists:
```
https://app.catalogshare.online/.well-known/assetlinks.json
```

It must list the **Play App Signing** certificate SHA-256, *not* the upload
certificate above. Get it from Play Console → Release → Setup → App signing.
Then create `public/.well-known/assetlinks.json`:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "in.catalogshare.app",
    "sha256_cert_fingerprints": ["<PLAY APP SIGNING SHA-256 HERE>"]
  }
}]
```

Redeploy with `bash scripts/deploy-web.sh`, then confirm on a device:
```
adb shell pm get-app-links in.catalogshare.app
```

Note the manifest also still claims `catalogshare.online` and
`www.catalogshare.online` (so previously-shared links keep opening in the app).
**Android verifies every host in the filter as a set** — if those two Vercel
hosts do not also serve a matching assetlinks.json, verification fails for all
of them, including the new one. Either publish the same file on Vercel too, or
drop those two hosts from `AndroidManifest.xml`.

## Two things to decide

### 1. AdMob is still on Google's test IDs
`src/native/adsConfig.ts` has `USE_LIVE_ADS = false` and `LIVE_IDS` full of
placeholder zeros. The app will show **Google test ads and earn nothing**.

This will not get you rejected and will not crash — the manifest and the config
agree, which is the thing that actually breaks builds. But if you expect ad
revenue from this release, before rebuilding:
1. Put the real IDs into `LIVE_IDS` in `src/native/adsConfig.ts`
2. Set `USE_LIVE_ADS = true`
3. Run `npm run android:manifest-ids` (copies the App ID into the manifest — they must match)
4. Rebuild

### 2. Razorpay instead of Google Play Billing
Subscriptions are charged through Razorpay. Play's Payments policy generally
requires Play Billing for in-app digital purchases; India's CCI ruling is the
basis for the alternative. This was a deliberate choice — noted here only so
that if the review is rejected on Payments policy, you know immediately why,
and the fix is Play Billing behind the existing payment abstraction.

## Upload steps
1. Play Console → **Testing → Internal testing** → Create new release
2. Upload `catalogshare-1.0.8-vc9-release.aab`
3. Paste release notes from `04-release-notes.txt`
4. Roll out to internal testing, install on a real device, verify: login, storefront, estimate PDF, payment
5. Promote to **Production** only after that passes
