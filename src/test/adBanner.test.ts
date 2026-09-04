/**
 * The ad controller's lifecycle rules.
 *
 * Two of these pin bugs that were live in the field and are invisible from the
 * code alone, because both are about ORDER rather than logic:
 *
 *  1. The shell asks for the banner in the same commit that the entitlement is
 *     still resolving, so `showBanner()` arrives before `applyEntitlement()`
 *     has said ads are allowed. That request used to be dropped and never
 *     repeated — `useAdBanner` only re-fires when `showingAds` changes, and it
 *     was already true — so the home screen carried no ad for the whole session
 *     unless the user happened to visit an ad-free route and come back.
 *  2. A rewarded ad that fails to load or to show is routine, and giving up on
 *     the first failure told the merchant "no ad was available" when a second
 *     request would have filled.
 *
 * The plugin is mocked at the module boundary: what is being tested is which
 * calls this module makes and when, not AdMob itself.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/native/platform", () => ({
  isNative: true,
  isAndroid: true,
  isIOS: false,
  isWeb: false,
  platform: "android",
  isAppBuild: true,
  hasPlugin: () => false,
  safeNative: async <T,>(_fn: () => Promise<T>, fallback: T) => fallback,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }),
    },
  },
}));

/** Listeners the module registers, keyed by event name, so tests can fire them. */
const listeners = new Map<string, (payload?: unknown) => void>();

const admob = {
  initialize: vi.fn(async () => undefined),
  requestConsentInfo: vi.fn(async () => ({ isConsentFormAvailable: false, canRequestAds: true })),
  showConsentForm: vi.fn(async () => ({ canRequestAds: true })),
  addListener: vi.fn(async (event: string, fn: (payload?: unknown) => void) => {
    listeners.set(event, fn);
    return { remove: () => listeners.delete(event) };
  }),
  showBanner: vi.fn(async () => undefined),
  hideBanner: vi.fn(async () => undefined),
  removeBanner: vi.fn(async () => undefined),
  prepareInterstitial: vi.fn(async () => undefined),
  showInterstitial: vi.fn(async () => undefined),
  prepareRewardVideoAd: vi.fn(async () => undefined),
  showRewardVideoAd: vi.fn(async () => undefined),
  showPrivacyOptionsForm: vi.fn(async () => undefined),
};

vi.mock("@capacitor-community/admob", () => ({
  AdMob: admob,
  AdmobConsentStatus: { REQUIRED: "REQUIRED", NOT_REQUIRED: "NOT_REQUIRED" },
  BannerAdPluginEvents: { SizeChanged: "bannerAdSizeChanged", FailedToLoad: "bannerAdFailedToLoad" },
  BannerAdPosition: { BOTTOM_CENTER: "BOTTOM_CENTER" },
  BannerAdSize: { ADAPTIVE_BANNER: "ADAPTIVE_BANNER" },
  MaxAdContentRating: { General: "General" },
  RewardAdPluginEvents: {
    Rewarded: "onRewarded",
    Dismissed: "onRewardedVideoAdClosed",
    FailedToShow: "onRewardedVideoAdFailedToShow",
  },
}));

vi.mock("@/native/prefs", () => ({
  PREF_KEYS: { adState: "ad_state" },
  prefGetJSON: async (_k: string, fallback: unknown) => fallback,
  prefSetJSON: async () => undefined,
}));

type Ads = typeof import("@/native/ads");

/**
 * A fresh copy of the module for every test.
 *
 * Everything here — whether ads are allowed, whether a banner is up, which ad
 * is loaded — is module-level state that outlives a single test by design, so
 * sharing one import between cases would make the order of the file matter.
 */
async function freshAds(): Promise<Ads> {
  vi.resetModules();
  listeners.clear();
  Object.values(admob).forEach((fn) => fn.mockClear());
  return import("@/native/ads");
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the banner survives arriving before the plan does", () => {
  it("replays a request made before ads were switched on", async () => {
    const ads = await freshAds();

    // The shell's first render: the entitlement has not resolved, so nothing
    // has called applyEntitlement yet.
    await ads.showBanner();
    expect(admob.showBanner).not.toHaveBeenCalled();

    // The company row lands and the account turns out to be ad-funded.
    await ads.applyEntitlement(true);
    expect(admob.showBanner).toHaveBeenCalledTimes(1);
  });

  it("does not replay a request the app has since withdrawn", async () => {
    const ads = await freshAds();

    // Asked for, then withdrawn — the user navigated to an ad-free route while
    // the plan was still loading.
    await ads.showBanner();
    await ads.hideBanner();

    await ads.applyEntitlement(true);
    expect(admob.showBanner).not.toHaveBeenCalled();
  });

  it("shows nothing at all for a paying account", async () => {
    const ads = await freshAds();

    await ads.showBanner();
    await ads.applyEntitlement(false);
    expect(admob.showBanner).not.toHaveBeenCalled();
  });

  it("asks again after a no-fill instead of going quiet for the session", async () => {
    vi.useFakeTimers();
    const ads = await freshAds();

    await ads.applyEntitlement(true);
    await ads.showBanner();
    expect(admob.showBanner).toHaveBeenCalledTimes(1);

    // AdMob had nothing to serve. The dead ad view never retries by itself.
    listeners.get("bannerAdFailedToLoad")?.();
    expect(ads.getBannerHeight()).toBe(0);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(admob.removeBanner).toHaveBeenCalled();
    expect(admob.showBanner).toHaveBeenCalledTimes(2);
  });

  it("stops retrying once the screen no longer wants a banner", async () => {
    vi.useFakeTimers();
    const ads = await freshAds();

    await ads.applyEntitlement(true);
    await ads.showBanner();
    listeners.get("bannerAdFailedToLoad")?.();
    await ads.hideBanner();

    await vi.advanceTimersByTimeAsync(120_000);
    expect(admob.showBanner).toHaveBeenCalledTimes(1);
  });

  it("only reserves height for a banner that is actually up", async () => {
    const ads = await freshAds();

    await ads.applyEntitlement(true);
    await ads.showBanner();
    listeners.get("bannerAdSizeChanged")?.({ height: 50 });
    expect(ads.getBannerHeight()).toBe(50);

    await ads.hideBanner();
    // Removing the ad view re-lays it out, which emits SizeChanged again —
    // sometimes with the old height. Taking that at face value lifted the tab
    // bar off the bottom of the screen with no ad behind it.
    listeners.get("bannerAdSizeChanged")?.({ height: 50 });
    expect(ads.getBannerHeight()).toBe(0);
  });
});

describe("a rewarded ad is not given up on after one failure", () => {
  it("retries a load that came back empty", async () => {
    const ads = await freshAds();
    admob.prepareRewardVideoAd
      .mockRejectedValueOnce(new Error("no fill"))
      .mockResolvedValueOnce(undefined);
    admob.showRewardVideoAd.mockImplementationOnce(async () => {
      listeners.get("onRewarded")?.({ type: "coin", amount: 1 });
    });

    const outcome = await ads.showRewarded();
    expect(outcome.earned).toBe(true);
    expect(admob.prepareRewardVideoAd.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("retries a show that never put an ad on screen", async () => {
    const ads = await freshAds();
    admob.showRewardVideoAd
      .mockImplementationOnce(async () => {
        listeners.get("onRewardedVideoAdFailedToShow")?.();
      })
      .mockImplementationOnce(async () => {
        listeners.get("onRewarded")?.({ type: "coin", amount: 1 });
      });

    const outcome = await ads.showRewarded();
    expect(outcome.earned).toBe(true);
    expect(admob.showRewardVideoAd).toHaveBeenCalledTimes(2);
  });

  it("never replays an ad the merchant closed", async () => {
    const ads = await freshAds();
    admob.showRewardVideoAd.mockImplementation(async () => {
      listeners.get("onRewardedVideoAdClosed")?.();
    });

    const outcome = await ads.showRewarded();
    expect(outcome).toEqual({ earned: false, reason: "dismissed" });
    expect(admob.showRewardVideoAd).toHaveBeenCalledTimes(1);
  });

  it("reloads an ad that has been sitting around too long", async () => {
    const ads = await freshAds();
    admob.showRewardVideoAd.mockImplementation(async () => {
      listeners.get("onRewarded")?.({ type: "coin", amount: 1 });
    });

    expect(await ads.prepareRewarded()).toBe(true);
    expect(ads.isRewardedReady()).toBe(true);

    // Google expires a cached rewarded ad about an hour after it loads, and a
    // stale one does not announce itself — it simply fails to show.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60 * 60 * 1000);
    expect(ads.isRewardedReady()).toBe(false);
    vi.restoreAllMocks();
  });
});
