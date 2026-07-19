# trim S1 rollback(20260719150000_catalog_product_image_trim)可執行還原 SQL

> 2026-07-19。codex 關卡2 MF-5 交付物:完整、可直接執行、已於拋棄式 PG 17 實測「apply → rollback → 斷言回基線」來回貫通的 rollback SQL。
> **交付模式(B-2 教訓)**:正常退場=把下方 SQL 包成**新時戳 forward-only migration** 走 `db push`;直接貼 SQL Editor=break-glass(事故中 db push 不可用才用,事後必補 forward-only migration 對齊 history)。
> 還原目標基線:RPC=20260712213000 12 鍵版 / products_public=20260709120000 18 欄版 / trim 表移除。

```sql
-- ── 1. RPC 還原:重套 20260712213000 完整本體(12 鍵、無 trim JOIN)──
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

-- ── 2. products_public 還原 20260709120000 18 欄版(PG 不允許 REPLACE 減欄 → DROP+CREATE)──
DROP VIEW public.products_public;
CREATE VIEW products_public WITH (security_invoker = true) AS
SELECT
  id,
  external_id,
  title,
  subtitle,
  description,
  handle,
  fitments,
  images,
  availability,
  brand_id,
  category_id,
  created_at,
  updated_at,
  price_general,
  supplier_slug,
  highlights,
  manuals,
  video_url
FROM products;

GRANT SELECT ON products_public TO anon, authenticated;

COMMENT ON VIEW products_public IS
  'Detail projection(#270 加末二欄 manuals, video_url、共 18 欄):含 price_general / supplier_slug / highlights / manuals / video_url,仍排除 price_by_tier + price_store + metadata + delisted_at(敏感/內部)。security_invoker=true。RLS USING(delisted_at IS NULL) 隱藏下架。';

-- ── 3. trim 表移除 ──
DROP TABLE public.product_image_trim;

-- ── 4. PostgREST cache reload ──
NOTIFY pgrst, 'reload schema';
```

## 斷言(rollback 後應全 yes)

```sql
-- schema/簽章限定版(codex 關卡2 R2 nit:不可只「看起來像」基線)
SELECT to_regclass('public.product_image_trim') IS NULL AS table_gone;
SELECT count(*) = 18 AS view_18_cols FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'products_public';
SELECT prosrc NOT LIKE '%card_image_trim%' AS rpc_no_trim_key
  FROM pg_proc
 WHERE oid = 'public.search_catalog_by_vehicle(text,text,int,int,int,text,text,text[],int,int)'::regprocedure;
-- 精確還原證明:上式 oid 的 pg_get_functiondef md5 應等於 20260712213000 基線版本雜湊
--(基線 md5 於 rollback 實測時當場自 migration 檔重建計算、不寫死於此以免字面漂移)
```

## 實測紀錄

- 拋棄式 PG 17(本機、stub schema):apply 20260719150000 → 執行本檔全部 SQL → 三斷言全 true(結果見 S1 commit body)。
- ⚠️ DROP VIEW 瞬間 `products_public` 消費端(storefront detail 路)短暫 404/錯誤=incident response 已知代價;正常退場走 forward-only migration 由 db push 單交易包覆。
