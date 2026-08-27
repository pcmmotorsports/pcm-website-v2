-- ci-self-contained: no — 手動貼 Supabase SQL Editor 對線上庫跑(讀 net._http_response / email_outbox 等實資料),非 CI 自給自足。
-- 2026-08-26-q15-rls-service-role-audit.sql
-- Q15 · 【可重跑的全庫體檢】—— 後台的可見性到底靠什麼撐著, 現在就問資料庫本人。
--
-- 拍板:Sean 2026-08-26 選【乙】——
--   ~~甲 = 貼 `20260826000035` 那支 migration, 補 customers 一張的政策~~
--   乙 = **先不貼**, 改成做這一支涵蓋全庫的體檢。
--   理由(codex 對抗審查 R3 換角度後開的框架問題, 而 Sean 同意):
--     補一條政策只救 1 張表, 而它會造出「**客戶列表有、訂單全 0**」的中間狀態
--     ⇒ **比整頁空白更像真資料**, 空白會有人叫, 0 不會。
--   ⇒ 那支 migration **留在 repo 但不 apply**, 檔頭已標。先用本檔看清楚全貌再決定範圍。
--
-- ── §0 跑法(Sean 直接用這一段)────────────────────────────────────────────
--   1. 打開 Supabase SQL Editor
--   2. 把 `BEGIN;` 底下到 `ROLLBACK;` 為止**整段**複製貼上, 按 Run
--   3. 把出來的表整個複製貼回給窗
--
--   🔴 **它只有 SELECT, 不會改任何東西。** 而且整段包在 `BEGIN … ROLLBACK` 裡
--      ⇒ **零留痕**, 想跑幾次跑幾次。
--   🔴 **先看最上面那三列(區 = `0 尺自檢`)** ——
--      它們是【我知道正確答案的三個輸入】。三列只要有一列的「判定」不是 `✅ 尺會動`,
--      **底下所有結果一律作廢, 不要引用。**
--      理由:一把壞掉的尺會印出一張看起來很正常的表, 而那張表的每一格都是假的。
--
-- ── §1 這張表在回答什麼 ──────────────────────────────────────────────────
--   區 1  `service_role` 到底有沒有 BYPASSRLS ── Q15 的**整個前提**, 而 repo 內驗不到
--   區 2  誰【有效繼承】service_role ── 唯一的外溢路徑
--   區 3  每張開了 RLS 的表, service_role 有沒有可用的 SELECT 政策 ── 爆炸半徑
--   區 4  `customers` 的 table 權(GRANT)那一層 ── **與 RLS 是兩層, 兩層都會塌**
--
--   🔴 兩層的失效長相不一樣, 而畫面上分不出來:
--     RLS 那層塌   => 查得到、回 0 列        => 看起來像「沒有資料」
--     GRANT 那層塌 => 查不到、PostgREST 報錯 => 看起來像「系統壞了」
--
-- ── §2 效度限制(不要弱化)──────────────────────────────────────────────
--   · 本檔問的是**線上真實狀態**, 而 repo 那份 `docs/specs/2026-08-25-q15-service-role-select-scope.md`
--     的 47 / 40 是**靜態重播版控字面**得到的。**兩個數字對不上是正常的, 而那個差本身就是產出。**
--   · 區 3 只看「有沒有一條 SELECT(或 FOR ALL)政策, 其 TO 含 service_role 或 PUBLIC」。
--     **它不看 `USING` 的內容** ⇒ 一條 `USING (false)` 會被判成「有政策」。
--     ⇒ 這個盲區讓「缺政策」的數字**偏小**, 不會偏大。
--   · 區 2 的判定用 `rolbypassrls` 與 table owner 分辨真暴露/假紅,
--     **它不涵蓋 SECURITY DEFINER 函式那條路**(那要另外查 proowner)。
-- ============================================================================

BEGIN;

SELECT * FROM (

  -- ── 區 0 · 尺自檢:三個我知道答案的輸入 ───────────────────────────────
  SELECT '0 尺自檢' AS 區, 1 AS 序,
         'pg_roles 查得到 service_role 嗎' AS 對象,
         (SELECT count(*)::text FROM pg_catalog.pg_roles WHERE rolname = 'service_role') AS 值,
         CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role')
              THEN '✅ 尺會動' ELSE '🔴 尺壞了 — 底下全部作廢' END AS 判定
  UNION ALL
  SELECT '0 尺自檢', 2,
         '負對照:問一個不存在的角色',
         (SELECT count(*)::text FROM pg_catalog.pg_roles
           WHERE rolname = 'pcm_no_such_role_for_negative_control'),
         CASE WHEN NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
                                WHERE rolname = 'pcm_no_such_role_for_negative_control')
              THEN '✅ 尺會動' ELSE '🔴 尺壞了 — 它亂報有' END
  UNION ALL
  SELECT '0 尺自檢', 3,
         '負對照:問一張不存在的表有沒有政策',
         (SELECT count(*)::text FROM pg_catalog.pg_policies
           WHERE tablename = 'pcm_no_such_table_for_negative_control'),
         CASE WHEN NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies
                                WHERE tablename = 'pcm_no_such_table_for_negative_control')
              THEN '✅ 尺會動' ELSE '🔴 尺壞了 — 它亂報有' END

  -- ── 區 1 · Q15 的整個前提 ───────────────────────────────────────────────
  UNION ALL
  SELECT '1 前提', 10,
         'service_role 有沒有 BYPASSRLS',
         CASE WHEN r.rolbypassrls THEN '有' ELSE '沒有' END,
         CASE WHEN r.rolbypassrls
              THEN '⚠️ 後台今天看得到資料, 靠的就是這一格 — 而它是平台屬性, repo 內驗不到'
              ELSE '🔴🔴 它【已經沒有了】— 那 Q15 講的災難不是未來式, 現在就在發生' END
    FROM pg_catalog.pg_roles r WHERE r.rolname = 'service_role'

  -- ── 區 2 · 唯一的外溢路徑 ───────────────────────────────────────────────
  -- 🔴 這一格【一定會印一列】, 即使答案是零個。
  --    理由:一個空白的區塊, 與「這一段的查詢寫壞了」**在畫面上長得一樣**,
  --    而看畫面的人沒有第二個來源可以對。⇒ 零個要自己講出來。
  UNION ALL
  SELECT '2 誰繼承了 service_role', 19,
         '(小計)',
         (SELECT count(*)::text FROM pg_catalog.pg_roles r
           WHERE r.rolname <> 'service_role' AND NOT r.rolsuper
             AND pg_catalog.pg_has_role(r.rolname, 'service_role', 'USAGE')) || ' 個',
         CASE WHEN NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
                                WHERE r.rolname <> 'service_role' AND NOT r.rolsuper
                                  AND pg_catalog.pg_has_role(r.rolname, 'service_role', 'USAGE'))
              THEN '✅ 零個 — 下面沒有列是【正常的】, 不是查詢壞了'
              ELSE '⬇️ 逐個列在下面, 一列一個' END
  UNION ALL
  SELECT '2 誰繼承了 service_role', 20,
         r.rolname,
         CASE WHEN r.rolbypassrls THEN '它自己也有 BYPASSRLS' ELSE '沒有 BYPASSRLS' END,
         CASE WHEN r.rolbypassrls
              THEN '假紅:它本來就繞得過 RLS, 補政策沒有給它新東西'
              ELSE '🔴 要看:補一條 USING (true) 會讓它從看不到變成全部看得到' END
    FROM pg_catalog.pg_roles r
   WHERE r.rolname <> 'service_role'
     AND NOT r.rolsuper
     AND pg_catalog.pg_has_role(r.rolname, 'service_role', 'USAGE')

  -- ── 區 3 · 爆炸半徑:每張開了 RLS 的表 ─────────────────────────────────
  -- 同上:先印一列小計, 讓「零張」講得出口。
  UNION ALL
  SELECT '3 開了 RLS 的表', 29,
         '(小計)',
         (SELECT count(*)::text FROM pg_catalog.pg_class c2
            JOIN pg_catalog.pg_namespace n2 ON n2.oid = c2.relnamespace
           WHERE n2.nspname = 'public' AND c2.relkind = 'r' AND c2.relrowsecurity
             AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies p
                              WHERE p.schemaname = 'public' AND p.tablename = c2.relname
                                AND p.cmd IN ('SELECT', 'ALL')
                                AND ('service_role' = ANY (p.roles) OR '-' = ANY (p.roles) OR 'public' = ANY (p.roles))))
         || ' 張缺政策 / 共 ' ||
         (SELECT count(*)::text FROM pg_catalog.pg_class c3
            JOIN pg_catalog.pg_namespace n3 ON n3.oid = c3.relnamespace
           WHERE n3.nspname = 'public' AND c3.relkind = 'r' AND c3.relrowsecurity) || ' 張開了 RLS',
         '🔴 把這兩個數字回報給窗 — repo 裡的靜態估算是 40 / 47, 對不上的那個差本身就是產出'
  UNION ALL
  SELECT '3 開了 RLS 的表', 30,
         c.relname::text,
         (SELECT count(*)::text FROM pg_catalog.pg_policies p
           WHERE p.schemaname = 'public' AND p.tablename = c.relname
             AND p.cmd IN ('SELECT', 'ALL')
             AND ('service_role' = ANY (p.roles) OR '-' = ANY (p.roles) OR 'public' = ANY (p.roles))),
         CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_policies p
                            WHERE p.schemaname = 'public' AND p.tablename = c.relname
                              AND p.cmd IN ('SELECT', 'ALL')
                              AND ('service_role' = ANY (p.roles) OR '-' = ANY (p.roles) OR 'public' = ANY (p.roles)))
              THEN '有 service_role 讀得到的政策'
              ELSE '🔴 沒有 — 拿掉 BYPASSRLS 這張表就回 0 列' END
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity

  -- ── 區 4 · 另一層:table 權 ─────────────────────────────────────────────
  UNION ALL
  SELECT '4 customers 的 table 權', 40,
         g.grantee::text,
         pg_catalog.string_agg(g.privilege_type::text, ', ' ORDER BY g.privilege_type::text),
         '這一層與 RLS 是兩件事 — 它塌的時候畫面是【報錯】不是【空的】'
    FROM information_schema.role_table_grants g
   WHERE g.table_schema = 'public' AND g.table_name = 'customers'
   GROUP BY g.grantee

) t ORDER BY t.序, t.對象;

ROLLBACK;
