/**
 * The master data export, shaped for a BI tool rather than for reading.
 *
 * WHAT WAS WRONG WITH THE OLD ONE
 * It produced four sheets that looked like a report and behaved like a
 * screenshot. Three separate faults, each of which alone is enough to make a
 * file useless in Tableau:
 *
 *   1. NOTHING WAS AGGREGATED. The analytics sheet was a raw event log with no
 *      day, no company rollup and no derived measure, so "no analytics showing"
 *      was literally true — there was nothing in the file to plot.
 *   2. EVERY DATE WAS `toLocaleString()`. "27/8/2026, 3:04:12 pm" is text, in
 *      whatever locale the exporting browser happened to have. Tableau types
 *      that column as a string, and every date filter, trend line and
 *      year-over-year comparison is then unavailable.
 *   3. IT SILENTLY TRUNCATED. A PostgREST select with no range returns at most
 *      `db-max-rows` (1000 on a stock Supabase). Past a thousand events the
 *      export was a sample presented as a total, with nothing saying so.
 *
 * Smaller ones that matter just as much downstream: `"4 / 5"` for a rating and
 * `"Yes"`/`"No"` for a boolean cannot be aggregated; `"N/A"` in an id column
 * invents a join key that matches nothing; and a sheet whose only row is
 * `{ Message: "No analytics events recorded yet." }` has a different schema
 * from the same sheet next week, which breaks a saved workbook.
 *
 * WHAT THIS PRODUCES
 * One .xlsx whose sheets are TABLES: a fixed header row, one type per column,
 * a stable schema whether or not there is data, ISO-8601 dates, real numbers,
 * real booleans, and an id column on every row so Tableau can relate the sheets
 * to each other. Two of them (`analytics_daily`, `platform_daily`) are
 * pre-aggregated to a day grain and zero-filled, because a line chart drawn
 * from a table that omits quiet days overstates every average on it.
 *
 * WHY IST AND NOT UTC
 * Every merchant on this platform is in India, so "which day did that sale
 * happen on" is an IST question. Timestamps are stored UTC and stay UTC in the
 * `*_at_utc` columns; every `*_date_ist` / `*_at_ist` column beside them is the
 * same instant in +05:30, computed arithmetically rather than through the
 * exporting machine's locale so the file does not change meaning depending on
 * whose laptop made it.
 */

import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { fetchPaged } from "@/lib/fetchPaged";

// ---------------------------------------------------------------- constants

/** India Standard Time. Fixed offset, no DST, so plain arithmetic is exact. */
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Per-table ceiling.
 *
 * Excel stops at 1,048,576 rows and a browser tab building a workbook that
 * large will be killed long before that. Truncation is unavoidable somewhere;
 * what matters is that it is ANNOUNCED — the old export's silent 1000-row cut
 * is the failure being fixed here, so every cut is listed in `export_info`.
 */
const MAX_ROWS = 100_000;

/** How far back the day-grain sheets are zero-filled. */
const ZERO_FILL_DAYS = 365;

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

// ------------------------------------------------------------ time helpers

/** Milliseconds since epoch, or null for anything unparseable. */
export function parseMs(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const t = Date.parse(String(value));
  return Number.isNaN(t) ? null : t;
}

/**
 * The IST day an instant falls in, as a whole number of days since the epoch.
 *
 * Days as integers rather than as strings because the zero-fill has to count
 * in them, and `"2026-08-27" + 1` is not a thing.
 */
export function istDay(ms: number): number {
  return Math.floor((ms + IST_OFFSET_MS) / DAY_MS);
}

function two(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** `2026-08-27` for an IST day number. */
export function istDayToDate(day: number): string {
  const d = new Date(day * DAY_MS);
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
}

/** `2026-08` for an IST day number. */
export function istDayToMonth(day: number): string {
  return istDayToDate(day).slice(0, 7);
}

/** `Thursday` for an IST day number. */
export function istDayToWeekday(day: number): string {
  return WEEKDAYS[new Date(day * DAY_MS).getUTCDay()];
}

/**
 * `2026-08-27 15:04:12`, IST.
 *
 * Deliberately not `toLocaleString`: the whole point is that the same row
 * exports identically from any machine. The shifted Date is read with its UTC
 * getters, which is what turns the offset into wall-clock IST.
 */
export function istStamp(ms: number): string {
  const d = new Date(ms + IST_OFFSET_MS);
  return (
    `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}` +
    ` ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}`
  );
}

/** Hour of the IST day, 0-23. */
export function istHour(ms: number): number {
  return new Date(ms + IST_OFFSET_MS).getUTCHours();
}

/** Full ISO-8601 in UTC, unchanged from what the database holds. */
function utcStamp(ms: number): string {
  return new Date(ms).toISOString();
}

// ----------------------------------------------------------- value helpers

/**
 * A cell value.
 *
 * `null` is the ONLY empty. SheetJS writes nothing at all for it, so the cell
 * is genuinely blank and Tableau reads it as Null. An empty string would be a
 * text cell, and one of those in an otherwise numeric column is enough to make
 * Tableau type the whole column as text.
 */
export type Cell = string | number | boolean | null;

export type Row = Record<string, Cell>;

export interface Table {
  name: string;
  columns: string[];
  rows: Row[];
  /** Set when the fetch hit `MAX_ROWS`, so `export_info` can say so. */
  truncated?: boolean;
}

/** Trimmed text, or null. Never "N/A": that is a value, and it joins to nothing. */
export function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

/** A finite number, or null. Strings from NUMERIC columns are parsed. */
export function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** A number that must exist for arithmetic. Missing counts as zero. */
function num0(value: unknown): number {
  return num(value) ?? 0;
}

/** Money, to two decimals — a NUMERIC(12,2) round-trips through Number cleanly. */
function money(value: unknown): number | null {
  const n = num(value);
  return n === null ? null : Math.round(n * 100) / 100;
}

/** A real boolean cell, or null when the source has nothing to say. */
function bool(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  return Boolean(value);
}

/** Percentage to one decimal, guarding the zero denominator. */
function pct(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.round((part / whole) * 1000) / 10;
}

// ------------------------------------------------------------------ fetch

type AnyRow = Record<string, unknown>;

export interface FetchIssue {
  table: string;
  message: string;
}

/**
 * Read a whole table for the export.
 *
 * A failure is an ISSUE, not an exception: the rewards and plans tables are
 * newer than some deployments of this app, and a database that has not had
 * those migrations applied must still produce an export of everything else.
 */
async function fetchAll(
  table: string,
  orderBy: string,
  issues: FetchIssue[],
): Promise<{ rows: AnyRow[]; truncated: boolean }> {
  const result = await fetchPaged((from, to) =>
    supabase
      .from(table as never)
      .select("*")
      .order(orderBy, { ascending: true })
      .range(from, to),
  );

  if (result.error) issues.push({ table, message: result.error });
  return { rows: result.rows, truncated: result.truncated };
}

export interface RawData {
  companies: AnyRow[];
  products: AnyRow[];
  analytics: AnyRow[];
  analyticsTruncated: boolean;
  surveys: AnyRow[];
  suggestions: AnyRow[];
  invoices: AnyRow[];
  subscriptions: AnyRow[];
  points: AnyRow[];
  redemptions: AnyRow[];
  plans: AnyRow[];
  activity: AnyRow[];
  activityTruncated: boolean;
  issues: FetchIssue[];
}

async function fetchEverything(): Promise<RawData> {
  const issues: FetchIssue[] = [];

  // Sequential, not Promise.all. Ten concurrent paginated walks against one
  // self-hosted Postgres is a load spike for no gain — the export is a
  // once-in-a-while click, and a browser that runs out of sockets mid-walk
  // fails a page silently.
  const companies = await fetchAll("companies", "created_at", issues);
  const products = await fetchAll("products", "created_at", issues);
  const analytics = await fetchAll("analytics_events", "created_at", issues);
  const surveys = await fetchAll("surveys", "created_at", issues);
  const suggestions = await fetchAll("suggestions", "created_at", issues);
  const invoices = await fetchAll("invoices", "created_at", issues);
  const subscriptions = await fetchAll("subscriptions", "created_at", issues);
  const points = await fetchAll("points_ledger", "created_at", issues);
  const redemptions = await fetchAll("reward_redemptions", "created_at", issues);
  const plans = await fetchAll("plans", "sort_order", issues);
  // A database without 20260904000000 has no activity_events, and fetchAll
  // records that in `issues` rather than throwing — an export missing one
  // sheet is worth having; an export that dies is not.
  const activity = await fetchAll("activity_events", "created_at", issues);

  return {
    companies: companies.rows,
    products: products.rows,
    analytics: analytics.rows,
    analyticsTruncated: analytics.truncated,
    surveys: surveys.rows,
    suggestions: suggestions.rows,
    invoices: invoices.rows,
    subscriptions: subscriptions.rows,
    points: points.rows,
    redemptions: redemptions.rows,
    plans: plans.rows,
    activity: activity.rows,
    activityTruncated: activity.truncated,
    issues,
  };
}

// ------------------------------------------------------------- derivations

interface CompanyRef {
  id: string;
  name: string | null;
  slug: string | null;
  plan: string | null;
}

interface DayBucket {
  views: number;
  productClicks: number;
  whatsappClicks: number;
  other: number;
}

const emptyBucket = (): DayBucket => ({
  views: 0,
  productClicks: 0,
  whatsappClicks: 0,
  other: 0,
});

function addEvent(bucket: DayBucket, eventType: string | null): void {
  switch (eventType) {
    case "page_view":
      bucket.views += 1;
      break;
    case "product_click":
      bucket.productClicks += 1;
      break;
    case "whatsapp_click":
      bucket.whatsappClicks += 1;
      break;
    default:
      // A new event type shipped by the app but unknown to this build still
      // counts towards the total rather than vanishing from it.
      bucket.other += 1;
  }
}

const bucketTotal = (b: DayBucket): number =>
  b.views + b.productClicks + b.whatsappClicks + b.other;

/**
 * The set of IST days a day-grain sheet should carry.
 *
 * Every day that actually has data, plus the last `ZERO_FILL_DAYS` up to today,
 * so a chart shows quiet days as zero instead of skipping them — the difference
 * between "we averaged 4 views a day" and "we averaged 4 views on the days we
 * had any", which are not the same claim.
 *
 * Bounded on both ends: a shop that stopped two years ago keeps its real days
 * but does not get 700 rows of zeroes on the end.
 */
export function daySpine(realDays: Iterable<number>, todayDay: number): number[] {
  const days = new Set<number>(realDays);
  const firstReal = Math.min(...days, todayDay);
  const from = Math.max(firstReal, todayDay - ZERO_FILL_DAYS);
  for (let d = from; d <= todayDay; d += 1) days.add(d);
  return [...days].sort((a, b) => a - b);
}

// ---------------------------------------------------------------- builders

/**
 * Turn the fetched tables into the sheets.
 *
 * Pure: same input, same output, no clock of its own. `nowMs` is passed in so
 * the day spine and every "days since" measure are testable and so two sheets
 * in one workbook cannot disagree about what today is.
 */
export function buildTables(raw: RawData, nowMs: number): Table[] {
  const todayDay = istDay(nowMs);

  // ---- lookups ------------------------------------------------------------
  const companyById = new Map<string, CompanyRef>();
  const companyBySlug = new Map<string, CompanyRef>();
  for (const c of raw.companies) {
    const id = text(c.id);
    if (!id) continue;
    const ref: CompanyRef = {
      id,
      name: text(c.name),
      slug: text(c.slug),
      plan: text(c.subscription_plan),
    };
    companyById.set(id, ref);
    if (ref.slug) companyBySlug.set(ref.slug, ref);
  }

  const planNameById = new Map<string, string>();
  const planLimitById = new Map<string, number>();
  for (const p of raw.plans) {
    const id = text(p.id);
    if (!id) continue;
    planNameById.set(id, text(p.name) ?? id);
    planLimitById.set(id, num0(p.product_limit));
  }

  const productById = new Map<string, { name: string | null; companyId: string | null }>();
  const productCount = new Map<string, number>();
  for (const p of raw.products) {
    const id = text(p.id);
    const companyId = text(p.company_id);
    if (id) productById.set(id, { name: text(p.name), companyId });
    if (companyId) productCount.set(companyId, (productCount.get(companyId) ?? 0) + 1);
  }

  // ---- analytics rollups --------------------------------------------------
  /** company_id (or "" for the landing page) + IST day -> counts */
  const perCompanyDay = new Map<string, DayBucket>();
  const perCompany = new Map<string, DayBucket>();
  const perPlatformDay = new Map<number, DayBucket>();
  const activeByDay = new Map<number, Set<string>>();
  const clicksByProduct = new Map<string, number>();
  const lastSeenByCompany = new Map<string, number>();
  const realDays = new Set<number>();

  for (const e of raw.analytics) {
    const ms = parseMs(e.created_at);
    if (ms === null) continue;
    const day = istDay(ms);
    const companyId = text(e.company_id) ?? "";
    const type = text(e.event_type);

    realDays.add(day);

    const dayKey = `${companyId}|${day}`;
    let bucket = perCompanyDay.get(dayKey);
    if (!bucket) perCompanyDay.set(dayKey, (bucket = emptyBucket()));
    addEvent(bucket, type);

    let total = perCompany.get(companyId);
    if (!total) perCompany.set(companyId, (total = emptyBucket()));
    addEvent(total, type);

    let platform = perPlatformDay.get(day);
    if (!platform) perPlatformDay.set(day, (platform = emptyBucket()));
    addEvent(platform, type);

    if (companyId) {
      let active = activeByDay.get(day);
      if (!active) activeByDay.set(day, (active = new Set()));
      active.add(companyId);

      const seen = lastSeenByCompany.get(companyId) ?? 0;
      if (ms > seen) lastSeenByCompany.set(companyId, ms);
    }

    const productId = text(e.product_id);
    if (productId && type === "product_click") {
      clicksByProduct.set(productId, (clicksByProduct.get(productId) ?? 0) + 1);
    }
  }

  // ---- estimate rollups ---------------------------------------------------
  const estimatesByCompany = new Map<string, { count: number; value: number }>();
  const estimatesByDay = new Map<number, { count: number; value: number }>();
  for (const inv of raw.invoices) {
    if (inv.deleted_at) continue;
    const companyId = text(inv.company_id);
    const value = num0(inv.final_amount) || num0(inv.grand_total);
    if (companyId) {
      const agg = estimatesByCompany.get(companyId) ?? { count: 0, value: 0 };
      agg.count += 1;
      agg.value += value;
      estimatesByCompany.set(companyId, agg);
    }
    const ms = parseMs(inv.created_at);
    if (ms !== null) {
      const day = istDay(ms);
      realDays.add(day);
      const agg = estimatesByDay.get(day) ?? { count: 0, value: 0 };
      agg.count += 1;
      agg.value += value;
      estimatesByDay.set(day, agg);
    }
  }

  // ---- points rollups -----------------------------------------------------
  const pointsByCompany = new Map<string, { balance: number; earned: number; spent: number }>();
  for (const entry of raw.points) {
    const companyId = text(entry.company_id);
    if (!companyId) continue;
    const delta = num0(entry.delta);
    const agg = pointsByCompany.get(companyId) ?? { balance: 0, earned: 0, spent: 0 };
    agg.balance += delta;
    if (delta >= 0) agg.earned += delta;
    else agg.spent += -delta;
    pointsByCompany.set(companyId, agg);
  }

  // ---- signups / new products / revenue per day ---------------------------
  const signupsByDay = new Map<number, number>();
  for (const c of raw.companies) {
    const ms = parseMs(c.created_at);
    if (ms === null) continue;
    const day = istDay(ms);
    realDays.add(day);
    signupsByDay.set(day, (signupsByDay.get(day) ?? 0) + 1);
  }

  const newProductsByDay = new Map<number, number>();
  for (const p of raw.products) {
    const ms = parseMs(p.created_at);
    if (ms === null) continue;
    const day = istDay(ms);
    realDays.add(day);
    newProductsByDay.set(day, (newProductsByDay.get(day) ?? 0) + 1);
  }

  const revenueByDay = new Map<number, { payments: number; rupees: number }>();
  for (const s of raw.subscriptions) {
    const ms = parseMs(s.created_at);
    if (ms === null) continue;
    const day = istDay(ms);
    realDays.add(day);
    const agg = revenueByDay.get(day) ?? { payments: 0, rupees: 0 };
    agg.payments += 1;
    // `amount` is paise, by the column's own comment.
    agg.rupees += num0(s.amount) / 100;
    revenueByDay.set(day, agg);
  }

  // The activity log gets its own pass here, BEFORE the spine is cut, rather
  // than in the loop that builds its sheet further down. A day that exists only
  // in the log — a run of sign-ins on a day nobody bought anything — would
  // otherwise fall outside the spine and lose its row in every day-grain table.
  // The per-group counting stays next to the sheet it feeds.
  for (const a of raw.activity) {
    const ms = parseMs(a.created_at);
    if (ms !== null) realDays.add(istDay(ms));
  }

  const spine = daySpine(realDays, todayDay);

  // ---- sheet: companies ---------------------------------------------------
  const companiesTable: Table = {
    name: "companies",
    columns: [
      "company_id",
      "company_name",
      "store_slug",
      "phone",
      "email",
      "address",
      "gst_number",
      "plan_id",
      "plan_name",
      "is_paid",
      "plan_expires_date_ist",
      "plan_days_left",
      "plan_product_limit",
      "bonus_product_limit",
      "product_limit_total",
      "product_count",
      "catalogue_used_pct",
      "page_views",
      "product_clicks",
      "whatsapp_clicks",
      "click_through_pct",
      "estimates_created",
      "estimate_value_inr",
      "points_balance",
      "points_earned",
      "points_spent",
      "signup_date_ist",
      "signup_month_ist",
      "days_since_signup",
      "last_active_date_ist",
      "created_at_utc",
    ],
    rows: raw.companies.map((c): Row => {
      const id = text(c.id) ?? "";
      const planId = text(c.subscription_plan) ?? "free";
      const expiresMs = parseMs(c.subscription_expires_at);
      const isPaid = planId !== "free" && expiresMs !== null && expiresMs > nowMs;
      const createdMs = parseMs(c.created_at);
      const events = perCompany.get(id) ?? emptyBucket();
      const estimates = estimatesByCompany.get(id) ?? { count: 0, value: 0 };
      const points = pointsByCompany.get(id) ?? { balance: 0, earned: 0, spent: 0 };
      const bonus = num0(c.bonus_product_limit);
      const planLimit = planLimitById.get(isPaid ? planId : "free") ?? null;
      const limitTotal = planLimit === null ? null : planLimit + bonus;
      const count = productCount.get(id) ?? 0;
      const lastSeen = lastSeenByCompany.get(id);

      return {
        company_id: id,
        company_name: text(c.name),
        store_slug: text(c.slug),
        phone: text(c.phone),
        email: text(c.email),
        address: text(c.address),
        gst_number: text(c.gst_number),
        plan_id: planId,
        plan_name: planNameById.get(planId) ?? planId,
        is_paid: isPaid,
        plan_expires_date_ist: expiresMs === null ? null : istDayToDate(istDay(expiresMs)),
        plan_days_left:
          isPaid && expiresMs !== null ? Math.ceil((expiresMs - nowMs) / DAY_MS) : 0,
        plan_product_limit: planLimit,
        bonus_product_limit: bonus,
        product_limit_total: limitTotal,
        product_count: count,
        catalogue_used_pct: limitTotal ? pct(count, limitTotal) : null,
        page_views: events.views,
        product_clicks: events.productClicks,
        whatsapp_clicks: events.whatsappClicks,
        click_through_pct: pct(events.productClicks, events.views),
        estimates_created: estimates.count,
        estimate_value_inr: Math.round(estimates.value * 100) / 100,
        points_balance: points.balance,
        points_earned: points.earned,
        points_spent: points.spent,
        signup_date_ist: createdMs === null ? null : istDayToDate(istDay(createdMs)),
        signup_month_ist: createdMs === null ? null : istDayToMonth(istDay(createdMs)),
        days_since_signup: createdMs === null ? null : todayDay - istDay(createdMs),
        last_active_date_ist: lastSeen ? istDayToDate(istDay(lastSeen)) : null,
        created_at_utc: createdMs === null ? null : utcStamp(createdMs),
      };
    }),
  };

  // ---- sheet: products ----------------------------------------------------
  const productsTable: Table = {
    name: "products",
    columns: [
      "product_id",
      "company_id",
      "company_name",
      "store_slug",
      "product_name",
      "category",
      "price_inr",
      "in_stock",
      "is_trending",
      "has_image",
      "option_count",
      "options",
      "sizes",
      "product_clicks",
      "description",
      "created_date_ist",
      "created_month_ist",
      "created_at_utc",
    ],
    rows: raw.products.map((p): Row => {
      const id = text(p.id) ?? "";
      const companyId = text(p.company_id);
      const company = companyId ? companyById.get(companyId) : undefined;
      const createdMs = parseMs(p.created_at);
      const features = Array.isArray(p.features) ? (p.features as unknown[]).map(String) : [];

      let sizes: string | null = null;
      const featureSizes = p.feature_sizes;
      if (featureSizes && typeof featureSizes === "object" && !Array.isArray(featureSizes)) {
        const pairs = Object.entries(featureSizes as Record<string, unknown>);
        if (pairs.length > 0) {
          sizes = pairs
            .map(([feat, arr]) => `${feat}: ${(Array.isArray(arr) ? arr : [arr]).join(", ")}`)
            .join(" | ");
        }
      }
      if (!sizes) sizes = text(p.size);

      return {
        product_id: id,
        company_id: companyId,
        company_name: company?.name ?? null,
        store_slug: company?.slug ?? null,
        product_name: text(p.name),
        category: text(p.category),
        price_inr: money(p.price),
        in_stock: bool(p.in_stock),
        is_trending: bool(p.is_trending),
        has_image: Boolean(text(p.image_url)),
        option_count: features.length,
        options: features.length > 0 ? features.join(", ") : null,
        sizes,
        product_clicks: clicksByProduct.get(id) ?? 0,
        description: text(p.description),
        created_date_ist: createdMs === null ? null : istDayToDate(istDay(createdMs)),
        created_month_ist: createdMs === null ? null : istDayToMonth(istDay(createdMs)),
        created_at_utc: createdMs === null ? null : utcStamp(createdMs),
      };
    }),
  };

  // ---- sheet: analytics_events -------------------------------------------
  const eventsTable: Table = {
    name: "analytics_events",
    truncated: raw.analyticsTruncated,
    columns: [
      "event_id",
      "company_id",
      "company_name",
      "store_slug",
      "event_type",
      "page_url",
      "product_id",
      "product_name",
      "is_landing_page",
      "event_date_ist",
      "event_month_ist",
      "event_weekday_ist",
      "event_hour_ist",
      "event_at_ist",
      "event_at_utc",
    ],
    rows: raw.analytics.map((e): Row => {
      const ms = parseMs(e.created_at);
      const day = ms === null ? null : istDay(ms);
      const companyId = text(e.company_id);
      const company = companyId ? companyById.get(companyId) : undefined;
      const productId = text(e.product_id);

      return {
        event_id: text(e.id),
        company_id: companyId,
        company_name: company?.name ?? null,
        store_slug: company?.slug ?? null,
        event_type: text(e.event_type),
        page_url: text(e.page_url),
        product_id: productId,
        product_name: productId ? (productById.get(productId)?.name ?? null) : null,
        // company_id is NULL for the marketing site, by the table's design.
        is_landing_page: !companyId,
        event_date_ist: day === null ? null : istDayToDate(day),
        event_month_ist: day === null ? null : istDayToMonth(day),
        event_weekday_ist: day === null ? null : istDayToWeekday(day),
        event_hour_ist: ms === null ? null : istHour(ms),
        event_at_ist: ms === null ? null : istStamp(ms),
        event_at_utc: ms === null ? null : utcStamp(ms),
      };
    }),
  };

  // ---- sheet: analytics_daily --------------------------------------------
  //
  // One row per company per day, zero-filled. This is the sheet a dashboard is
  // actually built on: drag `event_date_ist` to columns, a measure to rows, and
  // there is a trend line with no further work.
  const dailyRows: Row[] = [];
  const companiesWithEvents = new Set<string>();
  for (const key of perCompanyDay.keys()) companiesWithEvents.add(key.split("|")[0]);

  for (const company of companiesWithEvents) {
    const ref = company ? companyById.get(company) : undefined;
    for (const day of spine) {
      const bucket = perCompanyDay.get(`${company}|${day}`) ?? emptyBucket();
      const total = bucketTotal(bucket);
      dailyRows.push({
        event_date_ist: istDayToDate(day),
        event_month_ist: istDayToMonth(day),
        event_weekday_ist: istDayToWeekday(day),
        // The landing page has no company. Named rather than blank so it is
        // filterable, and given no company_id so it joins to nothing.
        company_id: company || null,
        company_name: company ? (ref?.name ?? null) : "Landing page",
        store_slug: ref?.slug ?? null,
        plan_id: ref?.plan ?? null,
        page_views: bucket.views,
        product_clicks: bucket.productClicks,
        whatsapp_clicks: bucket.whatsappClicks,
        other_events: bucket.other,
        total_events: total,
        click_through_pct: pct(bucket.productClicks, bucket.views),
      });
    }
  }

  const dailyTable: Table = {
    name: "analytics_daily",
    columns: [
      "event_date_ist",
      "event_month_ist",
      "event_weekday_ist",
      "company_id",
      "company_name",
      "store_slug",
      "plan_id",
      "page_views",
      "product_clicks",
      "whatsapp_clicks",
      "other_events",
      "total_events",
      "click_through_pct",
    ],
    rows: dailyRows,
  };

  // ---- sheet: platform_daily ---------------------------------------------
  const platformTable: Table = {
    name: "platform_daily",
    columns: [
      "date_ist",
      "month_ist",
      "weekday_ist",
      "page_views",
      "product_clicks",
      "whatsapp_clicks",
      "total_events",
      "active_companies",
      "new_companies",
      "new_products",
      "estimates_created",
      "estimate_value_inr",
      "payments",
      "revenue_inr",
    ],
    rows: spine.map((day): Row => {
      const bucket = perPlatformDay.get(day) ?? emptyBucket();
      const estimates = estimatesByDay.get(day) ?? { count: 0, value: 0 };
      const revenue = revenueByDay.get(day) ?? { payments: 0, rupees: 0 };
      return {
        date_ist: istDayToDate(day),
        month_ist: istDayToMonth(day),
        weekday_ist: istDayToWeekday(day),
        page_views: bucket.views,
        product_clicks: bucket.productClicks,
        whatsapp_clicks: bucket.whatsappClicks,
        total_events: bucketTotal(bucket),
        active_companies: activeByDay.get(day)?.size ?? 0,
        new_companies: signupsByDay.get(day) ?? 0,
        new_products: newProductsByDay.get(day) ?? 0,
        estimates_created: estimates.count,
        estimate_value_inr: Math.round(estimates.value * 100) / 100,
        payments: revenue.payments,
        revenue_inr: Math.round(revenue.rupees * 100) / 100,
      };
    }),
  };

  // ---- sheets: estimates and their line items -----------------------------
  const estimateRows: Row[] = [];
  const itemRows: Row[] = [];

  for (const inv of raw.invoices) {
    const id = text(inv.id) ?? "";
    const companyId = text(inv.company_id);
    const company = companyId ? companyById.get(companyId) : undefined;
    const createdMs = parseMs(inv.created_at);
    const day = createdMs === null ? null : istDay(createdMs);
    const items = Array.isArray(inv.items) ? (inv.items as AnyRow[]) : [];
    const quantity = items.reduce((sum, item) => sum + num0(item.quantity), 0);
    const tax = num0(inv.sgst_amount) + num0(inv.cgst_amount);
    const final = num0(inv.final_amount) || num0(inv.grand_total);
    const invoiceDate = text(inv.invoice_date);

    estimateRows.push({
      estimate_id: id,
      company_id: companyId,
      company_name: company?.name ?? null,
      invoice_number: text(inv.invoice_number),
      // Already a DATE column — ISO by definition, so it is passed straight on.
      invoice_date: invoiceDate,
      customer_name: text(inv.customer_name),
      customer_phone: text(inv.customer_phone),
      item_count: items.length,
      quantity_total: quantity,
      subtotal_inr: money(inv.subtotal),
      discount_inr: money(inv.discount),
      tax_inr: Math.round(tax * 100) / 100,
      grand_total_inr: money(inv.grand_total),
      final_amount_inr: money(inv.final_amount),
      advance_paid_inr: money(inv.advance_payment),
      balance_due_inr: Math.round((final - num0(inv.advance_payment)) * 100) / 100,
      is_deleted: Boolean(inv.deleted_at),
      created_by: text(inv.created_by),
      created_date_ist: day === null ? null : istDayToDate(day),
      created_month_ist: day === null ? null : istDayToMonth(day),
      created_at_utc: createdMs === null ? null : utcStamp(createdMs),
    });

    items.forEach((item, index) => {
      const lineQty = num0(item.quantity);
      const unitPrice = num0(item.price);
      itemRows.push({
        estimate_id: id,
        company_id: companyId,
        company_name: company?.name ?? null,
        invoice_number: text(inv.invoice_number),
        invoice_date: invoiceDate,
        line_no: index + 1,
        item_name: text(item.name),
        product_id: text(item.product_id),
        size: text(item.size),
        unit: text(item.unit),
        quantity: lineQty,
        unit_price_inr: money(item.price),
        line_discount_inr: money(item.discount),
        // `amount` is what the app wrote; the fallback keeps the column usable
        // on rows written before it existed.
        line_total_inr: money(item.amount) ?? Math.round(lineQty * unitPrice * 100) / 100,
        created_date_ist: day === null ? null : istDayToDate(day),
      });
    });
  }

  const estimatesTable: Table = {
    name: "estimates",
    columns: [
      "estimate_id",
      "company_id",
      "company_name",
      "invoice_number",
      "invoice_date",
      "customer_name",
      "customer_phone",
      "item_count",
      "quantity_total",
      "subtotal_inr",
      "discount_inr",
      "tax_inr",
      "grand_total_inr",
      "final_amount_inr",
      "advance_paid_inr",
      "balance_due_inr",
      "is_deleted",
      "created_by",
      "created_date_ist",
      "created_month_ist",
      "created_at_utc",
    ],
    rows: estimateRows,
  };

  // ---- sheet: activity_events --------------------------------------------
  //
  // One row per recorded action, flat. `actor_id` is carried rather than an
  // email: this file is a data source, and a join key that is stable beats a
  // label that changes when somebody updates their address. The company name is
  // denormalised beside the id for the same reason every other sheet does it --
  // a Tableau user should not have to join to read a bar chart.
  const activityRows: Row[] = [];
  const activityByDay = new Map<number, Map<string, number>>();
  const activityGroups = new Set<string>();

  for (const row of raw.activity) {
    const createdMs = parseMs(row.created_at);
    const day = createdMs === null ? null : istDay(createdMs);
    const action = text(row.action) ?? "";
    // The prefix, not the whole verb: it is the grain anybody actually charts,
    // and it survives a new action being added without the workbook changing.
    const group = action.includes(".") ? action.slice(0, action.indexOf(".")) : "other";
    const companyId = text(row.company_id);
    const company = companyId === null ? undefined : companyById.get(companyId);

    activityGroups.add(group);

    activityRows.push({
      activity_id: text(row.id),
      company_id: companyId,
      company_name: company?.name ?? null,
      plan_id: company?.plan ?? null,
      actor_id: text(row.actor_id),
      // A row with no actor is a system action (a backfill, an edge function),
      // and saying so beats an empty cell that reads like missing data.
      actor_kind: row.actor_id ? "user" : "system",
      action,
      action_group: group,
      entity_type: text(row.entity_type),
      entity_id: text(row.entity_id),
      summary: text(row.summary),
      created_date_ist: day === null ? null : istDayToDate(day),
      created_month_ist: day === null ? null : istDayToMonth(day),
      created_weekday_ist: day === null ? null : istDayToWeekday(day),
      created_hour_ist: createdMs === null ? null : istHour(createdMs),
      created_at_utc: createdMs === null ? null : utcStamp(createdMs),
    });

    if (day === null) continue;
    let byGroup = activityByDay.get(day);
    if (!byGroup) {
      byGroup = new Map<string, number>();
      activityByDay.set(day, byGroup);
    }
    byGroup.set(group, (byGroup.get(group) ?? 0) + 1);
  }

  const activityTable: Table = {
    name: "activity_events",
    columns: [
      "activity_id",
      "company_id",
      "company_name",
      "plan_id",
      "actor_id",
      "actor_kind",
      "action",
      "action_group",
      "entity_type",
      "entity_id",
      "summary",
      "created_date_ist",
      "created_month_ist",
      "created_weekday_ist",
      "created_hour_ist",
      "created_at_utc",
    ],
    rows: activityRows,
  };

  // ---- sheet: activity_daily ---------------------------------------------
  //
  // Zero-filled across the same spine as the other day tables. A day-grain
  // table that omits quiet days overstates every average drawn from it, and
  // "estimates per active day" is exactly the sort of number somebody will
  // draw from this one.
  //
  // The group columns are FIXED rather than derived from the data, so a quiet
  // month does not produce a workbook with fewer columns than a busy one --
  // that is the schema-changes-when-empty problem the old export had.
  const ACTIVITY_GROUP_COLUMNS = [
    "estimate",
    "product",
    "auth",
    "payment",
    "points",
    "ad",
    "reward",
    "store",
    "export",
  ] as const;

  const activityDailyTable: Table = {
    name: "activity_daily",
    columns: [
      "date_ist",
      "month_ist",
      "weekday_ist",
      ...ACTIVITY_GROUP_COLUMNS.map((g) => `${g}_events`),
      "other_events",
      "total_events",
    ],
    rows: spine.map((day): Row => {
      const byGroup = activityByDay.get(day);
      const row: Row = {
        date_ist: istDayToDate(day),
        month_ist: istDayToMonth(day),
        weekday_ist: istDayToWeekday(day),
      };

      let known = 0;
      for (const group of ACTIVITY_GROUP_COLUMNS) {
        const n = byGroup?.get(group) ?? 0;
        row[`${group}_events`] = n;
        known += n;
      }

      // Anything whose prefix this build has never heard of still counts, so
      // the total is a total rather than "the total of what we recognised".
      let all = 0;
      if (byGroup) for (const n of byGroup.values()) all += n;

      row.other_events = all - known;
      row.total_events = all;
      return row;
    }),
  };

  const estimateItemsTable: Table = {
    name: "estimate_items",
    columns: [
      "estimate_id",
      "company_id",
      "company_name",
      "invoice_number",
      "invoice_date",
      "line_no",
      "item_name",
      "product_id",
      "size",
      "unit",
      "quantity",
      "unit_price_inr",
      "line_discount_inr",
      "line_total_inr",
      "created_date_ist",
    ],
    rows: itemRows,
  };

  // ---- sheet: feedback ----------------------------------------------------
  const feedbackTable: Table = {
    name: "feedback",
    columns: [
      "survey_id",
      "store_slug",
      "company_id",
      "company_name",
      "respondent_name",
      "respondent_role",
      "rating",
      "is_promoter",
      "has_suggestion",
      "suggestion",
      "created_date_ist",
      "created_month_ist",
      "created_at_utc",
    ],
    rows: raw.surveys.map((s): Row => {
      const ms = parseMs(s.created_at);
      const day = ms === null ? null : istDay(ms);
      const slug = text(s.store_slug);
      const company = slug ? companyBySlug.get(slug) : undefined;
      const rating = num(s.rating);
      const suggestion = text(s.suggestion);
      return {
        survey_id: text(s.id),
        store_slug: slug,
        company_id: company?.id ?? null,
        company_name: company?.name ?? null,
        respondent_name: text(s.name),
        respondent_role: text(s.role),
        // A number, not "4 / 5". The old export's string could not be averaged.
        rating,
        is_promoter: rating === null ? null : rating >= 4,
        has_suggestion: Boolean(suggestion),
        suggestion,
        created_date_ist: day === null ? null : istDayToDate(day),
        created_month_ist: day === null ? null : istDayToMonth(day),
        created_at_utc: ms === null ? null : utcStamp(ms),
      };
    }),
  };

  // ---- sheet: suggestions -------------------------------------------------
  const suggestionsTable: Table = {
    name: "suggestions",
    columns: [
      "suggestion_id",
      "name",
      "message",
      "status",
      "created_date_ist",
      "created_month_ist",
      "created_at_utc",
    ],
    rows: raw.suggestions.map((s): Row => {
      const ms = parseMs(s.created_at);
      const day = ms === null ? null : istDay(ms);
      return {
        suggestion_id: text(s.id),
        name: text(s.name),
        message: text(s.message),
        status: text(s.status) ?? "new",
        created_date_ist: day === null ? null : istDayToDate(day),
        created_month_ist: day === null ? null : istDayToMonth(day),
        created_at_utc: ms === null ? null : utcStamp(ms),
      };
    }),
  };

  // ---- sheet: payments ----------------------------------------------------
  const paymentsTable: Table = {
    name: "payments",
    columns: [
      "payment_id",
      "company_id",
      "company_name",
      "plan_id",
      "amount_inr",
      "status",
      "razorpay_payment_id",
      "razorpay_order_id",
      "starts_date_ist",
      "expires_date_ist",
      "created_date_ist",
      "created_month_ist",
      "created_at_utc",
    ],
    rows: raw.subscriptions.map((s): Row => {
      const ms = parseMs(s.created_at);
      const day = ms === null ? null : istDay(ms);
      const starts = parseMs(s.starts_at);
      const expires = parseMs(s.expires_at);
      return {
        payment_id: text(s.id),
        company_id: text(s.company_id),
        company_name: companyById.get(text(s.company_id) ?? "")?.name ?? null,
        plan_id: text(s.plan),
        // Stored in paise. Rupees is the unit every other money column here
        // uses, and mixing the two in one workbook is how a revenue chart ends
        // up a hundred times too big.
        amount_inr: Math.round(num0(s.amount)) / 100,
        status: text(s.status),
        razorpay_payment_id: text(s.razorpay_payment_id),
        razorpay_order_id: text(s.razorpay_order_id),
        starts_date_ist: starts === null ? null : istDayToDate(istDay(starts)),
        expires_date_ist: expires === null ? null : istDayToDate(istDay(expires)),
        created_date_ist: day === null ? null : istDayToDate(day),
        created_month_ist: day === null ? null : istDayToMonth(day),
        created_at_utc: ms === null ? null : utcStamp(ms),
      };
    }),
  };

  // ---- sheet: points_ledger ----------------------------------------------
  const pointsTable: Table = {
    name: "points_ledger",
    columns: [
      "entry_id",
      "company_id",
      "company_name",
      "delta",
      "direction",
      "reason",
      "note",
      "created_date_ist",
      "created_month_ist",
      "created_at_utc",
    ],
    rows: raw.points.map((p): Row => {
      const ms = parseMs(p.created_at);
      const day = ms === null ? null : istDay(ms);
      const delta = num0(p.delta);
      return {
        entry_id: text(p.id),
        company_id: text(p.company_id),
        company_name: companyById.get(text(p.company_id) ?? "")?.name ?? null,
        delta,
        direction: delta >= 0 ? "earned" : "spent",
        reason: text(p.reason),
        note: text(p.note),
        created_date_ist: day === null ? null : istDayToDate(day),
        created_month_ist: day === null ? null : istDayToMonth(day),
        created_at_utc: ms === null ? null : utcStamp(ms),
      };
    }),
  };

  // ---- sheet: reward_redemptions -----------------------------------------
  const redemptionsTable: Table = {
    name: "reward_redemptions",
    columns: [
      "redemption_id",
      "company_id",
      "company_name",
      "kind",
      "amount",
      "credits",
      "plan_id",
      "days",
      "points_spent",
      "is_applied",
      "created_date_ist",
      "created_month_ist",
      "created_at_utc",
    ],
    rows: raw.redemptions.map((r): Row => {
      const ms = parseMs(r.created_at);
      const day = ms === null ? null : istDay(ms);
      return {
        redemption_id: text(r.id),
        company_id: text(r.company_id),
        company_name: companyById.get(text(r.company_id) ?? "")?.name ?? null,
        kind: text(r.kind) ?? "plan_days",
        amount: num(r.amount),
        credits: num(r.credits),
        plan_id: text(r.plan_id),
        days: num(r.days),
        points_spent: num(r.points_spent),
        is_applied: Boolean(r.applied_at),
        created_date_ist: day === null ? null : istDayToDate(day),
        created_month_ist: day === null ? null : istDayToMonth(day),
        created_at_utc: ms === null ? null : utcStamp(ms),
      };
    }),
  };

  // ---- sheet: plans -------------------------------------------------------
  const subscribersByPlan = new Map<string, number>();
  for (const c of raw.companies) {
    const planId = text(c.subscription_plan) ?? "free";
    subscribersByPlan.set(planId, (subscribersByPlan.get(planId) ?? 0) + 1);
  }

  const plansTable: Table = {
    name: "plans",
    columns: [
      "plan_id",
      "plan_name",
      "price_inr",
      "product_limit",
      "unlocks_estimates",
      "unlocks_premium_skins",
      "unlocks_call_support",
      "is_active",
      "rank",
      "sort_order",
      "companies_on_plan",
    ],
    rows: raw.plans.map((p): Row => {
      const id = text(p.id) ?? "";
      return {
        plan_id: id,
        plan_name: text(p.name),
        price_inr: num(p.price),
        product_limit: num(p.product_limit),
        unlocks_estimates: bool(p.unlocks_estimates),
        unlocks_premium_skins: bool(p.unlocks_premium_skins),
        unlocks_call_support: bool(p.unlocks_call_support),
        is_active: bool(p.active),
        rank: num(p.rank),
        sort_order: num(p.sort_order),
        companies_on_plan: subscribersByPlan.get(id) ?? 0,
      };
    }),
  };

  const tables = [
    companiesTable,
    productsTable,
    dailyTable,
    platformTable,
    eventsTable,
    activityTable,
    activityDailyTable,
    estimatesTable,
    estimateItemsTable,
    feedbackTable,
    suggestionsTable,
    paymentsTable,
    pointsTable,
    redemptionsTable,
    plansTable,
  ];

  return [buildInfoTable(tables, raw, nowMs), ...tables];
}

/**
 * The sheet that says what the other sheets are and what is missing from them.
 *
 * It exists because the fault being fixed here was a silent one. A table that
 * failed to load, or that hit the row ceiling, has to be visible in the file
 * itself — not only in a console the person opening the workbook will never
 * see.
 */
function buildInfoTable(tables: Table[], raw: RawData, nowMs: number): Table {
  const rows: Row[] = [
    { item: "generated_at_ist", value: istStamp(nowMs) },
    { item: "generated_at_utc", value: utcStamp(nowMs) },
    { item: "timezone", value: "All *_ist columns are UTC+05:30 (India Standard Time)" },
    { item: "row_ceiling_per_table", value: MAX_ROWS },
    {
      item: "zero_filled_days",
      value: `analytics_daily and platform_daily carry a row for every day in the last ${ZERO_FILL_DAYS}, including days with no activity`,
    },
    {
      item: "how_to_use",
      value:
        "In Tableau, connect to this file with the Excel connector and drag a sheet onto the canvas. Relate sheets on company_id. Start with analytics_daily or platform_daily.",
    },
  ];

  for (const table of tables) {
    rows.push({ item: `rows.${table.name}`, value: table.rows.length });
  }

  for (const table of tables) {
    if (table.truncated) {
      rows.push({
        item: `TRUNCATED.${table.name}`,
        value: `Stopped at ${MAX_ROWS} rows — this sheet is not the complete table.`,
      });
    }
  }

  for (const issue of raw.issues) {
    rows.push({ item: `COULD_NOT_READ.${issue.table}`, value: issue.message });
  }

  return { name: "export_info", columns: ["item", "value"], rows };
}

// ------------------------------------------------------------------ output

/**
 * A sheet built from an explicit column list.
 *
 * `aoa_to_sheet` rather than `json_to_sheet` for two reasons that both matter
 * to a BI tool: the header row is written even when there are no data rows, so
 * a workbook saved against this file does not break the week a table is empty;
 * and column ORDER is fixed by the list rather than by whichever key the first
 * object happened to have.
 */
export function sheetFromTable(table: Table): XLSX.WorkSheet {
  const body = table.rows.map((row) => table.columns.map((col) => row[col] ?? null));
  const sheet = XLSX.utils.aoa_to_sheet([table.columns, ...body]);
  sheet["!cols"] = table.columns.map((col) => ({
    wch: Math.min(40, Math.max(12, col.length + 2)),
  }));
  // Excel's own filter row. Costs nothing and is the first thing anyone
  // reaching for this file in Excel rather than Tableau will want.
  if (table.rows.length > 0) {
    sheet["!autofilter"] = { ref: sheet["!ref"] as string };
  }
  return sheet;
}

function fileStamp(nowMs: number): string {
  return istDayToDate(istDay(nowMs));
}

export interface ExportResult {
  fileName: string;
  sheets: number;
  rows: number;
  issues: FetchIssue[];
}

/**
 * Build and download the workbook.
 *
 * Returns the counts so the caller can report something truer than "done" —
 * an export that read no analytics at all should not be announced as a success
 * in the same words as one that read a hundred thousand events.
 */
export async function exportMasterDataForTableau(): Promise<ExportResult> {
  const raw = await fetchEverything();
  const nowMs = Date.now();
  const tables = buildTables(raw, nowMs);

  const wb = XLSX.utils.book_new();
  for (const table of tables) {
    // Sheet names are capped at 31 characters by the format itself; every name
    // here is well inside that, but truncating is cheaper than a corrupt file
    // if one is ever added that is not.
    XLSX.utils.book_append_sheet(wb, sheetFromTable(table), table.name.slice(0, 31));
  }

  const fileName = `catalogshare_data_${fileStamp(nowMs)}.xlsx`;
  XLSX.writeFile(wb, fileName);

  return {
    fileName,
    sheets: tables.length,
    rows: tables.reduce((sum, t) => sum + t.rows.length, 0),
    issues: raw.issues,
  };
}

/**
 * The day-grain analytics on their own, as CSV.
 *
 * Tableau Public and Tableau Prep both take a CSV with less ceremony than a
 * multi-sheet workbook, and this is the one table most dashboards start from.
 * Same numbers as the `analytics_daily` sheet, from the same builder — there is
 * no second implementation to drift.
 */
export async function exportAnalyticsDailyCsv(): Promise<ExportResult> {
  const raw = await fetchEverything();
  const nowMs = Date.now();
  const tables = buildTables(raw, nowMs);
  const daily = tables.find((t) => t.name === "analytics_daily");

  if (!daily) throw new Error("analytics_daily was not built");

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFromTable(daily), daily.name);

  const fileName = `catalogshare_analytics_daily_${fileStamp(nowMs)}.csv`;
  XLSX.writeFile(wb, fileName, { bookType: "csv" });

  return { fileName, sheets: 1, rows: daily.rows.length, issues: raw.issues };
}
