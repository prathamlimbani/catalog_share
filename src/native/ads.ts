/**
 * AdMob controller.
 *
 * Contract, in one line: **ads exist only while `entitlement.adsEnabled` is
 * true**. The moment a user pays, `applyEntitlement(false)` tears the banner
 * down and stops preloading — the user must see ads disappear the instant the
 * payment lands, not on the next app launch.
 *
 * Everything here is best-effort. A device without Play Services, a failed ad
 * fill, or a revoked consent must never break the app: every entry point
 * swallows its errors and the UI simply gets no ad.
 */

import {
  AdMob,
  AdmobConsentStatus,
  BannerAdPluginEvents,
  BannerAdPosition,
  BannerAdSize,
  MaxAdContentRating,
  RewardAdPluginEvents,
  type AdMobBannerSize,
  type AdMobRewardItem,
} from "@capacitor-community/admob";

import { supabase } from "@/integrations/supabase/client";
import { isNative } from "./platform";
import { AD_FREQUENCY, getAdIds, isTestAdMode } from "./adsConfig";
import { PREF_KEYS, prefGetJSON, prefSetJSON } from "./prefs";

interface AdState {
  savesSinceInterstitial: number;
  lastInterstitialAt: number;
}

const DEFAULT_AD_STATE: AdState = { savesSinceInterstitial: 0, lastInterstitialAt: 0 };

let initialized = false;
let initializing: Promise<boolean> | null = null;
let adsAllowed = false;
let canRequestAds = false;
let bannerVisible = false;
let interstitialReady = false;
let bannerHeightPx = 0;
const bootedAt = Date.now();

/** Subscribers that want to know the banner's height so they can pad content. */
type HeightListener = (px: number) => void;
const heightListeners = new Set<HeightListener>();

export function onBannerHeightChange(fn: HeightListener): () => void {
  heightListeners.add(fn);
  fn(bannerHeightPx);
  return () => heightListeners.delete(fn);
}

function setBannerHeight(px: number) {
  if (px === bannerHeightPx) return;
  bannerHeightPx = px;
  heightListeners.forEach((fn) => {
    try {
      fn(px);
    } catch {
      /* a listener must not break the ad pipeline */
    }
  });
}

export function getBannerHeight(): number {
  return bannerHeightPx;
}

/**
 * Initialise the Ads SDK and resolve UMP consent.
 *
 * Safe to call repeatedly — the work happens once. Returns false when ads are
 * unavailable for any reason, in which case every other function no-ops.
 */
export async function initAds(): Promise<boolean> {
  if (!isNative) return false;
  if (initialized) return canRequestAds;
  if (initializing) return initializing;

  initializing = (async () => {
    try {
      await AdMob.initialize({
        initializeForTesting: isTestAdMode,
        maxAdContentRating: MaxAdContentRating.General,
        tagForChildDirectedTreatment: false,
        tagForUnderAgeOfConsent: false,
      });

      // Google UMP. Required before the first ad request for users in the EEA /
      // UK, and harmless everywhere else.
      try {
        let info = await AdMob.requestConsentInfo();
        if (info.isConsentFormAvailable && info.status === AdmobConsentStatus.REQUIRED) {
          info = await AdMob.showConsentForm();
        }
        canRequestAds = info.canRequestAds !== false;
      } catch (err) {
        // Consent machinery unavailable — outside the EEA this is the norm.
        console.warn("[ads] consent flow skipped:", err);
        canRequestAds = true;
      }

      await AdMob.addListener(BannerAdPluginEvents.SizeChanged, (size: AdMobBannerSize) => {
        // Only a banner that is actually on screen may reserve space.
        //
        // hideBanner()/removeBanner() make the SDK re-lay-out the ad view, and
        // that emits SizeChanged — sometimes with the OLD height, and always
        // after teardownAds() has already set 0. Taking it at face value put
        // the reservation back with no ad behind it, which lifted the tab bar
        // off the bottom of the screen and left a gap the page showed through.
        if (!adsAllowed || !bannerVisible) {
          setBannerHeight(0);
          return;
        }
        setBannerHeight(size?.height ?? 0);
      });
      await AdMob.addListener(BannerAdPluginEvents.FailedToLoad, () => {
        // No fill. Collapse the reserved space so we never leave a grey gap.
        setBannerHeight(0);
      });

      initialized = true;
      return canRequestAds;
    } catch (err) {
      console.warn("[ads] initialize failed — running ad-free:", err);
      initialized = true;
      canRequestAds = false;
      return false;
    } finally {
      initializing = null;
    }
  })();

  return initializing;
}

/**
 * Point of control for the free/paid split. Call this whenever entitlement is
 * computed or refreshed.
 */
export async function applyEntitlement(adsEnabled: boolean): Promise<void> {
  adsAllowed = adsEnabled;

  if (!adsEnabled) {
    await teardownAds();
    return;
  }

  const ok = await initAds();
  if (ok) void preloadInterstitial();
}

/** Remove every ad surface. Called on upgrade and on sign-out. */
export async function teardownAds(): Promise<void> {
  if (!isNative) return;
  bannerVisible = false;
  interstitialReady = false;
  // The preloaded rewarded ad is tagged with the signed-in user's id for SSV,
  // so it must not survive a sign-out — the next viewer would be credited as
  // the previous one.
  rewardedReady = false;
  rewardedPreparedFor = null;
  setBannerHeight(0);
  try {
    await AdMob.hideBanner();
  } catch {
    /* nothing shown */
  }
  try {
    await AdMob.removeBanner();
  } catch {
    /* nothing to remove */
  }
}

/** True when an ad may be requested right now. */
export function adsActive(): boolean {
  return isNative && adsAllowed && canRequestAds;
}

/**
 * Show the anchored adaptive banner.
 *
 * Screens that must stay ad-free (payment, receipt, PDF preview, legal pages,
 * the trial-lock screen) simply never call this — and call `hideBanner()` on
 * entry to clear a banner left over from the previous screen.
 */
export async function showBanner(): Promise<void> {
  // Initialise FIRST, then check. `adsActive()` depends on `canRequestAds`,
  // which only ever gets assigned inside `initAds()` — guarding on it up front
  // made the very first call unsatisfiable, so a free user saw no banner at all
  // on the first screen they opened.
  if (!isNative || !adsAllowed) return;
  const ok = await initAds();
  if (!ok) return;

  // Set BEFORE the call, not after: SizeChanged fires while the ad view lays
  // out, which is before showBanner() resolves. With the flag set afterwards
  // the SizeChanged guard saw `bannerVisible === false` for the real banner and
  // threw away its height, so the ad covered the content it should sit below.
  bannerVisible = true;

  try {
    await AdMob.showBanner({
      adId: getAdIds().bannerId,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.BOTTOM_CENTER,
      // Height of the bottom tab bar, so the banner sits above it rather than
      // covering the navigation.
      margin: 0,
      isTesting: isTestAdMode,
    });
  } catch (err) {
    console.warn("[ads] showBanner failed:", err);
    bannerVisible = false;
    setBannerHeight(0);
  }
}

export async function hideBanner(): Promise<void> {
  if (!isNative || !bannerVisible) return;
  bannerVisible = false;
  setBannerHeight(0);
  try {
    await AdMob.hideBanner();
  } catch {
    /* already hidden */
  }
}

async function preloadInterstitial(): Promise<void> {
  if (!adsActive() || interstitialReady) return;
  try {
    await AdMob.prepareInterstitial({
      adId: getAdIds().interstitialId,
      isTesting: isTestAdMode,
    });
    interstitialReady = true;
  } catch (err) {
    console.warn("[ads] interstitial preload failed:", err);
    interstitialReady = false;
  }
}

/**
 * Offer an interstitial after a completed task (currently: saving an estimate).
 *
 * Heavily rate-limited on purpose — CatalogShare is a work tool, and Play
 * rejects apps whose ads interrupt the job the user came to do. Returns true
 * only if an ad was actually shown.
 */
export async function maybeShowInterstitial(): Promise<boolean> {
  if (!isNative || !adsAllowed) return false;

  const now = Date.now();
  if (now - bootedAt < AD_FREQUENCY.coldStartQuietMs) return false;

  // Same ordering rule as showBanner: initialise before any `adsActive()` /
  // preload check, since those depend on state initAds() produces.
  const ready = await initAds();
  if (!ready) return false;

  const state = await prefGetJSON<AdState>(PREF_KEYS.adState, DEFAULT_AD_STATE);
  const saves = state.savesSinceInterstitial + 1;

  const tooSoon = now - state.lastInterstitialAt < AD_FREQUENCY.minIntervalMs;
  const notYet = saves < AD_FREQUENCY.savesPerInterstitial;

  if (tooSoon || notYet) {
    await prefSetJSON(PREF_KEYS.adState, { ...state, savesSinceInterstitial: saves });
    void preloadInterstitial();
    return false;
  }

  if (!interstitialReady) {
    await preloadInterstitial();
    if (!interstitialReady) {
      await prefSetJSON(PREF_KEYS.adState, { ...state, savesSinceInterstitial: saves });
      return false;
    }
  }

  try {
    await AdMob.showInterstitial();
    interstitialReady = false;
    await prefSetJSON(PREF_KEYS.adState, {
      savesSinceInterstitial: 0,
      lastInterstitialAt: now,
    });
    void preloadInterstitial();
    return true;
  } catch (err) {
    console.warn("[ads] showInterstitial failed:", err);
    interstitialReady = false;
    await prefSetJSON(PREF_KEYS.adState, { ...state, savesSinceInterstitial: saves });
    return false;
  }
}

/**
 * Opens the UMP privacy options form so an EEA user can change their ad
 * consent. Surfaced from Settings — required by Google's consent policy.
 */
// ---------------------------------------------------------------- rewarded

/**
 * Rewarded ads.
 *
 * The reward is NEVER granted here. Finishing the ad only tells us the user is
 * probably owed something; the authority is AdMob's server-side verification
 * callback, which posts to /api/admob-ssv and credits points through
 * `credit_ad_reward()`. A device can fake the `Rewarded` event with a patched
 * build in about a minute, so anything granted client-side is free money for
 * anyone who wants it.
 *
 * What this function returns is therefore "the ad completed", not "you have
 * been paid". The caller polls the wallet for the credit to land.
 */
let rewardedReady = false;
let rewardedPreparing: Promise<boolean> | null = null;
/**
 * Which user the loaded ad was prepared for.
 *
 * The SSV identity is baked in at prepare time — there is no setter to change
 * it afterwards — so a preloaded ad belongs to whoever was signed in when it
 * was requested. Showing it to a different account would credit the points to
 * the previous one, which is why every show re-checks this.
 */
let rewardedPreparedFor: string | null = null;

export interface RewardedOutcome {
  /** The user watched to the end and AdMob reported a reward. */
  earned: boolean;
  /** Why not, when `earned` is false — for a message the user can act on. */
  reason?: "unavailable" | "no-fill" | "dismissed" | "error" | "not-signed-in";
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

/**
 * Preload so the Earn button does not sit spinning for five seconds.
 *
 * Passing `ssv.userId` is the single most important line in the rewards flow.
 * Without it Google's callback arrives with no user_id, `credit_ad_reward()`
 * cannot resolve a company, and every ad watched credits nobody — silently,
 * because the ad itself plays perfectly.
 */
export async function prepareRewarded(): Promise<boolean> {
  if (!isNative) return false;

  const userId = await currentUserId();
  if (!userId) return false;

  if (rewardedReady && rewardedPreparedFor === userId) return true;
  if (rewardedPreparing) return rewardedPreparing;

  rewardedPreparing = (async () => {
    const ok = await initAds();
    if (!ok) return false;
    try {
      await AdMob.prepareRewardVideoAd({
        adId: getAdIds().rewardedId,
        isTesting: isTestAdMode,
        ssv: { userId, customData: "catalogshare" },
      });
      rewardedReady = true;
      rewardedPreparedFor = userId;
      return true;
    } catch (err) {
      console.warn("[ads] prepareRewardVideoAd failed:", err);
      rewardedReady = false;
      rewardedPreparedFor = null;
      return false;
    } finally {
      rewardedPreparing = null;
    }
  })();

  return rewardedPreparing;
}

/**
 * Show a rewarded ad and resolve once it closes.
 *
 * The reward is NEVER granted here. Finishing the ad only means the user is
 * probably owed something; the authority is AdMob's server-side verification
 * callback, which posts to /api/admob-ssv and credits points through
 * `credit_ad_reward()`. A patched build can fire the `Rewarded` event in about
 * a minute, so anything granted client-side is free money for whoever wants it.
 *
 * So `earned: true` means "the ad completed", not "you have been paid" — the
 * caller watches the wallet for the credit to land.
 *
 * Unlike the banner and interstitial this does NOT check `adsAllowed`: a paying
 * merchant may still choose to earn points. An ad someone opts into is a
 * different thing from an ad shown at them.
 */
export async function showRewarded(): Promise<RewardedOutcome> {
  if (!isNative) return { earned: false, reason: "unavailable" };

  const userId = await currentUserId();
  if (!userId) return { earned: false, reason: "not-signed-in" };

  // Re-prepare when the loaded ad belongs to a different account.
  if (rewardedPreparedFor !== userId) {
    rewardedReady = false;
    rewardedPreparedFor = null;
  }

  const ready = rewardedReady || (await prepareRewarded());
  if (!ready) return { earned: false, reason: "no-fill" };

  return new Promise<RewardedOutcome>((resolve) => {
    let settled = false;
    const listeners: Array<{ remove: () => void }> = [];

    const finish = (outcome: RewardedOutcome) => {
      if (settled) return;
      settled = true;
      listeners.forEach((l) => {
        try {
          void l.remove();
        } catch {
          /* already gone */
        }
      });
      rewardedReady = false;
      rewardedPreparedFor = null;
      // Warm the next one straight away; the Earn screen is usually a run of
      // several ads back to back.
      void prepareRewarded();
      resolve(outcome);
    };

    void (async () => {
      try {
        listeners.push(
          await AdMob.addListener(RewardAdPluginEvents.Rewarded, (_item: AdMobRewardItem) => {
            finish({ earned: true });
          }),
        );
        listeners.push(
          await AdMob.addListener(RewardAdPluginEvents.Dismissed, () => {
            // Dismissed also fires after Rewarded when the ad was watched
            // through, and `settled` makes that a no-op. On its own it means
            // they closed the ad early.
            finish({ earned: false, reason: "dismissed" });
          }),
        );
        listeners.push(
          await AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => {
            finish({ earned: false, reason: "no-fill" });
          }),
        );

        await AdMob.showRewardVideoAd();
      } catch (err) {
        console.warn("[ads] showRewardVideoAd failed:", err);
        finish({ earned: false, reason: "error" });
      }
    })();
  });
}

/** True when a rewarded ad is loaded and can be shown immediately. */
export function isRewardedReady(): boolean {
  return rewardedReady;
}

export async function openPrivacyOptions(): Promise<boolean> {
  if (!isNative) return false;
  try {
    await AdMob.showPrivacyOptionsForm();
    return true;
  } catch (err) {
    console.warn("[ads] privacy options unavailable:", err);
    return false;
  }
}
