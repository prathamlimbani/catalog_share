import { describe, it, expect } from "vitest";

import {
  OFFLINE_ENTITLEMENT_GRACE_MS,
  freeEntitlement,
  getEntitlement,
  getEntitlementFromCache,
  nextEntitlementBoundary,
  type CachedEntitlement,
  type CompanyLike,
} from "@/lib/entitlement";
import { PAID_PLANS, getPlan } from "@/lib/plans";

/** A fixed "now" so no test depends on the wall clock. */
const NOW = Date.parse("2026-06-15T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

const DAY = 24 * 60 * 60 * 1000;

/** A company on a paid plan that is still in date. */
const paid = (plan: string, expiresInMs = 20 * DAY): CompanyLike => ({
  id: "co-1",
  subscription_plan: plan,
  subscription_expires_at: iso(NOW + expiresInMs),
});

/**
 * The plans that include estimates outright, and the plans that fund them with
 * ads. Read from the catalogue rather than hardcoded, because the catalogue is
 * what the app actually gates on and the database can move a plan between the
 * two without a release.
 */
const FREE_ESTIMATE_PLANS = PAID_PLANS.filter((p) => getPlan(p).unlocksEstimates);
const AD_FUNDED_PAID_PLANS = PAID_PLANS.filter((p) => !getPlan(p).unlocksEstimates);

describe("estimates are never locked", () => {
  it("does not include estimates on the free plan, and does not lock them either", () => {
    const ent = getEntitlement({ subscription_plan: "free" }, NOW);
    expect(ent.isPaid).toBe(false);
    // `estimatesFree: false` means "pay with ads", NOT "locked out". Nothing in
    // the entitlement may ever shut a merchant out of the Estimates screen —
    // that is the whole difference between this and the trial it replaced.
    expect(ent.estimatesFree).toBe(false);
    expect(ent.adsEnabled).toBe(true);
    expect(ent).not.toHaveProperty("estimatesUnlocked");
  });

  it("carries no trial state at all", () => {
    const ent = getEntitlement({ subscription_plan: "free" }, NOW);
    expect(ent).not.toHaveProperty("trialActive");
    expect(ent).not.toHaveProperty("trialEndsAt");
    expect(ent).not.toHaveProperty("trialMsRemaining");
  });

  it("ignores a historical trial_started_at left on the row", () => {
    // The column survives as history. A build that still writes it must not be
    // able to hand anyone free estimates through it.
    const withTrial = { subscription_plan: "free", trial_started_at: iso(NOW - 1000) };
    expect(getEntitlement(withTrial as CompanyLike, NOW).estimatesFree).toBe(false);
  });
});

describe("which plans pay with ads", () => {
  it.each(FREE_ESTIMATE_PLANS)("includes estimates outright on %s", (plan) => {
    const ent = getEntitlement(paid(plan), NOW);
    expect(ent.isPaid).toBe(true);
    expect(ent.estimatesFree).toBe(true);
    expect(ent.adsEnabled).toBe(false);
  });

  it.each(AD_FUNDED_PAID_PLANS)("funds estimates with ads on %s", (plan) => {
    const ent = getEntitlement(paid(plan), NOW);
    // A paid plan, so no banners follow them around...
    expect(ent.isPaid).toBe(true);
    expect(ent.adsEnabled).toBe(false);
    // ...but an estimate still costs rewarded ads. Both are correct at once,
    // and conflating them is the bug this split exists to prevent.
    expect(ent.estimatesFree).toBe(false);
  });

  it("puts growth on the ad-funded side and the estimate plans on the free side", () => {
    // Pins the answer the product actually asked for, so a catalogue edit that
    // silently gives ₹199 unlimited estimates fails here rather than in the
    // revenue numbers.
    expect(getEntitlement(paid("growth"), NOW).estimatesFree).toBe(false);
    expect(getEntitlement(paid("pro"), NOW).estimatesFree).toBe(true);
    expect(getEntitlement(paid("estimate_generate"), NOW).estimatesFree).toBe(true);
    expect(getEntitlement(paid("support"), NOW).estimatesFree).toBe(true);
  });

  it("reports whole days remaining on the subscription", () => {
    const ent = getEntitlement(paid("pro", 3 * DAY), NOW);
    expect(ent.daysRemaining).toBe(3);
    expect(ent.expiresAt).toBe(NOW + 3 * DAY);
  });
});

describe("expired paid plan", () => {
  it("falls back to the free tier the moment the subscription lapses", () => {
    const ent = getEntitlement(paid("support", -1), NOW);
    expect(ent.isPaid).toBe(false);
    expect(ent.plan).toBe("support");
    expect(ent.planName).toBe("Monthly Support Subscription");
    // Not locked — ad-funded. A lapsed merchant keeps working and pays in
    // attention until they renew.
    expect(ent.estimatesFree).toBe(false);
    expect(ent.adsEnabled).toBe(true);
    expect(ent.productLimit).toBe(40);
    expect(ent.premiumSkins).toBe(false);
    expect(ent.supportPhoneUnlocked).toBe(false);
    expect(ent.expiresAt).toBe(0);
    expect(ent.daysRemaining).toBe(0);
  });
});

describe("product slots bought with points", () => {
  it("adds the bonus on top of the plan's own limit", () => {
    const ent = getEntitlement({ subscription_plan: "free", bonus_product_limit: 5 }, NOW);
    expect(ent.productLimit).toBe(45);
    expect(ent.bonusProductLimit).toBe(5);
  });

  it("keeps the bonus when the subscription lapses", () => {
    // The slots were paid for with ads that have already been watched. A plan
    // expiring must not take them back — the merchant would silently be over
    // their limit on a catalogue they were told they owned room for.
    const ent = getEntitlement(
      { ...paid("pro", -1), bonus_product_limit: 5 },
      NOW,
    );
    expect(ent.isPaid).toBe(false);
    expect(ent.productLimit).toBe(45);
    expect(ent.bonusProductLimit).toBe(5);
  });

  it("stacks with a paid plan rather than replacing it", () => {
    const ent = getEntitlement({ ...paid("growth"), bonus_product_limit: 10 }, NOW);
    expect(ent.productLimit).toBe(getPlan("growth").productLimit + 10);
  });

  it("treats a missing, negative or nonsense bonus as none", () => {
    expect(getEntitlement({ subscription_plan: "free" }, NOW).productLimit).toBe(40);
    expect(
      getEntitlement({ subscription_plan: "free", bonus_product_limit: -5 }, NOW).productLimit,
    ).toBe(40);
    expect(
      getEntitlement(
        { subscription_plan: "free", bonus_product_limit: "abc" as unknown as number },
        NOW,
      ).productLimit,
    ).toBe(40);
  });

  it("survives a cache too stale to trust the plan itself", () => {
    // Staleness is a statement about a subscription that may have lapsed.
    // Bought slots cannot lapse, so being offline for a week must not take them.
    const ent = getEntitlementFromCache(
      {
        plan: "pro",
        expires_at: iso(NOW + 20 * DAY),
        fetched_at: NOW - OFFLINE_ENTITLEMENT_GRACE_MS - 1,
        bonus_product_limit: 5,
      },
      NOW,
    );
    expect(ent?.isPaid).toBe(false);
    expect(ent?.productLimit).toBe(45);
  });
});

describe("offline cache", () => {
  const snapshot = (over: Partial<CachedEntitlement> = {}): CachedEntitlement => ({
    plan: "support",
    expires_at: iso(NOW + 20 * DAY),
    fetched_at: NOW,
    company_id: "co-1",
    ...over,
  });

  it("returns null when there is nothing cached", () => {
    expect(getEntitlementFromCache(null, NOW)).toBeNull();
  });

  it("keeps a paid plan alive inside the grace period", () => {
    const ent = getEntitlementFromCache(
      snapshot({ fetched_at: NOW - (OFFLINE_ENTITLEMENT_GRACE_MS - 1000) }),
      NOW,
    );
    expect(ent?.isPaid).toBe(true);
    expect(ent?.estimatesFree).toBe(true);
    expect(ent?.adsEnabled).toBe(false);
  });

  it("demotes to free once the grace period is exceeded", () => {
    // Otherwise turning off mobile data is an indefinite free subscription.
    const ent = getEntitlementFromCache(
      snapshot({ fetched_at: NOW - (OFFLINE_ENTITLEMENT_GRACE_MS + 1000) }),
      NOW,
    );
    expect(ent?.isPaid).toBe(false);
    expect(ent?.estimatesFree).toBe(false);
  });

  it("demotes a snapshot whose subscription has expired even if it is fresh", () => {
    const ent = getEntitlementFromCache(snapshot({ expires_at: iso(NOW - 1) }), NOW);
    expect(ent?.isPaid).toBe(false);
  });
});

describe("the signed-out default", () => {
  it("is the free tier, with ads and ad-funded estimates", () => {
    const ent = freeEntitlement(NOW);
    expect(ent.plan).toBe("free");
    expect(ent.isPaid).toBe(false);
    expect(ent.adsEnabled).toBe(true);
    expect(ent.estimatesFree).toBe(false);
  });
});

describe("re-evaluation boundary", () => {
  it("is the subscription expiry for a paid plan", () => {
    const ent = getEntitlement(paid("pro", 5 * DAY), NOW);
    expect(nextEntitlementBoundary(ent)).toBe(NOW + 5 * DAY);
  });

  it("is zero for a free account, so no timer is armed at all", () => {
    // Nothing counts down any more — the trial that used to was the only other
    // boundary, and a timer with nothing to fire for is pure battery drain.
    expect(nextEntitlementBoundary(freeEntitlement(NOW))).toBe(0);
  });

  it("is zero once a paid plan has lapsed", () => {
    expect(nextEntitlementBoundary(getEntitlement(paid("pro", -1), NOW))).toBe(0);
  });
});
