-- 20260916100000-rollback.sql —— 退回 20260916100000_m4b_catalog_category_counts.sql
--
-- 做什麼:DROP public.catalog_category_counts()。無資料寫入、不動表 ⇒ 不拿表鎖。
-- 🔵 順序不拘:顧客站 listCategories 叫不到這支(PGRST202 / 42883)會自己退回逐分類 count(同時最多 6 發)。
--    ⇒ 可以先跑本檔再 revert 程式;退完之後側欄件數照舊,只是回到 117 發的負載。
-- 🔴 退完同批跑 pcm_acl_approve_latest(p_note 帶 20260916100000 與「rollback」)。

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.catalog_category_counts();

DO $post$
BEGIN
  IF pg_catalog.to_regprocedure('public.catalog_category_counts()') IS NOT NULL THEN
    RAISE EXCEPTION '退回後置閘:catalog_category_counts() 還在';
  END IF;
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
