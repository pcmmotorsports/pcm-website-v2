-- ============================================================
-- 退貨收回 第 1 片:兩張表 + 三支函式(登記退貨 / 確認收到 / 作廢登記)
-- ============================================================
-- plan:docs/plans/2026-09-27-order-returns.md(Sean 2026-09-27 Q1 甲 只做退貨退款 / Q2 甲 系統帶建議金額 / Q3 甲 不接新竹逆物流)
-- 退回檔:supabase/rollbacks/20260927010000-rollback.sql
--
-- 流程(Sean 08-13 §0-I 兩段式:先收到貨再退錢):
--   ① admin_register_return  登記退貨(客人說要退、貨還沒回來)⇒ status = registered
--   ② admin_receive_return   確認收到退貨(逐項填實收數量與狀況)⇒ status = received
--   ③ 退款走既有的退款流程(第 3 片接);本片不動錢、不動 orders 任何欄位。
--   作廢:只有 registered 可以作廢(登記錯了 / 客人沒寄回)⇒ status = voided。已收回的不能作廢。
--
-- ══ 形狀 ═══════════════════════════════════════════════════════
-- · 只有「已出貨」的數量能退:上限 = order_item_quantity_summary.shipped_quantity(B2-S2b 重算維護,
--   只認 shipped_at IS NOT NULL AND deleted_at IS NULL 的包裹)− 已占用的退貨數量。
--   已占用 = 沒作廢的退貨:received 算實收數量、registered 算登記數量。
-- · 並發:先鎖訂單列(FOR UPDATE,與 admin_cancel_order 同一個起點),再依 id 排序鎖品項列
--   (FOR NO KEY UPDATE, 與摘要重算同一把鎖)⇒ 同一張單的兩次登記排隊;作廢包裹的重算會與這裡互等而不是讀到舊值。
-- · 冪等:登記用 (order_id, idempotency_key) + payload_hash(同 order_cancellations);
--   收到 / 作廢是狀態轉移, 重送時以 admin_audit_log 的 request_id 認出是同一次。
-- · 表 ⇒ anon / authenticated 零權限;service_role 只有 SELECT(後台讀畫面用), 寫入只能經三支函式。
-- · 三支函式 SECURITY DEFINER、search_path 空字串、只給 service_role(docs/patterns/revoking-function-execute-in-supabase.md)。
--
-- ══ 已知不擋的事(誠實邊界, 審查請看)══════════════════════════════
-- · 已登記退貨的包裹之後被「作廢出貨」⇒ 已出貨數量變少, 可能小於已退數量。本片不改出貨函式, 只在
--   下一次登記時擋(上限變成負數 ⇒ 任何數量都登記不了)。第 2 片畫面要顯示這種單。
-- · 「表頭 received ⇔ 每個品項都有實收數量」只由 admin_receive_return 保證, DB 沒有跨表 CHECK。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.order_returns') IS NOT NULL
     OR pg_catalog.to_regclass('public.order_return_items') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘①:order_returns / order_return_items 已存在 ⇒ 停(可能已貼過)。';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public'
                AND p.proname IN ('admin_register_return', 'admin_receive_return', 'admin_void_return')) THEN
    RAISE EXCEPTION '前置閘②:已有退貨函式 ⇒ 停(可能已貼過)。';
  END IF;
  IF pg_catalog.to_regclass('public.order_item_quantity_summary') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                     WHERE a.attrelid = 'public.order_item_quantity_summary'::regclass
                       AND a.attname = 'shipped_quantity' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION '前置閘③:order_item_quantity_summary.shipped_quantity 不存在 ⇒ 停(可退上限的來源不在)。';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                  WHERE c.conrelid = 'public.order_items'::regclass AND c.conname = 'order_items_order_id_id_key') THEN
    RAISE EXCEPTION '前置閘④:order_items_order_id_id_key 不存在 ⇒ 停(品項外鍵要掛它)。';
  END IF;
END
$pre$;

-- ── 表 ──────────────────────────────────────────────────────────

CREATE TABLE public.order_returns (
  id                     uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  order_id               uuid        NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  status                 text        NOT NULL DEFAULT 'registered',
  reason_code            text        NOT NULL,
  reason_detail          text,
  note                   text,
  return_tracking_number text,
  registered_by          text        NOT NULL,
  registered_at          timestamptz NOT NULL DEFAULT pg_catalog.now(),
  received_by            text,
  received_at            timestamptz,
  receive_note           text,
  voided_by              text,
  voided_at              timestamptz,
  void_reason            text,
  idempotency_key        uuid        NOT NULL,
  payload_hash           text        NOT NULL,
  CONSTRAINT order_returns_status_check
    CHECK (status IN ('registered', 'received', 'voided')),
  CONSTRAINT order_returns_reason_code_check
    CHECK (reason_code IN ('defective', 'wrong_item', 'changed_mind', 'other')),
  CONSTRAINT order_returns_other_needs_detail
    CHECK (reason_code <> 'other' OR pg_catalog.btrim(coalesce(reason_detail, '')) <> ''),
  CONSTRAINT order_returns_registered_by_nonblank
    CHECK (pg_catalog.btrim(registered_by) <> ''),
  CONSTRAINT order_returns_received_pair
    CHECK ((status = 'received') = (received_at IS NOT NULL)
           AND (received_at IS NULL) = (received_by IS NULL)),
  CONSTRAINT order_returns_voided_pair
    CHECK ((status = 'voided') = (voided_at IS NOT NULL)
           AND (voided_at IS NULL) = (voided_by IS NULL)
           AND (voided_at IS NULL) = (void_reason IS NULL)),
  CONSTRAINT order_returns_idempotency_key UNIQUE (order_id, idempotency_key),
  CONSTRAINT order_returns_id_order_id_key UNIQUE (id, order_id)
);
CREATE INDEX order_returns_order_id_idx ON public.order_returns (order_id);

CREATE TABLE public.order_return_items (
  id                uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  return_id         uuid        NOT NULL,
  order_id          uuid        NOT NULL,
  order_item_id     uuid        NOT NULL,
  quantity          integer     NOT NULL,
  received_quantity integer,
  condition         text,
  created_at        timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT order_return_items_return_fk
    FOREIGN KEY (return_id, order_id)
    REFERENCES public.order_returns (id, order_id) ON DELETE RESTRICT,
  CONSTRAINT order_return_items_order_item_fk
    FOREIGN KEY (order_id, order_item_id)
    REFERENCES public.order_items (order_id, id) ON DELETE RESTRICT,
  CONSTRAINT order_return_items_return_item_key UNIQUE (return_id, order_item_id),
  CONSTRAINT order_return_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT order_return_items_received_range
    CHECK (received_quantity IS NULL OR (received_quantity >= 0 AND received_quantity <= quantity)),
  CONSTRAINT order_return_items_condition_check
    CHECK (condition IS NULL OR condition IN ('good', 'damaged')),
  CONSTRAINT order_return_items_condition_pair
    CHECK ((condition IS NOT NULL) = (coalesce(received_quantity, 0) > 0))
);
CREATE INDEX order_return_items_order_item_idx ON public.order_return_items (order_item_id);

COMMENT ON TABLE public.order_returns IS
  '退貨收回(20260927010000)。一次退貨登記一列:registered 登記(等商品寄回)→ received 已收回;registered 可作廢成 voided。不動錢、不動 orders;退款走既有退款流程。寫入只經 admin_register_return / admin_receive_return / admin_void_return(僅 service_role)。';
COMMENT ON TABLE public.order_return_items IS
  '退貨品項(20260927010000)。quantity = 登記數量;received_quantity / condition 在確認收到時填(good 良好 / damaged 有損傷;實收 0 件時 condition 為 NULL)。order_id 是冗餘欄, 讓兩道複合外鍵夾住「品項必須屬於同一張訂單」(同 order_cancellation_items)。';
COMMENT ON COLUMN public.order_return_items.received_quantity IS
  '實收數量。沒作廢的退貨占用的可退數量:received 用本欄、registered 用 quantity。入庫只留紀錄, 不會變成可出貨庫存(Sean 08-13 §0-I)。';

ALTER TABLE public.order_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_return_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_returns_service_role_select ON public.order_returns
  FOR SELECT TO service_role USING (true);
CREATE POLICY order_return_items_service_role_select ON public.order_return_items
  FOR SELECT TO service_role USING (true);
REVOKE ALL ON TABLE public.order_returns FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.order_return_items FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.order_returns TO service_role;
GRANT SELECT ON TABLE public.order_return_items TO service_role;

-- ── ① 登記退貨 ───────────────────────────────────────────────────
-- p_items = [{"order_item_id": "<uuid>", "quantity": <正整數>}, ...]
CREATE FUNCTION public.admin_register_return(
  p_order_id        uuid,
  p_idempotency_key uuid,
  p_actor           text,
  p_reason_code     text,
  p_reason_detail   text,
  p_note            text,
  p_tracking_number text,
  p_items           jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $fn$
DECLARE
  v_detail    text := nullif(pg_catalog.btrim(p_reason_detail), '');
  v_note      text := nullif(pg_catalog.btrim(p_note), '');
  v_tracking  text := nullif(pg_catalog.btrim(p_tracking_number), '');
  v_canon     text;
  v_hash      text;
  v_existing  record;
  v_rid       uuid;
  v_n         integer;
  v_short     record;
  v_generic   constant text := '登記退貨失敗。請重新整理畫面後再試一次;若持續發生請回報系統管理員。';
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_register_return: isolation guard';
  END IF;
  IF p_order_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION '%', v_generic;
  END IF;
  IF pg_catalog.btrim(coalesce(p_actor, '')) = '' THEN
    RAISE EXCEPTION '登記退貨:缺少操作人員, 請重新登入後再試。';
  END IF;
  IF p_reason_code IS NULL OR p_reason_code NOT IN ('defective', 'wrong_item', 'changed_mind', 'other') THEN
    RAISE EXCEPTION '登記退貨:請選擇退貨原因。';
  END IF;
  IF p_reason_code = 'other' AND v_detail IS NULL THEN
    RAISE EXCEPTION '登記退貨:原因選「其他」時, 請填寫說明。';
  END IF;

  -- 品項格式(同 admin_cancel_order 的檢查)
  IF pg_catalog.jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '登記退貨:請至少選一個品項。';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
              WHERE pg_catalog.jsonb_typeof(el) <> 'object'
                 OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(el)) <> 2
                 OR NOT (el ? 'order_item_id') OR NOT (el ? 'quantity')
                 OR pg_catalog.jsonb_typeof(el->'order_item_id') <> 'string'
                 OR (el->>'order_item_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 OR pg_catalog.jsonb_typeof(el->'quantity') <> 'number'
                 OR (el->>'quantity') !~ '^[0-9]+$') THEN
    RAISE EXCEPTION '%', v_generic;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
              WHERE (el->>'quantity')::numeric < 1 OR (el->>'quantity')::numeric > 2147483647) THEN
    RAISE EXCEPTION '登記退貨:退貨數量要是 1 以上的整數。';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(p_items))
     <> (SELECT pg_catalog.count(DISTINCT (el->>'order_item_id')::uuid) FROM pg_catalog.jsonb_array_elements(p_items) e(el)) THEN
    RAISE EXCEPTION '%', v_generic;
  END IF;
  SELECT pg_catalog.string_agg(((el->>'order_item_id')::uuid)::text || '=' || ((el->>'quantity')::integer)::text,
                               ',' ORDER BY ((el->>'order_item_id')::uuid)::text)
    INTO v_canon
    FROM pg_catalog.jsonb_array_elements(p_items) e(el);
  v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    'ret:v1:' || p_order_id::text || ':' || p_reason_code || ':' || coalesce(v_detail, '')
      || ':' || coalesce(v_note, '') || ':' || coalesce(v_tracking, '') || ':' || v_canon,
    'UTF8')), 'hex');

  PERFORM 1 FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic;
  END IF;

  SELECT id, payload_hash, registered_by INTO v_existing
    FROM public.order_returns
   WHERE order_id = p_order_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.payload_hash IS DISTINCT FROM v_hash OR v_existing.registered_by IS DISTINCT FROM p_actor THEN
      RAISE EXCEPTION '%', v_generic;
    END IF;
    RETURN pg_catalog.jsonb_build_object('return_id', v_existing.id, 'idempotent', true);
  END IF;

  -- 每個品項都必須屬於這張訂單
  IF (SELECT pg_catalog.count(*) FROM public.order_items oi
       WHERE oi.order_id = p_order_id
         AND oi.id IN (SELECT (el->>'order_item_id')::uuid FROM pg_catalog.jsonb_array_elements(p_items) e(el)))
     <> pg_catalog.jsonb_array_length(p_items) THEN
    RAISE EXCEPTION '%', v_generic;
  END IF;

  -- 鎖品項列(FOR NO KEY UPDATE、依 id 排序)= 摘要重算 pcm_a4a_recompute_order_item_summary 用的同一把鎖
  --   ⇒ 作廢出貨的重算與這裡排隊;鎖到之後下一句重新取快照, 讀到的已出貨數量是別人提交後的值。
  PERFORM 1 FROM public.order_items oi
   WHERE oi.order_id = p_order_id
     AND oi.id IN (SELECT (el->>'order_item_id')::uuid FROM pg_catalog.jsonb_array_elements(p_items) e(el))
   ORDER BY oi.id
   FOR NO KEY UPDATE;

  SELECT x.want, x.shipped, x.taken INTO v_short
    FROM (
      SELECT (el->>'quantity')::bigint AS want,
             coalesce(q.shipped_quantity, 0)::bigint AS shipped,
             coalesce((SELECT pg_catalog.sum(CASE r.status WHEN 'received' THEN ri.received_quantity ELSE ri.quantity END)::bigint
                         FROM public.order_return_items ri
                         JOIN public.order_returns r ON r.id = ri.return_id
                        WHERE ri.order_item_id = (el->>'order_item_id')::uuid
                          AND r.status <> 'voided'), 0) AS taken
        FROM pg_catalog.jsonb_array_elements(p_items) e(el)
        LEFT JOIN public.order_item_quantity_summary q ON q.order_item_id = (el->>'order_item_id')::uuid
    ) x
   WHERE x.want > x.shipped - x.taken
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION '登記退貨:有品項的退貨數量超過可退數量(已出貨 % 件、已登記退貨 % 件, 這次要退 % 件)。請重新整理畫面確認出貨與退貨紀錄。',
      v_short.shipped, v_short.taken, v_short.want;
  END IF;

  INSERT INTO public.order_returns (order_id, reason_code, reason_detail, note, return_tracking_number,
                                    registered_by, idempotency_key, payload_hash)
  VALUES (p_order_id, p_reason_code, v_detail, v_note, v_tracking, p_actor, p_idempotency_key, v_hash)
  RETURNING id INTO v_rid;

  INSERT INTO public.order_return_items (return_id, order_id, order_item_id, quantity)
  SELECT v_rid, p_order_id, (el->>'order_item_id')::uuid, (el->>'quantity')::integer
    FROM pg_catalog.jsonb_array_elements(p_items) e(el);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> pg_catalog.jsonb_array_length(p_items) THEN
    RAISE EXCEPTION '%', v_generic;
  END IF;

  INSERT INTO public.admin_audit_log (actor, action, target, request_id, before, after, reason, source_app)
  VALUES (p_actor, 'order.return.register', 'order:' || p_order_id::text, p_idempotency_key::text,
          NULL,
          pg_catalog.jsonb_build_object('return_id', v_rid, 'return_status', 'registered', 'return_items', p_items),
          p_reason_code, 'admin');

  RETURN pg_catalog.jsonb_build_object('return_id', v_rid, 'idempotent', false);
END;
$fn$;

-- ── ② 確認收到退貨 ───────────────────────────────────────────────
-- p_items = [{"order_item_id": "<uuid>", "received_quantity": <0 以上整數>, "condition": "good" | "damaged" | null}, ...]
--   必須剛好涵蓋這筆退貨的每一個品項;實收 0 件時 condition 給 null;全部實收 0 件不收(請改用作廢)。
CREATE FUNCTION public.admin_receive_return(
  p_return_id  uuid,
  p_request_id uuid,
  p_actor      text,
  p_items      jsonb,
  p_note       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $fn$
DECLARE
  v_ret      record;
  v_n        integer;
  v_note     text := nullif(pg_catalog.btrim(p_note), '');
  v_generic  constant text := '確認收到退貨失敗。請重新整理畫面後再試一次;若持續發生請回報系統管理員。';
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_receive_return: isolation guard';
  END IF;
  IF p_return_id IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION '%', v_generic;
  END IF;
  IF pg_catalog.btrim(coalesce(p_actor, '')) = '' THEN
    RAISE EXCEPTION '確認收到退貨:缺少操作人員, 請重新登入後再試。';
  END IF;

  SELECT order_id INTO v_ret FROM public.order_returns WHERE id = p_return_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic;
  END IF;
  -- 鎖的順序與登記相同:先訂單、再這筆退貨
  PERFORM 1 FROM public.orders WHERE id = v_ret.order_id FOR UPDATE;
  SELECT id, order_id, status INTO v_ret FROM public.order_returns WHERE id = p_return_id FOR UPDATE;

  IF v_ret.status = 'received' THEN
    IF EXISTS (SELECT 1 FROM public.admin_audit_log g
                WHERE g.request_id = p_request_id::text AND g.action = 'order.return.receive'
                  AND g.target = 'order:' || v_ret.order_id::text AND g.actor = p_actor
                  AND (g.after->>'return_id')::uuid = p_return_id) THEN
      RETURN pg_catalog.jsonb_build_object('return_id', p_return_id, 'idempotent', true);
    END IF;
    RAISE EXCEPTION '確認收到退貨:這筆退貨已經確認收到過了, 不需要再確認一次。';
  END IF;
  IF v_ret.status <> 'registered' THEN
    RAISE EXCEPTION '確認收到退貨:這筆退貨登記已作廢, 不能再確認收到。';
  END IF;

  IF pg_catalog.jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION '%', v_generic;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
              WHERE pg_catalog.jsonb_typeof(el) <> 'object'
                 OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(el)) <> 3
                 OR NOT (el ? 'order_item_id') OR NOT (el ? 'received_quantity') OR NOT (el ? 'condition')
                 OR pg_catalog.jsonb_typeof(el->'order_item_id') <> 'string'
                 OR (el->>'order_item_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 OR pg_catalog.jsonb_typeof(el->'received_quantity') <> 'number'
                 OR (el->>'received_quantity') !~ '^[0-9]+$'
                 OR (el->>'received_quantity')::numeric > 2147483647
                 OR pg_catalog.jsonb_typeof(el->'condition') NOT IN ('string', 'null')) THEN
    RAISE EXCEPTION '%', v_generic;
  END IF;
  -- 必須剛好涵蓋這筆退貨的每一個品項(不多不少、不重複)
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(p_items))
       <> (SELECT pg_catalog.count(*) FROM public.order_return_items ri WHERE ri.return_id = p_return_id)
     OR EXISTS (SELECT 1 FROM public.order_return_items ri
                 WHERE ri.return_id = p_return_id
                   AND (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                         WHERE (el->>'order_item_id')::uuid = ri.order_item_id) <> 1) THEN
    RAISE EXCEPTION '%', v_generic;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
               JOIN public.order_return_items ri
                 ON ri.return_id = p_return_id AND ri.order_item_id = (el->>'order_item_id')::uuid
              WHERE (el->>'received_quantity')::integer > ri.quantity) THEN
    RAISE EXCEPTION '確認收到退貨:實收數量不能多於登記的退貨數量。';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
              WHERE ((el->>'received_quantity')::integer > 0) <> (pg_catalog.jsonb_typeof(el->'condition') = 'string')
                 OR (pg_catalog.jsonb_typeof(el->'condition') = 'string' AND (el->>'condition') NOT IN ('good', 'damaged'))) THEN
    RAISE EXCEPTION '確認收到退貨:有收到的品項請選擇商品狀況(良好或有損傷);沒收到的品項不用選。';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                  WHERE (el->>'received_quantity')::integer > 0) THEN
    RAISE EXCEPTION '確認收到退貨:所有品項都是 0 件。客人沒有寄回的話, 請改用「作廢退貨登記」。';
  END IF;

  UPDATE public.order_return_items ri
     SET received_quantity = (el->>'received_quantity')::integer,
         condition = el->>'condition'
    FROM pg_catalog.jsonb_array_elements(p_items) e(el)
   WHERE ri.return_id = p_return_id AND ri.order_item_id = (el->>'order_item_id')::uuid;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> pg_catalog.jsonb_array_length(p_items) THEN
    RAISE EXCEPTION '%', v_generic;
  END IF;

  UPDATE public.order_returns
     SET status = 'received', received_by = p_actor, received_at = pg_catalog.now(), receive_note = v_note
   WHERE id = p_return_id AND status = 'registered';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '%', v_generic;
  END IF;

  INSERT INTO public.admin_audit_log (actor, action, target, request_id, before, after, reason, source_app)
  VALUES (p_actor, 'order.return.receive', 'order:' || v_ret.order_id::text, p_request_id::text,
          pg_catalog.jsonb_build_object('return_id', p_return_id, 'return_status', 'registered'),
          pg_catalog.jsonb_build_object('return_id', p_return_id, 'return_status', 'received', 'return_items', p_items),
          NULL, 'admin');

  RETURN pg_catalog.jsonb_build_object('return_id', p_return_id, 'idempotent', false);
END;
$fn$;

-- ── ③ 作廢退貨登記 ───────────────────────────────────────────────
CREATE FUNCTION public.admin_void_return(
  p_return_id   uuid,
  p_request_id  uuid,
  p_actor       text,
  p_void_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $fn$
DECLARE
  v_ret      record;
  v_n        integer;
  v_reason   text := nullif(pg_catalog.btrim(p_void_reason), '');
  v_generic  constant text := '作廢退貨登記失敗。請重新整理畫面後再試一次;若持續發生請回報系統管理員。';
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_void_return: isolation guard';
  END IF;
  IF p_return_id IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION '%', v_generic;
  END IF;
  IF pg_catalog.btrim(coalesce(p_actor, '')) = '' THEN
    RAISE EXCEPTION '作廢退貨登記:缺少操作人員, 請重新登入後再試。';
  END IF;

  SELECT order_id INTO v_ret FROM public.order_returns WHERE id = p_return_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic;
  END IF;
  PERFORM 1 FROM public.orders WHERE id = v_ret.order_id FOR UPDATE;
  SELECT id, order_id, status INTO v_ret FROM public.order_returns WHERE id = p_return_id FOR UPDATE;

  IF v_ret.status = 'voided' THEN
    IF EXISTS (SELECT 1 FROM public.admin_audit_log g
                WHERE g.request_id = p_request_id::text AND g.action = 'order.return.void'
                  AND g.target = 'order:' || v_ret.order_id::text AND g.actor = p_actor
                  AND (g.after->>'return_id')::uuid = p_return_id) THEN
      RETURN pg_catalog.jsonb_build_object('return_id', p_return_id, 'idempotent', true);
    END IF;
    RAISE EXCEPTION '作廢退貨登記:這筆退貨登記已經作廢過了。';
  END IF;
  IF v_ret.status <> 'registered' THEN
    RAISE EXCEPTION '作廢退貨登記:這筆退貨已經確認收到, 不能作廢。';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION '作廢退貨登記:請填寫作廢原因。';
  END IF;

  UPDATE public.order_returns
     SET status = 'voided', voided_by = p_actor, voided_at = pg_catalog.now(), void_reason = v_reason
   WHERE id = p_return_id AND status = 'registered';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '%', v_generic;
  END IF;

  INSERT INTO public.admin_audit_log (actor, action, target, request_id, before, after, reason, source_app)
  VALUES (p_actor, 'order.return.void', 'order:' || v_ret.order_id::text, p_request_id::text,
          pg_catalog.jsonb_build_object('return_id', p_return_id, 'return_status', 'registered'),
          pg_catalog.jsonb_build_object('return_id', p_return_id, 'return_status', 'voided'),
          v_reason, 'admin');

  RETURN pg_catalog.jsonb_build_object('return_id', p_return_id, 'idempotent', false);
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_register_return(uuid, uuid, text, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_register_return(uuid, uuid, text, text, text, text, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_register_return(uuid, uuid, text, text, text, text, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.admin_receive_return(uuid, uuid, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_receive_return(uuid, uuid, text, jsonb, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_receive_return(uuid, uuid, text, jsonb, text) TO service_role;
REVOKE ALL ON FUNCTION public.admin_void_return(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_void_return(uuid, uuid, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_void_return(uuid, uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.admin_register_return(uuid, uuid, text, text, text, text, text, jsonb) IS
  '登記退貨(20260927010000)。只能退已出貨的數量(摘要表 shipped_quantity − 沒作廢的退貨占用)。同一個 idempotency_key 重送回同一筆。僅 service_role 可執行。';
COMMENT ON FUNCTION public.admin_receive_return(uuid, uuid, text, jsonb, text) IS
  '確認收到退貨(20260927010000)。逐項填實收數量與狀況, registered → received。同一個 request_id 重送不出錯。僅 service_role 可執行。';
COMMENT ON FUNCTION public.admin_void_return(uuid, uuid, text, text) IS
  '作廢退貨登記(20260927010000)。只有 registered 可以作廢, 要填原因。同一個 request_id 重送不出錯。僅 service_role 可執行。';

DO $post$
DECLARE
  r      text;
  v_cfg  text[];
  v_relations text[] := ARRAY['public.order_returns', 'public.order_return_items']::text[];
  v_functions text[] := ARRAY[
    'public.admin_register_return(uuid, uuid, text, text, text, text, text, jsonb)',
    'public.admin_receive_return(uuid, uuid, text, jsonb, text)',
    'public.admin_void_return(uuid, uuid, text, text)']::text[];
BEGIN
  FOREACH r IN ARRAY v_relations LOOP
    IF pg_catalog.to_regclass(r) IS NULL THEN
      RAISE EXCEPTION '事後閘⓪:斷言清單裡的 % 不存在 ⇒ 停。', r;
    END IF;
    IF has_table_privilege('anon', r, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_any_column_privilege('anon', r, 'SELECT,INSERT,UPDATE')
       OR has_table_privilege('authenticated', r, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_any_column_privilege('authenticated', r, 'SELECT,INSERT,UPDATE') THEN
      RAISE EXCEPTION '事後閘①:anon / authenticated 對 % 有權限 ⇒ 停。', r;
    END IF;
    IF has_table_privilege('service_role', r, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR NOT has_table_privilege('service_role', r, 'SELECT') THEN
      RAISE EXCEPTION '事後閘②:service_role 對 % 的權限不是「只有 SELECT」⇒ 停。', r;
    END IF;
  END LOOP;
  FOREACH r IN ARRAY v_functions LOOP
    IF pg_catalog.to_regprocedure(r) IS NULL THEN
      RAISE EXCEPTION '事後閘⓪:斷言清單裡的 % 不存在 ⇒ 停。', r;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', r, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', r, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', r, 'EXECUTE') THEN
      RAISE EXCEPTION '事後閘③:% 的 EXECUTE 不對(只該給 service_role)⇒ 停。', r;
    END IF;
    SELECT p.proconfig INTO v_cfg FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(r);
    IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(r))
       OR NOT ('search_path=""' = ANY (v_cfg)) THEN
      RAISE EXCEPTION '事後閘④:% 不是 SECURITY DEFINER 或 search_path 不是空字串(%)⇒ 停。', r, v_cfg;
    END IF;
  END LOOP;
  RAISE NOTICE '✅ 退貨兩張表與三支函式建好, 權限檢查通過。';
END
$post$;

COMMIT;
