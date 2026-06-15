-- ============================================================
-- M-3 3DS-4a-1:sweeper inbox RPC — payment_webhook_events claim/mark + needs_manual_review 欄
-- ============================================================
-- 真權威:docs/specs/2026-06-15-m3-3ds-4-sweeper-cron-plan.md §5.1(3DS-4a-1)+ master plan v5 §2(3DS-4)。
-- 依賴:20260613120000(3DS-0a payment_webhook_events 表)、20260611120000(payment_confirmer 角色、S2-c)。
-- 鐵則 8(新 RPC + ALTER + GRANT)+ 鐵則 12(payment / 對帳 sweeper)。
--
-- 🔴 設計(plan §5.1、三模型審查 Opus+Codex+Gemini + codex 關卡1 r2 收斂):
--   ① 3DS-4b sweeper 原子 claim webhook inbox 未處理事件 → settleCharge → mark processed/retry(退避、非死信)。
--   ② 🔴 原子 lease(claim):CTE FOR UPDATE SKIP LOCKED + LIMIT → 兩 cron run 不重領、obey p_limit(Record 節流);
--      attempt_count++(唯一遞增點=claim、語意=「claim 次數」非「失敗次數」)、next_retry_at=now()+5min lease。
--   ③ 🔴 token guard(mark):mark_processed/mark_retry 帶 p_claimed_count、WHERE attempt_count=p_claimed_count →
--      事件被另一 run 重領(count 已變)時 stale mark=no-op(回 affected=0)、不覆蓋(codex 關卡1 r2 群4)。
--   ④ 🔴 ceiling=8 退熱迴圈(Q2=A):claim 濾 attempt_count<8;mark_retry 達 8→needs_manual_review;
--      🔴 ceiling-expirer(claim 前置、防孤兒、codex r2-#1):claim 達 ceiling 後若 route crash 在 mark 前 →
--      attempt_count>=8 永遠被 claim 濾掉又沒 set manual = 永久孤兒 → 前置 RPC 把達 ceiling 未處理一律轉 manual。
--   ⑤ 退避 by (attempt_count-1)→1/2/4/8/16 min(封頂 16、對齊 Q2=A;首次 claim 後 count=1→2^0=1min off-by-one 校正)。
--   ⑥ last_error 只存固定錯誤碼集(record_unreachable/record_unverified/auth_or_pending/unknown、零 PII)。
--   ⑦ 權限:RPC SECURITY DEFINER + search_path='' + 全識別子 schema-qualified;REVOKE EXECUTE 全 → GRANT
--      payment_confirmer;has_function_privilege 矩陣 + payment_confirmer 表/欄層零權限 role-hygiene 回歸 assert。
--
-- ⚠️ 誠實揭示:主軌 RPC 以 payment_confirmer 身分 literal 實呼於 pooled MCP 必斷線(S2-c/d 多次重現)→ 等價證據
--   = has_function_privilege 矩陣 + owner 身分行為 + search_path='' caller 一致;真連線 round-trip 由 3DS-4c route 補。
--
-- 動手前真 DB 交易模擬(MCP execute_sql、BEGIN + DDL + synthetic + DO 斷言 + ROLLBACK、零留痕):見 commit body。
-- 🔴 入 db push bundle;依賴 **0a(payment_webhook_events 表、仍待 push)** 必先於/同 bundle 套用(否則 claim/mark
--    引用不存在的表);完整 bundle 順序=0a→0b→0c→1b→#214a→4a-1(本檔)→4a-2;cart_session_id 整合前不單推
--    (memory 3ds-db-push-bundle-blocked)。
-- Rollback(forward-only、僅供參考、逆序手動):見檔尾。
-- ============================================================


-- ── 1. needs_manual_review 欄(durable 轉人工旗標;達 ceiling set、後台/SQL 可查)──
ALTER TABLE public.payment_webhook_events
  ADD COLUMN needs_manual_review boolean NOT NULL DEFAULT false;


-- ── 2. expire_webhook_events_at_ceiling()(ceiling-expirer、claim 前置、防孤兒;codex r2-#1)──
-- claim 把 attempt_count 加到 ceiling 後若 route timeout/crash 在 mark 前 → 該事件 attempt_count>=8 永遠被 claim
-- 濾掉、又沒被 markRetry set needs_manual_review → 永久孤兒。sweeper 每輪 claim 前呼 → 達 ceiling 且 **lease 到期**
-- 仍未 processed/manual 一律轉 manual(durable 告警);回轉換筆數(>0 = sweeper 告警)。
-- 🔴 lease 條件(codex 關卡2 consider):孤兒定義 = 達 ceiling **且 next_retry_at <= now()(lease 到期)**;否則
--    overlap cron 會把「剛 claim、仍在 5min lease 內處理中」事件提早誤標 manual(假人工告警、晚 mark 後留
--    processed=true+manual)。NULL next_retry_at(未經 claim 不可能達 ceiling、防禦性納入)亦視為到期。
CREATE OR REPLACE FUNCTION public.expire_webhook_events_at_ceiling()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn$
  WITH upd AS (
    UPDATE public.payment_webhook_events
       SET needs_manual_review = true
     WHERE processed = false
       AND needs_manual_review = false
       AND attempt_count >= 8
       AND (next_retry_at IS NULL OR next_retry_at <= pg_catalog.now())
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer FROM upd;
$fn$;

COMMENT ON FUNCTION public.expire_webhook_events_at_ceiling() IS
  'M-3 3DS-4a-1:ceiling-expirer(claim 前置、防孤兒)。達 ceiling(attempt_count>=8)仍未 processed/manual → 轉 needs_manual_review;回轉換筆數。只 payment_confirmer 可呼。';


-- ── 3. claim_due_webhook_events(原子 lease claim;plan §5.1)──
CREATE OR REPLACE FUNCTION public.claim_due_webhook_events(p_limit integer)
RETURNS TABLE(rec_trade_id text, order_number text, attempt_count integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn$
  WITH due AS (
    SELECT e.rec_trade_id
      FROM public.payment_webhook_events e
     WHERE e.processed = false
       AND e.needs_manual_review = false
       AND e.attempt_count < 8
       AND (e.next_retry_at IS NULL OR e.next_retry_at <= pg_catalog.now())
     ORDER BY e.next_retry_at NULLS FIRST
     FOR UPDATE SKIP LOCKED
     LIMIT LEAST(GREATEST(p_limit, 1), 1000)
  )
  UPDATE public.payment_webhook_events e
     SET attempt_count = e.attempt_count + 1,
         next_retry_at = pg_catalog.now() + interval '5 minutes'
    FROM due
   WHERE e.rec_trade_id = due.rec_trade_id
  RETURNING e.rec_trade_id, e.order_number, e.attempt_count;
$fn$;

COMMENT ON FUNCTION public.claim_due_webhook_events(integer) IS
  'M-3 3DS-4a-1:原子 lease claim 未處理 inbox(FOR UPDATE SKIP LOCKED + LIMIT)。attempt_count++(claim token)+ 5min lease;濾 attempt_count<8 + 非 manual。回 rec_trade_id/order_number/attempt_count。只 payment_confirmer 可呼。';


-- ── 4. mark_webhook_processed(token guard;settle 達 terminal/no_attempt 後)──
CREATE OR REPLACE FUNCTION public.mark_webhook_processed(
  p_rec_trade_id text,
  p_claimed_count integer
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn$
  WITH upd AS (
    UPDATE public.payment_webhook_events
       SET processed = true,
           processed_at = pg_catalog.now()
     WHERE rec_trade_id = p_rec_trade_id
       AND processed = false
       AND attempt_count = p_claimed_count
       AND needs_manual_review = false
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer FROM upd;
$fn$;

COMMENT ON FUNCTION public.mark_webhook_processed(text, integer) IS
  'M-3 3DS-4a-1:settle 達 terminal/no_attempt 後標 processed。token guard(attempt_count=p_claimed_count + needs_manual_review=false)防 stale 覆寫;🔴 已轉人工 row late mark=no-op(decouple maxDuration≤lease 耦合、Vercel 預設 300s=lease、codex K2 r1)。回 affected(1=已標、0=no-op)。只 payment_confirmer 可呼。';


-- ── 5. mark_webhook_retry(token guard;退避 + 達 ceiling 轉 manual;不 ++)──
CREATE OR REPLACE FUNCTION public.mark_webhook_retry(
  p_rec_trade_id text,
  p_claimed_count integer,
  p_reason_code text
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn$
  WITH upd AS (
    UPDATE public.payment_webhook_events e
       SET next_retry_at = pg_catalog.now()
             + pg_catalog.make_interval(mins =>
                 LEAST(pg_catalog.power(2, GREATEST(e.attempt_count - 1, 0))::integer, 16)),
           last_error = CASE
             WHEN p_reason_code IN ('record_unreachable', 'record_unverified', 'auth_or_pending')
               THEN p_reason_code ELSE 'unknown' END,
           needs_manual_review = (e.needs_manual_review OR e.attempt_count >= 8)
     WHERE e.rec_trade_id = p_rec_trade_id
       AND e.processed = false
       AND e.attempt_count = p_claimed_count
       AND e.needs_manual_review = false
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer FROM upd;
$fn$;

COMMENT ON FUNCTION public.mark_webhook_retry(text, integer, text) IS
  'M-3 3DS-4a-1:pending outcome 退避 retry。next_retry_at=2^(attempt_count-1) 封頂 16min;達 ceiling(>=8)→needs_manual_review;last_error 固定錯誤碼集(零 PII)。token guard(attempt_count=p_claimed_count + needs_manual_review=false)防 stale;🔴 已轉人工 row late retry=no-op(decouple maxDuration≤lease 耦合、codex K2 r1)。不 ++(遞增唯一在 claim)。只 payment_confirmer 可呼。';


-- ── 6. RPC 權限:全 REVOKE 再精準 GRANT payment_confirmer ──
REVOKE ALL ON FUNCTION public.expire_webhook_events_at_ceiling()        FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_due_webhook_events(integer)         FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_webhook_processed(text, integer)     FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_webhook_retry(text, integer, text)   FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expire_webhook_events_at_ceiling()     TO payment_confirmer;
GRANT EXECUTE ON FUNCTION public.claim_due_webhook_events(integer)      TO payment_confirmer;
GRANT EXECUTE ON FUNCTION public.mark_webhook_processed(text, integer)  TO payment_confirmer;
GRANT EXECUTE ON FUNCTION public.mark_webhook_retry(text, integer, text) TO payment_confirmer;


-- ── 7. fail-closed assert:RPC EXECUTE 矩陣(payment_confirmer=true、其餘 false)──
DO $$
BEGIN
  IF NOT has_function_privilege('payment_confirmer', 'public.expire_webhook_events_at_ceiling()', 'EXECUTE')
     OR NOT has_function_privilege('payment_confirmer', 'public.claim_due_webhook_events(integer)', 'EXECUTE')
     OR NOT has_function_privilege('payment_confirmer', 'public.mark_webhook_processed(text, integer)', 'EXECUTE')
     OR NOT has_function_privilege('payment_confirmer', 'public.mark_webhook_retry(text, integer, text)', 'EXECUTE')
     OR has_function_privilege('anon',          'public.expire_webhook_events_at_ceiling()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.expire_webhook_events_at_ceiling()', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.expire_webhook_events_at_ceiling()', 'EXECUTE')
     OR has_function_privilege('anon',          'public.claim_due_webhook_events(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_due_webhook_events(integer)', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.claim_due_webhook_events(integer)', 'EXECUTE')
     OR has_function_privilege('anon',          'public.mark_webhook_processed(text, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.mark_webhook_processed(text, integer)', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.mark_webhook_processed(text, integer)', 'EXECUTE')
     OR has_function_privilege('anon',          'public.mark_webhook_retry(text, integer, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.mark_webhook_retry(text, integer, text)', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.mark_webhook_retry(text, integer, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '3DS-4a-1 sweeper inbox RPC EXECUTE 矩陣異常 — 應唯 payment_confirmer;拒繼續';
  END IF;
END
$$;


-- ── 8. role-hygiene 回歸 assert:payment_confirmer **全域**表/欄層零權限(對齊 1b/s2d 全域版;ALTER 加欄勿洩
--    grant、且防未來同檔追加他表 ALTER 漏盯;code-reviewer Nit;prod 實查全域=0 已確認)──
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
    RAISE EXCEPTION 'payment_confirmer 全域表/欄層權限非零(role-hygiene 破、加欄洩 grant)— 拒繼續';
  END IF;
END
$$;


-- ============================================================
-- Rollback(逆序手動):
--   DROP FUNCTION IF EXISTS public.mark_webhook_retry(text, integer, text);
--   DROP FUNCTION IF EXISTS public.mark_webhook_processed(text, integer);
--   DROP FUNCTION IF EXISTS public.claim_due_webhook_events(integer);
--   DROP FUNCTION IF EXISTS public.expire_webhook_events_at_ceiling();
--   ALTER TABLE public.payment_webhook_events DROP COLUMN IF EXISTS needs_manual_review;
-- ============================================================
