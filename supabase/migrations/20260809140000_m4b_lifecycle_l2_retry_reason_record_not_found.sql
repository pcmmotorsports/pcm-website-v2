-- ============================================================
-- M-4b 生命週期 L2:retry RPC reason allowlist 補 record_not_found(TS↔DB allowlist 對齊)
-- ============================================================
-- 真權威:docs/specs/2026-08-09-order-payment-lifecycle-plan.md 件③「第一步」(拆桶)。
-- 🔴 批准範圍誠實標註:Sean 2026-08-09 對 plan §6 六題逐字 `Q1:a … Q6:a`(經主視窗信 P-232-A 轉達,
--   該信在信箱、**不在 repo**;拍板本體落 memory project_m4b-b2-shipments-db-decisions.md:76-83)。
--   其中 Q4=A 講的是 **L5** 的 N=3 / T=30min,**不是**對本片 allowlist 改動的個別批准 ——
--   本片的批准依據是「plan v1 整份核過 + 開工序 L1→L6」,不是 Q4。
-- 背景:同片 TS 側把 `record_not_found` 從 `record_unverified` 拆出(settleCharge 唯一 producer)並加進
--   `SWEEP_REASON_CODES`(packages/use-cases/src/sweep-settlements.ts)。DB 兩支 retry RPC 的
--   `last_settle_error/last_error` allowlist 若不同批放行此碼,值會落 ELSE 存成 'unknown'。
--
-- 🔴 這一片不是「順手對齊遙測」——它是 L5 的硬前置:
--   L5(殭屍 attempt 自動裁定)的判別條件逐字是「**最近一次 settle 結果 = record_not_found**」,
--   而它唯一的讀取來源就是 `payment_charge_attempts.last_settle_error`。allowlist 不放行 ⇒ 該欄永遠存
--   'unknown' ⇒ **L5 的條件恆假、自動裁定靜默不生效、而且測試會全綠**(單元測試 mock RPC、看不到 allowlist)。
--   同型事故已發生過:memory `feedback_app-layer-must-not-ship-before-migration-apply`。
--   ⇒ **L5 不得早於本 migration apply 上線**;觀測點見同片 plan §4-6。
--
-- 🔴🔴 對 L5 的硬契約(codex 關卡2 R2 must-fix、TOCTOU):`last_settle_error = 'record_not_found'` 這個值
--   **不足以**當釋鎖依據。settleCharge 是在讀到 status='pending' 的當下判這個 reason 的,但寫進本欄要等
--   retry RPC,而本 RPC 的 WHERE 收 pending|charged|released ⇒ 期間若有並行路徑把 attempt 推到 charged
--   (= 已看過 Record 給的 rec、錢很可能已扣),欄位仍會存 'record_not_found'。
--   ⇒ **L5 的釋鎖 RPC 必須在鎖下自己重驗 `a.status = 'pending'`**(以及 order 仍 unpaid),
--   不得只信這個診斷欄。本片刻意**不**在此加狀態分支:那會讓「零漂移」不成立,而且守門畫錯層 ——
--   不變量是「釋鎖時 attempt 必須仍是 pending」,它成立的面在 L5 的釋鎖語句,不在診斷欄的寫入端。
--
-- 🔴🔴 更根本的一條(Fable R3 F2):`last_settle_error` **不是「最近一次 settle 結果」** ——
--   只有 sweeper 的 ③ stuck 路徑會寫它(sweep-settlements.ts);② inbox 路徑寫的是 webhook event 的
--   `last_error`、同輪撞單的 dedup 連 markSettleRetry 都跳過,而 callback / preflight 的 settle 結果
--   **完全不落欄**。⇒ 這一欄可能停在很舊的觀察上:t0 存了 'record_not_found',之後每輪都由 inbox 路徑
--   對帳、實際已轉 auth_or_pending(Record 有這筆、授權中),欄位卻仍是 'record_not_found'。
--   此時上面那條 TOCTOU 契約(status='pending' + order unpaid)**兩條都成立、擋不住** ⇒ 對一筆活授權釋鎖 = 雙扣。
--   ⇒ **L5 釋鎖前必須有自己的一次新鮮 Record 觀察**(或改走 plan Q4 選項 (a):加一個由所有 settle 路徑
--   共同維護的連續計數欄)。**不得只憑本欄的值放行**。
--
-- 影響函式(兩支皆 CREATE OR REPLACE、reason 由共用 normalizeReason 餵):
--   ① public.mark_attempt_settle_retry(uuid, integer, text)  — live = 20260702120000(#251)
--        消費者:PgChargeAttemptAdapter.markSettleRetry → sweep-settlements ③ stuck 路徑。
--   ② public.mark_webhook_retry(text, integer, text)         — live = 20260702120000(#251)
--        消費者:PgWebhookInboxAdapter.markRetry → sweep-settlements ② inbox 路徑。
--
-- 鐵則 8(改既有 payment 對帳 RPC)+ 鐵則 12①③(payment / 對帳 sweeper、窄權、零 PII、fail-closed)。
--
-- 🔴 零漂移聲明(範圍講精確,codex 關卡2 nit):**可執行 SQL 的唯一改動 = allowlist CASE 的 `IN (...)`
--   加 'record_not_found'**(兩支各一行)。另有三處**非執行文字**同時更新:兩支的 COMMENT ON FUNCTION
--   字串、以及 §3 assert 的 RAISE 訊息前綴 —— 這三處不影響行為,但為免「唯一」二字被讀成 byte-identical,
--   在此逐條列出。函式體其餘部分
--   (退避公式 / token guard / needs_manual_review / order-unpaid 閘 / released_manual_review_at write-once /
--   SECDEF / search_path='' / 不 ++)逐字取自 live 版 20260702120000,以「讀 live 檔 → 只做該字串替換 → diff
--   核對」的方式產生,**不手抄**。ACL 沿用基線(CREATE OR REPLACE 不重置 GRANT、簽名未變);本片無 ALTER /
--   無新欄 / 無 REVOKE/GRANT,僅末端 fail-closed 矩陣 + role-hygiene 回歸 assert。
--
-- 🔴 producer 可達性(誠實揭示):`record_not_found` 的 producer = settleCharge 在「查詢成功且零筆」時回傳,
--   本片同批進 repo ⇒ apply 後即可達(≠ #251 當時的 flag-gated 不可達)。現況正式站殭屍 0/pending 0
--   (主視窗 P-232-A ② 盤點),故 apply 當下預期零觸發、不代表路徑不通。
--
-- ── 🔴 驗證紀錄(2026-08-09 更正:原本這一段寫成過去式,實際上當時一格都沒跑)──────
-- 原稿把下列清單以「動手前真 DB 交易模擬(…):T1…T5」的語氣寫在這裡,**讀起來像紀錄、實際是清單**
-- —— 我(P 窗)沒有正式站 DB 存取權,一格都沒執行,那段是照 20260702120000(#251)的檔頭形狀抄來的。
-- 沒有人發現;是我在寫 L3 檔頭要抄同一段時自曝(P-240-STOP)。以下是**現在為止的真實狀態**:
--
-- ✅ 已跑(正式站 apply 當下真的執行,因為它們就寫在本檔 §3/§4):
--    · EXECUTE 權限矩陣(唯 payment_confirmer)
--    · payment_confirmer 全域表/欄層零權限(role-hygiene 回歸)
--    🔴 **不寫時鐘時間**(我沒有可驗來源、原稿的「14:1x」是照口頭訊息抄的)。可重查的來源有兩個:
--       ① `STATUS.md` 2026-08-09 14:30 節(commit `e9b6ce09`);② `supabase migration list` 的
--       local|remote 兩欄對 `20260809140000` 是否對齊。以這兩者為準,不以本註解為準。
--
-- ✅ 已補跑(本地隔離 PG17,`scripts/l3-verify.sh` D 區 4 格,2026-08-09;每格自包 BEGIN…ROLLBACK 零留痕;
--    該次執行輸出逐字 PASS=25 FAIL=0 突變命中=5)——**P-240 那筆帳到此結清**:
--    · D1 = 原 T1:mark_attempt_settle_retry(reason='record_not_found')→ last_settle_error='record_not_found'
--    · D2:reason='bogus_xyz' → 'unknown'(ELSE 仍守、白名單沒被放寬成任意值)
--    · D3:reason='record_unverified' → 原值(既有碼零回歸)
--    · D4 = 原 T4:mark_webhook_retry(reason='record_not_found')→ last_error='record_not_found'
--    ⚠️ 誠實邊界:本地 vanilla PG17 ≠ Supabase(無 RLS 情境、auth.uid() 回 NULL);
--       驗到的是**函式邏輯**,不是平台差異。
--
-- ⬜ 未跑(且不打算補):原 T2/T3/T5 是 T1/T4 的同型變體,已由 D2/D3 涵蓋同一條 ELSE 分支。
--
-- 🔴 給後人的規矩:這一段只寫**已經發生的事**。要列待辦就明寫「未執行」,不要用完成式描述計畫。
--
-- Rollback(Supabase forward-only、僅供參考):CREATE OR REPLACE 還原兩函式 allowlist 為 4 碼版
--   (見 20260702120000);本片無 schema/欄/ACL 變更。
-- ============================================================


-- ── 1. mark_attempt_settle_retry:allowlist 加 record_not_found(其餘逐字 = 20260702120000 #251 body)──
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
           -- 🔴 M-4b L2 唯一改動:allowlist IN(...) 再加 'record_not_found'(TS SWEEP_REASON_CODES 對齊、零 PII 固定碼集)
           last_settle_error = CASE
             WHEN p_reason_code IN ('record_unreachable', 'record_unverified', 'record_not_found', 'auth_or_pending', 'released_failure_observed')
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
  'M-3 3DS-4a-2 + R1c1 + #251 + M-4b L2:pending outcome 退避 retry。next_settle_at=2^(settle_attempt_count-1) 封頂 16min;**ceiling(>=8)→needs_manual_review 僅 pending/charged**(R1c1:released 繞 ceiling、不誤標 manual);**released 達 12h(released_at<=now()-12h)→ released_manual_review_at write-once COALESCE(獨立欄、≠ 停止對帳)**;last_settle_error 固定錯誤碼集(零 PII;#251 加 released_failure_observed、M-4b L2 加 record_not_found)。token guard(settle_attempt_count=p_claimed_count + needs_manual_review=false + order unpaid + status IN(pending,charged,released))防 stale/late mark/平行已付款單。不 ++(遞增唯一在 claim)。回 affected(1=已退避、0=no-op)。只 payment_confirmer 可呼。';


-- ── 2. mark_webhook_retry:allowlist 加 record_not_found(其餘逐字 = 20260702120000 #251 body)──
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
           -- 🔴 M-4b L2 唯一改動:allowlist IN(...) 再加 'record_not_found'(TS SWEEP_REASON_CODES 對齊、零 PII 固定碼集)
           last_error = CASE
             WHEN p_reason_code IN ('record_unreachable', 'record_unverified', 'record_not_found', 'auth_or_pending', 'released_failure_observed')
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
  'M-3 3DS-4a-1 + #251 + M-4b L2:pending outcome 退避 retry。next_retry_at=2^(attempt_count-1) 封頂 16min;達 ceiling(>=8)→needs_manual_review;last_error 固定錯誤碼集(零 PII;#251 加 released_failure_observed、M-4b L2 加 record_not_found)。token guard(attempt_count=p_claimed_count + needs_manual_review=false)防 stale;🔴 已轉人工 row late retry=no-op(decouple maxDuration≤lease 耦合、codex K2 r1)。不 ++(遞增唯一在 claim)。只 payment_confirmer 可呼。';


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
    RAISE EXCEPTION 'L2 retry RPC EXECUTE 矩陣異常 — 應唯 payment_confirmer;拒繼續';
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
