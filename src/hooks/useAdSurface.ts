import { useEffect, useState, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import { hideBanner, showBanner } from "@/native/ads";
import { adPolicy, loadAdPolicy, onAdPolicyChange, type AdPolicy } from "@/lib/adPolicy";
import type { Entitlement } from "@/lib/entitlement";

/**
 * Where the banner lives.
 *
 * It used to be mounted by the Estimates screen and by nothing else, so a user
 * who spent their session on Products, My Store or Account saw no ads at all
 * and the ad revenue from those screens was simply never collected. The banner
 * is now owned by the app shell and shown on every signed-in screen except the
 * ones below, which is the inverse of the old rule and the reason "there are no
 * ads in the app" was true for most of the app.
 *
 * Two mechanisms decide when it is hidden:
 *
 *   - ROUTES that must never carry an ad, listed here. Payment and receipt
 *     screens are a Play Families/Ads policy matter, not a taste one: an ad
 *     next to a price or a "Pay" button invites a misclick that costs the user
 *     real money.
 *   - SUPPRESSORS, registered by a screen for a reason the route cannot express
 *     — the estimate PDF preview. See `suppressAds`.
 */
const AD_FREE_ROUTES = [
  "/account", // the settings screen — ad-free by request
  "/billing", // includes /billing/receipt/:id — money on screen
  "/earn", // the rewarded-ad screen; a banner here competes with the offer
  "/terms",
  "/privacy",
  "/refund",
  "/account-deletion",
  "/master-admin",
  "/master-login",
];

// ---------------------------------------------------------------------------
// Suppressors
// ---------------------------------------------------------------------------

/**
 * A set rather than a boolean so two screens can suppress at once and neither
 * un-suppresses the other on unmount — the bug that leaves a banner on screen
 * over a PDF preview.
 */
const suppressors = new Set<string>();
const suppressListeners = new Set<() => void>();

function emitSuppression() {
  suppressListeners.forEach((fn) => fn());
}

/** Hide the banner for as long as `on` is true, keyed by a stable reason. */
export function suppressAds(key: string, on: boolean): void {
  const had = suppressors.has(key);
  if (on === had) return;
  if (on) suppressors.add(key);
  else suppressors.delete(key);
  emitSuppression();
}

function subscribeSuppression(fn: () => void): () => void {
  suppressListeners.add(fn);
  return () => suppressListeners.delete(fn);
}

function suppressionSnapshot(): number {
  return suppressors.size;
}

/**
 * Suppress ads while this component is mounted and `active`.
 *
 * The cleanup is what makes it safe: a screen that unmounts mid-navigation
 * releases its suppressor without having to remember to.
 */
export function useSuppressAds(key: string, active: boolean): void {
  useEffect(() => {
    suppressAds(key, active);
    return () => suppressAds(key, false);
  }, [key, active]);
}

// ---------------------------------------------------------------------------
// The banner itself
// ---------------------------------------------------------------------------

/** Live ad policy for the current plan, for components that render around it. */
export function useAdPolicy(entitlement: Entitlement): AdPolicy {
  const [policy, setPolicy] = useState<AdPolicy>(adPolicy);

  useEffect(() => onAdPolicyChange(setPolicy), []);

  useEffect(() => {
    void loadAdPolicy(entitlement.plan);
  }, [entitlement.plan]);

  return policy;
}

/**
 * Own the banner for the app shell.
 *
 * Returns whether an ad is currently being shown, so the shell can offer the
 * "remove ads" upgrade next to it — offering to remove something that is not
 * there reads as a bug.
 */
export function useAdBanner(entitlement: Entitlement): { showingAds: boolean; policy: AdPolicy } {
  const location = useLocation();
  const policy = useAdPolicy(entitlement);
  useSyncExternalStore(subscribeSuppression, suppressionSnapshot, suppressionSnapshot);

  const routeBlocked = AD_FREE_ROUTES.some((prefix) => location.pathname.startsWith(prefix));
  const suppressed = suppressors.size > 0;
  const showingAds = entitlement.adsEnabled && policy.banner && !routeBlocked && !suppressed;

  useEffect(() => {
    if (showingAds) void showBanner();
    else void hideBanner();
  }, [showingAds]);

  // Say WHY, once per change.
  //
  // "No ads are loading" has four completely different causes that look
  // identical on screen — a paid plan, the admin kill switch, an ad-free route,
  // and a transient suppressor — and a fifth, AdMob returning no fill, which
  // this gate never sees. The FailedToLoad handler collapses the banner to zero
  // height, so a no-fill and a closed gate both render as nothing at all.
  // Without this line the only way to tell them apart is to read the database.
  useEffect(() => {
    console.info("[ads] banner gate", {
      showingAds,
      adsEnabled: entitlement.adsEnabled,
      policyBanner: policy.banner,
      routeBlocked,
      suppressed,
      path: location.pathname,
    });
  }, [showingAds, entitlement.adsEnabled, policy.banner, routeBlocked, suppressed, location.pathname]);

  // Leaving the shell entirely (sign-out, a store front, the admin console)
  // must not leave a banner painted over whatever comes next.
  useEffect(() => {
    return () => {
      void hideBanner();
    };
  }, []);

  return { showingAds, policy };
}
