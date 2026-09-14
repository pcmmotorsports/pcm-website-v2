-- 20260915050000_m4b_03_order_amount_requests.sql —— M-4b-03 改金額審核 · A 片(表 + 兩支 RPC)
--
-- 🛑 未貼(寫好不貼;貼是 Sean 一次一個編號)。plan `docs/plans/2026-09-14-m4b-03-amount-review-plan.md`(Sean 2026-09-14 批甲;Q1 不 LINE 推、Q2 一品項一條待審)。
--
-- ══ 這一支在解什麼 ═════════════════════════════════════════════════════
-- M-4b-01 P1 把「改品項單價」升成管理者紅線 ⇒ 員工完全改不了。本支補回「員工提、管理者核」那條路:
--   · 員工 `admin_request_order_item_amount(...)` ⇒ `order_amount_requests` 一列 pending + audit `order.item.amount.request`
--   · 管理者 `admin_review_order_item_amount(...)` approve ⇒ 同交易 PERFORM 既有 `admin_update_order_item_amount`(actor = 管理者, 用提案時的 version 當樂觀鎖)
--     回 'OK' 才標 approved;'CONFLICT' / 'NOOP' / RAISE ⇒ 整筆回滾, 申請留 pending, 訊息回給管理者。reject ⇒ rejected + note 必填。
--   · 核准前 orders / order_items 一字不動 ⇒ 客人那邊金額不變。
-- ══ 狀態機 ═══════════════════════════════════════════════════════════
--   pending ⇒ approved | rejected | superseded(單已取消時由 review RPC 標;不用 trigger 掃);三個終態不可再變。
--   一個品項同時只准一條 pending(部分唯一索引;主視窗 2026-09-14 裁 Q2 甲)。
-- ══ 權限 ═════════════════════════════════════════════════════════════
--   表:REVOKE 全部, service_role 只 SELECT(列表用)+ pcm_readonly SELECT;RLS enable + service_role 唯讀 policy;寫入全走 SECDEF RPC。
--   RPC:REVOKE 三道, EXECUTE 只給 service_role;review 那支內建管理者閘(mgr0 §12-3 形狀 '無權執行此操作')。
-- 回滾:supabase/rollbacks/20260915050000_down.sql(DROP 兩支 RPC + DROP TABLE;申請紀錄會掉, 回滾前先匯出)。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.order_amount_requests') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘①:public.order_amount_requests 已存在 ⇒ 本支貼過了或撞名, 停下';
  END IF;
  IF pg_catalog.to_regclass('public.orders') IS NULL OR pg_catalog.to_regclass('public.order_items') IS NULL THEN
    RAISE EXCEPTION '前置閘②:找不到 public.orders / order_items';
  END IF;
  IF pg_catalog.to_regclass('public.staff') IS NULL OR pg_catalog.to_regclass('public.admin_audit_log') IS NULL THEN
    RAISE EXCEPTION '前置閘③:找不到 public.staff 或 public.admin_audit_log';
  END IF;
  IF pg_catalog.to_regprocedure('public.admin_update_order_item_amount(uuid,uuid,integer,integer,text,text,text)') IS NULL THEN
    RAISE EXCEPTION '前置閘④:找不到 7 參的 admin_update_order_item_amount ⇒ 核准那條路沒有東西可呼';
  END IF;
  IF (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='staff' AND column_name='id') <> 'text' THEN
    RAISE EXCEPTION '前置閘⑤:public.staff.id 不是 text';
  END IF;
  IF pg_catalog.to_regclass('public.zzq_no_such_table_20260915a') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘 自檢:負對照命中 ⇒ 量具可疑';
  END IF;
END
$pre$;

-- ── 1. 表 ───────────────────────────────────────────────────────────────────
CREATE TABLE public.order_amount_requests (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           uuid        NOT NULL REFERENCES public.orders(id),
  order_item_id      uuid        NOT NULL REFERENCES public.order_items(id),
  -- 提案當下的 orders.version:核准時帶進改價 RPC 當樂觀鎖;單子中間被改 ⇒ CONFLICT ⇒ 申請留 pending 請重提。
  expected_version   integer     NOT NULL CHECK (expected_version >= 1),
  from_unit_price    integer     NOT NULL CHECK (from_unit_price >= 0),
  to_unit_price      integer     NOT NULL CHECK (to_unit_price >= 0),
  zero_price_reason  text        CHECK (zero_price_reason IS NULL OR pg_catalog.btrim(zero_price_reason) <> ''),
  reason             text        NOT NULL CHECK (pg_catalog.btrim(reason) <> '' AND pg_catalog.length(reason) <= 500),
  status             text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
  requested_by       text        NOT NULL REFERENCES public.staff(id),
  requested_at       timestamptz NOT NULL DEFAULT now(),
  reviewed_by        text        REFERENCES public.staff(id),
  reviewed_at        timestamptz,
  review_note        text        CHECK (review_note IS NULL OR pg_catalog.length(review_note) <= 500),
  request_id         text        NOT NULL CHECK (request_id <> ''),
  -- 終態一定有 reviewed_*;pending 一定沒有(superseded 由 review RPC 標, 也帶 reviewed_*)。
  CONSTRAINT order_amount_requests_review_pair CHECK (
    (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status <> 'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  ),
  -- 退回一定有理由。
  CONSTRAINT order_amount_requests_reject_note CHECK (status <> 'rejected' OR (review_note IS NOT NULL AND pg_catalog.btrim(review_note) <> '')),
  -- to = 0 ⇒ zero_price_reason 必填;to > 0 ⇒ 不得帶(同 admin_update_order_item_amount 兩道互斥規則)。
  CONSTRAINT order_amount_requests_zero_reason CHECK (
    (to_unit_price = 0 AND zero_price_reason IS NOT NULL) OR (to_unit_price > 0 AND zero_price_reason IS NULL)
  )
);
-- 一個品項同時只准一條待審(Q2 甲)。
CREATE UNIQUE INDEX order_amount_requests_one_pending_per_item
  ON public.order_amount_requests (order_item_id) WHERE status = 'pending';
-- 冪等鍵:同 request_id 回同一筆。
CREATE UNIQUE INDEX order_amount_requests_request_id_uidx ON public.order_amount_requests (request_id);
CREATE INDEX order_amount_requests_order_idx ON public.order_amount_requests (order_id, requested_at DESC);

COMMENT ON TABLE public.order_amount_requests IS
  'M-4b-03 改金額審核:員工提「這一項改成多少、為什麼」, 管理者核 / 退。pending → approved | rejected | superseded(終態不可再變)。'
  ' 核准 = admin_review_order_item_amount 同交易呼既有 admin_update_order_item_amount(actor = 管理者);核准前訂單金額一字不動。'
  ' 唯一寫入 = 兩支 SECDEF RPC;service_role 只 SELECT。';

-- 🔴 REVOKE 先、含 service_role(空庫 shim 的 default privileges 會讓新表出生就帶 service_role 全權)。
REVOKE ALL ON TABLE public.order_amount_requests FROM PUBLIC, anon, authenticated, service_role, payment_confirmer;
GRANT SELECT ON TABLE public.order_amount_requests TO service_role;
GRANT SELECT ON TABLE public.order_amount_requests TO pcm_readonly;
ALTER TABLE public.order_amount_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_amount_requests_select_service_role ON public.order_amount_requests
  FOR SELECT TO service_role USING (true);

-- ── 2. 員工提案 ─────────────────────────────────────────────────────────────
CREATE FUNCTION public.admin_request_order_item_amount(
  p_order_id uuid,
  p_order_item_id uuid,
  p_expected_version integer,
  p_to_unit_price integer,
  p_zero_price_reason text,
  p_reason text,
  p_actor text,
  p_request_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_existing public.order_amount_requests%ROWTYPE;
  v_ord      RECORD;
  v_item     RECORD;
  v_row      public.order_amount_requests%ROWTYPE;
  v_reason   text := pg_catalog.btrim(COALESCE(p_reason, ''));
  v_zero     text := NULLIF(pg_catalog.btrim(COALESCE(p_zero_price_reason, '')), '');
  v_n        integer;
  v_cname    text;
BEGIN
  -- G1 輸入
  IF p_order_id IS NULL OR p_order_item_id IS NULL OR p_expected_version IS NULL THEN
    RAISE EXCEPTION 'admin_request_order_item_amount: order_id / order_item_id / expected_version 必填';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id) = '' THEN
    RAISE EXCEPTION 'admin_request_order_item_amount: p_request_id 不可為空';
  END IF;
  IF p_to_unit_price IS NULL OR p_to_unit_price < 0 THEN
    RAISE EXCEPTION 'admin_request_order_item_amount: 想改成的單價要是 0 或正整數';
  END IF;
  IF v_reason = '' OR pg_catalog.length(v_reason) > 500 THEN
    RAISE EXCEPTION 'admin_request_order_item_amount: 要寫為什麼要改(1-500 字)';
  END IF;
  IF p_to_unit_price = 0 AND v_zero IS NULL THEN
    RAISE EXCEPTION '單價改為 0 需要填原因(例:贈品 / 換貨補寄)';
  END IF;
  IF p_to_unit_price > 0 AND v_zero IS NOT NULL THEN
    RAISE EXCEPTION '單價不是 0 時不得帶「零元原因」';
  END IF;
  -- G2 身分:啟用中員工即可(不必管理者)—— 提案不改任何金額。
  IF p_actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = p_actor AND s.is_active) THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;
  -- G3 冪等:同 request_id 回同一筆(內容不再比對 —— 這一列不是錢, 只是申請;要改就重提一顆新 id)。
  -- 🔴 codex R1 must-fix ②:同鍵【併發】重送 —— 先用 advisory lock 把同一顆 request_id 序列化, 第二發進來時第一發已 commit ⇒ 查得到 ⇒ idempotent。
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('order_amount_requests:' || p_request_id));
  SELECT * INTO v_existing FROM public.order_amount_requests r WHERE r.request_id = p_request_id;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object('result', 'idempotent', 'request_row_id', v_existing.id, 'status', v_existing.status, 'order_id', v_existing.order_id);
  END IF;
  -- G4 單與品項(鎖序 orders → order_items, 與改價 RPC 同向)
  SELECT o.id, o.version, o.cancelled_at INTO v_ord FROM public.orders o WHERE o.id = p_order_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_request_order_item_amount: 訂單不存在';
  END IF;
  IF v_ord.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION '這張單已取消, 不能再改金額';
  END IF;
  IF v_ord.version <> p_expected_version THEN
    RAISE EXCEPTION '這張單剛被別人改過(版本 % ≠ %), 請重新整理再提', v_ord.version, p_expected_version;
  END IF;
  SELECT i.id, i.unit_price INTO v_item FROM public.order_items i WHERE i.id = p_order_item_id AND i.order_id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_request_order_item_amount: 品項不在這張單上';
  END IF;
  IF v_item.unit_price = p_to_unit_price THEN
    RAISE EXCEPTION '想改成的單價與現在一樣(%), 不用提', p_to_unit_price;
  END IF;
  -- G5 落列(一品項一條 pending 由部分唯一索引擋 ⇒ 23505 轉成看得懂的話)
  BEGIN
    INSERT INTO public.order_amount_requests
      (order_id, order_item_id, expected_version, from_unit_price, to_unit_price, zero_price_reason, reason, requested_by, request_id)
    VALUES
      (p_order_id, p_order_item_id, p_expected_version, v_item.unit_price, p_to_unit_price, v_zero, v_reason, p_actor, p_request_id)
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    -- 哪一道唯一撞到要分開講(codex R1 must-fix ②):request_id 那道 ⇒ 理論上被 advisory lock 擋掉, 真撞到就重讀回 idempotent;pending 那道 ⇒ 人話。
    GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
    IF v_cname = 'order_amount_requests_request_id_uidx' THEN
      SELECT * INTO v_existing FROM public.order_amount_requests r WHERE r.request_id = p_request_id;
      IF FOUND THEN
        RETURN pg_catalog.jsonb_build_object('result', 'idempotent', 'request_row_id', v_existing.id, 'status', v_existing.status, 'order_id', v_existing.order_id);
      END IF;
      RAISE;
    ELSIF v_cname = 'order_amount_requests_one_pending_per_item' THEN
      RAISE EXCEPTION '這一項已經有一條待審的申請, 先請管理者處理那一條';
    ELSE
      RAISE;
    END IF;
  END;
  -- G6 稽核(同交易;落不進去整筆回滾)
  INSERT INTO public.admin_audit_log (actor, action, target, request_id, before, after, reason, source_app)
  VALUES (p_actor, 'order.item.amount.request', 'order_item:' || p_order_item_id::text, p_request_id,
          NULL,
          pg_catalog.jsonb_build_object('request_row_id', v_row.id, 'order_id', p_order_id,
            'from_unit_price', v_row.from_unit_price, 'to_unit_price', v_row.to_unit_price,
            'zero_price_reason', v_row.zero_price_reason, 'reason', v_row.reason),
          v_reason, 'admin');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_request_order_item_amount: 稽核落 % 列 ⇒ 提案與留紀錄必須同生共死', v_n;
  END IF;
  RETURN pg_catalog.jsonb_build_object('result', 'ok', 'request_row_id', v_row.id, 'status', v_row.status, 'order_id', v_row.order_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_request_order_item_amount(uuid,uuid,integer,integer,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_request_order_item_amount(uuid,uuid,integer,integer,text,text,text,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_request_order_item_amount(uuid,uuid,integer,integer,text,text,text,text) TO service_role;
ALTER FUNCTION public.admin_request_order_item_amount(uuid,uuid,integer,integer,text,text,text,text) OWNER TO postgres;
COMMENT ON FUNCTION public.admin_request_order_item_amount(uuid,uuid,integer,integer,text,text,text,text) IS
  'M-4b-03 員工提「改品項單價」申請(SECDEF, service_role only)。啟用中員工即可;from 價由本函式讀 order_items, 不信 client;'
  ' 同 request_id 冪等;一品項一條 pending;不動任何金額;同交易寫 audit order.item.amount.request。';

-- ── 3. 管理者核 / 退 ─────────────────────────────────────────────────────────
CREATE FUNCTION public.admin_review_order_item_amount(
  p_request_row_id uuid,
  p_decision text,
  p_review_note text,
  p_actor text,
  p_request_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_is_manager boolean;
  v_req        public.order_amount_requests%ROWTYPE;
  v_order_id   uuid;
  v_ord        RECORD;
  v_note       text := NULLIF(pg_catalog.btrim(COALESCE(p_review_note, '')), '');
  v_outcome    text;
  v_status     text;
  v_n          integer;
BEGIN
  -- G1 輸入
  IF p_request_row_id IS NULL THEN
    RAISE EXCEPTION 'admin_review_order_item_amount: request_row_id 必填';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id) = '' THEN
    RAISE EXCEPTION 'admin_review_order_item_amount: p_request_id 不可為空';
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'admin_review_order_item_amount: decision 要是 approve 或 reject(收到 %)', COALESCE(p_decision, '(缺)');
  END IF;
  IF p_decision = 'reject' AND v_note IS NULL THEN
    RAISE EXCEPTION '退回要寫理由';
  END IF;
  IF v_note IS NOT NULL AND pg_catalog.length(v_note) > 500 THEN
    RAISE EXCEPTION 'admin_review_order_item_amount: 理由最多 500 字';
  END IF;
  -- G2 管理者閘(mgr0 §12-3 形狀;actor 不存在 / 停用 ⇒ NOT FOUND ⇒ 擋)
  SELECT s.is_manager INTO v_is_manager FROM public.staff s WHERE s.id = p_actor AND s.is_active FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;
  IF NOT coalesce(v_is_manager, false) THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;
  -- G3 鎖序(codex R1 must-fix ①):先不加鎖取 order_id ⇒ 鎖 orders FOR NO KEY UPDATE(與既有改價 RPC 同一種鎖, 同單兩條申請同時核會【排隊】不會死鎖)
  --    ⇒ 再 FOR UPDATE 鎖申請列、重讀狀態。⛔ ~~先 FOR SHARE 再讓改價 RPC 升級成 NO KEY UPDATE~~ 那是鎖升級, 兩邊互等。
  SELECT r.order_id INTO v_order_id FROM public.order_amount_requests r WHERE r.id = p_request_row_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_review_order_item_amount: 找不到這條申請';
  END IF;
  SELECT o.id, o.cancelled_at INTO v_ord FROM public.orders o WHERE o.id = v_order_id FOR NO KEY UPDATE;
  SELECT * INTO v_req FROM public.order_amount_requests r WHERE r.id = p_request_row_id FOR UPDATE;
  IF NOT FOUND OR v_req.order_id IS DISTINCT FROM v_order_id THEN
    RAISE EXCEPTION 'admin_review_order_item_amount: 找不到這條申請';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION '這條申請已經是「%」, 不能再處理', v_req.status;
  END IF;
  -- G4 單子還在不在:已取消 ⇒ 標 superseded(帶 reviewed_*), 回 superseded 讓管理者知道
  IF v_ord.id IS NULL OR v_ord.cancelled_at IS NOT NULL THEN
    UPDATE public.order_amount_requests
       SET status = 'superseded', reviewed_by = p_actor, reviewed_at = pg_catalog.now(), review_note = '單已取消, 申請作廢'
     WHERE id = v_req.id AND status = 'pending';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'admin_review_order_item_amount: 申請列沒標成 superseded(% 列)', v_n;
    END IF;
    INSERT INTO public.admin_audit_log (actor, action, target, request_id, before, after, reason, source_app)
    VALUES (p_actor, 'order.item.amount.review', 'order_item:' || v_req.order_item_id::text, p_request_id,
            pg_catalog.jsonb_build_object('request_row_id', v_req.id, 'status', 'pending'),
            pg_catalog.jsonb_build_object('request_row_id', v_req.id, 'status', 'superseded', 'decision', p_decision,
              'from_unit_price', v_req.from_unit_price, 'to_unit_price', v_req.to_unit_price, 'requested_by', v_req.requested_by),
            '單已取消, 申請作廢', 'admin');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'admin_review_order_item_amount: superseded 稽核落 % 列', v_n;
    END IF;
    RETURN pg_catalog.jsonb_build_object('result', 'superseded', 'request_row_id', v_req.id, 'status', 'superseded', 'order_id', v_req.order_id);
  END IF;
  -- G5 核 / 退
  IF p_decision = 'approve' THEN
    -- 🔴 改價走【既有】那支, 一字不改:actor = 管理者、version = 提案時的(樂觀鎖)。非 OK ⇒ RAISE ⇒ 整筆回滾, 申請留 pending。
    SELECT public.admin_update_order_item_amount(
             v_req.order_id, v_req.order_item_id, v_req.to_unit_price, v_req.expected_version,
             p_actor, p_request_id, v_req.zero_price_reason)
      INTO v_outcome;
    IF v_outcome = 'CONFLICT' THEN
      RAISE EXCEPTION '這張單在提案之後被改過(版本不符), 沒有改價;請員工重新提一次';
    ELSIF v_outcome = 'NOOP' THEN
      RAISE EXCEPTION '單價已經是 % 了, 這條申請沒有東西可改;退回它或請員工重提', v_req.to_unit_price;
    ELSIF v_outcome IS DISTINCT FROM 'OK' THEN
      RAISE EXCEPTION 'admin_review_order_item_amount: 改價回了「%」, 沒有改價', COALESCE(v_outcome, '(NULL)');
    END IF;
    v_status := 'approved';
  ELSE
    v_status := 'rejected';
  END IF;
  UPDATE public.order_amount_requests
     SET status = v_status, reviewed_by = p_actor, reviewed_at = pg_catalog.now(), review_note = v_note
   WHERE id = v_req.id AND status = 'pending';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_review_order_item_amount: 申請列沒更新到(% 列)', v_n;
  END IF;
  -- G6 稽核(改價本身的那一筆由 admin_update_order_item_amount 自己寫, 本筆記「誰核 / 退了什麼」)
  INSERT INTO public.admin_audit_log (actor, action, target, request_id, before, after, reason, source_app)
  VALUES (p_actor, 'order.item.amount.review', 'order_item:' || v_req.order_item_id::text, p_request_id,
          pg_catalog.jsonb_build_object('request_row_id', v_req.id, 'status', 'pending'),
          pg_catalog.jsonb_build_object('request_row_id', v_req.id, 'status', v_status, 'decision', p_decision,
            'from_unit_price', v_req.from_unit_price, 'to_unit_price', v_req.to_unit_price,
            'requested_by', v_req.requested_by, 'review_note', v_note),
          v_note, 'admin');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_review_order_item_amount: 稽核落 % 列 ⇒ 核退與留紀錄必須同生共死', v_n;
  END IF;
  -- order_id 一起回(codex C 片 must-fix:action 用它綁導頁, 不信表單那顆 return_to 裡的 open=)。
  RETURN pg_catalog.jsonb_build_object('result', 'ok', 'request_row_id', v_req.id, 'status', v_status, 'order_id', v_req.order_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_review_order_item_amount(uuid,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_review_order_item_amount(uuid,text,text,text,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_order_item_amount(uuid,text,text,text,text) TO service_role;
ALTER FUNCTION public.admin_review_order_item_amount(uuid,text,text,text,text) OWNER TO postgres;
COMMENT ON FUNCTION public.admin_review_order_item_amount(uuid,text,text,text,text) IS
  'M-4b-03 管理者核 / 退「改品項單價」申請(SECDEF, service_role only;管理者限定 ''無權執行此操作'')。'
  ' approve ⇒ 同交易呼既有 admin_update_order_item_amount(actor = 管理者, version = 提案時的), 非 OK 整筆回滾申請留 pending;'
  ' reject ⇒ note 必填;單已取消 ⇒ 標 superseded。同交易寫 audit order.item.amount.review。';

-- ── 4. 事後斷言 ─────────────────────────────────────────────────────────────
DO $assert$
DECLARE
  v_relations text[] := ARRAY['public.order_amount_requests']::text[];
  v_functions text[] := ARRAY[
    'public.admin_request_order_item_amount(uuid,uuid,integer,integer,text,text,text,text)',
    'public.admin_review_order_item_amount(uuid,text,text,text,text)'
  ]::text[];
  r text;
  v_bad text := NULL;
BEGIN
  FOREACH r IN ARRAY v_relations LOOP
    IF pg_catalog.has_table_privilege('anon', r, 'SELECT') OR pg_catalog.has_table_privilege('anon', r, 'INSERT')
       OR pg_catalog.has_table_privilege('authenticated', r, 'SELECT') OR pg_catalog.has_table_privilege('authenticated', r, 'INSERT') THEN
      v_bad := pg_catalog.concat_ws(' | ', v_bad, r || ':anon/authenticated 還有權限');
    END IF;
    IF NOT pg_catalog.has_table_privilege('service_role', r, 'SELECT') THEN
      v_bad := pg_catalog.concat_ws(' | ', v_bad, r || ':service_role 應該要有 SELECT');
    END IF;
    IF pg_catalog.has_table_privilege('service_role', r, 'INSERT') OR pg_catalog.has_table_privilege('service_role', r, 'UPDATE')
       OR pg_catalog.has_table_privilege('service_role', r, 'DELETE') THEN
      v_bad := pg_catalog.concat_ws(' | ', v_bad, r || ':service_role 不該有寫權');
    END IF;
    IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='public' AND c.relname = pg_catalog.split_part(r, '.', 2)) THEN
      v_bad := pg_catalog.concat_ws(' | ', v_bad, r || ':RLS 沒開');
    END IF;
  END LOOP;
  FOREACH r IN ARRAY v_functions LOOP
    IF pg_catalog.to_regprocedure(r) IS NULL THEN
      v_bad := pg_catalog.concat_ws(' | ', v_bad, r || ':沒建起來');
      CONTINUE;
    END IF;
    IF pg_catalog.has_function_privilege('anon', r, 'EXECUTE') OR pg_catalog.has_function_privilege('authenticated', r, 'EXECUTE') THEN
      v_bad := pg_catalog.concat_ws(' | ', v_bad, r || ':anon/authenticated 還有 EXECUTE');
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', r, 'EXECUTE') THEN
      v_bad := pg_catalog.concat_ws(' | ', v_bad, r || ':service_role 沒有 EXECUTE');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(r)
                    AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""'] AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres') THEN
      v_bad := pg_catalog.concat_ws(' | ', v_bad, r || ':不是 SECURITY DEFINER / search_path 空字串 / owner postgres');
    END IF;
  END LOOP;
  IF pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.admin_review_order_item_amount(uuid,text,text,text,text)'::regprocedure), '無權執行此操作') = 0 THEN
    v_bad := pg_catalog.concat_ws(' | ', v_bad, 'admin_review_order_item_amount:管理者閘那句不在');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes WHERE schemaname='public' AND tablename='order_amount_requests'
                  AND indexname='order_amount_requests_one_pending_per_item'
                  AND indexdef LIKE 'CREATE UNIQUE INDEX%(order_item_id)%WHERE%status%pending%') THEN
    v_bad := pg_catalog.concat_ws(' | ', v_bad, '一品項一條 pending 的部分唯一索引不對(表 / unique / 欄 / 述詞)');
  END IF;
  IF pg_catalog.has_table_privilege('service_role', 'public.order_amount_requests', 'TRUNCATE')
     OR pg_catalog.has_table_privilege('payment_confirmer', 'public.order_amount_requests', 'INSERT')
     OR pg_catalog.has_table_privilege('pcm_readonly', 'public.order_amount_requests', 'INSERT')
     OR pg_catalog.has_table_privilege('anon', 'public.order_amount_requests', 'UPDATE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.order_amount_requests', 'DELETE') THEN
    v_bad := pg_catalog.concat_ws(' | ', v_bad, 'order_amount_requests:多出來的寫權 / TRUNCATE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = 'public.order_amount_requests'::regclass AND polname = 'order_amount_requests_select_service_role') THEN
    v_bad := pg_catalog.concat_ws(' | ', v_bad, 'service_role 的 SELECT policy 沒建');
  END IF;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '事後閘:%', v_bad;
  END IF;
  RAISE NOTICE 'M-4b-03 A 片貼好了:order_amount_requests + admin_request_order_item_amount + admin_review_order_item_amount。';
END $assert$;

COMMIT;
