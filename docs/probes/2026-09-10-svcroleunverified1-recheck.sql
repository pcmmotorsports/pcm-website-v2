\set ON_ERROR_STOP on
\pset pager off
\echo '=== 0. WHO AM I (身分是量到的不是宣稱的) ==='
SELECT current_user AS cur, current_setting('transaction_read_only') AS txn_ro;

\echo '=== A. relacl 逐字 + RLS (板上 09-08: rxtm / relacl_is_null=f / rls=t / forced=f) ==='
SELECT c.relname,
       c.relacl::text AS relacl,
       (c.relacl IS NULL) AS relacl_is_null,
       c.relrowsecurity AS rls_on,
       c.relforcerowsecurity AS forced
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('orders','order_items')
ORDER BY 1;

\echo '=== B. has_table_privilege 八格 service_role (板上 09-08: srv_sel=t ins=f upd=f) ==='
SELECT t.tbl,
  has_table_privilege('service_role','public.'||t.tbl,'SELECT')     AS s,
  has_table_privilege('service_role','public.'||t.tbl,'INSERT')     AS i,
  has_table_privilege('service_role','public.'||t.tbl,'UPDATE')     AS u,
  has_table_privilege('service_role','public.'||t.tbl,'DELETE')     AS d,
  has_table_privilege('service_role','public.'||t.tbl,'TRUNCATE')   AS tr,
  has_table_privilege('service_role','public.'||t.tbl,'REFERENCES') AS rf,
  has_table_privilege('service_role','public.'||t.tbl,'TRIGGER')    AS tg,
  has_table_privilege('service_role','public.'||t.tbl,'MAINTAIN')   AS mt
FROM (VALUES ('orders'),('order_items')) AS t(tbl) ORDER BY 1;

\echo '=== B2. 負對照 anon / authenticated 對同兩張表的 SELECT (板上: anon=f, authenticated=t) ==='
SELECT t.tbl,
  has_table_privilege('anon','public.'||t.tbl,'SELECT')          AS anon_sel,
  has_table_privilege('authenticated','public.'||t.tbl,'SELECT') AS auth_sel
FROM (VALUES ('orders'),('order_items')) AS t(tbl) ORDER BY 1;

\echo '=== C. 正對照 全庫 public 一般表 service_role 可讀 t/f 分佈 (板上 09-08: t=53 f=11 共64) ==='
SELECT has_table_privilege('service_role', c.oid, 'SELECT') AS srv_can_read, count(*)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r'
GROUP BY 1 ORDER BY 1;

\echo '=== C2. 分母對照:那 64 是不是我今天量的另一個 64 (有SELECT權 且 RLS開) ==='
SELECT count(*) FILTER (WHERE true)                                            AS public_regular_tables,
       count(*) FILTER (WHERE c.relrowsecurity)                                AS of_which_rls_on,
       count(*) FILTER (WHERE has_table_privilege('service_role',c.oid,'SELECT')) AS srv_can_read,
       count(*) FILTER (WHERE has_table_privilege('service_role',c.oid,'SELECT') AND c.relrowsecurity) AS srv_read_and_rls
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r';

\echo '=== D. 欄級 ACL:那兩張表 (板上 09-08: 42欄/13欄, 有欄級ACL = 0/0) ==='
SELECT c.relname,
       count(*)                                  AS cols_total,
       count(*) FILTER (WHERE a.attacl IS NOT NULL) AS cols_with_column_acl
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
WHERE n.nspname='public' AND c.relname IN ('orders','order_items')
GROUP BY 1 ORDER BY 1;

\echo '=== E. 正對照 這座庫真的在用欄級授權 (證明那個 0 不是尺看不到) ==='
SELECT c.relname, a.attname, a.attacl::text
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
WHERE a.attacl IS NOT NULL AND n.nspname='public'
ORDER BY 1,2;

\echo '=== F. rolbypassrls (板上: service_role=t, anon/authenticated=f) ==='
SELECT rolname, rolbypassrls, rolsuper, rolcanlogin
FROM pg_roles WHERE rolname IN ('service_role','anon','authenticated','pcm_readonly') ORDER BY 1;

\echo '=== G. 負對照 現造表名 (應 0 列, 不是噴錯) ==='
SELECT count(*) AS zzq_rows FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname='zzq_nope_tbl_20260910';
\set ON_ERROR_STOP on
\pset pager off
\echo '=== H. 我能不能變成 service_role 去真的讀一列 ==='
SELECT pg_has_role('pcm_readonly','service_role','MEMBER') AS pcm_readonly_is_member_of_service_role,
       pg_has_role('pcm_readonly','service_role','USAGE')  AS can_set_role,
       (SELECT rolcanlogin FROM pg_roles WHERE rolname='service_role') AS service_role_can_login;

\echo '=== H2. 正對照 同一把尺對一個我一定是成員的角色 ==='
SELECT pg_has_role('pcm_readonly','pcm_readonly','MEMBER') AS self_member;

\echo '=== H3. service_role 的成員有誰 ==='
SELECT r.rolname AS member_of_service_role
FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
WHERE m.roleid=(SELECT oid FROM pg_roles WHERE rolname='service_role') ORDER BY 1;

\echo '=== I. 那兩張表今天有幾條 policy (RLS 開著而 service_role 繞過) ==='
SELECT tablename, count(*) AS policies
FROM pg_policies WHERE schemaname='public' AND tablename IN ('orders','order_items')
GROUP BY 1 ORDER BY 1;

\echo '=== I2. 負對照 現造表名的 policy 數 (應 0 列) ==='
SELECT count(*) AS zzq FROM pg_policies WHERE schemaname='public' AND tablename='zzq_nope_tbl_20260910';
\set ON_ERROR_STOP on
\pset pager off
\echo '=== J. 那個 10 到底是量的還是減的 —— 全庫 service_role 有SELECT且RLS開, 逐 schema ==='
SELECT n.nspname, count(*) AS tables
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relkind='r' AND c.relrowsecurity
  AND has_table_privilege('service_role', c.oid, 'SELECT')
GROUP BY 1 ORDER BY 2 DESC, 1;

\echo '=== J2. 同一發的總計 (應與早上那個 64 對得上) ==='
SELECT count(*) AS whole_db_srv_select_and_rls,
       count(*) FILTER (WHERE n.nspname='public')  AS in_public,
       count(*) FILTER (WHERE n.nspname<>'public') AS outside_public
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relkind='r' AND c.relrowsecurity
  AND has_table_privilege('service_role', c.oid, 'SELECT');

\echo '=== K. codex 指的漏洞:有沒有 SECURITY DEFINER 函式的 owner 是 service_role ==='
SELECT count(*) AS secdef_owned_by_service_role
FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
WHERE p.prosecdef AND r.rolname='service_role';

\echo '=== K2. 全庫 SECURITY DEFINER 函式的 owner 分佈 (正對照: 尺看得到 secdef) ==='
SELECT r.rolname AS owner, count(*) AS secdef_funcs
FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
WHERE p.prosecdef GROUP BY 1 ORDER BY 2 DESC;

\echo '=== K3. 我能不能 EXECUTE 那些 secdef 函式 (pcm_readonly 視角), 只數不跑 ==='
SELECT r.rolname AS owner, count(*) FILTER (WHERE has_function_privilege('pcm_readonly', p.oid, 'EXECUTE')) AS i_can_execute,
       count(*) AS total
FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
WHERE p.prosecdef GROUP BY 1 ORDER BY 3 DESC;

\echo '=== L. 我有沒有 pg_read_all_data 之類的預設角色 ==='
SELECT r.rolname AS i_am_member_of
FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid
WHERE m.member=(SELECT oid FROM pg_roles WHERE rolname='pcm_readonly') ORDER BY 1;

\echo '=== L2. session_user vs current_user (SET ROLE 的另一半) ==='
SELECT session_user, current_user;

\echo '=== M. 負對照 現造角色名 (應 0 列) ==='
SELECT count(*) AS zzq FROM pg_roles WHERE rolname='zzq_nope_role_20260910';
\set ON_ERROR_STOP on
\pset pager off
\echo '=== N. 64 vs 63 差在哪 —— 同一條件, 只換 relkind 集合 ==='
SELECT
  count(*) FILTER (WHERE c.relkind='r')            AS relkind_r_only,
  count(*) FILTER (WHERE c.relkind IN ('r','p'))   AS relkind_r_and_p,
  count(*)                                          AS all_relkinds
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relrowsecurity AND has_table_privilege('service_role', c.oid, 'SELECT');

\echo '=== N2. 那一張多出來的是誰 ==='
SELECT n.nspname, c.relname, c.relkind
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relrowsecurity AND has_table_privilege('service_role', c.oid, 'SELECT')
  AND c.relkind <> 'r' ORDER BY 1,2;

\echo '=== N3. 全庫 RLS 開著的表 93 那個數, 也拆一次 relkind ==='
SELECT
  count(*) FILTER (WHERE c.relkind='r')          AS r_only,
  count(*) FILTER (WHERE c.relkind IN ('r','p')) AS r_and_p,
  count(*)                                        AS all_kinds
FROM pg_class c WHERE c.relrowsecurity;

\echo '=== N4. public 一般表 66 那個數, 也拆一次 ==='
SELECT
  count(*) FILTER (WHERE c.relkind='r')          AS r_only,
  count(*) FILTER (WHERE c.relkind IN ('r','p')) AS r_and_p
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m');

\echo '=== N5. 負對照 現造 relkind (應 0) ==='
SELECT count(*) AS zzq FROM pg_class WHERE relkind='Z';
\set ON_ERROR_STOP on
\pset pager off
\echo '=== P. codex 訂正: 判 SET ROLE 該查 SET 不是 USAGE ==='
SELECT pg_has_role('pcm_readonly','service_role','SET')    AS can_set_role_correct_ruler,
       pg_has_role('pcm_readonly','service_role','USAGE')  AS usage_ruler,
       pg_has_role('pcm_readonly','service_role','MEMBER') AS member_ruler,
       pg_has_role('pcm_readonly','pcm_readonly','SET')    AS positive_control_self_set;

\echo '=== Q. schema USAGE (codex must-fix 2: 表權綠了還可能卡在 schema) ==='
SELECT has_schema_privilege('service_role','public','USAGE') AS srv_public_usage,
       has_schema_privilege('anon','public','USAGE')         AS anon_public_usage,
       has_schema_privilege('service_role','pg_catalog','USAGE') AS positive_control;

\echo '=== R. SECURITY DEFINER 逐 owner (K 的複量, 給檔用) ==='
SELECT r.rolname AS owner, count(*) AS secdef
FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.prosecdef GROUP BY 1 ORDER BY 2 DESC;

\echo '=== S. 非 public 那 9/10 張逐張列名 (nit 1: 要獨立量不要減) ==='
SELECT n.nspname, c.relname, c.relkind
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relkind IN ('r','p') AND c.relrowsecurity
  AND has_table_privilege('service_role', c.oid, 'SELECT')
  AND n.nspname <> 'public' ORDER BY 1,2;
