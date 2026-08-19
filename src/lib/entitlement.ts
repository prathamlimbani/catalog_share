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

/** Length of the free estimate trial. */
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
 * @param trialStart  epoch ms of trial start; falls back to company.trial_started_at
 */
export function getEntitlement(
  company: CompanyLike | null | undefined,
  now: number = Date.now(),
  trialStart?: number | null,
): Entitlement {
  const plan = (company?.subscription_plan ?? "free") as PlanId;
  const planDef = getPlan(plan);
  const expiresAt = parseTs(company?.subscription_expires_at);

  const isPaid = isPaidPlanId(plan) && expiresAt > now;

  const startedAt = trialStart ?? parseTs(company?.trial_started_at);
  const trialEndsAt = startedAt > 0 ? startedAt + TRIAL_DURATION_MS : 0;
  const trialMsRemaining = trialEndsAt > 0 ? Math.max(0, trialEndsAt - now) : 0;
  const trialActive = trialMsRemaining > 0;

  return {
    plan,
    planName: planDef.name,
    isPaid,
    expiresAt: isPaid ? expiresAt : 0,
    daysRemaining: isPaid ? Math.max(0, Math.ceil((expiresAt - now) / 86_400_000)) : 0,

    // Trial users are on the `free` plan, so they DO see ads. This is the only
    // unambiguous reading of "ads for free users, none for paid users".
    adsEnabled: !isPaid,

    estimatesUnlocked: (isPaid && planDef.unlocksEstimates) || trialActive,
    trialActive,
    trialEndsAt,
    trialMsRemaining,

    productLimit: isPaid ? getPlanLimit(plan) : 40,
    premiumThemes: isPaid,
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
  );
}

/** The entitlement of a signed-out / unknown account. */
export function freeEntitlement(now: number = Date.now()): Entitlement {
  return getEntitlement({ subscription_plan: "free" }, now);
}
