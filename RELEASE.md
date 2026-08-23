# CatalogShare — Android release runbook

Everything needed to go from a clean checkout to a signed `.aab` uploaded to Google Play,
on a **Windows** machine. Follow it top to bottom; each command is copy-pasteable.

| | |
|---|---|
| Package name (permanent) | `in.catalogshare.app` |
| App name | CatalogShare |
| Website | https://catalogshare.online |
| Support email | catalogshare123@gmail.com |
| Support phone | +91 76250 25686 |
| minSdk / targetSdk / compileSdk | 24 / 36 / 36 |

---

## 1. Prerequisites

| Tool | Required version | Expected path |
|---|---|---|
| JDK | **21** — Capacitor 8 plugins target Java 21; JDK 17 fails with "Cannot find a Java installation ... languageVersion=21" | `C:\Java\jdk-21.0.12+8` |
| Android SDK | Platform 36 + Build-Tools 36 + Platform-Tools | `C:\Android\sdk` |
| Node.js | 18 LTS or newer | on `PATH` |

Set the environment for the current PowerShell session:

```powershell
$env:JAVA_HOME    = "C:\Java\jdk-21.0.12+8"
$env:ANDROID_HOME = "C:\Android\sdk"
$env:ANDROID_SDK_ROOT = "C:\Android\sdk"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"

java -version      # must print 21.x
```

To make it permanent (new terminals inherit it):

```powershell
[Environment]::SetEnvironmentVariable("JAVA_HOME", "C:\Java\jdk-21.0.12+8", "User")
[Environment]::SetEnvironmentVariable("ANDROID_HOME", "C:\Android\sdk", "User")
```

> **Already done on this machine.** `android/gradle.properties` pins
> `org.gradle.java.home=C:/Java/jdk-21.0.12+8`, so `gradlew.bat` finds the right JDK from any
> shell without JAVA_HOME being set. If you move or upgrade the JDK, update that one line.

Gradle also reads the SDK location from `android\local.properties`. That file is gitignored, so
create it once per machine (forward slashes — a backslash path is silently mangled by Java
property escaping into `C:Androidsdk` and the build fails with "The filename, directory name,
or volume label syntax is incorrect"):

```powershell
"sdk.dir=C:/Android/sdk" | Out-File -Encoding ascii android\local.properties
```

---

## 2. Create the upload keystore — **once, ever**

> ### ✅ Already done on this machine
>
> The upload keystore has been generated and the build is already wired to it:
>
> | | |
> |---|---|
> | Keystore | `C:\catalogshare-keys\catalogshare-upload.jks` |
> | Password | `C:\catalogshare-keys\PASSWORD.txt` (store password == key password) |
> | Alias | `catalogshare-upload` |
> | Certificate SHA-256 | `5C:CB:07:24:D0:B7:29:D1:26:04:CE:30:A3:E3:2D:2A:54:A3:2E:B3:4F:8B:E4:14:40:CE:C7:B6:C5:EE:9B:50` |
> | Valid until | 4 January 2054 |
>
> `android/keystore.properties` points at it and is gitignored, so
> `npm run android:release` already produces a **signed** `.aab`.
>
> **Two things to do now:**
> 1. Copy that `.jks` and `PASSWORD.txt` somewhere off this laptop, then move the password
>    into a password manager and delete the plaintext file.
> 2. Enable **Play App Signing** on your first upload (see below) — it is the only recovery
>    path if the key is ever lost.
>
> Everything below in this section is the reference procedure for regenerating it, which you
> should only ever need if you are starting a different app.

Run this exactly once for the lifetime of the app. Replace nothing except the `-dname` values.

```powershell
New-Item -ItemType Directory -Force C:\catalogshare-keys | Out-Null

& "C:\Program Files\Java\jdk-17\bin\keytool.exe" `
  -genkeypair -v `
  -keystore C:\catalogshare-keys\catalogshare-upload.jks `
  -storetype PKCS12 `
  -alias catalogshare-upload `
  -keyalg RSA -keysize 4096 `
  -validity 10000 `
  -dname "CN=CatalogShare, OU=Mobile, O=CatalogShare, L=Surat, ST=Gujarat, C=IN"
```

`keytool` prompts for the keystore password twice. Use a long random password and store it in a
password manager — **not** in this repo, not in a chat, not in an email to yourself.

`-validity 10000` (~27 years) is deliberate: Google Play refuses a key that expires before
**22 October 2033**.

### ⚠️ Back this file up forever

`catalogshare-upload.jks` plus its two passwords are the *only* proof that a future upload comes
from you. **If you lose the keystore or the password, you can never publish an update to
`in.catalogshare.app` again** — not a patch, not a security fix. Your only option would be
publishing a brand-new listing under a new package name and asking every existing user to
reinstall, losing all reviews and install counts.

So:

1. Copy the `.jks` to at least two places that are not this laptop (encrypted cloud drive +
   an offline USB stick or a printed paper backup of the base64).
2. Store the store password, key password and alias in a password manager next to it.

### Enable Play App Signing (do this — it is the safety net)

When you create the app in Play Console, opt into **Play App Signing** (it is the default for new
apps and cannot be turned off later). With it enabled:

- Your `.jks` becomes the **upload key** only. Google holds the real **app signing key**.
- If you ever lose the upload key, you can [request a reset][upload-key-reset] from Play support
  and keep publishing. Without Play App Signing there is no recovery path at all.

Enrolling does **not** remove the need to back up the upload key — it just turns "app is dead"
into "app is annoying for a week".

[upload-key-reset]: https://support.google.com/googleplay/android-developer/answer/9842756

### Wire the keystore into the build

```powershell
Copy-Item android\keystore.properties.example android\keystore.properties
notepad android\keystore.properties
```

Fill in the four keys:

```properties
storeFile=C:/catalogshare-keys/catalogshare-upload.jks
storePassword=<keystore password>
keyAlias=catalogshare-upload
keyPassword=<key password>
```

`android/keystore.properties` is gitignored, as are `*.jks` and `*.keystore`. Verify before your
next commit:

```powershell
git check-ignore -v android\keystore.properties
```

If the file is missing, `assembleDebug` still works but `bundleRelease` produces an **unsigned**
bundle that Play rejects — the Gradle log prints a warning when that happens.

---

## 3. Swap the AdMob test ids for real ones

The repo ships **Google's public test ad ids**. Shipping those to production means you earn
nothing; requesting *live* ads from your own test device is what gets AdMob accounts suspended, so
never do the reverse either.

1. In [AdMob](https://apps.admob.com) create an app for `in.catalogshare.app` and two ad units:
   one **Banner**, one **Interstitial**.
2. Edit **`src/native/adsConfig.ts`** → paste the three ids into `LIVE_IDS`:
   - `appId` contains a tilde: `ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY`
   - `bannerId` / `interstitialId` contain a slash: `ca-app-pub-XXXXXXXXXXXXXXXX/YYYYYYYYYY`
3. In the same file set `USE_LIVE_ADS = true`.
4. Edit **`android/app/src/main/AndroidManifest.xml`** and replace the value of
   `com.google.android.gms.ads.APPLICATION_ID` with the **same** `appId`. It currently reads:

   ```xml
   <meta-data
       android:name="com.google.android.gms.ads.APPLICATION_ID"
       android:value="ca-app-pub-3940256099942544~3347511713" />
   ```

**The manifest value and `LIVE_IDS.appId` must be byte-identical.** The Google Mobile Ads SDK
throws during `Application.onCreate()` and hard-crashes the app on launch if that meta-data tag is
missing or malformed — this is the single most common "release build won't start" cause.

Sanity check after editing:

```powershell
Select-String -Path src\native\adsConfig.ts -Pattern "appId|USE_LIVE_ADS"
Select-String -Path android\app\src\main\AndroidManifest.xml -Pattern "ads.APPLICATION_ID" -Context 0,2
```

---

## 4. Build the release bundle

`npm run build` inlines the Vite environment into the JS bundle, so `.env` (gitignored) must hold
the **production** values before you build — a bundle built against staging keys ships those keys:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_RAZORPAY_KEY_ID=rzp_live_...
```

Then:

```powershell
# from the repo root
npm ci
npm run build
npx cap sync android

cd android
.\gradlew.bat clean bundleRelease
```

`npx cap sync` copies `dist/` into `android/app/src/main/assets/public` and regenerates
`capacitor.config.json` / `capacitor.plugins.json`. **Skipping it ships the previous build's web
assets** — the AAB will look fine and contain stale JavaScript.

Output:

```
android\app\build\outputs\bundle\release\app-release.aab
```

Other useful artefacts from the same build:

| Artefact | Path | What it's for |
|---|---|---|
| R8 mapping | `android\app\build\outputs\mapping\release\mapping.txt` | Deobfuscating crash traces. Already embedded in the AAB, Play picks it up automatically. |
| Native symbols | bundled in the AAB via `ndk { debugSymbolLevel 'SYMBOL_TABLE' }` | Symbolicated native crashes for the Ads/Razorpay `.so` files. |

### Test the exact release build on a device first

The release build is minified (`minifyEnabled true`, `shrinkResources true`). A debug build passing
proves nothing about R8. Always smoke-test a real release binary:

```powershell
.\gradlew.bat assembleRelease
adb install -r app\build\outputs\apk\release\app-release.apk
```

Then walk the whole app and confirm — these are exactly the paths R8 breaks first:

- [ ] App launches to the login screen (no white flash, no instant crash → Ads meta-data OK)
- [ ] Login / register / logout (Supabase session persists across a force-stop)
- [ ] Create a product with a **camera** photo, and one from the **gallery**
- [ ] Generate an estimate PDF, **share to WhatsApp**, and **save to Downloads**
- [ ] Open a Razorpay checkout and reach a UPI app (GPay / PhonePe)
- [ ] Turn on airplane mode: offline banner appears, estimates still save, sync on reconnect
- [ ] Free account shows a banner ad; paid account shows none
- [ ] Tap `https://catalogshare.online/store/<slug>` in a chat — it opens the app, not Chrome

If anything native goes silent, check `adb logcat` for `ClassNotFoundException` /
`NoSuchMethodException` and add the missing keep rule to `android/app/proguard-rules.pro`.

### Every subsequent upload

Bump **`versionCode`** in `android/app/build.gradle` before every single Play upload — Play
permanently rejects a bundle whose `versionCode` is less than or equal to one already uploaded to
that track, and the rejected number is burnt. `versionName` is the human-facing string ("1.0.1")
and may be whatever you like.

---

## 5. Verify App Links (so shared store links open the app)

The manifest declares `android:autoVerify="true"` for `https://catalogshare.online/store/*` and
`/invoices/*`. Android only honours that if the domain vouches for the app.

1. Play Console → **Test and release → Setup → App signing** → copy the
   **SHA-256 certificate fingerprint of the *app signing* key** (not the upload key).
2. Publish this file at `https://catalogshare.online/.well-known/assetlinks.json`, served as
   `application/json` over HTTPS with **no redirect**:

   ```json
   [{
     "relation": ["delegate_permission/common.handle_all_urls"],
     "target": {
       "namespace": "android_app",
       "package_name": "in.catalogshare.app",
       "sha256_cert_fingerprints": ["PASTE:THE:SHA256:FROM:PLAY:CONSOLE"]
     }
   }]
   ```

3. Confirm on a device after install:

   ```powershell
   adb shell pm get-app-links in.catalogshare.app
   ```

   `catalogshare.online` must read `verified`.

---

## 5b. Google sign-in (register every signing key with Google)

Sign in with Google on Android goes through Google Credential Manager, which only
answers for an APK whose **package name + signing SHA-1** are registered as an
*Android* OAuth client in the same Google Cloud project as the *Web* client the
app is configured with. One Android client per certificate:

| Build | SHA-1 | Where it comes from |
|---|---|---|
| Debug (`assembleDebug`) | `86:7B:8C:DA:26:83:48:BE:47:A3:02:4E:E9:C3:47:59:E0:10:D2:14` | `~/.android/debug.keystore` |
| Upload key (`bundleRelease`, sideloaded APK) | `2D:03:1F:13:9F:D9:9C:90:1F:1F:74:AB:C6:3A:0C:AD:32:B1:E7:9A` | `C:/catalogshare-keys/catalogshare-upload.jks` |
| **Play App Signing** (what users install) | copy from Play Console → **Test and release → Setup → App signing** | Google holds this key |

The Web client id and secret are pasted into the admin console (**Integrations →
Google sign-in**); the console also shows these values with copy buttons. Nothing
in this repo changes per key - the APK only ever carries the Web client id, which
it reads from the server at runtime. Missing the Play App Signing entry is the
classic failure: sign-in works on a sideloaded build and fails from the Store
with `[28444] Developer console is not set up correctly`. See
`SELF-HOSTING.md` → "Google sign-in" for the server side.

## 6. Play Console checklist

### 6.1 Create the app

**All apps → Create app** → name `CatalogShare`, language English (India), type **App**, **Free**.
Accept the declarations. Opt into **Play App Signing**.

### 6.2 Store listing

- App name: `CatalogShare`
- Short description (≤80 chars) and full description (≤4000 chars)
- App icon 512×512 PNG, feature graphic 1024×500
- At least 2 phone screenshots (min 320px, 16:9 or 9:16); add 7" and 10" tablet screenshots —
  the app is `resizeableActivity="true"`, so Play will otherwise flag it as phone-only
- Category: **Business**
- Contact email `catalogshare123@gmail.com`, phone `+91 76250 25686`, website
  `https://catalogshare.online`

### 6.3 App content (every item must be green before you can roll out)

| Section | Answer |
|---|---|
| **Privacy policy** | `https://catalogshare.online/privacy` |
| **App access** | *All functionality is restricted* → provide a demo login (email + password) for the reviewer, plus a paid-tier demo account so they can see the non-ad experience |
| **Ads** | **Yes, this app contains ads** (AdMob banner + interstitial, free tier only) |
| **Content rating** | Complete the questionnaire — see 6.5 |
| **Target audience and content** | Target age group **18 and over** only. Answer **No** to "appeals to children". This keeps you out of Families policy and lets you serve non-child-directed ads |
| **News app** | No |
| **COVID-19 contact tracing** | No |
| **Data safety** | See 6.4 |
| **Government apps** | No |
| **Financial features** | No (you are not a lender/broker — Razorpay is a payment processor for your own subscriptions) |
| **Health** | No |

### 6.4 Data safety — answers that match the privacy policy

Declare data collection **Yes**, data encrypted in transit **Yes**, users can request deletion
**Yes**. Then for each type:

| Data type | Collected | Shared | Purpose | Optional? |
|---|---|---|---|---|
| **Name** | Yes | No | App functionality, Account management | Required |
| **Email address** | Yes | No | App functionality, Account management | Required |
| **Phone number** | Yes | No | App functionality, Customer support | Required |
| **Address** (business/customer address on estimates) | Yes | No | App functionality | Optional |
| **Purchase history** | Yes | No | App functionality | Required |
| **Payment info** (card/UPI handled by Razorpay, never stored by us) | Yes | Yes → Razorpay | App functionality | Required |
| **Photos** (product images) | Yes | No | App functionality | Optional |
| **Device or other IDs — Advertising ID** | Yes | Yes → Google AdMob | Advertising or marketing | Required |
| **App interactions / crash logs / diagnostics** | Yes | No | Analytics, Crash reporting | Required |

Notes that reviewers check:
- **Advertising ID must be declared** — the manifest requests
  `com.google.android.gms.permission.AD_ID`, and a mismatch is an automatic rejection.
- The **payment info** row must say *shared* because the card details are entered into Razorpay's
  checkout. Your servers never see them; say exactly that in the privacy policy.
- Data marked "encrypted in transit" is truthful here: `network_security_config.xml` sets
  `cleartextTrafficPermitted="false"`, so nothing can leave the app over plain HTTP.

### 6.5 Content rating questionnaire

Category **Utility, Productivity, Communication, or Other**. Answer **No** to every question about
violence, sexuality, profanity, drugs, gambling and simulated gambling. Answer **Yes** to:
"Does the app allow users to purchase digital goods?" (the subscription) and
"Does the app share the user's location?" → **No**.
Expected result: **IARC 3+ / PEGI 3 / everyone**.

### 6.6 The four policy URLs

Every one of these must be publicly reachable, human-readable, and linked from inside the app
(footer) as well as from the Play listing. Razorpay's merchant onboarding requires the last three
independently of Play.

| Purpose | URL | Route status |
|---|---|---|
| Privacy policy (Play: **required**) | `https://catalogshare.online/privacy` | ⚠️ `src/pages/Privacy.tsx` exists but is **not registered in `src/App.tsx`** — add the route or the URL 404s and the submission is rejected |
| Terms & conditions | `https://catalogshare.online/terms` | ✅ routed |
| Refund & cancellation policy | `https://catalogshare.online/refund-policy` | ⚠️ `src/pages/RefundPolicy.tsx` exists but is **not registered in `src/App.tsx`** |
| Contact / customer support | `https://catalogshare.online/customer-care` | ✅ routed |

Verify all four resolve before submitting:

```powershell
"privacy","terms","refund-policy","customer-care" | ForEach-Object {
  "{0,-16} {1}" -f $_, (Invoke-WebRequest -UseBasicParsing "https://catalogshare.online/$_").StatusCode
}
```

### 6.7 Account deletion URL

Play requires an in-app path **and** a public web URL where a user can request deletion of their
account and data without reinstalling the app.

- Declare `https://catalogshare.online/delete-account` under
  **App content → Data safety → Data deletion**.
- ⚠️ **This page does not exist yet.** There is no `delete-account` route in `src/App.tsx` and no
  in-app deletion action — both must be built before submission; Play rejects on this alone.
- The page must let a signed-in user delete the account, state what is deleted immediately
  (profile, catalogue, estimates, uploaded images) and what is retained and for how long
  (invoices/tax records kept 8 years per Indian statute — say the number).
- The same action must be reachable in-app from Settings.

### 6.8 Roll out

1. **Testing → Internal testing** → upload `app-release.aab` → add testers → verify the install
   from the Play link on a real device.
2. **Production → Create new release** → upload the same AAB → release notes → **Send for review**.

First review typically takes 1–7 days. A new developer account may additionally require 12 testers
for 14 days of closed testing before production is unlocked.

---

## 7. Files that control the release

| File | Controls |
|---|---|
| `android/app/src/main/AndroidManifest.xml` | Permissions, `<queries>`, App Links, AdMob app id, backup opt-out |
| `android/app/build.gradle` | `versionCode`/`versionName`, signing, R8, bundle config |
| `android/keystore.properties` | Signing credentials (gitignored, never commit) |
| `android/app/proguard-rules.pro` | R8 keep rules — without these R8 breaks the Capacitor bridge |
| `android/app/src/main/res/raw/keep.xml` | Resources the shrinker must not remove (splash, `config.xml`) |
| `android/app/src/main/res/xml/network_security_config.xml` | HTTPS-only policy |
| `android/app/src/main/res/xml/data_extraction_rules.xml` | What may never be backed up |
| `android/app/src/main/res/values/colors.xml` / `styles.xml` | Splash + status bar `#0B1020` |
| `src/native/adsConfig.ts` | AdMob ids and the test/live switch |
| `capacitor.config.ts` | `appId` — **permanent**, never change it after the first upload |
