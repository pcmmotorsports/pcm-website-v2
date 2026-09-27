-- 20260928030000-rollback.sql —— 退 20260928030000_m4b_admin_product_attention_fields.sql
-- 🔴 順序:先 git revert 後台讀這兩個計算欄的那顆碼(商品頁乙 A2,product-repository.ts),再跑本檔。
--    反過來 ⇒ 「代表圖待補」「標題無中文字」兩顆件數不顯示,點那兩顆才「商品列表載入失敗」,不會寫壞資料。
-- 冪等:DROP … IF EXISTS。

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.admin_card_image_missing(public.products);
DROP FUNCTION IF EXISTS public.admin_title_lacks_cjk(public.products);

DO $post$
BEGIN
  IF pg_catalog.to_regprocedure('public.admin_card_image_missing(public.products)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.admin_title_lacks_cjk(public.products)') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback:計算欄函式仍在';
  END IF;
  RAISE NOTICE '✅ rollback 20260928030000:兩支計算欄函式已移除';
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
