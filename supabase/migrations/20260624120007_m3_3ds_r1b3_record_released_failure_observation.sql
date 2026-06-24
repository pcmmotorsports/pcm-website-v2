-- ============================================================
-- M-3 3DS 乙路 R1b3:record_released_failure_observation 窄權 RPC(三參數雙鍵 + 輸入守衛 + write-once)+ get_active 含 released
-- ============================================================
-- 真權威:docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md v9 §4 R1b3(行 183-188、逐字)+ §2.5(released 對帳 policy)+ §10.3(攻擊時序)+ §9 第 8 片 + §14 步 17。
-- canonical 經 Codex round4→11 共 8 輪、round11 PASS;本片 = §14 唯一 45 步序之步 17(R1 migration bundle 第八片)。
-- 依賴:20260612150000(payment_charge_attempts 表)、20260624120000 R1a1(failure_observed_at/failure_observed_status 欄 + 兩 CHECK〔僅 -1/5、雙鍵成對〕+ 'released' 狀態)、
--       20260614120000 1b(get_active_charge_attempt 基線 = 本片 CREATE OR REPLACE 改它〔加 released〕)、20260604120000(orders.payment_status enum)、20260611120000(payment_confirmer 角色)。
-- 鐵則 8(新 RPC + GRANT + 改既有讀 RPC)由 canonical 滿足;鐵則 12(payment / 對帳 / migration / GRANT)→ codex K2 + Codex Packet。分級 N/A(對帳狀態觀察標記、非 L3)。
--
-- 🔴 設計(canonical §4 R1b3 行 184-188 + §2.5 + §10.3):
--   ① record_released_failure_observation(p_attempt_id, p_order_id, p_observed_status):released attempt 遇 Record -1/5 首次觀察 write-once 雙鍵標記。
--      語意 = released 持續對帳中觀察到「TapPay 端確定失敗(-1)/付款失敗(5)」→ 記時間 + 狀態供 sweeper/use-case 判斷;**不改 status**(observation ≠ terminal、released 仍續對帳、§2.5),杜絕「提早 failed 退出對帳=幽靈扣款」(§10.3)。
--      - 🔴 輸入守衛(fail-closed):p_observed_status 僅 -1 或 5,其他值(含 NULL)→ RAISE。
--      - 雙鍵 + status='released' 查 attempt(`id=p_attempt_id AND order_id=p_order_id AND status='released'`)**FOR UPDATE**(write-once 序列化 + 對 markCharged released→charged 序列化〔同表同列 FOR UPDATE〕);找不到/雙鍵不符/非 released → RAISE fail-closed。
--      - order 必 unpaid:同交易讀 order.payment_status,`<>'unpaid'` → RAISE fail-closed(已付款/已收斂單不記觀察)。🔴 此處 order 走**唯讀**(非 FOR UPDATE):observation 為 advisory write-once、不改 money state、order-unpaid 為粗閘;不同於 R1b2 markFailed(狀態轉移、須 FOR UPDATE 序列化 confirm);attempt FOR UPDATE 已序列化 write-once 對 markCharged。鎖序 attempt-only(order 唯讀)→ 無死結。
--      - 🔴 write-once 雙鍵 COALESCE(canonical 行 187 逐字):`SET failure_observed_at=COALESCE(failure_observed_at,now()), failure_observed_status=COALESCE(failure_observed_status,p_observed_status)`(**僅此二欄、不動 status/updated_at**);重放不覆蓋第一次觀察(時間+狀態皆 COALESCE)。R1a1 雙 CHECK(僅 -1/5、雙鍵成對)由此 RPC 保證恆滿足。
--      - 🔴 ACL:REVOKE PUBLIC/anon/authenticated/service_role(顯式含 service_role:Supabase ALTER DEFAULT PRIVILEGES 對新函式直接 grant service_role、REVOKE PUBLIC 收不掉)+ GRANT payment_confirmer;has_function_privilege 矩陣 assert(payment_confirmer=T、其餘 F)+ payment_confirmer role-hygiene(table/column grants=0)assert。
--      - SECDEF + search_path='' + 全識別子 schema-qualified;PF-E 單一通用訊息(不洩內部狀態/存在與否)。
--   ② get_active_charge_attempt 改:active 集 `status IN ('pending','charged')` → `('pending','charged','released')`(§2.6:settleCharge 對帳 released 舊單反查、late success markCharged 用)。
--      🔴 零漂移:基線(20260614120000)函式本體 byte-identical,唯一功能改 = active 集 +released;連帶 inline 註解 + COMMENT ON FUNCTION 同步反映 released(字面 vs 事實要求 docstring 與行為一致)。ACL 沿用基線(payment_confirmer EXECUTE、bare CREATE OR REPLACE 保留 GRANT、本片對 get_active 無 REVOKE/GRANT)。
--      🔴 **app-side 相容性依賴 + db-push/flag gate(codex K2 round1 抓、真實 finding、已記)**:現行 app parser/type 只收 pending|charged、遇 released 會 throw —— `packages/domain/src/payment/types.ts` `ActiveChargeAttempt.status:'pending'|'charged'` + `packages/adapters/src/payment/PgChargeAttemptAdapter.ts` `parseActiveAttempt`(`o.status !== 'pending' && o.status !== 'charged'` → `ChargeAttemptParseError`)。**修補在 R2a**(canonical §9「parser 對 released」+ SettleChargeOutcome `released_failure_observed` / `IChargeAttemptStore.recordReleasedFailureObservation` 三參數 / §14 步23)。
--      **安全序(§14 已守、本片不 db-push)— 護欄 = producer-gating、非 read-path flag-gating(對抗 Opus 複審 2026-06-25 校正)**:
--        ⚠️ 精度:get_active 的呼叫端多數**未** flag-gated(settle-charge 經 payment-status poll route / tappay-notify webhook / callback page / sweeper 觸發,僅 charge-actions.ts 走 isThreeDsEnabled),故「flag 擋讀路徑→parser 不遇 released」**不成立**(讀路徑本身無 flag 保護)。
--        真正保證 = **released row 根本不存在**:唯一產生點 = R1a3 release CAS(20260624120002 `SET status='released'`、payment_confirmer-only、僅 3DS 棄單重買流可達),而該流(a)**現今零 app caller**(尚未接線、grep 證)+(b)自身 `TAPPAY_3DS_ENABLED` flag-gated(§14 步44 才開)→ 無任何路徑產生 released row → get_active 對**全部呼叫端**永不回 released → 舊 parser 永不遇 released。
--        §14 步21 R1 bundle db push 後至 R2a deploy(步41)前同理安全(producer 不可達);rollout gate(步43)強制「R1/R2/R3 全完成」、flag-on(步44)必在 R2a deploy 之後 → **不相容窗不存在**。
--      🔴 **gate(硬性)**:get_active+released 不得在 R2a(parser 對 released)未進同 deployable bundle + deploy 前開 `TAPPAY_3DS_ENABLED`(已由 §14 步43/44 rollout gate 守;本片只 commit、不 db-push、不開 flag)。
--
-- ⚠️ 守線:本片新增 1 migration(1 新 RPC + ACL/assert + CREATE OR REPLACE 既有讀 RPC)+ MCP 模擬(零留痕);
--   不 db push(= §14 步 21 Sean、R1 bundle 連帶 S2b=live)、不 push / merge、不開 flag(TAPPAY_3DS_ENABLED false)。begin / R1a-b / 其餘既有物件本片不動。
--
-- 動手前真 DB 交易模擬(MCP execute_sql、project bmpnplmnldofgaohnaok PG17、2026-06-24;單一 atomic DO block:
--   先套 R1a1 DDL('released' + failure_observed 兩欄 + 兩 CHECK)→ 建本片 RPC + REPLACE get_active → 合成 order/attempt → 行為測 → 末端 RAISE 強制 rollback、零留痕):
--   record_released_failure_observation:① released+unpaid+(-1) → write 成功〔failure_observed_at 非 NULL/status=-1、attempt.status 仍 released〕② released+unpaid+(5) → 成功
--     ③ 重放(已觀察)→ COALESCE 不覆蓋第一次(時間+狀態原值)④ p_observed_status=0/99/NULL → 輸入守衛 RAISE ⑤ 非 released(pending/charged)→ RAISE ⑥ order 已 paid → RAISE ⑦ 雙鍵不符(order 不符)→ RAISE ⑧ 找不到 → RAISE
--     ⑨ ACL 矩陣:has_function_privilege payment_confirmer=T / anon·authenticated·service_role=F + role-hygiene table/column grants=0。
--   get_active_charge_attempt:⑩ released attempt → 現回非 NULL(含 rec/bank/status=released)〔基線僅 pending|charged 會回 NULL〕⑪ pending/charged 不回歸 ⑫ failed 仍 NULL。
--   ✅ PASS(2026-06-24、單一 atomic DO block、SENTINEL_OK_R1B3 末端 RAISE 強制 rollback):T1 released+unpaid+-1→寫成功 status 仍 released / T2 +5→成功 /
--     T3 重放 COALESCE 不覆蓋第一次(-1+at 原值)/ T4 輸入守衛 0·99·NULL→RAISE / T5 非 released(pending/charged)→RAISE / T6 order paid→RAISE fail-closed /
--     T7 雙鍵不符→RAISE / T8 找不到→RAISE / T9 ACL(payment_confirmer=T、anon·authenticated·service_role=F)/ T10 get_active released→非 NULL status=released /
--     T11 get_active pending·charged 不回歸 / T12 get_active 僅 failed→NULL。residue 複查:record_fn=0 / failure_col=0 / status_released=0 / get_active_released=0 / get_active_fn=1(回基線)= 零留痕。
--   跑後 pg_proc 複查 record RPC absent / get_active 回基線(active 集無 released)、零留痕。結果回填 commit body / Codex Packet。
--   ⚠️ payment_confirmer literal 實呼於 pooled MCP 必斷(S2-c/d 多次重現)→ ACL 以 has_function_privilege 矩陣等價覆蓋;真連線 round-trip 由 adapter/route 補。
--
-- Rollback(Supabase forward-only、僅供參考):DROP record_released_failure_observation;CREATE OR REPLACE get_active 回 20260614120000 基線(active 集 pending|charged)。見檔尾。
-- ============================================================


-- ── 1. record_released_failure_observation(三參數雙鍵 + 輸入守衛 + write-once;canonical §4 R1b3 #12)──
CREATE OR REPLACE FUNCTION public.record_released_failure_observation(
  p_attempt_id      uuid,
  p_order_id        uuid,
  p_observed_status integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_row          record;
  v_order_status public.payment_status;
  v_n            integer;
  v_generic_msg  constant text := 'record_released_failure_observation: 觀察記錄失敗';  -- PF-E 通用訊息
BEGIN
  -- 🔴 輸入守衛(fail-closed):p_observed_status 僅 -1 或 5(含 NULL → RAISE)
  IF p_observed_status IS NULL OR p_observed_status NOT IN (-1, 5) THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 雙鍵 + status='released' 查 attempt + FOR UPDATE(write-once 序列化 + 對 markCharged released→charged 同列序列化)
  SELECT id, status
    INTO v_row
    FROM public.payment_charge_attempts
   WHERE id = p_attempt_id AND order_id = p_order_id AND status = 'released'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;  -- 找不到 / 雙鍵不符 / 非 released → fail-closed
  END IF;

  -- order 必 unpaid(已付款/已收斂單不記觀察;唯讀粗閘、attempt FOR UPDATE 已序列化 write-once)
  SELECT payment_status
    INTO v_order_status
    FROM public.orders
   WHERE id = p_order_id;
  IF NOT FOUND OR v_order_status <> 'unpaid'::public.payment_status THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 🔴 write-once 雙鍵 COALESCE(canonical 行 187):僅 failure_observed_at/status、不動 status/updated_at;重放不覆蓋第一次觀察
  UPDATE public.payment_charge_attempts
     SET failure_observed_at     = COALESCE(failure_observed_at, pg_catalog.now()),
         failure_observed_status = COALESCE(failure_observed_status, p_observed_status)
   WHERE id = p_attempt_id AND order_id = p_order_id AND status = 'released';

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;
END;
$fn$;

COMMENT ON FUNCTION public.record_released_failure_observation(uuid, uuid, integer) IS
  'M-3 3DS R1b3:released attempt 遇 Record -1/5 首次觀察 write-once 雙鍵標記(failure_observed_at/status COALESCE、不覆蓋第一次、不改 status=observation≠terminal、released 仍續對帳)。三參數雙鍵 + FOR UPDATE;輸入守衛僅 -1/5(其他含 NULL RAISE);非 released/雙鍵不符/order 非 unpaid/找不到 → 一律 RAISE fail-closed。SECDEF search_path='';只 payment_confirmer 可呼。';


-- ── 2. record_released_failure_observation 權限:全 REVOKE 再精準 GRANT payment_confirmer ──
-- 🔴 顯式含 service_role:Supabase ALTER DEFAULT PRIVILEGES 對新函式直接 grant EXECUTE TO service_role,只 REVOKE PUBLIC 收不掉。
REVOKE ALL ON FUNCTION public.record_released_failure_observation(uuid, uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_released_failure_observation(uuid, uuid, integer) TO payment_confirmer;

-- 🔴 fail-closed assert(EXECUTE 矩陣 + role-hygiene 回歸):唯 payment_confirmer 可呼 + payment_confirmer 直接表/欄權限恆零。
DO $$
DECLARE
  v_tbl int;
  v_col int;
BEGIN
  IF NOT has_function_privilege('payment_confirmer', 'public.record_released_failure_observation(uuid,uuid,integer)', 'EXECUTE')
     OR has_function_privilege('anon',          'public.record_released_failure_observation(uuid,uuid,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.record_released_failure_observation(uuid,uuid,integer)', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.record_released_failure_observation(uuid,uuid,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'record_released_failure_observation EXECUTE 矩陣異常 — 應唯 payment_confirmer;拒繼續';
  END IF;

  SELECT count(*) INTO v_tbl FROM information_schema.role_table_grants  WHERE grantee = 'payment_confirmer';
  SELECT count(*) INTO v_col FROM information_schema.role_column_grants WHERE grantee = 'payment_confirmer';
  IF v_tbl <> 0 OR v_col <> 0 THEN
    RAISE EXCEPTION 'payment_confirmer 表/欄層權限非零(role-hygiene 破)— tbl=% col=%;拒繼續', v_tbl, v_col;
  END IF;
END
$$;


-- ── 3. get_active_charge_attempt 改:active 集加 released(基線 20260614120000、bare CREATE OR REPLACE 保留 ACL)──
-- 🔴 零漂移:基線函式本體 byte-identical,唯一功能改 = active 集 +released(L77);連帶 inline 註解(L72)+ COMMENT 同步反映(字面 vs 事實)。
CREATE OR REPLACE FUNCTION public.get_active_charge_attempt(p_order_id uuid)
RETURNS jsonb  -- { attempt_id, status, rec_trade_id, bank_transaction_id, order_total, order_payment_status, order_display_id } 或 NULL
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_generic_msg constant text := 'get_active_charge_attempt: 查詢失敗';  -- PF-E 通用訊息(不洩內部)
  v_order   record;
  v_attempt record;
BEGIN
  -- 入口 fail-closed
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 訂單對帳欄(total/payment_status/display_id;窄權 server-side、非 findTotal RLS own-only)
  SELECT total, payment_status, display_id
    INTO v_order
    FROM public.orders
   WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN NULL;  -- 無此單 → 對不上本機(webhook route 丟棄;1b no_attempt)
  END IF;

  -- active attempt(pending|charged|released;failed 不回)、防禦取最新(R1b3:released 納入對帳反查,§2.6)
  SELECT id, status, rec_trade_id, bank_transaction_id, created_at
    INTO v_attempt
    FROM public.payment_charge_attempts
   WHERE order_id = p_order_id
     AND status IN ('pending', 'charged', 'released')
   ORDER BY created_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;  -- 單存在但無 active attempt → 1b no_attempt
  END IF;

  -- 🔴 只回非 PII 對帳欄(零 token/卡資料/經銷價/customer PII)。
  --   attempt_created_at 供 settleCharge 弱識別(hint/order_number fallback)時間窗防誤命中(master plan §1 step 2)。
  RETURN pg_catalog.jsonb_build_object(
    'attempt_id',           v_attempt.id,
    'status',               v_attempt.status,
    'rec_trade_id',         v_attempt.rec_trade_id,
    'bank_transaction_id',  v_attempt.bank_transaction_id,
    'attempt_created_at',   v_attempt.created_at,
    'order_total',          v_order.total,
    'order_payment_status', v_order.payment_status,
    'order_display_id',     v_order.display_id
  );
END
$fn$;

COMMENT ON FUNCTION public.get_active_charge_attempt(uuid) IS
  'M-3 3DS-1b(R1b3 改 active 集含 released):settleCharge 依 orderId 反查 active(pending|charged|released)attempt 對帳鍵(rec_trade_id/bank_transaction_id)+ status + order 對帳欄(total/payment_status/display_id)。order_total 走窄權(findTotal RLS own-only 在 webhook/sweeper 無 JWT 不可用)。只回非 PII 對帳欄(零 token/卡資料/經銷價)。無單/無 active attempt → NULL。SECURITY DEFINER、只 payment_confirmer 可呼。';


-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):
--   DROP FUNCTION IF EXISTS public.record_released_failure_observation(uuid, uuid, integer);
--   CREATE OR REPLACE FUNCTION public.get_active_charge_attempt(uuid) … 回 20260614120000 基線(active 集 pending|charged、無 released)。
-- ============================================================
