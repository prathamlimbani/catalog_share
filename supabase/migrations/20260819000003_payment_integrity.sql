-- =============================================================================
-- Payment integrity: one subscription row per Razorpay payment
--
-- Apply with:  supabase db push
--          or: paste into the Supabase SQL editor and run
--
-- Idempotent — re-running it is safe.
--
-- Ordering note: this one is independent of 20260819000001_lock_subscription_columns.sql
-- and can be applied at any time, before or after the lock. Applying it EARLY is
-- preferable, because the duplicate rows it removes are what make a receipt
-- permanently unreachable.
--
-- WHY
-- ---
-- Activation was idempotent only by convention: verify-razorpay-payment did a
-- SELECT ... WHERE razorpay_payment_id = $1 and inserted if it found nothing.
-- Two callers landing together (the checkout handler and the Razorpay webhook,
-- or a merchant double-tapping through a flaky connection) both read "no row"
-- and both inserted, because nothing in the schema said the column was unique.
--
-- The damage is not just a duplicate audit row:
--   * the receipt screen used .maybeSingle(), which ERRORS on more than one row,
--     so the receipt for that payment became permanently unopenable;
--   * two rows means two grants for one charge.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. De-duplicate the existing rows.
--
-- The EARLIEST row per payment id wins: it is the one written by the original
-- activation, so its starts_at/expires_at window is the one the customer was
-- actually told about and the one any already-issued receipt PDF quotes. Ties on
-- created_at are broken by id so the result is deterministic.
--
-- Rows with a NULL razorpay_payment_id are left alone — those are the manual /
-- admin grants, which legitimately have no payment behind them.
-- -----------------------------------------------------------------------------
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY razorpay_payment_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
    FROM public.subscriptions
   WHERE razorpay_payment_id IS NOT NULL
)
DELETE FROM public.subscriptions s
 USING ranked r
 WHERE s.id = r.id
   AND r.rn > 1;


-- -----------------------------------------------------------------------------
-- 2. Make a second row for the same payment impossible.
--
-- Partial rather than plain so the manual/admin grants above can keep sharing a
-- NULL payment id. (A plain unique index would also tolerate them, since NULLs
-- never conflict, but the predicate states the intent for the next reader.)
--
-- Consequence for callers: a partial unique index cannot be *inferred* by
-- `ON CONFLICT (razorpay_payment_id)` unless the same predicate is repeated in
-- the statement, and PostgREST has no way to express that. verify-razorpay-payment
-- therefore upserts WITHOUT an on_conflict target, which emits a bare
-- `ON CONFLICT DO NOTHING` and works against this index. Do not "helpfully" add
-- an on_conflict parameter there — it fails with SQLSTATE 42P10.
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_razorpay_payment_id_key
  ON public.subscriptions (razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 3. Receipt lookups.
--
-- The receipt screen polls `WHERE razorpay_payment_id = $1` every two seconds
-- while a payment settles. The unique index above already serves that lookup, so
-- nothing further is needed here; this comment exists only so the next person
-- does not add a redundant one.
-- -----------------------------------------------------------------------------
