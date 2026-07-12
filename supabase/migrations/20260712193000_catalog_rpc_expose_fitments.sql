-- S4 目錄卡片顯示年份:search_catalog_by_vehicle 的 jsonb 輸出加投影原始 fitments。
-- 動機:目錄卡片同名不同年的商品(bonamici 腳踏後移組 dv4=2018-2024 / d001=2025-2026 …)
--   無法區分裝不裝得上;卡片前端需 fitment 年份才能顯示「適用 {車款} '18–'24」/「適用 N 款車型」。
-- 安全不變量:fitments 為公開車輛相容資料(products_list_public 第 14 欄已選、且 view 已 GRANT anon SELECT、
--   PDP(products detail 路徑)早已公開顯示),不含 price_store / price_by_tier / metadata / 成本來源欄。
--   本 migration 僅在 RPC 輸出 jsonb 擴增一個 'fitments' key,不改函式簽章 / GRANT / 排序 / 過濾 / 分頁。
-- 前後相容:前端防禦性讀 fitments(無則降級不顯年份);舊前端忽略多出的 key、新前端遇 RPC 未更新時
--   該 key 為 undefined 自動降級,故 DB 與前端部署誰先誰後皆不破。

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
      'category_raw', category_raw,
      -- S4:原始 fitments(公開車輛相容資料)供卡片顯示年份;前端白名單收 motoBrand/modelCode/yearStart/yearEnd
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
$fn$;

REVOKE ALL ON FUNCTION public.search_catalog_by_vehicle(text, text, int, int, int, text, text, text[], int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_catalog_by_vehicle(text, text, int, int, int, text, text, text[], int, int) TO anon, authenticated, service_role;

-- Forward-only rollback(手動事故處理):把上面 jsonb_build_object 內的 'fitments', fitments 一行移除、
-- 重新 CREATE OR REPLACE FUNCTION 即還原成 20260712183000 的 11-key 輸出(簽章/GRANT 不變)。
-- 前端多讀的 fitments 變 undefined、卡片自動降級只顯「適用 {fits}」無年份。
-- ⚠️ rollback 精確步驟：移除 'fitments', fitments 該行時，須一併刪除其前一行 'category_raw', category_raw 的尾逗號
--   （否則 jsonb_build_object 尾逗號會語法錯）；或更穩妥＝直接重跑 20260712183000 的 RPC 建立段。
