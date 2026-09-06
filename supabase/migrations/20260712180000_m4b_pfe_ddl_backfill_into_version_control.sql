-- 20260712180000_m4b_pfe_ddl_backfill_into_version_control.sql
-- pcm:idempotent: yes
--   依據(量到的, 不是宣稱):2026-09-07 拋棄式 PG 17.10, 對【本版】連貼三次 ——
--     第 2、3 次 rc=0, 六個讀數逐字不變:
--       表 3 · 函式 3 · 約束 16 · policy 4 · 約束定義 md5 4e9de8c0… · ACL 集合 md5 cc1681b9…
--   🔵 **正對照**(證守衛不是恆跳過):刻意 DROP 掉 sync_log 那條 policy ⇒ policy 4 ⇒ 3,
--     再貼一次 ⇒ **回到 4** ⇒ 缺了會補、在的不動。
--   🔴 **負對照**(證這把尺會分辨):同一發 DROP 之後量, 第四個數確實由 4 變 3。
--   🛑 **它答不出什麼**:①拋棄式 PG 沒有 `pcm_readonly` 這個角色 ⇒ ACL 那個 md5 的分母比正式庫少一個
--     ②「冪等」講的是**重跑安全**, 不是「什麼都不做」—— 權限那一段每次都會重寫 ACL(結果相同), 見下方逐段說明。
-- ============================================================================
-- `#299` + `⟦b4-PFEREPLAY1⟧`:三張 fitments 表與三支函式【補進版控】
-- ============================================================================
-- 🔴🔴 **本檔的版號在【過去】, 而它是今天才被 apply 的 —— 那是【故意的】。**
--   第一個【讀】`product_fitments_effective` 的是 `20260712183000_products_catalog_page_public.sql`
--   (讀它的共 11 支)。建表若排在讀者之後, **空庫重放照樣炸** ⇒ 版號必須早於 `20260712183000`。
--   🛑 代價:`supabase/APPLIED.tsv` 的時序不變式被打破。
--   ✅ 授權:Sean 逐字(`~/pcm-mailbox/端Sean-0905早上佇列.md` 21:58)「q9: 甲 / q10 甲」
--      ⇒ Q9 = 補版控、Q10 = 可以動帳本。plan =
--      `docs/plans/2026-09-06-299-fitments-ddl-into-version-control-plan.md`
--
-- 🔴🔴 **【它對正式庫做什麼】—— 逐段講,不要用「no-op」一個詞帶過**
--   ⛔ ~~本檔對正式庫是 no-op、已存在就什麼都不做~~
--   **2026-09-06 codex 對抗審查 R1 打掉這句話, 而它是對的。**留刪除線, 讓引用舊句的人撞到訂正。
--   逐段的真實行為(物件都已存在的世界):
--     · `CREATE TABLE IF NOT EXISTS`      ⇒ 真的不做事
--     · 約束 / policy / RLS / **索引**    ⇒ 先查目錄再決定 ⇒ 不做事、**也不拿鎖**
--       🔴 索引那一段本來寫 `CREATE INDEX IF NOT EXISTS` —— 它會【先拿表的 ShareLock 才發現已存在】
--         ⇒ 對正式庫不是「無影響跳過」, 而配上本檔的 `lock_timeout=5s` 它可能**直接讓貼失敗**。
--     · **函式**                          ⇒ 已存在且定義 md5 相符 ⇒ **跳過**;
--       md5 不符 ⇒ **RAISE 停下**(不覆蓋)。🔴 原本用 `CREATE OR REPLACE`, 而那**一定會更新 `pg_proc`**,
--       更毒的一半是**它會覆蓋掉「我抽取之後、你貼進去之前」別人做的修改**。
--     · **權限**                          ⇒ 🔴 **這一段會【重寫】ACL, 它不是不動。**
--       理由:空庫世界裡 PCM shim 先替 anon/authenticated 預授了表的 ALL、新函式另有 PUBLIC EXECUTE
--       ⇒ **只 GRANT 會讓新環境比正式庫【寬】**(含不受 RLS 管的 TRUNCATE)⇒ REVOKE 與 GRANT 成對且 REVOKE 先。
--       ⇒ 📌 它保證的是**結果等於正式庫的 ACL**, 不是「一個字都沒寫」。
--       🔴🔴 **而「貼前貼後逐字相同」這句話是【錯的】**(2026-09-06 R2 fable must-fix F1)——
--         `REVOKE ALL … FROM anon, authenticated` 之後再 `GRANT SELECT`,
--         PG 會把那兩個 grantee **從陣列中間刪掉、再附加到尾端** ⇒ `relacl::text` 一定不同。
--         ⇒ 66b 第 4 格因此改成**排序後的集合**比對(順序不進判準)。
--         🔬 而我本機那一發「ACL 逐字對齊」**沒有判別力** —— 本機沒有 `pcm_readonly`,
--           anon/authenticated 本來就在尾端 ⇒ 刪掉再附加位置不變 ⇒ 兩個世界印同一個東西。
--
-- 🔬 **定義從哪來(不是照抄存檔)**:2026-09-06 從正式庫唯讀讀回 ——
--    欄位 `information_schema.columns` / 約束 `pg_get_constraintdef` / 索引 `pg_indexes.indexdef` /
--    函式 `pg_get_functiondef`(三支 md5 釘在產生器與本檔的守衛裡)/ 權限 `pg_class.relacl` 與 `pg_proc.proacl`。
--    ⛔ ~~照 `docs/archive/…/2026-07-12-s1-apply-sql.sql` 抄~~ —— 那份是 2026-07-12 的,
--    實查發現 `_staging` 多一欄 `run_id`、`_sync_log` 十欄與存檔完全不同 ⇒ **照抄會建錯表。**
--    🔴 **權限不用 `information_schema.role_table_grants`** —— 它只看得到【本角色看得到的】,
--    我用它時只印得出 `pcm_readonly` 一列, 而 `relacl` 印出 anon / authenticated / service_role。
--
-- 🔴 **`storefront_fitments_v` 不在本檔** —— 它與依賴的 `product_groups_v` 是**報價單庫**的物件,
--    一直在 `~/API大量上架/PCM報價單-V2` 的版控裡。抄過來 = 把別人家的東西餵進我們家的庫。
--
-- 🛠 **本檔是【產生的】, 不是手寫的** —— 產生器 `scratchpad/gen-299.py`(交件時附在貼板旁)。
--    改東西改產生器, 不要改這支;手改會在下一次重產時消失。
-- ============================================================================

BEGIN;

-- 🔴 鎖超時:空庫世界會真的建表、開 RLS(AEL)。正式庫世界下面每一段都先查目錄 ⇒ 不會去拿那些鎖。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';


-- 表:🔴 **不用 `CREATE TABLE IF NOT EXISTS`** —— `scripts/migration-static-checks.sh` 規則①
--   逐字「CREATE … IF NOT EXISTS 一律禁」。而它**明文放行** plpgsql 的 `IF NOT EXISTS (SELECT …)`
--   (規則① 註解:「原版②:只找裸字面 ⇒ 抓到 plpgsql 的 IF NOT EXISTS(SELECT …)(條件判斷, 不是 DDL)」)
--   ⇒ 改成 DO 守衛 + EXECUTE, 裡面仍是**裸 `CREATE TABLE`**。
--   🔬 我第一版用了 IF NOT EXISTS 而**報出「rc=0 全綠」** —— 那是假綠:
--     `echo "$(basename $F) rc=$?"` 裡的命令替換把 `$?` 覆寫掉了。真值是 rc=1。
DO $tblguard$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                  WHERE n.nspname='public' AND c.relname='product_fitments_effective' AND c.relkind='r') THEN
    EXECUTE $tbl$CREATE TABLE public.product_fitments_effective (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id        uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  moto_brand        text NOT NULL,
  model_code        text NOT NULL,
  year_start        integer,
  year_end          integer,
  match_source      text NOT NULL,
  source_model_code text NOT NULL
)$tbl$;
  END IF;
END $tblguard$;
DO $tblguard$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                  WHERE n.nspname='public' AND c.relname='product_fitments_effective_staging' AND c.relkind='r') THEN
    EXECUTE $tbl$CREATE TABLE public.product_fitments_effective_staging (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id        uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  moto_brand        text NOT NULL,
  model_code        text NOT NULL,
  year_start        integer,
  year_end          integer,
  match_source      text NOT NULL,
  source_model_code text NOT NULL,
  run_id            uuid NOT NULL
)$tbl$;
  END IF;
END $tblguard$;
DO $tblguard$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                  WHERE n.nspname='public' AND c.relname='product_fitments_effective_sync_log' AND c.relkind='r') THEN
    EXECUTE $tbl$CREATE TABLE public.product_fitments_effective_sync_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ran_at       timestamptz NOT NULL DEFAULT now(),
  status       text NOT NULL,
  source_rows  integer,
  staged_rows  integer,
  orphan_rows  integer,
  old_count    integer,
  new_count    integer,
  note         text,
  run_id       uuid
)$tbl$;
  END IF;
END $tblguard$;

-- 約束:`ADD CONSTRAINT` 沒有 IF NOT EXISTS ⇒ 逐條先問 pg_constraint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
                  JOIN pg_namespace n ON n.oid=r.relnamespace
                 WHERE n.nspname='public' AND r.relname='product_fitments_effective' AND c.conname='pfe_match_source_valid') THEN
    ALTER TABLE public.product_fitments_effective ADD CONSTRAINT pfe_match_source_valid CHECK ((match_source = ANY (ARRAY['direct'::text, 'inherited'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
                  JOIN pg_namespace n ON n.oid=r.relnamespace
                 WHERE n.nspname='public' AND r.relname='product_fitments_effective' AND c.conname='pfe_nonblank_valid') THEN
    ALTER TABLE public.product_fitments_effective ADD CONSTRAINT pfe_nonblank_valid CHECK (((btrim(moto_brand) <> ''::text) AND (btrim(model_code) <> ''::text) AND (btrim(source_model_code) <> ''::text)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
                  JOIN pg_namespace n ON n.oid=r.relnamespace
                 WHERE n.nspname='public' AND r.relname='product_fitments_effective' AND c.conname='pfe_provenance_valid') THEN
    ALTER TABLE public.product_fitments_effective ADD CONSTRAINT pfe_provenance_valid CHECK ((((match_source = 'direct'::text) AND (source_model_code = model_code)) OR ((match_source = 'inherited'::text) AND (source_model_code <> model_code))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
                  JOIN pg_namespace n ON n.oid=r.relnamespace
                 WHERE n.nspname='public' AND r.relname='product_fitments_effective' AND c.conname='pfe_year_interval_valid') THEN
    ALTER TABLE public.product_fitments_effective ADD CONSTRAINT pfe_year_interval_valid CHECK (((year_start IS NULL) OR (year_end IS NULL) OR (year_end >= year_start)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
                  JOIN pg_namespace n ON n.oid=r.relnamespace
                 WHERE n.nspname='public' AND r.relname='product_fitments_effective' AND c.conname='pfe_year_state_valid') THEN
    ALTER TABLE public.product_fitments_effective ADD CONSTRAINT pfe_year_state_valid CHECK (((year_start IS NOT NULL) OR (year_end IS NULL)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
                  JOIN pg_namespace n ON n.oid=r.relnamespace
                 WHERE n.nspname='public' AND r.relname='product_fitments_effective_staging' AND c.conname='pfes_match_source_valid') THEN
    ALTER TABLE public.product_fitments_effective_staging ADD CONSTRAINT pfes_match_source_valid CHECK ((match_source = ANY (ARRAY['direct'::text, 'inherited'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
                  JOIN pg_namespace n ON n.oid=r.relnamespace
                 WHERE n.nspname='public' AND r.relname='product_fitments_effective_staging' AND c.conname='pfes_nonblank_valid') THEN
    ALTER TABLE public.product_fitments_effective_staging ADD CONSTRAINT pfes_nonblank_valid CHECK (((btrim(moto_brand) <> ''::text) AND (btrim(model_code) <> ''::text) AND (btrim(source_model_code) <> ''::text)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
                  JOIN pg_namespace n ON n.oid=r.relnamespace
                 WHERE n.nspname='public' AND r.relname='product_fitments_effective_staging' AND c.conname='pfes_provenance_valid') THEN
    ALTER TABLE public.product_fitments_effective_staging ADD CONSTRAINT pfes_provenance_valid CHECK ((((match_source = 'direct'::text) AND (source_model_code = model_code)) OR ((match_source = 'inherited'::text) AND (source_model_code <> model_code))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
                  JOIN pg_namespace n ON n.oid=r.relnamespace
                 WHERE n.nspname='public' AND r.relname='product_fitments_effective_staging' AND c.conname='pfes_year_interval_valid') THEN
    ALTER TABLE public.product_fitments_effective_staging ADD CONSTRAINT pfes_year_interval_valid CHECK (((year_start IS NULL) OR (year_end IS NULL) OR (year_end >= year_start)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
                  JOIN pg_namespace n ON n.oid=r.relnamespace
                 WHERE n.nspname='public' AND r.relname='product_fitments_effective_staging' AND c.conname='pfes_year_state_valid') THEN
    ALTER TABLE public.product_fitments_effective_staging ADD CONSTRAINT pfes_year_state_valid CHECK (((year_start IS NOT NULL) OR (year_end IS NULL)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
                  JOIN pg_namespace n ON n.oid=r.relnamespace
                 WHERE n.nspname='public' AND r.relname='product_fitments_effective_sync_log' AND c.conname='product_fitments_effective_sync_log_status_check') THEN
    ALTER TABLE public.product_fitments_effective_sync_log ADD CONSTRAINT product_fitments_effective_sync_log_status_check CHECK ((status = ANY (ARRAY['success'::text, 'abort'::text])));
  END IF;
END $$;

-- 索引:🔴 **先查目錄再建, 不用 `CREATE INDEX IF NOT EXISTS`**(codex R1 must-fix ②)——
--   後者會【先拿表的 ShareLock 才發現已存在】⇒ 對正式庫不是無影響跳過, 而本檔設了 lock_timeout=5s
--   ⇒ 它可能在一個「什麼都不用做」的世界裡把整支貼弄失敗。
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                 WHERE n.nspname='public' AND c.relname='ix_pfe_lookup' AND c.relkind='i') THEN
    EXECUTE $ix$CREATE INDEX ix_pfe_lookup ON public.product_fitments_effective USING btree (moto_brand, model_code, year_start, year_end)$ix$;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                 WHERE n.nspname='public' AND c.relname='ix_pfe_product' AND c.relkind='i') THEN
    EXECUTE $ix$CREATE INDEX ix_pfe_product ON public.product_fitments_effective USING btree (product_id)$ix$;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                 WHERE n.nspname='public' AND c.relname='ux_pfe_row' AND c.relkind='i') THEN
    EXECUTE $ix$CREATE UNIQUE INDEX ux_pfe_row ON public.product_fitments_effective USING btree (product_id, moto_brand, model_code, year_start, year_end, match_source) NULLS NOT DISTINCT$ix$;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                 WHERE n.nspname='public' AND c.relname='ux_pfes_row' AND c.relkind='i') THEN
    EXECUTE $ix$CREATE UNIQUE INDEX ux_pfes_row ON public.product_fitments_effective_staging USING btree (product_id, moto_brand, model_code, year_start, year_end, match_source) NULLS NOT DISTINCT$ix$;
  END IF;
END $$;

-- RLS:先問再開 ⇒ 正式庫上這一段不會執行, 也就不會去拿 AEL
DO $$ BEGIN
  IF NOT (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relname='product_fitments_effective') THEN
    ALTER TABLE public.product_fitments_effective ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relname='product_fitments_effective_staging') THEN
    ALTER TABLE public.product_fitments_effective_staging ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relname='product_fitments_effective_sync_log') THEN
    ALTER TABLE public.product_fitments_effective_sync_log ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Policy:先問再建(不用 DROP+CREATE —— 那對正式庫不是 no-op)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='product_fitments_effective' AND policyname='product_fitments_effective_select_public') THEN
    CREATE POLICY product_fitments_effective_select_public ON public.product_fitments_effective FOR SELECT TO public USING (EXISTS ( SELECT 1 FROM public.products p WHERE ((p.id = product_fitments_effective.product_id) AND (p.delisted_at IS NULL))));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='product_fitments_effective' AND policyname='product_fitments_effective_select_service_role') THEN
    CREATE POLICY product_fitments_effective_select_service_role ON public.product_fitments_effective FOR SELECT TO service_role USING (true);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='product_fitments_effective_staging' AND policyname='product_fitments_effective_staging_select_service_role') THEN
    CREATE POLICY product_fitments_effective_staging_select_service_role ON public.product_fitments_effective_staging FOR SELECT TO service_role USING (true);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='product_fitments_effective_sync_log' AND policyname='product_fitments_effective_sync_log_select_service_role') THEN
    CREATE POLICY product_fitments_effective_sync_log_select_service_role ON public.product_fitments_effective_sync_log FOR SELECT TO service_role USING (true);
  END IF;
END $$;

-- 函式:🔴 **不用 `CREATE OR REPLACE` 裸打**(codex R1 must-fix ③)——
--   那一定會更新 `pg_proc`、重建相依紀錄, 而更毒的一半是:
--   📌 **它會覆蓋掉「定義被抽出來之後、這一支被貼進去之前」別人做的修改。**
--   ⇒ 已存在且 md5 相符 ⇒ 跳過;md5 不符 ⇒ **RAISE 停下來給人看**, 不自作主張覆蓋。
--   ⚠️ 定義字串本身含 `$function$` ⇒ 外層用不同的 tag。
DO $fnguard$
DECLARE v_oid oid; v_md5 text;
BEGIN
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='search_products_by_vehicle' AND p.pronargs=3;
  IF v_oid IS NULL THEN
    EXECUTE $fndef$CREATE OR REPLACE FUNCTION public.search_products_by_vehicle(p_brand text, p_model text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer)
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH matched AS (
    SELECT product_id FROM public.product_fitments
     WHERE moto_brand = p_brand
       AND (p_model IS NULL OR model_code = p_model)
       AND (p_year  IS NULL OR ((year_start IS NULL OR year_start <= p_year)
                            AND (year_end   IS NULL OR year_end   >= p_year)))
    UNION
    SELECT product_id FROM public.product_fitments_effective
     WHERE moto_brand = p_brand
       AND (p_model IS NULL OR model_code = p_model)
       AND (p_year  IS NULL OR ((year_start IS NULL OR year_start <= p_year)
                            AND (year_end   IS NULL OR year_end   >= p_year)))
  )
  SELECT jsonb_build_object(
    'id', p.id, 'external_id', p.external_id, 'title', p.title, 'subtitle', p.subtitle,
    'description', p.description, 'highlights', p.highlights, 'manuals', p.manuals,
    'video_url', p.video_url, 'handle', p.handle, 'fitments', p.fitments,
    'images', p.images, 'availability', p.availability,
    'brand_id', p.brand_id, 'category_id', p.category_id, 'price_general', p.price_general,
    'created_at', p.created_at, 'updated_at', p.updated_at,
    'brands', jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug,
                                 'premium_extra_pct', b.premium_extra_pct),
    'categories', jsonb_build_object('raw_path', c.raw_path, 'segments', c.segments)
  )
  FROM public.products_public p
  JOIN matched      m ON m.product_id = p.id
  JOIN public.brands     b ON b.id = p.brand_id
  JOIN public.categories c ON c.id = p.category_id
  ORDER BY p.id;
$function$$fndef$;
  ELSE
    v_md5 := md5(pg_get_functiondef(v_oid));
    IF v_md5 <> 'f8564540b34b526b9b3ba0de9a5d989d' THEN
      RAISE EXCEPTION '公用函式 public.search_products_by_vehicle 已存在而定義與本檔釘住的不同(現況 md5=%, 本檔期望=f8564540b34b526b9b3ba0de9a5d989d)。這支是【補版控】不是【改函式】⇒ 停下來給人判, 不覆蓋。', v_md5;
    END IF;
  END IF;
END $fnguard$;
DO $fnguard$
DECLARE v_oid oid; v_md5 text;
BEGIN
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='pfe_staging_reset' AND p.pronargs=0;
  IF v_oid IS NULL THEN
    EXECUTE $fndef$CREATE OR REPLACE FUNCTION public.pfe_staging_reset()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_deleted int;
BEGIN
  PERFORM pg_advisory_xact_lock(74211231);
  -- WHERE true: PostgREST 連線掛 safeupdate、擋無 WHERE 的 DELETE(21000)
  WITH del AS (DELETE FROM public.product_fitments_effective_staging WHERE true RETURNING 1)
  SELECT count(*)::int INTO v_deleted FROM del;
  RETURN v_deleted;
END;
$function$$fndef$;
  ELSE
    v_md5 := md5(pg_get_functiondef(v_oid));
    IF v_md5 <> 'f8d6e8335ade88a02943f0f307dd0ad0' THEN
      RAISE EXCEPTION '公用函式 public.pfe_staging_reset 已存在而定義與本檔釘住的不同(現況 md5=%, 本檔期望=f8d6e8335ade88a02943f0f307dd0ad0)。這支是【補版控】不是【改函式】⇒ 停下來給人判, 不覆蓋。', v_md5;
    END IF;
  END IF;
END $fnguard$;
DO $fnguard$
DECLARE v_oid oid; v_md5 text;
BEGIN
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='pfe_sync_commit' AND p.pronargs=5;
  IF v_oid IS NULL THEN
    EXECUTE $fndef$CREATE OR REPLACE FUNCTION public.pfe_sync_commit(p_run_id uuid, p_source_rows integer, p_orphan_rows integer, p_allow_anomaly boolean DEFAULT false, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '300s'
AS $function$
DECLARE
  v_old int;
  v_new int;
  v_foreign int;
  rec record;
BEGIN
  PERFORM pg_advisory_xact_lock(74211231);
  SELECT count(*) INTO v_old FROM public.product_fitments_effective;
  SELECT count(*), count(*) FILTER (WHERE run_id <> p_run_id)
    INTO v_new, v_foreign
  FROM public.product_fitments_effective_staging;
  IF v_new = 0 THEN
    RAISE EXCEPTION 'pfe_sync_commit: staging empty, refuse swap (keep old % rows)', v_old;
  END IF;
  IF v_foreign > 0 THEN
    RAISE EXCEPTION 'pfe_sync_commit: staging has % rows from another run, refuse swap (concurrent sync?)', v_foreign;
  END IF;
  IF v_old > 0 AND v_new < v_old AND (v_old - v_new)::numeric / v_old > 0.10 AND NOT p_allow_anomaly THEN
    RAISE EXCEPTION 'pfe_sync_commit: shrink % -> % exceeds 10 pct, refuse swap (pass allow_anomaly after verifying source)', v_old, v_new;
  END IF;
  IF v_old > 0 AND v_new > v_old * 2 AND NOT p_allow_anomaly THEN
    RAISE EXCEPTION 'pfe_sync_commit: growth % -> % exceeds 2x, refuse swap (pass allow_anomaly after verifying source)', v_old, v_new;
  END IF;
  FOR rec IN
    SELECT p.supplier_slug,
           count(*) FILTER (WHERE x.src = 'old') AS old_cnt,
           count(*) FILTER (WHERE x.src = 'new') AS new_cnt
    FROM (
      SELECT product_id, 'old'::text AS src FROM public.product_fitments_effective
      UNION ALL
      SELECT product_id, 'new'::text FROM public.product_fitments_effective_staging
    ) x
    JOIN public.products p ON p.id = x.product_id
    GROUP BY p.supplier_slug
    HAVING count(*) FILTER (WHERE x.src = 'old') > 0
       AND count(*) FILTER (WHERE x.src = 'new') = 0
  LOOP
    IF NOT p_allow_anomaly THEN
      RAISE EXCEPTION 'pfe_sync_commit: supplier % effective rows % -> 0, refuse swap (supplier vanished from source view?)', rec.supplier_slug, rec.old_cnt;
    END IF;
  END LOOP;
  -- WHERE true: PostgREST 連線掛 safeupdate、擋無 WHERE 的 DELETE(21000)
  DELETE FROM public.product_fitments_effective WHERE true;
  INSERT INTO public.product_fitments_effective
    (product_id, moto_brand, model_code, year_start, year_end, match_source, source_model_code)
  SELECT product_id, moto_brand, model_code, year_start, year_end, match_source, source_model_code
  FROM public.product_fitments_effective_staging;
  DELETE FROM public.product_fitments_effective_staging WHERE true;
  INSERT INTO public.product_fitments_effective_sync_log
    (status, source_rows, staged_rows, orphan_rows, old_count, new_count, note, run_id)
  VALUES ('success', p_source_rows, v_new, p_orphan_rows, v_old, v_new, p_note, p_run_id);
  RETURN jsonb_build_object('old_count', v_old, 'new_count', v_new);
END;
$function$$fndef$;
  ELSE
    v_md5 := md5(pg_get_functiondef(v_oid));
    IF v_md5 <> '5dca2bf7313d3ebd547bbba6f4078a70' THEN
      RAISE EXCEPTION '公用函式 public.pfe_sync_commit 已存在而定義與本檔釘住的不同(現況 md5=%, 本檔期望=5dca2bf7313d3ebd547bbba6f4078a70)。這支是【補版控】不是【改函式】⇒ 停下來給人判, 不覆蓋。', v_md5;
    END IF;
  END IF;
END $fnguard$;

-- 權限:🔴 **REVOKE 與 GRANT 成對, REVOKE 先**(codex R1 must-fix ①)——
--   空庫世界裡 shim 先預授了 anon/authenticated 表的 ALL、新函式自帶 PUBLIC EXECUTE
--   ⇒ 只 GRANT 會讓新環境【比正式庫寬】, 含不受 RLS 管的 TRUNCATE。
--   🛑 **這一段會重寫 ACL, 它不是「什麼都不做」** —— 它保證的是【結果等於正式庫】。
REVOKE ALL ON public.product_fitments_effective FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.product_fitments_effective TO service_role;
-- ACL-GATE-EXEMPT: public.product_fitments_effective -- #299 補版控:逐字複製正式庫既有 relacl(2026-09-06 唯讀實讀 anon=r), 非新開權限;下方斷言逐條核
GRANT SELECT ON public.product_fitments_effective TO anon;
-- ACL-GATE-EXEMPT: public.product_fitments_effective -- #299 補版控:逐字複製正式庫既有 relacl(2026-09-06 唯讀實讀 authenticated=r), 非新開權限
GRANT SELECT ON public.product_fitments_effective TO authenticated;
REVOKE ALL ON public.product_fitments_effective_staging FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.product_fitments_effective_staging TO service_role;
REVOKE ALL ON public.product_fitments_effective_sync_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.product_fitments_effective_sync_log TO service_role;
REVOKE ALL ON SEQUENCE public.product_fitments_effective_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT, USAGE, UPDATE ON SEQUENCE public.product_fitments_effective_id_seq TO service_role;
REVOKE ALL ON SEQUENCE public.product_fitments_effective_staging_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT, USAGE, UPDATE ON SEQUENCE public.product_fitments_effective_staging_id_seq TO service_role;
REVOKE ALL ON SEQUENCE public.product_fitments_effective_sync_log_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT, USAGE, UPDATE ON SEQUENCE public.product_fitments_effective_sync_log_id_seq TO service_role;
REVOKE ALL ON FUNCTION public.pfe_staging_reset() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pfe_staging_reset() TO service_role;
REVOKE ALL ON FUNCTION public.pfe_sync_commit(uuid, integer, integer, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pfe_sync_commit(uuid, integer, integer, boolean, text) TO service_role;
REVOKE ALL ON FUNCTION public.search_products_by_vehicle(text, text, integer) FROM PUBLIC;
-- ACL-GATE-EXEMPT: public.search_products_by_vehicle -- #299 補版控:逐字複製正式庫既有 proacl(2026-09-06 唯讀實讀 anon=X/authenticated=X), 非新開權限
GRANT EXECUTE ON FUNCTION public.search_products_by_vehicle(text, text, integer) TO anon, authenticated, service_role;

-- ── 權限斷言(🔴 豁免不是免驗 —— 上面三行 `ACL-GATE-EXEMPT` 的代價是
--    「apply 之後沒有東西在看那幾行」, 所以這一段把【看】補回來, 就在同一支檔裡)──
--    期望值 = 2026-09-06 從正式庫 relacl / proacl 唯讀讀回的那一份。
--    🛑 空庫世界沒有 `pcm_readonly` 這個角色 ⇒ 斷言**只比我們自己授的那幾個**, 不比整串。
DO $aclassert$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(msg, ' | ') INTO v_bad FROM (
    SELECT '主表 anon 應有且只有 SELECT' AS msg
     WHERE NOT (has_table_privilege('anon','public.product_fitments_effective','SELECT')
            AND NOT has_table_privilege('anon','public.product_fitments_effective','INSERT')
            AND NOT has_table_privilege('anon','public.product_fitments_effective','UPDATE')
            AND NOT has_table_privilege('anon','public.product_fitments_effective','DELETE'))
    UNION ALL
    SELECT '主表 authenticated 應有且只有 SELECT'
     WHERE NOT (has_table_privilege('authenticated','public.product_fitments_effective','SELECT')
            AND NOT has_table_privilege('authenticated','public.product_fitments_effective','INSERT'))
    UNION ALL
    SELECT 'staging 不該給 anon 任何權限'
     WHERE has_table_privilege('anon','public.product_fitments_effective_staging','SELECT')
    UNION ALL
    SELECT 'sync_log 不該給 anon 任何權限'
     WHERE has_table_privilege('anon','public.product_fitments_effective_sync_log','SELECT')
    UNION ALL
    SELECT 'staging 不該給 authenticated 任何權限'
     WHERE has_table_privilege('authenticated','public.product_fitments_effective_staging','SELECT')
    UNION ALL
    SELECT 'pfe_sync_commit 不該給 anon EXECUTE'
     WHERE has_function_privilege('anon','public.pfe_sync_commit(uuid, integer, integer, boolean, text)','EXECUTE')
    UNION ALL
    SELECT 'pfe_staging_reset 不該給 anon EXECUTE'
     WHERE has_function_privilege('anon','public.pfe_staging_reset()','EXECUTE')
    UNION ALL
    SELECT 'search_products_by_vehicle 應給 anon EXECUTE'
     WHERE NOT has_function_privilege('anon','public.search_products_by_vehicle(text, text, integer)','EXECUTE')
  ) t;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '權限斷言失敗(#299):%', v_bad;
  END IF;
END $aclassert$;

COMMIT;
