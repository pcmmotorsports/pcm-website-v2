-- #269-b 段一的 ROLLBACK 本體（預先備好、事故當下直接用，不要臨場寫）
-- ============================================================
-- 為什麼有這支檔：`20260811040000` 的 rollback 原本只寫「新開一支 migration 重貼舊函式」。
-- codex R3 指出：**事故當下才動手寫、貼、驗 SQL，等於沒有可執行的 rollback**。
-- 這支就是那段 SQL 本體，逐字取自 `20260719150000_catalog_product_image_trim.sql`
-- （= 040000 之前正式庫上真正在跑的 10 參數版）。
--
-- 🔴 用法（順序是硬的）：
--   (0) **先確認 app 層沒有人在傳 `p_new_since`。** 段二若已上線，先把 app 退回不傳該參數的版本
--       並**部署完成**，再動 DB。先砍 DB 的話，每一次帶 p_new_since 的呼叫立刻失敗。
--   (1) `cp docs/reviews/2026-08-11-269b-rollback.sql supabase/migrations/<新時戳>_269b_rollback.sql`
--   (2) `supabase db push`
--   (3) 驗：`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--            WHERE n.nspname='public' AND p.proname='search_catalog_by_vehicle';`  → 必須是 1
--       且 `pronargs` = 10。再打一次真 anon RPC 確認 HTTP 200。
--
-- ⚠️ `products_list_public` 的 `created_at` 欄**不在這支 rollback 裡、刻意不退**：
--    它是末欄 append、對任何既有消費端無害，而退它要 DROP VIEW + 重建（PG 不允許 REPLACE 減欄），
--    在事故當下徒增風險。退掉 RPC 就足以恢復行為。
--
-- ⚠️ 這支檔**沒有被任何 CI 或測試跑過**（它不在 supabase/migrations/ 底下，不會被 db push 掃到）。
--    它的正確性來自「逐字複製自已在正式庫跑了三週的 20260719150000」，不是來自實跑驗證。
--    真要有把握，就在拋棄式 PG 上套一次再用。**不誇大它的保證。**
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 先拆掉 11 參數版，否則重建 10 參數版會變成 overload → 42725 ambiguous
DROP FUNCTION IF EXISTS public.search_catalog_by_vehicle(
  text, text, int, int, int, text, text, text[], int, int, timestamptz
);

-- 以下逐字取自 20260719150000_catalog_product_image_trim.sql
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

-- DROP 會帶走 grant ⇒ 重下（與 20260719150000 檔尾一致）
REVOKE ALL ON FUNCTION public.search_catalog_by_vehicle(text, text, int, int, int, text, text, text[], int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_catalog_by_vehicle(text, text, int, int, int, text, text, text[], int, int) TO anon, authenticated, service_role;

DO $rb$
DECLARE v_n int; v_args int;
BEGIN
  SELECT count(*), max(p.pronargs) INTO v_n, v_args
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'search_catalog_by_vehicle';
  IF v_n <> 1 OR v_args <> 10 THEN
    RAISE EXCEPTION 'rollback 斷言失敗:應恰 1 支且 10 參數,實得 % 支 / % 參數。', v_n, v_args;
  END IF;
END
$rb$;

NOTIFY pgrst, 'reload schema';

COMMIT;
