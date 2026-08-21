/**
 * The rewarded-ad gate on saving an estimate.
 *
 * How it behaves is a SETTING, not a hardcoded decision, because the two
 * sensible answers carry very different risk:
 *
 *   "required" — past the plan's daily quota, the estimate is not saved until a
 *                rewarded ad has been watched. Highest revenue per free user.
 *                This is the configured default because it is what was asked
 *                for. Be aware that gating work the user has already typed is
 *                the pattern Google Play's Ads policy describes as interfering
 *                with app functionality, and is a plausible rejection reason.
 *
 *   "offered"  — past the quota the app OFFERS the ad; declining still saves.
 *                Same impressions from anyone who actually wants to keep
 *                working, no policy exposure.
 *
 *   "off"      — no gate at all.
 *
 * Keeping this in `app_settings` means that if a review comes back citing the
 * Ads policy, the fix is one dropdown in the admin console and takes effect
 * immediately for every installed copy — no release, no Play review, no waiting
 * for users to update. That is the whole reason it is a setting.
 */

import { supabase } from "@/integrations/supabase/client";
import { getEntitlement, type CompanyLike } from "@/lib/entitlement";
import { isNative } from "@/native/platform";

export type GateMode = "required" | "offered" | "off";

export interface GateConfig {
  mode: GateMode;
  /** Estimates a plan may save per day before the gate applies. 0 = unlimited. */
  dailyQuota: number;
  /** Whether this plan sees rewarded ads at all. */
  rewardedAllowed: boolean;
}

/** What ships when the settings tables are unreachable. */
const FALLBACK: GateConfig = {
  // Fail OPEN. A merchant must never be locked out of their own work because a
  // settings query failed — that turns a config outage into data loss.
  mode: "off",
  dailyQuota: 0,
  rewardedAllowed: false,
};

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { at: number; value: GateConfig; planId: string } | null = null;

interface LooseFrom {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): {
        maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
  };
}

/** Count of estimates saved today, kept on the device. */
const QUOTA_KEY = "cs_estimate_quota";

interface QuotaState {
  /** UTC date, so the count resets at the same instant everywhere. */
  day: string;
  used: number;
  /** Ads watched today that have bought extra saves. */
  unlocked: number;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function readQuota(): QuotaState {
  const empty: QuotaState = { day: today(), used: 0, unlocked: 0 };
  try {
    const raw = localStorage.getItem(QUOTA_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as QuotaState;
    if (!parsed || parsed.day !== today()) return empty;
    return {
      day: parsed.day,
      used: Number(parsed.used) || 0,
      unlocked: Number(parsed.unlocked) || 0,
    };
  } catch {
    return empty;
  }
}

function writeQuota(state: QuotaState): void {
  try {
    localStorage.setItem(QUOTA_KEY, JSON.stringify(state));
  } catch {
    /* private mode — the gate simply stops counting, which fails open */
  }
}

/** Record a saved estimate against today's quota. */
export function noteEstimateSaved(): void {
  const q = readQuota();
  writeQuota({ ...q, used: q.used + 1 });
}

/** Record a watched ad, buying one more save. */
export function noteRewardWatched(): void {
  const q = readQuota();
  writeQuota({ ...q, unlocked: q.unlocked + 1 });
}

export function quotaState(): QuotaState {
  return readQuota();
}

/**
 * Load the gate configuration for a company's current plan.
 *
 * The device-side count is advisory: it is there to decide whether to show an
 * ad, not to protect anything. Points, which are worth money, are only ever
 * granted by the server-side verification callback.
 */
export async function loadGateConfig(company: CompanyLike | null | undefined): Promise<GateConfig> {
  if (!isNative) return FALLBACK; // no ads on the web build

  const entitlement = getEntitlement(company);
  const planId = entitlement.plan;

  if (cache && cache.planId === planId && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.value;
  }

  try {
    const client = supabase as unknown as LooseFrom;

    const [{ data: adsRow }, { data: policyRow }] = await Promise.all([
      client.from("app_settings").select("value").eq("key", "ads").maybeSingle(),
      client.from("plan_ad_policy").select("*").eq("plan_id", planId).maybeSingle(),
    ]);

    const ads = (adsRow as { value?: Record<string, unknown> } | null)?.value ?? {};
    const policy = (policyRow ?? {}) as Record<string, unknown>;

    const value: GateConfig = {
      mode: (String(ads.save_gate_mode ?? "required") as GateMode) || "required",
      dailyQuota: Number(policy.daily_estimates ?? 0) || 0,
      rewardedAllowed: policy.show_rewarded !== false,
    };

    if (ads.enabled === false) value.mode = "off";

    cache = { at: Date.now(), value, planId };
    return value;
  } catch (err) {
    console.warn("[rewards] gate config unavailable, saving stays open:", err);
    return FALLBACK;
  }
}

/** Drop the cached config — call after an admin change or a plan change. */
export function invalidateGateConfig(): void {
  cache = null;
}

export type GateDecision =
  | { action: "save" }
  | { action: "offer"; remaining: 0 }
  | { action: "require"; remaining: 0 };

/**
 * Decide what should happen when the user taps Save.
 *
 * Never returns "require" when the config could not be loaded, when the plan
 * has no quota, or when rewarded ads are unavailable for the plan — all of
 * which mean the merchant simply saves.
 */
export function decideGate(config: GateConfig): GateDecision {
  if (config.mode === "off") return { action: "save" };
  if (!config.rewardedAllowed) return { action: "save" };
  if (config.dailyQuota <= 0) return { action: "save" };

  const q = readQuota();
  const allowance = config.dailyQuota + q.unlocked;
  if (q.used < allowance) return { action: "save" };

  return config.mode === "required"
    ? { action: "require", remaining: 0 }
    : { action: "offer", remaining: 0 };
}
