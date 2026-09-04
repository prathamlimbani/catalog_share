/**
 * The master export, pinned against the three faults it was built to fix.
 *
 * Every assertion here corresponds to something that made the old workbook
 * unusable in a BI tool: a locale date string where a date belonged, a rating
 * written as "4 / 5", an id column filled with "N/A", a sheet whose schema
 * changed when it happened to be empty, and a day-grain table that skipped
 * quiet days and so overstated every average drawn from it.
 *
 * `buildTables` takes its clock as an argument precisely so this file can hold
 * it still.
 */

import { describe, it, expect } from "vitest";
import {
  buildTables,
  daySpine,
  istDay,
  istDayToDate,
  istDayToMonth,
  istDayToWeekday,
  istHour,
  istStamp,
  num,
  parseMs,
  text,
  type RawData,
  type Table,
} from "@/lib/tableauExport";

const ms = (iso: string) => Date.parse(iso);

/** 2026-08-27 12:00 IST, the clock every build below is run against. */
const NOW = ms("2026-08-27T06:30:00Z");

function raw(overrides: Partial<RawData> = {}): RawData {
  return {
    companies: [],
    products: [],
    analytics: [],
    analyticsTruncated: false,
    surveys: [],
    suggestions: [],
    invoices: [],
    subscriptions: [],
    points: [],
    redemptions: [],
    plans: [],
    issues: [],
    ...overrides,
  };
}

const sheet = (tables: Table[], name: string): Table => {
  const found = tables.find((t) => t.name === name);
  if (!found) throw new Error(`no sheet named ${name}`);
  return found;
};

describe("IST conversion", () => {
  it("puts a late-evening UTC event on the NEXT Indian day", () => {
    // 19:00 UTC is 00:30 the following morning in Delhi. Getting this wrong
    // moves roughly a quarter of every evening's traffic onto the wrong date.
    const t = ms("2026-08-26T19:00:00Z");
    expect(istDayToDate(istDay(t))).toBe("2026-08-27");
    expect(istStamp(t)).toBe("2026-08-27 00:30:00");
    expect(istHour(t)).toBe(0);
  });

  it("keeps the last minute before the boundary on the earlier day", () => {
    const t = ms("2026-08-26T18:29:59Z");
    expect(istDayToDate(istDay(t))).toBe("2026-08-26");
    expect(istStamp(t)).toBe("2026-08-26 23:59:59");
    expect(istHour(t)).toBe(23);
  });

  it("derives the month and weekday from the same day number", () => {
    const day = istDay(ms("2026-08-27T06:30:00Z"));
    expect(istDayToMonth(day)).toBe("2026-08");
    expect(istDayToWeekday(day)).toBe("Thursday");
  });

  it("emits ISO-8601, never a locale string", () => {
    // The old export wrote toLocaleString(), so the same row exported as
    // "8/27/2026, 12:00:00 PM" or "27/08/2026, 12:00:00" depending on the
    // machine, and Tableau typed the column as text either way.
    expect(istStamp(NOW)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

describe("value coercion", () => {
  it("turns a missing value into null, never into the string N/A", () => {
    expect(text(null)).toBeNull();
    expect(text("")).toBeNull();
    expect(text("  ")).toBeNull();
    expect(num(null)).toBeNull();
    expect(num("")).toBeNull();
    expect(num("not a number")).toBeNull();
  });

  it("parses numbers out of the strings a NUMERIC column returns", () => {
    expect(num("1234.50")).toBe(1234.5);
    expect(parseMs("2026-08-27T06:30:00Z")).toBe(NOW);
    expect(parseMs("nonsense")).toBeNull();
  });
});

describe("daySpine", () => {
  it("fills every day up to today so quiet days are zeroes, not gaps", () => {
    const today = istDay(NOW);
    const spine = daySpine([today - 3], today);
    expect(spine).toEqual([today - 3, today - 2, today - 1, today]);
  });

  it("keeps real days that fall outside the fill window", () => {
    const today = istDay(NOW);
    const ancient = today - 900;
    const spine = daySpine([ancient], today);
    expect(spine[0]).toBe(ancient);
    // ...but does not pad 900 days of zeroes on to get there.
    expect(spine[1]).toBe(today - 365);
    expect(spine[spine.length - 1]).toBe(today);
  });
});

describe("buildTables", () => {
  const COMPANY = {
    id: "c1",
    name: "Kumar Textiles",
    slug: "kumar-textiles",
    phone: "9876543210",
    email: "kumar@example.com",
    subscription_plan: "free",
    subscription_expires_at: null,
    bonus_product_limit: 5,
    created_at: "2026-08-20T04:00:00Z",
  };

  const PLANS = [
    { id: "free", name: "Free Plan", price: 0, product_limit: 40, active: true, sort_order: 0 },
    { id: "growth", name: "Growth", price: 199, product_limit: 300, active: true, sort_order: 1 },
  ];

  const EVENTS = [
    { id: "e1", company_id: "c1", event_type: "page_view", created_at: "2026-08-26T19:00:00Z" },
    { id: "e2", company_id: "c1", event_type: "page_view", created_at: "2026-08-27T05:00:00Z" },
    { id: "e3", company_id: "c1", event_type: "page_view", created_at: "2026-08-27T05:10:00Z" },
    { id: "e4", company_id: "c1", event_type: "page_view", created_at: "2026-08-27T05:20:00Z" },
    {
      id: "e5",
      company_id: "c1",
      event_type: "product_click",
      product_id: "p1",
      created_at: "2026-08-27T05:30:00Z",
    },
    {
      id: "e6",
      company_id: "c1",
      event_type: "whatsapp_click",
      created_at: "2026-08-27T05:40:00Z",
    },
    // No company: the marketing site. It must not be dropped and must not be
    // attributed to a shop.
    { id: "e7", company_id: null, event_type: "page_view", created_at: "2026-08-27T05:45:00Z" },
  ];

  it("rolls events up to one row per shop per day, with quiet days at zero", () => {
    const tables = buildTables(raw({ companies: [COMPANY], analytics: EVENTS }), NOW);
    const daily = sheet(tables, "analytics_daily");

    const today = daily.rows.find(
      (r) => r.event_date_ist === "2026-08-27" && r.company_id === "c1",
    );
    expect(today).toMatchObject({
      page_views: 4, // three from today plus the 19:00 UTC one, which is IST today
      product_clicks: 1,
      whatsapp_clicks: 1,
      total_events: 6,
      click_through_pct: 25,
      company_name: "Kumar Textiles",
      plan_id: "free",
    });

    // The day before had nothing at all, and has to be present as a zero or
    // every "average views per day" drawn from this sheet is inflated.
    const quiet = daily.rows.find(
      (r) => r.event_date_ist === "2026-08-25" && r.company_id === "c1",
    );
    expect(quiet).toMatchObject({ page_views: 0, total_events: 0 });
    expect(quiet?.click_through_pct).toBeNull();
  });

  it("keeps landing-page traffic without inventing a company for it", () => {
    const tables = buildTables(raw({ companies: [COMPANY], analytics: EVENTS }), NOW);
    const landing = sheet(tables, "analytics_daily").rows.find(
      (r) => r.company_name === "Landing page" && r.event_date_ist === "2026-08-27",
    );
    expect(landing).toBeDefined();
    expect(landing?.company_id).toBeNull();
    expect(landing?.page_views).toBe(1);

    const event = sheet(tables, "analytics_events").rows.find((r) => r.event_id === "e7");
    expect(event?.is_landing_page).toBe(true);
    expect(event?.company_id).toBeNull();
  });

  it("gives the platform sheet one row per day whatever happened on it", () => {
    const tables = buildTables(
      raw({
        companies: [COMPANY],
        analytics: EVENTS,
        plans: PLANS,
        subscriptions: [
          { id: "s1", company_id: "c1", plan: "growth", amount: 19900, created_at: "2026-08-27T04:00:00Z" },
        ],
      }),
      NOW,
    );
    const platform = sheet(tables, "platform_daily");
    const today = platform.rows.find((r) => r.date_ist === "2026-08-27");

    expect(today).toMatchObject({
      page_views: 5, // four for the shop, one for the landing page
      active_companies: 1,
      payments: 1,
      revenue_inr: 199, // paise in the column, rupees in the sheet
    });

    const dates = platform.rows.map((r) => r.date_ist);
    expect(new Set(dates).size).toBe(dates.length);
  });

  it("adds bought product slots to the plan's own limit", () => {
    const tables = buildTables(raw({ companies: [COMPANY], plans: PLANS }), NOW);
    const row = sheet(tables, "companies").rows[0];

    expect(row).toMatchObject({
      plan_product_limit: 40,
      bonus_product_limit: 5,
      product_limit_total: 45,
      is_paid: false,
      plan_days_left: 0,
    });
  });

  it("writes a rating as a number, not as '4 / 5'", () => {
    const tables = buildTables(
      raw({
        companies: [COMPANY],
        surveys: [
          {
            id: "s1",
            store_slug: "kumar-textiles",
            name: "Asha",
            role: "customer",
            rating: 4,
            suggestion: null,
            created_at: "2026-08-27T05:00:00Z",
          },
        ],
      }),
      NOW,
    );
    const row = sheet(tables, "feedback").rows[0];

    expect(row.rating).toBe(4);
    expect(row.is_promoter).toBe(true);
    expect(row.has_suggestion).toBe(false);
    // Resolved through the slug, so feedback can be related to the shop.
    expect(row.company_id).toBe("c1");
    expect(row.suggestion).toBeNull();
  });

  it("explodes estimate line items into their own table", () => {
    const tables = buildTables(
      raw({
        companies: [COMPANY],
        invoices: [
          {
            id: "i1",
            company_id: "c1",
            invoice_number: "EST-001",
            invoice_date: "2026-08-27",
            customer_name: "Ravi",
            items: [
              { product_id: "p1", name: "Cotton shirt", quantity: 2, price: 500, amount: 1000, unit: "pcs" },
              { product_id: "p2", name: "Silk saree", quantity: 1, price: 2500, amount: 2500, unit: "pcs" },
            ],
            subtotal: 3500,
            grand_total: 3500,
            final_amount: 3500,
            advance_payment: 500,
            created_at: "2026-08-27T05:00:00Z",
          },
        ],
      }),
      NOW,
    );

    const estimate = sheet(tables, "estimates").rows[0];
    expect(estimate).toMatchObject({
      item_count: 2,
      quantity_total: 3,
      final_amount_inr: 3500,
      advance_paid_inr: 500,
      balance_due_inr: 3000,
      is_deleted: false,
      created_date_ist: "2026-08-27",
    });

    const items = sheet(tables, "estimate_items").rows;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      estimate_id: "i1",
      line_no: 1,
      item_name: "Cotton shirt",
      quantity: 2,
      unit_price_inr: 500,
      line_total_inr: 1000,
    });

    // The company rollup has to agree with the line items.
    expect(sheet(tables, "companies").rows[0]).toMatchObject({
      estimates_created: 1,
      estimate_value_inr: 3500,
    });
  });

  it("counts clicks per product back onto the product row", () => {
    const tables = buildTables(
      raw({
        companies: [COMPANY],
        analytics: EVENTS,
        products: [
          { id: "p1", company_id: "c1", name: "Cotton shirt", price: 500, in_stock: true, created_at: "2026-08-21T04:00:00Z" },
          { id: "p2", company_id: "c1", name: "Silk saree", price: 2500, in_stock: false, created_at: "2026-08-21T04:00:00Z" },
        ],
      }),
      NOW,
    );
    const products = sheet(tables, "products").rows;

    expect(products.find((r) => r.product_id === "p1")?.product_clicks).toBe(1);
    expect(products.find((r) => r.product_id === "p2")?.product_clicks).toBe(0);
    // Real booleans, so Tableau can filter on them. The old export wrote "Yes".
    expect(products.find((r) => r.product_id === "p2")?.in_stock).toBe(false);
  });

  it("keeps the header row on a table with nothing in it", () => {
    // The old export replaced an empty sheet with a single {Message: "..."}
    // row, so the schema changed shape the week a table was empty and any
    // workbook saved against it broke.
    const tables = buildTables(raw(), NOW);
    const events = sheet(tables, "analytics_events");

    expect(events.rows).toHaveLength(0);
    expect(events.columns).toContain("event_date_ist");
    expect(events.columns.length).toBeGreaterThan(5);
  });

  it("never writes N/A into a column that is meant to join", () => {
    const tables = buildTables(
      raw({
        companies: [COMPANY],
        analytics: [
          { id: "e1", company_id: "c1", event_type: "page_view", product_id: null, created_at: "2026-08-27T05:00:00Z" },
        ],
      }),
      NOW,
    );
    const row = sheet(tables, "analytics_events").rows[0];

    expect(row.product_id).toBeNull();
    expect(row.product_name).toBeNull();
    for (const table of tables) {
      for (const r of table.rows) {
        expect(Object.values(r)).not.toContain("N/A");
      }
    }
  });

  it("says so in the file when a table could not be read", () => {
    const tables = buildTables(
      raw({ issues: [{ table: "points_ledger", message: "relation does not exist" }] }),
      NOW,
    );
    const info = sheet(tables, "export_info");
    const problem = info.rows.find((r) => r.item === "COULD_NOT_READ.points_ledger");

    expect(problem?.value).toContain("relation does not exist");
    expect(info.rows.find((r) => r.item === "rows.analytics_daily")).toBeDefined();
  });

  it("announces a truncated fetch instead of passing a sample off as a total", () => {
    const tables = buildTables(raw({ analyticsTruncated: true }), NOW);
    const info = sheet(tables, "export_info");
    expect(info.rows.some((r) => String(r.item).startsWith("TRUNCATED.analytics_events"))).toBe(
      true,
    );
  });
});
