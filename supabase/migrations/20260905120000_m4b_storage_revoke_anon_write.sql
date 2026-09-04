-- ═══════════════════════════════════════════════════════════════════════════
-- 收掉 `anon` / `authenticated` 對 `storage` 的【寫入與清空】權(保留 SELECT)
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴🔴 **草稿 —— 等 Sean 對 `Q-檔案儲存區權限` 拍甲才貼。板列 ⟦0e-STORAGEACL⟧。**
--
-- 為什麼:2026-09-05 唯讀實測 —— `storage` 底下 8 張表 **RLS 全開而 policy 全 0 條**,
--   而表級授權是開的:`anon` / `authenticated` 對 `buckets` · `buckets_analytics` · `objects`
--   都是 **SIUDT**(含 `TRUNCATE`)。
--   🛑 **而 RLS 不管 `TRUNCATE`** ⇒ 「有 RLS」對【清空整張表】那條路**零判別力**。
--   ⇒ 今天沒出事,是因為沒有人這樣打。
--
-- 🔵 **收掉不會弄壞上傳** —— 2026-09-05 兩面獨立實測:
--   ① 碼:`git archive origin/dev apps packages` 1661 支 `.ts`/`.tsx` 剝註解,
--      五個 API 形狀(`.storage.from(` `storage.from(` `createSignedUrl` `getPublicUrl` `.upload(`)⇒ **全樹 0**
--      (正對照同一套掃法:`createClient` 10 · `.from(` 188 · `FormData`/檔案輸入 119 ⇒ 非 0,尺會動)
--   ② 資料:`products` 25038 筆 / 25037 筆有圖,而 `images` 網域**全部是外部**,
--      指到自家 `/storage/v1/` 的 **0 張**。
--   ⚠️ **射程**:①只掃這棵樹的 `apps`+`packages`;**Edge Function、報價單那個 repo、
--      Sean 手動從 dashboard 上傳** 這三條路**沒掃**。②`packages/domain/src/catalog/types.ts`
--      有一句「上傳走 Supabase Storage 由 M-1-13 / M-1-16 落地」—— **那是計畫不是現況。**
--
-- 🛑🛑 **`storage` 是【平台管的 schema】** —— Supabase 升級可能**重新授權**,
--    而那條路**不經過我們任何一支 migration** ⇒ 這一片可能在某次平台升級後**安靜地失效**。
--    ✅ **怎麼偵測**:`scripts/acl-snapshot.sh` 的**第八族 `STORAGEACL`**(2026-09-05 加)
--       記 `storage` 8 張表 × 4 角色的 `SIUDT` + RLS + policy 數
--       ⇒ **平台把權限加回來,下一次跑快照就會叫。**
--    🔴 **而它只在有人跑快照時才叫** —— 那正是 `⟦b9-ACLDRIFT5⟧` 要解的另一件事。
--
-- 🔵 **本片【不收 SELECT】** —— 那是第二題:
--    `getPublicUrl` 全樹 0 ⇒ 大概沒有人用讀的,**而「大概」不是「沒有」**,
--    且公開 bucket 的讀取路徑不一定經過這幾張表。⇒ **要收 SELECT 要另外量一輪。**
--
-- ↩️ Rollback(貼下面這段就回到原狀):
--    GRANT INSERT, UPDATE, DELETE, TRUNCATE ON storage.buckets, storage.buckets_analytics, storage.objects TO anon, authenticated;
--    ⚠️ 而**原狀不是「所有表都一樣」** —— 只有這三張是 SIUDT,其餘五張本來就只有 SELECT 或沒有。
--       ⇒ 回滾只還這三張,不要對 8 張一起 GRANT(那會**放寬**到比原本更大)。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 前置閘 ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_tables text[] := ARRAY['buckets','buckets_analytics','objects']::text[];
  r text; v_oid oid; v_n int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname='storage') THEN
    RAISE EXCEPTION '前置閘①:schema storage 不存在 ⇒ 拒繼續';
  END IF;
  FOREACH r IN ARRAY v_tables LOOP
    -- 🔴 用 oid 不用名字 —— `has_table_privilege('anon','storage.x','SELECT')` 要先能
    --    USAGE 那個 schema, 而某些角色沒有 ⇒ 它會 RAISE 而不是回 false。
    --    📌 2026-09-05 我先用名字量, 得到一份【比實際小】的授權表(buckets 被讀成 S----)。
    SELECT c.oid INTO v_oid FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='storage' AND c.relname=r;
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '前置閘②:找不到 storage.% ⇒ 平台改過表名?拒繼續。', r;
    END IF;
    IF NOT pg_catalog.has_table_privilege('anon', v_oid, 'TRUNCATE') THEN
      RAISE EXCEPTION '前置閘③:storage.% 上 anon 【本來就沒有】TRUNCATE ⇒ 現況與我寫這一片時看到的不同, 停下來讓人看。', r;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  IF v_n <> 3 THEN
    RAISE EXCEPTION '前置閘④:檢查數是 %,不是釘住的 3 ⇒ 清單被動過, 拒繼續。', v_n;
  END IF;
  RAISE NOTICE '✅ 前置閘:3 張表都在, 而 anon 現在確實持有 TRUNCATE';
END $$;

-- ── 主路徑:只收寫入四權, SELECT 不動;service_role 一格不碰 ────────────
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON storage.buckets           FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON storage.buckets_analytics FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON storage.objects           FROM anon, authenticated;

-- ── 事後斷言 ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_tables text[] := ARRAY['buckets','buckets_analytics','objects']::text[];
  v_roles  text[] := ARRAY['anon','authenticated']::text[];
  r text; ro text; v_oid oid; v_bad int := 0; v_n int := 0;
BEGIN
  FOREACH r IN ARRAY v_tables LOOP
    SELECT c.oid INTO v_oid FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='storage' AND c.relname=r;
    FOREACH ro IN ARRAY v_roles LOOP
      v_n := v_n + 1;
      IF pg_catalog.has_table_privilege(ro, v_oid, 'INSERT')
         OR pg_catalog.has_table_privilege(ro, v_oid, 'UPDATE')
         OR pg_catalog.has_table_privilege(ro, v_oid, 'DELETE')
         OR pg_catalog.has_table_privilege(ro, v_oid, 'TRUNCATE') THEN
        v_bad := v_bad + 1;
        RAISE WARNING '事後斷言:storage.% 上 % 仍有寫入權', r, ro;
      END IF;
      -- 🔵 SELECT 必須【還在】—— 本片不收它, 收掉了就是我做過頭。
      IF NOT pg_catalog.has_table_privilege(ro, v_oid, 'SELECT') THEN
        v_bad := v_bad + 1;
        RAISE WARNING '事後斷言:storage.% 上 % 的 SELECT 【不見了】—— 本片不該收它', r, ro;
      END IF;
    END LOOP;
  END LOOP;
  IF v_n <> 6 THEN RAISE EXCEPTION '事後斷言:檢查數是 %,不是 6, 拒 COMMIT', v_n; END IF;
  IF v_bad > 0 THEN RAISE EXCEPTION '事後斷言失敗:% 項不符 ⇒ 拒 COMMIT', v_bad; END IF;

  -- 🔵 負對照:service_role 對 objects 的 TRUNCATE 必須【還在】——
  --    本片不動它;它若也沒了, 表示我收得比寫的寬。
  SELECT c.oid INTO v_oid FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='storage' AND c.relname='objects';
  IF NOT pg_catalog.has_table_privilege('service_role', v_oid, 'TRUNCATE') THEN
    RAISE EXCEPTION '🔴 負對照失敗:service_role 對 storage.objects 的 TRUNCATE 也被收掉了 ⇒ 本片只該收 anon/authenticated, 拒 COMMIT';
  END IF;
  RAISE NOTICE '✅ 事後斷言:3 表 × 2 角色 寫入權全收、SELECT 全在;而 service_role 一格未動';
END $$;

COMMIT;
