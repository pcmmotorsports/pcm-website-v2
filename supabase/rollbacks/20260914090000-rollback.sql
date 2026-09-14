-- 20260914090000-rollback.sql
--
-- 把兩支 view 還原成 `20260907060000` 那一版(第一代時間比較 + 兩個條件)。
--
-- 🛑🛑 **退回去 = 退回「比時間」** ⇒ 那兩個世界又判錯:
--    ①寄出後、寫 `sent_at` 前號碼被改(競態)②寄 A → 改 B → 更正信說 B → 又改回 A。
--    ⇒ 📌 **客人手上會留著一個過期的單號, 而不會有任何東西叫。** 退之前知道這件事。
-- ⚠️ 底面 `pcm_tracking_correction_candidates` 退回「不含那兩個條件」的第二代形狀
--    ⇒ `no_recipient_count` 與 pending 又會各用一套規則(那是 09-07 到 09-14 的狀態)。
-- 🔵 **不 DROP 任何東西** —— 兩支都只是 `CREATE OR REPLACE`, 欄位清單一字不變。

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ① 底面退回第二代(比號碼, 不含 skip 碼與手動單那兩段)
CREATE OR REPLACE VIEW public.pcm_tracking_correction_candidates
  WITH (security_invoker = true) AS
SELECT DISTINCT
  s.id                    AS shipment_id,
  s.shipment_reference    AS shipment_reference,
  s.tracking_number       AS tracking_number,
  s.carrier_code          AS carrier_code,
  s.tracking_corrected_at AS tracking_corrected_at,
  public.pcm_tracking_corrected_at_key(s.tracking_corrected_at) AS corrected_at_key,
  o.id                    AS order_id,
  o.display_id            AS display_id,
  o.notification_email    AS notification_email,
  c.email                 AS customer_email,
  o.order_source          AS order_source
FROM public.shipments s
JOIN public.shipment_items si ON si.shipment_id = s.id
JOIN public.order_items   oi ON oi.id = si.order_item_id
JOIN public.orders         o ON o.id = oi.order_id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE s.shipped_at IS NOT NULL
  AND s.deleted_at IS NULL
  AND s.tracking_corrected_at IS NOT NULL
  AND nullif(pg_catalog.btrim(s.tracking_number, public.pcm_js_trim_whitespace()), '') IS NOT NULL
  AND CASE
        WHEN (
          SELECT last.sent_tracking_recorded
            FROM public.email_outbox last
           WHERE last.status      = 'sent'
             AND last.sent_at    IS NOT NULL
             AND last.event_type IN ('order_shipped', 'shipment_tracking_corrected')
             AND last.order_id    = o.id
             AND public.pcm_safe_uuid(last.payload ->> 'shipment_id') = s.id
           ORDER BY last.sent_seq DESC NULLS LAST, last.sent_at DESC
           LIMIT 1
        ) IS TRUE
        THEN (
          SELECT last.sent_tracking_number
            FROM public.email_outbox last
           WHERE last.status      = 'sent'
             AND last.sent_at    IS NOT NULL
             AND last.event_type IN ('order_shipped', 'shipment_tracking_corrected')
             AND last.order_id    = o.id
             AND public.pcm_safe_uuid(last.payload ->> 'shipment_id') = s.id
           ORDER BY last.sent_seq DESC NULLS LAST, last.sent_at DESC
           LIMIT 1
        ) IS DISTINCT FROM nullif(pg_catalog.btrim(s.tracking_number, public.pcm_js_trim_whitespace()), '')
        ELSE EXISTS (
          SELECT 1
            FROM public.email_outbox e0
           WHERE e0.event_type = 'order_shipped'
             AND e0.dedup_key  = public.pcm_shipped_email_dedup_key(s.id, o.id)
             AND e0.status     = 'sent'
             AND e0.sent_at IS NOT NULL
             AND e0.sent_at < s.tracking_corrected_at
        )
      END
  AND NOT EXISTS (
        SELECT 1
          FROM public.email_outbox e
         WHERE e.event_type = 'shipment_tracking_corrected'
           AND e.dedup_key  = public.pcm_tracking_corrected_dedup_key(s.id, o.id, s.tracking_corrected_at)
      );

-- 🔵 codex R2 nit:下面兩句 COMMENT 是**重寫的**, 不是貼前那兩句的原文 —— 那是刻意的:
--    退回去的人需要知道【退掉之後會怎樣】(客人手上會留著過期單號而沒有東西會叫),
--    而貼前那兩句不講這件事。行為零差別。
-- 🔵 COMMENT 也要退(codex R1 nit 3):`CREATE OR REPLACE VIEW` 不會換掉 COMMENT
--    ⇒ 不重下的話, 退完之後資料庫上那兩句說明仍然自稱「第三代」
--    ⇒ 📌 一支 view 與它的說明各自「正確」, 而合起來是假的。
COMMENT ON VIEW public.pcm_tracking_correction_candidates IS
$c$該寄更正單號信的**規則底面**(第二代,`20260905200000`;2026-09-14 由 rollback 退回)。
🔴 判準 = 我們最後一次告訴【這一張訂單的收件人】的號碼 <> 現在的號碼,粒度 (shipment_id, order_id)。
🔴 本面**刻意不含收件人條件** —— 有收件人 ⇒ `pcm_tracking_corrected_email_pending`;
   沒有 ⇒ `get_tracking_corrected_gap_counts()` 的 `no_recipient_count`。
⚠️ **退回這一版之後, 兩半【不再互補】** —— pending 上有五個 skip 碼與手動單那兩個條件, 而本面沒有。$c$;

-- ② pending 退回 20260907060000 那一版(自己 join、比時間、帶兩個條件)
CREATE OR REPLACE VIEW public.pcm_tracking_corrected_email_pending
  WITH (security_invoker = true) AS
SELECT DISTINCT
  s.id                  AS shipment_id,
  s.shipment_reference  AS shipment_reference,
  s.tracking_number     AS tracking_number,
  s.carrier_code        AS carrier_code,
  s.tracking_corrected_at AS tracking_corrected_at,
  public.pcm_tracking_corrected_at_key(s.tracking_corrected_at) AS corrected_at_key,
  o.id                  AS order_id,
  o.display_id          AS display_id,
  o.notification_email  AS notification_email,
  c.email               AS customer_email,
  o.order_source        AS order_source
FROM public.shipments s
JOIN public.shipment_items si ON si.shipment_id = s.id
JOIN public.order_items oi ON oi.id = si.order_item_id
JOIN public.orders o ON o.id = oi.order_id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE s.shipped_at IS NOT NULL
  AND s.deleted_at IS NULL
  AND s.tracking_corrected_at IS NOT NULL
  AND nullif(pg_catalog.btrim(s.tracking_number, public.pcm_js_trim_whitespace()), '') IS NOT NULL
  AND (
        nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      )
  AND EXISTS (
        SELECT 1 FROM public.email_outbox e0
         WHERE e0.event_type = 'order_shipped'
           AND e0.dedup_key = public.pcm_shipped_email_dedup_key(s.id, o.id)
           AND e0.status = 'sent'
           AND e0.sent_at IS NOT NULL
           AND e0.sent_at < s.tracking_corrected_at)
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.event_type = 'shipment_tracking_corrected'
           AND e.dedup_key = public.pcm_tracking_corrected_dedup_key(s.id, o.id, s.tracking_corrected_at)
           AND COALESCE(e.last_error_code, '') NOT IN (
                 'shipment_voided',
                 'tracking_superseded',
                 'bank_order_not_mailable_at_send',
                 'bank_order_snapshot_stale',
                 -- 🔴 第五碼 —— 貼之前線上那一版是 `20260907230000`(五碼), 不是 `20260907060000`(四碼)。
                 --    退回去要退成**線上真的那一版**, 不是我第一次以為的那一版(codex R1 must-fix 1)。
                 'recipient_stale_at_send'
               ))
  AND (
        o.order_source IS NULL
     OR o.order_source NOT IN ('manual_phone', 'manual_line', 'manual_other')
     OR nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      );

COMMENT ON VIEW public.pcm_tracking_corrected_email_pending IS
$c$該寄更正單號信的箱(**第一代 · 比時間**,`20260907230000` 那一版;2026-09-14 由 rollback 退回)。
🛑🛑 **這一版用 `e0.sent_at < s.tracking_corrected_at` 當代理, 而它在兩個世界判錯**:
   ①寄出之後、寫 `sent_at` 之前號碼被改(競態)⇒ 判成「沒收過」⇒ **不寄**;
   ②寄 A → 改 B → 更正信說 B → 又改回 A ⇒ 客人手上最後一封說 B、現在是 A ⇒ **不寄**。
   ⇒ 📌 **客人手上會留著一個過期的單號, 而不會有任何東西叫。**
🔵 要修 ⇒ 重貼 `20260914090000`(第三代:規則回到底面、比號碼)。$c$;

COMMIT;
