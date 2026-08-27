-- ============================================================
-- M-3 #250:雙扣 anomaly 主動告警 — owner-defined SECDEF 聚合 RPC
-- ============================================================
--
-- 目的:把雙扣偵測從 pull(W1 報表有空才查)→ push(發生即主動推播)。週期 cron
--   (app/api/cron/anomaly-alert、Vercel cron)跑在 payment_confirmer 窄權連線、對 anomaly
--   兩表「零表權」→ 必經本 SECDEF 受控窗讀聚合計數,**只回計數 + 最舊時戳、零 PII/零金額/零 id**。
--
-- 🔴 安全層(鐵則 12;對齊 backlog #250「不動 anomaly 表 RPC 安全層」):
--   - 本片**純 ADD** 一支唯讀聚合 RPC、**不動** payment_double_charge_anomalies/_events 既有 table
--     grant(仍只 postgres)與 claim/resolve/genesis lifecycle RPC(仍 owner-only)。
--   - SECURITY DEFINER(owner=postgres)→ 函式內部以 definer 權限讀 anomaly 兩表 + payment_charge_attempts;
--     呼叫者 payment_confirmer **只需 EXECUTE、永不取得 table grant**(role-hygiene assert 坐實)。
--   - SET search_path = '' + schema-qualified(防 search_path 注入;對齊 R1a3/B1a 範式)。
--   - ACL:REVOKE 5 角色(含 payment_confirmer 一起 REVOKE)→ 精準 GRANT payment_confirmer;
--     has_function_privilege 矩陣 + role_routine_grants 危險 grantee 殘留 + role-hygiene 三 assert fail-closed。
--
-- 🔴 計數語意(關卡1 codex H1/H2 + adversarial F3 折入):
--   - open_count / refunding_count:anomaly status='open'(=雙扣**候選**、待查證,非已確認雙扣)/ 'refunding'。
--   - refunding_stuck_count:status='refunding' 且 refund_claimed_at 逾 p_refunding_stuck_seconds(營運參數、
--     route 常數注入、揭示可調、**非 PRD SLA**〔W1 runbook line150 不杜撰 SLA〕;refunding 態一致性 CHECK
--     保證 refund_claimed_at NOT NULL、無 NULL 比較陷阱)。
--   - attempt_manual_review_count:payment_charge_attempts.needs_manual_review=true 且 **status='pending'**
--     且 order unpaid(sweeper 8x 放棄的人工 queue;🔴 限 pending 排除 terminal failed — markFailed 不清
--     needs_manual_review、否則收斂成 failed 後仍永遠假告警)。
--   - released_stuck_count:released_manual_review_at IS NOT NULL 且 status='released' 且 order unpaid(R1c1
--     released 死卡、**獨立欄**〔released 不設 needs_manual_review〕;🔴 Phase 1 producer-gated〔flag off 無
--     released row〕恆 0、前瞻接線、覆蓋 #250 line6347 明列死卡列來源)。
--
-- 參數:p_refunding_stuck_seconds integer — refunding 卡住門檻秒數(NULL→預設 86400=24h;clamp [0, 30d])。
-- 回傳:jsonb 單物件(6 鍵、皆計數或最舊年齡秒數、零 PII)。
--
-- @see docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md §7(W1 雙扣偵測語意)
-- @see docs/runbooks/2026-06-26-m3-3ds-double-charge-refund-runbook.md(line150 不杜撰 SLA、line51 open≠確認雙扣)
-- @see docs/phase-1-backlog.md #250
-- @see supabase/migrations/20260624120003_m3_3ds_r1b1a_double_charge_anomaly_tables.sql(anomaly 兩表 + ACL 範式)
-- @see supabase/migrations/20260627120000_m3_3ds_b1a_claim_expired_pending_attempts.sql(ACL/assert 範式)
-- ============================================================


-- ── 1. SECDEF 聚合 RPC(唯讀、只回計數)──
CREATE OR REPLACE FUNCTION public.get_payment_anomaly_alert_summary(p_refunding_stuck_seconds integer)
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
          AND o.payment_status = 'unpaid'::public.payment_status)
  );
$fn$;

COMMENT ON FUNCTION public.get_payment_anomaly_alert_summary(integer) IS
  'M-3 #250 雙扣 anomaly 主動告警:owner-defined SECDEF 受控窗,payment_confirmer cron 唯讀讀聚合計數(零 PII/零金額/零 id)。回 jsonb{open_count,refunding_count,refunding_stuck_count(逾 p_refunding_stuck_seconds 秒、營運參數非 SLA),oldest_open_age_seconds,attempt_manual_review_count(needs_manual_review+pending+unpaid),released_stuck_count(released_manual_review_at+released+unpaid、Phase1 producer-gated 0)}。不動 anomaly 表 grant 與 lifecycle RPC。只 payment_confirmer 可呼。';


-- ── 2. ACL(REVOKE 5 角色含 payment_confirmer 再精準 GRANT;對齊 B1a 範式 + 關卡1 codex NIT)──
REVOKE ALL ON FUNCTION public.get_payment_anomaly_alert_summary(integer) FROM PUBLIC, anon, authenticated, service_role, payment_confirmer;
GRANT EXECUTE ON FUNCTION public.get_payment_anomaly_alert_summary(integer) TO payment_confirmer;


-- ── 3. fail-closed assert:EXECUTE 矩陣(payment_confirmer=true、anon/authenticated/service_role=false)──
DO $$
BEGIN
  IF NOT has_function_privilege('payment_confirmer', 'public.get_payment_anomaly_alert_summary(integer)', 'EXECUTE')
     OR has_function_privilege('anon',          'public.get_payment_anomaly_alert_summary(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated',  'public.get_payment_anomaly_alert_summary(integer)', 'EXECUTE')
     OR has_function_privilege('service_role',    'public.get_payment_anomaly_alert_summary(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '#250 get_payment_anomaly_alert_summary EXECUTE 權限矩陣異常 — 應僅 payment_confirmer;拒繼續';
  END IF;
END
$$;


-- ── 4. fail-closed assert:role_routine_grants 危險 grantee 殘留 = 0(縱深、關卡1 adversarial F1)──
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
    RAISE EXCEPTION '#250 get_payment_anomaly_alert_summary 危險角色仍有 EXECUTE grant(殘留 %)— 拒繼續', v_danger;
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


-- ── 6. fail-closed assert:effective privilege 縱深(關卡2 codex MED)──
-- role_table_grants 只抓「直接 grant」;has_table_privilege 抓「有效權限」(含 PUBLIC grant / role membership 污染)。
-- 坐實 payment_confirmer 對本 SECDEF 讀的敏感表**零 SELECT 有效權限**(只能經此受控窗聚合、拿不到明細/PII)。
DO $$
BEGIN
  IF has_table_privilege('payment_confirmer', 'public.payment_double_charge_anomalies', 'SELECT')
     OR has_table_privilege('payment_confirmer', 'public.payment_double_charge_anomaly_events', 'SELECT')
     OR has_table_privilege('payment_confirmer', 'public.payment_charge_attempts', 'SELECT') THEN
    RAISE EXCEPTION 'payment_confirmer 對敏感表有 SELECT 有效權限(effective privilege 破、SECDEF 受控窗被繞)— 拒繼續';
  END IF;
END
$$;


-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):
--   DROP FUNCTION IF EXISTS public.get_payment_anomaly_alert_summary(integer);
-- ============================================================
