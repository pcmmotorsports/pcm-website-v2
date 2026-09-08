-- ============================================================
-- pcm-audit-ro-snapshot.sql —— `pcm_audit_ro` 一次問完的唯讀快照
-- ============================================================
-- 線 account 2026-09-08 建。跑法:
--     bash scripts/readonly-prod-sql.sh scripts/pcm-audit-ro-snapshot.sql
--
-- 🟢 唯讀 —— 本檔【不建、不改、不刪任何東西】。全部是 SELECT。
-- 🔴 為什麼要有它:P2-3 兩案(刪掉 / 補版控)的第一步是【同一步】——
--    先量它現在有什麼。而施工窗沒有正式庫存取, 需要這個答案的人就是施工窗。
--    ⇒ 本檔把 `-db` 2026-09-08 已跑過的那批, 加上【它沒跑到的兩格】, 收成一發。
--
-- 🛑 **每一段都帶正/負對照, 而那不是禮貌** ——
--    這一族的問題(角色權限)最常見的答案是 `0`, 而
--    📌 **「真的沒有」與「我這把尺看不到」印同一個 0。**
--    ⇒ 正對照答「尺會不會動」;負對照答「它會不會對什麼都回非零」。**兩個都要。**
--
-- 🔴 判讀紀律:每一段下面都寫了【兩個世界各自會印什麼】。
--    印出來的東西如果不在那兩個世界裡 ⇒ **那是第三個世界, 停下來, 不要硬塞。**
-- ============================================================

\echo '===== ① 角色屬性 ====='
-- 兩個世界:角色不存在 ⇒ 0 列  ·  存在 ⇒ 1 列(而 rolcanlogin 決定 plan 走哪條路)
-- 🟢 正對照 = 同一發要撈得到 postgres 與 pcm_readonly(它們一定在)
-- ⚪ 負對照 = zzq_no_such_role_20260908 這一列【不該出現】
SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolinherit,
       rolvaliduntil, rolconnlimit
  FROM pg_catalog.pg_roles
 WHERE rolname IN ('pcm_audit_ro','pcm_readonly','postgres',
                   'zzq_no_such_role_20260908')
 ORDER BY rolname;

\echo '===== ② 成員關係(兩個方向都問) ====='
-- 🔴 方向要分開:`A 是 B 的成員` 與 `B 是 A 的成員` 是兩件事, 而它們常被寫成一句話。
-- 兩個世界:沒有任何成員關係 ⇒ 0 列  ·  有 ⇒ 每一條一列, 而 direction 欄說是哪一向
SELECT 'pcm_audit_ro 屬於 →' AS direction, r.rolname AS 對象
  FROM pg_auth_members am
  JOIN pg_roles r ON r.oid = am.roleid
  JOIN pg_roles m ON m.oid = am.member
 WHERE m.rolname = 'pcm_audit_ro'
UNION ALL
SELECT '← 誰屬於 pcm_audit_ro', m.rolname
  FROM pg_auth_members am
  JOIN pg_roles r ON r.oid = am.roleid
  JOIN pg_roles m ON m.oid = am.member
 WHERE r.rolname = 'pcm_audit_ro';

\echo '===== ③ schema USAGE(逐個問, 不用列舉猜) ====='
-- 🔴 用 `has_schema_privilege` 而不是掃 ACL 欄:ACL 欄是 NULL 時 PUBLIC 的預設權限【看不見】。
-- 🟢 正對照 = public 那一列對 pcm_readonly 應該是 t
-- ⚪ 負對照 = zzq_no_such_schema 不在 pg_namespace ⇒ 它【不會出現】而不是印 f
SELECT n.nspname AS schema,
       has_schema_privilege('pcm_audit_ro', n.nspname, 'USAGE') AS audit_ro,
       has_schema_privilege('pcm_readonly',  n.nspname, 'USAGE') AS readonly
  FROM pg_namespace n
 WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
 ORDER BY 1;

\echo '===== ③-b 🔴 那個 t 是【誰給的】—— has_*_privilege 答不出這題 ====='
-- 🔴🔴 **本段是 2026-09-08 被 `-tidy` 當場推翻我一格之後補的, 而那一格【只錯在受詞】:**
--    我看到 `has_schema_privilege('pcm_audit_ro','net','USAGE') = t`,
--    就寫成「net 是刻意給這個帳號的」⇒ 而真相是 `net` 的 nspacl 裡有一條
--    `=U/supabase_admin`(grantee 欄**空的** = **PUBLIC**)⇒ 每個角色都是 t。
--    `pcm_audit_ro` 在那一串裡**一個字都沒有**。
-- 🎯 ⇒ 📌 **`has_*_privilege` 對【專門授給我的】與【PUBLIC 順便的】印同一個 `t`。**
--    ⇒ 那是本檔開頭那句話的另一半:**兩個世界印同一個東西, 而這次印的是 `t` 不是 `0`。**
-- 🛑 ⇒ **要答「誰給的」只能讀 ACL 原文。** 下面這一段就是。
-- 兩個世界:grantee 欄是空字串 ⇒ PUBLIC(誰都有)· 是角色名 ⇒ 那是專門給它的
SELECT n.nspname AS schema,
       CASE WHEN a.grantee = 0 THEN '(PUBLIC)'
            ELSE (SELECT rolname FROM pg_roles WHERE oid = a.grantee) END AS 給了誰,
       a.privilege_type AS 權限,
       (SELECT rolname FROM pg_roles WHERE oid = a.grantor) AS 誰給的
  FROM pg_namespace n
  CROSS JOIN LATERAL aclexplode(n.nspacl) a
 WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
   AND (a.grantee = 0
        OR (SELECT rolname FROM pg_roles WHERE oid = a.grantee)
            IN ('pcm_audit_ro','pcm_readonly'))
 ORDER BY 1,2,3;
-- 🔵 判讀:`pcm_readonly` 對 `cron` 那一條若印出來 ⇒ 那是 `postgres` **專門授**的
--    (`-tidy` 2026-09-08 讀到 `pcm_readonly=U/postgres`)
--    ⇒ 📌 而 `pcm_readonly` 本身也是版控之外建的 ⇒ **一個版控外的角色 + 一道版控外的 GRANT**。
--    那與 `pcm_audit_ro` 的 `net` 是**不同的形狀**:那個是 PUBLIC 順便, 這個是專門給的。

\echo '===== ④ public 底下它讀得到幾張(帶正對照, 兩個數要不一樣) ====='
-- 🔴 這一段的重點是【兩個角色的數字要不同】。
--    若兩個都印 0 ⇒ 那不是「兩個都讀不到」, 那是【這把尺壞了】⇒ 本段作廢。
SELECT 'pcm_audit_ro' AS role,
       count(*) FILTER (WHERE has_table_privilege('pcm_audit_ro', c.oid, 'SELECT')) AS 讀得到,
       count(*) AS 分母
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p')
UNION ALL
SELECT 'pcm_readonly',
       count(*) FILTER (WHERE has_table_privilege('pcm_readonly', c.oid, 'SELECT')),
       count(*)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p');

\echo '===== ⑤ 🔴 它是不是任何東西的 owner(DROP ROLE 會被它擋住) ====='
-- 🛑 **這一格 -db 那批【沒有跑】, 而它是【刪掉】那一案的硬前置。**
-- 兩個世界:不是任何東西的 owner ⇒ 0 列(DROP 這一關過)
--            是 ⇒ 每個物件一列(那些要先轉移, 否則 DROP 直接失敗)
-- 🟢 正對照 = 同一句對 postgres 跑, 應該撈到一堆(下一段)
SELECT n.nspname AS schema, c.relname AS 物件, c.relkind AS 種類
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relowner = (SELECT oid FROM pg_roles WHERE rolname = 'pcm_audit_ro')
 ORDER BY 1,2;

\echo '--- ⑤ 的正對照:同一句對 postgres 跑, 這個數不該是 0 ---'
SELECT count(*) AS postgres_擁有幾個物件
  FROM pg_class c
 WHERE c.relowner = (SELECT oid FROM pg_roles WHERE rolname = 'postgres');

\echo '--- ⑤ 的負對照:現造角色名, 這個數該是 0 ---'
SELECT count(*) AS 現造角色_擁有幾個
  FROM pg_class c
 WHERE c.relowner = (SELECT oid FROM pg_roles WHERE rolname = 'zzq_no_such_role_20260908');

\echo '===== ⑥ 🔵 net 那扇門:它站在門前, 還是推得開? ====='
-- 🔴 **schema 的 USAGE ≠ 對裡面的函式有 EXECUTE。** ③ 只答得出前者。
--    而 `net` 是 pg_net(發 HTTP 的那個)⇒ 這一格的答案改變【刪掉】那一案的成本。
-- 🔵 背景:docs/security/2026-08-17-e686-…-guard-spec.md:36 逐字
--    「實測輸出(2026-08-17, `pcm_audit_ro`):4 列, sel/ins/upd/del/trunc 全部 t」
--    ⇒ 那次 net 曝露稽核【就是用這個帳號跑的】⇒ net 的權限可能是刻意給的任務, 不是殘留。
-- 兩個世界:0 列 ⇒ 它只是站在門前  ·  有列 ⇒ 它叫得動那幾支
SELECT p.proname AS 函式,
       pg_get_function_identity_arguments(p.oid) AS 參數,
       has_function_privilege('pcm_audit_ro', p.oid, 'EXECUTE') AS 叫得動
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'net'
 ORDER BY 1;

\echo '--- ⑥-b net 底下的表它讀不讀得到 / 寫不寫得到 ---'
SELECT c.relname AS 表,
       has_table_privilege('pcm_audit_ro', c.oid, 'SELECT') AS 讀,
       has_table_privilege('pcm_audit_ro', c.oid, 'INSERT') AS 寫,
       has_table_privilege('pcm_audit_ro', c.oid, 'DELETE') AS 刪
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'net' AND c.relkind IN ('r','v','m','p')
 ORDER BY 1;

\echo '===== ⑦ 它握著哪些表權限(全庫, 不限 public) ====='
-- ⚠️ **不用 information_schema.role_table_grants** —— 那是【權限過濾】的:
--    跑的人權限不夠會少報, 而少報與「真的沒有」印同一個空表。
--    (逐字出處 docs/security/2026-08-17-sweeper-health-endpoint-spec.md:95)
-- ⇒ 改用 aclexplode 直接讀 ACL 欄。
-- 🔴 而 ACL 欄是 NULL 時 = 走預設權限 ⇒ 本段【看不見那一種】, 那由 ④/⑥ 的 has_* 補。
SELECT n.nspname AS schema, c.relname AS 物件, a.privilege_type AS 權限
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(c.relacl) a
  JOIN pg_roles g ON g.oid = a.grantee
 WHERE g.rolname = 'pcm_audit_ro'
 ORDER BY 1,2,3;

\echo '--- ⑦ 的正對照:同一句對 pcm_readonly 跑, 這個數不該是 0 ---'
SELECT count(*) AS pcm_readonly_明確授權格數
  FROM pg_class c
  CROSS JOIN LATERAL aclexplode(c.relacl) a
  JOIN pg_roles g ON g.oid = a.grantee
 WHERE g.rolname = 'pcm_readonly';

\echo '===== 判讀 ====='
\echo '① rolcanlogin = t  ⇒ 刪掉那案【必須】先 NOLOGIN 觀察, 不是選項'
\echo '⑤ 0 列            ⇒ DROP ROLE 這一關過;非 0 ⇒ 那些物件要先轉移'
\echo '⑥ 全部 f          ⇒ 它只是站在 net 門前;有 t ⇒ 去 ③-b 看那是不是 PUBLIC 給的'
\echo '③-b 給了誰=(PUBLIC) ⇒ 那個權限【不是這個帳號的資產】, 刪掉它不會少掉那個視角'
\echo '🛑 任何一段的正對照印 0 ⇒ 那一段【作廢】, 不要拿它的讀數下結論'
