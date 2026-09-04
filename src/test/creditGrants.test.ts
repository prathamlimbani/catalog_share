/**
 * Banking estimates that were bought with points.
 *
 * The points are spent on the server; the wallet they buy into is on the phone.
 * Bridging those two is the only place in this app where a purchase can be lost
 * or duplicated, so the ordering rule is pinned here rather than trusted:
 *
 *   credit the device FIRST, stamp the server SECOND
 *
 * because a crash between the two must leave the grant replayable, and the
 * opposite order leaves a merchant who paid 100 points with nothing to replay.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Native, because the whole credit wallet is: a browser cannot play a rewarded
// ad, creates estimates for free, and must therefore never consume a grant.
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

const pending = vi.fn();
const claim = vi.fn();

vi.mock("@/lib/rewards", () => ({
  fetchPendingCreditGrants: (...args: unknown[]) => pending(...args),
  claimCreditGrant: (...args: unknown[]) => claim(...args),
}));

import {
  applyCreditConfig,
  peekCredits,
  readCredits,
  resetCreditCache,
  syncCreditGrants,
} from "@/lib/estimateCredits";

const CO = "co-1";

beforeEach(() => {
  localStorage.clear();
  resetCreditCache();
  pending.mockReset();
  claim.mockReset();
  claim.mockResolvedValue(true);
  applyCreditConfig({
    enabled: true,
    ads_per_estimate: 2,
    ads_per_edit: 1,
    welcome_credits: 0,
    watch_limit: 20,
    watch_window_hours: 6,
  });
});

describe("syncCreditGrants", () => {
  it("banks a purchase and then tells the server it landed", async () => {
    pending.mockResolvedValue([{ id: "g1", amount: 5, credits: 10, created_at: "x" }]);

    const result = await syncCreditGrants(CO);

    expect(result).toEqual({ credited: 10, estimates: 5 });
    expect(peekCredits(CO).balance).toBe(10);
    expect(claim).toHaveBeenCalledWith("g1");
  });

  it("writes the balance before it stamps, so a failed stamp cannot lose credits", async () => {
    pending.mockResolvedValue([{ id: "g1", amount: 5, credits: 10, created_at: "x" }]);
    // The stamp is what fails here — the order under test is that the credits
    // are already on the device by the time it does.
    let balanceWhenStamped = -1;
    claim.mockImplementation(async () => {
      balanceWhenStamped = peekCredits(CO).balance;
      return false;
    });

    await syncCreditGrants(CO);

    expect(balanceWhenStamped).toBe(10);
    expect(peekCredits(CO).balance).toBe(10);
  });

  it("does not credit the same grant twice, even while the server still lists it", async () => {
    // Exactly the state a failed stamp leaves behind: banked here, unapplied
    // there. The second pass must re-stamp and credit nothing.
    pending.mockResolvedValue([{ id: "g1", amount: 5, credits: 10, created_at: "x" }]);

    await syncCreditGrants(CO);
    const second = await syncCreditGrants(CO);

    expect(second).toEqual({ credited: 0, estimates: 0 });
    expect(peekCredits(CO).balance).toBe(10);
    expect(claim).toHaveBeenCalledTimes(2);
  });

  it("banks several purchases in one pass", async () => {
    pending.mockResolvedValue([
      { id: "g1", amount: 5, credits: 10, created_at: "x" },
      { id: "g2", amount: 10, credits: 20, created_at: "y" },
    ]);

    const result = await syncCreditGrants(CO);

    expect(result).toEqual({ credited: 30, estimates: 15 });
    expect(peekCredits(CO).balance).toBe(30);
  });

  it("adds to whatever was already earned by watching ads", async () => {
    await readCredits(CO);
    pending.mockResolvedValue([{ id: "g1", amount: 5, credits: 10, created_at: "x" }]);
    await syncCreditGrants(CO);
    // A second, unrelated purchase.
    pending.mockResolvedValue([{ id: "g2", amount: 1, credits: 2, created_at: "y" }]);
    await syncCreditGrants(CO);

    expect(peekCredits(CO).balance).toBe(12);
    expect(peekCredits(CO).grants).toEqual(["g1", "g2"]);
  });

  it("does nothing at all with no company", async () => {
    const result = await syncCreditGrants(null);
    expect(result).toEqual({ credited: 0, estimates: 0 });
    expect(pending).not.toHaveBeenCalled();
  });

  it("leaves the row alone when there is nothing pending", async () => {
    pending.mockResolvedValue([]);
    const result = await syncCreditGrants(CO);
    expect(result).toEqual({ credited: 0, estimates: 0 });
    expect(claim).not.toHaveBeenCalled();
  });
});
