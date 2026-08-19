/**
 * The 5-day free trial of the estimate generator.
 *
 * The clock is started the first time the merchant OPENS the Estimates screen —
 * not on signup and not on app launch — so nobody burns trial days on a feature
 * they have not seen yet.
 *
 * Where the clock lives, in order of authority:
 *
 *  1. `companies.trial_started_at`, written by the SECURITY DEFINER RPC
 *     `start_estimate_trial`. This is the real clock. Nothing on the device can
 *     reset it, so reinstalling the app or clearing storage no longer hands out
 *     a fresh trial — which it did for as long as the start was device-local.
 *  2. Native Preferences (SharedPreferences on Android), a cache of that value
 *     so the countdown renders offline, and the fallback when the trial has to
 *     start with no connection. A locally started trial is marked unconfirmed
 *     and pushed to the server on the next successful connection.
 *  3. The old `estimate_trial_start_${companyId}` localStorage key, migrated on
 *     first read so existing users keep the time they have already used.
 */

import { supabase } from "@/integrations/supabase/client";
import { isOnline, onNetworkChange } from "@/native/net";
import { prefGet, prefSet } from "@/native/prefs";

/**
 * Trial-start subscribers.
 *
 * `useEntitlement` reads the trial start once, but `ensureTrialStarted` runs
 * later (when the Estimates screen mounts) and may be what CREATES it. Without
 * a notification the hook keeps its stale 0, `trialActive` stays false, and a
 * brand-new user is shown "Free trial ended" on a trial that just began.
 */
type TrialListener = () => void;
const listeners = new Set<TrialListener>();

export function onTrialChange(fn: TrialListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notifyTrialChanged() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* a listener must not break the trial clock */
    }
  });
}

const key = (companyId: string) => `cs_trial_start_${companyId}`;
/** "1" once the server has acknowledged this company's trial start. */
const confirmedKey = (companyId: string) => `cs_trial_confirmed_${companyId}`;
const legacyKey = (companyId: string) => `estimate_trial_start_${companyId}`;

/** Read the trial start without creating one. Returns 0 if never started. */
export async function readTrialStart(companyId: string): Promise<number> {
  if (!companyId) return 0;

  const stored = await prefGet(key(companyId));
  if (stored) {
    const n = parseInt(stored, 10);
    if (Number.isFinite(n)) return n;
  }

  // Migrate a trial that was started by the web app.
  try {
    const legacy = localStorage.getItem(legacyKey(companyId));
    if (legacy) {
      const n = parseInt(legacy, 10);
      if (Number.isFinite(n)) {
        await prefSet(key(companyId), String(n));
        return n;
      }
    }
  } catch {
    /* localStorage unavailable */
  }

  return 0;
}

async function cacheStart(companyId: string, ms: number, confirmed: boolean): Promise<void> {
  await prefSet(key(companyId), String(ms));
  if (confirmed) await prefSet(confirmedKey(companyId), "1");
  // The single write point, so the single place to tell useEntitlement that the
  // clock it read as "not started" has now started.
  notifyTrialChanged();
}

/**
 * Ask the server for the authoritative start, creating it if this is the first
 * call. Throws when the RPC is unreachable so the caller can fall back.
 */
async function claimServerStart(companyId: string): Promise<number> {
  // The generated Supabase types predate this RPC, hence the cast.
  const { data, error } = await (supabase as any).rpc("start_estimate_trial", {
    p_company_id: companyId,
  });
  if (error) throw error;

  const ms = Date.parse(String(data));
  if (!Number.isFinite(ms)) throw new Error("start_estimate_trial returned no timestamp");

  await cacheStart(companyId, ms, true);
  return ms;
}

/** Companies with a retry already armed, so connectivity changes queue one each. */
const awaitingConnection = new Set<string>();

/**
 * A trial that had to start offline is not recorded anywhere durable yet. Push
 * it the moment the device is back on a network rather than waiting for the
 * merchant to open Estimates again.
 */
function retryWhenOnline(companyId: string): void {
  if (awaitingConnection.has(companyId)) return;
  awaitingConnection.add(companyId);

  const stop = onNetworkChange((online) => {
    if (!online) return;
    stop();
    awaitingConnection.delete(companyId);
    void claimServerStart(companyId).catch((err) => {
      console.warn("[trial] server start still unreachable:", err);
      retryWhenOnline(companyId);
    });
  });
}

/**
 * Start the trial if it has not started already, and return its start time.
 * Idempotent — safe to call on every Estimates mount.
 *
 * `serverStartedAt` is the value already fetched with the company row; passing
 * it saves a round trip.
 */
export async function ensureTrialStarted(
  companyId: string,
  serverStartedAt?: string | null,
): Promise<number> {
  if (!companyId) return 0;

  // A server-side value is authoritative and cannot be reset by the device.
  if (serverStartedAt) {
    const server = Date.parse(serverStartedAt);
    if (Number.isFinite(server)) {
      await cacheStart(companyId, server, true);
      return server;
    }
  }

  const existing = await readTrialStart(companyId);
  const confirmed = (await prefGet(confirmedKey(companyId))) === "1";
  if (existing > 0 && confirmed) return existing;

  if (isOnline()) {
    try {
      return await claimServerStart(companyId);
    } catch (err) {
      // Captive portal, cold Supabase, expired token — treated the same as
      // offline: start the clock locally and reconcile later.
      console.warn("[trial] could not record the trial start server-side:", err);
    }
  }

  const start = existing > 0 ? existing : Date.now();
  await cacheStart(companyId, start, false);
  retryWhenOnline(companyId);
  return start;
}
