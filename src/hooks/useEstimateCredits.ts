/**
 * React binding for the estimate-credit wallet.
 *
 * The wallet is device-local (see src/lib/estimateCredits.ts), so unlike the
 * points wallet there is nothing to poll: a watched ad is credited the instant
 * the ad closes. What this hook adds is the re-render — the balance is mutated
 * from tap handlers and from the admin config arriving, and every screen
 * showing "2 estimates left" has to move when it does.
 *
 * The one server round trip is the grant sweep. Estimates can also be BOUGHT
 * with points, and points are spent server-side, so on mount this asks whether
 * anything has been bought and not yet banked here. It runs after the wallet is
 * readable and never blocks the first render.
 *
 * A ticking clock is included for one reason only: when the rolling watch limit
 * is exhausted the UI shows a countdown to the next free slot, and that has to
 * advance on its own or it reads as frozen.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  EMPTY_SNAPSHOT,
  NO_GRANTS,
  loadCreditConfig,
  noteAdWatched,
  noteAdWatchedForPoints,
  onCreditConfigChange,
  onCreditsChange,
  peekCredits,
  readCredits,
  snapshotOf,
  syncCreditGrants,
  type CreditSnapshot,
  type CreditState,
  type GrantSyncResult,
} from "@/lib/estimateCredits";
import { showRewarded, type RewardedOutcome } from "@/native/ads";
import { logActivityInBackground } from "@/lib/activity";

/** How often the "next ad in …" countdown is refreshed while it is on screen. */
const COUNTDOWN_TICK_MS = 30_000;

export interface UseEstimateCredits {
  credits: CreditSnapshot;
  state: CreditState;
  /** False until the wallet has actually been read from storage. */
  resolved: boolean;
  /**
   * Re-read the wallet and the terms, and collect anything bought with points.
   *
   * The grant sweep is part of a refresh rather than a separate call because
   * every caller that wants a current balance wants a purchase that has landed
   * on the server to be part of it.
   */
  refresh: () => Promise<void>;
  /**
   * Show a rewarded ad and, if it was watched through, credit one estimate
   * credit. Returns the raw outcome so the caller can explain a failure.
   */
  watchForCredit: () => Promise<RewardedOutcome>;
  /**
   * Show a rewarded ad for POINTS. It consumes a slot of the same rolling watch
   * limit — the limit is on watching ads, not on which pocket the reward lands
   * in — but pays no estimate credit, so the two economies stay separate and one
   * ad is never counted twice.
   */
  watchForPoints: () => Promise<RewardedOutcome>;
}

export function useEstimateCredits(companyId: string | null | undefined): UseEstimateCredits {
  const [state, setState] = useState<CreditState>(() => peekCredits(companyId));
  const [resolved, setResolved] = useState(false);
  const [clock, setClock] = useState(() => Date.now());

  /**
   * Bank anything bought with points.
   *
   * Its own failures are swallowed: the wallet is already readable and the
   * grant stays pending on the server, so a network blip here is a delay, not
   * an error the merchant needs to see. Nothing is read from the return value —
   * `onCreditsChange` is what delivers the new balance to every subscriber.
   */
  const collectGrants = useCallback(async (): Promise<GrantSyncResult> => {
    try {
      return await syncCreditGrants(companyId);
    } catch (err) {
      console.warn("[credits] grant sync failed:", err);
      return NO_GRANTS;
    }
  }, [companyId]);

  const refresh = useCallback(async () => {
    await loadCreditConfig();
    const next = await readCredits(companyId);
    setState(next);
    setResolved(true);
    await collectGrants();
  }, [companyId, collectGrants]);

  // Read once per company, then follow every write. `onCreditsChange` fires for
  // any company, which is deliberate: this device only ever has one signed in,
  // and keying the notification would buy nothing but a bug when the id changes
  // under an open screen.
  useEffect(() => {
    let active = true;
    setResolved(false);

    void (async () => {
      await loadCreditConfig();
      const next = await readCredits(companyId);
      if (!active) return;
      setState(next);
      setResolved(true);
      // After the wallet is readable, never before: collecting a purchase is a
      // network round trip, and the gate must not wait on it to render.
      // Anything it banks arrives through onCreditsChange below.
      await collectGrants();
    })();

    const stopCredits = onCreditsChange(() => {
      if (active) setState(peekCredits(companyId));
    });
    // An admin changing the price of an estimate has to reach a merchant who is
    // already looking at the gate, not only the next cold start.
    const stopConfig = onCreditConfigChange(() => {
      if (active) setClock(Date.now());
    });

    return () => {
      active = false;
      stopCredits();
      stopConfig();
    };
    // collectGrants is memoised on companyId, so this still runs exactly once
    // per signed-in company rather than on every render.
  }, [companyId, collectGrants]);

  const credits = useMemo(
    () => (companyId ? snapshotOf(state, undefined, clock) : EMPTY_SNAPSHOT),
    [companyId, state, clock],
  );

  // Only tick while a countdown is actually being shown. An interval that runs
  // all day on a phone for a number nobody is reading is pure battery.
  useEffect(() => {
    if (credits.watch.allowed) return;
    const id = window.setInterval(() => setClock(Date.now()), COUNTDOWN_TICK_MS);
    return () => window.clearInterval(id);
  }, [credits.watch.allowed]);

  const watchForCredit = useCallback(async (): Promise<RewardedOutcome> => {
    const outcome = await showRewarded();
    // Only a finished ad pays, and only a finished ad consumes a slot of the
    // rolling limit. An ad someone closed after four seconds cost them nothing
    // and must cost them nothing.
    if (outcome.earned) {
      await noteAdWatched(companyId);
      // Only a WATCHED ad is logged. A dismissed one is not an event anybody
      // wants a row for, and logging attempts would drown the real ones.
      logActivityInBackground("ad.watched", {
        summary: "Watched an ad for an estimate credit",
        metadata: { reward: "estimate_credit" },
      });
    }
    return outcome;
  }, [companyId]);

  const watchForPoints = useCallback(async (): Promise<RewardedOutcome> => {
    const outcome = await showRewarded();
    if (outcome.earned) {
      await noteAdWatchedForPoints(companyId);
      // The POINTS themselves are logged by the trigger on points_ledger when
      // Google's callback credits them. This records that the ad was watched,
      // which is the half that never reaches the server on its own — and the
      // gap between the two is how you spot SSV callbacks going missing.
      logActivityInBackground("ad.watched", {
        summary: "Watched an ad for points",
        metadata: { reward: "points" },
      });
    }
    return outcome;
  }, [companyId]);

  return { credits, state, resolved, refresh, watchForCredit, watchForPoints };
}
