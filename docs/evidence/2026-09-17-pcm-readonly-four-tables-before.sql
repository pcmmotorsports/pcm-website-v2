\pset pager off
\echo '=== ① 四張目標:存在? 表級 SELECT? (檔頭宣稱:存在 4/4, 表級全 f) ==='
SELECT v.t AS 目標表,
       (pg_catalog.to_regclass(v.t) IS NOT NULL) AS 存在,
       has_table_privilege('pcm_readonly', v.t, 'SELECT') AS 表級select
  FROM (VALUES ('public.home_banners'), ('public.supplier_inbound_emails'),
               ('public.pcm_net_exposure_snapshot'), ('public.shipment_order_ship_clearances')) v(t);

\echo '=== ② 四張目標上的欄級授權筆數 (檔頭宣稱:0 筆) ==='
SELECT count(*) AS 四張上的欄級授權筆數
  FROM pg_attribute at JOIN pg_class c ON c.oid = at.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace,
       LATERAL aclexplode(at.attacl) a
 WHERE n.nspname='public' AND at.attnum>0 AND NOT at.attisdropped
   AND a.grantee='pcm_readonly'::regrole
   AND c.relname IN ('home_banners','supplier_inbound_emails',
                     'pcm_net_exposure_snapshot','shipment_order_ship_clearances');

\echo '=== ③ 角色屬性 + 成員關係 (檔頭宣稱:rolbypassrls=t, pg_auth_members 0 筆) ==='
SELECT rolname, rolbypassrls, rolsuper, rolcanlogin FROM pg_roles WHERE rolname='pcm_readonly';
SELECT count(*) AS pcm_readonly是幾個角色的成員 FROM pg_auth_members WHERE member='pcm_readonly'::regrole;

\echo '=== ④ 正負對照 (檔頭宣稱:orders=t, pcm_incident=f) ==='
SELECT 'public.orders' AS 表, has_table_privilege('pcm_readonly','public.orders','SELECT') AS 表級select
UNION ALL
SELECT 'public.pcm_incident', has_table_privilege('pcm_readonly','public.pcm_incident','SELECT');

\echo '=== ⑤ 分母:public 幾張表 / 表級讀不到幾張 (檔頭宣稱:72 張, 讀不到 11 張) ==='
SELECT count(*) AS public表總數,
       count(*) FILTER (WHERE NOT has_table_privilege('pcm_readonly', c.oid, 'SELECT')) AS 表級讀不到
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r';

\echo '=== ⑥ 那 11 張裡, 哪些其實有欄級授權 (檔頭宣稱:9 真的全不給 + 2 給了一半) ==='
SELECT c.relname AS 表,
       (SELECT count(*) FROM pg_attribute at, LATERAL aclexplode(at.attacl) a
         WHERE at.attrelid=c.oid AND at.attnum>0 AND NOT at.attisdropped
           AND a.grantee='pcm_readonly'::regrole) AS 欄級授權筆數
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r'
   AND NOT has_table_privilege('pcm_readonly', c.oid, 'SELECT')
 ORDER BY 2 DESC, 1;

\echo '=== ⑦ 全庫欄級授權總筆數 (檔頭宣稱:9 筆, 全在不碰的那兩張上) ==='
SELECT n.nspname AS schema, c.relname AS 表, count(*) AS 欄級授權筆數
  FROM pg_attribute at JOIN pg_class c ON c.oid=at.attrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace, LATERAL aclexplode(at.attacl) a
 WHERE at.attnum>0 AND NOT at.attisdropped AND a.grantee='pcm_readonly'::regrole
 GROUP BY 1,2 ORDER BY 1,2;

\echo '=== ⑧ 貼前直接授權總筆數:表級+欄級, 全 schema (檔頭宣稱:86 筆) ==='
SELECT count(*) AS 直接授權總筆數 FROM (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,
         LATERAL aclexplode(coalesce(c.relacl,
           acldefault(CASE c.relkind WHEN 'S' THEN 's'::"char" ELSE 'r'::"char" END, c.relowner))) a
   WHERE a.grantee='pcm_readonly'::regrole
  UNION ALL
  SELECT 1 FROM pg_attribute at JOIN pg_class c ON c.oid=at.attrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace, LATERAL aclexplode(at.attacl) a
   WHERE at.attnum>0 AND NOT at.attisdropped AND a.grantee='pcm_readonly'::regrole
) s;

\echo '=== ⑨ 七張表的 RLS 開關 + policy 數 (檔頭宣稱:RLS 7/7 全開) ==='
SELECT c.relname AS 表, c.relrowsecurity AS rls開著,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid) AS policy數
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public'
   AND c.relname IN ('home_banners','supplier_inbound_emails','pcm_net_exposure_snapshot',
                     'shipment_order_ship_clearances','pcm_settle_retry_attempts',
                     'supplier_sync_runs','pcm_incident')
 ORDER BY 1;

\echo '=== ⑩ 撈這份的身分與時間(證明是 pcm_readonly 這把鑰匙撈的) ==='
SELECT current_user AS 我是誰, now() AS 撈的時間, version() AS pg版本;
