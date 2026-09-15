-- 20260916020000_m4b_p01_shipped_email_views_require_clearance.sql
-- M-4b · P0-1 片 3:出貨信 / 缺收件人 / 改單號信的掃描面要有出貨資格證明(plan docs/plans/2026-09-15-card-refund-cancel-blocks-shipping-plan.md §3.3 片 3 §6)
--
-- ══ 為什麼 ═════════════════════════════════════════════════
-- 出貨在先、取消在後 ⇒ 照寄;取消在先 ⇒ 不寄(主視窗裁 ⑥, 2026-09-15 收窄:既有 SUPPRESS_WHEN_ORDER_INELIGIBLE 照擋)。
-- 時間戳是交易開始時間, 比不出先後(codex plan R2 ⑥)⇒ 以片 1a 的 shipment_order_ship_clearances「出貨那一刻這張單可以出」為準。
--
-- ══ 做什麼 ═════════════════════════════════════════════════
-- ① 補回填(與 20260915230000 同一段、同一道「取消早於交出 ⇒ 停」):1a 貼了到 1b 貼之間出貨的箱沒有寫入端。
-- ② 覆蓋率閘:未作廢且 shipped_at 或 hct_dispatch_attempted_at 有值的(箱, 單)都要有證明;缺一組就停(plan §6)。
-- ③ 三張 view 加同一句 EXISTS(證明):
--      pcm_shipped_email_pending(20260907230000 那一代)
--      pcm_shipped_email_unsendable(20260905040000 那一代)——缺收件人計數與 pending 同一套資格
--      pcm_tracking_correction_candidates(20260914090000 第三代)——pending 與 get_tracking_corrected_gap_counts 從它衍生, 不動
--    欄位清單一欄不動;定義本體照線上 pg_get_viewdef 逐字, 只多一句。
--
-- ══ 部署 ═══════════════════════════════════════════════════
-- 片 1a → 片 1b(同次連續)→ 片 2 → 本檔 → 片 4 的 TS。前置閘要求 1a、1b 已貼。
--
-- ══ 回滾 ═══════════════════════════════════════════════════
-- supabase/rollbacks/20260916020000-rollback.sql:三張 view 回線上那一代逐字;證明列保留(append-only 事實紀錄)。

BEGIN;
SET LOCAL lock_timeout = '5s';
-- 回填集合要凍住(同 1a):shipments 與 shipment_items 擋寫入。
LOCK TABLE public.shipments IN SHARE MODE;
LOCK TABLE public.shipment_items IN SHARE MODE;

-- ── 前置閘 ────────────────────────────────────────────────────
DO $pre$
DECLARE
  v_def  text;
  v_cols text[];
  v_sp   text := pg_catalog.current_setting('search_path');
  r      record;
BEGIN
  -- 🔴 完整定義要是線上那一代(codex 片 3 R1 must-fix 2):只驗特徵字面擋不住「保留字面、改了一個條件」的漂移, 覆蓋會把那次修正吃掉。
  --    基準 = md5(pg_get_viewdef(…, true)), 2026-09-15 正式庫(PostgreSQL 17.6)與 Q41 schema 庫(17.10)實量逐字相同。
  --    pg_get_viewdef 的輸出依 search_path 決定帶不帶 schema 前綴 ⇒ 暫時固定成 public, pg_catalog 再算, 算完還原。
  PERFORM pg_catalog.set_config('search_path', 'public, pg_catalog', true);
  FOR r IN SELECT * FROM (VALUES
      ('public.pcm_shipped_email_pending',           '35a84501cbc8c366459e3fcd8e61c8f4'),
      ('public.pcm_shipped_email_unsendable',        '62c1cd2dac00403d122841812f2d92f9'),
      ('public.pcm_tracking_correction_candidates',  'a44dc28eca126b9296d8a084d7e863eb')
    ) AS x(rel, want) LOOP
    IF pg_catalog.to_regclass(r.rel) IS NULL THEN
      RAISE EXCEPTION '前置閘零:% 不存在', r.rel;
    END IF;
    IF pg_catalog.md5(pg_catalog.pg_get_viewdef(r.rel::regclass, true)) <> r.want THEN
      RAISE EXCEPTION '前置閘零:% 的完整定義不是 2026-09-15 線上那一代(md5 對不上)⇒ 有人改過或已經貼過, 覆蓋會吃掉那次修正;停下人工對齊', r.rel;
    END IF;
  END LOOP;
  PERFORM pg_catalog.set_config('search_path', v_sp, true);

  IF pg_catalog.to_regclass('public.shipment_order_ship_clearances') IS NULL THEN
    RAISE EXCEPTION '前置閘一:片 1a 還沒貼(shipment_order_ship_clearances 不在)';
  END IF;
  IF pg_catalog.to_regprocedure('public.pcm_p01_write_clearances(uuid,text)') IS NULL THEN
    RAISE EXCEPTION '前置閘二:片 1b 還沒貼(pcm_p01_write_clearances 不在)⇒ 出貨還不會寫證明, 改 view 會吞掉新出貨的信';
  END IF;

  -- 三張 view:存在、還沒讀證明、是預期那一代(獨有字面)、欄位清單逐欄相同
  v_def := pg_catalog.pg_get_viewdef('public.pcm_shipped_email_pending'::regclass, true);
  IF pg_catalog.strpos(v_def, 'shipment_order_ship_clearances') > 0 THEN
    RAISE EXCEPTION '前置閘三:pcm_shipped_email_pending 已經讀證明 ⇒ 本檔貼過了';
  END IF;
  IF pg_catalog.strpos(v_def, 'recipient_stale_at_send') = 0 OR pg_catalog.strpos(v_def, 'manual_phone') = 0 THEN
    RAISE EXCEPTION '前置閘三:pcm_shipped_email_pending 不是 20260907230000 那一代(少了 recipient_stale_at_send 或手動單那段)⇒ 停下來看一眼';
  END IF;
  SELECT pg_catalog.array_agg(a.attname::text ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'public.pcm_shipped_email_pending'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols IS DISTINCT FROM ARRAY['shipment_id','shipment_reference','shipped_at','order_id','display_id','notification_email','customer_email','order_source']::text[] THEN
    RAISE EXCEPTION '前置閘三:pcm_shipped_email_pending 欄位清單不是這一版(線上=%)', v_cols;
  END IF;

  v_def := pg_catalog.pg_get_viewdef('public.pcm_shipped_email_unsendable'::regclass, true);
  IF pg_catalog.strpos(v_def, 'shipment_order_ship_clearances') > 0 THEN
    RAISE EXCEPTION '前置閘四:pcm_shipped_email_unsendable 已經讀證明 ⇒ 本檔貼過了';
  END IF;
  IF pg_catalog.strpos(v_def, 'pcm_js_trim_whitespace') = 0 OR pg_catalog.strpos(v_def, 'IS NULL AND NULLIF') = 0 THEN
    RAISE EXCEPTION '前置閘四:pcm_shipped_email_unsendable 不是 20260905040000 那一代 ⇒ 停下來看一眼';
  END IF;
  SELECT pg_catalog.array_agg(a.attname::text ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'public.pcm_shipped_email_unsendable'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols IS DISTINCT FROM ARRAY['shipment_id','shipment_reference','shipped_at','order_id','display_id']::text[] THEN
    RAISE EXCEPTION '前置閘四:pcm_shipped_email_unsendable 欄位清單不是這一版(線上=%)', v_cols;
  END IF;

  v_def := pg_catalog.pg_get_viewdef('public.pcm_tracking_correction_candidates'::regclass, true);
  IF pg_catalog.strpos(v_def, 'shipment_order_ship_clearances') > 0 THEN
    RAISE EXCEPTION '前置閘五:pcm_tracking_correction_candidates 已經讀證明 ⇒ 本檔貼過了';
  END IF;
  IF pg_catalog.strpos(v_def, 'sent_tracking_recorded') = 0 OR pg_catalog.strpos(v_def, 'manual_phone') = 0 OR pg_catalog.strpos(v_def, 'recipient_stale_at_send') = 0 THEN
    RAISE EXCEPTION '前置閘五:pcm_tracking_correction_candidates 不是 20260914090000 第三代 ⇒ 停下來看一眼(抄到舊代會把已修的漏寄帶回來)';
  END IF;
  SELECT pg_catalog.array_agg(a.attname::text ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'public.pcm_tracking_correction_candidates'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols IS DISTINCT FROM ARRAY['shipment_id','shipment_reference','tracking_number','carrier_code','tracking_corrected_at','corrected_at_key','order_id','display_id','notification_email','customer_email','order_source']::text[] THEN
    RAISE EXCEPTION '前置閘五:pcm_tracking_correction_candidates 欄位清單不是這一版(線上=%)', v_cols;
  END IF;
END
$pre$;

-- ── ① 補回填(與 20260915230000 同形)──────────────────────────
-- 🔴 先鎖「還沒有證明」的組合所屬的訂單, 鎖後才讀 cancelled_at(codex 片 3 R1 must-fix 1):
--    本片沒有建 FK 那一類會連帶鎖 orders 的 DDL(1a 有)⇒ 不鎖的話, 一個正在提交中的取消會被讀成「沒取消」而被寫成證明。
--    依 id 排序 FOR SHARE:與取消的 FOR UPDATE、退款匯流點的 FOR NO KEY UPDATE 互斥;等不到(5s)⇒ 整支失敗, 稍後重貼。
--    集合穩定:shipments / shipment_items 上面已鎖 SHARE, 箱與品項不會變。
DO $lock_orders$
BEGIN
  PERFORM 1
     FROM public.orders o
    WHERE o.id IN (SELECT DISTINCT oi.order_id
                     FROM public.shipments s
                     JOIN public.shipment_items si ON si.shipment_id = s.id
                     JOIN public.order_items oi ON oi.id = si.order_item_id
                    WHERE (s.shipped_at IS NOT NULL OR s.hct_dispatch_attempted_at IS NOT NULL)
                      AND NOT EXISTS (SELECT 1 FROM public.shipment_order_ship_clearances k
                                       WHERE k.shipment_id = s.id AND k.order_id = oi.order_id))
    ORDER BY o.id
      FOR SHARE;
END
$lock_orders$;

CREATE TEMPORARY TABLE p01_rebackfill_pairs ON COMMIT DROP AS
SELECT DISTINCT s.id AS shipment_id, oi.order_id,
       COALESCE(s.hct_dispatch_attempted_at, s.shipped_at) AS handed_at,
       o.cancelled_at
  FROM public.shipments s
  JOIN public.shipment_items si ON si.shipment_id = s.id
  JOIN public.order_items oi ON oi.id = si.order_item_id
  JOIN public.orders o ON o.id = oi.order_id
 WHERE s.shipped_at IS NOT NULL OR s.hct_dispatch_attempted_at IS NOT NULL;

DO $rebackfill_gate$
DECLARE
  v_bad bigint;
BEGIN
  -- 只看還沒有證明的組合:已有證明的是出貨 RPC 持鎖判準通過時寫的(1b), 之後才取消的單不算違規。
  SELECT pg_catalog.count(*) INTO v_bad
    FROM p01_rebackfill_pairs p
   WHERE p.cancelled_at IS NOT NULL AND p.cancelled_at < p.handed_at
     AND NOT EXISTS (SELECT 1 FROM public.shipment_order_ship_clearances k
                      WHERE k.shipment_id = p.shipment_id AND k.order_id = p.order_id);
  IF v_bad > 0 THEN
    RAISE EXCEPTION '補回填閘:有 % 組(箱, 單)沒有證明且取消時間早於交出時間 ⇒ 不知道該不該寄出貨信, 停下人工看', v_bad;
  END IF;
END
$rebackfill_gate$;

INSERT INTO public.shipment_order_ship_clearances (shipment_id, order_id, cleared_via, cleared_at)
SELECT p.shipment_id, p.order_id, 'backfill', p.handed_at
  FROM p01_rebackfill_pairs p
ON CONFLICT (shipment_id, order_id) DO NOTHING;

-- ── ② 覆蓋率閘 ────────────────────────────────────────────────
DO $coverage$
DECLARE
  v_missing bigint;
BEGIN
  SELECT pg_catalog.count(*) INTO v_missing
    FROM (SELECT DISTINCT s.id AS shipment_id, oi.order_id
            FROM public.shipments s
            JOIN public.shipment_items si ON si.shipment_id = s.id
            JOIN public.order_items oi ON oi.id = si.order_item_id
           WHERE s.deleted_at IS NULL
             AND (s.shipped_at IS NOT NULL OR s.hct_dispatch_attempted_at IS NOT NULL)) x
   WHERE NOT EXISTS (SELECT 1 FROM public.shipment_order_ship_clearances k
                      WHERE k.shipment_id = x.shipment_id AND k.order_id = x.order_id);
  IF v_missing > 0 THEN
    RAISE EXCEPTION '覆蓋率閘:% 組未作廢且已出貨 / 叫過車的(箱, 單)沒有出貨資格證明 ⇒ 改 view 會把它們的信靜默擋掉, 停下(plan §6)', v_missing;
  END IF;
END
$coverage$;

-- ── ③-a 出貨信掃描面 ──────────────────────────────────────────
CREATE OR REPLACE VIEW public.pcm_shipped_email_pending
  WITH (security_invoker = true) AS
SELECT DISTINCT
  s.id                 AS shipment_id,
  s.shipment_reference AS shipment_reference,
  s.shipped_at         AS shipped_at,
  o.id                 AS order_id,
  o.display_id         AS display_id,
  o.notification_email AS notification_email,
  c.email              AS customer_email,
  o.order_source       AS order_source
FROM public.shipments s
JOIN public.shipment_items si ON si.shipment_id = s.id
JOIN public.order_items oi ON oi.id = si.order_item_id
JOIN public.orders o ON o.id = oi.order_id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE s.shipped_at IS NOT NULL
  AND s.deleted_at IS NULL
  AND (
        nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      )
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.event_type = 'order_shipped'
           AND e.dedup_key = public.pcm_shipped_email_dedup_key(s.id, o.id)
           AND COALESCE(e.last_error_code, '') NOT IN (
                 'shipment_voided',
                 'tracking_superseded',
                 'bank_order_not_mailable_at_send',
                 'bank_order_snapshot_stale',
                 'recipient_stale_at_send'
               ))
  AND (
        o.order_source IS NULL
     OR o.order_source NOT IN ('manual_phone', 'manual_line', 'manual_other')
     OR nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      )
  -- 🔴 P0-1 片 3:出貨那一刻這張單可以出(1b 的 claim / mark_shipped 持鎖判準通過才寫;舊資料由 1a 與本檔回填)
  AND EXISTS (SELECT 1 FROM public.shipment_order_ship_clearances k
               WHERE k.shipment_id = s.id AND k.order_id = o.id);

-- ── ③-b 缺收件人計數面 ────────────────────────────────────────
CREATE OR REPLACE VIEW public.pcm_shipped_email_unsendable
  WITH (security_invoker = true) AS
SELECT DISTINCT
  s.id                 AS shipment_id,
  s.shipment_reference AS shipment_reference,
  s.shipped_at         AS shipped_at,
  o.id                 AS order_id,
  o.display_id         AS display_id
FROM public.shipments s
JOIN public.shipment_items si ON si.shipment_id = s.id
JOIN public.order_items oi ON oi.id = si.order_item_id
JOIN public.orders o ON o.id = oi.order_id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE s.shipped_at IS NOT NULL
  AND s.deleted_at IS NULL
  AND nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NULL
  AND nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NULL
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.event_type = 'order_shipped'
           AND e.dedup_key = public.pcm_shipped_email_dedup_key(s.id, o.id))
  -- 🔴 P0-1 片 3:缺收件人計數與 pending 同一套資格(codex plan R1 ⑧)——沒有證明的信本來就不寄, 不該被當成缺收件人告警
  AND EXISTS (SELECT 1 FROM public.shipment_order_ship_clearances k
               WHERE k.shipment_id = s.id AND k.order_id = o.id);

-- ── ③-c 改單號信規則底面 ──────────────────────────────────────
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
           AND COALESCE(e.last_error_code, '') NOT IN (
                 'shipment_voided',
                 'tracking_superseded',
                 'bank_order_not_mailable_at_send',
                 'bank_order_snapshot_stale',
                 'recipient_stale_at_send'
               ))
  AND (
        o.order_source IS NULL
     OR o.order_source NOT IN ('manual_phone', 'manual_line', 'manual_other')
     OR nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      )
  -- 🔴 P0-1 片 3:規則住在底面(20260914090000 COMMENT「要改判準改這裡」)⇒ pending 與 gap counts 自動跟上
  AND EXISTS (SELECT 1 FROM public.shipment_order_ship_clearances k
               WHERE k.shipment_id = s.id AND k.order_id = o.id);

-- ── 後置閘 ────────────────────────────────────────────────────
DO $post$
DECLARE
  v_rel text;
BEGIN
  FOREACH v_rel IN ARRAY ARRAY['public.pcm_shipped_email_pending', 'public.pcm_shipped_email_unsendable', 'public.pcm_tracking_correction_candidates'] LOOP
    IF pg_catalog.strpos(pg_catalog.pg_get_viewdef(v_rel::regclass, true), 'shipment_order_ship_clearances') = 0 THEN
      RAISE EXCEPTION '後置閘一:% 沒有讀出貨資格證明', v_rel;
    END IF;
    IF NOT (SELECT 'security_invoker=true' = ANY (c.reloptions) FROM pg_catalog.pg_class c WHERE c.oid = v_rel::regclass) THEN
      RAISE EXCEPTION '後置閘二:% 的 security_invoker 不是 true', v_rel;
    END IF;
    IF pg_catalog.has_table_privilege('anon', v_rel, 'SELECT') OR pg_catalog.has_table_privilege('authenticated', v_rel, 'SELECT') THEN
      RAISE EXCEPTION '後置閘三:% 對 anon / authenticated 開著 SELECT', v_rel;
    END IF;
  END LOOP;
  -- invoker view 用【呼叫者】權限跑裡面的函式與表 ⇒ 量出寄信掃描的身分(service_role)叫得動每一支、讀得到證明表
  --    (invoker-view-execute-gate:GRANT 是寫的動作, 這裡是量到的結果)。
  IF NOT pg_catalog.has_function_privilege('service_role', 'public.pcm_js_trim_whitespace()'::regprocedure, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.pcm_safe_uuid(text)'::regprocedure, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.pcm_shipped_email_dedup_key(uuid,uuid)'::regprocedure, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.pcm_tracking_corrected_at_key(timestamp with time zone)'::regprocedure, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.pcm_tracking_corrected_dedup_key(uuid,uuid,timestamp with time zone)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘五:service_role 叫不動三張 invoker view 裡的某支函式 ⇒ 寄信掃描會一次錯一次';
  END IF;
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.shipment_order_ship_clearances', 'SELECT') THEN
    RAISE EXCEPTION '後置閘五:service_role 讀不到 shipment_order_ship_clearances ⇒ 三張 view 會報錯';
  END IF;
  -- pending 仍讀底面(本檔沒動它)
  IF pg_catalog.strpos(pg_catalog.pg_get_viewdef('public.pcm_tracking_corrected_email_pending'::regclass, true), 'pcm_tracking_correction_candidates') = 0 THEN
    RAISE EXCEPTION '後置閘四:pcm_tracking_corrected_email_pending 不再讀底面 ⇒ 規則分岔了';
  END IF;
  RAISE NOTICE '✅ 20260916020000 後置閘全過:三張 view 讀證明、security_invoker、無 anon/authenticated SELECT;證明 % 列',
    (SELECT pg_catalog.count(*) FROM public.shipment_order_ship_clearances);
END
$post$;

COMMIT;
