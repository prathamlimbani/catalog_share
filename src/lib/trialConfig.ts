/**
 * The free trial's terms, as set by the admin console.
 *
 * Length and scope used to be constants compiled into the bundle. On Android
 * that means changing "5 days" is a release, a Play review, and then weeks of
 * waiting for merchants to actually update — so in practice it could not be
 * changed at all. It lives in `app_settings.trial` now and takes effect on the
 * next app launch (or immediately, once the settings query refetches).
 *
 * Kept deliberately synchronous for readers: `getEntitlement` is a pure
 * function called on every render, so it reads the last loaded value rather
 * than awaiting one. `applyTrialConfig` is the single write point, mirroring
 * how `applyPlanCatalogue` feeds the plan list in plans.ts.
 */

import { supabase } from "@/integrations/supabase/client";

export interface TrialConfig {
  enabled: boolean;
  durationDays: number;
  unlocksEstimates: boolean;
  unlocksPremiumThemes: boolean;
  productLimit: number;
  /** Whether opening Estimates starts the clock, or only an admin grant can. */
  autoStart: boolean;
}

/**
 * The terms the app shipped with. Also what applies if the settings row is
 * unreachable — a merchant mid-trial must not be locked out because a config
 * query failed.
 */
export const DEFAULT_TRIAL: TrialConfig = {
  enabled: true,
  durationDays: 5,
  unlocksEstimates: true,
  unlocksPremiumThemes: false,
  productLimit: 40,
  autoStart: true,
};

let current: TrialConfig = { ...DEFAULT_TRIAL };

type Listener = () => void;
const listeners = new Set<Listener>();

export function onTrialConfigChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The trial terms as last loaded. */
export function trialConfig(): TrialConfig {
  return current;
}

/** Trial length in milliseconds, the form the entitlement maths wants. */
export function trialDurationMs(): number {
  // Upper bound only: `coerce` has already rejected anything non-positive, so
  // this exists to stop a five-digit typo producing a trial nobody can end.
  const days = Math.min(365, Math.max(1, Math.round(current.durationDays)));
  return days * 24 * 60 * 60 * 1000;
}

/**
 * A number that is meant to be a positive count, or the fallback.
 *
 * Zero and negatives are rejected rather than clamped. Clamping a mistyped
 * `-30` to one day would silently cut every running trial to a day; falling
 * back to the shipped value leaves merchants where they were, which is the
 * right way to fail for a field that governs somebody's access.
 */
function positiveOr(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function coerce(raw: unknown): TrialConfig {
  const v = (raw ?? {}) as Record<string, unknown>;
  const bool = (key: string, fallback: boolean) =>
    typeof v[key] === "boolean" ? (v[key] as boolean) : fallback;

  return {
    enabled: bool("enabled", DEFAULT_TRIAL.enabled),
    durationDays: positiveOr(v.duration_days, DEFAULT_TRIAL.durationDays),
    unlocksEstimates: bool("unlocks_estimates", DEFAULT_TRIAL.unlocksEstimates),
    unlocksPremiumThemes: bool("unlocks_premium_themes", DEFAULT_TRIAL.unlocksPremiumThemes),
    productLimit: positiveOr(v.product_limit, DEFAULT_TRIAL.productLimit),
    autoStart: bool("auto_start", DEFAULT_TRIAL.autoStart),
  };
}

/** Install a config. Ignores nothing-shaped input rather than blanking the terms. */
export function applyTrialConfig(raw: unknown): void {
  if (raw === null || raw === undefined) return;
  const next = coerce(raw);
  const changed = (Object.keys(next) as (keyof TrialConfig)[]).some((k) => next[k] !== current[k]);
  current = next;
  if (!changed) return;
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* a listener must not break the trial clock */
    }
  });
}

let loaded = false;

/**
 * Fetch the terms once per session.
 *
 * `force` is for the admin console, which must see its own edit reflected
 * without a reload.
 */
export async function loadTrialConfig(force = false): Promise<TrialConfig> {
  if (loaded && !force) return current;
  loaded = true;
  try {
    const { data, error } = await (supabase as any)
      .from("app_settings")
      .select("value")
      .eq("key", "trial")
      .maybeSingle();
    if (error) throw error;
    applyTrialConfig((data as { value?: unknown } | null)?.value);
  } catch (err) {
    console.warn("[trial] terms unavailable, using the built-in defaults:", err);
  }
  return current;
}
