-- ═══════════════════════════════════════════════════════════════════════════
-- ⛔⛔ **作廢 —— 不要貼。留著是為了讓下一個想做同一件事的人少走一遍。**(2026-09-05)
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 **為什麼作廢:`postgres` 收不掉 `supabase_storage_admin` 給出去的權限。**
--    PG 的規則:REVOKE 只收得掉【你自己(或你所屬角色)給出去的】那些。
--
--    正式庫實測(2026-09-05 唯讀):
--      `storage.buckets` / `buckets_analytics` / `objects` 的 owner = `supabase_storage_admin`
--      ACL 的 grantor 也是它(`anon=arwdDxtm/supabase_storage_admin`)
--      `pg_has_role('postgres','supabase_storage_admin','MEMBER')` ⇒ **f**
--      `pg_roles.rolsuper` for `postgres`                        ⇒ **f**(只有 BYPASSRLS)
--    ⇒ 🛑 **Sean 在 SQL Editor 以 `postgres` 貼,這三行 REVOKE 一個都收不掉。**
--
--    拋棄式 PG 同形實證(表由 `storage_admin` 建、用一個非 superuser 非成員的角色 REVOKE):
--      `ERROR:  permission denied for table objects` ⇒ `anon` 的 TRUNCATE 仍是 **true**
--
-- 🔴🔴 **而我第一輪的拋棄式驗證是【假綠】,這一格比作廢本身值得記**:
--    我的 fixture 裡那些表是 **`postgres` 自己建的** ⇒ grantor 就是 `postgres` ⇒ REVOKE 當然成功。
--    📌 **fixture 與真實世界差的那一格,正好是這一片成立與否的那一格。**
--    ⇒ 我當時報的「貼前 SIUDT ⇒ 貼後 S----、兩發突變都殺得死」**每一個讀數都是真的**,
--      而它們證的是**另一個世界**。⇒ 🎯 **尺是好的,是【世界造錯了】。**
--
-- ⇒ 主視窗 2026-09-05 裁:走【丙】(上板記成平台管的殘餘風險)+【甲】進 Sean 佇列
--   (他去 dashboard / support 問那條路存不存在);**乙不做** —— 改用 RLS policy 擋
--   **解不掉這個洞**,因為 **`TRUNCATE` 不受 RLS 管**。
-- 📎 板列 `⟦0e-STORAGEACL⟧`。
-- ═══════════════════════════════════════════════════════════════════════════
-- (以下為原內容,零刪除)
-- ═══════════════════════════════════════════════════════════════════════════
-- 收掉 `anon` / `authenticated` 對 `storage` 的【寫入與清空】權(保留 SELECT)
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴🔴 **草稿 —— 等 Sean 對 `Q-檔案儲存區權限` 拍甲才貼。板列 `⟦0e-STORAGEACL⟧`。**
-- 🔵 codex 唯讀 R1 七條 must-fix,逐條處置寫在下面「R1 折法」那節。
--
-- 為什麼:2026-09-05 唯讀實測 —— `storage` 8 張表 **RLS 全開而 policy 全 0**,
--   而 `anon`/`authenticated` 對 **`buckets` · `buckets_analytics` · `objects`** 是 **SIUDT**。
--   🛑 **RLS 不管 `TRUNCATE`** ⇒ 「有 RLS」對【清空整張表】那條路零判別力。
--
-- ═══ 🔴🔴 R1-①【最重要,而它改變了這一片的賣點】═══════════════════════════
--   Supabase 的 **Storage API 是以 JWT 的 `anon`/`authenticated` 身分執行的**。
--   ⇒ 📌 **本片的正確描述不是「不會壞」,是:**
--        **「今天不會壞(今天沒有任何上傳路徑),而它讓【未來要做上傳】的那一天多一步:
--          得先把寫入權還給那兩個角色,否則 Storage API 會回 `42501`。」**
--   ⛔ ~~我 2026-09-05 寫的「收掉不會弄壞上傳」~~ —— **那句話只對【今天】成立,
--      而它讀起來像對未來也成立。**(codex R1 抓到;舊字面留著。)
--   🔵 而「今天沒有上傳路徑」那一半仍然是量到的:
--      碼 1661 支 `.ts`/`.tsx` 剝註解、五個 API 形狀全樹 **0**(正對照 `createClient` 10 ·
--      `.from(` 188 · `FormData` 119 ⇒ 尺會動);資料 `products` 25037/25038 有圖而
--      指向自家 `/storage/v1/` 的 **0 張**。
--   ⚠️ 射程:只掃這棵樹的 `apps`+`packages`;**Edge Function、報價單那個 repo、
--      Sean 手動從 dashboard 上傳** 這三條沒掃。
--
-- ═══ 🔴🔴 R1-②【第二嚴重:不修的話這一片會自己過期】═════════════════════
--   `storage` schema 上**有 default privileges**(2026-09-05 實測 `pg_default_acl`):
--      設定者 `postgres` · 物件類型 `r`(表)⇒ `anon=arwdDxtm` · `authenticated=arwdDxtm`
--      另有 `f`(函式)`=X` 與 `S`(序列)`=rwU`
--   ⇒ 📌 **由 `postgres` 在 `storage` 新建的每一張表,出生就自帶 `anon` 的寫入權。**
--   ⇒ 🛑 **只 REVOKE 現有三張 = 修了今天,而下一張新表把洞開回來。**
--   ✅ 本片一起收 default privileges(下面主路徑第 2 段)。
--   ⚠️ 而它**只收 `FOR ROLE postgres`** —— 平台若用 `supabase_storage_admin` 建表,
--      那一條 default ACL **本片看不到也收不掉**(實測今天沒有那一條)。
--
-- ═══ R1 折法(逐條)═══════════════════════════════════════════════════════
--   ① Storage API 以 anon 執行 ⇒ **改寫檔頭賣點**(上面),不改碼。
--   ② default privileges ⇒ **加一段 REVOKE**(主路徑第 2 段)+ 事後斷言。
--   ③ 欄級授權 `has_table_privilege` 看不到 ⇒ **加一格直接讀 `pg_attribute.attacl`**
--      (2026-09-05 實測今天 **0** 筆,而斷言不能靠「今天是 0」)。
--   ④ 權限來自 `PUBLIC` 時收不掉 ⇒ **加一格直接讀 `relacl` 找 `PUBLIC`**。
--      🔵 而 2026-09-05 實測:那三張的 ACL **全是具名授權**(`anon=arwdDxtm/supabase_storage_admin`),
--         **沒有 PUBLIC 那一項** ⇒ codex 講的世界今天不成立,**而斷言看不出來** ⇒ 仍然加。
--   ⑤⑥ 快照第八族少了 PUBLIC / `relacl` / owner / default ACL ⇒ **同一顆 commit 改 `acl-snapshot.sh`**。
--   ⑦ `service_role` 只驗一格 ⇒ **改成 3 表 × 4 權 全驗**。
--   nit-⑧ 前置閘只釘 `anon.TRUNCATE` ⇒ **兩個角色 × TRUNCATE + SELECT 都釘**。
--   nit-⑨ 註解寫「兩表」而實際三表 ⇒ **已改**(我自己也錯過同一格,見板列訂正)。
--
-- ↩️ Rollback:
--    GRANT INSERT, UPDATE, DELETE, TRUNCATE ON storage.buckets, storage.buckets_analytics, storage.objects TO anon, authenticated;
--    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO anon, authenticated;
--    ⚠️ **原狀不是「8 張都一樣」** —— 只有這三張是 SIUDT ⇒ 回滾只還這三張,
--       對 8 張一起 GRANT 會**放寬到比原本更大**。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 前置閘 ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_tables text[] := ARRAY['buckets','buckets_analytics','objects']::text[];
  v_roles  text[] := ARRAY['anon','authenticated']::text[];
  r text; ro text; v_oid oid; v_n int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname='storage') THEN
    RAISE EXCEPTION '前置閘①:schema storage 不存在 ⇒ 拒繼續';
  END IF;
  FOREACH r IN ARRAY v_tables LOOP
    -- 🔴 用 oid 不用名字 —— has_table_privilege('anon','storage.x',…) 要先能 USAGE 那個
    --    schema, 沒有的話它 RAISE 而不是回 false。2026-09-05 我先用名字量,
    --    得到一份【比實際小】的授權表(buckets 被讀成 S----, 實際 SIUDT)。
    SELECT c.oid INTO v_oid FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='storage' AND c.relname=r;
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '前置閘②:找不到 storage.% ⇒ 平台改過表名?拒繼續。', r;
    END IF;
    FOREACH ro IN ARRAY v_roles LOOP
      -- nit-⑧:兩個角色都釘, 而且 SELECT 也要在(本片不收它 ⇒ 它本來就該在)
      IF NOT pg_catalog.has_table_privilege(ro, v_oid, 'TRUNCATE') THEN
        RAISE EXCEPTION '前置閘③:storage.% 上 % 【本來就沒有】TRUNCATE ⇒ 現況與我寫這一片時看到的不同, 停下來讓人看。', r, ro;
      END IF;
      IF NOT pg_catalog.has_table_privilege(ro, v_oid, 'SELECT') THEN
        RAISE EXCEPTION '前置閘④:storage.% 上 % 沒有 SELECT ⇒ 現況與預期不同(本片不收 SELECT), 拒繼續。', r, ro;
      END IF;
      v_n := v_n + 1;
    END LOOP;
  END LOOP;
  IF v_n <> 6 THEN
    RAISE EXCEPTION '前置閘⑤:檢查數是 %,不是釘住的 6 ⇒ 清單被動過, 拒繼續。', v_n;
  END IF;
  RAISE NOTICE '✅ 前置閘:3 表 × 2 角色 都持有 TRUNCATE 與 SELECT';
END $$;

-- ── 主路徑 1:收現有三張表的寫入四權 ──────────────────────────────────────
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON storage.buckets           FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON storage.buckets_analytics FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON storage.objects           FROM anon, authenticated;

-- ── 主路徑 2:收 default privileges(R1-② —— 少了這段, 下一張新表把洞開回來)──
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon, authenticated;

-- ── 事後斷言 ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_tables text[] := ARRAY['buckets','buckets_analytics','objects']::text[];
  v_roles  text[] := ARRAY['anon','authenticated']::text[];
  v_privs  text[] := ARRAY['INSERT','UPDATE','DELETE','TRUNCATE']::text[];
  r text; ro text; pv text; v_oid oid; v_bad int := 0; v_n int := 0; v_acl text;
BEGIN
  FOREACH r IN ARRAY v_tables LOOP
    SELECT c.oid, COALESCE(c.relacl::text,'') INTO v_oid, v_acl
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='storage' AND c.relname=r;

    FOREACH ro IN ARRAY v_roles LOOP
      FOREACH pv IN ARRAY v_privs LOOP
        v_n := v_n + 1;
        IF pg_catalog.has_table_privilege(ro, v_oid, pv) THEN
          v_bad := v_bad + 1;
          RAISE WARNING '事後斷言:storage.% 上 % 仍有 %', r, ro, pv;
        END IF;
      END LOOP;
      -- SELECT 必須還在 —— 收掉了就是我做過頭
      IF NOT pg_catalog.has_table_privilege(ro, v_oid, 'SELECT') THEN
        v_bad := v_bad + 1;
        RAISE WARNING '事後斷言:storage.% 上 % 的 SELECT 不見了 —— 本片不該收它', r, ro;
      END IF;
    END LOOP;

    -- R1-④:has_table_privilege 看得到 PUBLIC 的授權而分不出來源
    --       ⇒ 直接讀 relacl 找 `=` 開頭那一項(PUBLIC 在 ACL 裡是空的 grantee)
    IF v_acl ~ '(^|,)=[a-zA-Z*]*[awdD]' THEN
      v_bad := v_bad + 1;
      RAISE WARNING '事後斷言:storage.% 的 ACL 裡有【PUBLIC】的寫入授權 ⇒ 本片的 REVOKE FROM anon 收不掉它', r;
    END IF;

    -- R1-③:表級 REVOKE 收不掉【欄級】授權, 而 has_table_privilege 也看不到
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                WHERE a.attrelid = v_oid AND a.attacl IS NOT NULL) THEN
      v_bad := v_bad + 1;
      RAISE WARNING '事後斷言:storage.% 有【欄級】授權 ⇒ 表級 REVOKE 收不掉, 要逐欄看', r;
    END IF;
  END LOOP;

  IF v_n <> 24 THEN RAISE EXCEPTION '事後斷言:檢查數是 %,不是 24(3 表 × 2 角色 × 4 權), 拒 COMMIT', v_n; END IF;

  -- R1-②:default privileges 也要收乾淨
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_default_acl d
      JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
     WHERE n.nspname='storage' AND d.defaclobjtype='r'
       AND d.defaclacl::text ~ '(anon|authenticated)=[a-zA-Z*]*[awdD]'
  ) THEN
    RAISE EXCEPTION '🔴 事後斷言:storage 的 default privileges 仍會給新表 anon/authenticated 寫入權 ⇒ 這一片會被下一張新表繞過, 拒 COMMIT';
  END IF;

  -- R1-⑦:service_role 一格不碰 —— 3 表 × 4 權 全驗, 不是只驗一格
  FOREACH r IN ARRAY v_tables LOOP
    SELECT c.oid INTO v_oid FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='storage' AND c.relname=r;
    FOREACH pv IN ARRAY v_privs LOOP
      IF NOT pg_catalog.has_table_privilege('service_role', v_oid, pv) THEN
        RAISE EXCEPTION '🔴 負對照失敗:service_role 對 storage.% 的 % 被收掉了 ⇒ 本片只該收 anon/authenticated, 拒 COMMIT', r, pv;
      END IF;
    END LOOP;
  END LOOP;

  IF v_bad > 0 THEN RAISE EXCEPTION '事後斷言失敗:% 項不符 ⇒ 拒 COMMIT', v_bad; END IF;
  RAISE NOTICE '✅ 事後斷言:24 格寫入權全收 · SELECT 全在 · 無 PUBLIC 寫入 · 無欄級授權 · default 已收 · service_role 12 格未動';
END $$;

COMMIT;
