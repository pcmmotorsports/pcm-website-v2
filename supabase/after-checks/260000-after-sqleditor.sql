-- 貼板對帳:20260905260000 ⟦b9-PUBLICVIEWALL⟧(唯讀, 貼完跑;誰跑 = 線 -db)
--
-- 🔴🔴 **本檔會【紅】,不是只印數字**(codex R1 MF①:舊版全檔零斷言 ——
--    REVOKE 完全沒生效時每一格照樣印它的預期值, 而 rc 仍是 0)。
--    ⇒ 整支包在一個 DO 區塊裡 RAISE EXCEPTION;唯讀、零寫入。
-- 🔴🔴 **這一支是【給 Supabase SQL Editor 貼】的版本 —— 零 psql meta-command**
--    (codex R2 MF①:`\set …` 貼進 SQL Editor 會在第一行報 syntax error, 整個 DO 不會執行)
--    ⇒ 📌 **要用 psql 跑請用隔壁那支 `260000-after.sql`(它多一行 \set ON_ERROR_STOP on)。**
--    ✅ **[codex R3 nit①]本支現在是【唯一一份】DO 區塊** —— 隔壁那支 psql 版改成
--       `\set ON_ERROR_STOP on` + `\ir 260000-after-sqleditor.sql`(`\ir` 相對【腳本自己】的目錄)
--       ⇒ 📌 **兩邊漂移在結構上不可能發生, 不再靠「註解約定 + 記得 diff」。**
-- 🔴 **在 SQL Editor 裡:成功 = 沒有紅色 + 最後一行 NOTICE;失敗 = 直接一段紅色 ERROR。**
-- 🔵 **它與 migration 的斷言刻意重疊**(codex R1 nit②指出重疊):migration 的斷言在那一筆交易裡跑,
--    本檔在【提交之後、另一條連線】跑 ⇒ 兩者答的是不同的問題。
--    真正只有本檔答得出的是 ⑦(全庫還有沒有別的)。
-- 🛑 **本檔證不到**:顧客站真的讀得到 —— 那要真的打一發顧客站。權限層綠 ≠ 頁面出得來。
--
-- 🔬 貼前基準(2026-09-05 16:4x -db 唯讀實量, 四支):
--    寫權格 32 · 有效 SELECT 8 · ACL 直接 SELECT 8 · PUBLIC 0 · grant option 0 · 欄級 ACL 0
--    service_role DELETE 4(正對照)· pcm_readonly SELECT 4 · pcm_readonly DELETE 0(負對照)

DO $$
DECLARE
  v_n    integer;
  v_leak text;
  c_rel  text[] := ARRAY['public.products_list_public','public.vehicle_taxonomy_public',
                         'public.products_public','public.product_variants_public'];
  c_name text[] := ARRAY['products_list_public','vehicle_taxonomy_public',
                         'products_public','product_variants_public'];
BEGIN
  -- ① 七種寫權(含 PG17 的 MAINTAIN):貼前 32 ⇒ 期望 0
  SELECT pg_catalog.string_agg(t.rel || '/' || r.rolname || '/' || p.priv, ', ') INTO v_leak
    FROM unnest(c_rel) t(rel)
    CROSS JOIN (VALUES ('anon'),('authenticated')) r(rolname)
    CROSS JOIN (VALUES ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),
                       ('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(priv)
   WHERE pg_catalog.has_table_privilege(r.rolname, t.rel, p.priv);
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION '① 失敗:anon/authenticated 還有寫權 ⇒ %', v_leak;
  END IF;

  -- ①b ACL 字面:權限集合恰為 SELECT,且不得帶 GRANT OPTION(codex R2 MF③)
  SELECT pg_catalog.string_agg(x.relname || '/' || x.rolname || '=' || x.privs
                               || CASE WHEN x.grantable THEN '(帶 GRANT OPTION)' ELSE '' END, ', ') INTO v_leak
    FROM (
      SELECT c.relname, a.grantee::regrole::text AS rolname,
             pg_catalog.string_agg(DISTINCT a.privilege_type, ',' ORDER BY a.privilege_type) AS privs,
             pg_catalog.bool_or(a.is_grantable) AS grantable
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
       WHERE n.nspname = 'public' AND c.relname = ANY(c_name)
         AND a.grantee IN (pg_catalog.to_regrole('anon'), pg_catalog.to_regrole('authenticated'))
       GROUP BY c.relname, a.grantee
    ) x
   WHERE x.privs <> 'SELECT' OR x.grantable;
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION '①b 失敗:ACL 上不是「恰好 SELECT 且不可再授出」⇒ %', v_leak;
  END IF;

  -- ②a 🟢 有效 SELECT 必須還在(貼前 8 ⇒ 期望 8)。這格紅 = 顧客站看不到商品/車款。
  SELECT pg_catalog.count(*) INTO v_n
    FROM unnest(c_rel) t(rel)
    CROSS JOIN (VALUES ('anon'),('authenticated')) r(rolname)
   WHERE pg_catalog.has_table_privilege(r.rolname, t.rel, 'SELECT');
  IF v_n <> 8 THEN
    RAISE EXCEPTION '②a 失敗:有效 SELECT 只剩 % 格(期望 8)⇒ 顧客站會壞', v_n;
  END IF;

  -- ②b ACL 上的直接 SELECT 授權 8 列(證明是直接授的, 不是繼承來的)
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
   WHERE n.nspname = 'public' AND c.relname = ANY(c_name)
     AND a.grantee IN (pg_catalog.to_regrole('anon'), pg_catalog.to_regrole('authenticated'))
     AND a.privilege_type = 'SELECT';
  IF v_n <> 8 THEN
    RAISE EXCEPTION '②b 失敗:ACL 上的直接 SELECT 只有 % 列(期望 8)', v_n;
  END IF;

  -- ③ 欄級:有效權限那把尺 0 格 + 欄級 ACL 本體 0 個(兩把尺問的是不同的事)
  SELECT pg_catalog.string_agg(t.rel || '/' || r.rolname || '/' || p.priv, ', ') INTO v_leak
    FROM unnest(c_rel) t(rel)
    CROSS JOIN (VALUES ('anon'),('authenticated')) r(rolname)
    CROSS JOIN (VALUES ('INSERT'),('UPDATE'),('REFERENCES')) p(priv)
   WHERE pg_catalog.has_any_column_privilege(r.rolname, t.rel, p.priv);
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION '③ 失敗:任一欄仍有寫類有效權限 ⇒ %', v_leak;
  END IF;
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_attribute att
    JOIN pg_catalog.pg_class c ON c.oid = att.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = ANY(c_name) AND att.attacl IS NOT NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '③b 失敗:有 % 個欄帶欄級 ACL(貼前實量 0)', v_n;
  END IF;

  -- ④ PUBLIC 表級 + 欄級都仍是 0
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
   WHERE n.nspname = 'public' AND c.relname = ANY(c_name) AND a.grantee = 0;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '④ 失敗:PUBLIC 有 % 筆表級授權', v_n;
  END IF;

  -- ⑤a 🟢 正對照:service_role 的 DELETE 仍 4(若為 0, 上面那些「收乾淨了」沒有判別力)
  SELECT pg_catalog.count(*) INTO v_n
    FROM unnest(c_rel) t(rel)
   WHERE pg_catalog.has_table_privilege('service_role', t.rel, 'DELETE');
  IF v_n <> 4 THEN
    RAISE EXCEPTION '⑤a 失敗(也是正對照):service_role 的 DELETE 只剩 % 格(期望 4)', v_n;
  END IF;

  -- ⑤b 沒動到別人:pcm_readonly 的 SELECT 仍 4
  --    🔴 **[R4 F3]** has_table_privilege 對【不存在的角色】會拋錯, 而拋棄式 PG 沒有 pcm_readonly
  --       ⇒ 先用 to_regrole 問它在不在;不在就跳過, **不要把「這台庫沒那個角色」讀成「權限掉了」**。
  IF pg_catalog.to_regrole('pcm_readonly') IS NULL THEN
    RAISE NOTICE '🔵 這台庫沒有 pcm_readonly 角色 ⇒ ⑤b 與 ⑧ 跳過(正式庫有, 拋棄式 PG 沒有)';
  ELSE
    SELECT pg_catalog.count(*) INTO v_n
      FROM unnest(c_rel) t(rel)
     WHERE pg_catalog.has_table_privilege('pcm_readonly', t.rel, 'SELECT');
    IF v_n <> 4 THEN
      RAISE EXCEPTION '⑤b 失敗:pcm_readonly 的 SELECT 只剩 % 格(期望 4)', v_n;
    END IF;
    SELECT pg_catalog.count(*) INTO v_n
      FROM unnest(c_rel) t(rel)
     WHERE pg_catalog.has_table_privilege('pcm_readonly', t.rel, 'DELETE');
    IF v_n <> 0 THEN
      RAISE EXCEPTION '⑧ 負對照失敗:pcm_readonly 竟然有 % 格 DELETE(期望 0)', v_n;
    END IF;
  END IF;

  -- ⑥ 繼承路徑:只在【真的會帶權限過來】時才擋(inherit_option 或 set_option 為真)
  SELECT pg_catalog.string_agg(m.member::regrole::text || '⇒' || m.roleid::regrole::text, ', ') INTO v_leak
    FROM pg_catalog.pg_auth_members m
   WHERE m.member IN (pg_catalog.to_regrole('anon'), pg_catalog.to_regrole('authenticated'))
     AND (m.inherit_option OR m.set_option);
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION '⑥ 失敗:它們有會帶權限過來的成員關係 ⇒ %', v_leak;
  END IF;

  -- ⑦ 🔴 只有本檔答得出的那一格:**全庫**(不限 public)還有沒有別的 view 對 anon 開著寫權。
  --    ⚠️ codex R1 MF⑨:舊版讀 ACL 字面卻宣稱有效權限 ⇒ 已改用 has_table_privilege。
  --    ⚠️ codex R2 MF④:舊版寫「全庫」卻只掃 public ⇒ 已改掃所有非系統 schema。
  --    🛑 **平台管的 schema 排除**(net / storage / auth / realtime / graphql*):
  --       那些是 supabase_storage_admin 等角色授出去的, **postgres 物理上收不掉**
  --       ⇒ 把它們算進來會讓這一格【永遠紅】, 而一道永遠紅的閘會被整支刪掉。
  --       🔬 2026-09-05 16:4x 實量:net._http_response · net.http_request_queue ·
  --          storage.buckets / buckets_analytics / objects 對 anon 有 MAINTAIN ⇒ 已知、不碰。
  --    ⚠️ has_table_privilege 不合併 schema 的 USAGE ⇒ 這一格答「ACL 上有沒有」,
  --       不答「anon 到不到得了」。(實量:anon 對 8 個 schema 有 USAGE, public 在內。)
  -- 🔴 codex R3 MF①:舊版只掃 anon ⇒ 明天若只有 authenticated 拿到寫權, 整支仍全綠。兩個都掃。
  -- 🔴 codex R3 nit②:註解寫排除 graphql*, 而 SQL 只列兩個固定名字 ⇒ 平台新增 graphql_xxx 時會突然恆紅。
  --    ⇒ 改成 pattern, 讓字面與實際政策一致。
  SELECT pg_catalog.string_agg(n.nspname || '.' || c.relname || '/' || r.rolname || '/' || p.priv, ', ') INTO v_leak
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN (VALUES ('anon'),('authenticated')) r(rolname)
    CROSS JOIN (VALUES ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),
                       ('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(priv)
   WHERE c.relkind IN ('v','m')   -- 🔴 [R4 F14] 原本只掃 'v', 物化檢視 'm' 一樣是 view 一族
     AND n.nspname NOT LIKE 'pg\_%'
     AND n.nspname NOT LIKE 'graphql%'
     AND n.nspname NOT IN ('information_schema','net','storage','auth','realtime','extensions','vault','cron','supabase_migrations')
     AND pg_catalog.has_table_privilege(r.rolname, c.oid, p.priv);
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION '⑦ 失敗:還有 view 對 anon/authenticated 開著寫權 ⇒ %(貼前實量:恰這四支, anon+authenticated 共 32 格)', v_leak;
  END IF;

  -- ⑧ 🔵 負對照已併進 ⑤b 那個 IF 裡(同一個角色存在性前提)——
  --    🔵 ⑤a 是它的另一半:同一把尺對 service_role 印 true。**兩半合起來才證明尺會動。**

  RAISE NOTICE '✅ 260000 對帳全過(①寫權 0 ①b ACL 恰 SELECT 且不可再授出 ②a/②b SELECT 8+8 ③欄級雙尺 0 ④PUBLIC 0 ⑤a 正對照 4 ⑤b/⑧ pcm_readonly(這台庫有這個角色才驗;沒有就跳過, 上面的 NOTICE 會說)⑥零可繼承成員 ⑦全庫 0)';
END $$;
