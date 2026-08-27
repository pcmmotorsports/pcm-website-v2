-- ============================================================
-- M-3 3DS 乙路 R1a2:find_active_sibling_own(authenticated own-only preflight sibling lookup)+ ACL + 資料最小化
-- ============================================================
-- 真權威:docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md v9 §4 R1a2(逐字)+ §3 權限架構 + §2.3 立即重刷流程 + §9 第 2 片 + §14 步 9。
-- canonical 經 Codex round4→round11 共 8 輪對抗審查、round11 PASS;本片 = §14 唯一 45 步序之步 9(R1 migration bundle 第二片)。
-- 依賴:20260612150000(payment_charge_attempts 表)、20260613130000(orders.cart_session_id)、orders 表(customer_user_id FK customers/payment_status enum)。
-- 鐵則 8(動 schema:新 SECDEF RPC + GRANT)由 canonical plan 滿足、無需新 plan;鐵則 12(payment / RLS·GRANT)→ codex K2 + Codex Packet。
--
-- 🔴 設計(canonical §2.3 / §3 / §4 R1a2):
--   ① 用途:立即重刷流程的 preflight 在 placeOrder 之前,客人放棄付款後點「重新付款」→ chargePaymentAction(server)
--      先 siblingLookup(authenticated own-only)find_active_sibling_own(cart_session_id)判同 cart 是否已有既有單:
--        paid   → 顯既有單(零雙扣、不建新單、不 release)
--        active → settleCharge(existingOrderId)即時裁決 → 4 則 releaseSibling(R1a3)放行重刷
--        none   → proceed 建新單。
--   ② own-only:歸屬鎖死於 DB 內 `auth.uid()`(authenticated SECDEF;不信任 client 傳的 user/order),只看呼叫者自己同 cart 的單。
--      無 JWT(auth.uid() NULL)或 p_cart_session_id NULL → 一律 none(fail-safe、不洩他人單)。
--   ③ 鏡像 begin 安全排序 `(payment_status='paid') DESC, (status='charged') DESC, created_at DESC`;LEFT JOIN active
--      (pending|charged)attempt;🔴 **paid order 即使無 active attempt 也必須被找到**(WHERE = paid OR 有 active attempt)。
--      released/failed 不在 active 集 → released-only sibling 不擋重刷(歸 none、走自己的對帳 policy、與 R1a3 配合)。
--   ④ discriminated union(canonical §4 R1a2、§5 SiblingLookupResult,wire 逐字 = canonical 之 camelCase):
--        {kind:'paid',   existingOrderId, displayId}              (不強迫帶 attemptId)
--        {kind:'active', existingOrderId, attemptId, displayId}   (🔴 資料最小化:不含 recTradeId/bankTransactionId)
--        {kind:'none'}
--      rec/bank 由 payment_confirmer 的 get_active_charge_attempt 內部取(R1b/settleCharge),無須下放 authenticated/browser。
--   ⑤ ACL(canonical §4 R1a2 + §3):`REVOKE ALL FROM PUBLIC, anon, service_role, payment_confirmer` + `GRANT EXECUTE TO authenticated`;
--      矩陣 authenticated=true / anon=false / service_role=false / payment_confirmer=false(PUBLIC 不回授負向角色)。
--      本 migration 含 has_function_privilege fail-closed assert(db push 時即擋 ACL 漂移)。
--   零價、零 PII(只回 order/display id + kind + attempt id;無金額、無 rec/bank/token)。
--
-- ⚠️ 安全 / 守線:本片只寫 migration 檔 + MCP 模擬(零留痕);不 db push(= §14 步 21 Sean)、不 push/merge、不開 flag(TAPPAY_3DS_ENABLED false)。
--   begin / R1a1 既有物件本片不動;release CAS = R1a3、failure observation = R1b3、anomaly = R1b1*、close = R1c3 為後續片。
--
-- 動手前真 DB 交易模擬(MCP execute_sql、project bmpnplmnldofgaohnaok PG17、2026-06-24;單一 atomic DO block + 末端 RAISE
--   強制 rollback;set_config('request.jwt.claims',…) 模擬 auth.uid() own-only、SET LOCAL ROLE anon/authenticated 實呼驗 GRANT
--   (anon/authenticated 為既有 NOLOGIN 角色、pooled MCP 不斷線);payment_confirmer/service_role 走 has_function_privilege
--   等價證據〔SET ROLE payment_confirmer LOGIN 角色 + SECDEF 會斷 pooled MCP、沿用 20260612150000 先例〕;跑後 catalog 複查零留痕):
--   結果回填 commit body / Codex Packet。
--
-- Rollback(Supabase forward-only、僅供參考):DROP FUNCTION IF EXISTS public.find_active_sibling_own(uuid);
-- ============================================================


-- ── find_active_sibling_own(authenticated SECDEF own-only;preflight sibling lookup)──
CREATE OR REPLACE FUNCTION public.find_active_sibling_own(p_cart_session_id uuid)
RETURNS jsonb  -- discriminated union:{kind:'paid'|'active'|'none', existingOrderId?, attemptId?, displayId?}
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_row record;
BEGIN
  -- own-only fail-safe:無 JWT / 無 cart → none(不洩他人單、不誤命中)
  IF v_uid IS NULL OR p_cart_session_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'none');
  END IF;

  -- 鏡像 begin 安全排序;LEFT JOIN active(pending|charged)attempt;paid 即使無 active attempt 也找到
  SELECT o.id          AS order_id,
         o.display_id  AS display_id,
         (o.payment_status = 'paid'::public.payment_status) AS is_paid,
         a.id          AS attempt_id
    INTO v_row
    FROM public.orders o
    LEFT JOIN public.payment_charge_attempts a
      ON a.order_id = o.id AND a.status IN ('pending', 'charged')
   WHERE o.customer_user_id = v_uid
     AND o.cart_session_id  = p_cart_session_id
     AND (o.payment_status = 'paid'::public.payment_status OR a.id IS NOT NULL)
   ORDER BY (o.payment_status = 'paid'::public.payment_status) DESC,
            (a.status = 'charged') DESC,
            o.created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'none');
  END IF;

  IF v_row.is_paid THEN
    -- paid sibling:DB 確定完成 → 顯既有單(不強迫帶 attemptId;資料最小化、無 rec/bank)
    RETURN pg_catalog.jsonb_build_object(
      'kind',            'paid',
      'existingOrderId', v_row.order_id,
      'displayId',       v_row.display_id
    );
  END IF;

  -- active(pending|charged 未 paid):交上層 settleCharge 即時裁決(資料最小化:無 recTradeId/bankTransactionId)
  RETURN pg_catalog.jsonb_build_object(
    'kind',            'active',
    'existingOrderId', v_row.order_id,
    'attemptId',       v_row.attempt_id,
    'displayId',       v_row.display_id
  );
END;
$fn$;

COMMENT ON FUNCTION public.find_active_sibling_own(uuid) IS
  'M-3 3DS R1a2:立即重刷 preflight own-only sibling lookup(authenticated SECDEF、auth.uid() 歸屬、search_path='''')。依 p_cart_session_id 找呼叫者自己同 cart 的既有單,鏡像 begin 排序(paid>charged>pending>最新)、LEFT JOIN active(pending|charged)、paid 即使無 active 也找到。回 discriminated union paid/active/none(資料最小化:active 不含 rec/bank,由 payment_confirmer get_active 內部取)。只 GRANT authenticated。';


-- ── ACL(canonical §4 R1a2 + §3:REVOKE PUBLIC/anon/service_role/payment_confirmer、GRANT authenticated)──
REVOKE ALL ON FUNCTION public.find_active_sibling_own(uuid) FROM PUBLIC, anon, service_role, payment_confirmer;
GRANT EXECUTE ON FUNCTION public.find_active_sibling_own(uuid) TO authenticated;

-- 🔴 函式權限矩陣 fail-closed assert(has_function_privilege 涵蓋直接+繼承+PUBLIC;任一不符 → 擋 db push)
DO $$
BEGIN
  IF NOT has_function_privilege('authenticated', 'public.find_active_sibling_own(uuid)', 'EXECUTE')
     OR has_function_privilege('anon',             'public.find_active_sibling_own(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role',     'public.find_active_sibling_own(uuid)', 'EXECUTE')
     OR has_function_privilege('payment_confirmer','public.find_active_sibling_own(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'find_active_sibling_own EXECUTE 權限矩陣異常 — 應僅 authenticated(canonical §4 R1a2 ACL);拒繼續';
  END IF;
END
$$;

-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):
--   DROP FUNCTION IF EXISTS public.find_active_sibling_own(uuid);
-- ============================================================
