-- 20260927080000-rollback.sql —— 退回 20260927080000_m4b_return_received_email_pending.sql
-- 🔴 email_outbox 若已有 order_return_received 的列 ⇒ CHECK 縮不回去 ⇒ 拒退(先關上膛開關、處理那些列, 另一次有人簽名的動作)。
-- 退回後 TS 那半的 enqueue 會撞 42P01(view 不在)⇒ 要先關開關(RETURN_RECEIVED_EMAIL_CUTOFF 拿掉)或一起 revert TS。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF EXISTS (SELECT 1 FROM public.email_outbox WHERE event_type = 'order_return_received') THEN
    RAISE EXCEPTION '退回前置閘一:email_outbox 已有 order_return_received 的列 ⇒ CHECK 縮不回去, 先處理那些列';
  END IF;
  IF pg_catalog.to_regclass('public.pcm_return_received_email_pending') IS NULL THEN
    RAISE EXCEPTION '退回前置閘二:view 不在 ⇒ 20260927080000 沒貼過, 沒東西可退';
  END IF;
END
$pre$;

-- 🛑 先 DROP view 再 DROP 函式(view 呼它, 反過來會被依賴擋下)。
DROP VIEW public.pcm_return_received_email_pending;
DROP FUNCTION public.pcm_return_received_email_dedup_key(uuid, uuid);

ALTER TABLE public.email_outbox
  ADD CONSTRAINT email_outbox_event_type_check_v8
  CHECK (event_type IN (
    'order_created', 'order_shipped', 'order_cancelled', 'order_unpaid_cancelled',
    'shipment_tracking_corrected', 'bank_order_created',
    'order_partially_refunded',
    'bank_order_amount_changed',
    'order_partially_cancelled'
  )) NOT VALID;
ALTER TABLE public.email_outbox VALIDATE CONSTRAINT email_outbox_event_type_check_v8;
ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_event_type_check;
ALTER TABLE public.email_outbox
  RENAME CONSTRAINT email_outbox_event_type_check_v8 TO email_outbox_event_type_check;

DO $post$
BEGIN
  IF pg_catalog.to_regclass('public.pcm_return_received_email_pending') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.pcm_return_received_email_dedup_key(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '退回後置閘一:view 或 dedup 函式還在';
  END IF;
  IF (SELECT pg_catalog.pg_get_constraintdef(c.oid) FROM pg_catalog.pg_constraint c
       WHERE c.conrelid = 'public.email_outbox'::regclass AND c.conname = 'email_outbox_event_type_check') LIKE '%order_return_received%' THEN
    RAISE EXCEPTION '退回後置閘二:CHECK 還含 order_return_received';
  END IF;
END
$post$;

COMMIT;
