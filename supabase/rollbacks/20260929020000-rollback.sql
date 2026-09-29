-- 20260929020000-rollback.sql —— 退回 20260929020000_m4b_product_price_changes_log.sql
-- 刪 trigger、trigger function、紀錄表(連同序列與 policy)。表裡只有「規格一般價變動」的紀錄, 刪了不影響商品資料;
-- 回滾之後每日摘要的「商品」一行會讀不到 ⇒ 列進「這一輪讀不到」(程式端照三態處理, 不當成 0)。
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP TRIGGER IF EXISTS trg_product_variants_price_change_log ON public.product_variants;
DROP FUNCTION IF EXISTS public.product_variants_price_change_log();
DROP TABLE IF EXISTS public.product_price_changes;
DO $post$
BEGIN
  IF pg_catalog.to_regclass('public.product_price_changes') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname = 'trg_product_variants_price_change_log') THEN
    RAISE EXCEPTION '退回後置閘:表或 trigger 還在';
  END IF;
END
$post$;
COMMIT;
