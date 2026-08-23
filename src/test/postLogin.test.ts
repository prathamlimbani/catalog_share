/**
 * Where a sign-in lands. Every way into the app (password, Google on the
 * device, the browser's return from OAuth) shares this rule, so a regression
 * here routes a merchant into company setup - or worse, the owner's console.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

type Outcome = { data: unknown; error: unknown };

const { tables } = vi.hoisted(() => ({
  tables: new Map<string, Outcome>(),
}));

vi.mock("@/integrations/supabase/client", () => {
  // Enough of the query builder for `.from(x).select().eq().eq()` and `.limit()`
  // to resolve to whatever the test queued for that table.
  const builder = (table: string) => {
    const outcome = () => tables.get(table) ?? { data: [], error: null };
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "limit"]) chain[m] = () => chain;
    chain.then = (resolve: (v: Outcome) => void) => resolve(outcome());
    return chain;
  };
  return { supabase: { from: builder } };
});

import { destinationAfterSignIn } from "@/lib/postLogin";

const user = { id: "user-1" };

beforeEach(() => tables.clear());

describe("destinationAfterSignIn", () => {
  it("sends a platform admin to the console", async () => {
    tables.set("user_roles", { data: [{ role: "admin" }], error: null });
    tables.set("companies", { data: [{ slug: "x" }], error: null });
    expect(await destinationAfterSignIn(user)).toBe("/master-admin");
  });

  it("sends a merchant with a company to the dashboard", async () => {
    tables.set("user_roles", { data: [], error: null });
    tables.set("companies", { data: [{ slug: "acme" }], error: null });
    expect(await destinationAfterSignIn(user)).toBe("/dashboard");
  });

  it("sends a signed-in user with no company to company setup", async () => {
    tables.set("user_roles", { data: [], error: null });
    tables.set("companies", { data: [], error: null });
    expect(await destinationAfterSignIn(user)).toBe("/register");
  });

  it("does not route into company setup when the role lookup fails", async () => {
    tables.set("user_roles", { data: null, error: { message: "network" } });
    tables.set("companies", { data: [], error: null });
    expect(await destinationAfterSignIn(user)).toBe("/dashboard");
  });
});
