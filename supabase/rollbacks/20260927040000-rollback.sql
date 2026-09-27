-- 20260927040000-rollback.sql —— 退 20260927040000_m4b_products_staff_overrides.sql 的【行為】
-- 🔴 順序:先 git revert 後台寫 staff_overrides 的那顆碼(片 2,若已上線),再跑本檔。
--
-- 🔴🔴 本回滾【只把兩個 view 與 trigger 函式換回上一代】,不刪欄、不刪 CHECK、不收 GRANT —— 刻意的:
--   · CREATE OR REPLACE VIEW 不 DROP ⇒ view 的 ACL 與依賴它的 products_list_dealer 一個位元都不動
--     (20260915220000-rollback.sql 檔頭記過:DROP VIEW 要重建沒人量過的 ACL,codex 兩輪各抓到洞)。
--   · 欄留著 = 員工已經填的值還在(只是客人看不到了);要再開回來,重貼本支 migration 即可。
--   · 要連欄一起清掉 ⇒ 另寫一支 migration,不在回滾當下做。
-- ⇒ 跑完之後客人看到的標題 / 副標 / 賣點 = 供應商的值(= 20260927040000 之前的樣子)。
-- 冪等:三個 CREATE OR REPLACE,重跑同形。

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ① products_content_changed_guard() 換回 20260915220000:105-123(逐字)
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
REVOKE ALL ON FUNCTION public.products_content_changed_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.products_content_changed_guard() FROM anon, authenticated;

-- ② products_public 換回 20260915220000:181-207(逐字)
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

-- ③ products_list_public 換回 20260811040000(逐字)
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
  c.raw_path AS category_raw,
  p.created_at
FROM public.products p
JOIN public.brands b ON b.id = p.brand_id
JOIN public.categories c ON c.id = p.category_id;

DO $post$
BEGIN
  IF pg_catalog.pg_get_viewdef('public.products_public'::regclass) ILIKE '%staff_overrides%'
     OR pg_catalog.pg_get_viewdef('public.products_list_public'::regclass) ILIKE '%staff_overrides%' THEN
    RAISE EXCEPTION 'rollback:前台 view 仍在讀 staff_overrides';
  END IF;
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = 'public.products_content_changed_guard()'::regprocedure) IS DISTINCT FROM 'a963db38a9a022d78b2505d7202d6fe1' THEN
    RAISE EXCEPTION 'rollback:products_content_changed_guard() 不是 20260915220000 那一代';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_class c
       WHERE c.oid IN ('public.products_public'::regclass, 'public.products_list_public'::regclass)
         AND c.reloptions @> ARRAY['security_invoker=true']) <> 2 THEN
    RAISE EXCEPTION 'rollback:前台 view 掉了 security_invoker=true';
  END IF;
  RAISE NOTICE '✅ rollback 20260927040000:兩個 view 與 trigger 函式已回到上一代(staff_overrides 欄與 CHECK 刻意留著)';
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
