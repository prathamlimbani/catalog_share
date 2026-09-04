/**
 * Which ad formats the signed-in account may be shown.
 *
 * `entitlement.adsEnabled` answers "may this account be SHOWN ads" — it is
 * false for paying subscribers and true for everyone else. This module answers
 * the narrower question the admin console controls: *which* formats, for
 * *which* plan.
 *
 * Neither governs rewarded ads a merchant opts into to fund an estimate. Those
 * are user-initiated and always available (see src/lib/estimateCredits.ts),
 * which is why a paying Growth subscriber sees no banners and still watches two
 * ads per estimate.
 *
 * Both have to agree before an ad is requested. Splitting them this way is what
 * lets an admin turn banners off for a promotion without a release — which
 * matters because the formats were previously decided by the bundle, and half
 * of them were never wired up at all: the banner was mounted on the Estimates
 * screen and nowhere else, so most of the app showed no ads whatsoever.
 *
 * Fails OPEN for a free account (show the banner) and CLOSED for interstitials,
 * because a missing banner is invisible and a surprise full-screen ad is not.
 */

import { supabase } from "@/integrations/supabase/client";
import { isNative } from "@/native/platform";

export interface AdPolicy {
  banner: boolean;
  interstitial: boolean;
  rewarded: boolean;
  /**
   * Vestigial. It drove the per-day quota gate the credit wallet replaced, and
   * the migration zeroes it. Kept on the type so an older row still parses.
   */
  dailyEstimates: number;
  /** Master switch from app_settings.ads.enabled. */
  adsEnabled: boolean;
}

/**
 * What applies before the config has loaded, and if it never does.
 *
 * Banner on, interstitial off: a banner that appears a second late looks like
 * nothing at all, whereas an interstitial shown on a stale default interrupts
 * someone mid-task. Rewarded is on because it is always user-initiated.
 */
const DEFAULT_POLICY: AdPolicy = {
  banner: true,
  interstitial: false,
  rewarded: true,
  dailyEstimates: 0,
  adsEnabled: true,
};

/** Nothing at all, for paid accounts and for the web build. */
export const NO_ADS: AdPolicy = {
  banner: false,
  interstitial: false,
  rewarded: false,
  dailyEstimates: 0,
  adsEnabled: false,
};

let current: AdPolicy = DEFAULT_POLICY;
let loadedFor: string | null = null;
let inFlight: Promise<AdPolicy> | null = null;

type Listener = (policy: AdPolicy) => void;
const listeners = new Set<Listener>();

/** Subscribe to policy changes. Fires immediately with what is known now. */
export function onAdPolicyChange(fn: Listener): () => void {
  listeners.add(fn);
  fn(current);
  return () => listeners.delete(fn);
}

function publish(next: AdPolicy): void {
  const unchanged =
    next.banner === current.banner &&
    next.interstitial === current.interstitial &&
    next.rewarded === current.rewarded &&
    next.dailyEstimates === current.dailyEstimates &&
    next.adsEnabled === current.adsEnabled;
  current = next;
  if (unchanged) return;
  listeners.forEach((fn) => {
    try {
      fn(next);
    } catch {
      /* a listener must not break the ad pipeline */
    }
  });
}

/** The policy as last loaded. Synchronous, for render paths. */
export function adPolicy(): AdPolicy {
  return current;
}

interface LooseFrom {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): {
        maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
  };
}

/**
 * Load the policy for a plan.
 *
 * Deliberately re-fetches whenever the plan changes rather than caching on a
 * timer: a plan change is exactly the moment the answer must be right, and it
 * is one request.
 */
export async function loadAdPolicy(planId: string): Promise<AdPolicy> {
  if (!isNative) {
    publish(NO_ADS);
    return NO_ADS;
  }

  if (loadedFor === planId && inFlight) return inFlight;
  if (loadedFor === planId) return current;

  loadedFor = planId;
  inFlight = (async () => {
    try {
      const client = supabase as unknown as LooseFrom;
      const [{ data: adsRow }, { data: policyRow }] = await Promise.all([
        client.from("app_settings").select("value").eq("key", "ads").maybeSingle(),
        client.from("plan_ad_policy").select("*").eq("plan_id", planId).maybeSingle(),
      ]);

      const ads = ((adsRow as { value?: Record<string, unknown> } | null)?.value ?? {}) as Record<
        string,
        unknown
      >;
      const row = (policyRow ?? {}) as Record<string, unknown>;
      const masterOn = ads.enabled !== false;

      // A plan with no row is governed by the defaults rather than by silence.
      const next: AdPolicy = {
        adsEnabled: masterOn,
        banner: masterOn && row.show_banner !== false,
        interstitial: masterOn && row.show_interstitial === true,
        rewarded: masterOn && row.show_rewarded !== false,
        dailyEstimates: Number(row.daily_estimates ?? 0) || 0,
      };

      publish(next);
      return next;
    } catch (err) {
      console.warn("[ads] policy unavailable, using defaults:", err);
      publish(DEFAULT_POLICY);
      return DEFAULT_POLICY;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Forget the loaded policy so the next call re-reads it. */
export function invalidateAdPolicy(): void {
  loadedFor = null;
  inFlight = null;
}
