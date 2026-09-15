-- 20260916020000-rollback.sql
-- 退 P0-1 片 3(supabase/migrations/20260916020000_m4b_p01_shipped_email_views_require_clearance.sql)。
--
-- 🔴 三張 view 的定義由程式從【正式庫 2026-09-15 schema dump 的 pg_get_viewdef】逐字產生;後置閘驗 md5(pg_get_viewdef) 回到原值。
--    pg_get_viewdef 的輸出不帶 schema 前綴 ⇒ 本檔在交易內把 search_path 暫時設成 public, pg_catalog 才能逐字重建。
-- 🔴 版本前提(codex 片 3 R1 should-fix 2):後置閘的 md5 基準是 PostgreSQL 17 的 pg_get_viewdef 反編譯輸出
--    (2026-09-15 正式庫 17.6 與 Q41 schema 庫 17.10 逐字相同)。換主版本時先在那個版本重算基準再退, 不可跳過 md5 閘。
-- 🔴 退的順序:片 4(寄送端 TS)→ 本檔 → 片 2 → 片 1b → 片 1a(plan §9)。
-- 🔴 不會被撤銷的事實:證明列(append-only)、期間已排入 / 已寄 / 已跳過的信。

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = public, pg_catalog;

DO $pre$
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer / 10000 <> 17 THEN
    RAISE EXCEPTION '前置閘:PostgreSQL 主版本是 %, 本檔 md5 基準是 17 的反編譯輸出 ⇒ 先在這個版本重算基準再退', pg_catalog.current_setting('server_version_num');
  END IF;
  IF pg_catalog.strpos(pg_catalog.pg_get_viewdef('public.pcm_shipped_email_pending'::regclass, true), 'shipment_order_ship_clearances') = 0
     OR pg_catalog.strpos(pg_catalog.pg_get_viewdef('public.pcm_shipped_email_unsendable'::regclass, true), 'shipment_order_ship_clearances') = 0
     OR pg_catalog.strpos(pg_catalog.pg_get_viewdef('public.pcm_tracking_correction_candidates'::regclass, true), 'shipment_order_ship_clearances') = 0 THEN
    RAISE EXCEPTION '前置閘:三張 view 不是片 3 那一代(沒讀證明)⇒ 沒貼過、已退過, 或有人改過;停下人工看';
  END IF;
  RAISE NOTICE '寄送端 skip 碼 order_not_cleared_at_ship 的列(維持 skipped, 不自動翻回):% 列',
    (SELECT pg_catalog.count(*) FROM public.email_outbox WHERE last_error_code = 'order_not_cleared_at_ship');
END
$pre$;
-- ── pcm_shipped_email_pending(回到 md5 35a84501cbc8c366459e3fcd8e61c8f4)──
CREATE OR REPLACE VIEW public.pcm_shipped_email_pending
  WITH (security_invoker = true) AS
 SELECT DISTINCT s.id AS shipment_id,
    s.shipment_reference,
    s.shipped_at,
    o.id AS order_id,
    o.display_id,
    o.notification_email,
    c.email AS customer_email,
    o.order_source
   FROM shipments s
     JOIN shipment_items si ON si.shipment_id = s.id
     JOIN order_items oi ON oi.id = si.order_item_id
     JOIN orders o ON o.id = oi.order_id
     LEFT JOIN customers c ON c.user_id = o.customer_user_id
  WHERE s.shipped_at IS NOT NULL AND s.deleted_at IS NULL AND (NULLIF(btrim(o.notification_email, pcm_js_trim_whitespace()), ''::text) IS NOT NULL OR NULLIF(btrim(c.email, pcm_js_trim_whitespace()), ''::text) IS NOT NULL) AND NOT (EXISTS ( SELECT 1
           FROM email_outbox e
          WHERE e.event_type = 'order_shipped'::text AND e.dedup_key = pcm_shipped_email_dedup_key(s.id, o.id) AND (COALESCE(e.last_error_code, ''::text) <> ALL (ARRAY['shipment_voided'::text, 'tracking_superseded'::text, 'bank_order_not_mailable_at_send'::text, 'bank_order_snapshot_stale'::text, 'recipient_stale_at_send'::text])))) AND (o.order_source IS NULL OR (o.order_source <> ALL (ARRAY['manual_phone'::text, 'manual_line'::text, 'manual_other'::text])) OR NULLIF(btrim(o.notification_email, pcm_js_trim_whitespace()), ''::text) IS NOT NULL);

-- ── pcm_shipped_email_unsendable(回到 md5 62c1cd2dac00403d122841812f2d92f9)──
CREATE OR REPLACE VIEW public.pcm_shipped_email_unsendable
  WITH (security_invoker = true) AS
 SELECT DISTINCT s.id AS shipment_id,
    s.shipment_reference,
    s.shipped_at,
    o.id AS order_id,
    o.display_id
   FROM shipments s
     JOIN shipment_items si ON si.shipment_id = s.id
     JOIN order_items oi ON oi.id = si.order_item_id
     JOIN orders o ON o.id = oi.order_id
     LEFT JOIN customers c ON c.user_id = o.customer_user_id
  WHERE s.shipped_at IS NOT NULL AND s.deleted_at IS NULL AND NULLIF(btrim(o.notification_email, pcm_js_trim_whitespace()), ''::text) IS NULL AND NULLIF(btrim(c.email, pcm_js_trim_whitespace()), ''::text) IS NULL AND NOT (EXISTS ( SELECT 1
           FROM email_outbox e
          WHERE e.event_type = 'order_shipped'::text AND e.dedup_key = pcm_shipped_email_dedup_key(s.id, o.id)));

-- ── pcm_tracking_correction_candidates(回到 md5 a44dc28eca126b9296d8a084d7e863eb)──
CREATE OR REPLACE VIEW public.pcm_tracking_correction_candidates
  WITH (security_invoker = true) AS
 SELECT DISTINCT s.id AS shipment_id,
    s.shipment_reference,
    s.tracking_number,
    s.carrier_code,
    s.tracking_corrected_at,
    pcm_tracking_corrected_at_key(s.tracking_corrected_at) AS corrected_at_key,
    o.id AS order_id,
    o.display_id,
    o.notification_email,
    c.email AS customer_email,
    o.order_source
   FROM shipments s
     JOIN shipment_items si ON si.shipment_id = s.id
     JOIN order_items oi ON oi.id = si.order_item_id
     JOIN orders o ON o.id = oi.order_id
     LEFT JOIN customers c ON c.user_id = o.customer_user_id
  WHERE s.shipped_at IS NOT NULL AND s.deleted_at IS NULL AND s.tracking_corrected_at IS NOT NULL AND NULLIF(btrim(s.tracking_number, pcm_js_trim_whitespace()), ''::text) IS NOT NULL AND
        CASE
            WHEN (( SELECT last.sent_tracking_recorded
               FROM email_outbox last
              WHERE last.status = 'sent'::text AND last.sent_at IS NOT NULL AND (last.event_type = ANY (ARRAY['order_shipped'::text, 'shipment_tracking_corrected'::text])) AND last.order_id = o.id AND pcm_safe_uuid(last.payload ->> 'shipment_id'::text) = s.id
              ORDER BY last.sent_seq DESC NULLS LAST, last.sent_at DESC
             LIMIT 1)) IS TRUE THEN (( SELECT last.sent_tracking_number
               FROM email_outbox last
              WHERE last.status = 'sent'::text AND last.sent_at IS NOT NULL AND (last.event_type = ANY (ARRAY['order_shipped'::text, 'shipment_tracking_corrected'::text])) AND last.order_id = o.id AND pcm_safe_uuid(last.payload ->> 'shipment_id'::text) = s.id
              ORDER BY last.sent_seq DESC NULLS LAST, last.sent_at DESC
             LIMIT 1)) IS DISTINCT FROM NULLIF(btrim(s.tracking_number, pcm_js_trim_whitespace()), ''::text)
            ELSE (EXISTS ( SELECT 1
               FROM email_outbox e0
              WHERE e0.event_type = 'order_shipped'::text AND e0.dedup_key = pcm_shipped_email_dedup_key(s.id, o.id) AND e0.status = 'sent'::text AND e0.sent_at IS NOT NULL AND e0.sent_at < s.tracking_corrected_at))
        END AND NOT (EXISTS ( SELECT 1
           FROM email_outbox e
          WHERE e.event_type = 'shipment_tracking_corrected'::text AND e.dedup_key = pcm_tracking_corrected_dedup_key(s.id, o.id, s.tracking_corrected_at) AND (COALESCE(e.last_error_code, ''::text) <> ALL (ARRAY['shipment_voided'::text, 'tracking_superseded'::text, 'bank_order_not_mailable_at_send'::text, 'bank_order_snapshot_stale'::text, 'recipient_stale_at_send'::text])))) AND (o.order_source IS NULL OR (o.order_source <> ALL (ARRAY['manual_phone'::text, 'manual_line'::text, 'manual_other'::text])) OR NULLIF(btrim(o.notification_email, pcm_js_trim_whitespace()), ''::text) IS NOT NULL);

DO $post$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.pcm_shipped_email_pending', '35a84501cbc8c366459e3fcd8e61c8f4'),
      ('public.pcm_shipped_email_unsendable', '62c1cd2dac00403d122841812f2d92f9'),
      ('public.pcm_tracking_correction_candidates', 'a44dc28eca126b9296d8a084d7e863eb')
    ) AS x(rel, want) LOOP
    IF pg_catalog.md5(pg_catalog.pg_get_viewdef(r.rel::regclass, true)) <> r.want THEN
      RAISE EXCEPTION '後置閘:% 沒有回到原本那一代(md5 對不上)', r.rel;
    END IF;
    IF NOT (SELECT 'security_invoker=true' = ANY (c.reloptions) FROM pg_catalog.pg_class c WHERE c.oid = r.rel::regclass) THEN
      RAISE EXCEPTION '後置閘:% 的 security_invoker 不是 true', r.rel;
    END IF;
  END LOOP;
  RAISE NOTICE '✅ 20260916020000 rollback:三張 view 回到原 md5';
END
$post$;

COMMIT;
