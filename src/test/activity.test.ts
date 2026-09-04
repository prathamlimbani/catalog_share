/**
 * The activity log's client half.
 *
 * Two things are pinned here that are easy to get quietly wrong and impossible
 * to notice afterwards:
 *
 *  - A log write must NEVER throw or reject. Every caller is in the middle of
 *    something the user asked for -- signing in, finishing an ad -- and an
 *    audit row that can break that is worse than no audit row at all.
 *  - The day-grain export table must be ZERO-FILLED and must keep the same
 *    columns whether or not anything happened. A table that omits quiet days
 *    overstates every average drawn from it, and a schema that changes when the
 *    data is empty breaks a saved Tableau workbook.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => ({}),
  },
}));

import {
  ACTIVITY_GROUPS,
  actionLabel,
  attachActorEmails,
  groupOf,
  logActivity,
  normaliseActivity,
  shortWhen,
  type ActivityRow,
} from "@/lib/activity";
import { buildTables, type RawData, type Table } from "@/lib/tableauExport";

beforeEach(() => {
  rpc.mockReset();
});

const sheet = (tables: Table[], name: string): Table => {
  const found = tables.find((t) => t.name === name);
  if (!found) throw new Error(`no sheet ${name}`);
  return found;
};

/** 2026-08-27 12:00 IST. */
const NOW = Date.parse("2026-08-27T06:30:00Z");

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
    activity: [],
    activityTruncated: false,
    issues: [],
    ...overrides,
  };
}

describe("writing a log line never costs the caller anything", () => {
  it("reports success when the row lands", async () => {
    rpc.mockResolvedValue({ data: { ok: true, id: "a1" }, error: null });
    await expect(logActivity("auth.signed_in")).resolves.toBe(true);
  });

  it("swallows a database that has never heard of the log", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    });
    await expect(logActivity("auth.signed_in")).resolves.toBe(false);
  });

  it("swallows a thrown transport error rather than rejecting", async () => {
    rpc.mockRejectedValue(new Error("Failed to fetch"));
    await expect(logActivity("ad.watched")).resolves.toBe(false);
  });

  it("sends the action and leaves the actor to the server", async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    await logActivity("reward.redeemed", { entityId: "offer-1", summary: "5 estimates" });

    const [fn, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(fn).toBe("log_activity");
    expect(args.p_action).toBe("reward.redeemed");
    expect(args.p_entity_id).toBe("offer-1");
    // No actor and no company are passed: both are resolved from auth.uid()
    // inside the function, so a client cannot write somebody else's history.
    expect(Object.keys(args)).not.toContain("p_actor_id");
    expect(Object.keys(args)).not.toContain("p_company_id");
  });
});

describe("reading the log", () => {
  it("groups an action by its prefix, and keeps one it has never seen", () => {
    expect(groupOf("estimate.created")).toBe("estimate");
    expect(groupOf("payment.recorded")).toBe("payment");
    // A verb added by a later migration must still land somewhere.
    expect(groupOf("shipment.dispatched")).toBe("other");
  });

  it("falls back to the raw action rather than claiming it is unknown", () => {
    expect(actionLabel("estimate.created")).toBe("Created an estimate");
    expect(actionLabel("shipment.dispatched")).toBe("shipment.dispatched");
  });

  it("flattens the embedded company and survives a platform-level event", () => {
    const rows = normaliseActivity([
      { id: "1", action: "estimate.created", companies: { name: "Toolscope" }, created_at: "x" },
      // A sign-in happens before the company row is read, so company_id is null.
      { id: "2", action: "auth.signed_in", companies: null, created_at: "y" },
    ]);
    expect(rows[0].company_name).toBe("Toolscope");
    expect(rows[1].company_name).toBeNull();
  });

  it("keeps the feed when actor emails cannot be resolved", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    const rows: ActivityRow[] = normaliseActivity([
      { id: "1", action: "estimate.created", actor_id: "u1", created_at: "x" },
    ]);
    const out = await attachActorEmails(rows);
    expect(out).toHaveLength(1);
    expect(out[0].actor_email).toBeNull();
  });

  it("asks for each actor once, however many rows they wrote", async () => {
    rpc.mockResolvedValue({ data: [{ id: "u1", email: "a@b.c" }], error: null });
    const rows = normaliseActivity([
      { id: "1", action: "estimate.created", actor_id: "u1", created_at: "x" },
      { id: "2", action: "estimate.updated", actor_id: "u1", created_at: "y" },
      { id: "3", action: "auth.signed_in", actor_id: null, created_at: "z" },
    ]);
    const out = await attachActorEmails(rows);

    const [, args] = rpc.mock.calls[0] as [string, { p_ids: string[] }];
    expect(args.p_ids).toEqual(["u1"]);
    expect(out[0].actor_email).toBe("a@b.c");
    expect(out[2].actor_email).toBeNull();
  });

  it("does not call out at all when nothing has an actor", async () => {
    const rows = normaliseActivity([{ id: "1", action: "points.earned", created_at: "x" }]);
    await attachActorEmails(rows);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reads a timestamp as a human distance", () => {
    const now = Date.parse("2026-09-04T12:00:00Z");
    expect(shortWhen("2026-09-04T11:58:00Z", now)).toBe("2 min ago");
    expect(shortWhen("2026-09-03T12:00:00Z", now)).toBe("yesterday");
    expect(shortWhen("not a date", now)).toBe("");
  });
});

describe("the export's activity sheets", () => {
  const event = (over: Record<string, unknown> = {}) => ({
    id: "e1",
    company_id: "c1",
    actor_id: "u1",
    action: "estimate.created",
    entity_type: "estimate",
    entity_id: "i1",
    summary: "INV-1 for Ramesh",
    created_at: "2026-08-27T05:00:00Z",
    ...over,
  });

  it("carries one flat row per event, with an IST day and a UTC stamp", () => {
    const tables = buildTables(
      raw({
        companies: [{ id: "c1", name: "Toolscope", subscription_plan: "growth" }],
        activity: [event()],
      }),
      NOW,
    );

    const row = sheet(tables, "activity_events").rows[0];
    expect(row.action).toBe("estimate.created");
    expect(row.action_group).toBe("estimate");
    expect(row.company_name).toBe("Toolscope");
    expect(row.actor_kind).toBe("user");
    // 05:00 UTC is 10:30 IST on the same date.
    expect(row.created_date_ist).toBe("2026-08-27");
    expect(row.created_at_utc).toBe("2026-08-27T05:00:00.000Z");
  });

  it("calls an event with no actor a system event, not a blank", () => {
    const tables = buildTables(raw({ activity: [event({ actor_id: null })] }), NOW);
    expect(sheet(tables, "activity_events").rows[0].actor_kind).toBe("system");
  });

  it("zero-fills quiet days instead of omitting them", () => {
    // Two events with a silent day between them. The spine runs from the first
    // real day to today, so the 26th only appears if quiet days are filled.
    const tables = buildTables(
      raw({
        activity: [event({ id: "old", created_at: "2026-08-25T05:00:00Z" }), event()],
      }),
      NOW,
    );
    const daily = sheet(tables, "activity_daily");

    const busy = daily.rows.find((r) => r.date_ist === "2026-08-27");
    const quiet = daily.rows.find((r) => r.date_ist === "2026-08-26");

    expect(busy?.estimate_events).toBe(1);
    expect(busy?.total_events).toBe(1);
    // The day before must be present and zero, not missing -- an average over
    // "days with rows" is not an average over days.
    expect(quiet).toBeDefined();
    expect(quiet?.total_events).toBe(0);
    expect(quiet?.estimate_events).toBe(0);
  });

  it("keeps the same columns when nothing has happened at all", () => {
    const withData = sheet(buildTables(raw({ activity: [event()] }), NOW), "activity_daily");
    const empty = sheet(buildTables(raw(), NOW), "activity_daily");
    // A schema that changes when a table is empty breaks a saved workbook.
    expect(empty.columns).toEqual(withData.columns);
    expect(empty.rows.length).toBeGreaterThan(0);
    expect(empty.rows.every((r) => r.total_events === 0)).toBe(true);
  });

  it("counts an unrecognised group in the total rather than losing it", () => {
    const tables = buildTables(
      raw({ activity: [event({ action: "shipment.dispatched" })] }),
      NOW,
    );
    const day = sheet(tables, "activity_daily").rows.find((r) => r.date_ist === "2026-08-27");
    expect(day?.other_events).toBe(1);
    expect(day?.total_events).toBe(1);
    expect(day?.estimate_events).toBe(0);
  });

  it("puts the author on the estimates sheet", () => {
    const tables = buildTables(
      raw({
        companies: [{ id: "c1", name: "Toolscope" }],
        invoices: [
          {
            id: "i1",
            company_id: "c1",
            invoice_number: "INV-1",
            created_by: "u1",
            created_at: "2026-08-27T05:00:00Z",
            items: [],
          },
        ],
      }),
      NOW,
    );
    expect(sheet(tables, "estimates").rows[0].created_by).toBe("u1");
  });

  it("names every group column the feed knows about", () => {
    const columns = sheet(buildTables(raw(), NOW), "activity_daily").columns;
    for (const group of Object.keys(ACTIVITY_GROUPS)) {
      expect(columns).toContain(`${group}_events`);
    }
  });
});
