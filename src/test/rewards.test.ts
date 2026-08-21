/**
 * The rewards money maths, and the degradation contract.
 *
 * These are pure functions on purpose: the discount a customer is shown has to
 * equal the discount the two server functions independently recompute, and the
 * only way that stays true is if the rule is written once and pinned by tests.
 */

import { describe, it, expect } from "vitest";
import { discountedPaise, isFullDiscount, DEFAULT_REWARDS_CONFIG, EMPTY_WALLET } from "@/lib/rewards";

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
