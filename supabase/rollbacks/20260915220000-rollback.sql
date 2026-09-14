-- 20260915220000-rollback.sql —— 退 20260915220000_m6_products_content_changed_at.sql 的【行為】
-- 🔴 順序:先 git revert 顧客站 sitemap 那顆碼(它讀 content_changed_at),再跑本檔。
--
-- 🔴🔴 本回滾【只拆 trigger 與函式】,不刪欄、不動 products_public —— 這是刻意的:
--   ⛔ 第一版 DROP VIEW + 重建 20 欄 + 還原 ACL(codex R1 must-fix:寫死 GRANT 會漏 service_role / MAINTAIN)
--   ⛔ 第二版 aclexplode 存下再還原(codex R2 must-fix 4 條:grantor 鏈、owner 自撤權、角色名被引號兩次、欄級 ACL)
--   ⇒ 📌 只要 DROP VIEW,就要把一個【沒人量過正式庫長什麼樣】的 ACL 完整重建出來,而每補一格就多一種邊角。
--   ✅ 不 DROP VIEW ⇒ ACL 一個位元都不動 ⇒ 上面兩輪的洞全部不存在。
--   代價:products.content_changed_at 與 products_public 第 21 欄留著(一個時間戳,不含價格);
--     trigger 拆掉之後它不再更新,顧客站碼 revert 之後也沒人讀 ⇒ 惰性。
--   要連欄一起清掉 ⇒ 另寫一支 migration(要處理 view ACL),不在回滾當下做。
-- 冪等:DROP … IF EXISTS。

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS trg_products_z_content_changed ON public.products;
DROP TRIGGER IF EXISTS trg_product_variants_content_changed ON public.product_variants;
DROP FUNCTION IF EXISTS public.products_content_changed_guard();
DROP FUNCTION IF EXISTS public.product_variants_content_changed_touch();

DO $post$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
     WHERE NOT tgisinternal
       AND tgname IN ('trg_products_z_content_changed', 'trg_product_variants_content_changed')
  ) THEN
    RAISE EXCEPTION 'rollback:content_changed_at 的 trigger 仍在';
  END IF;
  IF pg_catalog.to_regprocedure('public.products_content_changed_guard()') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.product_variants_content_changed_touch()') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback:content_changed_at 的 trigger 函式仍在';
  END IF;
  RAISE NOTICE '✅ rollback:兩支 trigger 與函式已拆;content_changed_at 欄與 products_public 第 21 欄刻意保留(惰性)';
END
$post$;

COMMIT;
