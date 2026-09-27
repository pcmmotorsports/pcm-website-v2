-- 20260928200000-rollback.sql —— 退 20260928200000_m4b_variant_sale_price.sql
-- 🔴🔴 只清資料,【不 DROP 欄位與函式】(計畫第八節退回順序、R4-1):
--    P-M4 之後的 create_order 會讀 sale_price_general 與 pcm_effective_general_price;DROP 掉,每一張訂單都會在建單時失敗。
-- 🔴 退回順序(計畫第八節第 5 點):先退 P14 的後台設特價入口(停止任何人設特價)⇒ 再跑本檔清空特價 ⇒
--    直接查規格表確認特價全部是空的 ⇒ 再退 view 與前台顯示。create_order 的單價核對不退回。
-- 冪等:清空已經是空的特價不會有事。會寫一筆稽核(actor = 'system:rollback')。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $rb$
DECLARE
  v_n integer;
BEGIN
  IF pg_catalog.to_regclass('public.product_variants') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                     WHERE attrelid = 'public.product_variants'::regclass AND attname = 'sale_price_general' AND NOT attisdropped) THEN
    RAISE NOTICE '特價欄不存在 ⇒ 沒有東西要清';
    RETURN;
  END IF;
  UPDATE public.product_variants SET sale_price_general = NULL WHERE sale_price_general IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 AND pg_catalog.to_regclass('public.admin_audit_log') IS NOT NULL THEN
    INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id, source_app)
    VALUES ('system:rollback', 'product.sale_price.clear_all', 'product_variants',
            pg_catalog.jsonb_build_object('rows_with_sale', v_n), pg_catalog.jsonb_build_object('rows_with_sale', 0),
            '20260928200000-rollback:退回特價功能,清空所有特價', 'rollback-20260928200000', 'admin');
  END IF;
  IF EXISTS (SELECT 1 FROM public.product_variants WHERE sale_price_general IS NOT NULL) THEN
    RAISE EXCEPTION 'rollback:還有規格帶著特價';
  END IF;
  RAISE NOTICE '✅ rollback 20260928200000:清掉 % 個規格的特價;欄位與函式刻意留著', v_n;
END
$rb$;

COMMIT;
