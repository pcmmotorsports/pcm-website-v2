-- 20260915080000-rollback.sql —— 退回 20260915080000_m4b_partially_cancelled_email_pending.sql
-- 🔴 email_outbox 若已有 order_partially_cancelled 的列 ⇒ CHECK 縮不回去 ⇒ 拒退(先處理那些列, 另一次有人簽名的動作)。
-- 退回後 TS 那半的 enqueue 會撞 42P01(view 不在)⇒ sweep route 那段回 failed / 503, 其餘信種照舊 ⇒ 要一起 revert TS 那顆。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF EXISTS (SELECT 1 FROM public.email_outbox WHERE event_type = 'order_partially_cancelled') THEN
    RAISE EXCEPTION '退回前置閘一:email_outbox 已有 order_partially_cancelled 的列 ⇒ CHECK 縮不回去, 先處理那些列';
  END IF;
  IF pg_catalog.to_regclass('public.pcm_partially_cancelled_email_pending') IS NULL THEN
    RAISE EXCEPTION '退回前置閘二:view 不在 ⇒ 20260915080000 沒貼過, 沒東西可退';
  END IF;
END
$pre$;

DROP VIEW public.pcm_partially_cancelled_email_current_v;
DROP VIEW public.pcm_partially_cancelled_email_pending;
DROP FUNCTION public.pcm_partially_cancelled_email_dedup_key(uuid, uuid);

ALTER TABLE public.email_outbox
  ADD CONSTRAINT email_outbox_event_type_check_v7
  CHECK (event_type IN (
    'order_created', 'order_shipped', 'order_cancelled', 'order_unpaid_cancelled',
    'shipment_tracking_corrected', 'bank_order_created',
    'order_partially_refunded',
    'bank_order_amount_changed'
  )) NOT VALID;
ALTER TABLE public.email_outbox VALIDATE CONSTRAINT email_outbox_event_type_check_v7;
ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_event_type_check;
ALTER TABLE public.email_outbox
  RENAME CONSTRAINT email_outbox_event_type_check_v7 TO email_outbox_event_type_check;

COMMIT;
