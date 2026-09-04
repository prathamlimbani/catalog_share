import { useEffect, useMemo, useState } from "react";
import {
  freeEntitlement,
  getEntitlement,
  getEntitlementFromCache,
  nextEntitlementBoundary,
  type CachedEntitlement,
  type CompanyLike,
  type Entitlement,
} from "@/lib/entitlement";
import { PREF_KEYS, prefGetJSON, prefSetJSON } from "@/native/prefs";
import { applyEntitlement } from "@/native/ads";
import { useCurrentCompany } from "@/hooks/useCompany";

/**
 * Safety net for the boundary timer.
 *
 * Android freezes JS timers while the app is backgrounded, so a `setTimeout`
 * armed for a subscription's last second can come back minutes late. A coarse
 * interval plus the resume/visibility hooks below cover that. Ten minutes, not
 * one second: this only ever moves a paywall that is already overdue, and a
 * per-second timer on a phone is pure battery drain.
 */
const COARSE_RECHECK_MS = 10 * 60 * 1000;

/**
 * `setTimeout` overflows its 32-bit delay past ~24.8 days and then fires
 * immediately, which would spin. A 30-day subscription expiry is well past
 * that, so long waits are re-armed in chunks instead.
 */
const MAX_TIMER_MS = 6 * 60 * 60 * 1000;

/**
 * Write the offline entitlement snapshot for a company row.
 *
 * Exported because the payment flow refreshes the plan outside of React (see
 * `activateEntitlementNow` in useRazorpaySubscription.ts) and the Preferences
 * copy has to move at the same moment — otherwise the app unlocks now and then
 * re-locks itself from a stale cache the next time it starts offline.
 */
export async function cacheEntitlementSnapshot(
  company: CompanyLike | null | undefined,
): Promise<void> {
  if (!company) return;
  const snapshot: CachedEntitlement = {
    plan: company.subscription_plan ?? "free",
    expires_at: company.subscription_expires_at ?? null,
    fetched_at: Date.now(),
    company_id: company.id ?? null,
    bonus_product_limit: company.bonus_product_limit ?? 0,
  };
  await prefSetJSON(PREF_KEYS.entitlement, snapshot);
}

/**
 * Resolve what the signed-in account is entitled to, and keep the ad layer in
 * step with it.
 *
 * Online, the live `companies` row is authoritative and is snapshotted into
 * native Preferences. Offline, that snapshot is used (bounded by a staleness
 * grace period) so a paying user is not demoted to ads mid-flight.
 *
 * The entitlement is also RE-EVALUATED over time, not only when the row
 * changes. It used to be computed against a `Date.now()` frozen inside a memo,
 * so a merchant whose subscription lapsed while the app was open kept every
 * paid feature until they relaunched. See the boundary timer below.
 */
export function useEntitlement(): {
  entitlement: Entitlement;
  loading: boolean;
  fromCache: boolean;
  /** True once the plan is known, one way or another. */
  resolved: boolean;
} {
  const { data: company, isPending, isError } = useCurrentCompany();
  const [cached, setCached] = useState<CachedEntitlement | null>(null);
  const [cacheLoaded, setCacheLoaded] = useState(false);

  // Load the cached snapshot once at mount so the very first render is correct
  // even before the network query settles.
  useEffect(() => {
    let active = true;
    void prefGetJSON<CachedEntitlement | null>(PREF_KEYS.entitlement, null).then((value) => {
      if (!active) return;
      setCached(value);
      setCacheLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

  // Snapshot the live row whenever it arrives.
  useEffect(() => {
    if (!company) return;
    const row = company as CompanyLike;
    const snapshot: CachedEntitlement = {
      plan: row.subscription_plan ?? "free",
      expires_at: row.subscription_expires_at ?? null,
      fetched_at: Date.now(),
      company_id: row.id ?? null,
      bonus_product_limit: row.bonus_product_limit ?? 0,
    };
    setCached(snapshot);
    void prefSetJSON(PREF_KEYS.entitlement, snapshot);
  }, [company]);

  const usingCache = !company && (isError || !isPending);

  /**
   * The clock the entitlement is evaluated against. Advanced by the boundary
   * timer below rather than by a ticking interval.
   */
  const [clock, setClock] = useState(() => Date.now());

  const entitlement = useMemo(() => {
    if (company) return getEntitlement(company as CompanyLike, clock);
    const fromCache = getEntitlementFromCache(cached, clock);
    return fromCache ?? freeEntitlement(clock);
  }, [company, cached, clock]);

  /** 0 when nothing is counting down, so no timer is armed at all. */
  const boundary = nextEntitlementBoundary(entitlement);

  // Re-evaluate exactly when access can change hands: one timeout aimed at the
  // subscription's last second, re-armed in <= 6h chunks.
  useEffect(() => {
    if (!boundary) return;
    const delay = boundary - Date.now();
    if (delay <= 0) {
      // The clock this entitlement was computed with is already past the
      // boundary — recompute now rather than arming a zero-length timer.
      setClock(Date.now());
      return;
    }
    const id = window.setTimeout(() => setClock(Date.now()), Math.min(delay, MAX_TIMER_MS));
    return () => window.clearTimeout(id);
  }, [boundary, clock]);

  // Timers frozen while the app is backgrounded cannot be trusted, so re-check
  // on resume and on a coarse interval as well.
  useEffect(() => {
    if (!boundary) return;
    let disposed = false;
    const bump = () => setClock(Date.now());

    const interval = window.setInterval(bump, COARSE_RECHECK_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") bump();
    };
    document.addEventListener("visibilitychange", onVisibility);

    let removeResume: (() => void) | undefined;
    void import("@capacitor/app")
      .then(({ App }) => App.addListener("resume", bump))
      .then((handle) => {
        if (disposed) void handle.remove();
        else removeResume = () => void handle.remove();
      })
      .catch(() => {
        /* web build or plugin unavailable — the interval still covers us */
      });

    return () => {
      disposed = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      removeResume?.();
    };
  }, [boundary]);

  // An entitlement we have not established yet is treated as AD-FREE, never as
  // "free plan". `cacheLoaded` only says the Preferences read RESOLVED — it is
  // true even when the snapshot is null — so gating on it switched ads on for a
  // paying subscriber during every cold start, before their plan was known.
  // Ads may only be touched once a real company row or a real cached snapshot
  // is in hand.
  const entitlementKnown = !!company || !!cached;

  // The single place ads are switched on or off. It runs off the SAME
  // entitlement as everything else, so a payment tears the banner down at the
  // exact moment the paid features appear.
  useEffect(() => {
    if (!entitlementKnown) return;
    void applyEntitlement(entitlement.adsEnabled);
  }, [entitlement.adsEnabled, entitlementKnown, cached]);

  return {
    entitlement,
    // react-query v5: `isLoading` is `isPending && isFetching`, so a query that
    // is pending but not currently fetching would read as "done". `isPending`
    // is the honest "we do not know yet".
    loading: isPending && !cacheLoaded,
    fromCache: usingCache,
    /**
     * True once the plan is known, one way or another.
     *
     * Gate on this before showing anything that treats the account as free —
     * until it flips, "no plan" is indistinguishable from "we have not finished
     * looking", and a paying merchant was briefly shown the ad gate.
     */
    resolved: !!company || !!cached || !isPending,
  };
}
