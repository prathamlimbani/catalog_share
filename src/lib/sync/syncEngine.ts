/**
 * Sync engine.
 *
 * The only module that moves estimates between IndexedDB and Supabase.
 *
 * Push first, then pull, so a row the user just wrote is never clobbered by a
 * stale server copy. Runs on: app boot, network regained, app resumed from
 * background, and an explicit pull-to-refresh.
 *
 * Design rules:
 *  - Nothing the user typed is ever discarded silently. A conflict keeps BOTH
 *    versions, the server one under its own number and the local one saved
 *    alongside it, and tells the user.
 *  - A number collision (23505 on the UNIQUE (company_id, invoice_number)
 *    index) renumbers and retries instead of dropping the estimate — on every
 *    write path, not just the first insert.
 *  - Failures back off exponentially and stay queued. An entry that exhausts
 *    its retries is PARKED, never deleted: dropping it would leave a row marked
 *    dirty forever with nothing queued to push it, and a pending count of 0
 *    telling the merchant everything is saved when it is not.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  getDB,
  metaGet,
  metaSet,
  META_KEYS,
  type OfflineEstimate,
  type OutboxEntry,
} from "@/lib/offline/db";
import {
  markPushAttempted,
  markSynced,
  noteServerNumbers,
  nextEstimateNumber,
  purgeTombstone,
  removeFromServerDelete,
  stripAdvanceSentinel,
  toServerPayload,
  upsertFromServer,
} from "@/lib/offline/estimates";
import { mirrorProducts } from "@/lib/offline/mirror";
import { isOnline } from "@/native/net";

const MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 5 * 60_000;

/** PostgREST caps a response at 1000 rows; stay under it and paginate. */
const PULL_PAGE_SIZE = 500;

/** Postgres unique-violation. */
const PG_UNIQUE_VIOLATION = "23505";
/** Postgres undefined-column — the database has not had the migration applied. */
const PG_UNDEFINED_COLUMN = "42703";

/** An estimate the server renumbered during a push, for the UI to surface. */
export interface Renumbering {
  id: string;
  from: string;
  to: string;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  renumbered: number;
  /** Old/new numbers, so the caller can tell the merchant what changed. */
  renumberings: Renumbering[];
  conflicts: number;
  /** Rows removed locally because they were deleted on another device. */
  removed: number;
  failed: number;
  skipped: boolean;
  error?: string;
}

export type SyncListener = (state: SyncState) => void;

export interface SyncState {
  running: boolean;
  /** Outbox entries waiting, parked ones included. */
  pending: number;
  /** Outbox entries that have exhausted their retries. Never silently zero. */
  failed: number;
  lastSyncAt: number | null;
  lastError: string | null;
  /** Renumberings from the most recent cycle, until the UI dismisses them. */
  renumberings: Renumbering[];
}

let state: SyncState = {
  running: false,
  pending: 0,
  failed: 0,
  lastSyncAt: null,
  lastError: null,
  renumberings: [],
};
const listeners = new Set<SyncListener>();
let inFlight: Promise<SyncResult> | null = null;

export function onSyncStateChange(fn: SyncListener): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => {
    try {
      fn(state);
    } catch {
      /* a listener must not break sync */
    }
  });
}

export function getSyncState(): SyncState {
  return state;
}

/** Dismiss the renumbering notice once the user has seen it. */
export function clearRenumberings(): void {
  if (state.renumberings.length) setState({ renumberings: [] });
}

/**
 * Outbox tallies. `failed` is what separates "still trying" from "stuck", and
 * the UI must be able to show that difference.
 */
export async function outboxCounts(): Promise<{ pending: number; failed: number }> {
  try {
    const db = await getDB();
    const entries = await db.getAll("outbox");
    return {
      pending: entries.length,
      failed: entries.filter((e) => e.attempts >= MAX_ATTEMPTS).length,
    };
  } catch {
    return { pending: 0, failed: 0 };
  }
}

async function refreshPending() {
  const counts = await outboxCounts();
  setState(counts);
}

function backoffFor(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** attempts, MAX_BACKOFF_MS);
}

// -------------------------------------------------------------- PostgREST

/**
 * `invoices` queries with the column names loosened.
 *
 * `deleted_at` is newer than the checked-in generated types, and the sync layer
 * has to degrade gracefully against a database where the migrations have not
 * been applied at all — which means naming columns the type definitions do not
 * know about and reading the error code back.
 */
interface PageResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}

interface InvoiceQuery {
  eq(column: string, value: unknown): InvoiceQuery;
  gt(column: string, value: unknown): InvoiceQuery;
  is(column: string, value: null): InvoiceQuery;
  order(column: string, opts: { ascending: boolean }): InvoiceQuery;
  range(from: number, to: number): PromiseLike<PageResult>;
}

function invoicesSelect(): InvoiceQuery {
  return supabase.from("invoices").select("*") as unknown as InvoiceQuery;
}

interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<PageResult>;
}

// ------------------------------------------------------------------ push

/**
 * Allocate a replacement invoice number after a 23505.
 *
 * The server RPC hands out numbers under a row lock, so two devices syncing at
 * the same moment cannot be given the same one. The local allocator is only a
 * fallback for databases where `next_invoice_number` has not been created yet.
 */
async function freshInvoiceNumber(companyId: string): Promise<string> {
  try {
    const { data, error } = await (supabase as unknown as RpcClient).rpc("next_invoice_number", {
      p_company_id: companyId,
    });
    if (!error && typeof data === "string" && data) return data;
  } catch {
    /* RPC unavailable — fall through to the local allocator */
  }
  return nextEstimateNumber(companyId, { offline: false });
}

type WriteFn = (payload: Record<string, unknown>) => PromiseLike<{
  error: { code?: string; message: string } | null;
}>;

/**
 * Re-run a write that collided on (company_id, invoice_number) under a fresh
 * number. Shared by all three write paths — insert, re-insert and update — so a
 * collision on any of them renumbers instead of burning every retry.
 */
async function retryWithFreshNumber(
  local: OfflineEstimate,
  payload: Record<string, unknown>,
  write: WriteFn,
): Promise<{ number: string | null; message: string | null }> {
  const fresh = await freshInvoiceNumber(local.company_id);
  const { error } = await writeTolerantOfMissingColumns({ ...payload, invoice_number: fresh }, write);
  if (error) return { number: null, message: error.message };
  return { number: fresh, message: null };
}

const insertInvoice: WriteFn = (payload) => supabase.from("invoices").insert(payload as never);

/**
 * Columns the client knows about that a database may not have yet, in the order
 * it is safe to drop them.
 *
 * `advance_payment` is the one that actually bit: it has its own migration, and
 * against a database where that migration was never applied EVERY push failed
 * with 42703. The push path only recovered from 23505, so each estimate burned
 * its eight attempts and parked — silently, because a parked entry still counts
 * as "pending" rather than as an error. No estimate reached the server at all.
 *
 * Dropping the column loses that one field for that one row rather than losing
 * the whole estimate, and the legacy items sentinel still carries the advance
 * for older readers. The proper fix is to apply the migration; this only stops
 * a missing column from taking the entire feature down with it.
 */
const OPTIONAL_COLUMNS = ["advance_payment"] as const;

/** The column PostgREST is complaining about, if we can tell. */
function missingColumnName(error: { code?: string; message: string }): string | null {
  const m = /column "?(?:invoices\.)?([a-z_]+)"? does not exist/i.exec(error.message)
    ?? /Could not find the '([a-z_]+)' column/i.exec(error.message);
  return m ? m[1] : null;
}

/**
 * Run a write, retrying without any column the database turns out not to have.
 *
 * Returns the error from the last attempt, so a genuine failure still reports
 * the real reason rather than a column complaint.
 */
async function writeTolerantOfMissingColumns(
  payload: Record<string, unknown>,
  write: WriteFn,
): Promise<{ error: { code?: string; message: string } | null; dropped: string[] }> {
  let body = { ...payload };
  const dropped: string[] = [];

  // Bounded by the number of optional columns plus one, so a database that is
  // missing something we cannot drop fails fast instead of looping.
  for (let attempt = 0; attempt <= OPTIONAL_COLUMNS.length; attempt += 1) {
    const { error } = await write(body);
    if (!error || !isMissingColumn(error)) return { error, dropped };

    const column = missingColumnName(error);
    const droppable = column && (OPTIONAL_COLUMNS as readonly string[]).includes(column);
    if (!droppable || !(column in body)) {
      // A required column is missing — the schema is too old to write to at
      // all, and saying so beats retrying forever.
      return { error, dropped };
    }

    console.warn(
      `[sync] invoices.${column} does not exist on the server; ` +
        "pushing without it. Apply the pending migrations in supabase/migrations/.",
    );
    delete body[column];
    dropped.push(column);
  }

  return { error: null, dropped };
}

/**
 * Insert with full 23505 recovery. Used both for a first push and for
 * re-creating a row that vanished server-side.
 */
async function insertWithRecovery(
  entry: OutboxEntry,
  local: OfflineEstimate,
  payload: Record<string, unknown>,
): Promise<"done" | "retry"> {
  // Recorded BEFORE the request leaves: if the response is lost we must never
  // again treat this row as one the server has not seen.
  await markPushAttempted(local.id);

  const { error } = await writeTolerantOfMissingColumns(payload, insertInvoice);

  if (!error) {
    await markSynced(local.id);
    return "done";
  }

  if (error.code !== PG_UNIQUE_VIOLATION) {
    entry.lastError = error.message;
    return "retry";
  }

  // Either the number is taken, or this row already reached the server on a
  // previous attempt whose response we never saw.
  const { data: byId } = await supabase
    .from("invoices")
    .select("id")
    .eq("id", local.id)
    .maybeSingle();

  if (byId) {
    await markSynced(local.id);
    return "done";
  }

  const retried = await retryWithFreshNumber(local, payload, insertInvoice);
  if (!retried.number) {
    entry.lastError = retried.message;
    return "retry";
  }
  await markSynced(local.id, retried.number);
  return "done";
}

/**
 * Push a delete.
 *
 * Soft-deletes by stamping `deleted_at` so other devices can learn about it on
 * their next pull; a database without the column gets the old hard delete.
 */
async function pushDelete(entry: OutboxEntry): Promise<"done" | "retry"> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("invoices")
    .update({ deleted_at: now } as never)
    .eq("id", entry.estimate_id);

  if (error && isMissingColumn(error)) {
    const { error: hardError } = await supabase
      .from("invoices")
      .delete()
      .eq("id", entry.estimate_id);
    // "not found" is success — the row is gone either way.
    if (hardError && hardError.code !== "PGRST116") {
      entry.lastError = hardError.message;
      return "retry";
    }
    await purgeTombstone(entry.estimate_id);
    return "done";
  }

  if (error && error.code !== "PGRST116") {
    entry.lastError = error.message;
    return "retry";
  }

  await purgeTombstone(entry.estimate_id);
  return "done";
}

async function pushEntry(entry: OutboxEntry): Promise<"done" | "retry" | "drop"> {
  const db = await getDB();

  if (entry.op === "delete") return pushDelete(entry);

  const local = await db.get("estimates", entry.estimate_id);
  if (!local) return "drop"; // deleted locally before it ever synced

  // Always push the CURRENT local state, not the snapshot taken at enqueue
  // time — the user may have edited the estimate again while offline.
  const payload = toServerPayload(local);

  if (entry.op === "insert") return insertWithRecovery(entry, local, payload);

  // ---- update ----
  const { data: serverRow, error: readError } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", local.id)
    .maybeSingle();

  if (readError) {
    entry.lastError = readError.message;
    return "retry";
  }

  if (!serverRow) {
    // Someone deleted it server-side; re-create rather than lose the estimate.
    return insertWithRecovery(entry, local, payload);
  }

  const updateInvoice: WriteFn = (p) =>
    supabase
      .from("invoices")
      .update(p as never)
      .eq("id", local.id);

  const { error: updateError } = await writeTolerantOfMissingColumns(payload, updateInvoice);

  if (updateError?.code === PG_UNIQUE_VIOLATION) {
    const retried = await retryWithFreshNumber(local, payload, updateInvoice);
    if (!retried.number) {
      entry.lastError = retried.message;
      return "retry";
    }
    await markSynced(local.id, retried.number);
    return "done";
  }

  if (updateError) {
    entry.lastError = updateError.message;
    return "retry";
  }

  await markSynced(local.id);
  return "done";
}

async function pushAll(): Promise<{
  pushed: number;
  failed: number;
  renumbered: number;
  renumberings: Renumbering[];
}> {
  const db = await getDB();
  const entries = (await db.getAll("outbox")).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

  let pushed = 0;
  let failed = 0;
  const renumberings: Renumbering[] = [];
  const now = Date.now();

  for (const entry of entries) {
    if (entry.nextAttemptAt > now) continue;

    // Captured before the push so a row renumbered on an EARLIER cycle is not
    // re-reported every time it syncs — `_renumberedFrom` is permanent.
    const before = await db.get("estimates", entry.estimate_id);

    let outcome: "done" | "retry" | "drop";
    try {
      outcome = await pushEntry(entry);
    } catch (err) {
      entry.lastError = String(err);
      outcome = "retry";
    }

    if (outcome === "done" || outcome === "drop") {
      if (entry.seq !== undefined) await db.delete("outbox", entry.seq);
      if (outcome === "done") {
        pushed += 1;
        const after = await db.get("estimates", entry.estimate_id);
        if (after && before && after.invoice_number !== before.invoice_number) {
          renumberings.push({
            id: after.id,
            from: before.invoice_number,
            to: after.invoice_number,
          });
        }
      }
      continue;
    }

    const attempts = Math.min(entry.attempts + 1, MAX_ATTEMPTS);
    failed += 1;

    if (entry.seq === undefined) continue;

    if (attempts >= MAX_ATTEMPTS) {
      // Park it: keep retrying at the slow ceiling rather than deleting the
      // entry. Deleting left the row `_dirty` with nothing queued to push it,
      // so the work never synced and the UI reported nothing pending.
      console.warn("[sync] parking entry after repeated failures:", entry.estimate_id, entry.lastError);
      await db.put("outbox", {
        ...entry,
        attempts: MAX_ATTEMPTS,
        nextAttemptAt: Date.now() + MAX_BACKOFF_MS,
      });
      continue;
    }

    await db.put("outbox", {
      ...entry,
      attempts,
      nextAttemptAt: Date.now() + backoffFor(attempts),
    });
  }

  return { pushed, failed, renumbered: renumberings.length, renumberings };
}

/**
 * Clear the backoff on every entry that has failed at least once, then sync.
 *
 * Backs the retry action in the offline banner. The user asked for a fresh
 * attempt, so the whole ladder restarts rather than one grudging try — without
 * this a parked entry would sit out another five minutes after the tap.
 */
export async function retryFailedNow(companyId: string | null | undefined): Promise<SyncResult> {
  try {
    const db = await getDB();
    for (const entry of await db.getAll("outbox")) {
      if (entry.seq === undefined || entry.attempts === 0) continue;
      await db.put("outbox", { ...entry, attempts: 0, lastError: null, nextAttemptAt: 0 });
    }
    await refreshPending();
  } catch (err) {
    console.warn("[sync] could not reset parked entries:", err);
  }
  return syncNow(companyId);
}

// ------------------------------------------------------------------ pull

type PageQuery = (from: number, to: number) => PromiseLike<PageResult>;

/**
 * Does this error mean the database predates a column this build knows about?
 *
 * Matched on the message as well as the code because PostgREST has shipped more
 * than one code for it; deliberately narrow, so a missing TABLE still surfaces
 * as an error rather than quietly pulling nothing.
 */
function isMissingColumn(error: { code?: string; message: string }): boolean {
  return error.code === PG_UNDEFINED_COLUMN || /column .* does not exist/i.test(error.message);
}

/**
 * Read every page of a query.
 *
 * Returns null when the query names a column the database does not have, so the
 * caller can retry with a simpler shape.
 */
async function fetchAllPages(run: PageQuery): Promise<Array<Record<string, unknown>> | null> {
  const rows: Array<Record<string, unknown>> = [];

  for (let from = 0; ; from += PULL_PAGE_SIZE) {
    const { data, error } = await run(from, from + PULL_PAGE_SIZE - 1);
    if (error) {
      if (isMissingColumn(error)) return null;
      throw new Error(error.message);
    }
    const page = (data ?? []) as Array<Record<string, unknown>>;
    rows.push(...page);
    // A short page is the last page.
    if (page.length < PULL_PAGE_SIZE) return rows;
  }
}

interface PullOutcome {
  pulled: number;
  conflicts: number;
  removed: number;
}

/**
 * Apply a batch of server rows, oldest first, and move the cursor.
 *
 * `cursorField` must be the same column the query was ordered by, otherwise the
 * cursor can jump over rows that were never applied.
 */
async function applyPulled(
  rows: Array<Record<string, unknown>>,
  cursorField: "updated_at" | "created_at",
): Promise<PullOutcome> {
  const db = await getDB();
  let pulled = 0;
  let conflicts = 0;
  let removed = 0;

  let cursor: string | null = null;
  // Rows arrive in ascending cursor order, so the cursor may only advance up to
  // the FIRST row we could not apply. Taking the newest timestamp instead moved
  // it past skipped conflicts, and that server version was never offered again.
  let blocked = false;

  for (const raw of rows) {
    const id = String((raw as { id: string }).id);
    const local = await db.get("estimates", id);

    if (local?._dirty === 1) {
      conflicts += 1;
      blocked = true;
      continue; // the pending push resolves this
    }

    const deletedAt = (raw as { deleted_at?: string | null }).deleted_at ?? null;

    if (deletedAt) {
      // Deleted on another device: mirror the removal instead of upserting a
      // tombstone the history list would happily render.
      if (await removeFromServerDelete(id)) removed += 1;
    } else {
      const row = stripAdvanceSentinel(raw as { items?: unknown; advance_payment?: number });
      await upsertFromServer(row as Record<string, unknown>);
      pulled += 1;
    }

    if (blocked) continue;
    const stamp = (raw as Record<string, unknown>)[cursorField];
    if (typeof stamp === "string" && (!cursor || stamp > cursor)) cursor = stamp;
  }

  await noteServerNumbers(
    rows.map((r) => String((r as { invoice_number?: string }).invoice_number ?? "")),
  );

  if (cursor) await metaSet(META_KEYS.lastPulledAt, cursor);

  return { pulled, conflicts, removed };
}

async function pullAll(companyId: string): Promise<PullOutcome> {
  const since = await metaGet<string | null>(META_KEYS.lastPulledAt, null);

  if (since) {
    // Incremental. Tombstones must come through, so `deleted_at` is NOT
    // filtered here — a delete on device A reaches device B as a changed row.
    const rows = await fetchAllPages((from, to) =>
      invoicesSelect()
        .eq("company_id", companyId)
        .gt("updated_at", since)
        .order("updated_at", { ascending: true })
        .range(from, to),
    );
    if (rows) return applyPulled(rows, "updated_at");
    // `updated_at` missing → fall through to a full pull.
  }

  // Full pull. Paginated, because a merchant with more than one page of history
  // used to receive only the newest 1000 rows and then have the cursor moved
  // past everything older, permanently. Ascending so a partial failure resumes
  // from the right place instead of skipping the tail.
  let rows = await fetchAllPages((from, to) =>
    invoicesSelect()
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: true })
      .range(from, to),
  );
  if (rows) return applyPulled(rows, "updated_at");

  // `deleted_at` missing: same pull without the filter.
  rows = await fetchAllPages((from, to) =>
    invoicesSelect()
      .eq("company_id", companyId)
      .order("updated_at", { ascending: true })
      .range(from, to),
  );
  if (rows) return applyPulled(rows, "updated_at");

  // `updated_at` missing too — an un-migrated database. `created_at` is the
  // only ordering left, so the cursor has to come from the same column.
  rows = await fetchAllPages((from, to) =>
    invoicesSelect()
      .eq("company_id", companyId)
      .order("created_at", { ascending: true })
      .range(from, to),
  );
  return applyPulled(rows ?? [], "created_at");
}

async function pullProducts(companyId: string): Promise<void> {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("company_id", companyId)
    .eq("in_stock", true)
    .order("name");

  if (error) {
    console.warn("[sync] product mirror refresh failed:", error.message);
    return;
  }
  await mirrorProducts(companyId, (data ?? []) as Array<Record<string, unknown>>);
}

// ------------------------------------------------------------------ run

/**
 * Run a full sync cycle. Concurrent calls share one run.
 */
export async function syncNow(
  companyId: string | null | undefined,
  opts: { products?: boolean } = {},
): Promise<SyncResult> {
  if (inFlight) return inFlight;

  const empty: SyncResult = {
    pushed: 0,
    pulled: 0,
    renumbered: 0,
    renumberings: [],
    conflicts: 0,
    removed: 0,
    failed: 0,
    skipped: true,
  };

  if (!companyId) return empty;
  if (!isOnline()) return empty;

  inFlight = (async (): Promise<SyncResult> => {
    setState({ running: true, lastError: null });
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) return empty;

      const push = await pushAll();
      const pull = await pullAll(companyId);
      if (opts.products !== false) await pullProducts(companyId);

      await metaSet(META_KEYS.lastPushedAt, new Date().toISOString());
      setState({
        lastSyncAt: Date.now(),
        // Accumulate: a second cycle must not hide a rename the user has not
        // acknowledged yet.
        renumberings: [...state.renumberings, ...push.renumberings],
      });

      return { ...push, ...pull, skipped: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[sync] cycle failed:", message);
      setState({ lastError: message });
      return { ...empty, skipped: false, error: message };
    } finally {
      setState({ running: false });
      await refreshPending();
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Wire sync to the events that should trigger it. Returns a teardown function.
 */
export function startSyncScheduler(getCompanyId: () => string | null | undefined): () => void {
  let disposed = false;
  const timers: number[] = [];

  const run = () => {
    if (disposed) return;
    void syncNow(getCompanyId());
  };

  // Regular top-up while the app is open; cheap because it no-ops when the
  // outbox is empty and nothing changed server-side.
  timers.push(window.setInterval(run, 5 * 60_000));

  void import("@capacitor/network").then(({ Network }) => {
    if (disposed) return;
    void Network.addListener("networkStatusChange", (status) => {
      if (status.connected) run();
    });
  });

  void import("@capacitor/app").then(({ App }) => {
    if (disposed) return;
    void App.addListener("resume", run);
  });

  window.addEventListener("online", run);
  run();

  return () => {
    disposed = true;
    timers.forEach((t) => window.clearInterval(t));
    window.removeEventListener("online", run);
  };
}
