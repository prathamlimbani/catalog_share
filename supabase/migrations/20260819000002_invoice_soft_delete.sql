-- =============================================================================
-- invoices.deleted_at — make deletes replicate
--
-- A hard DELETE is invisible to every other device: the row simply stops coming
-- back from PostgREST, and a client has no way to tell "deleted upstream" from
-- "not in this page of results". So a merchant who deleted an estimate on their
-- phone still saw it on the shop tablet, forever.
--
-- Soft-deleting instead makes the removal a normal row change, which the
-- existing `updated_at` trigger stamps and the incremental pull already
-- transports. The client removes the local copy when it sees `deleted_at` set.
--
-- Apply with:  supabase db push
--          or: paste into the Supabase SQL editor and run
--
-- Idempotent — re-running it is safe.
-- =============================================================================

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- The initial (cursor-less) pull asks only for live rows and pages through them
-- ordered by updated_at, so index exactly that access path. Partial, because
-- tombstones are a small minority and never appear in this query.
CREATE INDEX IF NOT EXISTS invoices_company_live_updated_idx
  ON public.invoices (company_id, updated_at)
  WHERE deleted_at IS NULL;

-- Supports sweeping old tombstones later without a sequential scan.
CREATE INDEX IF NOT EXISTS invoices_deleted_at_idx
  ON public.invoices (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- The delete now travels as an UPDATE, which the owner UPDATE policy already
-- allows; no policy changes are needed. The DELETE policy stays in place for
-- clients running builds that predate this column.

-- A soft-deleted estimate keeps its slot in the UNIQUE (company_id,
-- invoice_number) index, so next_invoice_number counting deleted rows is
-- correct: reusing a number a customer has already been sent a copy of would be
-- worse than skipping it.
