/**
 * Estimate repository — the ONLY API the UI uses to read or write estimates.
 *
 * Every write lands in IndexedDB first and returns immediately, then an outbox
 * entry is queued for the sync engine. The user never waits on the network and
 * never loses work when the network is not there.
 *
 * The local row and its outbox entry are written in ONE IndexedDB transaction.
 * Two transactions left a window in which the process could die between them,
 * producing either an estimate that exists locally and is never queued
 * (invisible data loss) or a tombstone that hides the row on the device while
 * it lives on forever server-side.
 */

import type { IDBPObjectStore, StoreNames } from "idb";
import {
  getDB,
  metaGet,
  metaSet,
  META_KEYS,
  type CatalogShareDB,
  type OfflineEstimate,
  type OfflineInvoiceItem,
  type OutboxEntry,
} from "./db";
import { getDeviceSuffix } from "@/native/prefs";

/**
 * Legacy sentinel: the web app used to smuggle the advance payment into the
 * `items` array because it predated the real `advance_payment` column. We write
 * the real column now, but still strip the sentinel on read so estimates
 * created by older builds display correctly.
 */
export const ADVANCE_SENTINEL = "ADVANCE_PAYMENT_METADATA";

export function stripAdvanceSentinel<T extends { items?: unknown; advance_payment?: number }>(
  row: T,
): T {
  const items = Array.isArray(row.items) ? (row.items as OfflineInvoiceItem[]) : [];
  const sentinel = items.find((i) => i?.product_id === ADVANCE_SENTINEL);
  if (!sentinel) return row;
  return {
    ...row,
    advance_payment: row.advance_payment || Number(sentinel.price) || 0,
    items: items.filter((i) => i.product_id !== ADVANCE_SENTINEL),
  };
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for very old WebViews.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ------------------------------------------------------------------ reads

export async function listEstimates(companyId: string): Promise<OfflineEstimate[]> {
  const db = await getDB();
  const rows = await db.getAllFromIndex("estimates", "by_company", companyId);
  return rows
    .filter((r) => !r._deleted)
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
}

export async function getEstimate(id: string): Promise<OfflineEstimate | undefined> {
  const db = await getDB();
  return db.get("estimates", id);
}

/** Number of local changes still waiting to reach the server. */
export async function pendingCount(): Promise<number> {
  const db = await getDB();
  return db.count("outbox");
}

// ----------------------------------------------------------- numbering

/**
 * Allocate the next estimate number.
 *
 * Online numbers stay in the familiar `INV-0007` sequence. Offline numbers are
 * tagged with a per-device suffix (`INV-K3F-0007`) so two devices on the same
 * account cannot mint the same number while both are disconnected — the server
 * has a UNIQUE index on (company_id, invoice_number), and a collision there
 * used to surface as a raw Postgres 23505 error toast.
 */
export async function nextEstimateNumber(
  companyId: string,
  opts: { offline: boolean },
): Promise<string> {
  const rows = await listEstimates(companyId);

  const highestLocal = rows.reduce((max, row) => {
    const match = row.invoice_number?.match(/(\d+)\s*$/);
    const n = match ? parseInt(match[1], 10) : 0;
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);

  const highestSeen = await metaGet<number>(META_KEYS.highestServerNumber, 0);
  const next = Math.max(highestLocal, highestSeen) + 1;
  await metaSet(META_KEYS.localSeq, next);

  const padded = String(next).padStart(4, "0");
  if (!opts.offline) return `INV-${padded}`;

  const suffix = await getDeviceSuffix();
  return `INV-${suffix}-${padded}`;
}

/** Record the highest number observed on the server so local numbering keeps up. */
export async function noteServerNumbers(numbers: string[]): Promise<void> {
  const highest = numbers.reduce((max, num) => {
    const match = num?.match(/(\d+)\s*$/);
    const n = match ? parseInt(match[1], 10) : 0;
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  const current = await metaGet<number>(META_KEYS.highestServerNumber, 0);
  if (highest > current) await metaSet(META_KEYS.highestServerNumber, highest);
}

// ----------------------------------------------------------------- writes

type NewOutboxEntry = Omit<
  OutboxEntry,
  "seq" | "attempts" | "lastError" | "nextAttemptAt" | "createdAt"
>;

/**
 * Queue a write on an ALREADY OPEN outbox store.
 *
 * Taking the store instead of opening its own transaction is what lets the
 * caller write the estimate and queue its push atomically. Every await inside
 * is an IndexedDB request, so the surrounding transaction stays alive.
 */
async function enqueue<TxStores extends ArrayLike<StoreNames<CatalogShareDB>>>(
  store: IDBPObjectStore<CatalogShareDB, TxStores, "outbox", "readwrite">,
  entry: NewOutboxEntry,
): Promise<void> {
  let next = entry;

  // Collapse consecutive pending writes for the same estimate: only the latest
  // state matters, and re-pushing intermediate states wastes requests.
  const existing = await store.index("by_estimate").getAll(next.estimate_id);
  for (const row of existing) {
    // A queued insert followed by an update is still an insert.
    if (row.op === "insert" && next.op === "update") {
      next = { ...next, op: "insert" };
    }
    if (row.seq !== undefined) await store.delete(row.seq);
  }

  await store.add({
    ...next,
    attempts: 0,
    lastError: null,
    nextAttemptAt: 0,
    createdAt: Date.now(),
  } as OutboxEntry);
}

export interface SaveEstimateInput {
  id?: string;
  company_id: string;
  invoice_number: string;
  invoice_date: string;
  customer_name: string;
  customer_phone?: string | null;
  customer_address?: string | null;
  items: OfflineInvoiceItem[];
  subtotal: number;
  sgst_percent?: number;
  sgst_amount?: number;
  cgst_percent?: number;
  cgst_amount?: number;
  discount?: number;
  advance_payment?: number;
  grand_total: number;
  final_amount: number;
  notes?: string | null;
}

/**
 * Create or update an estimate locally and queue it for sync.
 * Resolves as soon as the local write lands — never waits on the network.
 */
export async function saveEstimate(input: SaveEstimateInput): Promise<OfflineEstimate> {
  const db = await getDB();
  const now = new Date().toISOString();
  const isUpdate = Boolean(input.id);
  const id = input.id ?? newId();

  // Row and queue entry in one transaction: either both land or neither does.
  const tx = db.transaction(["estimates", "outbox"], "readwrite");
  const estimates = tx.objectStore("estimates");

  const existing = isUpdate ? await estimates.get(id) : undefined;

  const record: OfflineEstimate = {
    id,
    company_id: input.company_id,
    invoice_number: input.invoice_number,
    invoice_date: input.invoice_date,
    customer_name: input.customer_name,
    customer_phone: input.customer_phone ?? null,
    customer_address: input.customer_address ?? null,
    items: input.items ?? [],
    subtotal: input.subtotal ?? 0,
    sgst_percent: input.sgst_percent ?? 0,
    sgst_amount: input.sgst_amount ?? 0,
    cgst_percent: input.cgst_percent ?? 0,
    cgst_amount: input.cgst_amount ?? 0,
    discount: input.discount ?? 0,
    advance_payment: input.advance_payment ?? 0,
    grand_total: input.grand_total ?? 0,
    final_amount: input.final_amount ?? 0,
    notes: input.notes ?? null,
    created_at: existing?.created_at ?? now,
    updated_at: now,

    _dirty: 1,
    _deleted: 0,
    _syncedAt: existing?._syncedAt ?? null,
    _localOnly: existing ? existing._localOnly : 1,
    _pushAttempted: existing?._pushAttempted ?? 0,
    _renumberedFrom: existing?._renumberedFrom ?? null,
  };

  await estimates.put(record);
  await enqueue(tx.objectStore("outbox"), {
    op: existing && existing._localOnly === 0 ? "update" : "insert",
    estimate_id: id,
    company_id: input.company_id,
    payload: toServerPayload(record),
  });
  await tx.done;

  return record;
}

/**
 * Soft-delete locally and queue the server delete.
 * The tombstone is kept so a pull cannot resurrect the row.
 */
export async function deleteEstimate(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(["estimates", "outbox"], "readwrite");
  const estimates = tx.objectStore("estimates");
  const outbox = tx.objectStore("outbox");

  const existing = await estimates.get(id);
  if (!existing) {
    await tx.done;
    return;
  }

  // Hard delete only when the row provably never left the device. Rows written
  // by builds that predate `_pushAttempted` default to "assume it was pushed",
  // which costs one no-op server delete and cannot orphan anything.
  const neverPushed = existing._localOnly === 1 && (existing._pushAttempted ?? 1) === 0;

  if (neverPushed) {
    await estimates.delete(id);
    const queued = await outbox.index("by_estimate").getAll(id);
    for (const row of queued) {
      if (row.seq !== undefined) await outbox.delete(row.seq);
    }
    await tx.done;
    return;
  }

  await estimates.put({
    ...existing,
    _deleted: 1,
    _dirty: 1,
    updated_at: new Date().toISOString(),
  });
  await enqueue(outbox, {
    op: "delete",
    estimate_id: id,
    company_id: existing.company_id,
    payload: null,
  });
  await tx.done;
}

/** Strip the local-only columns before the row goes to PostgREST. */
export function toServerPayload(record: OfflineEstimate): Record<string, unknown> {
  const {
    _dirty,
    _deleted,
    _syncedAt,
    _localOnly,
    _pushAttempted,
    _renumberedFrom,
    updated_at,
    ...rest
  } = record;
  void _dirty;
  void _deleted;
  void _syncedAt;
  void _localOnly;
  void _pushAttempted;
  void _renumberedFrom;
  void updated_at;
  return rest;
}

/**
 * Record that an insert for this row has actually been sent.
 *
 * Called immediately BEFORE the network call, so an insert whose response never
 * comes back still leaves the device knowing the row may exist server-side.
 */
export async function markPushAttempted(id: string): Promise<void> {
  const db = await getDB();
  const row = await db.get("estimates", id);
  if (!row || row._pushAttempted === 1) return;
  await db.put("estimates", { ...row, _pushAttempted: 1 });
}

/** Write a server row into the local mirror (used by the pull phase). */
export async function upsertFromServer(row: Record<string, unknown>): Promise<void> {
  const db = await getDB();
  const clean = stripAdvanceSentinel(row as { items?: unknown; advance_payment?: number });
  const id = String((clean as { id: string }).id);

  const local = await db.get("estimates", id);

  // A dirty local row wins until the sync engine has pushed it; overwriting
  // here would silently discard what the user just typed.
  if (local?._dirty === 1) return;

  const serverUpdated =
    (clean as { updated_at?: string }).updated_at ??
    (clean as { created_at?: string }).created_at ??
    new Date().toISOString();

  await db.put("estimates", {
    ...(clean as unknown as OfflineEstimate),
    updated_at: serverUpdated,
    _dirty: 0,
    _deleted: 0,
    _syncedAt: new Date().toISOString(),
    _localOnly: 0,
    _pushAttempted: 1,
  });
}

/**
 * Drop a row the server reports as deleted.
 *
 * Returns false for a dirty row: the local edit has not been pushed yet, so the
 * push decides the outcome rather than a pull throwing the work away.
 */
export async function removeFromServerDelete(id: string): Promise<boolean> {
  const db = await getDB();
  const local = await db.get("estimates", id);
  if (!local) return false;
  if (local._dirty === 1) return false;
  await db.delete("estimates", id);
  return true;
}

/** Mark a row as successfully synced. */
export async function markSynced(id: string, serverNumber?: string): Promise<void> {
  const db = await getDB();
  const row = await db.get("estimates", id);
  if (!row) return;

  await db.put("estimates", {
    ...row,
    invoice_number: serverNumber ?? row.invoice_number,
    _renumberedFrom:
      serverNumber && serverNumber !== row.invoice_number ? row.invoice_number : row._renumberedFrom ?? null,
    _dirty: 0,
    _localOnly: 0,
    _pushAttempted: 1,
    _syncedAt: new Date().toISOString(),
  });
}

/** Remove a tombstone once the server delete has been confirmed. */
export async function purgeTombstone(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("estimates", id);
}
