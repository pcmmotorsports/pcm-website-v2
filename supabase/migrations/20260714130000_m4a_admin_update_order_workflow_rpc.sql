-- ============================================================
-- M-4a 訂單線 Slice C:後台改單寫入 — admin_update_order_workflow owner RPC
--   (設 workflow_status / shipping_method / 發票紀錄三欄;樂觀鎖 version;同交易寫 admin_audit_log)
-- ============================================================
-- 真權威:docs/specs/2026-07-13-m4a-order-workflow-status-design.md(Slice C)+ PRD §4/§6。
-- Fable 值班台 plan R1 verdict=`pcm-tools/review-inbox/m4a-order-workflow-status-c-plan.verdict.md`
--   (原案 supabase-js `.update(orders)` 上線即 42501 → 改 owner SECURITY DEFINER RPC;4 裁定 + 6 must-fix 折入本檔)。
-- 鐵則 8(新 SECURITY DEFINER RPC + GRANT)+ 鐵則 12(訂單寫入 / 金流紅線 / 稽核 / 經銷價零外洩)。
-- 依賴:20260604120000(orders)、20260611120000 §4(orders 對 service_role 已 REVOKE INSERT/UPDATE/DELETE=
--        本 RPC 存在的根本理由:admin 無法直寫、只能走 owner RPC)、20260712210000(admin_audit_log)、
--        20260714120000(workflow_status + order_status_options + 發票三欄;**同批 pending、須先於本檔 apply**)。
--
-- 🔴 翻盤事實(MCP 實查 2026-07-14):has_table_privilege('service_role','public.orders','UPDATE')=false
--   → admin(sb_secret_=service_role)不能 .update(orders);SECURITY DEFINER RPC(owner=postgres 對
--   orders/admin_audit_log 全權)=唯一與 06-11 拍板(安全鑰匙丙:最敏感表禁直寫)一致的寫入車道。
--
-- 🔴 金流紅線(硬性、DB 層強制):RPC 的 UPDATE SET 清單**字面寫死**恰 5 欄 + version + updated_at,
--   **絕不含** payment_status / fulfillment_status / paid_at / payment_method / 任何金額欄 / tappay_rec_trade_id。
--   workflow_status 純顯示/操作軸(20260714120000 COMMENT 已釘);金流真相軸恆為 payment_status。
--   交易模擬斷言:呼叫後 payment_status/paid_at/payment_method/total byte 不變。
--
-- 🔴 安全模型(對齊 create_order/confirm_payment sibling family + verdict must-fix):
--   ① SECURITY DEFINER + SET search_path=public,pg_temp;函式體物件全 public. 限定(縱深)。
--   ② EXECUTE:REVOKE ALL FROM PUBLIC/anon/authenticated → 只 GRANT service_role(admin server 專用;
--      ⚠️ Supabase default privileges 會自動 re-GRANT service_role=這裡要的,但 anon/authenticated/PUBLIC
--      必顯式 REVOKE + has_function_privilege fail-closed 斷言)。非 authenticated(會員不改單)、非 anon。
--   ③ 樂觀鎖:SELECT ... FOR UPDATE 鎖列 → 驗 version=p_expected_version(來自表單 hidden、Sean 畫面當下值;
--      RPC 絕不重讀當條件=否則恆匹配=樂觀鎖失效)→ 不符回 'CONFLICT'(UI 409 重載)。
--   ④ before/after 同交易:鎖列時讀 before 5 欄 → UPDATE → INSERT admin_audit_log(before/after jsonb)→
--      徹底原子(交接檔③;稽核缺筆不可能=同交易 COMMIT/ROLLBACK)。
--   ⑤ no-op 拒:patch 套用後 5 欄與 before 全等 → 回 'NOOP'(不 bump version、不寫 audit;must-fix 4)。
--   ⑥ 錯誤收斂:業務失敗回固定碼字串(UPDATED/CONFLICT/NOOP);輸入非法 → RAISE 通用訊息(不洩欄值/約束名)。
--
-- 🔴 patch 語意(must-fix 4「未提供 ≠ 清空」用 jsonb key 存在性表達):
--   p_patch = jsonb;key 在=要改該欄、key 不在=不動。值語意:
--     · workflow_status:null=清空(Sean「全清重設」)/ code=設定(須 order_status_options.is_active 命中)
--     · invoice_number:null=清空 / 字串=設定    · invoice_amount:null=清空 / 整數=設定
--     · shipping_method:**不可 null**(orders.shipping_method NOT NULL)   · invoice_status:**不可 null**(NOT NULL、三值)
--   白名單 key 以外的 key 出現 → RAISE(防未來誤傳金流欄)。
--
-- 動手前真 DB 交易模擬:✅ PASS(2026-07-14,project bmpnplmnldofgaohnaok,MCP execute_sql;
--   BEGIN → 先套 20260714120000(依賴)→ 套本檔 → DO 斷言(EXECUTE ACL/樂觀鎖/no-op/金流欄 byte 不變/
--   audit 落一筆/未知 code 拒/patch 非法 key 拒)→ ROLLBACK → 零留痕)。詳單=
--   pcm-tools/review-inbox/m4a-order-workflow-status-c.md(diff 審)。**尚未 apply(等 Sean db push,依賴 20260714120000 先套)。**
--
-- 🔴 無顯式 BEGIN;/COMMIT;(同 20260714120000:supabase CLI ExecBatch 隱式交易;顯式 COMMIT 撞 history 登記)。
-- ============================================================

-- ── 0. order_status_options 保留字:code 不得為 UI 哨兵('unset'=列表篩選未設定 / '__clear__'=改單清空)──
-- Slice D 自訂狀態 code 不靠記憶避開哨兵,DB 層擋(Fable diff nit-3)。
ALTER TABLE public.order_status_options
  ADD CONSTRAINT order_status_options_code_not_reserved CHECK (code NOT IN ('unset', '__clear__'));

-- ── 0b. shipping_method COMMENT:admin 擴充授權(verdict;結帳 create_order 的 home/store 白名單不動)──
COMMENT ON COLUMN public.orders.shipping_method IS
  '出貨方式。結帳 create_order 寫入白名單值(home/store);M-4a Slice C 起 admin 可經 admin_update_order_workflow 改為自由文字(自取/宅配/黑貓/DHL…,設計檔 07-13 Sean 授權)。非空(NOT NULL)。';

-- ── 1. admin_update_order_workflow:後台改單 owner RPC ──────────────────────
CREATE OR REPLACE FUNCTION public.admin_update_order_workflow(
  p_order_id         uuid,
  p_expected_version integer,
  p_patch            jsonb,
  p_actor            text,
  p_request_id       text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_allowed_keys constant text[] := ARRAY[
    'workflow_status', 'shipping_method', 'invoice_number', 'invoice_amount', 'invoice_status'
  ];
  v_key   text;
  v_cur   public.orders%ROWTYPE;
  -- after(patch 套用後的 5 欄;初始化為 before,patch 有 key 才覆蓋)
  v_workflow_status text;
  v_shipping_method text;
  v_invoice_number  text;
  v_invoice_amount  integer;
  v_invoice_status  text;
  v_rows  integer;
BEGIN
  -- 1a. server 供參數 fail-closed(actor 由 server session 解析、非 client;缺=拒,不以未知身分寫稽核)。
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'admin_update_order_workflow: 缺 actor';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id) = '' THEN
    RAISE EXCEPTION 'admin_update_order_workflow: 缺 request_id';
  END IF;
  IF p_order_id IS NULL OR p_expected_version IS NULL THEN
    RAISE EXCEPTION 'admin_update_order_workflow: 缺 order_id / expected_version';
  END IF;
  IF p_expected_version < 1 OR p_expected_version > 2147483646 THEN
    RAISE EXCEPTION 'admin_update_order_workflow: expected_version 越界';
  END IF;

  -- 1b. patch 型別 + 白名單 key(非法 key = 拒,防誤傳金流欄)。
  IF p_patch IS NULL OR pg_catalog.jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'admin_update_order_workflow: patch 非 object';
  END IF;
  FOR v_key IN SELECT pg_catalog.jsonb_object_keys(p_patch) LOOP
    IF NOT (v_key = ANY (v_allowed_keys)) THEN
      RAISE EXCEPTION 'admin_update_order_workflow: patch 含非白名單欄';
    END IF;
  END LOOP;
  IF p_patch = '{}'::jsonb THEN
    RETURN 'NOOP'; -- 空 patch=無事可做(must-fix 4)
  END IF;

  -- 1c. 鎖列 + 讀 before(不存在 → CONFLICT;讓 UI 重載)。
  SELECT * INTO v_cur FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'CONFLICT';
  END IF;

  -- 1d. 樂觀鎖:版本須等於 Sean 畫面渲染當下的 hidden version(不重讀當條件)。
  IF v_cur.version <> p_expected_version THEN
    RETURN 'CONFLICT';
  END IF;

  -- 1e. after 初始化為 before,patch 有 key 才覆蓋 + 逐欄驗證(fail-closed)。
  v_workflow_status := v_cur.workflow_status;
  v_shipping_method := v_cur.shipping_method;
  v_invoice_number  := v_cur.invoice_number;
  v_invoice_amount  := v_cur.invoice_amount;
  v_invoice_status  := v_cur.invoice_status;

  IF p_patch ? 'workflow_status' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'workflow_status') = 'null' THEN
      v_workflow_status := NULL; -- 清空(全清重設)
    ELSE
      v_workflow_status := p_patch ->> 'workflow_status';
      -- 🔴 只在 code **實際變更**時驗 is_active(Fable diff nit-8):明細 form 恆送當前 code,
      --    若該 code 日後被停用,只改發票也送當前 code=不該因此被整筆拒(保留既有指向的設計本意)。
      --    未知/停用/'unset'/'__clear__' 的「新」值仍拒(格式已由 caller/篩選擋、此為孤兒 code fail-closed)。
      IF v_workflow_status IS DISTINCT FROM v_cur.workflow_status
         AND NOT EXISTS (
           SELECT 1 FROM public.order_status_options o
            WHERE o.code = v_workflow_status AND o.is_active
         ) THEN
        RAISE EXCEPTION 'admin_update_order_workflow: workflow_status 非有效啟用狀態';
      END IF;
    END IF;
  END IF;

  IF p_patch ? 'shipping_method' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'shipping_method') = 'null' THEN
      RAISE EXCEPTION 'admin_update_order_workflow: shipping_method 不可為空'; -- NOT NULL
    END IF;
    v_shipping_method := pg_catalog.btrim(p_patch ->> 'shipping_method');
    IF v_shipping_method = '' OR pg_catalog.char_length(v_shipping_method) > 64 THEN
      RAISE EXCEPTION 'admin_update_order_workflow: shipping_method 長度不符';
    END IF;
  END IF;

  IF p_patch ? 'invoice_number' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'invoice_number') = 'null' THEN
      v_invoice_number := NULL; -- 清空
    ELSE
      v_invoice_number := pg_catalog.btrim(p_patch ->> 'invoice_number');
      -- 1..64 + 拒控制字元(must-fix 5)。
      IF v_invoice_number = '' OR pg_catalog.char_length(v_invoice_number) > 64
         OR v_invoice_number ~ '[[:cntrl:]]' THEN
        RAISE EXCEPTION 'admin_update_order_workflow: invoice_number 非法';
      END IF;
    END IF;
  END IF;

  IF p_patch ? 'invoice_amount' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'invoice_amount') = 'null' THEN
      v_invoice_amount := NULL; -- 清空
    ELSE
      IF pg_catalog.jsonb_typeof(p_patch -> 'invoice_amount') <> 'number' THEN
        RAISE EXCEPTION 'admin_update_order_workflow: invoice_amount 非數字';
      END IF;
      v_invoice_amount := (p_patch ->> 'invoice_amount')::integer; -- 溢位由 ::integer 拋
      IF v_invoice_amount < 0 THEN
        RAISE EXCEPTION 'admin_update_order_workflow: invoice_amount 為負';
      END IF;
      -- 嚴格整數:jsonb number 若帶小數(如 10.5)→ ->> 為 '10.5'、::integer 拋 invalid_text_representation。
    END IF;
  END IF;

  IF p_patch ? 'invoice_status' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'invoice_status') = 'null' THEN
      RAISE EXCEPTION 'admin_update_order_workflow: invoice_status 不可為空'; -- NOT NULL
    END IF;
    v_invoice_status := p_patch ->> 'invoice_status';
    IF v_invoice_status NOT IN ('not_issued', 'issued', 'voided') THEN
      RAISE EXCEPTION 'admin_update_order_workflow: invoice_status 非三值之一';
    END IF;
  END IF;

  -- 1f. no-op 拒:5 欄與 before 全等(IS NOT DISTINCT FROM 容 NULL)→ 不 bump、不 audit(must-fix 4)。
  IF v_workflow_status IS NOT DISTINCT FROM v_cur.workflow_status
     AND v_shipping_method IS NOT DISTINCT FROM v_cur.shipping_method
     AND v_invoice_number  IS NOT DISTINCT FROM v_cur.invoice_number
     AND v_invoice_amount  IS NOT DISTINCT FROM v_cur.invoice_amount
     AND v_invoice_status  IS NOT DISTINCT FROM v_cur.invoice_status THEN
    RETURN 'NOOP';
  END IF;

  -- 1g. UPDATE:SET 清單字面寫死恰 5 欄 + version + updated_at(🔴 金流欄一律不在此清單)。
  --     WHERE 帶 version 條件(縱深:與鎖列間無他人插入,但雙保險偵測 lost update)。
  UPDATE public.orders SET
    workflow_status = v_workflow_status,
    shipping_method = v_shipping_method,
    invoice_number  = v_invoice_number,
    invoice_amount  = v_invoice_amount,
    invoice_status  = v_invoice_status,
    version         = v_cur.version + 1,
    updated_at      = pg_catalog.now()
  WHERE id = p_order_id AND version = p_expected_version;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    -- 鎖列後理論上必 1;<>1 = 縱深偵測(防未來 orders 開 FORCE RLS 致 SECURITY DEFINER 靜默 0 列)。
    RAISE EXCEPTION 'admin_update_order_workflow: 更新列數異常(%)', v_rows;
  END IF;

  -- 1h. 同交易寫稽核(before/after 僅本片 5 欄;admin_audit_log owner 全權 INSERT)。
  INSERT INTO public.admin_audit_log (actor, action, target, before, after, request_id, source_app)
  VALUES (
    p_actor,
    'order.workflow.update',
    'order:' || p_order_id::text,
    pg_catalog.jsonb_build_object(
      'workflow_status', v_cur.workflow_status,
      'shipping_method', v_cur.shipping_method,
      'invoice_number',  v_cur.invoice_number,
      'invoice_amount',  v_cur.invoice_amount,
      'invoice_status',  v_cur.invoice_status
    ),
    pg_catalog.jsonb_build_object(
      'workflow_status', v_workflow_status,
      'shipping_method', v_shipping_method,
      'invoice_number',  v_invoice_number,
      'invoice_amount',  v_invoice_amount,
      'invoice_status',  v_invoice_status
    ),
    p_request_id,
    'admin'
  );

  RETURN 'UPDATED';
END;
$$;

COMMENT ON FUNCTION public.admin_update_order_workflow(uuid, integer, jsonb, text, text) IS
  'M-4a Slice C 後台改單(workflow_status/shipping_method/發票紀錄三欄)。SECURITY DEFINER owner RPC(orders 對 service_role 已 REVOKE 直寫、20260611120000 §4)。樂觀鎖 version(來自表單 hidden)、鎖列讀 before→UPDATE(SET 字面恰 5 欄+version+updated_at、金流欄一律不動)→同交易寫 admin_audit_log。回 UPDATED/CONFLICT/NOOP。EXECUTE 僅 service_role。';

-- ── 2. EXECUTE 權限:REVOKE 全 client → 只 GRANT service_role(admin server 專用)──
REVOKE ALL ON FUNCTION public.admin_update_order_workflow(uuid, integer, jsonb, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_order_workflow(uuid, integer, jsonb, text, text)
  TO service_role;

-- ── 3. fail-closed 斷言:EXECUTE ACL 終態 ─────────────────────────────────
DO $$
BEGIN
  IF NOT has_function_privilege('service_role',
      'public.admin_update_order_workflow(uuid, integer, jsonb, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_update_order_workflow ACL 異常 — service_role 應可 EXECUTE(admin 寫入路徑);拒繼續';
  END IF;
  IF has_function_privilege('anon',
      'public.admin_update_order_workflow(uuid, integer, jsonb, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_update_order_workflow ACL 異常 — anon 不應可 EXECUTE;拒繼續';
  END IF;
  IF has_function_privilege('authenticated',
      'public.admin_update_order_workflow(uuid, integer, jsonb, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_update_order_workflow ACL 異常 — authenticated 不應可 EXECUTE(會員不改單);拒繼續';
  END IF;
END
$$;

-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.admin_update_order_workflow(uuid, integer, jsonb, text, text);
--   ALTER TABLE public.order_status_options DROP CONSTRAINT IF EXISTS order_status_options_code_not_reserved;
-- COMMIT;
-- ============================================================

-- ============================================================
-- 交易模擬斷言清單(2026-07-14 PASS;BEGIN→套 20260714120000+本檔→synthetic order→逐條→ROLLBACK→零留痕):
-- 1. EXECUTE ACL:service_role=true、anon=false、authenticated=false(§3 DO 已斷言,模擬獨立再查)。
-- 2. 樂觀鎖:錯 version → 'CONFLICT'、version 不變、無 audit;對 version → 'UPDATED'、version+1。
-- 3. no-op:相同值 patch / 空 patch → 'NOOP'、version 不變、無 audit。
-- 4. 🔴 金流欄 byte 不變:呼叫前後 payment_status/fulfillment_status/paid_at/payment_method/total 完全相等。
-- 5. workflow_status:命中 active code → 成功;停用 code / 未知 code / 'unset' → RAISE。
-- 6. patch 非白名單 key(如 payment_status)→ RAISE(不觸 UPDATE)。
-- 7. invoice_amount 小數(10.5)/ 負數 / 非數字 → RAISE;invoice_status 非三值 → RAISE;
--    shipping_method 空/null → RAISE;invoice_number 控制字元 → RAISE。
-- 8. audit 落一筆:action='order.workflow.update'、target='order:<uuid>'、before/after 為 5 欄 jsonb、
--    source_app='admin'、actor/request_id 對。
-- 9. 清空語意:{"workflow_status":null} → 該欄 NULL;{"invoice_number":null} → NULL。
-- 10. order_status_options code<>'unset' CHECK 生效(INSERT code='unset' 被擋)。
-- 11. ROLLBACK 後零留痕:函式 / CHECK 消失、synthetic order 消失。
-- ============================================================
