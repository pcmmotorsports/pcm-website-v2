-- ============================================================
-- M-3 #256:pending-based 雙扣偵測(GAP2 靜默盲區治本)— 擴充 #250 聚合 RPC 加第 7 計數
-- ============================================================
--
-- 目的:#252 二度確認發現 GAP2(異 cart + >10min + 純 pending 兄弟單)雙扣走 `pending→charged`、
--   不觸發 anomaly genesis(只認 `released→charged`,全 repo 唯一 anomaly 主表 INSERT gate status='released')
--   → #250/W1 靜默看不見。本片補「pending-based 偵測」讓 GAP2 也會告警。
--
-- 🔴 偵測 = 卡住指紋 + 同金額 + 窗(Sean 2026-07-01 拍;codex K1 round1 FAIL→round2 PASS-WITH-CONCERNS):
--   同 customer_user_id + 同 total + 兩 paid 單 paid_at 差 < 窗(預設 12h)
--   + **其一 charged attempt「卡住指紋」**:`updated_at - created_at` > 卡住門檻(預設 600s=10min)。
--   理由:正常「乾脆買兩個一樣的」兩筆秒扣(真實資料實測 charged 耗時 7~105s、全 <2min → 無指紋 → 不誤報);
--         GAP2 第一筆卡 >10min(客人放棄才重付、原 3DS late-success)→ 有指紋 → 告警。
--   codex 親驗:3DS initiate 只寫 rec 維持 pending、真正 charged 才寫 updated_at;charged 後 sweeper/poll
--   只動 settle_attempt_count/next_settle_at/last_poll_settle_at,**不刷 updated_at** → 指紋可靠。
--
-- 🔴 安全層(鐵則 12;對齊 #250 範式,只擴 summary RPC、不動 anomaly 兩表 grant 與 lifecycle RPC):
--   - CREATE OR REPLACE 不可換 arg 數 → DROP 舊 (integer) + CREATE 新三參 (integer,integer,integer)。
--     呼叫端(PgAnomalyAlertReaderAdapter)= 片2 同步三參;flag=false + db push=Sean 在 enabled 驗證/部署前 → 零在線風險。
--   - SECURITY DEFINER(owner)+ SET search_path='' + schema-qualified;payment_confirmer 只 EXECUTE、對
--     anomaly 兩表 + payment_charge_attempts + orders **零直接 SELECT**(唯讀 MCP 實查 has_table_privilege 皆 false)
--     → 只能經此受控窗讀聚合;RPC 只回**計數**(零 PII/零金額/零 id)。
--   - ACL:REVOKE 5 角色(含 payment_confirmer)對新簽名 → GRANT payment_confirmer;
--     assert:EXECUTE 矩陣 + role_routine_grants 危險殘留 + role-hygiene + effective-privilege(含 orders、codex F3)。
--
-- 🔴 誠實邊界:
--   - 候選=待人工查證,非已確認雙扣(對齊 #250 open 語意);卡住指紋大幅降誤報但**非零**(極少數正常付款也可能拖久)。
--   - 卡住時長用 `updated_at - created_at`(近似、非專用 charged_at 欄;偏保守多抓非漏)。
--   - 可能與 open_count 重疊(released 雙扣第二筆亦 paid + 若其一卡住)→ 冗餘偵測非 bug、揭示。
--   - 窗/卡住門檻皆營運參數(route 常數注入、揭示可調、非 SLA)。
--   - 計數為 GROUP BY user+total 的**候選「組」數**、非「案件數」。
--
-- @see docs/specs/2026-07-01-m3-256-pending-double-charge-detection-plan.md(真權威 plan、codex K1 r2 PASS)
-- @see docs/reviews/2026-07-01-m3-252-begin-dedup-fallback-verification.md(GAP2 盲區來由)
-- @see supabase/migrations/20260701120000_m3_250_anomaly_alert_summary.sql(擴充對象、六計數 + ACL 範式)
-- @see docs/phase-1-backlog.md #256
-- ============================================================


-- ── 1. DROP 舊單參 → CREATE 新三參 SECDEF 聚合 RPC(六計數逐字保留 + 加第 7)──
DROP FUNCTION IF EXISTS public.get_payment_anomaly_alert_summary(integer);

CREATE FUNCTION public.get_payment_anomaly_alert_summary(
  p_refunding_stuck_seconds  integer,
  p_pending_dc_window_seconds integer,
  p_pending_dc_stuck_seconds  integer
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    'open_count',
      (SELECT pg_catalog.count(*)
         FROM public.payment_double_charge_anomalies
        WHERE status = 'open'),
    'refunding_count',
      (SELECT pg_catalog.count(*)
         FROM public.payment_double_charge_anomalies
        WHERE status = 'refunding'),
    'refunding_stuck_count',
      (SELECT pg_catalog.count(*)
         FROM public.payment_double_charge_anomalies
        WHERE status = 'refunding'
          AND refund_claimed_at < pg_catalog.now()
              - pg_catalog.make_interval(secs => GREATEST(0, LEAST(COALESCE(p_refunding_stuck_seconds, 86400), 30 * 24 * 3600)))),
    'oldest_open_age_seconds',
      (SELECT (EXTRACT(EPOCH FROM (pg_catalog.now() - pg_catalog.min(created_at))))::bigint
         FROM public.payment_double_charge_anomalies
        WHERE status = 'open'),
    'attempt_manual_review_count',
      (SELECT pg_catalog.count(*)
         FROM public.payment_charge_attempts a
         JOIN public.orders o ON o.id = a.order_id
        WHERE a.needs_manual_review = true
          AND a.status = 'pending'
          AND o.payment_status = 'unpaid'::public.payment_status),
    'released_stuck_count',
      (SELECT pg_catalog.count(*)
         FROM public.payment_charge_attempts a
         JOIN public.orders o ON o.id = a.order_id
        WHERE a.released_manual_review_at IS NOT NULL
          AND a.status = 'released'
          AND o.payment_status = 'unpaid'::public.payment_status),
    -- 🔴 #256 第 7 計數:pending-based 雙扣候選「組」數(同 user + 同 total + 窗內兩 paid + 其一卡住指紋)。
    'pending_double_charge_candidate_count',
      (SELECT pg_catalog.count(*) FROM (
         SELECT o1.customer_user_id, o1.total
           FROM public.orders o1
           JOIN public.orders o2
             ON o1.customer_user_id = o2.customer_user_id
            AND o1.total            = o2.total
            AND o1.id              <  o2.id
            AND o1.payment_status = 'paid'::public.payment_status
            AND o2.payment_status = 'paid'::public.payment_status
            AND o1.paid_at IS NOT NULL AND o2.paid_at IS NOT NULL
            AND pg_catalog.abs(EXTRACT(EPOCH FROM (o1.paid_at - o2.paid_at)))
                < GREATEST(0, LEAST(COALESCE(p_pending_dc_window_seconds, 43200), 30 * 24 * 3600))
          WHERE EXISTS (   -- 卡住指紋:兩單其一 charged attempt 從結帳到扣款拖 > 門檻(正常秒扣不觸發)
                  SELECT 1
                    FROM public.payment_charge_attempts a
                   WHERE a.order_id IN (o1.id, o2.id)
                     AND a.status = 'charged'
                     AND EXTRACT(EPOCH FROM (a.updated_at - a.created_at))
                         > GREATEST(0, LEAST(COALESCE(p_pending_dc_stuck_seconds, 600), 24 * 3600))
                )
          GROUP BY o1.customer_user_id, o1.total
       ) x)
  );
$fn$;

COMMENT ON FUNCTION public.get_payment_anomaly_alert_summary(integer, integer, integer) IS
  'M-3 #250 雙扣 anomaly 主動告警 + #256 pending-based 雙扣偵測:owner-defined SECDEF 受控窗,payment_confirmer cron 唯讀讀聚合計數(零 PII/零金額/零 id)。回 jsonb{open_count,refunding_count,refunding_stuck_count(逾 p_refunding_stuck_seconds 秒、營運參數非 SLA),oldest_open_age_seconds,attempt_manual_review_count(needs_manual_review+pending+unpaid),released_stuck_count(released_manual_review_at+released+unpaid、Phase1 producer-gated 0),pending_double_charge_candidate_count(#256:同 user+同 total+兩 paid 單 paid_at 差<p_pending_dc_window_seconds〔預設 12h〕+ 其一 charged attempt updated_at-created_at>p_pending_dc_stuck_seconds〔預設 10min 卡住指紋〕的候選「組」數;候選待查證非已確認、卡住指紋降誤報非零、可與 open 重疊)}。payment_confirmer 對 anomaly 兩表/attempts/orders 零直讀、只 EXECUTE。不動 anomaly 表 grant 與 lifecycle RPC。';


-- ── 2. ACL(REVOKE 5 角色含 payment_confirmer 再精準 GRANT;對新三參簽名)──
REVOKE ALL ON FUNCTION public.get_payment_anomaly_alert_summary(integer, integer, integer) FROM PUBLIC, anon, authenticated, service_role, payment_confirmer;
GRANT EXECUTE ON FUNCTION public.get_payment_anomaly_alert_summary(integer, integer, integer) TO payment_confirmer;


-- ── 3. fail-closed assert:EXECUTE 矩陣(payment_confirmer=true、anon/authenticated/service_role=false)──
DO $$
BEGIN
  IF NOT has_function_privilege('payment_confirmer', 'public.get_payment_anomaly_alert_summary(integer,integer,integer)', 'EXECUTE')
     OR has_function_privilege('anon',          'public.get_payment_anomaly_alert_summary(integer,integer,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated',  'public.get_payment_anomaly_alert_summary(integer,integer,integer)', 'EXECUTE')
     OR has_function_privilege('service_role',    'public.get_payment_anomaly_alert_summary(integer,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '#256 get_payment_anomaly_alert_summary EXECUTE 權限矩陣異常 — 應僅 payment_confirmer;拒繼續';
  END IF;
END
$$;


-- ── 4. fail-closed assert:role_routine_grants 危險 grantee 殘留 = 0 ──
DO $$
DECLARE
  v_danger integer;
BEGIN
  SELECT pg_catalog.count(*) INTO v_danger
    FROM information_schema.role_routine_grants
   WHERE routine_schema = 'public'
     AND routine_name   = 'get_payment_anomaly_alert_summary'
     AND privilege_type = 'EXECUTE'
     AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role');
  IF v_danger <> 0 THEN
    RAISE EXCEPTION '#256 get_payment_anomaly_alert_summary 危險角色仍有 EXECUTE grant(殘留 %)— 拒繼續', v_danger;
  END IF;
END
$$;


-- ── 5. role-hygiene assert:payment_confirmer **全域**表/欄層零權限(SECDEF 受控窗、不得意外洩 table grant)──
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


-- ── 6. fail-closed assert:effective privilege 縱深(codex K1 F3 折入:加 orders)──
-- 坐實 payment_confirmer 對本 SECDEF 讀的敏感表**零 SELECT 有效權限**(只能經此受控窗聚合、拿不到明細/PII)。
DO $$
BEGIN
  IF has_table_privilege('payment_confirmer', 'public.payment_double_charge_anomalies', 'SELECT')
     OR has_table_privilege('payment_confirmer', 'public.payment_double_charge_anomaly_events', 'SELECT')
     OR has_table_privilege('payment_confirmer', 'public.payment_charge_attempts', 'SELECT')
     OR has_table_privilege('payment_confirmer', 'public.orders', 'SELECT') THEN
    RAISE EXCEPTION 'payment_confirmer 對敏感表有 SELECT 有效權限(effective privilege 破、SECDEF 受控窗被繞)— 拒繼續';
  END IF;
END
$$;


-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):
--   DROP FUNCTION IF EXISTS public.get_payment_anomaly_alert_summary(integer, integer, integer);
--   然後由 20260701120000 重建單參 (integer) 版(#250 六計數版)+ 其 ACL/assert。
-- ============================================================
