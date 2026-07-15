-- ============================================================
-- M-4a 訂單線 Slice D-2(寫入層):admin_update_order_item_workflow owner RPC
--   (設 order_items.workflow_status 單欄;樂觀鎖 version;同交易寫 admin_audit_log)
--   + §4 收窄 Slice C admin_update_order_workflow(workflow_status 移出白名單=停寫升 DB 強制;
--     Fable 關卡1 verdict REQUIRED-2、Codex R1 must-fix 1 同向)
-- ============================================================
-- 真權威:docs/specs/2026-07-15-m4a-order-list-redesign-slice-d-plan.md §0(A1:item 層=唯一操作
--   真相)+ docs/handoff/2026-07-16-m4a-day2-kickoff.md 施工順序 1(鏡像 Slice C:key 白名單/
--   FOR UPDATE/version 樂觀鎖/同交易 audit target='order_item:<id>')。
-- 模板:20260714130000 admin_update_order_workflow(Slice C;plan R1 verdict 4 裁定+6 must-fix
--   已折入該檔,本檔逐條鏡像、僅 item 層差異處註明)。
-- 鐵則 8(新 SECURITY DEFINER RPC + GRANT)+ 鐵則 12(訂單寫入/金流紅線/稽核/經銷價零外洩)。
-- 依賴:20260604120000(order_items)、20260611120000 §4(order_items 對 service_role 已 REVOKE
--   INSERT/UPDATE/DELETE=本 RPC 存在的根本理由,live 實查 2026-07-16 UPDATE=false)、
--   20260712210000(admin_audit_log)、20260714120000(order_status_options)、
--   20260716120000(order_items 3 新欄;**同批 pending、須先於本檔 apply**)。
--
-- 🔴 金流+品項凍結紅線(硬性、DB 層強制;kickoff 逐字):RPC 的 UPDATE SET 清單**字面寫死**
--   恰 workflow_status + version + updated_at 三欄,**絕不含** quantity / unit_price / line_total /
--   variant_sku / variant_id / product_snapshot(品項凍結快照)/ 任何 orders 表欄(金流真相軸
--   payment_status 在 orders、本 RPC 連 orders 表都不 UPDATE)。
--   交易模擬斷言:呼叫後該 item 的 quantity/unit_price/line_total/variant_*/product_snapshot byte 不變、
--   所屬 orders 列 byte 不變。
--
-- 🔴 安全模型(逐條鏡像 Slice C):
--   ① SECURITY DEFINER + SET search_path=public,pg_temp;函式體物件全 public. 限定(縱深)。
--   ② EXECUTE:REVOKE ALL FROM PUBLIC/anon/authenticated → 只 GRANT service_role(admin server 專用;
--      anon/authenticated/PUBLIC 顯式 REVOKE + has_function_privilege fail-closed 斷言)。
--   ③ 樂觀鎖:SELECT ... FOR UPDATE 鎖 item 列 → 驗 version=p_expected_version(表單 hidden、
--      畫面當下值;RPC 絕不重讀當條件)→ 不符回 'CONFLICT'(UI 409 重載)。
--   ④ before/after 同交易:鎖列讀 before → UPDATE → INSERT admin_audit_log(徹底原子、稽核缺筆不可能)。
--   ⑤ no-op 拒:patch 套用後與 before 相等 → 'NOOP'(不 bump version、不寫 audit)。
--   ⑥ 錯誤收斂:業務失敗回固定碼(UPDATED/CONFLICT/NOOP);輸入非法 → RAISE 通用訊息(不洩欄值)。
--
-- 🔴 patch 語意(鏡像 Slice C「未提供 ≠ 清空」jsonb key 存在性;item 層白名單=**單鍵**):
--   p_patch = jsonb object;白名單 key 恰 ['workflow_status'](未來 item 層加欄再擴)。
--     · workflow_status:null=清空(未設定)/ code=設定(僅**實際變更**時驗 order_status_options
--       is_active 命中;鏡像 Slice C nit-8 孤兒 code 保留設計)。
--   白名單以外 key 出現 → RAISE(防未來誤傳品項凍結欄/金流欄)。
--   空 patch {} → NOOP。
--
-- 動手前真 DB 交易模擬:✅ PASS ×2(2026-07-16,project bmpnplmnldofgaohnaok,MCP execute_sql;
--   與 20260716120000 同一交易串跑:BEGIN → 套兩檔 → 逐條斷言(EXECUTE ACL/樂觀鎖 CONFLICT/
--   NOOP 家族/凍結欄+orders 列 byte 不變/audit 內容/8 種非法輸入拒/孤兒 code 同值 NOOP/停用 code
--   新值拒/清空 NULL)→ ROLLBACK → 零留痕。第一輪=item RPC 版;§4 收窄折入後**重跑第二輪 PASS**
--   (加斷言:收窄版送 workflow_status code/null 皆 RAISE、shipping 照常 UPDATED、orders.workflow_status
--   與金流欄 byte 不變、audit 4 欄無 workflow_status、REPLACE 後 ACL 維持;ROLLBACK 後 live 舊 RPC
--   仍原 5 欄版=零留痕複核)。**尚未 apply(等 Sean db push;依賴 20260716120000 先套)。**
--
-- 🔴 無顯式 BEGIN;/COMMIT;(同 20260714130000:supabase CLI ExecBatch 隱式交易)。
-- ============================================================

-- ── 1. admin_update_order_item_workflow:後台 per-item 改狀態 owner RPC ─────────
CREATE OR REPLACE FUNCTION public.admin_update_order_item_workflow(
  p_item_id          uuid,
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
  v_allowed_keys constant text[] := ARRAY['workflow_status'];
  v_key   text;
  v_cur   public.order_items%ROWTYPE;
  v_workflow_status text;
  v_rows  integer;
BEGIN
  -- 1a. server 供參數 fail-closed(actor 由 server session 解析、非 client;缺=拒)。
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'admin_update_order_item_workflow: 缺 actor';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id) = '' THEN
    RAISE EXCEPTION 'admin_update_order_item_workflow: 缺 request_id';
  END IF;
  IF p_item_id IS NULL OR p_expected_version IS NULL THEN
    RAISE EXCEPTION 'admin_update_order_item_workflow: 缺 item_id / expected_version';
  END IF;
  IF p_expected_version < 1 OR p_expected_version > 2147483646 THEN
    RAISE EXCEPTION 'admin_update_order_item_workflow: expected_version 越界';
  END IF;

  -- 1b. patch 型別 + 白名單 key(非法 key = 拒;防誤傳 quantity/unit_price/line_total/variant_* 等)。
  IF p_patch IS NULL OR pg_catalog.jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'admin_update_order_item_workflow: patch 非 object';
  END IF;
  FOR v_key IN SELECT pg_catalog.jsonb_object_keys(p_patch) LOOP
    IF NOT (v_key = ANY (v_allowed_keys)) THEN
      RAISE EXCEPTION 'admin_update_order_item_workflow: patch 含非白名單欄';
    END IF;
  END LOOP;
  IF p_patch = '{}'::jsonb THEN
    RETURN 'NOOP';
  END IF;

  -- 1c. 鎖列 + 讀 before(不存在 → CONFLICT;讓 UI 重載)。
  SELECT * INTO v_cur FROM public.order_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'CONFLICT';
  END IF;

  -- 1d. 樂觀鎖:版本須等於畫面渲染當下的 hidden version(不重讀當條件)。
  IF v_cur.version <> p_expected_version THEN
    RETURN 'CONFLICT';
  END IF;

  -- 1e. after 初始化為 before,patch 有 key 才覆蓋 + 驗證(fail-closed)。
  v_workflow_status := v_cur.workflow_status;

  IF p_patch ? 'workflow_status' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'workflow_status') = 'null' THEN
      v_workflow_status := NULL; -- 清空(回未設定)
    ELSE
      v_workflow_status := p_patch ->> 'workflow_status';
      -- 🔴 只在 code **實際變更**時驗 is_active(鏡像 Slice C nit-8:保留既有指向的設計本意);
      --    未知/停用/'unset'/'__clear__' 的「新」值仍拒(孤兒 code fail-closed)。
      IF v_workflow_status IS DISTINCT FROM v_cur.workflow_status
         AND NOT EXISTS (
           SELECT 1 FROM public.order_status_options o
            WHERE o.code = v_workflow_status AND o.is_active
         ) THEN
        RAISE EXCEPTION 'admin_update_order_item_workflow: workflow_status 非有效啟用狀態';
      END IF;
    END IF;
  END IF;

  -- 1f. no-op 拒:與 before 相等(IS NOT DISTINCT FROM 容 NULL)→ 不 bump、不 audit。
  IF v_workflow_status IS NOT DISTINCT FROM v_cur.workflow_status THEN
    RETURN 'NOOP';
  END IF;

  -- 1g. UPDATE:SET 清單字面寫死恰 workflow_status + version + updated_at(🔴 品項凍結欄/金流欄
  --     一律不在此清單);WHERE 帶 version 條件(縱深:雙保險偵測 lost update)。
  UPDATE public.order_items SET
    workflow_status = v_workflow_status,
    version         = v_cur.version + 1,
    updated_at      = pg_catalog.now()
  WHERE id = p_item_id AND version = p_expected_version;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    -- 鎖列後理論上必 1;<>1 = 縱深偵測(防未來 order_items 開 FORCE RLS 致 SECURITY DEFINER 靜默 0 列)。
    RAISE EXCEPTION 'admin_update_order_item_workflow: 更新列數異常(%)', v_rows;
  END IF;

  -- 1h. 同交易寫稽核(target='order_item:<id>';before/after 僅本片 1 欄+order_id 脈絡欄,
  --     稽核讀者免 join 即知哪張單;order_id 為識別欄非敏感值)。
  INSERT INTO public.admin_audit_log (actor, action, target, before, after, request_id, source_app)
  VALUES (
    p_actor,
    'order_item.workflow.update',
    'order_item:' || p_item_id::text,
    pg_catalog.jsonb_build_object(
      'workflow_status', v_cur.workflow_status,
      'order_id',        v_cur.order_id
    ),
    pg_catalog.jsonb_build_object(
      'workflow_status', v_workflow_status,
      'order_id',        v_cur.order_id
    ),
    p_request_id,
    'admin'
  );

  RETURN 'UPDATED';
END;
$$;

COMMENT ON FUNCTION public.admin_update_order_item_workflow(uuid, integer, jsonb, text, text) IS
  'M-4a Slice D-2 後台 per-item 狀態改單(order_items.workflow_status 單欄)。SECURITY DEFINER owner RPC(order_items 對 service_role 已 REVOKE 直寫、20260611120000 §4)。樂觀鎖 version(表單 hidden)、鎖列讀 before→UPDATE(SET 字面恰 workflow_status+version+updated_at、品項凍結欄/金流欄一律不動)→同交易寫 admin_audit_log(target=order_item:<id>)。回 UPDATED/CONFLICT/NOOP。EXECUTE 僅 service_role。';

-- ── 2. EXECUTE 權限:REVOKE 全 client → 只 GRANT service_role(admin server 專用)──
REVOKE ALL ON FUNCTION public.admin_update_order_item_workflow(uuid, integer, jsonb, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_order_item_workflow(uuid, integer, jsonb, text, text)
  TO service_role;

-- ── 3. fail-closed 斷言:EXECUTE ACL 終態(Fable D-2 diff verdict REQUIRED-2:抽查 3 角色升級為
--     aclexplode **全 ACL allowlist=恰 {postgres, service_role}**——自訂角色〔如 payment_confirmer〕
--     真實存在,逐角色抽查會漏、allowlist 不會)─────────────────────────────
DO $$
DECLARE
  v_bad text;
BEGIN
  IF (SELECT proacl IS NULL FROM pg_catalog.pg_proc
       WHERE oid = 'public.admin_update_order_item_workflow(uuid, integer, jsonb, text, text)'::regprocedure) THEN
    RAISE EXCEPTION 'admin_update_order_item_workflow ACL 異常 — proacl 為預設(隱含 PUBLIC EXECUTE);拒繼續';
  END IF;
  SELECT string_agg(COALESCE(r.rolname, 'PUBLIC'), ', ') INTO v_bad
    FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
    LEFT JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
   WHERE p.oid = 'public.admin_update_order_item_workflow(uuid, integer, jsonb, text, text)'::regprocedure
     AND COALESCE(r.rolname, 'PUBLIC') NOT IN ('postgres', 'service_role');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'admin_update_order_item_workflow ACL 異常 — 非白名單 grantee:%;拒繼續', v_bad;
  END IF;
  IF NOT has_function_privilege('service_role',
      'public.admin_update_order_item_workflow(uuid, integer, jsonb, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_update_order_item_workflow ACL 異常 — service_role 應可 EXECUTE(admin 寫入路徑);拒繼續';
  END IF;
END
$$;

-- ── 4. orders.workflow_status「停寫」升 DB 強制(Fable 關卡1 verdict REQUIRED-2)──────
-- CREATE OR REPLACE Slice C RPC(簽名不變、REPLACE 保留 EXECUTE ACL):
--   · v_allowed_keys **移除 'workflow_status'** → 任何呼叫端送該 key = RAISE(非靜默忽略);
--   · UPDATE SET / audit before-after 降為 4 業務欄(shipping_method+發票三欄)+version+updated_at;
--   · 金流紅線不變(SET 字面絕不含 payment_status/paid_at/payment_method/金額欄)。
-- 理由(verdict 逐字):「只靠 UI 不送 key 是約定不是強制,未來任何呼叫端補送 key 就讓 order 層
--   與 item 衍生顯示靜默分岔」。TS 層已同步關死(parser 忽略/patch 型別無該欄/adapter 不映射)=雙層。
-- 🔴 部署順序(verdict 寫死):**先 db push、後 git push** —— 新 UI 投影選 order_items 新欄,
--   migration 未套先上 code = 列表整頁炸;反向僅舊明細改單短窗報錯(單人後台可接受)。
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
  -- 🔴 D-2:workflow_status 已自白名單移除(orders 層停寫;狀態唯一寫入面=admin_update_order_item_workflow)。
  v_allowed_keys constant text[] := ARRAY[
    'shipping_method', 'invoice_number', 'invoice_amount', 'invoice_status'
  ];
  v_key   text;
  v_cur   public.orders%ROWTYPE;
  v_shipping_method text;
  v_invoice_number  text;
  v_invoice_amount  integer;
  v_invoice_status  text;
  v_rows  integer;
BEGIN
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

  IF p_patch IS NULL OR pg_catalog.jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'admin_update_order_workflow: patch 非 object';
  END IF;
  FOR v_key IN SELECT pg_catalog.jsonb_object_keys(p_patch) LOOP
    IF NOT (v_key = ANY (v_allowed_keys)) THEN
      -- workflow_status(D-2 起)與金流欄一律落此:送到=拒。
      RAISE EXCEPTION 'admin_update_order_workflow: patch 含非白名單欄';
    END IF;
  END LOOP;
  IF p_patch = '{}'::jsonb THEN
    RETURN 'NOOP';
  END IF;

  SELECT * INTO v_cur FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'CONFLICT';
  END IF;
  IF v_cur.version <> p_expected_version THEN
    RETURN 'CONFLICT';
  END IF;

  v_shipping_method := v_cur.shipping_method;
  v_invoice_number  := v_cur.invoice_number;
  v_invoice_amount  := v_cur.invoice_amount;
  v_invoice_status  := v_cur.invoice_status;

  IF p_patch ? 'shipping_method' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'shipping_method') = 'null' THEN
      RAISE EXCEPTION 'admin_update_order_workflow: shipping_method 不可為空';
    END IF;
    v_shipping_method := pg_catalog.btrim(p_patch ->> 'shipping_method');
    IF v_shipping_method = '' OR pg_catalog.char_length(v_shipping_method) > 64 THEN
      RAISE EXCEPTION 'admin_update_order_workflow: shipping_method 長度不符';
    END IF;
  END IF;

  IF p_patch ? 'invoice_number' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'invoice_number') = 'null' THEN
      v_invoice_number := NULL;
    ELSE
      v_invoice_number := pg_catalog.btrim(p_patch ->> 'invoice_number');
      IF v_invoice_number = '' OR pg_catalog.char_length(v_invoice_number) > 64
         OR v_invoice_number ~ '[[:cntrl:]]' THEN
        RAISE EXCEPTION 'admin_update_order_workflow: invoice_number 非法';
      END IF;
    END IF;
  END IF;

  IF p_patch ? 'invoice_amount' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'invoice_amount') = 'null' THEN
      v_invoice_amount := NULL;
    ELSE
      IF pg_catalog.jsonb_typeof(p_patch -> 'invoice_amount') <> 'number' THEN
        RAISE EXCEPTION 'admin_update_order_workflow: invoice_amount 非數字';
      END IF;
      v_invoice_amount := (p_patch ->> 'invoice_amount')::integer;
      IF v_invoice_amount < 0 THEN
        RAISE EXCEPTION 'admin_update_order_workflow: invoice_amount 為負';
      END IF;
    END IF;
  END IF;

  IF p_patch ? 'invoice_status' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'invoice_status') = 'null' THEN
      RAISE EXCEPTION 'admin_update_order_workflow: invoice_status 不可為空';
    END IF;
    v_invoice_status := p_patch ->> 'invoice_status';
    IF v_invoice_status NOT IN ('not_issued', 'issued', 'voided') THEN
      RAISE EXCEPTION 'admin_update_order_workflow: invoice_status 非三值之一';
    END IF;
  END IF;

  IF v_shipping_method IS NOT DISTINCT FROM v_cur.shipping_method
     AND v_invoice_number  IS NOT DISTINCT FROM v_cur.invoice_number
     AND v_invoice_amount  IS NOT DISTINCT FROM v_cur.invoice_amount
     AND v_invoice_status  IS NOT DISTINCT FROM v_cur.invoice_status THEN
    RETURN 'NOOP';
  END IF;

  -- SET 字面恰 4 業務欄+version+updated_at(🔴 workflow_status 與金流欄一律不在此清單)。
  UPDATE public.orders SET
    shipping_method = v_shipping_method,
    invoice_number  = v_invoice_number,
    invoice_amount  = v_invoice_amount,
    invoice_status  = v_invoice_status,
    version         = v_cur.version + 1,
    updated_at      = pg_catalog.now()
  WHERE id = p_order_id AND version = p_expected_version;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'admin_update_order_workflow: 更新列數異常(%)', v_rows;
  END IF;

  INSERT INTO public.admin_audit_log (actor, action, target, before, after, request_id, source_app)
  VALUES (
    p_actor,
    'order.workflow.update',
    'order:' || p_order_id::text,
    pg_catalog.jsonb_build_object(
      'shipping_method', v_cur.shipping_method,
      'invoice_number',  v_cur.invoice_number,
      'invoice_amount',  v_cur.invoice_amount,
      'invoice_status',  v_cur.invoice_status
    ),
    pg_catalog.jsonb_build_object(
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
  'M-4a Slice C 後台改單;D-2(20260716130000)起收窄為 4 業務欄(shipping_method/invoice_number/invoice_amount/invoice_status)——workflow_status 自白名單移除(送到=RAISE;orders.workflow_status 停寫、狀態唯一寫入面=admin_update_order_item_workflow)。SECURITY DEFINER owner RPC、樂觀鎖 version、同交易 admin_audit_log。回 UPDATED/CONFLICT/NOOP。EXECUTE 僅 service_role(REPLACE 保留 ACL、§5 斷言複核)。';

-- ── 5. fail-closed 斷言:REPLACE 後 Slice C RPC 的 EXECUTE ACL 維持終態(同 §3 aclexplode
--     allowlist;REQUIRED-2)──────────────────────────────────────────────
DO $$
DECLARE
  v_bad text;
BEGIN
  IF (SELECT proacl IS NULL FROM pg_catalog.pg_proc
       WHERE oid = 'public.admin_update_order_workflow(uuid, integer, jsonb, text, text)'::regprocedure) THEN
    RAISE EXCEPTION 'admin_update_order_workflow ACL 異常 — proacl 為預設(隱含 PUBLIC EXECUTE);拒繼續';
  END IF;
  SELECT string_agg(COALESCE(r.rolname, 'PUBLIC'), ', ') INTO v_bad
    FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
    LEFT JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
   WHERE p.oid = 'public.admin_update_order_workflow(uuid, integer, jsonb, text, text)'::regprocedure
     AND COALESCE(r.rolname, 'PUBLIC') NOT IN ('postgres', 'service_role');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'admin_update_order_workflow ACL 異常 — 非白名單 grantee:%;拒繼續', v_bad;
  END IF;
  IF NOT has_function_privilege('service_role',
      'public.admin_update_order_workflow(uuid, integer, jsonb, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_update_order_workflow ACL 異常 — service_role 應可 EXECUTE;拒繼續';
  END IF;
END
$$;

-- ============================================================
-- Rollback(Supabase forward-only、僅供參考):
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.admin_update_order_item_workflow(uuid, integer, jsonb, text, text);
--   -- admin_update_order_workflow 回滾 = 重跑 20260714130000 §1 原版 CREATE OR REPLACE(5 欄版)。
-- COMMIT;
-- ============================================================

-- ============================================================
-- 交易模擬斷言清單(與 20260716120000 同一模擬串跑;BEGIN→套兩檔→synthetic item→逐條→ROLLBACK→零留痕):
-- 1. EXECUTE ACL:service_role=true、anon=false、authenticated=false。
-- 2. 樂觀鎖:錯 version → 'CONFLICT'、version 不變、無 audit;對 version → 'UPDATED'、version+1、
--    updated_at 非倒退(⚠️ 同一模擬交易內 now() 恆定、只能斷言不倒退;真環境為前進)。
-- 3. no-op:相同值 patch / 空 patch {} → 'NOOP'、version 不變、無 audit;不存在 item → 'CONFLICT'。
-- 4. 🔴 品項凍結+金流欄 byte 不變:呼叫前後該 item 的 quantity/unit_price/line_total/variant_sku/
--    variant_id/product_snapshot 完全相等;所屬 orders 列(payment_status/paid_at/total/version/
--    workflow_status)完全相等(本 RPC 連 orders 都不碰)。
-- 5. workflow_status:命中 active code → 成功;停用 code / 未知 code / 'unset' / '__clear__' → RAISE;
--    {"workflow_status":null} → 清空 NULL;既有孤兒 code 不變更時送同值 → NOOP 不炸。
-- 6. patch 非白名單 key(quantity / unit_price / payment_status)→ RAISE(不觸 UPDATE)。
-- 7. audit 落一筆:action='order_item.workflow.update'、target='order_item:<uuid>'、
--    before/after={workflow_status, order_id}、source_app='admin'、actor/request_id 對。
-- 8. 缺 actor / 缺 request_id / patch 非 object → RAISE。
-- 9. §4 收窄版 Slice C RPC:送 {"workflow_status":...} → RAISE(停寫 DB 強制);
--    送 shipping/invoice keys → 照常 UPDATED(4 欄+version+updated_at、orders.workflow_status
--    與金流欄 byte 不變);ACL 維持(service_role only)。
-- 10. ROLLBACK 後零留痕:函式消失(admin_update_order_workflow 回 live 5 欄版)、synthetic 資料消失。
-- ============================================================
