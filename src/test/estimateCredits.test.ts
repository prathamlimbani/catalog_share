/**
 * The estimate-credit economy.
 *
 * These are the numbers a merchant is asked to watch ads for, so the rules get
 * pinned rather than trusted: what an estimate costs, what an edit costs, that
 * a failed spend takes nothing, and that the rolling ad limit both blocks at the
 * right count and un-blocks at the right moment.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  DEFAULT_CREDIT_CONFIG,
  applyCreditConfig,
  adsStillNeeded,
  canAfford,
  costOf,
  creditConfig,
  creditsEnforced,
  estimatesFrom,
  formatUntil,
  grantCredits,
  noteAdWatched,
  noteAdWatchedForPoints,
  peekCredits,
  readCredits,
  resetCreditCache,
  snapshotOf,
  spendCredits,
  syncCreditGrants,
  watchAllowance,
  type CreditState,
} from "@/lib/estimateCredits";

const CO = "co-1";
const HOUR = 3_600_000;

/** A wallet with a given balance and a given set of recent watches. */
const state = (balance: number, watches: number[] = []): CreditState => ({
  balance,
  welcomed: true,
  watches,
  watchedTotal: watches.length,
  spentTotal: 0,
  grants: [],
});

beforeEach(() => {
  localStorage.clear();
  resetCreditCache();
  applyCreditConfig({
    enabled: true,
    ads_per_estimate: 2,
    ads_per_edit: 1,
    welcome_credits: 2,
    watch_limit: 20,
    watch_window_hours: 6,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the price of an estimate", () => {
  it("costs two ads to create and one to edit", () => {
    expect(costOf("create")).toBe(2);
    expect(costOf("edit")).toBe(1);
  });

  it("counts two watched ads as one estimate, and six as three", () => {
    // The exact promise made to the merchant, in the exact words they were
    // given: watch 2 for 1, watch 6 for 3.
    expect(estimatesFrom(2)).toBe(1);
    expect(estimatesFrom(6)).toBe(3);
  });

  it("never rounds a part-paid estimate up", () => {
    expect(estimatesFrom(1)).toBe(0);
    expect(estimatesFrom(5)).toBe(2);
  });

  it("reports the leftover credits separately from whole estimates", () => {
    const snap = snapshotOf(state(5));
    expect(snap.estimates).toBe(2);
    expect(snap.spare).toBe(1);
  });

  it("says how many more ads are still owed", () => {
    expect(adsStillNeeded(state(0), "create")).toBe(2);
    expect(adsStillNeeded(state(1), "create")).toBe(1);
    expect(adsStillNeeded(state(2), "create")).toBe(0);
    expect(adsStillNeeded(state(0), "edit")).toBe(1);
  });

  it("knows an edit is affordable when a create is not", () => {
    // The whole reason an edit is cheaper: one banked ad buys a correction.
    expect(canAfford(state(1), "edit")).toBe(true);
    expect(canAfford(state(1), "create")).toBe(false);
  });
});

describe("earning and spending", () => {
  it("gives the welcome credits exactly once", async () => {
    const first = await readCredits(CO);
    expect(first.balance).toBe(2);
    expect(first.welcomed).toBe(true);

    // A second read must not top anyone up, and neither must a fresh process
    // reading the same persisted row back.
    expect((await readCredits(CO)).balance).toBe(2);
    resetCreditCache();
    applyCreditConfig({ welcome_credits: 2 });
    expect((await readCredits(CO)).balance).toBe(2);
  });

  it("credits one credit per finished ad", async () => {
    await readCredits(CO);
    await noteAdWatched(CO);
    await noteAdWatched(CO);
    expect(peekCredits(CO).balance).toBe(4);
    expect(peekCredits(CO).watchedTotal).toBe(2);
  });

  it("spends the create price and leaves the rest", async () => {
    await readCredits(CO); // 2
    await noteAdWatched(CO); // 3
    expect(await spendCredits(CO, "create")).toBe(true);
    expect(peekCredits(CO).balance).toBe(1);
    expect(peekCredits(CO).spentTotal).toBe(2);
  });

  it("refuses a spend it cannot cover, and takes nothing", async () => {
    resetCreditCache();
    applyCreditConfig({ welcome_credits: 0 });
    await readCredits(CO);
    await noteAdWatched(CO); // 1 credit — not enough to create

    expect(await spendCredits(CO, "create")).toBe(false);
    // A half-charge is the one outcome that would be worse than refusing: the
    // merchant loses an ad AND does not get the estimate.
    expect(peekCredits(CO).balance).toBe(1);
    expect(peekCredits(CO).spentTotal).toBe(0);
  });

  it("lets an edit spend the odd credit a create could not", async () => {
    resetCreditCache();
    applyCreditConfig({ welcome_credits: 0 });
    await readCredits(CO);
    await noteAdWatched(CO);
    expect(await spendCredits(CO, "edit")).toBe(true);
    expect(peekCredits(CO).balance).toBe(0);
  });

  it("credits a direct grant without touching the ad limit", async () => {
    await readCredits(CO);
    await grantCredits(CO, 4);
    expect(peekCredits(CO).balance).toBe(6);
    // An admin apology is not an ad, so it must not eat into the merchant's
    // ability to watch real ones.
    expect(watchAllowance(peekCredits(CO)).used).toBe(0);
  });

  it("does nothing at all without a company", async () => {
    expect(await spendCredits(null, "create")).toBe(false);
    expect((await readCredits(undefined)).balance).toBe(0);
  });
});

describe("the rolling watch limit", () => {
  it("allows twenty ads and blocks the twenty-first", () => {
    const now = Date.parse("2026-06-15T12:00:00.000Z");
    const watches = Array.from({ length: 20 }, (_, i) => now - i * 60_000);

    const at19 = watchAllowance(state(0, watches.slice(0, 19)), creditConfig(), now);
    expect(at19.allowed).toBe(true);
    expect(at19.remaining).toBe(1);

    const at20 = watchAllowance(state(0, watches), creditConfig(), now);
    expect(at20.allowed).toBe(false);
    expect(at20.used).toBe(20);
    expect(at20.remaining).toBe(0);
  });

  it("frees a slot six hours after the ad that filled it, not at a clock boundary", () => {
    const now = Date.parse("2026-06-15T12:00:00.000Z");
    const oldest = now - 5 * HOUR;
    const watches = [oldest, ...Array.from({ length: 19 }, (_, i) => now - i * 60_000)];

    const allowance = watchAllowance(state(0, watches), creditConfig(), now);
    expect(allowance.allowed).toBe(false);
    // A fixed bucket would say "at 18:00". Rolling says "one hour", which is
    // the honest answer and the one the countdown renders.
    expect(allowance.resetsAt).toBe(oldest + 6 * HOUR);
  });

  it("forgets watches that have aged out of the window", () => {
    const now = Date.parse("2026-06-15T12:00:00.000Z");
    const stale = Array.from({ length: 20 }, (_, i) => now - 7 * HOUR - i * 60_000);
    const allowance = watchAllowance(state(0, stale), creditConfig(), now);
    expect(allowance.used).toBe(0);
    expect(allowance.allowed).toBe(true);
  });

  it("ignores watch stamps from the future", () => {
    // A phone whose clock is wound forward and then corrected would otherwise
    // carry a block for hours after the ads had really aged out.
    const now = Date.parse("2026-06-15T12:00:00.000Z");
    const allowance = watchAllowance(state(0, [now + 3 * HOUR]), creditConfig(), now);
    expect(allowance.used).toBe(0);
  });

  it("counts an ad watched for points against the same limit", async () => {
    await readCredits(CO);
    const before = peekCredits(CO).balance;
    await noteAdWatchedForPoints(CO);

    // The limit is on watching ads, not on which pocket the reward lands in —
    // but the ad paid points, so it must NOT also mint an estimate credit.
    expect(watchAllowance(peekCredits(CO)).used).toBe(1);
    expect(peekCredits(CO).balance).toBe(before);
  });
});

describe("the configuration", () => {
  it("falls back to the shipped terms when a value is nonsense", () => {
    applyCreditConfig({ ads_per_estimate: 0, ads_per_edit: -3, watch_limit: "many" });
    // A zero typed into the console would make the whole economy free, and a
    // zero watch limit would lock everyone out of earning. Both fall back.
    expect(creditConfig().adsPerEstimate).toBe(DEFAULT_CREDIT_CONFIG.adsPerEstimate);
    expect(creditConfig().adsPerEdit).toBe(DEFAULT_CREDIT_CONFIG.adsPerEdit);
    expect(creditConfig().watchLimit).toBe(DEFAULT_CREDIT_CONFIG.watchLimit);
  });

  it("accepts a welcome grant of zero, which is a real answer", () => {
    applyCreditConfig({ welcome_credits: 0 });
    expect(creditConfig().welcomeCredits).toBe(0);
  });

  it("honours the kill switch flag without touching balances", async () => {
    await readCredits(CO);
    await noteAdWatched(CO);
    applyCreditConfig({ enabled: false });
    expect(creditConfig().enabled).toBe(false);
    // Switching the gate off must not spend or destroy what was banked — it has
    // to spend again untouched when the switch goes back on.
    expect(peekCredits(CO).balance).toBe(3);
  });

  it("never enforces the gate off the native build", () => {
    // Tests run under jsdom, which is the web build. A rewarded ad cannot play
    // in a browser, so enforcing there would be a dead end rather than a
    // paywall: no ad can be watched, so no credit can be earned, so no estimate
    // can ever be saved — including for a paying Growth subscriber on a desktop.
    applyCreditConfig({ enabled: true });
    expect(creditConfig().enabled).toBe(true);
    expect(creditsEnforced()).toBe(false);
  });

  it("leaves the terms alone when handed nothing", () => {
    const before = creditConfig().adsPerEstimate;
    applyCreditConfig(null);
    applyCreditConfig(undefined);
    expect(creditConfig().adsPerEstimate).toBe(before);
  });
});

describe("the countdown wording", () => {
  it("never rounds down to zero over a button that is still disabled", () => {
    expect(formatUntil(1_000)).toBe("1 min");
    expect(formatUntil(0)).toBe("1 min");
  });

  it("reads in hours and minutes once it is over an hour", () => {
    expect(formatUntil(90 * 60_000)).toBe("1h 30m");
    expect(formatUntil(2 * HOUR)).toBe("2h");
    expect(formatUntil(45 * 60_000)).toBe("45 min");
  });
});

describe("credit grants on the web build", () => {
  it("banks nothing, because a browser would consume a purchase it can never spend", async () => {
    // isNative is false under jsdom. The web build creates estimates for free,
    // so banking a points purchase here would stamp the grant applied and
    // destroy it — the phone would then find nothing waiting. The row is left
    // pending instead. See syncCreditGrants in @/lib/estimateCredits.
    const before = peekCredits(CO).balance;
    const result = await syncCreditGrants(CO);

    expect(result).toEqual({ credited: 0, estimates: 0 });
    expect(peekCredits(CO).balance).toBe(before);
  });
});
