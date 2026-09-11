-- 20260912010000-rollback.sql —— 退回 20260912010000_m4b_catalog_facet_counts.sql
--
-- 退回之後 = 那支函式不存在。沒有任何資料寫入要還原。
-- 🔴 順序:前端先 revert(回到 108 發 search_catalog_by_vehicle), 再跑這支。
--    反過來 = 前端叫不到函式 ⇒ route 503 ⇒ 側欄件數不顯示(fail-safe, 不會印錯數字)。
BEGIN;
SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.catalog_facet_counts(text[], text[], text, text, integer, text[], text[]);

DO $post$
BEGIN
  IF to_regprocedure('public.catalog_facet_counts(text[], text[], text, text, integer, text[], text[])') IS NOT NULL THEN
    RAISE EXCEPTION '回退事後閘:catalog_facet_counts 還在';
  END IF;
END
$post$;

COMMIT;
