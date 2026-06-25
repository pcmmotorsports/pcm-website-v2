-- ============================================================
-- M-3 3DS R1c2:claim_order_poll_settle released predicate — released 繞 manual/ceiling、pending/charged 仍受閘
-- ============================================================
-- 真權威:docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md §4 R1c2(行194-204、point 15)+ §9 表 R1c2 列(行305)+ §2.5。
-- 依賴(功能):20260612150000(payment_charge_attempts 表)、20260615120001(4a-2:settle_attempt_count/next_settle_at/
--   needs_manual_review/last_settle_error 4 欄)、
--   **20260621120000**(s2b:last_poll_settle_at 欄 + 基線 claim_order_poll_settle〔本片 CREATE OR REPLACE 它〕)、
--   **R1a1**(20260624120000:status 加 'released'〔本片 predicate 讀 released 列 → R1 bundle 必 R1a1 + s2b 先於 R1c2 apply〕)。
-- 鐵則 8(改既有 payment 對帳 RPC 行為)+ 鐵則 12(payment / 對帳路徑、窄權、零 PII、fail-closed)。
--
-- 🔴 設計(canonical §4 R1c2 point 15,逐字):
--   會員輪詢端點(GET /api/orders/[orderId]/payment-status)在 own-only 歸屬閘後、訂單仍 unpaid 時主動呼一次 settleCharge
--   的「per-order poll-settle throttle claim」。R1c2 把 released 納入「持續低頻對帳」(§2.5)。
--   🔴 **僅把 status 改成含 released 不夠**:s2b 基線 predicate 還有 needs_manual_review=false + settle_attempt_count<8,
--      只加 status 會讓 released 在 manual=true 或 count>=8 時被排除,與「released 持續對帳直到 terminal」矛盾。
--   **canonical predicate 定稿(本片唯一改動 = WHERE 三閘重構,與 R1c1 claim_stuck_unsettled_attempts 同款邏輯)**:
--      (
--        ( status IN ('pending','charged') AND needs_manual_review=false AND settle_attempt_count<8 )  -- pending/charged 維持既有 manual/ceiling 閘
--        OR status = 'released'                                                                         -- released 繞 manual/ceiling
--      )
--      AND order.payment_status = 'unpaid'    -- 對所有狀態保留
--      AND throttle window 已到期              -- 對所有狀態保留(last_poll_settle_at + p_throttle_seconds>=0)
--   released claim 仍 set last_poll_settle_at=now()(沿用 UPDATE 本體、不改);輪詢端點仍 caller、settleCharge 內部不改。
--
-- 🔴 零漂移聲明:本片**唯一改動 = WHERE 的 status/manual/ceiling 三閘重構為「(pending/charged 受 manual/ceiling)OR released」**;
--   其餘逐字 byte-identical 於 s2b 基線(20260621120000):UPDATE…SET last_poll_settle_at=now()、FROM orders o、
--   o.id=a.order_id、a.order_id=p_order_id、o.payment_status=unpaid 閘、p_throttle_seconds>=0 fail-closed、throttle window
--   (last_poll_settle_at IS NULL OR <= now()-make_interval)、RETURNING 1 / SELECT EXISTS、SECURITY DEFINER search_path=''。
--   pending/charged 對基線**行為完全等價**(三閘語意未變、只是括號重組 + 多一條 released 旁路)。**全片 byte-equivalent 改 = WHERE**
--   (無退避指數,故無 R1c1〔G〕int4 溢位面;此 RPC 不算退避)。ACL **沿用基線**(CREATE OR REPLACE 同簽名不重置 GRANT/REVOKE
--   → payment_confirmer EXECUTE 持續;本片無 ALTER / 無新欄 / 無 REVOKE/GRANT,僅末端 fail-closed 矩陣 + role-hygiene 回歸 assert)。
--
-- 🔴 並發安全(沿用 s2b、不改):UPDATE 取 row lock 序列化;多分頁同打 → 第二者 unblock 後 Postgres 對更新後 tuple 重評
--   WHERE(READ COMMITTED EvalPlanQual)→ last_poll_settle_at 已=now() → throttle 條件 false → 0 rows → EXISTS false → 被
--   throttle。released 旁路不影響此性質(throttle window 對所有狀態保留)。原子、不雙放行。
--
-- 🔴 producer-gating 中和(誠實揭示、Phase 1 released 路徑不可達):Phase 1 零 release CAS app caller(多方 grep)+
--   `TAPPAY_3DS_ENABLED` flag off → 無 released row 產生 → 本片 released 旁路 Phase 1 不可達 = 前瞻正確 DB 基建。
--   db push 留 §14 步21(R1 bundle 連帶 S2b=live),flag 全程 false。
--
-- ⚠️ 誠實揭示:主軌 RPC 以 payment_confirmer 身分 literal 實呼於 pooled MCP 必斷線(S2-c/d/0a/1b/4a-1/4a-2/s2b/R1a3/R1c1
--   多次重現)→ 等價證據 = has_function_privilege 矩陣 + owner 身分行為矩陣 + search_path='' caller 一致 + 全域 grants=0。
--   真連線 round-trip 由輪詢端點(payment_confirmer 鑰、session pooler)補。
--
-- 動手前真 DB 交易模擬(MCP execute_sql、單一 atomic DO block 套 R1a1 DDL + s2b DDL〔ADD last_poll_settle_at + 基線
--   claim_order_poll_settle〕+ 本片 R1c2 REPLACE + synthetic orders/attempts + DO 斷言 + 末端 RAISE 強制 rollback、零留痕;
--   §9 表 R1c2 規定 10 案 released-predicate〔db push 前必補〕,見 commit body 摘要):
--   ①pending+manual=F+count<8→可 ②pending+manual=T→不可 ③pending+count>=8→不可 ④released+manual=F+count<8→可
--   ⑤released+manual=T→仍可 ⑥released+count>=8→仍可 ⑦released+manual=T+count>=8→仍可 ⑧released+order paid→不可
--   ⑨released+throttle未到→不可 ⑩released+throttle到期→可;+ ACL 矩陣(payment_confirmer=T、其餘 F)+ 全域 role-hygiene grants=0。
--
-- Rollback(Supabase forward-only、僅供參考):CREATE OR REPLACE 還原 20260621120000 s2b claim_order_poll_settle 本體
--   (見該檔 §2,原 WHERE:status IN(pending,charged) AND unpaid AND 非 manual AND count<8 AND throttle);本片無 schema/欄/ACL 變更。
-- ============================================================


-- ── 1. claim_order_poll_settle:released 繞 manual/ceiling 被放行(其餘閘對所有狀態保留)──
-- 🔴 唯一改動 = WHERE 的 status/manual/ceiling 三閘重構為「(pending/charged 受 manual/ceiling)OR released」;
--    o.payment_status='unpaid' + p_throttle_seconds>=0 + throttle window 三閘對所有狀態保留;UPDATE 本體
--    (set last_poll_settle_at=now())+ RETURNING/EXISTS 逐字不改。
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
       AND (
             ( a.status IN ('pending', 'charged')
               AND a.needs_manual_review = false
               AND a.settle_attempt_count < 8 )       -- pending/charged 維持既有 manual/ceiling 閘
             OR a.status = 'released'                  -- 🔴 released 繞 manual/ceiling(§2.5、持續低頻對帳直到 terminal)
           )
       AND o.payment_status = 'unpaid'::public.payment_status               -- 對所有狀態保留
       AND p_throttle_seconds >= 0                                          -- 對所有狀態保留(fail-closed:<0 → 0 rows → false)
       AND (a.last_poll_settle_at IS NULL                                   -- throttle window、對所有狀態保留
            OR a.last_poll_settle_at
               <= pg_catalog.now() - pg_catalog.make_interval(secs => p_throttle_seconds))
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$fn$;

COMMENT ON FUNCTION public.claim_order_poll_settle(uuid, integer) IS
  'M-3 3DS-S2b + R1c2:per-order poll-settle throttle。窗內未放行 + ((status IN(pending,charged) AND 非 manual AND settle_attempt_count<8) OR status=released〔R1c2:released 繞 manual/ceiling、持續低頻對帳直到 terminal〕) + order unpaid + p_throttle_seconds>=0 + throttle window → set last_poll_settle_at=now() 回 true(caller 可呼 settleCharge);否則 false(skip)。原子(row lock + EvalPlanQual 重評、不雙放行)。released 旁路與 R1c1 claim_stuck_unsettled_attempts 同款邏輯。Record 限流、不誤觸發非 unpaid 結算。只 payment_confirmer 可呼。';


-- ── 2. fail-closed assert:claim_order_poll_settle EXECUTE 矩陣(payment_confirmer=true、其餘 false;ACL 沿用基線、回歸驗)──
DO $$
BEGIN
  IF NOT has_function_privilege('payment_confirmer', 'public.claim_order_poll_settle(uuid, integer)', 'EXECUTE')
     OR has_function_privilege('anon',          'public.claim_order_poll_settle(uuid, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_order_poll_settle(uuid, integer)', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.claim_order_poll_settle(uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'R1c2 claim_order_poll_settle EXECUTE 矩陣異常 — 應唯 payment_confirmer;拒繼續';
  END IF;
END
$$;


-- ── 3. role-hygiene 回歸 assert:payment_confirmer **全域**表/欄層零權限(本片無 ALTER、回歸驗不退步;對齊 s2b §5 / R1c1 §4)──
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
    RAISE EXCEPTION 'payment_confirmer 全域表/欄層權限非零(role-hygiene 破)— 拒繼續';
  END IF;
END
$$;


-- ============================================================
-- Rollback(逆序手動、還原 20260621120000 s2b 本體):
--   CREATE OR REPLACE FUNCTION public.claim_order_poll_settle(uuid, integer) ... (s2b §2 原 WHERE:status IN
--     (pending,charged) AND a.order_id=p_order_id AND o.payment_status=unpaid AND 非 manual AND settle_attempt_count<8
--     AND p_throttle_seconds>=0 AND throttle window;UPDATE set last_poll_settle_at=now();RETURNING 1 / SELECT EXISTS)
--   -- 本片無 schema/欄/ACL 變更,rollback 僅還原 1 函式本體。
-- ============================================================
