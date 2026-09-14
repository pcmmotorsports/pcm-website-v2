-- 20260915220000_m6_products_content_changed_at.sql —— sitemap <lastmod> 用「內容真的變了」的時間
-- pcm:idempotent: yes
--   ↑ 重跑同形:欄 ADD … IF NOT EXISTS(型別由前置閘擋)· 回填只補 IS NULL(第二發 0 列)·
--     函式 CREATE OR REPLACE · trigger 先 DROP IF EXISTS 再建 · view CREATE OR REPLACE 同 21 欄 · GRANT 可重下。
--     拋棄式 PG 實跑四段:套用 → 重跑 → 回滾 → 再套用(見 commit message)。
-- ACL-GATE-EXEMPT: public.products -- 只開 content_changed_at 一欄的欄位級 SELECT 給 anon/authenticated:顧客站 sitemap 走匿名 client(createCatalogAnonClient)讀 products_public(security_invoker ⇒ 要底表欄位權限);不用 service_role 是因為公開頁一律走 anon + RLS(下架隱藏靠 RLS);該欄是時間戳、不含價格(20260915220000, 2026-09-15 主視窗第 21 件)
-- pcm:rule1-exception: 欄位 ADD COLUMN IF NOT EXISTS 與兩支新 trigger 函式 CREATE OR REPLACE 都是為了重貼冪等;欄已存在而型別不是 timestamptz 由前置閘① RAISE,函式名全庫查無同名(2026-09-15 grep)
--
-- 🛑 未貼。只做不貼,貼的人是 Sean(點名那一次)。plan:docs/plans/plan-sitemap-lastmod-content-changed.md
--
-- ══ 為什麼 ══════════════════════════════════════════
-- Sean 0915 拍 Q4 甲:sitemap lastmod 要準。products.updated_at 不能用 —— 供應商同步把它整片翻新
-- (09-09 一天 25,430 / 26,425 列;09-14 又 25,318 列,2026-09-15 唯讀實量)。
-- 主視窗 0915 裁 plan 三題:Q1 比新舊值(不存 hash)· Q2 舊列填 created_at · Q3 價格變也算
-- (量過:近 7 發同步平均一天約 371 件變價 = 1.4%,最多 1,295 件 = 4.9%)。
--
-- ══ 做什麼 ══════════════════════════════════════════
-- ① products.content_changed_at timestamptz(可空)
-- ② 回填:舊列 = created_at(先回填、再建 trigger)
-- ③ trigger trg_products_z_content_changed(products BEFORE INSERT OR UPDATE):
--    INSERT ⇒ now();UPDATE ⇒ 客人看得到的 13 欄任一 IS DISTINCT FROM ⇒ now(),沒變就不動
-- ④ trigger trg_product_variants_content_changed(product_variants AFTER INSERT OR UPDATE OR DELETE):
--    新增 / 刪除,或變體公開欄任一變了 ⇒ 母商品 content_changed_at = now()
-- ⑤ GRANT SELECT (content_changed_at) ON products TO anon, authenticated(products 走欄位級授權,同 20260808000000:54)
-- ⑥ products_public 末尾加 content_changed_at(20 → 21 欄;其餘 20 欄逐字抄 20260808000000:61)
--
-- 🔴 trigger 名字排序是刻意的:PG 同類 trigger 照名字字母序跑。既有 trg_products_description_lock
--    (BEFORE UPDATE,20260902190000:215)鎖住時把 description 改回舊值 ⇒ 本 trigger 名字要排在它後面
--    (trg_products_z_…),看到的是還原後的值,被擋下的改寫不會誤判成「內容變了」。
-- 🔵 為什麼比新舊值就夠(不存 hash):兩條寫入路都是 upsert,UPDATE 路徑拿得到 OLD ——
--    products:scripts/rpm-import.ts:980 upsertBatched(…, 'supplier_slug,external_id');
--    variants:sync_product_variant_group(20260825120000)INSERT … ON CONFLICT DO UPDATE,孤兒 DELETE。
--    PostgREST upsert 的 SET 只含 payload 帶的欄 ⇒ 不帶 content_changed_at ⇒ UPDATE 時沿用舊值再由本 trigger 判。
-- 🔵 算內容的欄(客人在商品頁看得到):
--    products:title subtitle description highlights images price_general availability fitments video_url manuals sound_clips brand_id category_id
--    variants:sku spec price_general availability images sort_order(= product_variants_public 公開的欄)
--    不算:price_store / price_by_tier(經銷價)· metadata · updated_at · listing_set_by · source_missing_at · external_id · supplier_slug · description_locked*
-- 🔵 已查:讀 products_public 的 SQL 函式都是具名欄位(沒有 p.* / SELECT *)⇒ 加欄不影響它們
--    (SELECT p.* 那幾支讀的是 products_list_public / products_list_dealer,不是本 view)。
--
-- ══ 貼的時候 ══════════════════════════════════════════
-- · 🔴 避開每日供應商同步(rpm-sync.yml cron 04:30 UTC = 台灣 12:30,跑約 10–15 分),也挑客人少的時段:
--   ALTER TABLE 拿 ACCESS EXCLUSIVE 一路持有到 COMMIT(codex R1)⇒ 回填期間【前台讀 products 也會被擋】。
--   🔬 拋棄式 PG 本機實量:整支(含回填 26,482 列)992 ms;正式庫耗時未量 ⇒ 預期數秒級,不是分鐘級,未證實。
--   lock_timeout 5s 只限本交易等鎖;statement_timeout 120s 是每句上限、不是整筆交易上限。
-- · 🔬 trigger 對同步的代價(同上本機、VACUUM FULL 後各 3 發中位數):全量 upsert 商品 +35%、變體 +20%。
-- · 🔴 顧客站 sitemap 那顆碼要在本支貼完之後才推:碼先上而欄還沒有 ⇒ 查詢失敗 ⇒ fetchCatalogHandles catch 回空
--   ⇒ 地圖商品頁全部消失一天(revalidate 86400),而且 build 不會紅(比部署失敗更安靜)。
-- · 回滾:supabase/rollbacks/20260915220000-rollback.sql(要先退顧客站碼,再退 DB)。
--   🔴 回滾【只拆兩支 trigger 與函式】,欄與 view 第 21 欄刻意留著(惰性時間戳)——
--     DROP VIEW 重建要還原一份沒量過的 ACL,codex R1/R2 各抓到洞;理由全文在回滾檔頭。
-- ═══════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $pre$
DECLARE
  v_type text;
  v_cols text[];
BEGIN
  -- 前置閘①:欄若已存在(重跑),型別必須是 timestamptz
  SELECT pg_catalog.format_type(a.atttypid, a.atttypmod) INTO v_type
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.products'::regclass AND a.attname = 'content_changed_at' AND NOT a.attisdropped;
  IF v_type IS NOT NULL AND v_type <> 'timestamp with time zone' THEN
    RAISE EXCEPTION 'content_changed_at:欄已存在而型別是 %,不是 timestamptz;拒繼續', v_type;
  END IF;

  -- 前置閘②:products_public 必須是 20 欄那一代(20260808000000)或本支的 21 欄(重跑)
  SELECT pg_catalog.array_agg(a.attname::text ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.products_public'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF NOT (
       (pg_catalog.array_length(v_cols, 1) = 20 AND v_cols[20] = 'sound_clips')
    OR (pg_catalog.array_length(v_cols, 1) = 21 AND v_cols[20] = 'sound_clips' AND v_cols[21] = 'content_changed_at')
  ) THEN
    RAISE EXCEPTION 'content_changed_at:products_public 欄位不是預期的那一代(實得 % 欄:%);拒繼續',
      pg_catalog.array_length(v_cols, 1), v_cols;
  END IF;

  -- 前置閘③:trigger 順序的前提 —— description 鎖那支必須在
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
     WHERE tgrelid = 'public.products'::regclass AND tgname = 'trg_products_description_lock' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'content_changed_at:找不到 trg_products_description_lock,trigger 排序的前提不成立;拒繼續';
  END IF;
END
$pre$;

-- ① 欄
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS content_changed_at timestamptz;

COMMENT ON COLUMN public.products.content_changed_at IS
  '客人看得到的內容最後一次真的變了的時間(sitemap <lastmod> 用)。由 trigger trg_products_z_content_changed 與
trg_product_variants_content_changed 維護;updated_at 會被供應商同步整片翻新,不能拿來當 lastmod。
舊列回填 = created_at(20260915220000)。';

-- ② 回填(在建 trigger 之前;重跑時已無 NULL ⇒ 0 列)
UPDATE public.products SET content_changed_at = created_at WHERE content_changed_at IS NULL;

-- ③ products trigger
CREATE OR REPLACE FUNCTION public.products_content_changed_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.content_changed_at := pg_catalog.now();
  ELSIF (OLD.title, OLD.subtitle, OLD.description, OLD.highlights, OLD.images, OLD.price_general,
         OLD.availability, OLD.fitments, OLD.video_url, OLD.manuals, OLD.sound_clips, OLD.brand_id, OLD.category_id)
        IS DISTINCT FROM
        (NEW.title, NEW.subtitle, NEW.description, NEW.highlights, NEW.images, NEW.price_general,
         NEW.availability, NEW.fitments, NEW.video_url, NEW.manuals, NEW.sound_clips, NEW.brand_id, NEW.category_id)
  THEN
    NEW.content_changed_at := pg_catalog.now();
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_products_z_content_changed ON public.products;
CREATE TRIGGER trg_products_z_content_changed
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_content_changed_guard();

-- ④ product_variants trigger
CREATE OR REPLACE FUNCTION public.product_variants_content_changed_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE
  v_product_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.sku, OLD.spec, OLD.price_general, OLD.availability, OLD.images, OLD.sort_order, OLD.product_id)
       IS NOT DISTINCT FROM
       (NEW.sku, NEW.spec, NEW.price_general, NEW.availability, NEW.images, NEW.sort_order, NEW.product_id)
    THEN
      RETURN NULL;
    END IF;
    -- 變體換了母商品:兩邊都算變了
    IF OLD.product_id IS DISTINCT FROM NEW.product_id THEN
      UPDATE public.products SET content_changed_at = pg_catalog.now()
       WHERE id = OLD.product_id AND content_changed_at IS DISTINCT FROM pg_catalog.now();
    END IF;
    v_product_id := NEW.product_id;
  ELSIF TG_OP = 'INSERT' THEN
    v_product_id := NEW.product_id;
  ELSE
    v_product_id := OLD.product_id;
  END IF;
  -- 🔵 同一交易 now() 不變 ⇒ 同一群變體連改幾列,母商品只被 UPDATE 一次
  UPDATE public.products SET content_changed_at = pg_catalog.now()
   WHERE id = v_product_id AND content_changed_at IS DISTINCT FROM pg_catalog.now();
  RETURN NULL;
END
$fn$;

DROP TRIGGER IF EXISTS trg_product_variants_content_changed ON public.product_variants;
CREATE TRIGGER trg_product_variants_content_changed
  AFTER INSERT OR UPDATE OR DELETE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.product_variants_content_changed_touch();

REVOKE ALL ON FUNCTION public.products_content_changed_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.products_content_changed_guard() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.product_variants_content_changed_touch() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.product_variants_content_changed_touch() FROM anon, authenticated;

-- ⑤ 欄位級讀權限
GRANT SELECT (content_changed_at) ON public.products TO anon, authenticated;

-- ⑥ products_public 末欄 append content_changed_at(20 → 21 欄)
-- ⚠️ 經銷防護回歸點:以下 SELECT 只比現行(20260808000000:61)多末一欄 p.content_changed_at、
--    絕無 price_by_tier / price_store / metadata / delisted_at;security_invoker=true 不可漏;
--    card_image_trim 的 LEFT JOIN 與 CASE 表達式逐字保留。
CREATE OR REPLACE VIEW products_public WITH (security_invoker = true) AS
SELECT
  p.id,
  p.external_id,
  p.title,
  p.subtitle,
  p.description,
  p.handle,
  p.fitments,
  p.images,
  p.availability,
  p.brand_id,
  p.category_id,
  p.created_at,
  p.updated_at,
  p.price_general,
  p.supplier_slug,
  p.highlights,
  p.manuals,
  p.video_url,
  CASE WHEN t.url IS NULL THEN NULL ELSE jsonb_build_object(
    'l', t.bbox_left, 't', t.bbox_top, 'w', t.bbox_width, 'h', t.bbox_height,
    'nw', t.natural_width, 'nh', t.natural_height) END AS card_image_trim,
  p.sound_clips,
  p.content_changed_at
FROM products p
LEFT JOIN public.product_image_trim t ON t.url = p.images ->> 0 AND t.status = 'ok';
-- 🔵 刻意【不】重下 GRANT SELECT ON products_public:CREATE OR REPLACE VIEW 保留既有 ACL(拋棄式 PG 實跑:套用前後逐列相同),
--    正式庫 anon/authenticated 本來就有 SELECT(20260905260000:10);重下只會多一條 acl-drift-gate R3 命中而沒有作用。

COMMENT ON VIEW products_public IS
  'Detail projection(附件片 3a 加末欄 sound_clips;20260915220000 再加末欄 content_changed_at、共 21 欄):含 price_general / supplier_slug / highlights / manuals / video_url / card_image_trim / sound_clips / content_changed_at,仍排除 price_by_tier + price_store + metadata + delisted_at(敏感/內部)。security_invoker=true。RLS USING(delisted_at IS NULL) 隱藏下架。card_image_trim=首圖去白邊 bbox jsonb {l,t,w,h,nw,nh} 或 null(product_image_trim status=ok 才有)。sound_clips=排氣聲浪 [{title,url}]、title 為來源英文原文。content_changed_at=客人看得到的內容最後真的變了的時間(sitemap lastmod)。';

DO $post$
DECLARE
  v_functions text[] := ARRAY[
    'public.products_content_changed_guard()',
    'public.product_variants_content_changed_touch()'
  ]::text[];
  v_fn  oid;
  r     text;
  v_null bigint;
BEGIN
  -- 事後閘①:沒有漏回填
  SELECT pg_catalog.count(*) INTO v_null FROM public.products WHERE content_changed_at IS NULL;
  IF v_null <> 0 THEN
    RAISE EXCEPTION 'content_changed_at:事後仍有 % 列是 NULL', v_null;
  END IF;

  -- 事後閘②:兩支 trigger 都在
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger
       WHERE NOT tgisinternal
         AND ((tgrelid = 'public.products'::regclass AND tgname = 'trg_products_z_content_changed')
           OR (tgrelid = 'public.product_variants'::regclass AND tgname = 'trg_product_variants_content_changed'))) <> 2 THEN
    RAISE EXCEPTION 'content_changed_at:事後 trigger 不是兩支';
  END IF;

  -- 事後閘③:view 末欄 + anon 讀得到那一欄
  IF (SELECT a.attname FROM pg_catalog.pg_attribute a
       WHERE a.attrelid = 'public.products_public'::regclass AND a.attnum = 21 AND NOT a.attisdropped) IS DISTINCT FROM 'content_changed_at' THEN
    RAISE EXCEPTION 'content_changed_at:products_public 第 21 欄不是 content_changed_at';
  END IF;
  IF NOT pg_catalog.has_column_privilege('anon', 'public.products', 'content_changed_at', 'SELECT') THEN
    RAISE EXCEPTION 'content_changed_at:anon 讀不到 products.content_changed_at';
  END IF;

  -- 收權斷言:trigger 函式 anon / authenticated 零 EXECUTE
  FOREACH r IN ARRAY v_functions LOOP
    v_fn := pg_catalog.to_regprocedure(r);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION '收權斷言失敗:找不到函式 %', r;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言失敗:% 對 anon/authenticated 開著 EXECUTE', r;
    END IF;
  END LOOP;

  RAISE NOTICE '✅ content_changed_at:回填完成、兩支 trigger 在、products_public 21 欄、anon 讀得到該欄、trigger 函式零 EXECUTE';
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
