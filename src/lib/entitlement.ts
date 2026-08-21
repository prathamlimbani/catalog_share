/**
 * Entitlement — the single source of truth for "what is this account allowed to do".
 *
 * Before this module the same question was answered in eight different places
 * with eight slightly different answers, which is why a ₹499 `support`
 * subscriber was locked out of Call Support and Premium Skins and was labelled
 * "Free Plan" in emails. Every gate in the app now routes through here.
 *
 * The ad decision lives here too: `adsEnabled === !isPaid`. Nothing else may
 * decide whether ads show.
 */

import { getPlan, getPlanLimit, isPaidPlanId, type PlanId } from "@/lib/plans";
import { trialConfig, trialDurationMs } from "@/lib/trialConfig";

/**
 * Length of the free estimate trial as SHIPPED.
 *
 * The live value comes from `trialDurationMs()`, which the admin console can
 * change without a release. This constant remains the fallback and the figure
 * the tests pin, so a config outage cannot silently shorten anyone's trial.
 */
export const TRIAL_DURATION_MS = 5 * 24 * 60 * 60 * 1000;

/**
 * How long a cached entitlement is trusted once the device goes offline.
 * A paying user on a long flight must not suddenly start seeing ads, but the
 * cache can never outlive the actual subscription expiry.
 */
export const OFFLINE_ENTITLEMENT_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export interface CompanyLike {
  id?: string;
  subscription_plan?: string | null;
  subscription_expires_at?: string | null;
  trial_started_at?: string | null;
}

export interface Entitlement {
  plan: PlanId;
  planName: string;
  isPaid: boolean;
  /** Epoch ms, 0 when there is no active subscription. */
  expiresAt: number;
  /** Whole days left on the subscription; 0 when not subscribed. */
  daysRemaining: number;

  /** THE ad decision. Free (including trial) sees ads; paid never does. */
  adsEnabled: boolean;

  /** Estimate generator is usable (paid, or inside the free trial). */
  estimatesUnlocked: boolean;
  trialActive: boolean;
  trialEndsAt: number;
  trialMsRemaining: number;

  productLimit: number;
  premiumThemes: boolean;
  premiumSkins: boolean;
  supportPhoneUnlocked: boolean;
}

/** Cached copy kept in native Preferences so the app knows the plan offline. */
export interface CachedEntitlement {
  plan: string;
  expires_at: string | null;
  trial_started_at: string | null;
  /** Epoch ms when this snapshot was taken from the server. */
  fetched_at: number;
  /**
   * Which company the snapshot belongs to.
   *
   * Optional because snapshots written by older builds do not carry it. It is
   * what lets the offline path find the device-local trial stamp when the
   * company row itself has not loaded yet — without it, a trial that started
   * offline reads as "never started" and locks a merchant who is still inside
   * their five days.
   */
  company_id?: string | null;
}

function parseTs(value: string | null | undefined): number {
  if (!value) return 0;
  const t = Date.parse(value);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Compute the entitlement for a company row.
 *
 * @param company     the `companies` row (or the offline mirror of it)
 * @param now         injected for testability
 * @param localTrialStart  the DEVICE-local trial stamp, used only as a fallback
 *                    when the server has no start recorded (see below)
 */
export function getEntitlement(
  company: CompanyLike | null | undefined,
  now: number = Date.now(),
  localTrialStart?: number | null,
): Entitlement {
  const plan = (company?.subscription_plan ?? "free") as PlanId;
  const planDef = getPlan(plan);
  const expiresAt = parseTs(company?.subscription_expires_at);

  const isPaid = isPaidPlanId(plan) && expiresAt > now;

  // Authority order for the trial clock is the same as in src/lib/trial.ts:
  // the server column first, the device stamp only when the server has none.
  // The other way round — which is how this read for a while — any device that
  // could write `cs_trial_start_<id>` could hand itself an unlimited trial, and
  // clearing app data handed out a brand-new one. `start_estimate_trial` exists
  // precisely so the start cannot be moved from the device, so the device value
  // must never be allowed to override it.
  const serverStart = parseTs(company?.trial_started_at);
  // A device-only start is additionally clamped to the present: a phone whose
  // clock is wound forward would otherwise push the end date out with it.
  const localStart = localTrialStart && localTrialStart > 0 ? Math.min(localTrialStart, now) : 0;
  const startedAt = serverStart > 0 ? serverStart : localStart;

  const trialEndsAt = startedAt > 0 ? startedAt + trialDurationMs() : 0;
  const trialMsRemaining = trialEndsAt > 0 ? Math.max(0, trialEndsAt - now) : 0;
  // An admin who switches the trial off ends the ones already running. That is
  // the point of the switch — otherwise turning it off would take five days to
  // have any effect and there would be no way to stop an abused promotion.
  const trial = trialConfig();
  const trialActive = trialMsRemaining > 0 && trial.enabled;

  return {
    plan,
    planName: planDef.name,
    isPaid,
    expiresAt: isPaid ? expiresAt : 0,
    daysRemaining: isPaid ? Math.max(0, Math.ceil((expiresAt - now) / 86_400_000)) : 0,

    // Trial users are on the `free` plan, so they DO see ads. This is the only
    // unambiguous reading of "ads for free users, none for paid users".
    adsEnabled: !isPaid,

    // What the trial is worth is configurable too, so a promotion can widen or
    // narrow it without a release.
    estimatesUnlocked: (isPaid && planDef.unlocksEstimates) || (trialActive && trial.unlocksEstimates),
    trialActive,
    trialEndsAt,
    trialMsRemaining,

    productLimit: isPaid ? getPlanLimit(plan) : trial.productLimit,
    premiumThemes: isPaid || (trialActive && trial.unlocksPremiumThemes),
    premiumSkins: isPaid && planDef.unlocksPremiumSkins,
    supportPhoneUnlocked: isPaid && planDef.unlocksCallSupport,
  };
}

/**
 * Entitlement derived from the offline cache.
 *
 * Returns null when the cache is too stale to trust, so the caller can fall
 * back to the free tier rather than granting an indefinite paid plan to anyone
 * who simply turns off mobile data.
 */
export function getEntitlementFromCache(
  cached: CachedEntitlement | null | undefined,
  now: number = Date.now(),
  localTrialStart?: number | null,
): Entitlement | null {
  if (!cached) return null;

  const expiresAt = parseTs(cached.expires_at);
  const cacheExpired = now - cached.fetched_at > OFFLINE_ENTITLEMENT_GRACE_MS;

  // A stale cache may no longer assert a paid plan, but the trial clock is
  // local anyway so it is still safe to honour.
  const plan = cacheExpired || expiresAt <= now ? "free" : cached.plan;

  return getEntitlement(
    {
      subscription_plan: plan,
      subscription_expires_at: cached.expires_at,
      trial_started_at: cached.trial_started_at,
    },
    now,
    localTrialStart,
  );
}

/** The entitlement of a signed-out / unknown account. */
export function freeEntitlement(now: number = Date.now()): Entitlement {
  return getEntitlement({ subscription_plan: "free" }, now);
}

/**
 * The next instant at which this entitlement can change on its own — the trial
 * running out, or the subscription lapsing. 0 when nothing is counting down.
 *
 * Entitlement used to be computed once and then never re-evaluated, so a
 * merchant with the app open when their trial expired kept working until the
 * next cold start. `useEntitlement` arms a single timer on this value instead
 * of polling, which is what makes the lock appear on time without a 1s tick
 * running all day.
 *
 * The returned instant is relative to the clock the entitlement was computed
 * with, so it can be in the past if that clock has since gone stale — callers
 * must treat a non-positive delay as "re-evaluate now".
 */
export function nextEntitlementBoundary(entitlement: Entitlement): number {
  const boundaries: number[] = [];
  if (entitlement.trialActive && entitlement.trialEndsAt > 0) boundaries.push(entitlement.trialEndsAt);
  if (entitlement.isPaid && entitlement.expiresAt > 0) boundaries.push(entitlement.expiresAt);
  return boundaries.length > 0 ? Math.min(...boundaries) : 0;
}
