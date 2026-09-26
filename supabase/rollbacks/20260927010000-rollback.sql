-- 20260927010000 退回:刪掉退貨的兩張表與三支函式。
-- 🔴 前置:後台已拿掉退貨區塊的接線(第 2 片以後的 commit 先 revert 並部署), 否則畫面會呼叫不存在的函式。
-- 🔴 表裡已經有真的退貨紀錄時不要直接跑:先把 order_returns / order_return_items 匯出留底再決定。
--    下面的前置閘會在有資料時停下。

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.order_returns') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.order_returns) THEN
    RAISE EXCEPTION '退回前置閘:order_returns 裡已經有資料 ⇒ 停(先匯出留底, 再決定要不要刪)。';
  END IF;
END
$pre$;

DROP FUNCTION IF EXISTS public.admin_void_return(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.admin_receive_return(uuid, uuid, text, jsonb, text);
DROP FUNCTION IF EXISTS public.admin_register_return(uuid, uuid, text, text, text, text, text, jsonb);
DROP TABLE IF EXISTS public.order_return_items;
DROP TABLE IF EXISTS public.order_returns;

DO $post$
BEGIN
  IF pg_catalog.to_regclass('public.order_returns') IS NOT NULL
     OR pg_catalog.to_regclass('public.order_return_items') IS NOT NULL THEN
    RAISE EXCEPTION '退回事後閘:退貨的表還在 ⇒ 停。';
  END IF;
  RAISE NOTICE '✅ 退貨的表與函式已刪除。';
END
$post$;

COMMIT;
