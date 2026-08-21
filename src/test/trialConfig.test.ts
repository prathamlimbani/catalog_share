/**
 * The trial's terms are now data, not a constant, which means a bad row in
 * `app_settings` can shorten or end a real merchant's trial. These pin the
 * guards that stop it.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TRIAL,
  applyTrialConfig,
  trialConfig,
  trialDurationMs,
} from "@/lib/trialConfig";
import { getEntitlement } from "@/lib/entitlement";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-08-22T10:00:00.000Z");

const startedDaysAgo = (n: number) => ({
  subscription_plan: "free",
  trial_started_at: new Date(NOW - n * DAY).toISOString(),
});

afterEach(() => {
  // Module state is global; every test must leave the shipped terms behind.
  applyTrialConfig({
    enabled: true,
    duration_days: 5,
    unlocks_estimates: true,
    unlocks_premium_themes: false,
    product_limit: 40,
    auto_start: true,
  });
});

describe("trial config", () => {
  it("ships the five-day terms", () => {
    expect(DEFAULT_TRIAL.durationDays).toBe(5);
    expect(trialDurationMs()).toBe(5 * DAY);
  });

  it("ignores a null row rather than blanking the terms", () => {
    applyTrialConfig({ duration_days: 14 });
    applyTrialConfig(null);
    expect(trialConfig().durationDays).toBe(14);
  });

  it("rejects a zero or negative length instead of shortening trials", () => {
    // Clamping these to a day would cut every running trial to a day over a
    // typo. Falling back to the shipped terms leaves merchants where they were.
    applyTrialConfig({ duration_days: 0 });
    expect(trialDurationMs()).toBe(5 * DAY);
    applyTrialConfig({ duration_days: -30 });
    expect(trialDurationMs()).toBe(5 * DAY);
  });

  it("clamps an absurd length to a year", () => {
    applyTrialConfig({ duration_days: 99999 });
    expect(trialDurationMs()).toBe(365 * DAY);
  });

  it("falls back to five days for an unreadable length", () => {
    applyTrialConfig({ duration_days: "not a number" });
    expect(trialDurationMs()).toBe(5 * DAY);
  });
});

describe("entitlement follows the configured terms", () => {
  it("extends a running trial when the admin lengthens it", () => {
    // Day 7 of a 5-day trial: over. Widened to 14 days: back inside it.
    expect(getEntitlement(startedDaysAgo(7), NOW).trialActive).toBe(false);
    applyTrialConfig({ duration_days: 14 });
    const ent = getEntitlement(startedDaysAgo(7), NOW);
    expect(ent.trialActive).toBe(true);
    expect(ent.estimatesUnlocked).toBe(true);
  });

  it("ends every running trial when the trial is switched off", () => {
    applyTrialConfig({ enabled: false });
    const ent = getEntitlement(startedDaysAgo(1), NOW);
    expect(ent.trialActive).toBe(false);
    expect(ent.estimatesUnlocked).toBe(false);
  });

  it("honours a trial that no longer unlocks estimates", () => {
    applyTrialConfig({ unlocks_estimates: false });
    const ent = getEntitlement(startedDaysAgo(1), NOW);
    expect(ent.trialActive).toBe(true);
    expect(ent.estimatesUnlocked).toBe(false);
  });

  it("applies the configured product limit to free accounts", () => {
    applyTrialConfig({ product_limit: 10 });
    expect(getEntitlement({ subscription_plan: "free" }, NOW).productLimit).toBe(10);
  });

  it("still shows ads to a trial user", () => {
    // The whole point of trial ads: a merchant who never sees one does not
    // understand what the paid plan is removing.
    expect(getEntitlement(startedDaysAgo(1), NOW).adsEnabled).toBe(true);
  });

  it("never shows ads to a paying subscriber", () => {
    const paid = {
      subscription_plan: "growth",
      subscription_expires_at: new Date(NOW + 10 * DAY).toISOString(),
      trial_started_at: new Date(NOW - DAY).toISOString(),
    };
    expect(getEntitlement(paid, NOW).adsEnabled).toBe(false);
  });
});
