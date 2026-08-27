-- P4 timeout fix: PostgREST prepared statements use a generic plan.  The old SQL-language
-- function kept no-vehicle and vehicle lookups in one UNION CTE, so `p_brand IS NULL` still
-- scanned product_fitments + product_fitments_effective (184k rows) and exceeded anon's 8s timeout.
-- PL/pgSQL IF creates two execution paths; the default catalog branch never references either fitment table.
-- Public contract is intentionally byte-compatible with 20260712193000: same 10 parameters, 12 jsonb keys,
-- SECURITY INVOKER, search_path, and anon/authenticated/service_role grants.

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
        'category_raw', category_raw,
        'fitments', fitments
      ),
      count(*) OVER ()
    FROM filtered
    ORDER BY
      CASE WHEN p_sort = 'price-asc' THEN price_general END ASC NULLS LAST,
      CASE WHEN p_sort = 'price-desc' THEN price_general END DESC NULLS LAST,
      id ASC
    OFFSET GREATEST(p_offset, 0)
    LIMIT LEAST(GREATEST(p_limit, 1), 100);
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
      'category_raw', category_raw,
      'fitments', fitments
    ),
    count(*) OVER ()
  FROM filtered
  ORDER BY
    CASE WHEN p_sort = 'price-asc' THEN price_general END ASC NULLS LAST,
    CASE WHEN p_sort = 'price-desc' THEN price_general END DESC NULLS LAST,
    id ASC
  OFFSET GREATEST(p_offset, 0)
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
END;
$fn$;

REVOKE ALL ON FUNCTION public.search_catalog_by_vehicle(text, text, int, int, int, text, text, text[], int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_catalog_by_vehicle(text, text, int, int, int, text, text, text[], int, int) TO anon, authenticated, service_role;

-- Rollback (forward-only incident response): reapply the function body from
-- 20260712193000_catalog_rpc_expose_fitments.sql. It restores the slower single SQL path but keeps all
-- public fields, grants, and S4 fitments behavior intact.
