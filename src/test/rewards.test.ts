/**
 * The rewards money maths, and the degradation contract.
 *
 * These are pure functions on purpose: the discount a customer is shown has to
 * equal the discount the two server functions independently recompute, and the
 * only way that stays true is if the rule is written once and pinned by tests.
 */

import { describe, it, expect } from "vitest";
import {
  discountedPaise,
  offerKindOf,
  isFullDiscount,
  merchantReason,
  redeemFailureReason,
  DEFAULT_REWARDS_CONFIG,
  EMPTY_WALLET,
  GENERIC_FAILURE,
  OFFLINE_FAILURE,
} from "@/lib/rewards";

describe("discountedPaise", () => {
  it("charges the full price with no discount", () => {
    expect(discountedPaise(199, 0)).toBe(19900);
    expect(discountedPaise(399, 0)).toBe(39900);
  });

  it("applies a percentage", () => {
    expect(discountedPaise(199, 50)).toBe(9950);
    expect(discountedPaise(400, 25)).toBe(30000);
    expect(discountedPaise(349, 10)).toBe(31410);
  });

  it("rounds to whole paise rather than leaving a fraction", () => {
    // 199 * 100 * 0.67 = 13333.0 exactly; 33% of 19900 is 6567 off.
    const result = discountedPaise(199, 33);
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBe(13333);
  });

  it("never returns less than one rupee, because Razorpay rejects a smaller order", () => {
    // A 100% coupon must not produce a zero-rupee order. The caller is expected
    // to take the direct-grant path instead; this floor exists so that a caller
    // which does not still fails safe rather than sending 0 to Razorpay.
    expect(discountedPaise(199, 100)).toBe(100);
    expect(discountedPaise(499, 100)).toBe(100);
    // 99.9% of a cheap plan also floors.
    expect(discountedPaise(1, 99)).toBe(100);
  });

  it("is monotonic: a bigger discount never costs more", () => {
    let previous = Infinity;
    for (let percent = 0; percent <= 100; percent += 5) {
      const paise = discountedPaise(399, percent);
      expect(paise).toBeLessThanOrEqual(previous);
      previous = paise;
    }
  });
});

describe("isFullDiscount", () => {
  it("is true only at 100 or above", () => {
    expect(isFullDiscount(100)).toBe(true);
    expect(isFullDiscount(99)).toBe(false);
    expect(isFullDiscount(0)).toBe(false);
  });
});

describe("safe defaults", () => {
  it("disables earning by default", () => {
    // Fail CLOSED. An Earn screen that cannot credit anything is worse than no
    // Earn screen, because the merchant watches ads for nothing.
    expect(DEFAULT_REWARDS_CONFIG.enabled).toBe(false);
  });

  it("still carries a sane economy so the UI can render before config loads", () => {
    expect(DEFAULT_REWARDS_CONFIG.pointsPerAd).toBeGreaterThan(0);
    expect(DEFAULT_REWARDS_CONFIG.dailyAdCap).toBeGreaterThan(0);
    expect(DEFAULT_REWARDS_CONFIG.pointsLabel).toBeTruthy();
  });

  it("has an empty wallet that is safe to render", () => {
    expect(EMPTY_WALLET.balance).toBe(0);
    expect(Array.isArray(EMPTY_WALLET.entries)).toBe(true);
    expect(EMPTY_WALLET.entries).toHaveLength(0);
    expect(EMPTY_WALLET.earnedToday).toBe(0);
  });
});

/**
 * Why these are worth pinning.
 *
 * Every merchant redemption failed for days because
 * `guard_company_subscription_columns()` raised on the plan UPDATE inside
 * `redeem_reward_offer`, and the client collapsed that P0001 into one generic
 * apology. Nobody could tell a blocked grant from a flaky network, so nobody
 * looked at the trigger. Two rules keep that from recurring: the SQLSTATEs stay
 * distinguishable, and — the part that actually broke — every sentence written
 * here has to SURVIVE the fingerprint filter that runs after it.
 */
// PGRST* are PostgREST's own codes, not SQLSTATEs: they arrive when the call
// never reached Postgres, which is exactly what an unapplied migration looks
// like from the phone.
const SQLSTATES = [
  "P0001",
  "23514",
  "42883",
  "42P01",
  "42501",
  "PGRST202",
  "PGRST301",
  undefined,
];

describe("redeemFailureReason", () => {
  it("names the blocked grant distinctly from every other failure", () => {
    const blocked = redeemFailureReason({ code: "P0001" });
    const others = SQLSTATES.filter((c) => c !== "P0001").map((code) =>
      redeemFailureReason({ code }),
    );
    for (const other of others) expect(other).not.toBe(blocked);
  });

  it("tells the merchant their points are safe on every failure", () => {
    // A shopkeeper who believes they have been debited will not tap again, and
    // will not tell us the balance is intact. The RPC is one transaction, so
    // any failure that reaches here rolled the spend back.
    for (const code of SQLSTATES) {
      expect(redeemFailureReason({ code })).toMatch(/nothing was charged/i);
    }
  });

  it("survives the filter that runs after it", () => {
    // This is the regression. A reason containing "function " or "relation " —
    // easy words to reach for when describing a database problem — is swapped
    // for GENERIC_FAILURE downstream, and the specific message never lands.
    for (const code of SQLSTATES) {
      const written = redeemFailureReason({ code });
      expect(merchantReason(written)).toBe(written);
    }
  });

  it("falls back rather than throwing on an unknown code", () => {
    expect(redeemFailureReason({ code: "XX999", message: "boom" })).toBeTruthy();
    expect(redeemFailureReason({})).toBeTruthy();
  });
});

describe("merchantReason", () => {
  it("passes a sentence written for a merchant through untouched", () => {
    const written = "You are on the pro plan until 12 Sep 2026. Redeem this once it ends.";
    expect(merchantReason(written)).toBe(written);
  });

  it("swaps anything carrying a database fingerprint", () => {
    expect(
      merchantReason("Could not find the function public.redeem_reward_offer in the schema cache"),
    ).toBe(GENERIC_FAILURE);
    expect(merchantReason("new row violates row-level security policy")).toBe(GENERIC_FAILURE);
  });

  it("says it is the connection when it is the connection", () => {
    expect(merchantReason("TypeError: Failed to fetch")).toBe(OFFLINE_FAILURE);
    expect(merchantReason("Network request failed")).toBe(OFFLINE_FAILURE);
  });

  it("treats an empty or over-long reason as no reason at all", () => {
    expect(merchantReason("")).toBe(GENERIC_FAILURE);
    expect(merchantReason(undefined)).toBe(GENERIC_FAILURE);
    expect(merchantReason("a".repeat(241))).toBe(GENERIC_FAILURE);
  });
});

describe("offerKindOf", () => {
  it("recognises the three kinds an offer can be", () => {
    expect(offerKindOf("plan_days")).toBe("plan_days");
    expect(offerKindOf("estimate_credits")).toBe("estimate_credits");
    expect(offerKindOf("product_slots")).toBe("product_slots");
  });

  it("reads a row with no kind at all as plan days", () => {
    // A database that has not had 20260829000000 applied has no `kind` column,
    // so every offer it returns is the original shape. Guessing anything else
    // would print "5 estimates" on a card that grants a subscription.
    expect(offerKindOf(undefined)).toBe("plan_days");
    expect(offerKindOf(null)).toBe("plan_days");
    expect(offerKindOf("")).toBe("plan_days");
  });

  it("falls back rather than trusting a value the CHECK would have refused", () => {
    expect(offerKindOf("free_pony")).toBe("plan_days");
    expect(offerKindOf(42)).toBe("plan_days");
  });
});
