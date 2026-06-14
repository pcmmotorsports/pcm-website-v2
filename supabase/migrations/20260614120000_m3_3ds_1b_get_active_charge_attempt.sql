-- ============================================================
-- M-3 3DS-1b:get_active_charge_attempt 窄權對帳讀 RPC(settleCharge 依 orderId 反查 attempt + order 對帳欄)
-- ============================================================
-- 真權威:docs/specs/2026-06-14-m3-3ds-1b-settlecharge-plan.md §3(R1)/§4(R2 讀路徑主軌-only)
--   + master plan v5 §1 step 1-2(settleCharge by orderId 找 pending attempt + Record 反查)。
-- 依賴:20260604120000(orders + payment_status enum + total)、20260612150000(payment_charge_attempts)、
--       20260613140000(0c:attempts.bank_transaction_id)、20260611120000(payment_confirmer 角色)。
-- 鐵則 8(新 RPC + GRANT)+ 鐵則 12(payment / 對帳脊椎讀)。
--
-- 🔴 設計(plan §3/§4 + 審查側 關卡1 缺陷 D):
--   ① settleCharge〔3DS-1b、webhook/sweeper/callback/retry 共呼〕在 callback/webhook/sweeper 情境**只有 orderId**
--      (無本機 attempt_id)→ 需依 orderId 反查該單 active(pending|charged)attempt 的對帳鍵(rec_trade_id /
--      bank_transaction_id)+ status,再組 Record API 查詢(master plan §1 step 1 優先序 rec→bank→hint→order_number)。
--   ② 🔴 order_total 由本 RPC 回(非 IOrderRepository.findTotal):findTotal 是 RLS own-only(user-scoped)、
--      webhook/sweeper **無 user JWT** → findTotal 回 null;對帳金額比對(plan §7、record.amount===order_total)必走
--      payment_confirmer 窄權 server-side。orders 無 currency 欄(Phase 1 TWD-implicit)→ 不回 order_currency、
--      1b 以 'TWD' 常數斷言 record.currency。
--   ③ order_payment_status 供 1b 缺陷C 短路(已 paid 單不打 Record、省 §7 rate-limit);order_display_id 供
--      retry duplicate 回既有單號(plan §2 paid outcome）。
--   ④ 🔴 只回非 PII 對帳欄:attempt id/status/rec/bank_txn + order total/payment_status/display_id;
--      **絕不回** fallback_token_hash / 卡資料 / 經銷價 / customer PII。
--   ⑤ active = status IN ('pending','charged')(failed 不回);防禦 ORDER BY created_at DESC LIMIT 1(per-order
--      active 理論唯一、partial unique idx 保證,LIMIT 1 為縱深)。無單 / 無 active attempt → RETURN NULL(1b no_attempt)。
--   ⑥ SECURITY DEFINER + search_path='' + 全識別子 schema-qualified;入口 fail-closed(p_order_id NULL → 通用 RAISE)。
--   ⑦ 權限:REVOKE PUBLIC/anon/authenticated/service_role + GRANT payment_confirmer;EXECUTE 矩陣 fail-closed assert
--      + 🔴 缺陷D role-hygiene 回歸(payment_confirmer 直接表/欄權限恆零、只透 SECDEF RPC;對齊 S2-d L477-478 / 0c)。
--
-- ⚠️ 誠實揭示:payment_confirmer literal 實呼於 pooled MCP 必斷線(S2-c/d、0a/0c 多次重現)→ 等價證據 =
--   has_function_privilege 矩陣 + owner 實跑行為 + search_path='' caller 一致 + role_table/column_grants=0;
--   真連線 round-trip 由 3DS-2/3 route 對 session pooler 補。本 RPC 唯讀(無寫)→ MCP 交易模擬 happy-path 可全程跑。
--
-- 動手前真 DB 交易模擬 PASS(MCP execute_sql、BEGIN + 0c bank_transaction_id 欄〔bundle 連帶〕+ 本 migration
--   DDL + synthetic + DO 斷言 + 行為測 S1-S6 + ROLLBACK、零留痕;project bmpnplmnldofgaohnaok PG17、2026-06-14):
--   ① DDL 套用無誤 + assert block PASS(EXECUTE 矩陣唯 payment_confirmer〔anon/authenticated/service_role 全拒〕
--      + role-hygiene role_table_grants=0 + role_column_grants=0)。
--   ② 行為 S1-S6:S1 unpaid+pending → 全欄正確 jsonb(rec/bank/attempt_created_at〔timestamptz〕/total=1050/status=unpaid/display);
--      S2 paid+charged → status=charged/payment_status=paid/rec=D-rec-2/bank_transaction_id null;
--      S3 僅 failed attempt → NULL;S4 無 attempt → NULL;S5 不存在單 → NULL;S6 null 參數 → 通用 RAISE(fail-closed)。
--   ③ ROLLBACK 後唯讀複查零留痕:get_active_charge_attempt/bank_transaction_id 欄/synthetic orders/user 全 absent、
--      orders 總數 0(prod 未動);bank_col residue=0 同時佐證 0c 尚未 push(bundle 待 Sean db push)。
--
-- Rollback(Supabase forward-only、僅供參考):見檔尾。
-- ============================================================


-- ── 1. get_active_charge_attempt(依 orderId 反查 active attempt + order 對帳欄)──
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

  -- active attempt(pending|charged;failed 不回)、防禦取最新
  SELECT id, status, rec_trade_id, bank_transaction_id, created_at
    INTO v_attempt
    FROM public.payment_charge_attempts
   WHERE order_id = p_order_id
     AND status IN ('pending', 'charged')
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
  'M-3 3DS-1b:settleCharge 依 orderId 反查 active(pending|charged)attempt 對帳鍵(rec_trade_id/bank_transaction_id)+ status + order 對帳欄(total/payment_status/display_id)。order_total 走窄權(findTotal RLS own-only 在 webhook/sweeper 無 JWT 不可用)。只回非 PII 對帳欄(零 token/卡資料/經銷價)。無單/無 active attempt → NULL。SECURITY DEFINER、只 payment_confirmer 可呼。';


-- ── 2. RPC 權限:全 REVOKE 再精準 GRANT payment_confirmer ──
REVOKE ALL ON FUNCTION public.get_active_charge_attempt(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_active_charge_attempt(uuid) TO payment_confirmer;


-- ── 3. fail-closed assert(EXECUTE 矩陣 + 缺陷D role-hygiene 回歸)──
DO $$
DECLARE
  v_tbl int;
  v_col int;
BEGIN
  -- get_active_charge_attempt EXECUTE 唯 payment_confirmer
  IF NOT has_function_privilege('payment_confirmer', 'public.get_active_charge_attempt(uuid)', 'EXECUTE')
     OR has_function_privilege('anon',          'public.get_active_charge_attempt(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.get_active_charge_attempt(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.get_active_charge_attempt(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'get_active_charge_attempt EXECUTE 矩陣異常 — 應唯 payment_confirmer;拒繼續';
  END IF;

  -- 🔴 缺陷D role-hygiene 回歸(對齊 S2-d / 0c):payment_confirmer 直接表/欄層權限恆零
  --   (只透 SECDEF RPC 讀 orders/attempts、不可繞窄權直查 → 新 SECDEF 函式不得意外放開表權限)
  SELECT count(*) INTO v_tbl FROM information_schema.role_table_grants  WHERE grantee = 'payment_confirmer';
  SELECT count(*) INTO v_col FROM information_schema.role_column_grants WHERE grantee = 'payment_confirmer';
  IF v_tbl <> 0 OR v_col <> 0 THEN
    RAISE EXCEPTION 'payment_confirmer 表/欄層權限非零(role-hygiene 破)— tbl=% col=%;拒繼續', v_tbl, v_col;
  END IF;
END
$$;


-- ============================================================
-- Rollback(Supabase forward-only、僅供參考):
--   DROP FUNCTION IF EXISTS public.get_active_charge_attempt(uuid);
-- ============================================================
