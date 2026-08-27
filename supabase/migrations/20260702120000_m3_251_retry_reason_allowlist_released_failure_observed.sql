-- ============================================================
-- M-3 #251:retry RPC reason allowlist 補 released_failure_observed(TS↔DB allowlist 對齊、flag-on 前 gate)
-- ============================================================
-- 真權威:docs/phase-1-backlog.md #251 + canonical §5/§2.5 + R2a(§14 步23、Q1=A 2026-06-25 Sean 拍)。
-- 背景:R2a 已於 TS 側把 `released_failure_observed` 加入 `SWEEP_REASON_CODES`(packages/use-cases/src/
--   sweep-settlements.ts),但 DB 兩支 retry RPC 的 `last_settle_error/last_error` allowlist 仍只認
--   ('record_unreachable','record_unverified','auth_or_pending') → sweeper/inbox 以 released_failure_observed
--   呼 markSettleRetry / markRetry 時,診斷欄落 ELSE 存成 'unknown'(TS↔DB 漂移)。
-- 🔴 非正確性 bug:last_settle_error / last_error = 純診斷遙測欄(零 PII),不影響重試是否發生(token-guard
--   UPDATE)、不影響結算/雙扣裁決;僅 ops 觀測時看不出「這筆是 released 失敗觀察」。本片對齊 allowlist。
--
-- 影響函式(兩支皆 CREATE OR REPLACE、reason 由共用 normalizeReason 餵、兩路徑皆可帶 released_failure_observed):
--   ① public.mark_attempt_settle_retry(uuid, integer, text)  — live = 20260624120008(R1c1)
--        消費者:PgChargeAttemptAdapter.markSettleRetry → sweep-settlements ③ stuck 路徑。
--   ② public.mark_webhook_retry(text, integer, text)         — live = 20260615120000(4a-1)
--        消費者:PgWebhookInboxAdapter.markRetry → sweep-settlements ② inbox 路徑。
--
-- 鐵則 8(改既有 payment 對帳 RPC 行為)+ 鐵則 12(payment / 對帳 sweeper、窄權、零 PII、fail-closed)。
--
-- 🔴 零漂移聲明:兩支函式**唯一改動 = allowlist CASE 的 `IN (...)` 加 'released_failure_observed'**;其餘(退避
--   公式〔含 R1c1 對 attempt 的 LEAST(...,16) 溢位 cap 逐字保留;webhook 側無 released 繞閘、無溢位面、退避逐字不改〕
--   / token guard / needs_manual_review / order-unpaid 閘 / released_manual_review_at write-once / SECDEF /
--   search_path='' / 不 ++ → **可執行 SQL(去行內註解)除 allowlist 那一行外零行為漂移**(行內註解措辭與
--   COMMENT 有更新註明 #251、屬非執行文字、非 literal byte-identical)。ACL **沿用基線**(CREATE OR REPLACE 不重置
--   GRANT/REVOKE、簽名未變 → payment_confirmer EXECUTE 持續;本片無 ALTER / 無新欄 / 無 REVOKE/GRANT,僅末端
--   fail-closed 矩陣 + role-hygiene 回歸 assert)。
--
-- 🔴 producer-gating(誠實揭示、Phase 1 不可達):released_failure_observed 由 settleCharge 觀察 released attempt
--   讀 Record -1/5 產生。TS 端 SWEEP_REASON_CODES + normalizeReason 已可承接此碼(inbox+attempt 兩路徑),但
--   **實際 producer(settleCharge 的 released 分支)仍待 R2b/flag-on**。release CAS 的唯一 app caller = R3 preflight
--   (`PgReleaseSiblingAdapter` 經 preflightReleaseSibling→chargePaymentAction)、受 `TAPPAY_3DS_ENABLED` flag gate →
--   flag off 不可達 → 無 released row → 本 reason 現況零觸發(last_settle_error 現況也不會存 'unknown')。
--   此片=前瞻對齊、flag-on 前補、db-push 換 Sean。
--
-- 動手前真 DB 交易模擬(MCP execute_sql、atomic DO block 套 2 函式 REPLACE + synthetic order/attempt/webhook_event +
--   DO 斷言 + 末端 RAISE 強制 rollback、零留痕):
--   T1 attempt: reason='released_failure_observed' → last_settle_error='released_failure_observed'(修生效、非 'unknown');
--   T2 attempt: reason='bogus_xyz' → last_settle_error='unknown'(ELSE 仍守、白名單未放寬到任意值);
--   T3 attempt: reason='record_unreachable' → 'record_unreachable'(既有碼零回歸);
--   T4 webhook: reason='released_failure_observed' → last_error='released_failure_observed'(修生效);
--   T5 webhook: reason='bogus_xyz' → 'unknown'(ELSE 守);
--   + has_function_privilege 矩陣(唯 payment_confirmer)+ role-hygiene grants=0 + 末端 RAISE rollback、residue=0。
--
-- Rollback(Supabase forward-only、僅供參考):CREATE OR REPLACE 還原兩函式 allowlist 為 3 碼版(見 20260624120008
--   §2 / 20260615120000 §5);本片無 schema/欄/ACL 變更。
-- ============================================================


-- ── 1. mark_attempt_settle_retry:allowlist 加 released_failure_observed(其餘逐字 = 20260624120008 R1c1 body)──
CREATE OR REPLACE FUNCTION public.mark_attempt_settle_retry(
  p_attempt_id    uuid,
  p_claimed_count integer,
  p_reason_code   text
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn$
  WITH upd AS (
    UPDATE public.payment_charge_attempts a
       SET next_settle_at = pg_catalog.now()
             -- 🔴 退避指數先 cap 16 再 power 防 int4 溢位〔R1c1 G、逐字保留〕:released 繞 ceiling → settle_attempt_count
             --    無界(基線 pending/charged 受 count<8 隱含上界不溢位);2^4=16 已達分鐘 cap → 指數 cap 行為等價、純防溢位。
             + pg_catalog.make_interval(mins =>
                 LEAST(pg_catalog.power(2, LEAST(GREATEST(a.settle_attempt_count - 1, 0), 16))::integer, 16)),
           -- 🔴 #251 唯一改動:allowlist IN(...) 加 'released_failure_observed'(TS SWEEP_REASON_CODES 對齊、零 PII 固定碼集)
           last_settle_error = CASE
             WHEN p_reason_code IN ('record_unreachable', 'record_unverified', 'auth_or_pending', 'released_failure_observed')
               THEN p_reason_code ELSE 'unknown' END,
           -- ceiling→manual 僅 pending/charged;released 繞 ceiling、不誤標 needs_manual_review(§2.5)〔逐字〕
           needs_manual_review = (a.needs_manual_review
                                  OR (a.status IN ('pending', 'charged') AND a.settle_attempt_count >= 8)),
           -- released 達 12h 仍非 paid → 標 released_manual_review_at(獨立欄、write-once COALESCE、≠ 停止對帳)〔逐字〕
           released_manual_review_at = CASE
             WHEN a.status = 'released'
               AND a.released_at IS NOT NULL
               AND a.released_at <= pg_catalog.now() - interval '12 hours'
               THEN COALESCE(a.released_manual_review_at, pg_catalog.now())
             ELSE a.released_manual_review_at END
      FROM public.orders o
     WHERE o.id = a.order_id
       AND a.id = p_attempt_id
       AND o.payment_status = 'unpaid'::public.payment_status
       AND a.status IN ('pending', 'charged', 'released')
       AND a.settle_attempt_count = p_claimed_count
       AND a.needs_manual_review = false
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer FROM upd;
$fn$;

COMMENT ON FUNCTION public.mark_attempt_settle_retry(uuid, integer, text) IS
  'M-3 3DS-4a-2 + R1c1 + #251:pending outcome 退避 retry。next_settle_at=2^(settle_attempt_count-1) 封頂 16min;**ceiling(>=8)→needs_manual_review 僅 pending/charged**(R1c1:released 繞 ceiling、不誤標 manual);**released 達 12h(released_at<=now()-12h)→ released_manual_review_at write-once COALESCE(獨立欄、≠ 停止對帳)**;last_settle_error 固定錯誤碼集(零 PII;#251 對齊 TS SWEEP_REASON_CODES 加 released_failure_observed)。token guard(settle_attempt_count=p_claimed_count + needs_manual_review=false + order unpaid + status IN(pending,charged,released))防 stale/late mark/平行已付款單。不 ++(遞增唯一在 claim)。回 affected(1=已退避、0=no-op)。只 payment_confirmer 可呼。';


-- ── 2. mark_webhook_retry:allowlist 加 released_failure_observed(其餘逐字 = 20260615120000 4a-1 body)──
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
           -- 🔴 #251 唯一改動:allowlist IN(...) 加 'released_failure_observed'(TS SWEEP_REASON_CODES 對齊、零 PII 固定碼集)
           last_error = CASE
             WHEN p_reason_code IN ('record_unreachable', 'record_unverified', 'auth_or_pending', 'released_failure_observed')
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
  'M-3 3DS-4a-1 + #251:pending outcome 退避 retry。next_retry_at=2^(attempt_count-1) 封頂 16min;達 ceiling(>=8)→needs_manual_review;last_error 固定錯誤碼集(零 PII;#251 對齊 TS SWEEP_REASON_CODES 加 released_failure_observed)。token guard(attempt_count=p_claimed_count + needs_manual_review=false)防 stale;🔴 已轉人工 row late retry=no-op(decouple maxDuration≤lease 耦合、codex K2 r1)。不 ++(遞增唯一在 claim)。只 payment_confirmer 可呼。';


-- ── 3. fail-closed assert:本片 REPLACE 的 2 RPC EXECUTE 矩陣(payment_confirmer=true、其餘 false;ACL 沿用基線、回歸驗)──
DO $$
BEGIN
  IF NOT has_function_privilege('payment_confirmer', 'public.mark_attempt_settle_retry(uuid, integer, text)', 'EXECUTE')
     OR NOT has_function_privilege('payment_confirmer', 'public.mark_webhook_retry(text, integer, text)', 'EXECUTE')
     OR has_function_privilege('anon',          'public.mark_attempt_settle_retry(uuid, integer, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.mark_attempt_settle_retry(uuid, integer, text)', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.mark_attempt_settle_retry(uuid, integer, text)', 'EXECUTE')
     OR has_function_privilege('anon',          'public.mark_webhook_retry(text, integer, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.mark_webhook_retry(text, integer, text)', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.mark_webhook_retry(text, integer, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '#251 retry RPC EXECUTE 矩陣異常 — 應唯 payment_confirmer;拒繼續';
  END IF;
END
$$;


-- ── 4. role-hygiene 回歸 assert:payment_confirmer **全域**表/欄層零權限(本片無 ALTER、回歸驗不退步)──
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
