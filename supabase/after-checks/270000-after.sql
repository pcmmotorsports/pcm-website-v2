-- 🔴 `psql -f` 對 ERROR 的 rc 仍是 0 ⇒ 沒有這一行的話, 一支【中間全紅】的檢查
--    與一支【全過】的檢查回同一個 rc, 而早上看 rc 的人分不出來。
\set ON_ERROR_STOP on
\pset pager off
-- 🔴 唯讀。20260904270000(40 張 service_role SELECT policy + 8 張 GRANT)貼後對帳。
--    判準與那支 migration 的事後斷言⑤⑥ 同一個, 不另寫一份。

\echo '=== ① 那 40 張:policy 內容對不對(PERMISSIVE · SELECT · TO service_role · USING true)==='
\echo '    預期:全到位 = 40 · 缺的 = 0'
WITH e AS (SELECT relname FROM public.pcm_rls_rollback_20260904270000)
SELECT count(*) AS 期望張數,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM pg_catalog.pg_policy p
          WHERE p.polrelid = ('public.'||e.relname)::regclass
            AND p.polname  = e.relname||'_select_service_role'
            AND p.polcmd IN ('r','*') AND p.polpermissive
            AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) IN ('true','(true)')
            AND 'service_role' = ANY(SELECT ro.rolname FROM pg_catalog.pg_roles ro WHERE ro.oid = ANY(p.polroles))
       )) AS policy到位,
       count(*) FILTER (WHERE pg_catalog.has_table_privilege('service_role', ('public.'||e.relname)::regclass, 'SELECT')) AS GRANT到位
  FROM e;

\echo '=== ② 前態快照表:那 8 張本來沒有 GRANT 的名單留下來了嗎(回滾唯一的依據)==='
\echo '    預期:全表 40 列 · had_grant_before = false 的 8 列'
SELECT count(*) AS 全表列數,
       count(*) FILTER (WHERE NOT had_grant_before) AS 本來沒GRANT的,
       count(*) FILTER (WHERE NOT had_policy_before) AS 本來沒policy的
  FROM public.pcm_rls_rollback_20260904270000;

\echo '=== ③ 🔵 負對照:排除的那 8 張【不准】被補到 ==='
\echo '    預期:0'
SELECT count(*) AS 排除表被建了policy的數
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_policy p ON p.polrelid=c.oid
 WHERE n.nspname='public'
   AND c.relname IN ('admin_sso_login_events','order_legal_consents',
     'payment_double_charge_anomaly_events','payment_refund_events','payment_webhook_events',
     'pcm_b2_shipping_idempotency','dbk_external_id_rename_20260904','pcm_rls_rollback_20260904270000')
   AND p.polcmd IN ('r','*') AND p.polpermissive
   AND pg_catalog.pg_get_expr(p.polqual,p.polrelid) IN ('true','(true)')
   AND 'service_role' = ANY(SELECT ro.rolname FROM pg_catalog.pg_roles ro WHERE ro.oid=ANY(p.polroles));

\echo '=== ④ 🔵 負對照:anon / authenticated 不准因為這支多拿到東西 ==='
\echo '    預期:0(本支建的 policy 一條都不該把它們放進來)'
SELECT count(*) AS 外溢的policy數
  FROM public.pcm_rls_rollback_20260904270000 e
  JOIN pg_catalog.pg_policy p ON p.polrelid = ('public.'||e.relname)::regclass
 WHERE p.polname = e.relname||'_select_service_role'
   AND (p.polroles='{0}'::oid[]
        OR 'anon' = ANY(SELECT ro.rolname FROM pg_catalog.pg_roles ro WHERE ro.oid=ANY(p.polroles))
        OR 'authenticated' = ANY(SELECT ro.rolname FROM pg_catalog.pg_roles ro WHERE ro.oid=ANY(p.polroles)));

\echo '=== 🟢 正對照:這把尺對【一定在】的東西印得出來(否則上面的 0 沒有意義)==='
\echo '    預期:非 0'
SELECT count(*) AS public底下policy總數 FROM pg_catalog.pg_policy p
  JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public';

\echo '=== 🔵 負對照:編造一個表名 ⇒ 該回 0(證明尺不是對什麼都印非 0)==='
SELECT count(*) AS 現造名的policy數 FROM pg_catalog.pg_policy p
  JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
 WHERE c.relname = 'zzq_bogus_table_20260905';
