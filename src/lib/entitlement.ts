/**
 * Entitlement — the single source of truth for "what is this account allowed to do".
 *
 * Before this module the same question was answered in eight different places
 * with eight slightly different answers, which is why a ₹499 `support`
 * subscriber was locked out of Call Support and Premium Skins and was labelled
 * "Free Plan" in emails. Every gate in the app now routes through here.
 *
 * The ad decision lives here too: `adsEnabled === !isPaid`. Nothing else may
 * decide whether ads are SHOWN at someone.
 *
 * ESTIMATES ARE A SEPARATE QUESTION, and the reason is worth stating. Ads shown
 * at a user and ads a user opts into are different things under Play policy and
 * different things commercially. `adsEnabled` governs the first — banners and
 * interstitials, which a paying merchant never sees. `estimatesFree` governs
 * the second: whether this plan gets estimates outright, or funds them by
 * choosing to watch rewarded ads (see src/lib/estimateCredits.ts). A Growth
 * subscriber is `adsEnabled: false` and `estimatesFree: false` at the same
 * time, and both are correct — no banners follow them around, and an estimate
 * still costs two ads.
 *
 * There is no free trial. It was removed along with the daily upsell dialog;
 * `trial_started_at` survives in the database as history and is read by nothing
 * here.
 */

import { getPlan, getPlanLimit, isPaidPlanId, type PlanId } from "@/lib/plans";

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
  /** Product slots bought with points. Added to the plan's limit, never replacing it. */
  bonus_product_limit?: number | null;
}

export interface Entitlement {
  plan: PlanId;
  planName: string;
  isPaid: boolean;
  /** Epoch ms, 0 when there is no active subscription. */
  expiresAt: number;
  /** Whole days left on the subscription; 0 when not subscribed. */
  daysRemaining: number;

  /** THE ad decision, for ads shown AT the user. Paid plans never see them. */
  adsEnabled: boolean;

  /**
   * This plan creates and edits estimates at no cost — Pro, Estimate Generator
   * and Support, driven by `plans.unlocks_estimates`.
   *
   * False does NOT mean locked out. It means each estimate is paid for with
   * rewarded ads through the credit wallet. Nobody is ever shut out of the
   * Estimates screen, which is why there is no `estimatesLocked` any more.
   */
  estimatesFree: boolean;

  /** The plan's allowance PLUS any slots bought with points. */
  productLimit: number;
  /**
   * The bought part of that number, on its own.
   *
   * Kept separate so a screen can say "40 + 5 you own" rather than a bare 45
   * that looks like the plan changed. It is also what survives a downgrade:
   * `productLimit` falls back to the free tier when a subscription lapses, this
   * does not.
   */
  bonusProductLimit: number;
  premiumThemes: boolean;
  premiumSkins: boolean;
  supportPhoneUnlocked: boolean;
}

/** Cached copy kept in native Preferences so the app knows the plan offline. */
export interface CachedEntitlement {
  plan: string;
  expires_at: string | null;
  /** Epoch ms when this snapshot was taken from the server. */
  fetched_at: number;
  /** Which company the snapshot belongs to. Optional on older snapshots. */
  company_id?: string | null;
  /** Product slots bought with points. Optional on older snapshots. */
  bonus_product_limit?: number | null;
}

function parseTs(value: string | null | undefined): number {
  if (!value) return 0;
  const t = Date.parse(value);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Product slots bought with points, as a number that can be added to a limit.
 *
 * Clamped rather than trusted. The column has a CHECK behind it, but this also
 * reads the offline mirror, which is a file on a phone — a corrupted value
 * there must degrade to "no bonus", never to a negative limit that locks a
 * merchant out of their own catalogue.
 */
function bonusSlots(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 5000) : 0;
}

/**
 * Compute the entitlement for a company row.
 *
 * @param company  the `companies` row (or the offline mirror of it)
 * @param now      injected for testability
 */
export function getEntitlement(
  company: CompanyLike | null | undefined,
  now: number = Date.now(),
): Entitlement {
  const plan = (company?.subscription_plan ?? "free") as PlanId;
  const planDef = getPlan(plan);
  const expiresAt = parseTs(company?.subscription_expires_at);

  const isPaid = isPaidPlanId(plan) && expiresAt > now;
  const bonus = bonusSlots(company?.bonus_product_limit);

  return {
    plan,
    planName: planDef.name,
    isPaid,
    expiresAt: isPaid ? expiresAt : 0,
    daysRemaining: isPaid ? Math.max(0, Math.ceil((expiresAt - now) / 86_400_000)) : 0,

    adsEnabled: !isPaid,

    // A lapsed subscription falls back to ad-funded estimates rather than to a
    // lockout: the merchant keeps working, they just pay attention instead of
    // rupees until they renew.
    estimatesFree: isPaid && planDef.unlocksEstimates,

    // Slots bought with points are added on top and are NOT lost when a plan
    // lapses: they were paid for with ads that have already been watched.
    productLimit: getPlanLimit(isPaid ? plan : "free") + bonus,
    bonusProductLimit: bonus,
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
  const plan = cacheExpired || expiresAt <= now ? "free" : cached.plan;

  return getEntitlement(
    {
      subscription_plan: plan,
      subscription_expires_at: cached.expires_at,
      // Carried through even when the cache is too stale to trust for the PLAN.
      // Staleness is about a subscription that may have lapsed; bought slots
      // cannot lapse, so demoting them would take away something permanent
      // because the phone happened to be offline for a week.
      bonus_product_limit: cached.bonus_product_limit ?? 0,
    },
    now,
  );
}

/** The entitlement of a signed-out / unknown account. */
export function freeEntitlement(now: number = Date.now()): Entitlement {
  return getEntitlement({ subscription_plan: "free" }, now);
}

/**
 * The next instant at which this entitlement can change on its own — now only
 * the subscription lapsing, since the trial that used to count down beside it
 * is gone. 0 when nothing is counting down.
 *
 * Entitlement used to be computed once and then never re-evaluated, so a
 * merchant with the app open when their plan expired kept the paid features
 * until the next cold start. `useEntitlement` arms a single timer on this value
 * instead of polling.
 *
 * The returned instant is relative to the clock the entitlement was computed
 * with, so it can be in the past if that clock has since gone stale — callers
 * must treat a non-positive delay as "re-evaluate now".
 */
export function nextEntitlementBoundary(entitlement: Entitlement): number {
  return entitlement.isPaid && entitlement.expiresAt > 0 ? entitlement.expiresAt : 0;
}
