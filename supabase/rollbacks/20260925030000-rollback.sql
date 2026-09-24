SET LOCAL lock_timeout = '5s';
-- 20260925030000 退回:拿掉經銷品牌折扣表與寫入函式。
-- 🔴 只適用「只貼了 E1」:片 E2 貼了之後, 價格函式會讀這張表 ⇒ 要先貼 E2 的退回檔(計畫 §10.2), 再跑這支;
--    順序反了, DROP 會被相依關係擋下, 或讓結帳在執行時出錯。
-- 🔴 折扣資料會一起刪掉 ⇒ 先匯出(前置閘會印目前筆數)。每一筆變更都在 admin_audit_log(dealer.brand_discount.change)查得到。
-- 貼完手動跑 NOTIFY pgrst, 'reload schema'; 並跑 pcm_acl_approve_latest(p_note 帶 20260925030000 rollback)。
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
DECLARE
  v_n bigint;
BEGIN
  IF pg_catalog.to_regclass('public.dealer_brand_discounts') IS NULL THEN
    RAISE EXCEPTION '退回前置閘:dealer_brand_discounts 不存在 ⇒ 可能沒貼過或已退過, 停。';
  END IF;
  IF pg_catalog.to_regprocedure('public.dealer_discounted_amount(uuid, uuid, integer)') IS NOT NULL THEN
    RAISE EXCEPTION '退回前置閘:片 E2 的 dealer_discounted_amount 還在 ⇒ 先貼 E2 的退回檔, 停。';
  END IF;
  SELECT count(*) INTO v_n FROM public.dealer_brand_discounts;
  RAISE NOTICE '即將刪除 dealer_brand_discounts, 目前 % 筆折扣設定。', v_n;
END
$pre$;

DROP FUNCTION public.admin_dealer_brand_discounts_save(uuid, jsonb, jsonb, text, text);
DROP TABLE public.dealer_brand_discounts;

DO $post$
BEGIN
  IF pg_catalog.to_regclass('public.dealer_brand_discounts') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.admin_dealer_brand_discounts_save(uuid, jsonb, jsonb, text, text)') IS NOT NULL THEN
    RAISE EXCEPTION '退回事後閘:表或函式還在 ⇒ 停。';
  END IF;
  RAISE NOTICE '✅ 20260925030000 已退回。';
END
$post$;

COMMIT;
