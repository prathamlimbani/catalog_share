import { useCallback, useEffect, useState } from "react";
import {
  clearRenumberings,
  getSyncState,
  onSyncStateChange,
  outboxCounts,
  retryFailedNow,
  startSyncScheduler,
  syncNow,
  type Renumbering,
  type SyncState,
} from "@/lib/sync/syncEngine";

/** Live sync state (running / pending / failed / last error). */
export function useSyncState(): SyncState {
  const [state, setState] = useState<SyncState>(getSyncState());
  useEffect(() => onSyncStateChange(setState), []);
  return state;
}

/**
 * Outbox tallies, re-read from IndexedDB whenever a cycle finishes.
 *
 * `failed` is deliberately separate from `pending`: an entry that has exhausted
 * its retries is still queued, and the UI has to be able to say so rather than
 * showing it as ordinary work in progress.
 */
export function useSyncCounts(): { pending: number; failed: number } {
  const state = useSyncState();
  const [counts, setCounts] = useState({ pending: state.pending, failed: state.failed });

  useEffect(() => {
    let active = true;
    void outboxCounts().then((next) => {
      if (active) setCounts(next);
    });
    return () => {
      active = false;
    };
  }, [state.pending, state.failed, state.lastSyncAt]);

  return {
    pending: Math.max(counts.pending, state.pending),
    failed: Math.max(counts.failed, state.failed),
  };
}

/** Count of local changes still waiting to reach the server. */
export function useSyncPending(): number {
  return useSyncCounts().pending;
}

/** Estimates the server renumbered on sync, until the user dismisses them. */
export function useRenumberings(): { renumberings: Renumbering[]; dismiss: () => void } {
  const { renumberings } = useSyncState();
  return { renumberings, dismiss: clearRenumberings };
}

/**
 * Start the background sync scheduler for a company.
 * Mounted once, high in the tree, by the app shell.
 */
export function useSyncScheduler(companyId: string | null | undefined): void {
  useEffect(() => {
    if (!companyId) return;
    return startSyncScheduler(() => companyId);
  }, [companyId]);
}

/** Manual "sync now" for pull-to-refresh, plus the retry for parked work. */
export function useManualSync(companyId: string | null | undefined) {
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    if (busy || !companyId) return null;
    setBusy(true);
    try {
      return await syncNow(companyId);
    } finally {
      setBusy(false);
    }
  }, [busy, companyId]);

  // Clears the backoff on entries that gave up, then syncs — a plain "sync now"
  // would skip them for another five minutes.
  const retry = useCallback(async () => {
    if (busy || !companyId) return null;
    setBusy(true);
    try {
      return await retryFailedNow(companyId);
    } finally {
      setBusy(false);
    }
  }, [busy, companyId]);

  return { run, retry, busy };
}
