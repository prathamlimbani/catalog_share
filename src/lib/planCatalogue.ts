/**
 * Load the plan catalogue from the database.
 *
 * Plans ship inside the bundle as a fallback, so this is an *upgrade* of what
 * the app already knows, never a prerequisite. Every failure path here — table
 * missing, offline, RLS, a malformed row — leaves the built-in catalogue in
 * place and logs. An app that cannot price its plans is worse than an app
 * showing last release's prices.
 */

import { supabase } from "@/integrations/supabase/client";
import { applyPlanCatalogue, type PlanRow } from "@/lib/plans";

/**
 * `plans` is newer than the checked-in generated types, so the typed client
 * refuses the table name. Same approach the sync layer takes for the columns it
 * has to name ahead of the schema: describe the shape we actually use and cast
 * once, rather than regenerating types the build does not otherwise need.
 */
interface LooseFrom {
  from(table: string): {
    select(columns: string): {
      order(
        column: string,
        opts: { ascending: boolean },
      ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
    };
  };
}

let loaded = false;
let inFlight: Promise<boolean> | null = null;

/** Fetch and apply. Concurrent calls share one request. */
export async function loadPlanCatalogue(): Promise<boolean> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const { data, error } = await (supabase as unknown as LooseFrom)
        .from("plans")
        .select("*")
        .order("sort_order", { ascending: true });

      if (error) {
        // 42P01 / PGRST205 = the migration has not been applied yet. That is a
        // normal state for this build, not an error worth alarming anyone with.
        console.warn("[plans] using built-in catalogue:", error.message);
        return false;
      }

      const applied = applyPlanCatalogue((data ?? []) as unknown as PlanRow[]);
      loaded = applied;
      return applied;
    } catch (err) {
      console.warn("[plans] catalogue load failed:", err);
      return false;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export function isCatalogueLoaded(): boolean {
  return loaded;
}

/**
 * Keep the catalogue current while the app is open.
 *
 * A price edited in the console should reach a merchant sitting on the pricing
 * screen — otherwise they tap Buy on one number and Razorpay charges another,
 * and the payment is rejected for a mismatch they cannot see. Realtime when it
 * is available, a refetch on focus either way.
 */
export function watchPlanCatalogue(): () => void {
  void loadPlanCatalogue();

  const channel = supabase
    .channel("plan-catalogue")
    .on("postgres_changes", { event: "*", schema: "public", table: "plans" }, () => {
      void loadPlanCatalogue();
    })
    .subscribe();

  const onFocus = () => {
    if (document.visibilityState === "visible") void loadPlanCatalogue();
  };
  document.addEventListener("visibilitychange", onFocus);

  return () => {
    void supabase.removeChannel(channel);
    document.removeEventListener("visibilitychange", onFocus);
  };
}
