/**
 * Offline store (IndexedDB).
 *
 * Holds everything the app needs to keep working with no network:
 *  - `estimates` : the full local mirror of `public.invoices`, plus the sync
 *                  bookkeeping columns (`_dirty`, `_deleted`, `_syncedAt`).
 *  - `products`  : read-only mirror so the item picker works offline.
 *  - `company`   : the signed-in company row, with the logo inlined as a data
 *                  URI so offline PDFs are still branded.
 *  - `outbox`    : ordered queue of writes waiting to reach the server.
 *  - `meta`      : sync cursors and counters.
 *
 * Nothing here talks to the network. The sync engine is the only module that
 * bridges this store and Supabase.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export const DB_NAME = "catalogshare";
export const DB_VERSION = 1;

/** Line item, matching the shape InvoiceForm produces. */
export interface OfflineInvoiceItem {
  product_id: string;
  name: string;
  quantity: number;
  unit: string;
  price: number;
  discount?: number;
  discount_percent?: number | "";
  amount: number;
  size?: string;
}

/** Local estimate record — mirrors `public.invoices` plus sync columns. */
export interface OfflineEstimate {
  /** uuid generated on device; becomes the server primary key. */
  id: string;
  company_id: string;
  invoice_number: string;
  invoice_date: string;
  customer_name: string;
  customer_phone: string | null;
  customer_address: string | null;
  items: OfflineInvoiceItem[];
  subtotal: number;
  sgst_percent: number;
  sgst_amount: number;
  cgst_percent: number;
  cgst_amount: number;
  discount: number;
  advance_payment: number;
  grand_total: number;
  final_amount: number;
  notes: string | null;
  created_at: string;
  updated_at: string;

  // ---- sync bookkeeping, never sent to PostgREST ----
  /** 1 while there are local changes the server has not accepted. */
  _dirty: 0 | 1;
  /** Tombstone: deleted locally, deletion not yet pushed. */
  _deleted: 0 | 1;
  /** ISO timestamp of the last successful push/pull for this row. */
  _syncedAt: string | null;
  /** True while this row has never existed on the server. */
  _localOnly: 0 | 1;
  /**
   * 1 once an insert for this row has actually left the device.
   *
   * `_localOnly` is not enough on its own to prove the server has never seen a
   * row: it is only cleared in markSynced, so an insert that reached Postgres
   * but whose response was lost still reads as local-only. Deleting such a row
   * locally would leave an orphan that the next pull resurrects.
   */
  _pushAttempted: 0 | 1;
  /** Set when the server renumbered this estimate on sync. */
  _renumberedFrom?: string | null;
}

export interface OfflineProduct {
  id: string;
  company_id: string;
  name: string;
  price: number;
  category: string | null;
  size: string | null;
  in_stock: boolean;
  image_url: string | null;
  features?: string[] | null;
  feature_sizes?: Record<string, unknown> | null;
  updated_at?: string | null;
}

export interface OfflineCompany {
  id: string;
  name: string;
  slug: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  gst_number: string | null;
  logo_url: string | null;
  /** Logo inlined so offline PDFs keep their branding. */
  logo_data_uri: string | null;
  subscription_plan: string | null;
  subscription_expires_at: string | null;
  trial_started_at: string | null;
  upi_id?: string | null;
  cachedAt: string;
}

export type OutboxOp = "insert" | "update" | "delete";

export interface OutboxEntry {
  seq?: number;
  op: OutboxOp;
  estimate_id: string;
  company_id: string;
  /** Snapshot of the row at enqueue time; null for deletes. */
  payload: Record<string, unknown> | null;
  attempts: number;
  lastError: string | null;
  /** Epoch ms; the worker skips entries whose backoff has not elapsed. */
  nextAttemptAt: number;
  createdAt: number;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

export interface CatalogShareDB extends DBSchema {
  estimates: {
    key: string;
    value: OfflineEstimate;
    indexes: {
      by_company: string;
      by_dirty: number;
      by_updated: string;
    };
  };
  products: {
    key: string;
    value: OfflineProduct;
    indexes: { by_company: string };
  };
  company: {
    key: string;
    value: OfflineCompany;
  };
  outbox: {
    key: number;
    value: OutboxEntry;
    indexes: { by_estimate: string };
  };
  meta: {
    key: string;
    value: MetaEntry;
  };
}

let dbPromise: Promise<IDBPDatabase<CatalogShareDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<CatalogShareDB>> {
  if (!dbPromise) {
    dbPromise = openDB<CatalogShareDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("estimates")) {
          const store = db.createObjectStore("estimates", { keyPath: "id" });
          store.createIndex("by_company", "company_id");
          store.createIndex("by_dirty", "_dirty");
          store.createIndex("by_updated", "updated_at");
        }
        if (!db.objectStoreNames.contains("products")) {
          const store = db.createObjectStore("products", { keyPath: "id" });
          store.createIndex("by_company", "company_id");
        }
        if (!db.objectStoreNames.contains("company")) {
          db.createObjectStore("company", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("outbox")) {
          const store = db.createObjectStore("outbox", {
            keyPath: "seq",
            autoIncrement: true,
          });
          store.createIndex("by_estimate", "estimate_id");
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }
      },
      blocked() {
        console.warn("[offline] another tab is holding an older DB version open");
      },
      terminated() {
        // Force a reconnect on the next call rather than failing forever.
        dbPromise = null;
      },
    });
  }
  return dbPromise;
}

/** IndexedDB is unavailable in some privacy modes — detect once, degrade gracefully. */
export async function isOfflineStoreAvailable(): Promise<boolean> {
  try {
    await getDB();
    return true;
  } catch (err) {
    console.warn("[offline] IndexedDB unavailable:", err);
    return false;
  }
}

// ---------------------------------------------------------------- meta

export async function metaGet<T>(key: string, fallback: T): Promise<T> {
  try {
    const db = await getDB();
    const row = await db.get("meta", key);
    return row ? (row.value as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function metaSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await getDB();
    await db.put("meta", { key, value });
  } catch (err) {
    console.warn("[offline] meta write failed:", key, err);
  }
}

export const META_KEYS = {
  lastPulledAt: "estimates_last_pulled_at",
  lastPushedAt: "estimates_last_pushed_at",
  productsPulledAt: "products_last_pulled_at",
  localSeq: "estimate_local_seq",
  highestServerNumber: "estimate_highest_server_number",
} as const;

/**
 * Drop every trace of the signed-in account.
 *
 * Called on sign-out: without this, the next account to log in on the same
 * device would read the previous owner's estimates and customer data.
 */
export async function clearOfflineData(): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction(["estimates", "products", "company", "outbox", "meta"], "readwrite");
    await Promise.all([
      tx.objectStore("estimates").clear(),
      tx.objectStore("products").clear(),
      tx.objectStore("company").clear(),
      tx.objectStore("outbox").clear(),
      tx.objectStore("meta").clear(),
      tx.done,
    ]);
  } catch (err) {
    console.warn("[offline] clear failed:", err);
  }
}
