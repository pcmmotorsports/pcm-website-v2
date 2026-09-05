-- ⟦b9-PUBLICVIEWALL⟧:四支公開 view 對 anon / authenticated 收掉【寫】那一整套
-- 板列 docs/launch-todo.md ⟦b9-PUBLICVIEWALL⟧ · 派工 -f8 2026-09-05 15:5x · 射程改四支 -f8 16:4x 拍甲
-- 做法照 docs/patterns/revoking-function-execute-in-supabase.md(§1 兩道 REVOKE · §3.3 欄級 · §3.6 ACL 尺)
-- 審查:codex R1 FAIL(9 MF + 3 nit)⇒ 折完;codex R2 FAIL(5 MF + 4 nit)⇒ 折完;R3 見板列
--
-- ══ 病灶 ══════════════════════════════════════════════════════════════════
-- 2026-09-05 16:0x~16:4x -db 唯讀實量(全庫掃, 不限 public):
--   products_list_public     security_invoker=true   anon/authenticated: 八種全開
--   vehicle_taxonomy_public  security_invoker=false  anon/authenticated: 八種全開   ← 最毒
--   products_public          security_invoker=true   anon/authenticated: MAINTAIN,SELECT
--   product_variants_public  security_invoker=true   anon/authenticated: MAINTAIN,SELECT
--   四支 owner 都是 postgres。貼前寫權格數 = 32(4 支 × 2 角色 × 7 種, 上限 56)。
--
-- 🔴🔴 **後兩支【板列原本沒有】, 而漏掉它們的原因就是本片在修的那個東西**
--   後兩支只剩 MAINTAIN + SELECT ⇒ **已經有人用【列舉式 REVOKE】收過**,
--   而那份列舉寫在 MAINTAIN 存在之前(PG17 才有這個權限)。
--   ⇒ 🛑 **那次收權留下的殘餘, 恰好是任何一把「列舉六種」的尺看不見的那一格。**
--   ⇒ 📌 **板列寫七種 ⇒ 找受害者的尺也只問七種 ⇒ 那兩支【結構上隱形】。**
--      我是為了折 codex R2 的 must-fix ④(「⑦寫全庫卻只掃 public」)去掃全庫才撞到它們。
--   ⇒ ✅ **所以本檔用 `REVOKE ALL`, 一個權限名都不列舉。**
--
-- ══ 今天能不能被利用 ══════════════════════════════════════════════════════
--   前三支 is_insertable_into=NO / is_updatable=NO ⇒ 那些寫權限是空的。
--   🔴 product_variants_public **是 YES/YES(可寫)** —— ⚠️ **不要讀成「客人現在改得了資料」**:
--      anon 在它上面只有 MAINTAIN(VACUUM/ANALYZE/REINDEX 那類), **沒有 INSERT/UPDATE**。
--      🛑 但板列舊字面「兩支都不可寫 ⇒ 那些權限是空的」對這一支**不成立**(已回去改那一列)。
--   🔴 風險在未來:有人把 view 改成可更新 ⇒ 那些授權【靜靜生效】;
--      而 vehicle_taxonomy_public 是 security_invoker=false ⇒ 寫入會用 postgres 的身分跑, 繞過底表 RLS。
--   🛑 **貼完畫面零變化, 那是預期, 不是驗收通過。**
--
-- ══ 🛑 這一支證不到什麼 ══════════════════════════════════════════════════
--   · 只收這四支。而「下一支新 view 會不會自帶那八種」⛔ ~~照樣自帶~~ ⇒
--     🔴 **[codex R3 MF④ 抓到, 我實量了 `pg_catalog.pg_default_acl`]答案是【看誰建的】**:
--       建立者 postgres       在 public 的表/view ⇒ `postgres=arwdDxtm | service_role=Dxtm`
--                              ⇒ 🟢 **anon / authenticated 一格都沒有** ⇒ 我們自己的 migration 建的物件是乾淨的
--       建立者 supabase_admin 在 public 的表/view ⇒ `postgres / anon / authenticated / service_role` **各 arwdDxtm**
--                              ⇒ 🔴 **平台或 dashboard 建的才會自帶八種**
--     ⇒ 📌 **所以這一段的正確講法是「入口只剩 supabase_admin 那一條」, 不是「每次都要人記得補 REVOKE」。**
--     🛑 **而這四支就是那條入口的產物** —— 它們的 owner 是 postgres 而 ACL 全開, 代表**建的當下** ADP 還是舊的那份。
--     ⚠️ **本檔沒有把這個 invariant 做成持續守門**(codex R3 MF④ 的後半)⇒ 那是另一片, 已記進板列。
--   · **平台側不碰**:net._http_response · net.http_request_queue · storage.buckets /
--     buckets_analytics / objects 對 anon 也有 MAINTAIN ⇒ 那是 supabase_storage_admin 等角色授出去的,
--     **postgres 物理上收不掉**(2026-07-23 已記;2026-09-05 -db 又走一遍才被 codex 攔下)。
--   · 🔴 **它不證明顧客站還讀得到** —— 那要真的打一發顧客站。本檔只證得到「權限層還在」。
--
-- ══ ⛔⛔ 沒有真正的 rollback(codex R1 MF⑤ · R2 MF②)══════════════════════
--   下面這段是【重新開放】, 不是【還原】:
--     BEGIN;
--       GRANT ALL ON TABLE public.products_list_public    TO anon, authenticated;
--       GRANT ALL ON TABLE public.vehicle_taxonomy_public TO anon, authenticated;
--       GRANT SELECT, MAINTAIN ON TABLE public.products_public         TO anon, authenticated;
--       GRANT SELECT, MAINTAIN ON TABLE public.product_variants_public TO anon, authenticated;
--     COMMIT;
--   🔬 **五項還原不了的東西, 我量了四項**(2026-09-05 16:4x 唯讀):
--     ① grantor    ⇒ 四支所有授權的 grantor 都是 `postgres`(量到)
--     ② grant option ⇒ 0 列(量到)
--     ③ 欄級 ACL   ⇒ attacl 非 NULL 的欄 0 個(量到)
--     ④ PUBLIC 那份 ⇒ 0 列(量到)
--     ⑤ 🔴 **「原授權是哪一支 migration / 哪個平台動作下的」—— 我沒量, 也答不出來。**
--   ⛔ ⇒ **所以不寫「今天退得回去」那句結論**(codex R2 MF② 抓到我只量三項就下結論)。
--      能寫的只有:**①~④ 今天是空的, 而 ⑤ 未知。** 退之前先重跑那四個量測。
--   ✅ **[codex R3 MF③]可執行的復原檔在 `scripts/20260905260000-down.sql`** ——
--      它裝回去的是**貼前那個確切狀態**(前兩支八種、後兩支只有 SELECT+MAINTAIN),
--      🔴 **不是 `GRANT ALL` 給四支** —— 那會多給後兩支六種它們本來就沒有的權限。
--      🛑 **停損順序**:出事先看是「顧客站讀不到」還是「別的」——
--         讀不到 ⇒ 只跑 down 檔的 §1(把 SELECT 補回去), **不要整支跑**;
--         其他 ⇒ 停下問, 因為本檔只動 ACL, 讀不到以外的症狀多半不是它造成的。

BEGIN;

-- 🔴 **[R4 F4]** repo 有 112 支同儕帶 lock_timeout, 而本片一支都沒有;板列 ⟦b4-LOCK1⟧ 修法逐字
--    「前加 SET lock_timeout='5s'」並自標適用範圍不只那一片。
--    🛑 本片動四支【主力】view 的 ACL, 再在同一筆交易裡各讀一遍
--       (vehicle_taxonomy_public 12,053 列 / product_variants_public 51,666 列)
--       ⇒ 取不到鎖時 SQL Editor 會【無限等】, 而後續讀者全部排在後面 —— 那個世界【沒有東西會紅】。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

-- ══ 前置閘 ════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_n integer;
  v_t text;
BEGIN
  -- ⓪ 四支都在、都是 view、owner 都是 postgres(codex R1 MF⑧)
  SELECT pg_catalog.string_agg(c.relname || '/kind=' || c.relkind::text || '/owner=' || c.relowner::regrole::text, ', ') INTO v_t
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('products_list_public','vehicle_taxonomy_public','products_public','product_variants_public')
     AND (c.relkind <> 'v' OR c.relowner <> 'postgres'::regrole);
  IF v_t IS NOT NULL THEN
    RAISE EXCEPTION '前置閘⓪:不是 view 或 owner 不是 postgres ⇒ % ⇒ 停下人工對齊', v_t;
  END IF;

  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('products_list_public','vehicle_taxonomy_public','products_public','product_variants_public')
     AND c.relkind = 'v';
  IF v_n <> 4 THEN
    RAISE EXCEPTION '前置閘①:期望四支 view, 實得 % ⇒ 停下人工對齊', v_n;
  END IF;

  -- ② 七種寫權(含 PG17 的 MAINTAIN)。貼前唯讀實量 = 32。
  --    🔴 codex R1 MF②:只列六種時,「只剩 MAINTAIN」會被誤判成已收乾淨 —— 那正是後兩支的實況。
  SELECT pg_catalog.count(*) INTO v_n
    FROM (VALUES ('public.products_list_public'),('public.vehicle_taxonomy_public'),
                 ('public.products_public'),('public.product_variants_public')) t(rel)
    CROSS JOIN (VALUES ('anon'),('authenticated')) r(rolname)
    CROSS JOIN (VALUES ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),
                       ('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(priv)
   WHERE pg_catalog.has_table_privilege(r.rolname, t.rel, p.priv);
  -- 🔴 **[R4 F2]** ⛔ ~~`IF v_n = 0 THEN RAISE`~~ —— 那會讓【從零重放】永久紅:
  --    那四支 view 由 repo 的 migration 建, 而建的時候只 GRANT SELECT
  --    ⇒ 空庫上 v_n 本來就是 0 ⇒ `migrations-replay-from-zero.sh` 多一支永遠失敗的。
  --    🛑 更根本的是:**「已經貼過」與「本來就乾淨」印同一個 0** —— 那個 RAISE 分不出這兩個世界。
  --    ✅ 而本檔的動作(REVOKE ALL + GRANT SELECT)**是冪等的** ⇒ 重跑無害 ⇒ 改成 NOTICE, 不擋。
  IF v_n = 0 THEN
    RAISE NOTICE '[20260905260000] 🔵 四支對 anon/authenticated 一格寫權都沒有 —— 可能是貼過了, 也可能這台庫本來就乾淨(空庫從零重放就是這樣)。本檔冪等, 照跑。';
  END IF;
  RAISE NOTICE '[20260905260000] 前置閘:貼前寫權格數 = %(2026-09-05 16:4x 唯讀實量 32;上限 4×2×7=56)', v_n;

  -- ③ PUBLIC 那一份必須是空的 —— 含【欄級】(codex R2 MF⑤:前置閘只看 relacl)
  --    REVOKE FROM PUBLIC 會把所有靠 PUBLIC 取得權限的角色一起收掉 ⇒ 爆炸半徑要先證明是零。
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
   WHERE n.nspname = 'public'
     AND c.relname IN ('products_list_public','vehicle_taxonomy_public','products_public','product_variants_public')
     AND a.grantee = 0;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '前置閘③:PUBLIC 在那四支的【表級】ACL 上有 % 筆 ⇒ REVOKE FROM PUBLIC 的爆炸半徑沒被評估過 ⇒ 停下', v_n;
  END IF;
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_attribute att
    JOIN pg_catalog.pg_class c ON c.oid = att.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(att.attacl) a
   WHERE n.nspname = 'public'
     AND c.relname IN ('products_list_public','vehicle_taxonomy_public','products_public','product_variants_public')
     AND a.grantee = 0;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '前置閘③b:PUBLIC 在那四支的【欄級】ACL 上有 % 筆 ⇒ 同上, 停下', v_n;
  END IF;

  -- ④ 不得有 grant option —— 🔴 只看【本檔會動到的 grantee】。
  --    codex R2 MF⑤:掃所有 grantee 會讓無關角色持 grant option 也誤擋。
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
   WHERE n.nspname = 'public'
     AND c.relname IN ('products_list_public','vehicle_taxonomy_public','products_public','product_variants_public')
     AND a.is_grantable
     AND a.grantee IN (0, pg_catalog.to_regrole('anon'), pg_catalog.to_regrole('authenticated'));
  IF v_n <> 0 THEN
    RAISE EXCEPTION '前置閘④:PUBLIC/anon/authenticated 持有 % 筆帶 GRANT OPTION 的授權 ⇒ 可能有相依授權(REVOKE 預設 RESTRICT 會失敗), 而更重要的是有人可以再授出去 ⇒ 停下人工看', v_n;
  END IF;

  -- ⑤ 🔵 只記錄不擋:哪幾支已經可寫。已知 product_variants_public 是 YES/YES。
  -- 🔵 **[R4 F8]** 原本這一格是全檔唯一走 information_schema 的 ——
  --    換個角色跑它會靜靜印不出東西(那個 view 只列你有權限看的), 與其他格的 pg_catalog 紀律不一致。
  SELECT pg_catalog.string_agg(c.relname, ', ') INTO v_t
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('products_list_public','vehicle_taxonomy_public','products_public','product_variants_public')
     AND c.relkind = 'v'
     AND pg_catalog.pg_relation_is_updatable(c.oid, false) <> 0;
  IF v_t IS NOT NULL THEN
    RAISE NOTICE '[20260905260000] 🔵 這幾支【已經可寫】:% —— 本檔正好在關它們的寫權(已知 product_variants_public 是 YES/YES, 而 anon 在它上面只有 MAINTAIN, 不是能改資料)', v_t;
  END IF;
END $$;

-- ══ 兩道 REVOKE(§1:少一道都是開的)══════════════════════════════════════
-- 🔴 用 REVOKE ALL, 一個權限名都不列舉 —— 列舉正是後兩支之所以隱形的成因。
-- 🔵 FROM PUBLIC 那幾行今天是【空砲】(前置閘③/③b 證過 PUBLIC 0 筆), 留著是為了它哪天不空。
REVOKE ALL ON TABLE public.products_list_public     FROM PUBLIC;
REVOKE ALL ON TABLE public.products_list_public     FROM anon, authenticated;
REVOKE ALL ON TABLE public.vehicle_taxonomy_public  FROM PUBLIC;
REVOKE ALL ON TABLE public.vehicle_taxonomy_public  FROM anon, authenticated;
REVOKE ALL ON TABLE public.products_public          FROM PUBLIC;
REVOKE ALL ON TABLE public.products_public          FROM anon, authenticated;
REVOKE ALL ON TABLE public.product_variants_public  FROM PUBLIC;
REVOKE ALL ON TABLE public.product_variants_public  FROM anon, authenticated;

-- 🟢 再把【唯一該有的那一種】裝回去 —— 這四支是公開 view, 顧客站靠它們讀。
--    ⚠️ REVOKE ALL 會連 SELECT 一起收掉 ⇒ 這幾行是必要的, 不是保險。
-- 🔴 `scripts/acl-drift-gate.py` 會擋下這四行(對 anon 的 GRANT)—— **而它擋得對**。
--    這裡走它的路②(同檔明文豁免 + 寫得出理由), 而不是路⑤(改端給 Sean 貼 SQL Editor):
--    📌 路⑤ **比被擋更糟** —— 線上改了而 repo 一個字都沒有(前例 docs/launch-todo.md:235)。
--    🔵 而這四行不是【新開】權限:它們是把 `REVOKE ALL` 連帶收掉的 SELECT **原樣裝回去**。
--       貼前唯讀實量:這四支對 anon/authenticated 的 SELECT 本來就各有一列(共 8 列)。
-- ACL-GATE-EXEMPT: public.products_list_public -- 顧客站商品列表靠 anon 直讀此 view;本片只收寫權、SELECT 原樣裝回(20260905260000, 2026-09-05 -f8 拍甲)
GRANT SELECT ON TABLE public.products_list_public     TO anon, authenticated;
-- ACL-GATE-EXEMPT: public.vehicle_taxonomy_public -- 顧客站車款篩選靠 anon 直讀此 view;本片只收寫權、SELECT 原樣裝回(20260905260000, 2026-09-05 -f8 拍甲)
GRANT SELECT ON TABLE public.vehicle_taxonomy_public  TO anon, authenticated;
-- ACL-GATE-EXEMPT: public.products_public -- 顧客站商品頁靠 anon 直讀此 view;本片只收寫權、SELECT 原樣裝回(20260905260000, 2026-09-05 -f8 拍甲)
GRANT SELECT ON TABLE public.products_public          TO anon, authenticated;
-- ACL-GATE-EXEMPT: public.product_variants_public -- 顧客站規格選項靠 anon 直讀此 view;本片只收寫權、SELECT 原樣裝回(20260905260000, 2026-09-05 -f8 拍甲)
GRANT SELECT ON TABLE public.product_variants_public  TO anon, authenticated;

-- ══ 事後斷言 ══════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_n    integer;
  v_leak text;
BEGIN
  -- ① 七種寫權全收乾淨(貼前 32 ⇒ 期望 0)
  SELECT pg_catalog.string_agg(t.rel || '/' || r.rolname || '/' || p.priv, ', ') INTO v_leak
    FROM (VALUES ('public.products_list_public'),('public.vehicle_taxonomy_public'),
                 ('public.products_public'),('public.product_variants_public')) t(rel)
    CROSS JOIN (VALUES ('anon'),('authenticated')) r(rolname)
    CROSS JOIN (VALUES ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),
                       ('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(priv)
   WHERE pg_catalog.has_table_privilege(r.rolname, t.rel, p.priv);
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION '斷言①失敗:還收得不乾淨 ⇒ %', v_leak;
  END IF;

  -- ①b ACL 字面:anon/authenticated 的權限集合必須恰為 SELECT,**且不得帶 grant option**
  --     🔴 codex R2 MF③:只聚合 privilege_type 會讓「SELECT WITH GRANT OPTION」全綠通過。
  SELECT pg_catalog.string_agg(x.relname || '/' || x.rolname || '=' || x.privs
                               || CASE WHEN x.grantable THEN '(帶 GRANT OPTION)' ELSE '' END, ', ') INTO v_leak
    FROM (
      SELECT c.relname, a.grantee::regrole::text AS rolname,
             pg_catalog.string_agg(DISTINCT a.privilege_type, ',' ORDER BY a.privilege_type) AS privs,
             pg_catalog.bool_or(a.is_grantable) AS grantable
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
       WHERE n.nspname = 'public'
         AND c.relname IN ('products_list_public','vehicle_taxonomy_public','products_public','product_variants_public')
         AND a.grantee IN (pg_catalog.to_regrole('anon'), pg_catalog.to_regrole('authenticated'))
       GROUP BY c.relname, a.grantee
    ) x
   WHERE x.privs <> 'SELECT' OR x.grantable;
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION '斷言①b失敗:ACL 上不是「恰好 SELECT 且不可再授出」⇒ %', v_leak;
  END IF;

  -- ①c 直接授權真的在(8 格;貼前實量 8)—— 證明 SELECT 是直接授的, 不是繼承來的
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
   WHERE n.nspname = 'public'
     AND c.relname IN ('products_list_public','vehicle_taxonomy_public','products_public','product_variants_public')
     AND a.grantee IN (pg_catalog.to_regrole('anon'), pg_catalog.to_regrole('authenticated'))
     AND a.privilege_type = 'SELECT';
  IF v_n <> 8 THEN
    RAISE EXCEPTION '斷言①c失敗:ACL 上的直接 SELECT 授權 % 列(期望 8)⇒ GRANT 沒生效, 或 SELECT 是繼承來的', v_n;
  END IF;

  -- ②a 🟢 有效 SELECT 必須還在(貼前 8 ⇒ 期望 8)。這格紅 = 顧客站看不到商品/車款。
  SELECT pg_catalog.count(*) INTO v_n
    FROM (VALUES ('public.products_list_public'),('public.vehicle_taxonomy_public'),
                 ('public.products_public'),('public.product_variants_public')) t(rel)
    CROSS JOIN (VALUES ('anon'),('authenticated')) r(rolname)
   WHERE pg_catalog.has_table_privilege(r.rolname, t.rel, 'SELECT');
  IF v_n <> 8 THEN
    RAISE EXCEPTION '斷言②a失敗:有效 SELECT 只剩 % 格(期望 8)⇒ 顧客站會看不到商品/車款', v_n;
  END IF;

  -- ②b 欄級 —— ⚠️ codex R1 nit①:has_any_column_privilege 為真也可能是【整表權限】造成的
  --     ⇒ 這一格答的是「任一欄的有效權限」, 不是「存在欄級 ACL」。②c 才是後者的尺。
  SELECT pg_catalog.string_agg(t.rel || '/' || r.rolname || '/' || p.priv, ', ') INTO v_leak
    FROM (VALUES ('public.products_list_public'),('public.vehicle_taxonomy_public'),
                 ('public.products_public'),('public.product_variants_public')) t(rel)
    CROSS JOIN (VALUES ('anon'),('authenticated')) r(rolname)
    CROSS JOIN (VALUES ('INSERT'),('UPDATE'),('REFERENCES')) p(priv)
   WHERE pg_catalog.has_any_column_privilege(r.rolname, t.rel, p.priv);
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION '斷言②b失敗:任一欄仍有寫類有效權限 ⇒ %', v_leak;
  END IF;

  -- ②c 欄級 ACL 本體(貼前實量 0 個)
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_attribute att
    JOIN pg_catalog.pg_class c ON c.oid = att.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('products_list_public','vehicle_taxonomy_public','products_public','product_variants_public')
     AND att.attacl IS NOT NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '斷言②c失敗:有 % 個欄帶欄級 ACL ⇒ 本檔的 REVOKE 收不到它們(§3.3)', v_n;
  END IF;

  -- ③ PUBLIC 表級 + 欄級都仍是 0
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
   WHERE n.nspname = 'public'
     AND c.relname IN ('products_list_public','vehicle_taxonomy_public','products_public','product_variants_public')
     AND a.grantee = 0;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '斷言③失敗:PUBLIC 有 % 筆表級授權', v_n;
  END IF;

  -- ④ 🟢 正對照:同一把尺問 service_role 的 DELETE ⇒ 必須仍為 4(貼前實量 4)
  SELECT pg_catalog.count(*) INTO v_n
    FROM (VALUES ('public.products_list_public'),('public.vehicle_taxonomy_public'),
                 ('public.products_public'),('public.product_variants_public')) t(rel)
   WHERE pg_catalog.has_table_privilege('service_role', t.rel, 'DELETE');
  IF v_n <> 4 THEN
    RAISE EXCEPTION '正對照失敗:同一把尺問 service_role 的 DELETE 只回 % 格(期望 4)⇒ 上面那些 false 沒有判別力', v_n;
  END IF;

  -- ⑤ 沒動到別人:pcm_readonly 的 SELECT 仍 4(貼前實量 4)
  --    🔴 **[R4 F3]** `has_table_privilege('pcm_readonly',…)` 對【不存在的角色】會【拋錯】,
  --       而拋棄式 PG 只建 anon/authenticated/service_role/authenticator ⇒ harness 必炸。
  --       ⇒ 用 to_regrole 先問它在不在;不在就跳過並 NOTICE, **不要把「這台庫沒有那個角色」讀成「權限掉了」**。
  --       (同坑同解已有前例:20260901230000_m4b_pcmro1_revoke_customer_pii.sql:82,106)
  IF pg_catalog.to_regrole('pcm_readonly') IS NULL THEN
    RAISE NOTICE '[20260905260000] 🔵 這台庫沒有 pcm_readonly 角色 ⇒ 斷言⑤跳過(正式庫有, 拋棄式 PG 沒有)';
  ELSE
    SELECT pg_catalog.count(*) INTO v_n
      FROM (VALUES ('public.products_list_public'),('public.vehicle_taxonomy_public'),
                   ('public.products_public'),('public.product_variants_public')) t(rel)
     WHERE pg_catalog.has_table_privilege('pcm_readonly', t.rel, 'SELECT');
    IF v_n <> 4 THEN
      RAISE EXCEPTION '斷言⑤失敗:pcm_readonly 的 SELECT 只剩 % 格(期望 4)⇒ 唯讀查證那條路會斷', v_n;
    END IF;
  END IF;

  -- ⑥ 繼承路徑(§3.5)—— ⚠️ codex R2 nit①:只在【真的會把權限帶過來】時才擋,
  --    INHERIT FALSE 且 SET FALSE 的成員關係無害。貼前實量:anon/authenticated 零成員關係。
  SELECT pg_catalog.string_agg(m.member::regrole::text || '⇒' || m.roleid::regrole::text, ', ') INTO v_leak
    FROM pg_catalog.pg_auth_members m
   WHERE m.member IN (pg_catalog.to_regrole('anon'), pg_catalog.to_regrole('authenticated'))
     AND (m.inherit_option OR m.set_option);
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION '斷言⑥失敗:anon/authenticated 有【會帶權限過來】的成員關係 ⇒ % ⇒ 它們可能繞過本檔收掉的權限, 而①看不到這條路', v_leak;
  END IF;

  -- ⑦ 🔴🔴 **真實讀取 smoke(codex R3 MF②)** —— ACL 全綠 ≠ 顧客站讀得到。
  --    這一格【以 anon / authenticated 的身分真的讀一次】, 走的是與顧客站同一條權限路徑
  --    (schema USAGE + view SELECT + security_invoker 的底表 RLS)。
  --    🛑 它仍**證不到** PostgREST 那一層與網路那一層 —— 那要真的打一發顧客站。
  --    🔵 SET LOCAL 只在本交易有效;任一支讀不動就 RAISE ⇒ 整筆交易回復, 不會留半套。
  --    🔴 **[R4 F1]** ⛔ ~~`RESET ROLE`~~ —— `scripts/migration-reset-role-guard.sh` 明文禁止:
  --       supabase CLI 以 `cli_login_<ref>` 連線並 `SET SESSION ROLE postgres`, 而那個登入角色是
  --       **NOINHERIT** ⇒ `RESET ROLE` 讓 current_user 掉回 session_user, 而**帳本 INSERT 在 COMMIT 之後跑**
  --       ⇒ `permission denied for schema supabase_migrations`(#628 完整因果在那支 guard 檔頭)。
  --       ✅ 改法:迴圈前先存 `current_user`, 用 `SET LOCAL ROLE <存的>` 還原。
  --    🔴 **[R4 F11]** 而 `WHEN OTHERS` 把「SET ROLE 失敗 / 底表鎖 / 底表權限缺件」寫成同一句
  --       ⇒ 值班會查錯方向 ⇒ 訊息帶上 `SQLSTATE`。
  DECLARE
    r_rel  text;
    r_role text;
    v_me   text := current_user;
  BEGIN
    FOREACH r_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF pg_catalog.to_regrole(r_role) IS NULL THEN
        RAISE NOTICE '[20260905260000] 🔵 這台庫沒有 % 角色 ⇒ 該輪 smoke 跳過', r_role;
        CONTINUE;
      END IF;
      FOREACH r_rel IN ARRAY ARRAY['public.products_list_public','public.vehicle_taxonomy_public',
                                   'public.products_public','public.product_variants_public'] LOOP
        BEGIN
          EXECUTE pg_catalog.format('SET LOCAL ROLE %I', r_role);
          EXECUTE pg_catalog.format('SELECT 1 FROM %s LIMIT 1', r_rel);
          EXECUTE pg_catalog.format('SET LOCAL ROLE %I', v_me);
        EXCEPTION WHEN OTHERS THEN
          EXECUTE pg_catalog.format('SET LOCAL ROLE %I', v_me);
          RAISE EXCEPTION '斷言⑦失敗(真實讀取 smoke):以 % 的身分讀 % 讀不動 ⇒ SQLSTATE=% / % ⇒ 先看 SQLSTATE 再判是權限(42501)、鎖(55P03/57014)還是別的',
                          r_role, r_rel, SQLSTATE, SQLERRM;
        END;
      END LOOP;
    END LOOP;
  END;

    -- 🔵 **[R4 F7]** 下面這句原本把十二格並列成「全過」, 而它們【判別力不一樣】:
  --    會動的(貼前貼後不同):① ①b ①c ⑦
  --    貼前就已經是那個值的(不變量, 對「REVOKE 生效了沒」零判別力):②a ②b ②c ③ ④ ⑤ ⑥
  --    ⇒ 📌 把不變量與真訊號並列成一句「全過」, 會讓讀的人以為十二格都在證明同一件事。
  RAISE NOTICE '[20260905260000] 事後斷言全過 —— 🔵 會動的四格:①寫權 0 格 ①b ACL 恰 SELECT 且不可再授出 ①c 直接授權 8 列 ②a 有效 SELECT 8 格 ②b/②c 欄級雙尺 0 ③PUBLIC 0 ④正對照 service_role=4 ⑤pcm_readonly(這台庫有這個角色才驗, 沒有就跳過 —— 上面的 NOTICE 會說)⑦anon/authenticated 各真的讀過那四支;⚪ 不變量八格(②a②b②c③④⑤⑥ 貼前就是這個值))';
END $$;

COMMIT;
