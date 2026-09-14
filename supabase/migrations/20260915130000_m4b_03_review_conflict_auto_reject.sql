-- 20260915130000_m4b_03_review_conflict_auto_reject.sql —— M-4b-03 改金額審核 第 2 代:核准撞「單子變了」⇒ 自動退回;提申請先擋三道硬擋
--
-- 🛑 未貼(寫好不貼;貼是 Sean 一次一個編號)。主視窗 2026-09-14 跨片 workflow 審查 confirmed high ×2, 派工改(板 171)。
--
-- ══ 病 1(CONFLICT 互指死局)══════════════════════════════════════════════
-- 第 1 代(20260915050000)approve 帶提案當下的 version 呼改價 RPC;單子在提案後被動過 ⇒ CONFLICT ⇒ RAISE ⇒ 申請【留 pending】。
-- 員工重提撞「一品項一條 pending」被拒「先請管理者處理」, 管理者畫面叫「請員工重提」⇒ 兩句話互指。
-- 而 plan §1 本來就寫「CONFLICT ⇒ 申請自動退回」—— 第 1 代照了同一份 plan 裡自相矛盾的 §2/§3/§6(plan 已同步)。
-- ══ 病 2(提案不預檢, 核准才炸)═══════════════════════════════════════════
-- 改價 RPC(現行 20260915060000)有三道 RAISE P2C13 硬擋:已收款 :1696-1703 / 折扣 :1709-1715 / 未稅 :1763-1769, 提案 RPC 一道都沒查。
-- 最常見的路:員工對未收款的單提案 → 客人付款(收款寫入者【不動 orders.version】)→ 管理者核准過得了 CONFLICT、撞已收款那道 RAISE
-- ⇒ 整筆回滾、申請留 pending ⇒ 管理者看到「系統出了錯」(P2C13 不是 P0001 ⇒ TS 走 error 碼), 員工表單已被畫面擋掉提不了新的。
-- ══ 做什麼 ═════════════════════════════════════════════════════════════
-- · admin_request_order_item_amount 第 2 代 = 第 1 代本體【逐字】+ 版本檢查後加三道預檢(條件與訊息逐字同改價 RPC, 走 P0001 ⇒ 員工看到「系統沒收這條申請」)。
-- · admin_review_order_item_amount 第 2 代 = 第 1 代本體【逐字】+ 只改 approve 段:
--     CONFLICT ⇒ rejected、note「單子在提案後被改過, 請重提」、result = stale_rejected;
--     改價 RPC 丟 P2C13 且 CONSTRAINT_NAME ∈ {pcm_e13_no_edit_after_payment, pcm_e13_discount_not_supported, pcm_e13_no_edit_when_taxed}
--       ⇒ rejected、note 寫那道擋的人話、result = blocked_rejected;其他 P2C13(資料損壞守門)⇒ RAISE; 原樣丟, 整筆回滾。
--     兩種自動退回都照寫 audit、正常 commit ⇒ pending 放掉。NOOP 那句拿掉「或請員工重提」。
-- · 🔴 為什麼 commit 安全(兩條理由, 缺一不可):
--   ① 改價 RPC 的 RETURN 'CONFLICT'(:1692)、已收款 RAISE(:1697)、折扣 RAISE(:1710)都在它第一個寫入 UPDATE public.order_items(:1740)之前;
--   ② ⚠️ 但【未稅那道 RAISE(:1764)在 :1740 那個 UPDATE 之後】—— 它不是「還沒寫」, 是「寫了再擋」。
--      ⇒ 靠的是 approve 段把呼叫包在 BEGIN…EXCEPTION 子交易裡:P2C13 一丟, 子交易內那筆 order_items 更新整段回滾。
--      (行號 = 正式庫現行 20260915060000;探針 drill E3 實證:提案後改成未稅 ⇒ 核准 ⇒ 自動退回且單價不動。)
--   自動退回 commit 出去的只有「申請列標 rejected + 一筆審核稽核」。
-- · 不動表、不動改價 RPC。
-- ══ 形狀 ═══════════════════════════════════════════════════════════════
-- CREATE OR REPLACE 兩支(簽章不變);🔴 它會把 SET 子句整組換掉 ⇒ 照寫 SET search_path = '';ACL 重發基準並事後斷言。
-- 前置閘(精確 md5 判代, codex R1 must-fix):
--   request:第 1 代 fb83fbdad94e53eab084389910939a0c ⇒ 升 / 第 2 代 b7ea2c9f246624a2c0a52d65d7327c3b ⇒ 冪等 / 其他停。
--   review :第 1 代 bdc7659cab80858b7766c8ebfa101837 ⇒ 升 / 第 2 代 105e283d9e64f977943016eee55fe957 ⇒ 冪等 / 其他停。
-- 回滾:supabase/rollbacks/20260915130000_down.sql = 兩支貼回第 1 代本體(逐字)。已被自動退回的申請留著(那是真的發生過的)。
-- TS 半(同分支):repository 讀 result;action 認 stale_rejected / blocked_rejected ⇒ amount_review_stale / amount_review_blocked。
--   🔵 推薦【TS 先上、再貼本板】:TS 先 ⇒ 第 1 代照舊;貼板先也不壞資料, 但過渡期舊 TS 會把自動退回印成「退回了, 員工看得到你的理由」。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
DECLARE
  v_oid oid;
  v_cfg text[];
  v_src text;
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.admin_request_order_item_amount(uuid,uuid,integer,integer,text,text,text,text)', 'fb83fbdad94e53eab084389910939a0c', 'b7ea2c9f246624a2c0a52d65d7327c3b'),
      ('public.admin_review_order_item_amount(uuid,text,text,text,text)', 'bdc7659cab80858b7766c8ebfa101837', '105e283d9e64f977943016eee55fe957')) AS t(sig, g1, g2) LOOP
    v_oid := pg_catalog.to_regprocedure(r.sig);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '前置閘⓪:% 不在 ⇒ 20260915050000 還沒貼, 先貼它', r.sig;
    END IF;
    SELECT p.proconfig, p.prosrc INTO v_cfg, v_src FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
    IF v_cfg IS NULL OR NOT ('search_path=""' = ANY (v_cfg) OR 'search_path=' = ANY (v_cfg)) THEN
      RAISE EXCEPTION '前置閘⓪:% 的 search_path 不是空字串(%)⇒ 不認得的一代, 拒繼續', r.sig, v_cfg;
    END IF;
    IF pg_catalog.md5(v_src) = r.g1 THEN
      RAISE NOTICE '前置閘⓪:% 第 1 代在(md5 相符)⇒ 升第 2 代', r.sig;
    ELSIF pg_catalog.md5(v_src) = r.g2 THEN
      RAISE NOTICE '前置閘⓪:% 已是第 2 代(md5 相符)⇒ 照樣重跑(冪等)', r.sig;
    ELSE
      -- ⛔ ~~有 stale_rejected 就當第 2 代~~(codex R1 must-fix):之後的修正版會保留那個字、另加檢查 ⇒ 用字判會把那些檢查蓋掉。
      RAISE EXCEPTION '前置閘⓪:% 的 md5(prosrc) = % 既不是第 1 代也不是第 2 代 ⇒ 有人改過這支, 停下來看', r.sig, pg_catalog.md5(v_src);
    END IF;
  END LOOP;
  IF pg_catalog.to_regprocedure('public.admin_update_order_item_amount(uuid,uuid,integer,integer,text,text,text)') IS NULL THEN
    RAISE EXCEPTION '前置閘①:找不到 7 參的 admin_update_order_item_amount';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid = 'public.order_amount_requests'::regclass
                  AND c.contype = 'c' AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%rejected%') THEN
    RAISE EXCEPTION '前置閘②:order_amount_requests 的狀態 CHECK 找不到 rejected ⇒ 自動退回會被擋';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'public.orders'::regclass AND a.attname = 'price_tax_mode' AND NOT a.attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'public.orders'::regclass AND a.attname = 'tax_total' AND NOT a.attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'public.orders'::regclass AND a.attname = 'discount_total' AND NOT a.attisdropped)
     OR pg_catalog.to_regclass('public.order_payments') IS NULL THEN
    RAISE EXCEPTION '前置閘③:orders.price_tax_mode / tax_total / discount_total 或 order_payments 不在 ⇒ 提案預檢讀不到';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.admin_update_order_item_amount(uuid,uuid,integer,integer,text,text,text)');
  IF pg_catalog.strpos(v_src, 'pcm_e13_no_edit_after_payment') = 0 OR pg_catalog.strpos(v_src, 'pcm_e13_discount_not_supported') = 0
     OR pg_catalog.strpos(v_src, 'pcm_e13_no_edit_when_taxed') = 0 THEN
    RAISE EXCEPTION '前置閘④:改價 RPC 裡找不到那三個具名擋 ⇒ 自動退回認的名字對不上, 停';
  END IF;
  IF pg_catalog.to_regprocedure('public.zzq_no_such_fn_20260915130000(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘 自檢:負對照命中 ⇒ 量具可疑';
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

CREATE OR REPLACE FUNCTION public.admin_review_order_item_amount(
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
  v_result     text := 'ok';
  v_blk_cname  text;
  v_blocked    text;
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
    -- 🔴 改價走【既有】那支, 一字不改:actor = 管理者、version = 提案時的(樂觀鎖)。
    --    第 2 代(20260915130000):CONFLICT 與三道業務硬擋(已收款 / 折扣 / 未稅)⇒ 不改價、申請自動退回、正常 commit;
    --    NOOP 與其他錯(含同為 P2C13 的資料損壞守門)⇒ 照舊整筆回滾、申請留 pending。
    -- 🔴 子交易【承重, 不准拿掉】:改價 RPC 丟 P2C13 時, 它在這個 BEGIN 裡做過的一切都回滾。
    --    ⚠️ 不是「那三道擋都還沒寫」—— 未稅那道在它 UPDATE public.order_items 之後(20260915060000 :1740 寫、:1764 擋),
    --       沒有這個子交易, 自動退回 commit 時會把那筆單價更新一起帶出去(探針 E3 驗過有它時單價不動)。
    --    只認三個具名的業務拒絕;同為 P2C13 的資料損壞守門(subtotal 對不上等)⇒ RAISE; 原樣往外丟, 整筆回滾。
    BEGIN
      SELECT public.admin_update_order_item_amount(
               v_req.order_id, v_req.order_item_id, v_req.to_unit_price, v_req.expected_version,
               p_actor, p_request_id, v_req.zero_price_reason)
        INTO v_outcome;
    EXCEPTION WHEN SQLSTATE 'P2C13' THEN
      GET STACKED DIAGNOSTICS v_blk_cname = CONSTRAINT_NAME;
      v_blocked := CASE v_blk_cname
        WHEN 'pcm_e13_no_edit_after_payment'  THEN '這張單已經有收款紀錄, 已收款的單目前不能改價'
        WHEN 'pcm_e13_discount_not_supported' THEN '這張單有折扣, 目前不能改價'
        WHEN 'pcm_e13_no_edit_when_taxed'     THEN '這張單使用未稅價或稅額不為 0, 目前不能改價'
        ELSE NULL
      END;
      IF v_blocked IS NULL THEN
        RAISE;
      END IF;
      v_outcome := 'BLOCKED';
    END;
    IF v_outcome = 'CONFLICT' THEN
      -- 🔴 單子在提案後被改過 ⇒ 沒改價, 申請【自動退回】並正常 commit。
      --    第 1 代 RAISE 留 pending 會卡死:員工重提撞「一品項一條 pending」、管理者畫面叫「請員工重提」⇒ 兩句話互指。
      --    改價 RPC 回 CONFLICT 之前一筆都沒寫(版本比對在它任何 INSERT / UPDATE 之前)⇒ 這裡 commit 不會帶出半套改價。
      v_status := 'rejected';
      v_note   := '單子在提案後被改過, 請重提';
      v_result := 'stale_rejected';
    ELSIF v_outcome = 'BLOCKED' THEN
      -- 🔴 提案之後單子變成不能改價(最常見:提案後才收款 —— 收款不動 orders.version, 過得了 CONFLICT)⇒ 同上自動退回。
      v_status := 'rejected';
      v_note   := v_blocked;
      v_result := 'blocked_rejected';
    ELSIF v_outcome = 'NOOP' THEN
      RAISE EXCEPTION '單價已經是 % 了, 這條申請沒有東西可改;按「退回」把它結掉', v_req.to_unit_price;
    ELSIF v_outcome IS DISTINCT FROM 'OK' THEN
      RAISE EXCEPTION 'admin_review_order_item_amount: 改價回了「%」, 沒有改價', COALESCE(v_outcome, '(NULL)');
    ELSE
      v_status := 'approved';
    END IF;
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
  RETURN pg_catalog.jsonb_build_object('result', v_result, 'request_row_id', v_req.id, 'status', v_status, 'order_id', v_req.order_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_review_order_item_amount(uuid,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_review_order_item_amount(uuid,text,text,text,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_order_item_amount(uuid,text,text,text,text) TO service_role;
ALTER FUNCTION public.admin_review_order_item_amount(uuid,text,text,text,text) OWNER TO postgres;
COMMENT ON FUNCTION public.admin_review_order_item_amount(uuid,text,text,text,text) IS
  'M-4b-03 管理者核 / 退「改品項單價」申請(SECDEF, service_role only;管理者限定 ''無權執行此操作'')。第 2 代 20260915130000。'
  ' approve ⇒ 同交易呼既有 admin_update_order_item_amount(actor = 管理者, version = 提案時的);'
  ' 回 CONFLICT ⇒ 自動 rejected(stale_rejected);丟三個具名 P2C13 業務拒絕(已收款 / 折扣 / 未稅)⇒ 自動 rejected(blocked_rejected);'
  ' NOOP / 其他 ⇒ 整筆回滾申請留 pending;reject ⇒ note 必填;單已取消 ⇒ 標 superseded。同交易寫 audit order.item.amount.review。';

DO $post$
DECLARE
  v_oid oid;
  v_src text;
  v_bad text;
  v_msg text;
  s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['public.admin_request_order_item_amount(uuid,uuid,integer,integer,text,text,text,text)', 'public.admin_review_order_item_amount(uuid,text,text,text,text)'] LOOP
    v_oid := pg_catalog.to_regprocedure(s);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '事後閘⓪:% 不見了', s;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_oid AND p.prosecdef
                    AND p.proconfig @> ARRAY['search_path=""'] AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres') THEN
      RAISE EXCEPTION '事後閘①:% 不是 SECURITY DEFINER / search_path 空字串 / owner postgres', s;
    END IF;
    SELECT pg_catalog.string_agg(COALESCE(r.rolname, 'PUBLIC'), ', ') INTO v_bad
      FROM pg_catalog.pg_proc p
      CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
      LEFT JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
     WHERE p.oid = v_oid
       AND COALESCE(r.rolname, 'PUBLIC') NOT IN ('postgres', 'service_role');
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION '事後閘②:% 有非白名單 grantee:%', s, v_bad;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '事後閘②:% 的 EXECUTE 應只給 service_role', s;
    END IF;
  END LOOP;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.admin_review_order_item_amount(uuid,text,text,text,text)');
  IF pg_catalog.strpos(v_src, 'stale_rejected') = 0 OR pg_catalog.strpos(v_src, 'blocked_rejected') = 0
     OR pg_catalog.strpos(v_src, 'pcm_e13_no_edit_after_payment') = 0 OR pg_catalog.strpos(v_src, 'pcm_e13_discount_not_supported') = 0
     OR pg_catalog.strpos(v_src, 'pcm_e13_no_edit_when_taxed') = 0 OR pg_catalog.strpos(v_src, 'RAISE;') = 0 THEN
    RAISE EXCEPTION '事後閘③:review 函式體少了自動退回的兩條路或往外丟的那一行 ⇒ 貼到的不是第 2 代';
  END IF;
  IF pg_catalog.strpos(v_src, '請員工重新提一次') > 0 OR pg_catalog.strpos(v_src, '退回它或請員工重提') > 0 THEN
    RAISE EXCEPTION '事後閘③:第 1 代那兩句互指的話還在';
  END IF;
  IF pg_catalog.strpos(v_src, '無權執行此操作') = 0 OR pg_catalog.strpos(v_src, 'superseded') = 0
     OR pg_catalog.strpos(v_src, 'FOR NO KEY UPDATE') = 0 OR pg_catalog.strpos(v_src, '''order_id'', v_req.order_id') = 0 THEN
    RAISE EXCEPTION '事後閘③:review 第 1 代的管理者閘 / superseded / 鎖序 / order_id 少了一樣 ⇒ 聯集漏了';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.admin_request_order_item_amount(uuid,uuid,integer,integer,text,text,text,text)');
  IF pg_catalog.strpos(v_src, '這張單已經有收款紀錄') = 0 OR pg_catalog.strpos(v_src, '這張單有折扣') = 0
     OR pg_catalog.strpos(v_src, 'price_tax_mode = ''exclusive''') = 0 THEN
    RAISE EXCEPTION '事後閘④:request 函式體沒有三道預檢 ⇒ 貼到的不是第 2 代';
  END IF;
  IF pg_catalog.strpos(v_src, 'order_amount_requests_one_pending_per_item') = 0 OR pg_catalog.strpos(v_src, '''idempotent''') = 0 THEN
    RAISE EXCEPTION '事後閘④:request 第 1 代的一品項一條 pending / 冪等少了 ⇒ 聯集漏了';
  END IF;
  IF pg_catalog.strpos(v_src, 'P9Z99_20260915130000') <> 0 THEN
    RAISE EXCEPTION '事後閘④b(負對照):現造的字串居然在定義裡 ⇒ 這把尺壞了';
  END IF;
  -- ⑤ 活體:不存在的 actor ⇒ 兩支都要被閘擋(證明函式跑得起來)。子交易吃掉例外, 不影響本 migration。
  BEGIN
    PERFORM public.admin_review_order_item_amount(
      '00000000-0000-4000-8000-000000000000'::uuid, 'approve', NULL, 'postgate-nobody-20260915130000', 'postgate');
    RAISE EXCEPTION '事後閘⑤:review 不存在的 actor 居然沒被擋';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg <> '無權執行此操作' THEN
      RAISE EXCEPTION '事後閘⑤:review 應回「無權執行此操作」, 回了 %', v_msg;
    END IF;
  END;
  BEGIN
    PERFORM public.admin_request_order_item_amount(
      '00000000-0000-4000-8000-000000000000'::uuid, '00000000-0000-4000-8000-000000000000'::uuid, 1, 1, NULL,
      'postgate', 'postgate-nobody-20260915130000', 'postgate-20260915130000');
    RAISE EXCEPTION '事後閘⑤:request 不存在的 actor 居然沒被擋';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg <> '無權執行此操作' THEN
      RAISE EXCEPTION '事後閘⑤:request 應回「無權執行此操作」, 回了 %', v_msg;
    END IF;
  END;
  RAISE NOTICE '20260915130000 貼好了:改金額審核第 2 代(提案預檢三道硬擋 / 核准撞 CONFLICT 或硬擋 ⇒ 自動退回)。';
END
$post$;

COMMIT;
