/**
 * The activity log — who did what, when.
 *
 * WHAT THIS IS NOT
 * It is not `analytics_events`. That table records what an ANONYMOUS VISITOR
 * does on a storefront: page views, product clicks, WhatsApp taps. It has no
 * actor column, and it never will — a shopper is not a user of this app. This
 * module is the other half: what the MERCHANT does inside the app, attributed
 * to the person who did it.
 *
 * WHERE THE ROWS COME FROM
 * Mostly not from here. Every change to a row — an estimate created, edited or
 * deleted, a product added, a payment recorded, points moving — is written by a
 * database trigger (migration 20260904000000). That is deliberate and it is the
 * important design decision in the feature:
 *
 *   - a client-side call is missed the moment a new code path forgets it;
 *   - an estimate written offline is pushed by the sync engine hours later,
 *     from code that has no idea it is "creating" anything;
 *   - and a patched build can simply not make the call.
 *
 * A trigger sees the write itself, so all three cases log correctly and the log
 * cannot silently drift out of step with the data it describes.
 *
 * What this module logs is the remainder: the things that are NOT a row change
 * and therefore no trigger can see — a sign-in, an ad watched through to the
 * end. Those go through `log_activity`, which stamps the actor from `auth.uid()`
 * on the server and resolves the company itself, so a caller cannot attribute
 * an action to somebody else.
 *
 * EVERY WRITE HERE IS FIRE-AND-FORGET. A log line is never worth a spinner, an
 * error toast, or a failed sign-in. `logActivity` resolves false and says
 * nothing the user can see.
 */

import { supabase } from "@/integrations/supabase/client";
import { fetchPaged, type PagedResult } from "@/lib/fetchPaged";

/**
 * The generated types predate `activity_events`, so the typed client refuses
 * the table name.
 *
 * Described structurally rather than cast to `any`: the query below is built up
 * across four conditional branches, and `any` would silently accept a
 * misspelled filter or a builder method that does not exist — which is exactly
 * the kind of mistake that ends as an empty screen rather than an error.
 */
interface Response {
  data: unknown;
  error: { message: string } | null;
}

interface QueryBuilder extends PromiseLike<Response> {
  select(columns: string): QueryBuilder;
  order(column: string, options: { ascending: boolean }): QueryBuilder;
  range(from: number, to: number): QueryBuilder;
  eq(column: string, value: unknown): QueryBuilder;
  like(column: string, pattern: string): QueryBuilder;
  gte(column: string, value: unknown): QueryBuilder;
}

interface LooseClient {
  from(table: string): QueryBuilder;
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<Response>;
}

const db = () => supabase as unknown as LooseClient;

// ------------------------------------------------------------------- writing

/**
 * Actions this client may write.
 *
 * A union rather than a free string so a typo becomes a build error instead of
 * a row nobody ever queries. Everything here is something no trigger can see;
 * anything that IS a row change is deliberately absent, because logging it from
 * both sides would double-count it.
 */
export type ClientAction =
  | "auth.signed_in"
  | "auth.signed_up"
  | "auth.signed_out"
  | "ad.watched"
  | "reward.redeemed"
  | "store.shared"
  | "export.downloaded";

export interface LogOptions {
  entityType?: string;
  entityId?: string | null;
  /** The one line a human reads in the feed. */
  summary?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Record something the merchant did.
 *
 * Never throws and never rejects. The caller is always in the middle of doing
 * something the user actually asked for, and an audit row failing to land must
 * not interrupt it.
 */
export async function logActivity(
  action: ClientAction,
  options: LogOptions = {},
): Promise<boolean> {
  try {
    const { data, error } = await db().rpc("log_activity", {
      p_action: action,
      p_entity_type: options.entityType ?? null,
      p_entity_id: options.entityId ?? null,
      p_summary: options.summary ?? null,
      p_metadata: options.metadata ?? {},
    });
    if (error) {
      // A database without the migration is a normal state for an older client,
      // not an error worth surfacing. Logged once so it is findable.
      console.warn("[activity] not logged:", error.message);
      return false;
    }
    return (data as { ok?: boolean } | null)?.ok === true;
  } catch (err) {
    console.warn("[activity] log threw:", err);
    return false;
  }
}

/**
 * The same thing, for callers that must not be made async.
 *
 * A sign-in handler navigating away is the case this exists for: awaiting the
 * log would put a database round trip between the tap and the next screen.
 */
export function logActivityInBackground(action: ClientAction, options: LogOptions = {}): void {
  void logActivity(action, options);
}

// ------------------------------------------------------------------- reading

export interface ActivityEvent {
  id: string;
  company_id: string | null;
  actor_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  summary: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

/** An event with the names the feed shows, resolved from the rows beside it. */
export interface ActivityRow extends ActivityEvent {
  company_name: string | null;
  actor_email: string | null;
}

/**
 * The groups the feed filters by.
 *
 * Keyed on the prefix of the action rather than on a list of exact verbs, so an
 * action added by a later migration still lands in the right bucket instead of
 * vanishing from a filtered view.
 */
export const ACTIVITY_GROUPS = {
  estimate: "Estimates",
  product: "Products",
  auth: "Sign-ins",
  payment: "Payments",
  points: "Points",
  ad: "Ads",
  reward: "Rewards",
  store: "Storefront",
  export: "Exports",
} as const;

export type ActivityGroup = keyof typeof ACTIVITY_GROUPS;

export function groupOf(action: string): ActivityGroup | "other" {
  const prefix = action.split(".")[0];
  return prefix in ACTIVITY_GROUPS ? (prefix as ActivityGroup) : "other";
}

/**
 * Plain English for an action.
 *
 * Falls back to the verb itself rather than to "Unknown": an action this build
 * has never heard of is still readable as `estimate.archived`, and printing
 * "Unknown" instead would hide the one thing that identifies it.
 */
const ACTION_LABELS: Record<string, string> = {
  "estimate.created": "Created an estimate",
  "estimate.updated": "Edited an estimate",
  "estimate.deleted": "Deleted an estimate",
  "estimate.restored": "Restored an estimate",
  "estimate.purged": "Permanently removed an estimate",
  "product.created": "Added a product",
  "product.updated": "Edited a product",
  "product.deleted": "Deleted a product",
  "auth.signed_in": "Signed in",
  "auth.signed_up": "Created an account",
  "auth.signed_out": "Signed out",
  "payment.recorded": "Payment recorded",
  "payment.updated": "Payment updated",
  "points.earned": "Earned points",
  "points.spent": "Spent points",
  "ad.watched": "Watched an ad",
  "reward.redeemed": "Redeemed a reward",
  "store.shared": "Shared the storefront",
  "export.downloaded": "Downloaded an export",
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export interface ActivityQuery {
  /** Restrict to one company. Omit for the whole platform. */
  companyId?: string | null;
  /** Restrict to one group, by action prefix. */
  group?: ActivityGroup | null;
  /** Only events at or after this ISO timestamp. */
  since?: string | null;
  /** Ceiling on rows read. The feed wants a page; the export wants everything. */
  max?: number;
}

/**
 * Read the log, newest first.
 *
 * Paginated through `fetchPaged` for the reason every read in this app is:
 * PostgREST stops at `db-max-rows` (1000) and says nothing about the rest, and
 * a log is exactly the kind of table that passes a thousand rows quickly and
 * then silently exports a sample labelled as a total.
 */
export async function fetchActivity(query: ActivityQuery = {}): Promise<PagedResult> {
  const { companyId, group, since, max = 2000 } = query;

  return fetchPaged((from, to) => {
    let q = db()
      .from("activity_events")
      .select("*, companies(name)")
      .order("created_at", { ascending: false })
      .range(from, to);

    if (companyId) q = q.eq("company_id", companyId);
    // `like` on the prefix, not `eq` on a list of verbs — see ACTIVITY_GROUPS.
    if (group) q = q.like("action", `${group}.%`);
    if (since) q = q.gte("created_at", since);

    return q;
  }, max);
}

/**
 * Attach the company name PostgREST embedded, and flatten it.
 *
 * The embed arrives as `companies: { name }` (or null for a platform-level
 * event such as a sign-in before the company row exists), which is awkward to
 * render against. Actor emails are NOT resolved here: `auth.users` has no read
 * policy, deliberately, so the console asks a function for them separately.
 */
export function normaliseActivity(rows: Record<string, unknown>[]): ActivityRow[] {
  return rows.map((row) => {
    const company = row.companies as { name?: unknown } | null | undefined;
    return {
      id: String(row.id ?? ""),
      company_id: row.company_id == null ? null : String(row.company_id),
      actor_id: row.actor_id == null ? null : String(row.actor_id),
      action: String(row.action ?? ""),
      entity_type: row.entity_type == null ? null : String(row.entity_type),
      entity_id: row.entity_id == null ? null : String(row.entity_id),
      summary: row.summary == null ? null : String(row.summary),
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      created_at: String(row.created_at ?? ""),
      company_name: typeof company?.name === "string" ? company.name : null,
      actor_email: null,
    };
  });
}

/**
 * Put an email against each actor id.
 *
 * `auth.users` is not readable by any client — that is correct and must stay
 * that way — so the ids are resolved through `admin_lookup_users`, which is
 * admin-only and returns nothing but id and email. A feed that cannot resolve a
 * name still renders: the row keeps a null email and the console shows the
 * shortened id, which is better than hiding the event.
 */
export async function attachActorEmails(rows: ActivityRow[]): Promise<ActivityRow[]> {
  const ids = [...new Set(rows.map((r) => r.actor_id).filter((id): id is string => !!id))];
  if (ids.length === 0) return rows;

  try {
    const { data, error } = await db().rpc("admin_lookup_users", { p_ids: ids });
    if (error) {
      console.warn("[activity] actor lookup unavailable:", error.message);
      return rows;
    }
    const byId = new Map<string, string>();
    for (const u of (data ?? []) as { id?: unknown; email?: unknown }[]) {
      if (u.id) byId.set(String(u.id), String(u.email ?? ""));
    }
    return rows.map((r) => ({
      ...r,
      actor_email: r.actor_id ? (byId.get(r.actor_id) ?? null) : null,
    }));
  } catch (err) {
    console.warn("[activity] actor lookup threw:", err);
    return rows;
  }
}

/** "just now" / "14 min ago" / "23 Aug", for the feed's right-hand column. */
export function shortWhen(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;

  return new Date(then).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}
