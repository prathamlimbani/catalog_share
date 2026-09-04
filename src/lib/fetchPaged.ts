/**
 * Read a whole table out of PostgREST, a page at a time.
 *
 * THE BUG THIS EXISTS FOR: a select with no `.range()` returns at most
 * `db-max-rows` — 1000 on a stock Supabase — and says nothing at all about the
 * rest. Every export in this app used to issue exactly that call, so any shop
 * past a thousand products, or a platform past a thousand analytics events, was
 * quietly exporting a sample labelled as a total.
 *
 * Its own module, tiny and dependency-free, because both exports need it and
 * they must not need each other: the merchant's per-shop export ships in the
 * Android bundle, the master export does not (the app build strips the
 * master-admin console entirely), and putting the loop in the master module
 * would drag every sheet builder along with it into the phone.
 */

/** How many rows PostgREST will hand over at once. */
const PAGE_SIZE = 1000;

/** Default ceiling. Excel stops near a million rows; a browser tab stops sooner. */
export const DEFAULT_MAX_ROWS = 100_000;

export interface PagedResult {
  rows: Record<string, unknown>[];
  /** True when the ceiling was reached and there is more still in the table. */
  truncated: boolean;
  /** Set when the read failed. Rows collected before it are still returned. */
  error: string | null;
}

/**
 * Walk a range query until it runs out.
 *
 * The caller supplies the query so the filters, the ordering and the table stay
 * theirs; the loop, the ceiling and the stop condition live here once.
 *
 * Never throws. A caller mid-export needs to know which table failed and carry
 * on with the others, not lose the whole workbook to one missing relation.
 */
export async function fetchPaged(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  max: number = DEFAULT_MAX_ROWS,
): Promise<PagedResult> {
  const rows: Record<string, unknown>[] = [];

  try {
    for (let from = 0; from < max; from += PAGE_SIZE) {
      const to = Math.min(from + PAGE_SIZE, max) - 1;
      const { data, error } = await page(from, to);

      if (error) return { rows, truncated: false, error: error.message };

      const batch = (data ?? []) as Record<string, unknown>[];
      rows.push(...batch);
      // A page shorter than the one asked for is the end of the table. It is
      // also why this cannot spin forever on an empty one.
      if (batch.length < to - from + 1) return { rows, truncated: false, error: null };
    }
  } catch (err) {
    return { rows, truncated: false, error: err instanceof Error ? err.message : String(err) };
  }

  return { rows, truncated: rows.length >= max, error: null };
}
