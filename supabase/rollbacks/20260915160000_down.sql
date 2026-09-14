-- 20260915160000 回滾:request 貼回第 2 代本體(逐字自 20260915130000)+ 它的 COMMENT;CHECK 換回 btrim 那版(舊名 order_amount_requests_zero_price_reason_check)。
-- 回滾後回到病的樣子:全形空白 / 零寬字元的零元原因又進得去。已存的列不動(新規則比舊規則嚴, 能過新的一定過得了舊的)。
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $pre$
DECLARE v_src text;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.admin_request_order_item_amount(uuid,uuid,integer,integer,text,text,text,text)');
  IF v_src IS NULL OR pg_catalog.md5(v_src) <> '6da21d4766a87fc19248bb719a05d4f2' THEN
    RAISE EXCEPTION '回滾前置閘:request md5(prosrc) = % 不是第 3 代 6da21d4766a87fc19248bb719a05d4f2 ⇒ 不回滾, 停', COALESCE(pg_catalog.md5(v_src), '(函式不在)');
  END IF;
END
$pre$;
CREATE OR REPLACE FUNCTION public.admin_request_order_item_amount(
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
  v_payments integer;
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
  SELECT o.id, o.version, o.cancelled_at, o.discount_total, o.price_tax_mode, o.tax_total INTO v_ord FROM public.orders o WHERE o.id = p_order_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_request_order_item_amount: 訂單不存在';
  END IF;
  IF v_ord.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION '這張單已取消, 不能再改金額';
  END IF;
  IF v_ord.version <> p_expected_version THEN
    RAISE EXCEPTION '這張單剛被別人改過(版本 % ≠ %), 請重新整理再提', v_ord.version, p_expected_version;
  END IF;
  -- 🔴 第 2 代(20260915130000):改價 RPC(admin_update_order_item_amount)的三道硬擋, 提案時就先擋 —— 條件與訊息逐字同它。
  --    不擋的話, 員工提得出申請、管理者核准那一刻才炸。收款進來【不動 orders.version】⇒ 提案後才收款的那條由 review RPC 自動退回兜底。
  SELECT count(*) INTO v_payments FROM public.order_payments p WHERE p.order_id = p_order_id;
  IF v_payments > 0 THEN
    RAISE EXCEPTION '這張單已經有收款紀錄(% 筆),目前不開放改金額 —— 因為「已收多少」的算法還沒定案。需要調整請走退款流程,或告知系統維護。', v_payments;
  END IF;
  IF v_ord.discount_total <> 0 THEN
    RAISE EXCEPTION '這張單有折扣(%),而本功能尚未處理折扣單的改價(#13 片1 已知限制 L2)。請告知系統維護。', v_ord.discount_total;
  END IF;
  IF v_ord.price_tax_mode = 'exclusive' OR COALESCE(v_ord.tax_total, 0) <> 0 THEN
    RAISE EXCEPTION '這張單的單價是【未稅】的(稅另計), 而改金額這個功能還不會重算稅 —— 目前不開放改。需要調整請告知系統維護。';
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
  'M-4b-03 員工提「改品項單價」申請(SECDEF, service_role only)。第 2 代 20260915130000。啟用中員工即可;from 價由本函式讀 order_items, 不信 client;'
  ' 同 request_id 冪等;一品項一條 pending;提案時先擋改價 RPC 的三道硬擋(已收款 / 折扣 / 未稅);不動任何金額;同交易寫 audit order.item.amount.request。';

ALTER TABLE public.order_amount_requests DROP CONSTRAINT IF EXISTS order_amount_requests_zero_price_reason_clean;
ALTER TABLE public.order_amount_requests DROP CONSTRAINT IF EXISTS order_amount_requests_zero_price_reason_check;
ALTER TABLE public.order_amount_requests ADD CONSTRAINT order_amount_requests_zero_price_reason_check CHECK (zero_price_reason IS NULL OR pg_catalog.btrim(zero_price_reason) <> '');
DO $post$
DECLARE v_src text;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.admin_request_order_item_amount(uuid,uuid,integer,integer,text,text,text,text)');
  IF pg_catalog.md5(v_src) <> 'b7ea2c9f246624a2c0a52d65d7327c3b' THEN
    RAISE EXCEPTION '回滾事後閘:request md5(prosrc) = % 不是第 2 代 b7ea2c9f246624a2c0a52d65d7327c3b', pg_catalog.md5(v_src);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.order_amount_requests'::regclass AND conname = 'order_amount_requests_zero_price_reason_check')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.order_amount_requests'::regclass AND conname = 'order_amount_requests_zero_price_reason_clean') THEN
    RAISE EXCEPTION '回滾事後閘:CHECK 沒換回舊的';
  END IF;
END
$post$;
COMMIT;
