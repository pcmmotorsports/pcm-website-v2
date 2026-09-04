-- ci-self-contained: no — 同上, 要正式庫唯讀連線 ⇒ CI 跑不了。
-- ⟦b9-SRVMIN⟧ 唯讀查詢 —— 三道持有的【實際範圍】
-- 🟢 唯讀:全檔只有 SELECT,零 DDL、零 DML。
-- 🔴 每一區都帶【正對照】—— 沒有它, 一個 0 分不出「真的沒有」與「我查錯地方」。
\pset pager off
\echo '════ ① payment 那 35 支函式:是不是 SECURITY DEFINER ════'
-- 🎯 這一格是本次的樞紐:DEFINER ⇒ 呼叫端【只要 EXECUTE】就夠, 底層表權限不必給。
--    INVOKER ⇒ 呼叫端還要有底層表的權限 ⇒ 「換成更窄的角色」會複雜得多。
SELECT p.proname,
       p.prosecdef AS is_security_definer,
       pg_catalog.pg_get_userbyid(p.proowner) AS owner
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN (
    'begin_charge_attempt',
    'claim_due_webhook_events',
    'claim_expired_pending_attempts',
    'claim_order_poll_settle',
    'claim_stuck_unsettled_attempts',
    'confirm_order_payment',
    'expire_stuck_attempts_at_ceiling',
    'expire_webhook_events_at_ceiling',
    'flag_non_unpaid_active_attempts',
    'get_active_charge_attempt',
    'get_cron_heartbeat_stale_counts',
    'get_email_outbox_deadman_counts',
    'get_manual_customer_search_summary',
    'get_order_created_gap_counts',
    'get_order_created_stuck_count',
    'get_order_refunds_stuck_summary',
    'get_order_unpaid_cancelled_gap_counts',
    'get_payment_anomaly_alert_display_ids',
    'get_payment_anomaly_alert_summary',
    'get_privileged_role_bypassrls_state',
    'get_search_log_health',
    'get_shipped_email_gap_counts',
    'list_charge_attempts_for_capture_recheck',
    'mark_attempt_settle_retry',
    'mark_charge_attempt_charged',
    'mark_charge_attempt_failed',
    'mark_charge_attempt_released_for_user',
    'mark_webhook_processed',
    'mark_webhook_retry',
    'record_charge_bank_txn',
    'record_charge_capture_state',
    'record_charge_pending_rec',
    'record_pending_invoice',
    'record_released_failure_observation',
    'record_webhook_event'
   )
 ORDER BY p.prosecdef, p.proname;

\echo '════ ①b 正對照:上面那張表【不得是空的】, 也不得剛好等於全部 ════'
-- 🔵 印「碼裡列了幾支」與「庫裡找到幾支」—— 兩個數不一樣才有資訊;
--    只印一個的話,「函式改名了」與「查對了」印同一個畫面。
SELECT 35 AS 碼裡列了幾支,
       (SELECT count(DISTINCT p.proname) FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname='public' AND p.proname IN ('begin_charge_attempt',
    'claim_due_webhook_events',
    'claim_expired_pending_attempts',
    'claim_order_poll_settle',
    'claim_stuck_unsettled_attempts',
    'confirm_order_payment',
    'expire_stuck_attempts_at_ceiling',
    'expire_webhook_events_at_ceiling',
    'flag_non_unpaid_active_attempts',
    'get_active_charge_attempt',
    'get_cron_heartbeat_stale_counts',
    'get_email_outbox_deadman_counts',
    'get_manual_customer_search_summary',
    'get_order_created_gap_counts',
    'get_order_created_stuck_count',
    'get_order_refunds_stuck_summary',
    'get_order_unpaid_cancelled_gap_counts',
    'get_payment_anomaly_alert_display_ids',
    'get_payment_anomaly_alert_summary',
    'get_privileged_role_bypassrls_state',
    'get_search_log_health',
    'get_shipped_email_gap_counts',
    'list_charge_attempts_for_capture_recheck',
    'mark_attempt_settle_retry',
    'mark_charge_attempt_charged',
    'mark_charge_attempt_failed',
    'mark_charge_attempt_released_for_user',
    'mark_webhook_processed',
    'mark_webhook_retry',
    'record_charge_bank_txn',
    'record_charge_capture_state',
    'record_charge_pending_rec',
    'record_pending_invoice',
    'record_released_failure_observation',
    'record_webhook_event')) AS 庫裡對得上幾支,
       (SELECT count(*) FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public') AS public_底下總共幾支;

\echo '════ ② email 那幾個物件:service_role 實際被授了哪些動詞 ════'
-- 🔴 用 has_table_privilege 逐個動詞問, 不讀 relacl ——
--    ACL 欄是 NULL 時 PUBLIC 看不見, 而那正是最容易誤讀成「沒授權」的形狀。
SELECT t.relname,
       has_table_privilege('service_role','public.'||t.relname,'SELECT') AS sel,
       has_table_privilege('service_role','public.'||t.relname,'INSERT') AS ins,
       has_table_privilege('service_role','public.'||t.relname,'UPDATE') AS upd,
       has_table_privilege('service_role','public.'||t.relname,'DELETE') AS del,
       has_table_privilege('service_role','public.'||t.relname,'TRUNCATE') AS trunc
  FROM pg_catalog.pg_class t
  JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
 WHERE n.nspname='public'
   AND t.relname IN ('email_outbox','orders','order_items','customers','shipments','shipment_items')
 ORDER BY t.relname;

\echo '════ ②b 負對照:一個【碼裡沒用到】的表, 看它是不是也全 true ════'
-- 🎯 若隨便挑一張表也全 true ⇒ service_role 是【全庫皆可】
--    ⇒ 那上面那張表就不是「授權清單」, 而是「這個角色本來就什麼都能做」。
--    ⇒ 📌 少了這一格, 上面那些 true 會被讀成「剛好授了它需要的」。
SELECT t.relname,
       has_table_privilege('service_role','public.'||t.relname,'SELECT') AS sel,
       has_table_privilege('service_role','public.'||t.relname,'DELETE') AS del
  FROM pg_catalog.pg_class t
  JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
 WHERE n.nspname='public' AND t.relkind='r'
   AND t.relname NOT IN ('email_outbox','orders','order_items','customers','shipments','shipment_items')
 ORDER BY t.relname
 LIMIT 5;

\echo '════ ③ service_role 自己是什麼身分(BYPASSRLS / SUPERUSER)════'
-- 🔵 這一格決定「收窄授權」有沒有意義:若它 BYPASSRLS,
--    收表級 GRANT 不會收掉它繞過 RLS 的能力 ⇒ 那是 ⟦b9-RLSHARDEN⟧ 的事, 不是本列。
SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
  FROM pg_catalog.pg_roles
 WHERE rolname IN ('service_role','anon','authenticated','postgres')
 ORDER BY rolname;

\echo '════ ④ 我這條連線【自己】是誰 —— 不印連線字串, 只印角色名 ════'
-- 🛑 「我以為我在用唯讀角色」與「我真的在用唯讀角色」是兩件事(2026-09-04 踩過)。
SELECT current_user, session_user, current_setting('is_superuser') AS is_superuser;

\echo '════ ⑤ payment 那道用的是【專用角色】還是 service_role? ════'
-- 🔴 2026-09-05 補:我一開始準備下結論「payment 可以收窄成只給 EXECUTE」,
--    而 memory 逐字寫著 `payment_confirmer 只能呼叫函式`
--    ⇒ 📌 **它可能【已經】是收窄過的** —— 那會讓上面那個建議變成一件早就做完的事。
--    ⇒ 🛑 所以這一格問的是【現況】, 不是【該不該】。
SELECT rolname, rolsuper, rolbypassrls, rolcanlogin, rolcreaterole
  FROM pg_catalog.pg_roles WHERE rolname LIKE '%payment%' OR rolname LIKE '%confirmer%'
 ORDER BY rolname;

\echo '════ ⑤b 那個角色在 email 那 6 張表上有沒有表級權限(應該【沒有】才算窄)════'
SELECT t.relname,
       has_table_privilege('payment_confirmer','public.'||t.relname,'SELECT') AS sel,
       has_table_privilege('payment_confirmer','public.'||t.relname,'INSERT') AS ins,
       has_table_privilege('payment_confirmer','public.'||t.relname,'DELETE') AS del
  FROM pg_catalog.pg_class t JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
 WHERE n.nspname='public'
   AND t.relname IN ('email_outbox','orders','customers','charge_attempts','brands')
 ORDER BY t.relname;

\echo '════ ⑤c 正對照:它對那 35 支函式【有】EXECUTE 嗎(該是 t, 否則付款會死)════'
SELECT count(*) FILTER (WHERE has_function_privilege('payment_confirmer', p.oid, 'EXECUTE')) AS 有execute,
       count(*) AS 查了幾支
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public'
   AND p.proname IN ('begin_charge_attempt','confirm_order_payment','mark_charge_attempt_charged',
                     'record_webhook_event','claim_due_webhook_events');
