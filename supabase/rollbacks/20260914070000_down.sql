-- OP7 回滾:拿掉三支 trigger、對帳 view、三支函式 + trigger 函式。
-- 🛑 **不動 order_pending_refunds 的資料** —— 已開出去的列是「有人該拿回錢」的紀錄;回滾的是機制不是帳。
-- ⚠️ 回滾之後:那些列留著、而沒有機制再開新的 ⇒ 回到 2026-09-14 之前的狀態, 且多了一批已開的(plan §6)。
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $pre$
BEGIN
  IF pg_catalog.to_regprocedure('public.pcm_partial_cancel_recompute(pg_catalog.uuid)') IS NULL THEN
    RAISE EXCEPTION '回滾前置閘:OP7 不在這台庫上, 沒有東西可回滾';
  END IF;
END
$pre$;
DROP TRIGGER IF EXISTS order_cancellation_items_partial_refund_ai ON public.order_cancellation_items;
DROP TRIGGER IF EXISTS order_items_partial_refund_au ON public.order_items;
DROP TRIGGER IF EXISTS orders_partial_refund_shipping_au ON public.orders;
DROP FUNCTION IF EXISTS public.pcm_partial_cancel_recompute_tg();
DROP VIEW IF EXISTS public.pcm_partial_cancel_refund_reconciliation_v;
DROP FUNCTION IF EXISTS public.pcm_partial_cancel_recompute(uuid);
DROP FUNCTION IF EXISTS public.pcm_pending_refund_amounts_capped(uuid, bigint);
DROP FUNCTION IF EXISTS public.pcm_order_remaining_receivable(uuid);
DO $post$
BEGIN
  IF pg_catalog.to_regprocedure('public.pcm_order_remaining_receivable(pg_catalog.uuid)') IS NOT NULL
     OR pg_catalog.to_regclass('public.pcm_partial_cancel_refund_reconciliation_v') IS NOT NULL THEN
    RAISE EXCEPTION '回滾事後閘:物件還在';
  END IF;
END
$post$;
COMMIT;
