import { describe, it, expect } from "vitest";

import {
  OFFLINE_ENTITLEMENT_GRACE_MS,
  TRIAL_DURATION_MS,
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

describe("trial window", () => {
  it("is inactive before the clock has ever been started", () => {
    const ent = getEntitlement({ id: "co-1", subscription_plan: "free" }, NOW);
    expect(ent.trialActive).toBe(false);
    expect(ent.trialEndsAt).toBe(0);
    expect(ent.estimatesUnlocked).toBe(false);
  });

  it("unlocks estimates on the first day", () => {
    const ent = getEntitlement({ trial_started_at: iso(NOW) }, NOW);
    expect(ent.trialActive).toBe(true);
    expect(ent.estimatesUnlocked).toBe(true);
    expect(ent.trialMsRemaining).toBe(TRIAL_DURATION_MS);
  });

  it("is still active one millisecond before the five days are up", () => {
    const started = NOW - TRIAL_DURATION_MS + 1;
    const ent = getEntitlement({ trial_started_at: iso(started) }, NOW);
    expect(ent.trialActive).toBe(true);
    expect(ent.estimatesUnlocked).toBe(true);
    expect(ent.trialMsRemaining).toBe(1);
  });

  it("locks estimates exactly on the boundary, not a tick later", () => {
    const started = NOW - TRIAL_DURATION_MS;
    const ent = getEntitlement({ trial_started_at: iso(started) }, NOW);
    expect(ent.trialActive).toBe(false);
    expect(ent.trialMsRemaining).toBe(0);
    expect(ent.estimatesUnlocked).toBe(false);
  });

  it("stays locked once the trial is well past", () => {
    const ent = getEntitlement({ trial_started_at: iso(NOW - 30 * DAY) }, NOW);
    expect(ent.trialActive).toBe(false);
    expect(ent.estimatesUnlocked).toBe(false);
  });
});

describe("trial clock authority", () => {
  it("prefers the server start over the device stamp", () => {
    // The device claims the trial began a minute ago; the server recorded it a
    // week ago. Believing the device is what let a reinstall mint a new trial.
    const ent = getEntitlement({ trial_started_at: iso(NOW - 7 * DAY) }, NOW, NOW - 60_000);
    expect(ent.trialActive).toBe(false);
    expect(ent.estimatesUnlocked).toBe(false);
  });

  it("falls back to the device stamp when the server has none", () => {
    // A trial that had to start offline is still honoured.
    const ent = getEntitlement({ trial_started_at: null }, NOW, NOW - DAY);
    expect(ent.trialActive).toBe(true);
    expect(ent.trialMsRemaining).toBe(TRIAL_DURATION_MS - DAY);
  });

  it("clamps a device stamp set in the future to the present", () => {
    // A wound-forward clock must not buy more than one fresh trial's worth.
    const ent = getEntitlement({ trial_started_at: null }, NOW, NOW + 365 * DAY);
    expect(ent.trialEndsAt).toBe(NOW + TRIAL_DURATION_MS);
  });
});

describe("plan gate for estimates", () => {
  it("keeps the free plan locked outside a trial", () => {
    const ent = getEntitlement({ subscription_plan: "free" }, NOW);
    expect(ent.isPaid).toBe(false);
    expect(ent.estimatesUnlocked).toBe(false);
    expect(ent.adsEnabled).toBe(true);
  });

  it.each(PAID_PLANS)("unlocks estimates on the %s plan", (plan) => {
    const ent = getEntitlement(paid(plan), NOW);
    expect(ent.isPaid).toBe(true);
    expect(ent.estimatesUnlocked).toBe(true);
    // Nothing a merchant can actually buy may leave estimates locked — that is
    // the exact shape of the bug that put a paying customer back on the paywall.
    expect(getPlan(plan).unlocksEstimates).toBe(true);
    expect(ent.adsEnabled).toBe(false);
  });

  it("never charges a paid plan for ads or the trial UI", () => {
    const ent = getEntitlement({ ...paid("support"), trial_started_at: iso(NOW - 30 * DAY) }, NOW);
    // Trial long gone, plan live: access and ad state come from the plan alone.
    expect(ent.trialActive).toBe(false);
    expect(ent.estimatesUnlocked).toBe(true);
    expect(ent.adsEnabled).toBe(false);
  });

  it("does not let a lapsed trial lock a paying user out", () => {
    const ent = getEntitlement(
      { ...paid("estimate_generate"), trial_started_at: iso(NOW - TRIAL_DURATION_MS) },
      NOW,
    );
    expect(ent.trialActive).toBe(false);
    expect(ent.estimatesUnlocked).toBe(true);
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
    expect(ent.estimatesUnlocked).toBe(false);
    expect(ent.adsEnabled).toBe(true);
    expect(ent.productLimit).toBe(40);
    expect(ent.premiumSkins).toBe(false);
    expect(ent.supportPhoneUnlocked).toBe(false);
    expect(ent.expiresAt).toBe(0);
    expect(ent.daysRemaining).toBe(0);
  });

  it("still honours a trial that is running under an expired plan", () => {
    const ent = getEntitlement(
      { ...paid("growth", -1), trial_started_at: iso(NOW - DAY) },
      NOW,
    );
    expect(ent.isPaid).toBe(false);
    expect(ent.estimatesUnlocked).toBe(true);
  });
});

describe("offline cache", () => {
  const snapshot = (over: Partial<CachedEntitlement> = {}): CachedEntitlement => ({
    plan: "support",
    expires_at: iso(NOW + 20 * DAY),
    trial_started_at: null,
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
    expect(ent?.estimatesUnlocked).toBe(true);
    expect(ent?.adsEnabled).toBe(false);
  });

  it("demotes to free once the grace period is exceeded", () => {
    // Otherwise turning off mobile data is an indefinite free subscription.
    const ent = getEntitlementFromCache(
      snapshot({ fetched_at: NOW - (OFFLINE_ENTITLEMENT_GRACE_MS + 1000) }),
      NOW,
    );
    expect(ent?.isPaid).toBe(false);
    expect(ent?.estimatesUnlocked).toBe(false);
  });

  it("demotes a snapshot whose subscription has expired even if it is fresh", () => {
    const ent = getEntitlementFromCache(snapshot({ expires_at: iso(NOW - 1) }), NOW);
    expect(ent?.isPaid).toBe(false);
  });

  it("honours a device-local trial the snapshot does not know about", () => {
    // The trial that started offline is not in the cached row; without the
    // local stamp the merchant is locked out mid-trial.
    const ent = getEntitlementFromCache(
      snapshot({ plan: "free", expires_at: null }),
      NOW,
      NOW - DAY,
    );
    expect(ent?.trialActive).toBe(true);
    expect(ent?.estimatesUnlocked).toBe(true);
  });

  it("expires that local trial on schedule even offline", () => {
    const ent = getEntitlementFromCache(
      snapshot({ plan: "free", expires_at: null }),
      NOW,
      NOW - TRIAL_DURATION_MS,
    );
    expect(ent?.trialActive).toBe(false);
    expect(ent?.estimatesUnlocked).toBe(false);
  });
});

describe("re-evaluation boundary", () => {
  it("is the trial end while a trial is running", () => {
    const ent = getEntitlement({ trial_started_at: iso(NOW) }, NOW);
    expect(nextEntitlementBoundary(ent)).toBe(NOW + TRIAL_DURATION_MS);
  });

  it("is the subscription expiry for a paid plan", () => {
    const ent = getEntitlement(paid("pro", 10 * DAY), NOW);
    expect(nextEntitlementBoundary(ent)).toBe(NOW + 10 * DAY);
  });

  it("is whichever comes first when both are counting down", () => {
    const ent = getEntitlement({ ...paid("pro", 10 * DAY), trial_started_at: iso(NOW) }, NOW);
    expect(nextEntitlementBoundary(ent)).toBe(NOW + TRIAL_DURATION_MS);
  });

  it("is zero when nothing can change on its own, so no timer is armed", () => {
    expect(nextEntitlementBoundary(freeEntitlement(NOW))).toBe(0);
    const lapsed = getEntitlement({ ...paid("pro", -1), trial_started_at: iso(NOW - 30 * DAY) }, NOW);
    expect(nextEntitlementBoundary(lapsed)).toBe(0);
  });
});
