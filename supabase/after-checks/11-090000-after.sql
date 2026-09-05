\pset pager off
\set ON_ERROR_STOP on
-- 🔴 **`ON_ERROR_STOP` 不可省** —— `psql -f` 的 rc 在【有 ERROR】與【全對】兩個世界都是 **0**
--    (2026-09-05 實測:餵一句 `SELECT * FROM 不存在的表` ⇒ rc 仍然 `0`, 只有輸出裡多一行 ERROR)
--    ⇒ 少了它, 中間某格炸掉之後【後面每一格照樣跑照樣印】⇒ 一份看起來完整的報告裡埋著一個 ERROR。
--    來源:codex 2026-09-05 finding 3(原本只修在 `130000-after.sql` 一支)。
-- 🔵 **[2026-09-05 06:5x · 對應 migration 四輪折完, 主視窗裁收]**
--    對象已換成 `agent/line-auth` 的 **`e473cb356`(311 行版)**;
--    🔴 **`dev` 上那份是 256 行的舊版** —— 手貼一定要拿分支版, 拿錯會貼到被 R3 推翻的那一代。
--    ✅ 四條 policy 名對 311 行版逐一重核過(各出現 5 次)。
-- 🔴 唯讀。`20260905090000_m4b_service_role_policies_before_rlsharden.sql` 貼後對帳。
--
-- 🛑🛑 **貼完畫面【零變化】,而那是預期的** ——
--    正式庫上 `service_role` 本來就有 `BYPASSRLS`(2026-09-05 唯讀實測 `rolbypassrls = t`),
--    ⇒ 它今天讀寫得到那三張表**靠的是那個屬性,不是政策**。
--    ⇒ 📌 **本片補的是「拿掉 BYPASSRLS 那一天不會壞」,不是「今天多了什麼」。**
--    ⇒ 🔴 **所以【這四格就是唯一的證據】** —— 沒有任何畫面、任何行為會告訴你它貼成功了。
--
-- 🔴 判準是【那四條 policy 在不在】, **不是「重跑那支 migration」** ——
--    2026-09-05 線 `-db` 在拋棄式 PG 實測:**它不冪等**,重貼回
--    `ERROR: policy "admin_audit_log_insert_service_role" for table "admin_audit_log" already exists`。
--    ⇒ 拿「重跑會不會過」當判準,會把【已經貼成功】讀成【壞了】。
--
-- 🔬 **拋棄式 PG 實跑過(2026-09-05,PG 17.10)**:貼前這四條 = **0** ⇒ 貼後 = **4**。
--    而要跑到那一步,有三個前置條件,少一個就到不了:
--      ① **先 `ALTER ROLE service_role BYPASSRLS`** ——
--         否則 `20260826150000`(email_outbox 政策)自己的段 A 會擋:「本片證不出 apply 當下不擴權」。
--         ⛔ ~~而那支正是本片正對照的材料(要 `email_outbox_select_service_role` 恰好 1 條)~~ —— **311 行版已改掉那個正對照**(R1 判它不與被驗對象共用程式路徑),
--            而 `email_outbox_select_service_role` 在 311 行版裡**逐字不存在**(我實測 0 次) ⇒ 🔵 **①這個前置條件現在只為了讓 `20260826150000` 本身貼得過, 不再是正對照的材料。**
--         逐字「否則上面那些 0 沒有判別力」)⇒ **少了①,本片的正對照當場失敗。**
--      ② **最小 `cron.job` fixture** —— 否則 `20260828060000` 連鎖擋掉三支
--         (見 `docs/runbooks/throwaway-postgres-for-migration-verification.md` 那張「起來之後還有三個坑」)。
--      ③ **`PGCLIENTENCODING=UTF8`** —— 否則含中文註解的 migration 整批炸。
--
-- ⚠️ `polcmd` 的型別是 `"char"` 不是 `text` ⇒ 串接一定要 `::text`,
--    否則 `ERROR: operator is not unique: text || "char"`。(這一格我 2026-09-05 踩過。)

\echo '=== ① 🔴 判準:本片要建的那四條 policy 在不在 ==='
\echo '    預期:貼【前】0 · 貼【後】4'
SELECT count(*) AS 四條到位幾條
  FROM pg_catalog.pg_policy
 WHERE polname IN ('admin_audit_log_insert_service_role',
                   'admin_sso_login_events_insert_service_role',
                   'staff_insert_service_role',
                   'staff_update_service_role');

\echo '=== ② 形狀:cmd 對不對、roles 恰好是 service_role、都是 PERMISSIVE ==='
\echo '    預期:貼後 4 列;insert 三條(a/w)· update 一條(w);角色全是 service_role;permissive 全 t'
SELECT p.polname,
       p.polcmd::text AS cmd,
       COALESCE((SELECT string_agg(r.rolname, ',' ORDER BY r.rolname)
                   FROM pg_catalog.pg_roles r WHERE r.oid = ANY(p.polroles)), 'PUBLIC') AS roles,
       p.polpermissive AS permissive
  FROM pg_catalog.pg_policy p
 WHERE p.polname IN ('admin_audit_log_insert_service_role',
                     'admin_sso_login_events_insert_service_role',
                     'staff_insert_service_role',
                     'staff_update_service_role')
 ORDER BY 1;

\echo '=== ③ 🔵 負對照:這四條【不准】開給 PUBLIC / anon / authenticated ==='
\echo '    預期:0'
SELECT count(*) AS 外溢數_該0
  FROM pg_catalog.pg_policy p
 WHERE p.polname IN ('admin_audit_log_insert_service_role',
                     'admin_sso_login_events_insert_service_role',
                     'staff_insert_service_role',
                     'staff_update_service_role')
   AND (p.polroles = '{0}'::oid[]
        OR p.polroles && ARRAY[(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='anon'),
                               (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='authenticated')]);

\echo '=== 🟢 正對照:同一個查詢形狀, 只把角色換成【一定會中的】 ==='
\echo '    預期:貼【後】4。而貼【前】它也是 0 —— 見下面那句。'
-- 🔴🔴 **這一格【貼前沒有判別力】, 而那不是缺陷是它的形狀**:
--    它與被驗對象查的是【同四條 policy】, 只差角色條件 ⇒ 那四條還沒建時, 兩邊都是 0。
--    ⇒ 📌 **貼前它證不到「尺會動」** —— 貼前要證尺會動, 要問一個【一定非 0】的東西:
--       全庫帶 service_role 的 policy 共幾條(2026-09-05 實測 **66**)。那一格在下面。
--    ⇒ 🛑 若貼【後】它仍是 0, 那才是「尺不會動」而不是「真的沒建」。
-- 🔴 舊版這一格驗的是【另一條 policy 的名字存在】(`email_outbox_select_service_role`)——
--    R1 判它「不與被驗對象共用程式路徑 ⇒ 證明不了那把尺會動」, 311 行版已改掉,
--    而**那條 policy 在 311 行版裡逐字不存在**(我實測 0 次)⇒ 本檔跟著改, 否則這一格恆 0。
SELECT count(*) AS 正對照_該4
  FROM pg_catalog.pg_policy p
  JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND (c.relname, p.polname) IN (
         ('admin_audit_log','admin_audit_log_insert_service_role'),
         ('admin_sso_login_events','admin_sso_login_events_insert_service_role'),
         ('staff','staff_insert_service_role'),
         ('staff','staff_update_service_role'))
   AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
                WHERE r.oid = ANY (p.polroles) AND r.rolname = 'service_role');

\echo '=== 🟢 正對照二(貼前就有判別力):全庫帶 service_role 的 policy 共幾條 ==='
\echo '    預期:非 0(2026-09-05 貼前實測 66)。它是 0 ⇒ 上面每一格都沒有意義。'
SELECT count(*) AS 全庫service_role政策數_該非0
  FROM pg_catalog.pg_policy p
 WHERE EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
                WHERE r.oid = ANY (p.polroles) AND r.rolname = 'service_role');

\echo '=== 🔵 負對照二:同一把尺問一個現造的政策名 ⇒ 該 0 ==='
SELECT count(*) AS 現造政策名_該0
  FROM pg_catalog.pg_policy WHERE polname = 'zzq_bogus_policy_20260905';

\echo '=== 🛑 這一發證不到什麼 ==='
\echo '    · 它證【那四條 policy 存在且形狀對】, 不證【拿掉 BYPASSRLS 之後真的讀寫得到】'
\echo '      ⇒ 那要用 NOBYPASSRLS 替身角色實際去讀寫(supabase/after-checks/rls-behaviour-standin.sql 那個做法)'
\echo '    · 政策名若被改過, 這把尺會印 0 —— 而那【不一定是沒貼】, 先去 migration 裡對一次名字'
\echo '    · 它只看這四條;同批別的東西沒進來這把尺不會叫'
