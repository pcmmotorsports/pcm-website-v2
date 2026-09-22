-- 20260922100000 回滾:DROP admin_swap_order_item。
-- 🔴 順序 = 先 revert 程式(換商品入口)再跑本檔;否則畫面按下去會 PGRST202。
-- 已經換過的品項不會換回來(那是資料, 不是結構)。
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $pre$
BEGIN
  IF pg_catalog.to_regprocedure('public.admin_swap_order_item(text,text,uuid,uuid,integer,uuid)') IS NULL THEN
    RAISE EXCEPTION '回滾前置閘:admin_swap_order_item 不在這台庫上, 沒有東西可回滾';
  END IF;
END
$pre$;
DROP FUNCTION public.admin_swap_order_item(text,text,uuid,uuid,integer,uuid);
COMMIT;
