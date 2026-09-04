\pset pager off
\echo '--- Q1 那 7 個物件 RLS 開了沒? 是不是 view? view 是不是 security_invoker? ---'
SELECT c.relname, c.relkind, c.relrowsecurity AS rls_on,
       c.relforcerowsecurity AS rls_forced,
       (SELECT count(*) FROM pg_catalog.pg_policy p WHERE p.polrelid=c.oid) AS policy_n,
       array_to_string(c.reloptions,',') AS reloptions
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public'
   AND c.relname IN ('email_outbox','orders','order_items','customers',
                     'shipments','shipment_items','pcm_shipped_email_pending','sweeper_heartbeat')
 ORDER BY c.relkind, c.relname;

\echo '--- Q2 正對照: public 底下有幾張表開了 RLS? (若這裡也是 0, 上面那些 false 就沒有判別力) ---'
SELECT count(*) FILTER (WHERE relrowsecurity) AS rls_on_tables,
       count(*) AS public_tables
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r';
\pset pager off
\pset format unaligned
\pset fieldsep ' | '
\echo '--- Q3 那 7 張表上每一條 policy: 給誰? 管哪個動作? ---'
-- 🔴 polroles = '{0}' 代表 PUBLIC(適用所有角色, 含 service_role)。
--    pg_roles 裡【沒有 oid 0】 ⇒ 內部 JOIN 會把 PUBLIC 那些靜靜丟掉(2026 已踩過同型)。
--    ⇒ 這裡用 CASE 顯式處理, 不 JOIN。
SELECT c.relname,
       p.polname,
       CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                     WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END AS cmd,
       p.polpermissive AS permissive,
       CASE WHEN p.polroles = '{0}'::oid[] THEN 'PUBLIC(所有角色)'
            ELSE array_to_string(ARRAY(SELECT rolname FROM pg_catalog.pg_roles
                                        WHERE oid = ANY(p.polroles) ORDER BY rolname), '+')
       END AS applies_to,
       left(replace(coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid),
                             pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '(無)'),
                    E'\n',' '), 78) AS using_expr
  FROM pg_catalog.pg_policy p
  JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname='public'
   AND c.relname IN ('email_outbox','orders','order_items','customers',
                     'shipments','shipment_items','sweeper_heartbeat')
 ORDER BY c.relname, p.polname;

\echo '--- Q4 分母對帳: public 底下總共幾條 policy? 其中幾條點名 service_role? ---'
SELECT count(*) AS all_policies,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
                                       WHERE r.oid = ANY(p.polroles) AND r.rolname='service_role')) AS naming_service_role
  FROM pg_catalog.pg_policy p
  JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public';
