\pset pager off
-- 🔴🔴 **[2026-09-05 · 對應的 migration 暫停]** `20260905090000` 被 `-auth` 的 R3 推翻前提
--    (它盤點用的判準比 `supabase/rls-service-role-select-exclusions.txt` 那把寬;
--     且 `20260815020000:129` 那類「零 policy 漂移偵測器」貼了會永遠紅)。
--    ⇒ **本檔留著而【不端進貼板包 §A】** —— 那支 migration 沒貼, 這一發跑起來會全 0,
--      而那個 0 是【它沒貼】不是【它壞了】。
--    ⏰ 那支重新過審之後, 政策名若改過, 本檔要跟著改一行(名字在 §① 那個 IN 清單裡)。
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
--         🛑 **而那支正是本片正對照的材料**(本片 `:124` 要 `email_outbox_select_service_role` 恰好 1 條,
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

\echo '=== 🟢 正對照:同一把尺對一條【本片沒建、而一定在】的政策要數得到 ==='
\echo '    預期:1(它是本片自己的正對照材料;若它是 0, 上面那些數字沒有判別力)'
SELECT count(*) AS email_outbox政策_該1
  FROM pg_catalog.pg_policy WHERE polname = 'email_outbox_select_service_role';

\echo '=== 🔵 負對照二:同一把尺問一個現造的政策名 ⇒ 該 0 ==='
SELECT count(*) AS 現造政策名_該0
  FROM pg_catalog.pg_policy WHERE polname = 'zzq_bogus_policy_20260905';

\echo '=== 🛑 這一發證不到什麼 ==='
\echo '    · 它證【那四條 policy 存在且形狀對】, 不證【拿掉 BYPASSRLS 之後真的讀寫得到】'
\echo '      ⇒ 那要用 NOBYPASSRLS 替身角色實際去讀寫(supabase/after-checks/rls-behaviour-standin.sql 那個做法)'
\echo '    · 政策名若被改過, 這把尺會印 0 —— 而那【不一定是沒貼】, 先去 migration 裡對一次名字'
\echo '    · 它只看這四條;同批別的東西沒進來這把尺不會叫'
