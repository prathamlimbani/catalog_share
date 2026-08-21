/**
 * Regression guard for the bug that made estimate sync fail silently for months.
 *
 * PostgREST reports a missing column TWO different ways, and the push path only
 * recognised one of them:
 *
 *   read  (SELECT) -> 42703    "column invoices.advance_payment does not exist"
 *   write (INSERT) -> PGRST204 "Could not find the 'advance_payment' column of
 *                               'invoices' in the schema cache"
 *
 * A read builds SQL that names the column, so Postgres raises. A write is
 * checked against the cached schema first and never reaches Postgres. Matching
 * only the read form meant every push was treated as an ordinary failure,
 * retried eight times, and parked — so no estimate ever reached the server.
 *
 * Both strings below are copied verbatim from responses of the live project.
 */

import { describe, it, expect } from "vitest";
import { isMissingColumn, missingColumnName, OPTIONAL_COLUMNS } from "@/lib/sync/syncEngine";

const WRITE_ERROR = {
  code: "PGRST204",
  message: "Could not find the 'advance_payment' column of 'invoices' in the schema cache",
};

const READ_ERROR = {
  code: "42703",
  message: "column invoices.advance_payment does not exist",
};

describe("isMissingColumn", () => {
  it("recognises the WRITE form (PGRST204) — the one the push path hits", () => {
    expect(isMissingColumn(WRITE_ERROR)).toBe(true);
  });

  it("recognises the READ form (42703)", () => {
    expect(isMissingColumn(READ_ERROR)).toBe(true);
  });

  it("matches on the message even when the code is absent", () => {
    expect(isMissingColumn({ message: WRITE_ERROR.message })).toBe(true);
    expect(isMissingColumn({ message: READ_ERROR.message })).toBe(true);
  });

  it("does NOT swallow a row-level-security rejection", () => {
    // 42501 is what an insert returns when the schema was fine and only the
    // policy said no. Treating that as a missing column would drop fields
    // forever and never surface a real permissions problem.
    expect(
      isMissingColumn({
        code: "42501",
        message: 'new row violates row-level security policy for table "invoices"',
      }),
    ).toBe(false);
  });

  it("does NOT swallow a missing TABLE", () => {
    expect(
      isMissingColumn({ code: "42P01", message: 'relation "public.invoices" does not exist' }),
    ).toBe(false);
  });

  it("does NOT swallow a duplicate invoice number", () => {
    expect(
      isMissingColumn({
        code: "23505",
        message: 'duplicate key value violates unique constraint "invoices_company_number_idx"',
      }),
    ).toBe(false);
  });
});

describe("missingColumnName", () => {
  it("extracts the column from the write form", () => {
    expect(missingColumnName(WRITE_ERROR)).toBe("advance_payment");
  });

  it("extracts the column from the read form, table prefix and all", () => {
    expect(missingColumnName(READ_ERROR)).toBe("advance_payment");
  });

  it("returns null when the message names no column", () => {
    expect(missingColumnName({ code: "42501", message: "permission denied" })).toBeNull();
  });

  it("names a column the push path is allowed to drop", () => {
    // If this fails, the recovery path will refuse to drop the column and sync
    // is broken again against an un-migrated database.
    const column = missingColumnName(WRITE_ERROR);
    expect(column).not.toBeNull();
    expect(OPTIONAL_COLUMNS as readonly string[]).toContain(column as string);
  });
});
