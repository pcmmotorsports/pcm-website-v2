SET LOCAL lock_timeout = '5s';
-- 20260928250000 退回:刪掉兩支商品讀取索引。
-- 🔴 DROP INDEX(非 CONCURRENTLY)會把表完全鎖住、連讀都擋,而且排在進行中的長查詢後面、把後面的讀取一起堵住
--    ⇒ 跟正向一樣:台灣凌晨、一開始 NOWAIT 拿鎖,拿不到就放棄換時間。
-- 退回後查詢回到貼之前的速度;索引不改變查詢結果,退回不影響正確性。
-- 貼完同批跑 pcm_acl_approve_latest(p_note 帶 20260928250000 rollback)。
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE public.products, public.product_variants IN ACCESS EXCLUSIVE MODE NOWAIT;
DROP INDEX IF EXISTS public.products_brand_id_handle_idx;
DROP INDEX IF EXISTS public.product_variants_sale_or_null_general_idx;
DO $post$
BEGIN
  IF pg_catalog.to_regclass('public.products_brand_id_handle_idx') IS NOT NULL
     OR pg_catalog.to_regclass('public.product_variants_sale_or_null_general_idx') IS NOT NULL THEN
    RAISE EXCEPTION '退回事後閘:索引還在';
  END IF;
END
$post$;
COMMIT;
