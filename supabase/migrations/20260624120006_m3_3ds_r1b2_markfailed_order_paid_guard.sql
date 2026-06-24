-- ============================================================
-- M-3 3DS 乙路 R1b2:mark_charge_attempt_failed 加 order-paid guard(fail-closed)+ 釘死僅 pending→failed
-- ============================================================
-- 真權威:docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md v9 §4 R1b2(行 180-181、逐字)+ §10.4(攻擊時序)+ §9 第 7 片 + §14 步 16。
-- canonical 經 Codex round4→11 共 8 輪、round11 PASS;本片 = §14 唯一 45 步序之步 16(R1 migration bundle 第七片)。
-- 依賴:20260612150000(mark_charge_attempt_failed 基線本體 = 本片 CREATE OR REPLACE 改它 + payment_confirmer EXECUTE GRANT)、
--       20260604120000(orders.payment_status enum / orders.id)、20260624120000 R1a1('released' 狀態)。
-- 鐵則 8(動既有 payment RPC)由 canonical 滿足、無需新 plan;鐵則 12(payment / 鎖 / migration)→ codex K2 + Codex Packet。分級 N/A(純狀態機標記、非 L3)。
--
-- 🔴 設計(canonical §4 R1b2 行 180-181 + §10.4):
--   ① order-paid guard(fail-closed、本片唯一新增邏輯):同交易 `SELECT payment_status FROM public.orders WHERE id=order FOR UPDATE`,
--      `payment_status <> 'unpaid'`(paid / refunded / partiallyPaid)→ RAISE 通用訊息。
--      杜絕「已付款單被標 failed」=late success 已把 order 翻 paid,卻把 attempt 標 failed → 退出對帳集 = 幽靈/錯解鎖(§10.4)。
--      🔴 FOR UPDATE 序列化對 `confirm_order_payment`(orders-only 鎖)→ 防 TOCTOU(guard 讀 unpaid 後 confirm 並發翻 paid 再 markFailed)。
--      🔴 鎖序安全(無死結):本 RPC = attempt FOR UPDATE(基線)→ orders FOR UPDATE(本片新增);全庫唯一 orders FOR UPDATE 持有者 = confirm_order_payment(orders-only、不鎖 attempt),
--         其餘動 attempt 者(markCharged / sweeper 4a2 `FOR UPDATE OF a SKIP LOCKED` / S2b / release R1a3)皆 attempt-only 鎖或唯讀 orders → 無 order→attempt 反向鎖序 → 無 A-B/B-A 死結。
--   ② 釘死僅 pending→failed:UPDATE WHERE `status='pending'`(基線逐字不動)→ **released→failed 隨 status 述詞自然排除**(canonical「移除 released→failed」;released 走自己的對帳 policy §2.5 + 人工 close R1c3、非 markFailed);
--      charged→failed 永拒(rowcount=0 RAISE、不可解鎖已扣款單);failed→failed no-op(基線、放在 guard 前 → 已 failed 重試恆 no-op 不受 order 狀態影響)。
--
-- 🔴 零漂移(字面 vs 事實):除「新增 order-paid guard 區塊」+「新增 DECLARE v_order_status」外,基線 mark_charge_attempt_failed(20260612150000 §5)邏輯逐字不動:
--   雙鍵 SELECT + FOR UPDATE / NOT FOUND RAISE / failed→failed no-op RETURN / UPDATE WHERE status='pending' / GET DIAGNOSTICS rowcount<>1 RAISE /
--   SECDEF + search_path='' + 全識別子 schema-qualified / PF-E 通用訊息 逐字保留。
--   🔴 基線既有行(DECLARE v_row/v_n/v_generic_msg spacing + 兩條 inline 註解)**byte-identical 逐字保留**(codex K2 round1 抓 cosmetic drift → 還原);函式本體與基線差異 = 僅「DECLARE v_order_status 一行」+「order-paid guard 區塊」兩處。
--   **COMMENT ON FUNCTION 更新為反映新行為**(order-paid guard / released 排除;字面 vs 事實要求 docstring 與實際一致、不保留舊 docstring;非 silent drift、本檔已聲明)。
--   **ACL 不改**(沿用 20260612150000 既有 GRANT:payment_confirmer EXECUTE;bare CREATE OR REPLACE 保留既有 GRANT,本片無 REVOKE/GRANT/ALTER/新物件)。
--
-- ⚠️ 守線:本片只 CREATE OR REPLACE 既有函式(無新表 / 無 ALTER 表 / 無 ACL 異動)+ MCP 模擬(零留痕);
--   不 db push(= §14 步 21 Sean、R1 bundle 連帶 S2b=live)、不 push / merge、不開 flag(TAPPAY_3DS_ENABLED false)。begin / R1a-b / 既有物件本片不動。
--
-- 動手前真 DB 交易模擬(MCP execute_sql、project bmpnplmnldofgaohnaok PG17、2026-06-24;單一 atomic DO block:
--   先套 R1a1 DDL('released' 狀態)→ REPLACE 本片函式(先放基線本體再 REPLACE)→ 合成 order(unpaid/paid/refunded)+ attempt(pending/charged/failed/released)→ 行為測 → 末端 RAISE 強制 rollback、零留痕:
--   ① pending + order unpaid → markFailed 成功(pending→failed)
--   ② pending + order paid → guard RAISE、attempt 維持 pending(已付款單不被標 failed)
--   ③ pending + order refunded → guard RAISE、attempt 維持 pending(非 unpaid 一律擋)
--   ④ charged + order unpaid → rowcount=0 RAISE、attempt 維持 charged(charged→failed 永拒)
--   ⑤ failed + order paid → no-op RETURN(failed→failed 冪等、guard 不觸及、不受 order 狀態影響)
--   ⑥ released + order unpaid → rowcount=0 RAISE、attempt 維持 released(released→failed 排除)
--   ⑦ 雙鍵不符(attempt/order 配對錯)→ NOT FOUND RAISE
--   ⑧ ACL 沿用基線:has_function_privilege(payment_confirmer)=true、anon/authenticated/service_role=false(REPLACE 保留既有 GRANT)。
--   ✅ PASS(2026-06-24、單一 atomic DO block、SENTINEL_OK_R1B2 末端 RAISE 強制 rollback):
--     T1 pending+unpaid→failed;T2 pending+paid→guard RAISE 維持 pending;T3 pending+refunded→guard RAISE 維持 pending;
--     T4 charged+unpaid→rowcount=0 RAISE 維持 charged;T5 failed+paid→no-op RETURN 維持 failed(guard 不觸及、不受 order 狀態);
--     T6 released+unpaid→rowcount=0 RAISE 維持 released(移除 released→failed);T7 雙鍵不符→NOT FOUND RAISE;
--     T8 ACL 沿用基線(payment_confirmer=T / anon·authenticated·service_role=F、REPLACE 保留 GRANT)。
--     residue 複查:status_check_has_released=0 / markfailed_guard_residue=0 / fn_cnt=1(回基線)/ prod payment_confirmer EXECUTE=true(線上 ACL 未擾動)= 零留痕。
--   跑後 pg_proc 複查 markFailed 回基線定義(無 order-paid guard 殘留)、零留痕。結果回填 commit body / Codex Packet。
--   ⚠️ 死結/TOCTOU 序列化屬並發性質、單連線模擬不可證 → 上方鎖序分析 + 真雙連線留執行 session 雙 psql(canonical §12)。
--
-- 審查鏈(誠實記):code-reviewer PASS 0 must-fix/0 nit(獨立複驗全 repo 鎖序無 order→attempt 反向)。
--   codex K2 round1 = FAIL 1 must-fix,但 must-fix 為 **cosmetic ZERO-DRIFT**(DECLARE spacing 對齊 + 兩條 baseline inline 註解被加字);**功能/資安七項全 PASS**(guard 正確、僅 pending→failed、鎖序無死結、ACL 沿用、search_path 硬化、無 fail-open)。
--   → 已修:還原 baseline byte-identical(程式逐行驗:staged 函式本體 −[v_order_status 行 + guard 區塊]== baseline 函式本體、零差異);函式本體與基線差異僅該二處 + COMMENT ON FUNCTION 更新(字面 vs 事實必需)。
--   codex K2 round2(複核此 cosmetic 修正)撞 **codex 週級 quota 牆(reset 2026-06-29 14:01)**、本輪未能跑 → Sean 2026-06-24 明確授權「現在 commit、round2 複核順延 quota 重置」(比照 PRD round3 突破先例;round1 已實審邏輯且功能面全 PASS、修正為純排版回退)。
--
-- Rollback(Supabase forward-only、僅供參考):CREATE OR REPLACE 回 20260612150000 基線本體(無 order-paid guard)。見檔尾。
-- ============================================================


-- ── mark_charge_attempt_failed(R1b2:order-paid guard + 釘死 pending→failed;基線 20260612150000 §5)──
CREATE OR REPLACE FUNCTION public.mark_charge_attempt_failed(
  p_attempt_id uuid,
  p_order_id   uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_row         record;
  v_order_status public.payment_status;  -- 🔴 R1b2 唯一新增 DECLARE(order-paid guard 來源)
  v_n           integer;
  v_generic_msg constant text := 'mark_charge_attempt_failed: 付款處理失敗';  -- PF-E
BEGIN
  -- 雙鍵驗 + FOR UPDATE(序列化重試)
  SELECT id, status
    INTO v_row
    FROM public.payment_charge_attempts
   WHERE id = p_attempt_id AND order_id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 冪等:failed→failed no-op(主軌 ×3 重試安全);🔴 charged→failed 永遠拒(不可解鎖已扣款單)
  IF v_row.status = 'failed' THEN
    RETURN;
  END IF;

  -- 🔴 R1b2 order-paid guard(fail-closed):同交易鎖 order、payment_status<>'unpaid' → RAISE(已付款單不被標 failed、§4 R1b2 + §10.4)
  --    FOR UPDATE 序列化對 confirm_order_payment(orders-only 鎖)→ 防 TOCTOU;鎖序 attempt→order 無 order→attempt 反向路徑(見檔頭鎖序分析)。
  SELECT payment_status
    INTO v_order_status
    FROM public.orders
   WHERE id = p_order_id
   FOR UPDATE;
  IF NOT FOUND OR v_order_status <> 'unpaid'::public.payment_status THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  UPDATE public.payment_charge_attempts
     SET status     = 'failed',
         updated_at = pg_catalog.now()
   WHERE id = p_attempt_id AND order_id = p_order_id AND status = 'pending';

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;
END;
$fn$;

COMMENT ON FUNCTION public.mark_charge_attempt_failed(uuid, uuid) IS
  'M-3 3DS R1b2 卡拒(TapPay 明確未扣款)釋 per-order 鎖:pending→failed + 🔴 order-paid guard(同交易鎖 order、payment_status<>unpaid → RAISE,杜絕已付款單被標 failed=late success 退出對帳;FOR UPDATE 序列化對 confirm 防 TOCTOU、鎖序 attempt→order 無死結)。雙鍵驗 + failed 冪等 no-op(guard 前、不受 order 狀態影響)+ charged→failed 永拒 + released→failed 隨 status=pending 述詞排除(走 R1c3 close/§2.5 policy)。只 payment_confirmer 可呼(ACL 沿用基線、不改)。';


-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):
--   CREATE OR REPLACE FUNCTION public.mark_charge_attempt_failed(uuid, uuid) … 回 20260612150000 基線本體
--   (無 order-paid guard 區塊、無 v_order_status DECLARE)。
-- ============================================================
