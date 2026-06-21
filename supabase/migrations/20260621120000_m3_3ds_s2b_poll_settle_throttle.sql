-- ============================================================
-- M-3 3DS-S2b:per-order poll-settle throttle — 會員輪詢端點主動 settleCharge 的 Record 限流
-- ============================================================
-- 真權威:docs/specs/2026-06-21-m3-3ds-s2b-poll-settle-throttle-plan.md §5/§6.1。
-- 依賴(功能):20260604120000(orders + payment_status enum)、20260612150000(s2d payment_charge_attempts 表)、
--             20260615120001(4a-2:settle_attempt_count/next_settle_at/needs_manual_review/last_settle_error 4 欄)、
--             20260611120000(payment_confirmer 角色、S2-c)。
-- 鐵則 8(ALTER + 新 RPC + GRANT)+ 鐵則 12(payment 對帳路徑、窄權、零 PII、fail-closed)。
--
-- 🔴 背景(plan §5.1):輪詢端點 GET /api/orders/[orderId]/payment-status 在 own-only 歸屬閘後、訂單仍 unpaid 時
--    主動呼一次 settleCharge(= callback/webhook/sweeper 三路共呼模型第四路 caller、不改 settleCharge 內部),達成
--    設計包 §5.1「幾秒無感成立」。settleCharge step3 recordQuery 每次打 TapPay Record → 會員多分頁/狂重整可 spam
--    打爆 Record 查詢額度。本 throttle 把「同一 orderId 在窗內最多放行一次 settle」durable(DB)落地、防放大。
--
-- 🔴 為何新欄/新 RPC、不重用 4a-2 sweeper 欄(plan §5.1 + codex 關卡1 PASS):
--    ① settle_attempt_count = sweeper ceiling 計數器(claim 唯一遞增、滿 8→needs_manual_review):輪詢遞增它 →
--       會員狂重整把自己單灌到 ceiling → 被 expire_stuck_attempts_at_ceiling 誤標 manual(durable 假告警、真傷害)。
--    ② next_settle_at = sweeper lease/退避排程:輪詢拿來當 throttle 寫 → 踩亂 lease/退避語意。
--    ③ payment_confirmer 對 payment_charge_attempts 零表/欄 grant、只能執行 owner-run SECURITY DEFINER RPC;既有
--       RPC 全綁死 sweeper 語意 → 即使只借 next_settle_at 也得新 RPC。故新加獨立欄 last_poll_settle_at + 新 RPC、
--       與 sweeper 欄零語意重疊。
--
-- ⚠️ Q2=A:本 migration **不單推 db push**(正式結帳 flag 鎖、RPC 正式環境暫不用;正式暫無此 RPC 時端點 fail-closed
--    skip settle = 退回只讀 A 版行為、零安全風險)。db push 留 S6 開正式結帳統一評估。動手前真 DB 行為由 MCP 交易
--    模擬驗(BEGIN + 本檔 DDL + synthetic orders/attempts + DO 斷言 + ROLLBACK、零留痕)。
--
-- ⚠️ 誠實揭示:主軌 RPC 以 payment_confirmer 身分 literal 實呼於 pooled MCP 必斷線(S2-c/d/0a/1b/4a-1/4a-2 多次
--    重現)→ 等價證據 = has_function_privilege 矩陣 + owner 身分行為 + search_path='' caller 一致 + 全域 grants=0。
--
-- Rollback(Supabase forward-only、僅供參考、逆序手動):見檔尾。
-- ============================================================


-- ── 1. throttle 欄(獨立於 4a-2 sweeper 的 next_settle_at/settle_attempt_count、零語意重疊;NULL=從未放行、立即可放行)──
ALTER TABLE public.payment_charge_attempts
  ADD COLUMN last_poll_settle_at timestamptz;   -- 最近一次「會員輪詢觸發 settleCharge」放行時點(poll-settle throttle 專用)


-- ── 2. claim_order_poll_settle(原子 per-order poll-settle throttle claim)──
-- 放行(窗內未放行過 + 閘全過)→ set last_poll_settle_at=now() 回 true(caller 可呼 settleCharge);否則 false(skip、只讀狀態)。
-- 🔴 並發安全(多分頁同時打):UPDATE 取 row lock 序列化;第二個 unblock 後 Postgres 對更新後 tuple 重評 WHERE
--    (READ COMMITTED EvalPlanQual)→ last_poll_settle_at 已=now() → throttle 條件 false → 0 rows → EXISTS false →
--    被 throttle。原子、不雙放行。
-- 🔴 fail-closed:p_throttle_seconds<0 → 條件恆 false → 0 rows → false(不誤放行)。
-- 🔴 閘**完全對齊** 4a-2 claim_stuck_unsettled_attempts(unpaid + 非 manual + ceiling;codex 關卡1 r1 #1/#2 + r2 折入):
--    ① JOIN orders + o.payment_status='unpaid' —— 防 partiallyPaid/refunded active attempt 被輪詢觸發 settleCharge
--       副作用(markCharged/markFailed)干擾 4a-2 flag_non_unpaid_active 的「唯一回收路徑」;paid 由此閘 + 端點短路
--       + settleCharge step2 三重 backstop。
--    ② needs_manual_review=false —— 4a-2 把它當「停止自動 retry」durable 旗標;否則會員可用輪詢繞過 ceiling/manual
--       轉出、成第四路 Record caller 無界打 Record。
--    ③ settle_attempt_count<8(ceiling)—— 封掉「count 已達 ceiling、manual 尚未設」窄窗/orphan;輪詢窗內 count 恆=0
--       (sweeper 10min age-gate)→ 永不誤擋合法結算、純縱深。
CREATE OR REPLACE FUNCTION public.claim_order_poll_settle(
  p_order_id         uuid,
  p_throttle_seconds integer
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn$
  WITH claimed AS (
    UPDATE public.payment_charge_attempts a
       SET last_poll_settle_at = pg_catalog.now()
      FROM public.orders o
     WHERE o.id = a.order_id
       AND a.order_id = p_order_id
       AND a.status IN ('pending', 'charged')
       AND o.payment_status = 'unpaid'::public.payment_status
       AND a.needs_manual_review = false
       AND a.settle_attempt_count < 8
       AND p_throttle_seconds >= 0
       AND (a.last_poll_settle_at IS NULL
            OR a.last_poll_settle_at
               <= pg_catalog.now() - pg_catalog.make_interval(secs => p_throttle_seconds))
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$fn$;

COMMENT ON FUNCTION public.claim_order_poll_settle(uuid, integer) IS
  'M-3 3DS-S2b:per-order poll-settle throttle。窗內未放行 + status IN(pending,charged) + order unpaid + 非 manual + settle_attempt_count<8 + p_throttle_seconds>=0 → set last_poll_settle_at=now() 回 true(caller 可呼 settleCharge);否則 false(skip)。原子(row lock + EvalPlanQual 重評、不雙放行)。閘完全對齊 4a-2 claim_stuck_unsettled_attempts(unpaid + 非 manual + ceiling)。Record 限流、不誤觸發非 unpaid 結算、不繞 sweeper ceiling。只 payment_confirmer 可呼。';


-- ── 3. RPC 權限:全 REVOKE 再精準 GRANT payment_confirmer(對齊 4a-2)──
REVOKE ALL ON FUNCTION public.claim_order_poll_settle(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_order_poll_settle(uuid, integer) TO payment_confirmer;


-- ── 4. fail-closed assert:EXECUTE 矩陣(payment_confirmer=true、其餘 false)──
DO $$
BEGIN
  IF NOT has_function_privilege('payment_confirmer', 'public.claim_order_poll_settle(uuid, integer)', 'EXECUTE')
     OR has_function_privilege('anon',          'public.claim_order_poll_settle(uuid, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_order_poll_settle(uuid, integer)', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.claim_order_poll_settle(uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '3DS-S2b claim_order_poll_settle EXECUTE 矩陣異常 — 應唯 payment_confirmer;拒繼續';
  END IF;
END
$$;


-- ── 5. role-hygiene 回歸 assert:payment_confirmer 全域表/欄層零權限(ALTER 加欄勿洩 grant;對齊 4a-2 §8)──
DO $$
DECLARE
  v_tbl_grants integer;
  v_col_grants integer;
BEGIN
  SELECT pg_catalog.count(*) INTO v_tbl_grants
    FROM information_schema.role_table_grants
   WHERE grantee = 'payment_confirmer';
  SELECT pg_catalog.count(*) INTO v_col_grants
    FROM information_schema.role_column_grants
   WHERE grantee = 'payment_confirmer';
  IF v_tbl_grants <> 0 OR v_col_grants <> 0 THEN
    RAISE EXCEPTION 'payment_confirmer 全域表/欄層權限非零(role-hygiene 破、ALTER 加欄洩 grant)— 拒繼續';
  END IF;
END
$$;


-- ============================================================
-- Rollback(逆序手動):
--   DROP FUNCTION IF EXISTS public.claim_order_poll_settle(uuid, integer);
--   ALTER TABLE public.payment_charge_attempts DROP COLUMN IF EXISTS last_poll_settle_at;
-- ============================================================
