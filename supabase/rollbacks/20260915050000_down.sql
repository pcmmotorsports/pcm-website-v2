-- M-4b-03 A 片 回滾:DROP 兩支 RPC + DROP TABLE order_amount_requests(policy / 索引隨表走)。
-- 🔴 申請紀錄會跟著掉 ⇒ 回滾前先匯出:SELECT * FROM public.order_amount_requests;
--    已核准的改價【不會】回來(那是既有 admin_update_order_item_amount 寫在 order_items 上的, 不在本片範圍)。
-- 🔴 順序 = 先 revert app(B / C 片)再跑本檔(app 還在時會 PGRST202 / 42P01)。
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.order_amount_requests') IS NULL THEN
    RAISE EXCEPTION '回滾前置閘:order_amount_requests 不在這台庫上, 沒有東西可回滾';
  END IF;
END
$pre$;
DROP FUNCTION IF EXISTS public.admin_review_order_item_amount(uuid,text,text,text,text);
DROP FUNCTION IF EXISTS public.admin_request_order_item_amount(uuid,uuid,integer,integer,text,text,text,text);
DROP TABLE public.order_amount_requests;
COMMIT;
