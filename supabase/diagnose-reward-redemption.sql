-- =============================================================================
-- Why can a merchant earn points but not redeem them?
--
-- Run it on the live backend (see SELF-HOSTING.md:184):
--
--   sudo -u postgres psql -d catalogshare -f diagnose-reward-redemption.sql
--
-- It reads only; nothing here changes anything. Every row prints a verdict.
--
-- The expected answer, before 20260825000000 is applied, is:
--   "guard blocks merchant plan grants  |  THIS IS THE BUG"
-- =============================================================================

SELECT '--- 1. is the redeem path even installed? ---' AS check, '' AS verdict
UNION ALL
SELECT 'redeem_reward_offer exists',
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                          WHERE n.nspname='public' AND p.proname='redeem_reward_offer')
            THEN 'yes' ELSE 'NO -- monetization migration never applied' END
UNION ALL
SELECT 'authenticated may execute it',
       CASE WHEN has_function_privilege('authenticated', 'public.redeem_reward_offer(uuid)', 'EXECUTE')
            THEN 'yes' ELSE 'NO -- missing GRANT' END
UNION ALL
SELECT 'wallet_balances view exists',
       CASE WHEN to_regclass('public.wallet_balances') IS NOT NULL
            THEN 'yes' ELSE 'NO -- every balance reads 0, so nothing looks affordable' END
UNION ALL

SELECT '--- 2. THE PRIME SUSPECT ---', ''
UNION ALL
-- guard_company_subscription_columns() RAISEs on any change to
-- subscription_plan unless the caller is the service role, an admin, or has
-- raised a transaction-local flag. redeem_reward_offer runs as the MERCHANT, so
-- it is none of those -- SECURITY DEFINER changes the executing role, not the
-- request.jwt GUC that auth.role() reads. Earning is unaffected because the SSV
-- callback writes points_ledger under the service role and never touches
-- companies. It works for YOUR account because admins are exempt.
SELECT 'guard trigger is live on companies',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger
                          WHERE tgrelid = 'public.companies'::regclass
                            AND tgname = 'guard_company_subscription_columns'
                            AND NOT tgisinternal)
            THEN 'yes' ELSE 'no -- then look at section 3 instead' END
UNION ALL
SELECT 'guard blocks merchant plan grants',
       CASE
         WHEN NOT EXISTS (SELECT 1 FROM pg_trigger
                           WHERE tgrelid='public.companies'::regclass
                             AND tgname='guard_company_subscription_columns' AND NOT tgisinternal)
           THEN 'n/a -- guard not installed'
         WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                       WHERE n.nspname='public' AND p.proname='redeem_reward_offer'
                         AND pg_get_functiondef(p.oid) LIKE '%app.plan_grant%')
           THEN 'no -- already fixed by 20260825000000'
         ELSE 'THIS IS THE BUG -- apply 20260825000000_reward_grant_guard_exemption.sql'
       END
UNION ALL

SELECT '--- 3. runners-up ---', ''
UNION ALL
SELECT 'active reward offers',
       COALESCE((SELECT count(*)::text FROM public.reward_offers WHERE active), '0')
       || CASE WHEN COALESCE((SELECT count(*) FROM public.reward_offers WHERE active), 0) = 0
               THEN ' -- nothing to tap; the Redeem list is empty' ELSE '' END
UNION ALL
-- An offer naming a plan id the CHECK constraint rejects aborts the UPDATE with
-- SQLSTATE 23514 instead of P0001. Same symptom, different fix.
SELECT 'offers whose plan is missing from public.plans',
       COALESCE((SELECT string_agg(o.plan_id, ', ')
                   FROM public.reward_offers o
                  WHERE o.active
                    AND NOT EXISTS (SELECT 1 FROM public.plans pl WHERE pl.id = o.plan_id)),
                'none -- good')
UNION ALL
SELECT 'plan ids the CHECK constraint accepts',
       COALESCE((SELECT pg_get_constraintdef(oid) FROM pg_constraint
                  WHERE conrelid='public.companies'::regclass
                    AND conname='companies_subscription_plan_check'),
                'no CHECK constraint found')
UNION ALL
SELECT 'rewards enabled in app_settings',
       COALESCE((SELECT value::text FROM public.app_settings WHERE key='rewards'),
                'NO ROW -- the client falls back to enabled:false')
UNION ALL
-- If the merchant's user is not the OWNER of the company the points were
-- credited to, redeem answers 'Set up your company first.' while the balance
-- still shows. Non-zero here means that mismatch is real.
SELECT 'companies holding points with no owner_id',
       (SELECT count(*)::text FROM public.companies c
         WHERE c.owner_id IS NULL
           AND EXISTS (SELECT 1 FROM public.points_ledger l WHERE l.company_id = c.id))
UNION ALL
SELECT 'owners with more than one company',
       (SELECT COALESCE(count(*)::text, '0') FROM (
          SELECT owner_id FROM public.companies
           WHERE owner_id IS NOT NULL GROUP BY owner_id HAVING count(*) > 1) x)
       || ' -- redeem locks LIMIT 1, so >0 can mean it charges a different company';
