-- ============================================================
-- 商品卡去白邊縮放:product_image_trim 表 + 兩條卡片資料路曝光 trim
-- ============================================================
-- 真權威 plan:docs/specs/2026-07-19-product-image-trim-plan.md v1.1
--   (Sean 2026-07-19 拍 Q1=B;Fable 關卡1 R1 NO-GO 3 must-fix → v1.1 落字 → R2 GO)。
-- 鐵則 8(schema+跨檔)+ 鐵則 12(migration/公開 API)。
--
-- 三動作(單 migration):
--   1. 新表 product_image_trim:每張卡片圖 URL 的非白內容邊界框(bbox 0..1 比例)+
--      原圖尺寸 + 掃描狀態。寫入僅 service key(scripts/image-trim-scan.ts + CI 增量),
--      anon/authenticated 只讀。無 PII 無金額(url=供應商公開 CDN 位址)。
--   2. RPC search_catalog_by_vehicle 同簽章 CREATE OR REPLACE(車款目錄卡片路):
--      count/排序/OFFSET/LIMIT 先在 paged CTE 完成,**之後**才 LEFT JOIN trim 表
--      (=每次請求最多 100 次 PK 等值 lookup、與 filtered 總量無關;codex 關卡2 MF-4),
--      卡片 jsonb 加第 13 鍵 'card_image_trim'(無資料=null;additive、消費端容忍)。
--      同簽章 = 無 overload、無 42725 風險(B-2 教訓對照:本次不改參數)。
--   3. products_public 末欄 append card_image_trim(首頁精選/全目錄/相關商品卡片路;
--      CREATE OR REPLACE VIEW 僅允許末尾 append、照抄 20260709120000 範本)。
--      products_list_public 不動(plan §2:直接消費端 grep 僅 RPC 內部 CTE 與
--      sitemap id+handle 輕量投影,無第三處曝光需求)。
--
-- 🔴 F2(Fable):Supabase default privileges 會給新表 anon/authenticated 全權
--    (B-2 function 層同款實測)→ 必先 REVOKE ALL 再窄放 GRANT SELECT;
--    驗收斷言 anon INSERT/UPDATE/DELETE 三 false(fail-closed)。
-- 🔴 經銷防護不削弱:trim 不含價格;products_public SELECT 仍排除
--    price_by_tier / price_store / metadata / delisted_at;security_invoker=true 不變;
--    既有寫入 REVOKE(20260605120000)不受 CREATE OR REPLACE 影響。
--
-- Rollback(forward-only、僅供 incident response、勿在正常流程執行):見檔尾。
-- ============================================================


-- ── 1. product_image_trim 表 ──
CREATE TABLE public.product_image_trim (
  url            text PRIMARY KEY CHECK (btrim(url) <> ''),
  status         text NOT NULL CHECK (status IN ('ok','no_trim','failed')),
  -- bbox 皆為 0..1 內容框比例(相對 EXIF rotate 後原圖);status='ok' 才有值
  bbox_left      numeric(6,5) CHECK (bbox_left  >= 0 AND bbox_left  < 1),
  bbox_top       numeric(6,5) CHECK (bbox_top   >= 0 AND bbox_top   < 1),
  bbox_width     numeric(6,5) CHECK (bbox_width  > 0 AND bbox_width  <= 1),
  bbox_height    numeric(6,5) CHECK (bbox_height > 0 AND bbox_height <= 1),
  natural_width  integer CHECK (natural_width  > 0),
  natural_height integer CHECK (natural_height > 0),
  analyzed_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bbox_complete CHECK (
    status <> 'ok' OR (bbox_left IS NOT NULL AND bbox_top IS NOT NULL AND bbox_width IS NOT NULL
      AND bbox_height IS NOT NULL AND natural_width IS NOT NULL AND natural_height IS NOT NULL
      AND bbox_left + bbox_width <= 1 AND bbox_top + bbox_height <= 1)
  ),
  -- 非 ok 列 bbox 強制 NULL(failed/no_trim 不得殘留舊值;Fable nit-5)
  CONSTRAINT bbox_null_unless_ok CHECK (
    status = 'ok' OR (bbox_left IS NULL AND bbox_top IS NULL AND bbox_width IS NULL
      AND bbox_height IS NULL AND natural_width IS NULL AND natural_height IS NULL)
  )
);

COMMENT ON TABLE public.product_image_trim IS
  '商品卡片圖去白邊 bbox(plan docs/specs/2026-07-19-product-image-trim-plan.md)。url=products.images->>0 的供應商 CDN 位址(公開、無 PII);status=ok(有 bbox)/no_trim(深底或無白邊、前端照舊 cover)/failed(抓取或解碼失敗、增量掃 >7 天重試)。寫入僅 service key(scripts/image-trim-scan.ts、CI image-trim-scan job);URL 換版留孤兒列=已知接受(量級小、無 GC)。';

ALTER TABLE public.product_image_trim ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_image_trim_public_read ON public.product_image_trim
  FOR SELECT USING (true);

-- F2:先全收 default privileges 再窄放。
-- 🔴 codex 關卡2 MF-3:service_role 寫入路不靠 default privileges 隱式保留(Supabase 已公告
--    新表停止自動曝光的方向、專案層也可能關閉)→ 顯式 GRANT、驗收加 service_role 正向斷言。
REVOKE ALL ON public.product_image_trim FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.product_image_trim TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_image_trim TO service_role;


-- ── 2. RPC 加第 13 鍵 card_image_trim(同簽章 REPLACE;body 基準=20260712213000)──
CREATE OR REPLACE FUNCTION public.search_catalog_by_vehicle(
  p_brand text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_year int DEFAULT NULL,
  p_offset int DEFAULT 0,
  p_limit int DEFAULT 25,
  p_sort text DEFAULT 'recommend',
  p_category text DEFAULT NULL,
  p_brand_slugs text[] DEFAULT NULL,
  p_price_min int DEFAULT NULL,
  p_price_max int DEFAULT NULL
)
RETURNS TABLE (item jsonb, total bigint)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF p_brand IS NULL THEN
    RETURN QUERY
    WITH filtered AS (
      SELECT p.*
      FROM public.products_list_public p
      WHERE (p_category IS NULL OR p.category_raw = p_category OR p.category_raw LIKE p_category || ' · %')
        AND (p_brand_slugs IS NULL OR cardinality(p_brand_slugs) = 0 OR p.brand_slug = ANY(p_brand_slugs))
        AND (p_price_min IS NULL OR p.price_general >= p_price_min)
        AND (p_price_max IS NULL OR p.price_general <= p_price_max)
    ), paged AS (
      -- count/排序/分頁先收斂到 ≤100 列,trim JOIN 只對當頁做(MF-4)
      SELECT f.*, count(*) OVER () AS total_rows
      FROM filtered f
      ORDER BY
        CASE WHEN p_sort = 'price-asc' THEN f.price_general END ASC NULLS LAST,
        CASE WHEN p_sort = 'price-desc' THEN f.price_general END DESC NULLS LAST,
        f.id ASC
      OFFSET GREATEST(p_offset, 0)
      LIMIT LEAST(GREATEST(p_limit, 1), 100)
    )
    SELECT
      jsonb_build_object(
        'id', pg.id,
        'title', pg.title,
        'subtitle', pg.subtitle,
        'handle', pg.handle,
        'availability', pg.availability,
        'price_general', pg.price_general,
        'card_image', pg.card_image,
        'fits', pg.fits,
        'brand_name', pg.brand_name,
        'brand_slug', pg.brand_slug,
        'category_raw', pg.category_raw,
        'fitments', pg.fitments,
        'card_image_trim', CASE WHEN t.url IS NULL THEN NULL ELSE jsonb_build_object(
          'l', t.bbox_left, 't', t.bbox_top, 'w', t.bbox_width, 'h', t.bbox_height,
          'nw', t.natural_width, 'nh', t.natural_height) END
      ),
      pg.total_rows
    FROM paged pg
    LEFT JOIN public.product_image_trim t ON t.url = pg.card_image AND t.status = 'ok'
    ORDER BY
      CASE WHEN p_sort = 'price-asc' THEN pg.price_general END ASC NULLS LAST,
      CASE WHEN p_sort = 'price-desc' THEN pg.price_general END DESC NULLS LAST,
      pg.id ASC;
    RETURN;
  END IF;

  RETURN QUERY
  WITH matched AS (
    SELECT product_id
    FROM public.product_fitments
    WHERE moto_brand = p_brand
      AND (p_model IS NULL OR model_code = p_model)
      AND (p_year IS NULL OR ((year_start IS NULL OR year_start <= p_year)
                          AND (year_end IS NULL OR year_end >= p_year)))
    UNION
    SELECT product_id
    FROM public.product_fitments_effective
    WHERE moto_brand = p_brand
      AND (p_model IS NULL OR model_code = p_model)
      AND (p_year IS NULL OR ((year_start IS NULL OR year_start <= p_year)
                          AND (year_end IS NULL OR year_end >= p_year)))
  ), filtered AS (
    SELECT p.*
    FROM public.products_list_public p
    JOIN matched m ON m.product_id = p.id
    WHERE (p_category IS NULL OR p.category_raw = p_category OR p.category_raw LIKE p_category || ' · %')
      AND (p_brand_slugs IS NULL OR cardinality(p_brand_slugs) = 0 OR p.brand_slug = ANY(p_brand_slugs))
      AND (p_price_min IS NULL OR p.price_general >= p_price_min)
      AND (p_price_max IS NULL OR p.price_general <= p_price_max)
  ), paged AS (
    -- 同上:trim JOIN 只對當頁 ≤100 列做(MF-4)
    SELECT f.*, count(*) OVER () AS total_rows
    FROM filtered f
    ORDER BY
      CASE WHEN p_sort = 'price-asc' THEN f.price_general END ASC NULLS LAST,
      CASE WHEN p_sort = 'price-desc' THEN f.price_general END DESC NULLS LAST,
      f.id ASC
    OFFSET GREATEST(p_offset, 0)
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  )
  SELECT
    jsonb_build_object(
      'id', pg.id,
      'title', pg.title,
      'subtitle', pg.subtitle,
      'handle', pg.handle,
      'availability', pg.availability,
      'price_general', pg.price_general,
      'card_image', pg.card_image,
      'fits', pg.fits,
      'brand_name', pg.brand_name,
      'brand_slug', pg.brand_slug,
      'category_raw', pg.category_raw,
      'fitments', pg.fitments,
      'card_image_trim', CASE WHEN t.url IS NULL THEN NULL ELSE jsonb_build_object(
        'l', t.bbox_left, 't', t.bbox_top, 'w', t.bbox_width, 'h', t.bbox_height,
        'nw', t.natural_width, 'nh', t.natural_height) END
    ),
    pg.total_rows
  FROM paged pg
  LEFT JOIN public.product_image_trim t ON t.url = pg.card_image AND t.status = 'ok'
  ORDER BY
    CASE WHEN p_sort = 'price-asc' THEN pg.price_general END ASC NULLS LAST,
    CASE WHEN p_sort = 'price-desc' THEN pg.price_general END DESC NULLS LAST,
    pg.id ASC;
END;
$fn$;

-- grants 照 20260712213000 原樣重申(CREATE OR REPLACE 不掉 grant、重申=冪等自證)
REVOKE ALL ON FUNCTION public.search_catalog_by_vehicle(text, text, int, int, int, text, text, text[], int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_catalog_by_vehicle(text, text, int, int, int, text, text, text[], int, int) TO anon, authenticated, service_role;


-- ── 3. products_public 末欄 append card_image_trim(照抄 20260709120000 append 範本)──
-- ⚠️ 經銷防護回歸點:以下 SELECT 只比現行(20260709120000)多末一欄 card_image_trim、
--    絕無 price_by_tier / price_store / metadata / delisted_at;security_invoker=true 不可漏。
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
    'nw', t.natural_width, 'nh', t.natural_height) END AS card_image_trim
FROM products p
LEFT JOIN public.product_image_trim t ON t.url = p.images ->> 0 AND t.status = 'ok';

GRANT SELECT ON products_public TO anon, authenticated;

COMMENT ON VIEW products_public IS
  'Detail projection(trim 片加末欄 card_image_trim、共 19 欄):含 price_general / supplier_slug / highlights / manuals / video_url / card_image_trim,仍排除 price_by_tier + price_store + metadata + delisted_at(敏感/內部)。security_invoker=true。RLS USING(delisted_at IS NULL) 隱藏下架。card_image_trim=首圖去白邊 bbox jsonb {l,t,w,h,nw,nh} 或 null(product_image_trim status=ok 才有)。';


-- ── 4. PostgREST schema cache reload(view 加欄=schema metadata 變更;
--       缺此步 → Data API 對 card_image_trim 回 schema cache 錯誤;codex 關卡2 MF-6)──
NOTIFY pgrst, 'reload schema';


-- ============================================================
-- Rollback(forward-only、僅 incident response):
--   🔴 可執行且已於拋棄式 PG 17 實測來回貫通的完整 rollback SQL =
--   docs/reviews/2026-07-19-trim-s1-rollback.md(含:舊 12 鍵 RPC 完整本體重套 →
--   DROP VIEW + 重建 20260709120000 的 18 欄 products_public + 重下 GRANT/COMMENT →
--   DROP TABLE product_image_trim → NOTIFY pgrst)。
--   ⚠️ PG 不允許 CREATE OR REPLACE VIEW 減欄 → view 還原必走 DROP+CREATE,勿在此檔內嵌
--   簡化版誤導 incident 操作(codex 關卡2 MF-5);正常退場一律走新時戳 forward-only migration。
-- ============================================================
