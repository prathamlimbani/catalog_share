/**
 * The admin trial switch has to actually stop new trials.
 *
 * "The trial is disabled in the admin panel but new users still get it" was
 * caused by `ensureTrialStarted` creating a trial on every Estimates mount with
 * no regard for the console setting. These pin the gate: when the trial is off
 * (or auto-start is off) NO new trial is minted, but an already-granted trial —
 * one the admin handed out, arriving as a server `trial_started_at` — is still
 * honoured.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { rpc, prefGet, prefSet, loadTrialConfig, isOnline } = vi.hoisted(() => ({
  rpc: vi.fn(),
  prefGet: vi.fn(async () => null),
  prefSet: vi.fn(async () => {}),
  loadTrialConfig: vi.fn(),
  isOnline: vi.fn(() => true),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc },
}));
vi.mock("@/native/prefs", () => ({
  prefGet,
  prefSet,
}));
vi.mock("@/native/net", () => ({
  isOnline,
  onNetworkChange: () => () => {},
}));
vi.mock("@/lib/trialConfig", () => ({
  loadTrialConfig,
}));

import { ensureTrialStarted } from "@/lib/trial";

const trial = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  durationDays: 5,
  unlocksEstimates: true,
  unlocksPremiumThemes: false,
  productLimit: 40,
  autoStart: true,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  prefGet.mockResolvedValue(null);
  isOnline.mockReturnValue(true);
});

describe("ensureTrialStarted respects the admin switch", () => {
  it("does NOT start a trial when the trial is disabled", async () => {
    loadTrialConfig.mockResolvedValue(trial({ enabled: false }));
    const start = await ensureTrialStarted("company-1");
    expect(start).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does NOT start a trial when auto-start is off (invite-only)", async () => {
    loadTrialConfig.mockResolvedValue(trial({ autoStart: false }));
    const start = await ensureTrialStarted("company-1");
    expect(start).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("DOES start a trial when enabled and auto-start are on", async () => {
    loadTrialConfig.mockResolvedValue(trial());
    const iso = "2026-08-23T10:00:00.000Z";
    rpc.mockResolvedValue({ data: iso, error: null });
    const start = await ensureTrialStarted("company-1");
    expect(rpc).toHaveBeenCalledWith("start_estimate_trial", expect.any(Object));
    expect(start).toBe(Date.parse(iso));
  });

  it("honours an admin-granted trial even when auto-start is off", async () => {
    // A server-side start is authoritative and short-circuits before the gate:
    // turning auto-start off makes trials invite-only, it does not revoke a
    // grant already made.
    loadTrialConfig.mockResolvedValue(trial({ autoStart: false, enabled: true }));
    const granted = "2026-08-23T00:00:00.000Z";
    const start = await ensureTrialStarted("company-1", granted);
    expect(start).toBe(Date.parse(granted));
    expect(rpc).not.toHaveBeenCalled();
    expect(loadTrialConfig).not.toHaveBeenCalled();
  });
});
