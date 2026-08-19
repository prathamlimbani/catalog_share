/**
 * Copies the AdMob App ID from src/native/adsConfig.ts into AndroidManifest.xml.
 *
 * These two values MUST match. The Google Mobile Ads SDK hard-crashes the app
 * at startup if the manifest's `com.google.android.gms.ads.APPLICATION_ID`
 * meta-data is missing or malformed, and it silently fails to fill ads if it
 * points at a different app than the ad units do. Keeping one source of truth
 * and copying it mechanically removes the most common way to ship a broken
 * release build.
 *
 *   npm run android:manifest-ids
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(root, "src/native/adsConfig.ts");
const manifestPath = resolve(root, "android/app/src/main/AndroidManifest.xml");

const config = readFileSync(configPath, "utf8");

const useLive = /export const USE_LIVE_ADS\s*=\s*true/.test(config);

/** Pull `appId: "…"` out of the named exported object literal. */
function readAppId(objectName) {
  const block = new RegExp(
    `export const ${objectName}\\s*:\\s*AdIds\\s*=\\s*\\{([\\s\\S]*?)\\}`,
  ).exec(config);
  if (!block) return null;
  const id = /appId\s*:\s*["']([^"']+)["']/.exec(block[1]);
  return id ? id[1] : null;
}

const testId = readAppId("TEST_IDS");
const liveId = readAppId("LIVE_IDS");

if (!testId) {
  console.error("✖ Could not read TEST_IDS.appId from src/native/adsConfig.ts");
  process.exit(1);
}

const livePlaceholder = !liveId || /0{10,}/.test(liveId);
const chosen = useLive && !livePlaceholder ? liveId : testId;

if (useLive && livePlaceholder) {
  console.warn(
    "⚠ USE_LIVE_ADS is true but LIVE_IDS still holds placeholder zeros.\n" +
      "  Falling back to the Google test App ID — a malformed live id is worse\n" +
      "  than a test ad. Fill in LIVE_IDS in src/native/adsConfig.ts.",
  );
}

let manifest = readFileSync(manifestPath, "utf8");

const metaRe =
  /(<meta-data\s+android:name="com\.google\.android\.gms\.ads\.APPLICATION_ID"\s+android:value=")([^"]*)(")/;

if (!metaRe.test(manifest)) {
  console.error(
    "✖ AdMob APPLICATION_ID meta-data not found in AndroidManifest.xml.\n" +
      "  Add this inside <application>:\n" +
      '  <meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="' +
      chosen +
      '"/>',
  );
  process.exit(1);
}

const current = metaRe.exec(manifest)[2];
manifest = manifest.replace(metaRe, `$1${chosen}$3`);
writeFileSync(manifestPath, manifest);

const mode = chosen === testId ? "TEST" : "LIVE";
if (current === chosen) {
  console.log(`✔ AndroidManifest already in sync — ${mode} App ID ${chosen}`);
} else {
  console.log(`✔ AndroidManifest updated: ${current} → ${chosen} (${mode})`);
}

if (mode === "TEST") {
  console.log(
    "\n  Reminder: this build serves Google TEST ads and earns nothing.\n" +
      "  Set real ids + USE_LIVE_ADS = true in src/native/adsConfig.ts before release.",
  );
}
