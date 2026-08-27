-- ============================================================
-- M-3 3DS 乙路 B1a:12h 孤兒 claim/throttle migration + claim_expired_pending_attempts(server-only claim RPC)
-- ============================================================
-- 真權威:docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md v10 §8(逐字)+ §9 第 19 片(B1a)+ §14 步 30。
-- canonical 經 Codex round4→round11 共 8 輪對抗審查、round11 PASS;本片 = §14 唯一 45 步序之步 30(B1 migration、第二次 db push 對象)。
-- 依賴:20260612150000(payment_charge_attempts 表 + status CHECK + customer_user_id + created_at)、
--       20260615120001(4a-2:settle_attempt_count/next_settle_at/needs_manual_review 欄)、
--       20260604120000(orders + payment_status enum)、20260611120000(payment_confirmer 角色)、
--       **R1a1**(released 狀態:本片 claim WHERE status='pending' 隱含排除 released、語意對齊 R1a1)。
-- 鐵則 8(動 schema:ADD COLUMN + 新 SECDEF RPC + GRANT)由 canonical plan 滿足、無需新 plan;鐵則 12(payment / 對帳 / GRANT)→ codex K2 + Codex Packet。
--
-- 🔴 設計(canonical §8 12h 孤兒收尾 + §9 B1a):
--   ① 根因:pending 孤兒(客人放棄、沒重刷)經現行 sweeper(4a-2)重試 8x → needs_manual_review=true → **退出一般掃描**
--      (claim_stuck_unsettled_attempts 濾 needs_manual_review=false)。若無 B1 → 永遠卡 manual queue 無人再確認。
--   ② B1 = **專用人工列再確認路徑**:受 age(≥12h)+ order unpaid + **獨立 throttle**(last_expired_settle_at)限制;
--      **可涵蓋 manual=true、亦可進 manual=false**(不濾 needs_manual_review);**繞 sweeper 的 ceiling(不濾 settle_attempt_count)**;
--      🔴 但 **B1 不清除 needs_manual_review**(只設 last_expired_settle_at throttle、不動 manual flag)。
--   ③ **本片只做 claim**:原子 claim 受理符合條件的孤兒 + 蓋 throttle 戳 + 回傳給 caller(B1b use-case 複用 settleCharge 再確認:
--      Record -1/5→guarded markFailed〔R1b2 order-paid guard〕/ 4·unreachable·unverified→維持 pending〔不動 manual=維持〕/
--      查詢失敗不判 failed)。**B1 不得因查詢失敗 markFailed;order 已 paid 不處理;released 不進 B1**(released 走 §2.5 持續對帳)。
--   ④ **last_expired_settle_at = B1 專屬 durable throttle**(防熱迴圈):與 sweeper 的 next_settle_at **分軌**
--      (B1 不碰 next_settle_at、B1b 不呼 markSettleRetry),互不干擾。throttle 間隔 = **6 小時**(見下 INTERVAL 常數說明)。
--   ⑤ 原子 claim(對齊 4a-2 claim_stuck_unsettled_attempts):CTE `FOR UPDATE OF a SKIP LOCKED + LIMIT` → UPDATE 蓋戳 →
--      RETURNING;真雙連線平行 claim 時**同一 attempt 同一輪只能被一個 worker claim**(SKIP LOCKED)。
--   ⑥ p_limit 安全上下界:`LEAST(GREATEST(p_limit, 1), 1000)`(硬 backstop、對齊 4a-1/4a-2;NULL/負/超量不 over-claim)。
--   ⑦ 權限:SECURITY DEFINER + search_path='' + 全識別子 schema-qualified;REVOKE PUBLIC/anon/authenticated/service_role →
--      GRANT payment_confirmer;has_function_privilege 矩陣 + payment_confirmer **全域**表/欄層零權限 role-hygiene 回歸 assert
--      (ADD COLUMN 勿洩 grant)。
--
-- 🔴 throttle 間隔 = 6 小時(本片設計判斷、canonical 僅定性「durable throttle 防熱迴圈」未硬指定數值):
--   孤兒已 ≥12h、屬「低頻再確認」路徑;6h → 每孤兒至多每 6h 再打一次 Record API(明顯區隔 sweeper 的分鐘級退避封頂 16min)、
--   防 cron 每輪重領同孤兒熱迴圈,又夠頻繁讓 Record 短暫不可用時不致長時間停擺。**可調**(forward-only、改間隔即下次 migration)。
--
-- 🔴 claim-then-paid TOCTOU 窄窗(誠實揭示、對齊 4a-2 精化〔B〕;adversarial-reviewer F2):claim 刻意只 FOR UPDATE OF a
--   (不鎖 order、避免阻塞平行 confirm/callback 結算,對齊 4a-2 精化〔C〕);CTE 讀 order=unpaid 後、同語句 UPDATE 蓋戳前
--   並發 confirm 把 order 翻 paid → claim 仍可能交出一筆「order 剛 paid」的 attempt(同 statement 共用快照、EXISTS-in-UPDATE
--   無法消窗;鎖 order 又會阻塞結算 → 故不在本片消窗)。**此窗不致雙扣**:B1b 再確認複用 settleCharge、其 step2 order-paid 短路
--   (packages/use-cases/src/settle-charge.ts:`attempt.orderPaymentStatus==='paid' → 回 paid idempotent、不打 Record`)把已付款
--   單擋在「對 Record 再 settle」之前 = 冪等零雙扣;窗的代價僅「白蓋一次 throttle 戳 + 一次短路 settleCharge」=無害。
--   ⚠️ 不變式(鐵則 10):綁定「B1b 一律走具 order-paid 短路的 settleCharge」;B1b 若 bypass settleCharge 直呼 Record/markFailed
--   須重核此窗(B1b commit 必驗 settleCharge 短路在再確認路徑上游)。Codex K2 月牆解除後請對 money 域真複核。
--
-- ⚠️ 安全 / 守線:本片只寫 migration 檔 + MCP DDL 模擬(BEGIN…ROLLBACK 零留痕);不 db push(= §14 步 31 Sean 第二次 db push)、
--   不 push、不 merge、不開 flag(TAPPAY_3DS_ENABLED false)。既有列(7 新欄全 NULL〔R1a1〕+ last_expired_settle_at 新欄 NULL)
--   對新欄/RPC 全 pass(ADD COLUMN nullable 不回填、不長鎖)。
--
-- ⚠️ 誠實揭示:主軌 RPC 以 payment_confirmer 身分 literal 實呼於 pooled MCP 必斷線(S2-c/d/0a/1b/4a-1/4a-2/R1a3 多次重現)
--   → 等價證據 = has_function_privilege 矩陣 + owner 身分行為 + search_path='' caller 一致 + role_table/column_grants=0;
--   真連線 round-trip 由 B1b adapter(payment_confirmer 鑰、session pooler)+ B1c route(後續)補。
--
-- 動手前真 DB 交易模擬(MCP execute_sql、project bmpnplmnldofgaohnaok PG17、2026-06-27;BEGIN + 本片 DDL + synthetic
--   orders/attempts + DO 斷言 + ROLLBACK、零留痕)= **claim 層** §8 eligibility 9 案 PASS:eligible{pending+unpaid+age≥12h+
--   throttle到期、manual=T/F 都進}全 claim、ineligible{order paid / age<12h / released / charged / failed / throttle未到}全否決
--   + ACL 矩陣(唯 payment_confirmer)+ role-hygiene grants=0 + throttle 擋 re-claim + 結構(SKIP LOCKED/FOR UPDATE OF a/
--   LEAST·GREATEST·1000)+ 對 prod 真孤兒免疫的作用域斷言。🔴 **誠實揭示**:① §8 案①-⑤ 的「Record 5/4/unreachable→failed/
--   維持 pending」是 **B1b use-case** 行為(本片 claim migration 不涵蓋、由 B1b 補測)② **「真雙連線平行 claim」未以兩條真連線
--   實測**(pooled MCP 單連線限制)→ 靠 FOR UPDATE OF a SKIP LOCKED 結構 + 與 round11-PASS 的 4a-2 claim 同構 + PG row-lock
--   原語覆蓋,真連線實證留 §14 步18/步32(db push 後雙 psql gate)補。結果回填 commit body / Codex Packet。
--
-- Rollback(Supabase forward-only、僅供參考、逆序手動):見檔尾。
-- ============================================================


-- ── 1. last_expired_settle_at 欄(B1 專屬 durable throttle;nullable、不回填、不長鎖)──
ALTER TABLE public.payment_charge_attempts
  ADD COLUMN last_expired_settle_at timestamptz;   -- B1 12h 孤兒再確認 throttle(NULL=從未經 B1 claim、立即可 claim;與 next_settle_at 分軌)

COMMENT ON COLUMN public.payment_charge_attempts.last_expired_settle_at IS
  'M-3 3DS B1a:12h 孤兒「專用再確認路徑」的 durable throttle(防熱迴圈)。claim_expired_pending_attempts claim 時蓋 now();NULL=從未經 B1 claim。與 sweeper 的 next_settle_at 分軌(B1 不碰 next_settle_at、B1b 不呼 markSettleRetry)。間隔 6h(低頻、區隔 sweeper 分鐘級)。';


-- ── 2. claim_expired_pending_attempts(原子 claim 12h 孤兒 + 蓋 throttle;canonical §8/§9 B1a)──
-- 對齊 4a-2 claim_stuck_unsettled_attempts 的原子 lease 範式,差異:
--   * 不濾 needs_manual_review(manual=true/false 都可進;B1 專為 sweeper 已放棄的 manual=true 孤兒再確認)。
--   * 不濾 settle_attempt_count<8(繞 sweeper ceiling)。
--   * 只 status='pending'(隱含排除 released/charged/failed;released 走 §2.5、不進 B1)。
--   * throttle 用 last_expired_settle_at(非 next_settle_at);age 硬編 12h(canonical 簽名僅 p_limit)。
--   * 只蓋 throttle 戳(不 ++ settle_attempt_count、不動 needs_manual_review、不動 next_settle_at)。
-- 🔴 FOR UPDATE OF a SKIP LOCKED:只鎖 payment_charge_attempts(a)、不鎖 join 的 orders(o)(對齊 4a-2 精化〔C〕)。
CREATE OR REPLACE FUNCTION public.claim_expired_pending_attempts(p_limit integer)
RETURNS TABLE(attempt_id uuid, order_id uuid, needs_manual_review boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn$
  WITH claimed AS (
    SELECT a.id
      FROM public.payment_charge_attempts a
      JOIN public.orders o ON o.id = a.order_id
     WHERE a.status = 'pending'                                    -- 隱含排除 released/charged/failed(released 不進 B1)
       AND o.payment_status = 'unpaid'::public.payment_status      -- order 已 paid 不處理
       AND a.created_at < pg_catalog.now() - interval '12 hours'   -- age ≥ 12h(孤兒)
       AND (a.last_expired_settle_at IS NULL                       -- B1 throttle 到期(獨立於 sweeper next_settle_at)
            OR a.last_expired_settle_at < pg_catalog.now() - interval '6 hours')
     ORDER BY a.created_at
     FOR UPDATE OF a SKIP LOCKED                                   -- 只鎖 a、平行 claim 同 attempt 只一 worker
     LIMIT LEAST(GREATEST(p_limit, 1), 1000)                       -- p_limit 安全上下界
  )
  UPDATE public.payment_charge_attempts a
     SET last_expired_settle_at = pg_catalog.now()                 -- 只蓋 throttle 戳(不動 manual/count/next_settle_at)
    FROM claimed
   WHERE a.id = claimed.id
  RETURNING a.id AS attempt_id, a.order_id AS order_id, a.needs_manual_review AS needs_manual_review;
$fn$;

COMMENT ON FUNCTION public.claim_expired_pending_attempts(integer) IS
  'M-3 3DS B1a:原子 claim 12h pending 孤兒(放棄未重刷)再確認(FOR UPDATE OF a SKIP LOCKED + LIMIT)。濾 status=pending(排除 released) AND order unpaid AND created_at<now()-12h AND last_expired_settle_at throttle 到期(獨立於 sweeper、間隔 6h)。**不濾 needs_manual_review(manual=true/false 都進)、不濾 settle_attempt_count(繞 ceiling)**;只蓋 last_expired_settle_at=now()(不清 manual、不動 next_settle_at/count)。回 attempt_id/order_id/needs_manual_review(orderId 餵 settleCharge 再確認)。只 payment_confirmer 可呼。';


-- ── 3. ACL(canonical §8:REVOKE PUBLIC/anon/authenticated/service_role、GRANT payment_confirmer)──
REVOKE ALL ON FUNCTION public.claim_expired_pending_attempts(integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_expired_pending_attempts(integer) TO payment_confirmer;


-- ── 4. fail-closed assert:RPC EXECUTE 矩陣(payment_confirmer=true、其餘 false;任一不符 → 擋 db push)──
DO $$
BEGIN
  IF NOT has_function_privilege('payment_confirmer', 'public.claim_expired_pending_attempts(integer)', 'EXECUTE')
     OR has_function_privilege('anon',          'public.claim_expired_pending_attempts(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated',  'public.claim_expired_pending_attempts(integer)', 'EXECUTE')
     OR has_function_privilege('service_role',    'public.claim_expired_pending_attempts(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'B1a claim_expired_pending_attempts EXECUTE 權限矩陣異常 — 應僅 payment_confirmer(canonical §8 ACL);拒繼續';
  END IF;
END
$$;


-- ── 5. role-hygiene 回歸 assert:payment_confirmer **全域**表/欄層零權限(對齊 4a-1/4a-2/1b/s2d;ADD COLUMN 勿洩 grant)──
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
    RAISE EXCEPTION 'payment_confirmer 全域表/欄層權限非零(role-hygiene 破、ADD COLUMN 洩 grant)— 拒繼續';
  END IF;
END
$$;


-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):
--   DROP FUNCTION IF EXISTS public.claim_expired_pending_attempts(integer);
--   ALTER TABLE public.payment_charge_attempts DROP COLUMN IF EXISTS last_expired_settle_at;
-- ============================================================
