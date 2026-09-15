-- 20260915230000-rollback.sql
-- 退 P0-1 片 1a(supabase/migrations/20260915230000_m4b_p01_ship_clearances_and_handover_confirm.sql)。
--
-- 🔴 退的順序:片 4 → 片 3 → 片 2 → 片 1b → 本檔(plan §9)。片 1b 的 claim / mark_shipped 會寫這張表、片 3 的 view 會讀它。
-- 🔴 只 DROP admin_confirm_hct_handover。表 shipment_order_ship_clearances 與回填列【保留】(plan §9):
--    它是事實紀錄, 舊函式不讀也不寫;DROP 會丟掉「誰在什麼狀態下出過貨」。
-- 🔴 不會被撤銷的事實:期間經管理者確認寫下的 shipments.hct_dispatched_at 與 admin_audit_log 列。
-- ⚠️ 重貼本 migration 會被它的前置閘一擋下(表還在)⇒ 要重貼先人工決定表怎麼處理。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF pg_catalog.to_regprocedure('public.admin_confirm_hct_handover(text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION '前置閘:admin_confirm_hct_handover 不在 ⇒ 沒貼過或已退過';
  END IF;
  -- 片 1b 還在 ⇒ 先退 1b(它的 mark_shipped 補記路依賴人工確認寫下的 hct_dispatched_at 語意)。
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
               JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'pcm_order_ship_blocked') THEN
    RAISE EXCEPTION '前置閘:片 1b(pcm_order_ship_blocked)還在 ⇒ 先退片 1b';
  END IF;
  RAISE NOTICE '人工確認交貨稽核列(保留不動):% 列',
    (SELECT pg_catalog.count(*) FROM public.admin_audit_log g WHERE g.action = 'shipment.hct_handover_confirmed');
END
$pre$;

DROP FUNCTION public.admin_confirm_hct_handover(text,text,text,text);

COMMIT;
