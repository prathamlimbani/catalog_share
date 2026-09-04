-- =============================================================================
-- An activity log: who did what, when.
--
-- WHY
--   "Analytics" until now meant `analytics_events`, which records what ANONYMOUS
--   VISITORS do on a storefront -- page views, product clicks, WhatsApp taps.
--   It has no actor column at all, and `invoices` has no `created_by`, so the
--   plainest question anyone asks of this app -- "who wrote this estimate, and
--   when?" -- had no answer anywhere in the schema.
--
--   Two things were also simply broken, and are fixed here:
--
--   1. THE MASTER CONSOLE'S ANALYTICS RETURNED NOTHING. The only SELECT policy
--      on analytics_events is the company-owner one, and the platform admin owns
--      no company, so all 2,542 recorded events were invisible to the one person
--      the screen exists for. Migration 20260304000001 was meant to add
--      "Master Admins can view all analytics events" and never reached this
--      database.
--   2. THAT MIGRATION IS ALSO WRONG. Its owner policy filters on
--      `companies.user_id`, a column that has never existed here -- it is
--      `owner_id`. The live database carries a hand-corrected copy; re-applying
--      the repo file would have replaced a working policy with one that matches
--      no rows and silently blinded every merchant to their own analytics.
--      Both policies are re-created here from the columns that actually exist.
--
-- WHAT IS RECORDED, AND BY WHAT
--   Data changes come from TRIGGERS, not from the app. That is the whole point:
--   a client-side call is missed whenever a code path forgets it, is lost when
--   an estimate is written offline and pushed later by the sync engine, and can
--   be omitted outright by a patched build. A trigger sees the write itself, so
--   an offline estimate is logged the moment it lands, with the merchant's own
--   auth.uid() -- SECURITY DEFINER changes the executing role, not the
--   request.jwt GUC that auth.uid() reads, which is the same property that makes
--   the subscription guard hard to fool (20260819000001).
--
--   Things that are NOT a row change -- a sign-in, an ad watched, a redemption
--   confirmed -- cannot come from a trigger. Those go through log_activity(),
--   which stamps the actor from auth.uid() and resolves the company itself, so
--   the caller cannot attribute an action to somebody else.
--
-- THE LOG MUST NEVER BREAK THE WRITE IT DESCRIBES
--   Every trigger body swallows its own errors. An audit trail that can stop a
--   shopkeeper saving an estimate is worse than no audit trail: the merchant
--   loses work, and the cause is a table they have never heard of.
--
-- APPLY IT (self-hosted, on 103.233.65.233):
--   CS_SSH_PASSWORD='...' bash scripts/apply-selfhost-migration.sh \
--     supabase/migrations/20260904000000_activity_log.sql
--
-- The trailing SELECT prints a row per object; every status must read OK.
-- Idempotent; safe to re-run.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Who wrote this row
--
-- Nullable on purpose. A row written by the service role (an edge function, a
-- backfill) genuinely has no human author, and inventing one would be worse than
-- leaving it blank -- an audit column that is sometimes a guess is not evidence.
-- -----------------------------------------------------------------------------
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Existing rows predate the column. These companies are single-owner, so the
-- owner is not a guess: they are the only person who could have written it.
UPDATE public.invoices i
   SET created_by = c.owner_id
  FROM public.companies c
 WHERE c.id = i.company_id AND i.created_by IS NULL AND c.owner_id IS NOT NULL;

UPDATE public.products p
   SET created_by = c.owner_id
  FROM public.companies c
 WHERE c.id = p.company_id AND p.created_by IS NULL AND c.owner_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 2. The log itself
--
-- `action` is a dotted verb -- 'estimate.created', 'auth.signed_in' -- rather
-- than a foreign key to a lookup table. A CHECK on the shape keeps it tidy
-- without making every new kind of event a migration; the master console groups
-- on the prefix, so a verb it has never seen still lands in the right bucket
-- instead of disappearing.
--
-- `summary` is the one line a human reads. It is written at log time, not
-- rendered at read time, because an estimate that is later edited or deleted
-- must not rewrite the history of what it looked like when it was created.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.activity_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  actor_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   UUID,
  summary     TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.activity_events DROP CONSTRAINT IF EXISTS activity_events_action_check;
ALTER TABLE public.activity_events
  ADD CONSTRAINT activity_events_action_check
  CHECK (action ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$' AND length(action) <= 60);

-- A summary is for reading, not for storing a payload in. Capped so a runaway
-- caller cannot turn the log into the biggest table in the database.
ALTER TABLE public.activity_events DROP CONSTRAINT IF EXISTS activity_events_summary_check;
ALTER TABLE public.activity_events
  ADD CONSTRAINT activity_events_summary_check
  CHECK (summary IS NULL OR length(summary) <= 500);

ALTER TABLE public.activity_events DROP CONSTRAINT IF EXISTS activity_events_metadata_check;
ALTER TABLE public.activity_events
  ADD CONSTRAINT activity_events_metadata_check
  CHECK (pg_column_size(metadata) <= 4096);

-- The feed is always "newest first, optionally for one company", and the export
-- sweeps the whole table in created_at order. Both are covered.
CREATE INDEX IF NOT EXISTS activity_events_company_time_idx
  ON public.activity_events (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_events_time_idx
  ON public.activity_events (created_at DESC);
CREATE INDEX IF NOT EXISTS activity_events_action_idx
  ON public.activity_events (action);
CREATE INDEX IF NOT EXISTS activity_events_actor_idx
  ON public.activity_events (actor_id);
-- Backfill and re-runs both ask "is this entity already logged for this action";
-- without this that is a sequential scan per row.
CREATE INDEX IF NOT EXISTS activity_events_entity_idx
  ON public.activity_events (entity_id, action);

ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;

-- There is deliberately NO INSERT policy. Every write goes through a SECURITY
-- DEFINER function or trigger below, which is what stops a client attributing an
-- action to another user or inventing history for a company it does not own.
DROP POLICY IF EXISTS "Owners read own activity" ON public.activity_events;
CREATE POLICY "Owners read own activity"
  ON public.activity_events FOR SELECT
  USING (company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()));

DROP POLICY IF EXISTS "Admins read all activity" ON public.activity_events;
CREATE POLICY "Admins read all activity"
  ON public.activity_events FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.activity_events TO authenticated;


-- -----------------------------------------------------------------------------
-- 3. The writer
--
-- Used by triggers (which pass an explicit actor and company, because they know
-- the row) and, through log_activity() below, by the app.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_activity(
  p_company_id  UUID,
  p_actor_id    UUID,
  p_action      TEXT,
  p_entity_type TEXT,
  p_entity_id   UUID,
  p_summary     TEXT,
  p_metadata    JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.activity_events
    (company_id, actor_id, action, entity_type, entity_id, summary, metadata)
  VALUES
    (p_company_id, p_actor_id, p_action, p_entity_type, p_entity_id,
     left(p_summary, 500), COALESCE(p_metadata, '{}'::JSONB))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;


-- -----------------------------------------------------------------------------
-- 4. What the app may log
--
-- For the events no row change can produce: a sign-in, an ad watched, a
-- redemption confirmed. The actor and the company are resolved HERE, from
-- auth.uid(), and the caller's opinion on either is ignored -- otherwise the
-- log would be a place any signed-in user could write anybody's history.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_activity(
  p_action      TEXT,
  p_entity_type TEXT DEFAULT NULL,
  p_entity_id   UUID DEFAULT NULL,
  p_summary     TEXT DEFAULT NULL,
  p_metadata    JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_company UUID;
  v_id      UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Not signed in.');
  END IF;

  IF p_action !~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Bad action.');
  END IF;

  -- A company is not required. A sign-in happens before the company row is even
  -- read, and refusing to log it would lose the most common event of all.
  SELECT id INTO v_company FROM public.companies WHERE owner_id = auth.uid() LIMIT 1;

  v_id := public.record_activity(
    v_company, auth.uid(), p_action, p_entity_type, p_entity_id, p_summary, p_metadata);

  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  -- Logging is never worth an error the user can see.
  RETURN jsonb_build_object('ok', false, 'reason', 'Not logged.');
END;
$fn$;

GRANT EXECUTE ON FUNCTION
  public.log_activity(TEXT, TEXT, UUID, TEXT, JSONB) TO authenticated;


-- -----------------------------------------------------------------------------
-- 5. Estimates
--
-- Soft delete is the real delete here (20260819000002), so `deleted_at` moving
-- is what "deleted" and "restored" mean. A hard DELETE is logged too, because
-- one happening at all is worth being able to see.
--
-- The no-op guard matters more than it looks. The offline sync engine re-pushes
-- rows it already holds, and without this every reconnection would write an
-- 'estimate.updated' row per estimate and bury the real edits.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_invoice_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_action  TEXT;
  v_row     public.invoices%ROWTYPE;
  v_summary TEXT;
BEGIN
  v_row := COALESCE(NEW, OLD);

  IF TG_OP = 'INSERT' THEN
    v_action := 'estimate.created';
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'estimate.purged';
  ELSIF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    v_action := 'estimate.deleted';
  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    v_action := 'estimate.restored';
  ELSE
    -- Ignore a write that changed nothing anyone would want to read about.
    -- updated_at is excluded because the sync engine touches it on every push.
    IF (to_jsonb(NEW) - 'updated_at') = (to_jsonb(OLD) - 'updated_at') THEN
      RETURN NULL;
    END IF;
    v_action := 'estimate.updated';
  END IF;

  v_summary := COALESCE(NULLIF(v_row.invoice_number, ''), 'Estimate')
            || COALESCE(' for ' || NULLIF(v_row.customer_name, ''), '')
            || COALESCE(' - ' || to_char(v_row.final_amount, 'FM999999999.00'), '');

  PERFORM public.record_activity(
    v_row.company_id,
    CASE WHEN TG_OP = 'INSERT' THEN COALESCE(auth.uid(), v_row.created_by)
         ELSE auth.uid() END,
    v_action,
    'estimate',
    v_row.id,
    v_summary,
    jsonb_build_object(
      'invoice_number', v_row.invoice_number,
      'customer_name',  v_row.customer_name,
      'final_amount',   v_row.final_amount,
      'item_count',     CASE WHEN jsonb_typeof(v_row.items) = 'array'
                             THEN jsonb_array_length(v_row.items) ELSE 0 END));

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- An audit row must never cost a merchant their estimate.
  RETURN NULL;
END;
$fn$;

-- created_by is stamped BEFORE the insert so the row carries its author from the
-- moment it exists, including when it arrives from the offline queue.
CREATE OR REPLACE FUNCTION public.stamp_created_by()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.created_by IS NULL THEN
    NEW.created_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS stamp_invoice_created_by ON public.invoices;
CREATE TRIGGER stamp_invoice_created_by
  BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.stamp_created_by();

DROP TRIGGER IF EXISTS log_invoice_activity ON public.invoices;
CREATE TRIGGER log_invoice_activity
  AFTER INSERT OR UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.log_invoice_activity();


-- -----------------------------------------------------------------------------
-- 6. Products
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_product_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_action TEXT;
  v_row    public.products%ROWTYPE;
BEGIN
  v_row := COALESCE(NEW, OLD);

  IF TG_OP = 'INSERT' THEN
    v_action := 'product.created';
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'product.deleted';
  ELSE
    IF (to_jsonb(NEW) - 'updated_at') = (to_jsonb(OLD) - 'updated_at') THEN
      RETURN NULL;
    END IF;
    v_action := 'product.updated';
  END IF;

  PERFORM public.record_activity(
    v_row.company_id,
    CASE WHEN TG_OP = 'INSERT' THEN COALESCE(auth.uid(), v_row.created_by)
         ELSE auth.uid() END,
    v_action,
    'product',
    v_row.id,
    COALESCE(NULLIF(v_row.name, ''), 'Product')
      || COALESCE(' - ' || to_char(v_row.price, 'FM999999999.00'), ''),
    jsonb_build_object(
      'name',     v_row.name,
      'price',    v_row.price,
      'category', v_row.category,
      'in_stock', v_row.in_stock));

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS stamp_product_created_by ON public.products;
CREATE TRIGGER stamp_product_created_by
  BEFORE INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.stamp_created_by();

DROP TRIGGER IF EXISTS log_product_activity ON public.products;
CREATE TRIGGER log_product_activity
  AFTER INSERT OR UPDATE OR DELETE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.log_product_activity();


-- -----------------------------------------------------------------------------
-- 7. Money and points, logged where they are actually decided
--
-- A payment is confirmed by an edge function under the service role and a
-- redemption by redeem_reward_offer, so neither can be trusted to the client.
-- Triggers on the rows those write catch both wherever they are called from.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_payment_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_action TEXT;
BEGIN
  -- `subscriptions.amount` is in PAISE, like everything Razorpay returns. The
  -- summary divides it once, here, so no reader has to remember that.
  IF TG_OP = 'INSERT' THEN
    v_action := 'payment.recorded';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    v_action := 'payment.updated';
  ELSE
    RETURN NULL;
  END IF;

  PERFORM public.record_activity(
    NEW.company_id, auth.uid(), v_action, 'payment', NEW.id,
    COALESCE(initcap(NEW.status), 'Payment')
      || COALESCE(' ' || to_char(NEW.amount / 100.0, 'FM999999999.00'), '')
      || COALESCE(' for ' || NEW.plan, ''),
    jsonb_build_object(
      'plan',                NEW.plan,
      'amount_paise',        NEW.amount,
      'status',              NEW.status,
      'razorpay_payment_id', NEW.razorpay_payment_id,
      'expires_at',          NEW.expires_at));
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.log_points_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  PERFORM public.record_activity(
    NEW.company_id, auth.uid(),
    CASE WHEN NEW.delta >= 0 THEN 'points.earned' ELSE 'points.spent' END,
    'points', NULL,
    COALESCE(NULLIF(NEW.note, ''), NEW.reason) || ' (' ||
      CASE WHEN NEW.delta >= 0 THEN '+' ELSE '' END || NEW.delta || ')',
    jsonb_build_object('delta', NEW.delta, 'reason', NEW.reason, 'note', NEW.note));
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$fn$;

DO $$
BEGIN
  IF to_regclass('public.subscriptions') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS log_payment_activity ON public.subscriptions';
    EXECUTE 'CREATE TRIGGER log_payment_activity
             AFTER INSERT OR UPDATE ON public.subscriptions
             FOR EACH ROW EXECUTE FUNCTION public.log_payment_activity()';
  END IF;
  IF to_regclass('public.points_ledger') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS log_points_activity ON public.points_ledger';
    EXECUTE 'CREATE TRIGGER log_points_activity AFTER INSERT ON public.points_ledger
             FOR EACH ROW EXECUTE FUNCTION public.log_points_activity()';
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- 8. The two analytics_events policies, from the columns that exist
--
-- See the header. The owner policy is re-created against `owner_id`, and the
-- admin policy -- the one whose absence made the master console's analytics
-- screen permanently empty -- is added.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Company owners can view their analytics events" ON public.analytics_events;
CREATE POLICY "Company owners can view their analytics events"
  ON public.analytics_events FOR SELECT
  USING (company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()));

DROP POLICY IF EXISTS "Admins can view analytics events" ON public.analytics_events;
DROP POLICY IF EXISTS "Master Admins can view all analytics events" ON public.analytics_events;
CREATE POLICY "Master Admins can view all analytics events"
  ON public.analytics_events FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));


-- -----------------------------------------------------------------------------
-- 9. Backfill
--
-- One 'created' row per estimate and product that already exists, stamped with
-- the row's OWN created_at rather than now() -- a history that claims everything
-- happened the day the feature shipped is not a history.
--
-- Guarded by NOT EXISTS on (entity_id, action) so re-running this file adds
-- nothing.
-- -----------------------------------------------------------------------------
INSERT INTO public.activity_events
  (company_id, actor_id, action, entity_type, entity_id, summary, metadata, created_at)
SELECT i.company_id, i.created_by, 'estimate.created', 'estimate', i.id,
       COALESCE(NULLIF(i.invoice_number, ''), 'Estimate')
         || COALESCE(' for ' || NULLIF(i.customer_name, ''), '')
         || COALESCE(' - ' || to_char(i.final_amount, 'FM999999999.00'), ''),
       jsonb_build_object('backfilled', true,
                          'invoice_number', i.invoice_number,
                          'final_amount', i.final_amount),
       i.created_at
  FROM public.invoices i
 WHERE NOT EXISTS (SELECT 1 FROM public.activity_events a
                    WHERE a.entity_id = i.id AND a.action = 'estimate.created');

INSERT INTO public.activity_events
  (company_id, actor_id, action, entity_type, entity_id, summary, metadata, created_at)
SELECT p.company_id, p.created_by, 'product.created', 'product', p.id,
       COALESCE(NULLIF(p.name, ''), 'Product')
         || COALESCE(' - ' || to_char(p.price, 'FM999999999.00'), ''),
       jsonb_build_object('backfilled', true, 'name', p.name, 'price', p.price),
       p.created_at
  FROM public.products p
 WHERE NOT EXISTS (SELECT 1 FROM public.activity_events a
                    WHERE a.entity_id = p.id AND a.action = 'product.created');

INSERT INTO public.activity_events
  (company_id, actor_id, action, entity_type, entity_id, summary, metadata, created_at)
SELECT l.company_id, NULL,
       CASE WHEN l.delta >= 0 THEN 'points.earned' ELSE 'points.spent' END,
       'points', l.id,
       COALESCE(NULLIF(l.note, ''), l.reason) || ' (' ||
         CASE WHEN l.delta >= 0 THEN '+' ELSE '' END || l.delta || ')',
       jsonb_build_object('backfilled', true, 'delta', l.delta, 'reason', l.reason),
       l.created_at
  FROM public.points_ledger l
 WHERE NOT EXISTS (SELECT 1 FROM public.activity_events a
                    WHERE a.entity_id = l.id AND a.action LIKE 'points.%');


INSERT INTO public.activity_events
  (company_id, actor_id, action, entity_type, entity_id, summary, metadata, created_at)
SELECT s.company_id, c.owner_id, 'payment.recorded', 'payment', s.id,
       COALESCE(initcap(s.status), 'Payment')
         || COALESCE(' ' || to_char(s.amount / 100.0, 'FM999999999.00'), '')
         || COALESCE(' for ' || s.plan, ''),
       jsonb_build_object('backfilled', true, 'plan', s.plan,
                          'amount_paise', s.amount, 'status', s.status),
       s.created_at
  FROM public.subscriptions s
  LEFT JOIN public.companies c ON c.id = s.company_id
 WHERE NOT EXISTS (SELECT 1 FROM public.activity_events a
                    WHERE a.entity_id = s.id AND a.action = 'payment.recorded');


-- -----------------------------------------------------------------------------
-- 10. Putting a name to an actor
--
-- The log stores an actor_id and nothing else, on purpose: an email copied into
-- every row is a second place for it to live and go stale, and it would put
-- personal data in a table the company owner can read.
--
-- `auth.users` has no read policy for any client and must not get one, so the
-- console resolves ids through this instead. Admin-only, returns nothing but id
-- and email, and takes the ids it is asked about rather than listing everyone --
-- a function that dumps every user's email is a different and much worse thing
-- to leave lying around than one that answers "who are these fourteen ids".
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_lookup_users(p_ids UUID[])
RETURNS TABLE (id UUID, email TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT u.id, u.email::TEXT
      FROM auth.users u
     WHERE u.id = ANY(COALESCE(p_ids, ARRAY[]::UUID[]))
     LIMIT 500;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.admin_lookup_users(UUID[]) TO authenticated;


-- =============================================================================
-- Verification
-- =============================================================================
SELECT 'activity_events table' AS object,
       CASE WHEN to_regclass('public.activity_events') IS NOT NULL
            THEN 'OK' ELSE 'MISSING' END AS status
UNION ALL SELECT 'invoices.created_by',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema='public' AND table_name='invoices'
                            AND column_name='created_by') THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'products.created_by',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema='public' AND table_name='products'
                            AND column_name='created_by') THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'log_activity() callable by merchants',
       CASE WHEN has_function_privilege('authenticated',
              'public.log_activity(text,text,uuid,text,jsonb)', 'EXECUTE')
            THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'estimate trigger installed',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger
                          WHERE tgrelid='public.invoices'::REGCLASS
                            AND tgname='log_invoice_activity') THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'product trigger installed',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger
                          WHERE tgrelid='public.products'::REGCLASS
                            AND tgname='log_product_activity') THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'admins can read analytics_events',
       CASE WHEN EXISTS (SELECT 1 FROM pg_policy
                          WHERE polrelid='public.analytics_events'::REGCLASS
                            AND polname='Master Admins can view all analytics events')
            THEN 'OK' ELSE 'MISSING - the master console stays empty' END
UNION ALL SELECT 'analytics owner policy uses owner_id',
       CASE WHEN (SELECT pg_get_expr(polqual, polrelid) FROM pg_policy
                   WHERE polrelid='public.analytics_events'::REGCLASS
                     AND polname='Company owners can view their analytics events')
                 LIKE '%owner_id%' THEN 'OK' ELSE 'STALE' END
UNION ALL SELECT 'estimates with a known author',
       (SELECT count(*) FILTER (WHERE created_by IS NOT NULL) || ' of ' || count(*)
          FROM public.invoices)
UNION ALL SELECT 'admin_lookup_users()',
       CASE WHEN has_function_privilege('authenticated',
              'public.admin_lookup_users(uuid[])', 'EXECUTE')
            THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'payment trigger installed',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger
                          WHERE tgrelid='public.subscriptions'::REGCLASS
                            AND tgname='log_payment_activity') THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'activity rows',
       (SELECT count(*)::TEXT FROM public.activity_events)
UNION ALL SELECT 'activity by action',
       COALESCE((SELECT string_agg(action || '=' || n, ', ' ORDER BY action)
                   FROM (SELECT action, count(*) n FROM public.activity_events
                          GROUP BY action) t), 'NONE');
