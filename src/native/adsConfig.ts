/**
 * ============================================================================
 *  ADMOB IDS — THE ONLY FILE YOU NEED TO EDIT BEFORE GOING LIVE
 * ============================================================================
 *
 * Right now this ships Google's OFFICIAL TEST ad unit ids. Test ids serve real
 * ad creatives but never bill an advertiser and never count against your
 * account, so they are the only safe thing to develop against — requesting live
 * ads from a device you are testing on is what gets AdMob accounts suspended.
 *
 * ---------------------------------------------------------------------------
 * READ THIS BEFORE YOU UPLOAD A RELEASE
 * ---------------------------------------------------------------------------
 * While LIVE_IDS still holds the placeholder zeros below, or USE_LIVE_ADS is
 * false, **a release AAB built from this file serves Google test ads and earns
 * exactly ₹0** — every impression your users generate is a test impression that
 * no advertiser pays for. The app works, the ads appear, the revenue does not.
 * `adsBuildStatus()` reports which of the three states this build is in, and
 * `npm run android:manifest-ids` prints the same warning at build time.
 *
 * ---------------------------------------------------------------------------
 * TO GO LIVE — three steps:
 * ---------------------------------------------------------------------------
 * 1. In AdMob (https://apps.admob.com) create an app for `in.catalogshare.app`
 *    and create two ad units: one **Banner**, one **Interstitial**.
 *
 * 2. Paste the three ids into LIVE_IDS below.
 *      appId          looks like  ca-app-pub-1234567890123456~1234567890   (~)
 *      bannerId       looks like  ca-app-pub-1234567890123456/1234567890   (/)
 *      interstitialId looks like  ca-app-pub-1234567890123456/0987654321   (/)
 *    Note the tilde in the App ID and the slash in the unit ids — mixing them
 *    up is the single most common cause of "ads never fill".
 *
 * 3. Set USE_LIVE_ADS to true, then run:
 *      npm run android:manifest-ids     (writes appId into AndroidManifest.xml)
 *      npm run android:release
 *
 * The AndroidManifest MUST contain the same App ID in
 * `com.google.android.gms.ads.APPLICATION_ID`. The Ads SDK hard-crashes the app
 * at startup if that meta-data tag is missing or malformed — the npm script
 * above keeps the two in sync so you cannot forget.
 * ============================================================================
 */

export interface AdIds {
  appId: string;
  bannerId: string;
  interstitialId: string;
  /**
   * Rewarded unit.
   *
   * Create this one in AdMob as a REWARDED ad unit and turn on Server-Side
   * Verification, pointing it at:
   *     https://app.catalogshare.online/api/admob-ssv
   * Points are credited by that callback and never by the app, because a
   * client claiming "I watched an ad" is trivially forged.
   */
  rewardedId: string;
}

/** Google's official Android test ids. Safe to ship in development builds. */
export const TEST_IDS: AdIds = {
  appId: "ca-app-pub-3940256099942544~3347511713",
  bannerId: "ca-app-pub-3940256099942544/6300978111",
  interstitialId: "ca-app-pub-3940256099942544/1033173712",
  // Google's official rewarded test unit. Test rewarded ads DO fire the SSV
  // callback, so the whole points flow is testable before the real unit exists.
  rewardedId: "ca-app-pub-3940256099942544/5224354917",
};

/** ⬇⬇⬇  PASTE YOUR REAL ADMOB IDS HERE  ⬇⬇⬇ */
export const LIVE_IDS: AdIds = {
  appId: "ca-app-pub-0000000000000000~0000000000",
  bannerId: "ca-app-pub-0000000000000000/0000000000",
  interstitialId: "ca-app-pub-0000000000000000/0000000000",
  rewardedId: "ca-app-pub-0000000000000000/0000000000",
};

/** ⬇⬇⬇  FLIP THIS TO true WHEN THE IDS ABOVE ARE REAL  ⬇⬇⬇ */
export const USE_LIVE_ADS = false;

/**
 * A real AdMob id is `ca-app-pub-<16 digits><~ or /><10 digits>`. Anything that
 * is blank, malformed, or carries the placeholder run of zeros is not usable.
 */
function isPlaceholderId(id: string): boolean {
  if (!/^ca-app-pub-\d{16}[~/]\d{10}$/.test(id)) return true;
  return /0{10,}/.test(id);
}

/** True when LIVE_IDS still holds the placeholder zeros (or anything malformed). */
export function liveIdsArePlaceholders(): boolean {
  return (
    isPlaceholderId(LIVE_IDS.appId) ||
    isPlaceholderId(LIVE_IDS.bannerId) ||
    isPlaceholderId(LIVE_IDS.interstitialId) ||
    isPlaceholderId(LIVE_IDS.rewardedId)
  );
}

/**
 * What this build will actually do at runtime.
 *
 *  - `live`            real ids, real money.
 *  - `test-ids`        USE_LIVE_ADS is off — Google test ads, no revenue.
 *  - `placeholder-ids` USE_LIVE_ADS is on but LIVE_IDS was never filled in, so
 *                      the app falls back to test ads. Also no revenue, and the
 *                      easiest state to ship by accident.
 */
export type AdsBuildStatus = "live" | "test-ids" | "placeholder-ids";

export function adsBuildStatus(): AdsBuildStatus {
  if (!USE_LIVE_ADS) return "test-ids";
  return liveIdsArePlaceholders() ? "placeholder-ids" : "live";
}

/**
 * Human-readable warning for a build that will not earn, or null when the ids
 * are live. Meant for build scripts, CI gates and the dev console — anywhere a
 * non-earning release can still be caught before upload.
 */
export function adsBuildWarning(): string | null {
  const status = adsBuildStatus();
  if (status === "live") return null;
  const cause =
    status === "placeholder-ids"
      ? "USE_LIVE_ADS is true but LIVE_IDS still holds placeholder zeros"
      : "USE_LIVE_ADS is false";
  return `${cause} — this build serves Google test ads and earns nothing.`;
}

/**
 * The ids the app actually uses.
 * Falls back to test ids if someone flips USE_LIVE_ADS without filling LIVE_IDS,
 * because serving a malformed live id is worse than serving a test ad.
 */
export function getAdIds(): AdIds {
  if (USE_LIVE_ADS && !liveIdsArePlaceholders()) return LIVE_IDS;
  return TEST_IDS;
}

/** True while running against test ids — drives `initializeForTesting`. */
export const isTestAdMode = !USE_LIVE_ADS || liveIdsArePlaceholders();

/**
 * Interstitial frequency cap. Deliberately conservative: an estimate app is a
 * work tool, and Play reviewers reject apps whose ads interrupt a task flow.
 */
export const AD_FREQUENCY = {
  /** Show an interstitial at most once every N saved estimates. */
  savesPerInterstitial: 3,
  /** …and never twice within this many milliseconds. */
  minIntervalMs: 90_000,
  /** Never show an interstitial in the first N seconds after app start. */
  coldStartQuietMs: 30_000,
} as const;
