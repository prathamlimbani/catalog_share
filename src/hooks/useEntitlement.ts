import { useEffect, useMemo, useState } from "react";
import {
  freeEntitlement,
  getEntitlement,
  getEntitlementFromCache,
  type CachedEntitlement,
  type CompanyLike,
  type Entitlement,
} from "@/lib/entitlement";
import { PREF_KEYS, prefGetJSON, prefSetJSON } from "@/native/prefs";
import { applyEntitlement } from "@/native/ads";
import { useCurrentCompany } from "@/hooks/useCompany";
import { onTrialChange, readTrialStart } from "@/lib/trial";

/**
 * Resolve what the signed-in account is entitled to, and keep the ad layer in
 * step with it.
 *
 * Online, the live `companies` row is authoritative and is snapshotted into
 * native Preferences. Offline, that snapshot is used (bounded by a staleness
 * grace period) so a paying user is not demoted to ads mid-flight.
 */
export function useEntitlement(): {
  entitlement: Entitlement;
  loading: boolean;
  fromCache: boolean;
  /** True once the plan AND the trial clock are both known. */
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
    const snapshot: CachedEntitlement = {
      plan: (company as CompanyLike).subscription_plan ?? "free",
      expires_at: (company as CompanyLike).subscription_expires_at ?? null,
      trial_started_at: (company as CompanyLike).trial_started_at ?? null,
      fetched_at: Date.now(),
    };
    setCached(snapshot);
    void prefSetJSON(PREF_KEYS.entitlement, snapshot);
  }, [company]);

  // The trial clock is local (see src/lib/trial.ts) and is only READ here —
  // starting it is the Estimates screen's job.
  const [trialStart, setTrialStart] = useState<number | null>(null);
  /** False until the trial clock has actually been read from storage. */
  const [trialResolved, setTrialResolved] = useState(false);
  const companyId = (company as { id?: string } | null | undefined)?.id;

  useEffect(() => {
    if (!companyId) return;
    let active = true;

    const read = () =>
      readTrialStart(companyId).then((value) => {
        if (!active) return;
        setTrialStart(value || null);
        setTrialResolved(true);
      });

    void read();
    // ensureTrialStarted may CREATE the trial after this hook first read it as
    // absent. Without re-reading, a brand-new user is told their trial ended.
    const unsubscribe = onTrialChange(() => void read());

    return () => {
      active = false;
      unsubscribe();
    };
  }, [companyId, cached?.fetched_at]);

  const usingCache = !company && (isError || !isPending);

  const entitlement = useMemo(() => {
    if (company) return getEntitlement(company as CompanyLike, Date.now(), trialStart);
    const fromCache = getEntitlementFromCache(cached);
    return fromCache ?? freeEntitlement();
  }, [company, cached, trialStart]);

  // An entitlement we have not established yet is treated as AD-FREE, never as
  // "free plan". `cacheLoaded` only says the Preferences read RESOLVED — it is
  // true even when the snapshot is null — so gating on it switched ads on for a
  // paying subscriber during every cold start, before their plan was known.
  // Ads may only be touched once a real company row or a real cached snapshot
  // is in hand.
  const entitlementKnown = !!company || !!cached;

  // The single place ads are switched on or off.
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
     * True once the plan AND the trial clock are both known.
     *
     * Gate on this before showing anything that punishes the user for lacking
     * access — until it flips, "no plan and no trial" is indistinguishable from
     * "we have not finished looking".
     */
    resolved: (!!company || !!cached || !isPending) && (trialResolved || !companyId),
  };
}
