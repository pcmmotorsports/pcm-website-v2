-- P4 商品目錄 server pagination：公開列表投影 + 車款分頁 RPC。
-- 安全不變量：只從 RLS 保護的公開 view 讀取；絕不投射 price_store、price_by_tier、
-- metadata、description、highlights、manuals、video_url、delisted_at 或任何成本來源欄位。

CREATE OR REPLACE VIEW public.products_list_public WITH (security_invoker = true) AS
SELECT
  p.id,
  p.title,
  p.subtitle,
  p.handle,
  p.brand_id,
  p.category_id,
  p.availability,
  p.fitments,
  p.price_general,
  p.supplier_slug,
  p.images ->> 0 AS card_image,
  COALESCE(
    NULLIF(
      concat_ws(' ', p.fitments -> 0 ->> 'motoBrand', p.fitments -> 0 ->> 'modelCode'),
      ''
    ),
    '通用款'
  ) AS fits,
  b.name AS brand_name,
  b.slug AS brand_slug,
  c.raw_path AS category_raw
FROM public.products p
JOIN public.brands b ON b.id = p.brand_id
JOIN public.categories c ON c.id = p.category_id;

GRANT SELECT ON public.products_list_public TO anon, authenticated;

COMMENT ON VIEW public.products_list_public IS
  'P4 list projection: card-only public fields + brand/category display keys. security_invoker=true; excludes price_store, price_by_tier, metadata, detail content, delisted_at and timestamps.';

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
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
  WITH matched AS (
    SELECT id AS product_id
    FROM public.products_list_public
    WHERE p_brand IS NULL
    UNION
    SELECT product_id
    FROM public.product_fitments
    WHERE p_brand IS NOT NULL
      AND moto_brand = p_brand
      AND (p_model IS NULL OR model_code = p_model)
      AND (p_year IS NULL OR ((year_start IS NULL OR year_start <= p_year)
                          AND (year_end IS NULL OR year_end >= p_year)))
    UNION
    SELECT product_id
    FROM public.product_fitments_effective
    WHERE p_brand IS NOT NULL
      AND moto_brand = p_brand
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
  )
  SELECT
    jsonb_build_object(
      'id', id,
      'title', title,
      'subtitle', subtitle,
      'handle', handle,
      'availability', availability,
      'price_general', price_general,
      'card_image', card_image,
      'fits', fits,
      'brand_name', brand_name,
      'brand_slug', brand_slug,
      'category_raw', category_raw
    ),
    count(*) OVER ()
  FROM filtered
  ORDER BY
    CASE WHEN p_sort = 'price-asc' THEN price_general END ASC NULLS LAST,
    CASE WHEN p_sort = 'price-desc' THEN price_general END DESC NULLS LAST,
    id ASC
  OFFSET GREATEST(p_offset, 0)
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$fn$;

REVOKE ALL ON FUNCTION public.search_catalog_by_vehicle(text, text, int, int, int, text, text, text[], int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_catalog_by_vehicle(text, text, int, int, int, text, text, text[], int, int) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.catalog_brand_counts()
RETURNS TABLE (slug text, name text, product_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
  SELECT brand_slug, brand_name, count(*)
  FROM public.products_list_public
  GROUP BY brand_slug, brand_name
  ORDER BY brand_name COLLATE "C";
$fn$;

REVOKE ALL ON FUNCTION public.catalog_brand_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.catalog_brand_counts() TO anon, authenticated, service_role;

-- Forward-only rollback (manual incident response only):
-- DROP FUNCTION IF EXISTS public.search_catalog_by_vehicle(text, text, int, int, int, text, text, text[], int, int);
-- DROP FUNCTION IF EXISTS public.catalog_brand_counts();
-- Recreate products_list_public from the immediately preceding migration with its original 10-column projection and security_invoker=true.
