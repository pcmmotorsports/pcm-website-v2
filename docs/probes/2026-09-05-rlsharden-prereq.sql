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

\echo '--- Q5 全消費者分母(23 個物件): 碼要的動詞 vs service_role policy 給的動詞 ---'
-- 🔴 這一段的物件清單來自【掃 origin/dev 的碼】, 不是我挑的
--    ⇒ 產出它的做法寫在 docs/plans/2026-09-05-service-role-consumers-inventory.md §1/§2。
-- 🛑 而清單是【當時那一版碼】的快照 ⇒ 碼改了要重掃, 而不會有東西提醒你。
SELECT c.relname, c.relkind AS kind, c.relrowsecurity AS rls,
       coalesce(string_agg(DISTINCT CASE p.polcmd WHEN 'r' THEN 'S' WHEN 'a' THEN 'I'
                WHEN 'w' THEN 'U' WHEN 'd' THEN 'D' ELSE 'ALL' END, '') FILTER (
         WHERE EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
                        WHERE r.oid = ANY(p.polroles) AND r.rolname='service_role')
            OR p.polroles = '{0}'::oid[]), '(無)') AS sr_policy_cmds
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  LEFT JOIN pg_catalog.pg_policy p ON p.polrelid=c.oid
 WHERE n.nspname='public' AND c.relname IN ('admin_audit_log','admin_order_list_v','admin_sso_login_events','brands','categories','email_outbox','order_item_procurement','order_item_procurement_receipts','order_item_receipt_requests','order_items','order_manual_refunds','order_refund_effective_verdict','order_refunds','orders','payment_charge_attempts','product_fitments_effective_sync_log','product_variants','products','shipment_items','shipments','staff','suppliers','sweeper_heartbeat')
 GROUP BY 1,2,3 ORDER BY 1;

\echo '--- Q5b 對帳: 餵了幾個名字 vs 庫裡回幾列 (不合 = 有名字查無, 那是訊號不是雜訊) ---'
SELECT 23 AS 我餵幾個,
       (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='public' AND c.relname IN ('admin_audit_log','admin_order_list_v','admin_sso_login_events','brands','categories','email_outbox','order_item_procurement','order_item_procurement_receipts','order_item_receipt_requests','order_items','order_manual_refunds','order_refund_effective_verdict','order_refunds','orders','payment_charge_attempts','product_fitments_effective_sync_log','product_variants','products','shipment_items','shipments','staff','suppliers','sweeper_heartbeat')) AS 庫裡回幾個;
