-- 20260927040000_m4b_products_staff_overrides.sql —— 商品編輯丙方案片 1:員工自己的值(同步永遠不寫)蓋過供應商的值
-- pcm:idempotent: yes
--   ↑ 重跑同形:欄 ADD … IF NOT EXISTS(型別由前置閘擋)· CHECK 先 DROP IF EXISTS 再建 · GRANT 可重下 ·
--     函式 CREATE OR REPLACE · 兩個 view CREATE OR REPLACE 同欄數同型別。拋棄式 PG 實跑:套用 → 重跑 → 回滾 → 再套用(見 commit message)。
-- ACL-GATE-EXEMPT: public.products -- 只開 staff_overrides 一欄的欄位級 SELECT 給 anon/authenticated:products_public / products_list_public 都是 security_invoker=true,漏這道 grant 前台讀 view 會 permission denied(先例 20260808000000:45、20260915220000 ⑤)。欄內能放什麼由本支的 CHECK 鎖死(只允許 title / subtitle / highlights),不公開的東西放不進去。
-- pcm:rule1-exception: 欄位 ADD COLUMN IF NOT EXISTS 與 products_content_changed_guard() CREATE OR REPLACE 都是為了重貼冪等;欄已存在而型別不是 jsonb 由前置閘① RAISE,函式本體不是預期的兩代之一由前置閘④ RAISE。
--
-- 🛑 未貼。只做不貼,貼的人是 Sean(點名那一次)。
--    plan:~/pcm-mailbox/60-線2-20-商品編輯-選項丙-plan-20260825.md(Sean 2026-08-31 批,轉錄)
--          ~/pcm-mailbox/計畫-後台商品編輯與上傳圖片-20260927.md(片 1)
--
-- ══ 為什麼 ══════════════════════════════════════════
-- Sean 2026-08-26 Q1 選丙:「不搶供應商的格子,另外加我們自己的;有填就用我們的,沒填就用供應商的」。
-- 每日同步(scripts/rpm-transform.ts ProductRow → rpm-import.ts upsertBatched)只寫 payload 裡帶的欄;
-- 2026-09-27 對 gbracing 乾跑(--dry-run --limit=1)印出的商品列 key = supplier_slug external_id handle title subtitle
-- description highlights manuals price_general price_store price_by_tier fitments images availability brand_id category_id
-- metadata updated_at ⇒ 沒有 staff_overrides ⇒ 同步永遠不會蓋掉它(同 delisted_at 的先例,rpm-transform.ts:354)。
--
-- ══ 做什麼 ══════════════════════════════════════════
-- ① products.staff_overrides jsonb NOT NULL DEFAULT '{}'(PG11+ 常數預設 = 只改目錄,不重寫整表)
-- ② CHECK:必須是物件;只允許 title / subtitle(字串)、highlights(字串陣列)三個鍵
--    🔴 客人讀得到這一欄的原始 jsonb(⑤)⇒ 這道 CHECK 就是「不准放成本 / 經銷價 / 內部備註」的機制,不只是註解。
--       之後的片要加鍵(例如 images)必須改這道 CHECK。
-- ③ products_content_changed_guard() 的比對多一欄 staff_overrides ⇒ 員工改了,sitemap lastmod 也會動
--    (其餘逐字照抄 20260915220000:105-123;正式庫 prosrc 2026-09-27 唯讀比對與 repo 逐行相同)
-- ④ products_public(21 欄):title / subtitle / highlights 三欄改成「我們的 → 供應商的」;其餘 18 欄逐字照抄 20260915220000:181-207
-- ⑤ products_list_public(16 欄):title / subtitle 兩欄同上;其餘 14 欄逐字照抄 20260811040000(正式庫 pg_get_viewdef 2026-09-27 同形)
-- ⑥ GRANT SELECT (staff_overrides) ON products TO anon, authenticated
--
-- 🔴 description【刻意不在本支】:Sean 2026-09-02 拍 ⟦b4-QUOTEDESCLOCK⟧「甲 要, 現在做(三段:後台能改 + 留記號 + 同步跳過)」,
--    機制是直接改 products.description + description_locked(20260902190000,trigger 擋同步)。那一板晚於 08-31 批丙,
--    而且已經上線 ⇒ 說明欄走那一套,本支不再開第二條路(兩套並存 = 客人看到哪一份要看兩個旗標)。
-- 🔴 空字串不算「有填」:NULLIF(…, '') ⇒ 員工存了空白標題,客人看到的是供應商的,不是一片空白。
-- 🔵 products_list_dealer(b2b)讀的是 products_list_public 的 v.title / v.subtitle ⇒ 自動跟著走;欄型別不變(text),依賴它的 view 不受影響。
-- 🔵 讀這兩個 view 的函式(search_catalog_by_vehicle 等 8 支,正式庫 2026-09-27 列舉)拿的是合併後的值。
--    ⚠️ 但【關鍵字搜尋】storefront_search_product_ids 直接比 public.products 的 p.title / p.subtitle
--    (20260921010000:~170)⇒ 員工改過的標題【搜不到新字】,只搜得到供應商原字。那是另一片(動搜尋函式與索引),本支不碰。
--
-- ══ 貼的時候 ══════════════════════════════════════════
-- · ALTER TABLE 拿 ACCESS EXCLUSIVE 到 COMMIT;本支沒有回填,ADD CONSTRAINT 要掃一次全表(約 2.8 萬列)驗 CHECK。
--   避開每日同步(rpm-sync.yml,台灣 12:30 起約 10–15 分)與客人多的時段。lock_timeout 5s。
-- · 顧客站不用改:兩個 view 欄名 / 欄數 / 型別都不變。後台要能寫這一欄是片 2。
-- · 回滾:supabase/rollbacks/20260927040000-rollback.sql —— 把兩個 view 與函式換回上一代;欄與 CHECK 刻意留著(惰性)。
-- ═══════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $pre$
DECLARE
  v_type text;
  v_cols text[];
  v_md5  text;
BEGIN
  -- 前置閘①:欄若已存在(重跑),型別必須是 jsonb
  SELECT pg_catalog.format_type(a.atttypid, a.atttypmod) INTO v_type
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.products'::regclass AND a.attname = 'staff_overrides' AND NOT a.attisdropped;
  IF v_type IS NOT NULL AND v_type <> 'jsonb' THEN
    RAISE EXCEPTION 'staff_overrides:欄已存在而型別是 %,不是 jsonb;拒繼續', v_type;
  END IF;

  -- 前置閘②:products_public 必須是 21 欄那一代(20260915220000)
  SELECT pg_catalog.array_agg(a.attname::text ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.products_public'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols IS DISTINCT FROM ARRAY['id','external_id','title','subtitle','description','handle','fitments','images',
       'availability','brand_id','category_id','created_at','updated_at','price_general','supplier_slug','highlights',
       'manuals','video_url','card_image_trim','sound_clips','content_changed_at']::text[] THEN
    RAISE EXCEPTION 'staff_overrides:products_public 欄位不是預期的那一代(實得 %);拒繼續', v_cols;
  END IF;

  -- 前置閘③:products_list_public 必須是 16 欄那一代(20260811040000)
  SELECT pg_catalog.array_agg(a.attname::text ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.products_list_public'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols IS DISTINCT FROM ARRAY['id','title','subtitle','handle','brand_id','category_id','availability','fitments',
       'price_general','supplier_slug','card_image','fits','brand_name','brand_slug','category_raw','created_at']::text[] THEN
    RAISE EXCEPTION 'staff_overrides:products_list_public 欄位不是預期的那一代(實得 %);拒繼續', v_cols;
  END IF;

  -- 前置閘④:products_content_changed_guard() 本體必須是 20260915220000 那一代(或本支重跑後的那一代)
  --   ⇒ 有人在兩支之間改過它,本支不要照舊範本蓋掉(CREATE OR REPLACE 會整支換掉)。
  SELECT pg_catalog.md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.products_content_changed_guard()');
  IF v_md5 IS NULL THEN
    RAISE EXCEPTION 'staff_overrides:找不到 products_content_changed_guard();拒繼續';
  END IF;
  IF v_md5 NOT IN ('a963db38a9a022d78b2505d7202d6fe1', 'b697fd2c412c3a450d5ce19c84109591') THEN
    RAISE EXCEPTION 'staff_overrides:products_content_changed_guard() 本體 md5 = %,不是預期的兩代之一;拒繼續', v_md5;
  END IF;
END
$pre$;

-- ① 欄
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS staff_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ② CHECK:只允許三個鍵,各自的型別固定
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_staff_overrides_shape;
ALTER TABLE public.products ADD CONSTRAINT products_staff_overrides_shape CHECK (
  pg_catalog.jsonb_typeof(staff_overrides) = 'object'
  AND (staff_overrides - ARRAY['title', 'subtitle', 'highlights']::text[]) = '{}'::jsonb
  AND (NOT (staff_overrides ? 'title')      OR pg_catalog.jsonb_typeof(staff_overrides -> 'title') = 'string')
  AND (NOT (staff_overrides ? 'subtitle')   OR pg_catalog.jsonb_typeof(staff_overrides -> 'subtitle') = 'string')
  AND (NOT (staff_overrides ? 'highlights') OR pg_catalog.jsonb_typeof(staff_overrides -> 'highlights') = 'array')
);

COMMENT ON COLUMN public.products.staff_overrides IS
  '員工自己填的值,有填就蓋過供應商的(Sean 2026-08-26 Q1 丙;20260927040000)。每日同步永遠不寫這一欄。
🔴 anon / authenticated 讀得到原始 jsonb(兩個前台 view 是 security_invoker)⇒ 不准放任何不公開的東西。
CHECK products_staff_overrides_shape 只允許 title / subtitle(字串)、highlights(字串陣列)。要加鍵先改 CHECK。
description 不走這一欄:走 description + description_locked(Sean 2026-09-02 ⟦b4-QUOTEDESCLOCK⟧)。';

-- ③ content_changed_at 的比對多一欄 staff_overrides(其餘逐字照抄 20260915220000:105-123)
CREATE OR REPLACE FUNCTION public.products_content_changed_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.content_changed_at := pg_catalog.now();
  ELSIF (OLD.title, OLD.subtitle, OLD.description, OLD.highlights, OLD.images, OLD.price_general,
         OLD.availability, OLD.fitments, OLD.video_url, OLD.manuals, OLD.sound_clips, OLD.brand_id, OLD.category_id,
         OLD.staff_overrides)
        IS DISTINCT FROM
        (NEW.title, NEW.subtitle, NEW.description, NEW.highlights, NEW.images, NEW.price_general,
         NEW.availability, NEW.fitments, NEW.video_url, NEW.manuals, NEW.sound_clips, NEW.brand_id, NEW.category_id,
         NEW.staff_overrides)
  THEN
    NEW.content_changed_at := pg_catalog.now();
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.products_content_changed_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.products_content_changed_guard() FROM anon, authenticated;

-- ⑥ 欄位級讀權限(要在兩個 view 之前:view 是 security_invoker)
GRANT SELECT (staff_overrides) ON public.products TO anon, authenticated;

-- ④ products_public(21 欄)—— title / subtitle / highlights 三欄合併,其餘逐字照抄 20260915220000:181-207
-- ⚠️ 經銷防護回歸點:絕無 price_by_tier / price_store / metadata / delisted_at / staff_overrides 本身;
--    security_invoker=true 不可漏;card_image_trim 的 LEFT JOIN 與 CASE 逐字保留。
CREATE OR REPLACE VIEW products_public WITH (security_invoker = true) AS
SELECT
  p.id,
  p.external_id,
  COALESCE(NULLIF(p.staff_overrides ->> 'title', ''), p.title) AS title,
  COALESCE(NULLIF(p.staff_overrides ->> 'subtitle', ''), p.subtitle) AS subtitle,
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
  COALESCE(p.staff_overrides -> 'highlights', p.highlights) AS highlights,
  p.manuals,
  p.video_url,
  CASE WHEN t.url IS NULL THEN NULL ELSE jsonb_build_object(
    'l', t.bbox_left, 't', t.bbox_top, 'w', t.bbox_width, 'h', t.bbox_height,
    'nw', t.natural_width, 'nh', t.natural_height) END AS card_image_trim,
  p.sound_clips,
  p.content_changed_at
FROM products p
LEFT JOIN public.product_image_trim t ON t.url = p.images ->> 0 AND t.status = 'ok';
-- 🔵 刻意【不】重下 GRANT SELECT ON products_public:CREATE OR REPLACE VIEW 保留既有 ACL(同 20260915220000 那段理由)。

COMMENT ON VIEW products_public IS
  'Detail projection(20260915220000 共 21 欄;20260927040000 起 title / subtitle / highlights 取 staff_overrides 優先、供應商值其次,欄名欄數不變):含 price_general / supplier_slug / highlights / manuals / video_url / card_image_trim / sound_clips / content_changed_at;security_invoker=true;不含 price_store、price_by_tier、metadata、delisted_at、staff_overrides 原欄。';

-- ⑤ products_list_public(16 欄)—— title / subtitle 兩欄合併,其餘逐字照抄 20260811040000
CREATE OR REPLACE VIEW public.products_list_public WITH (security_invoker = true) AS
SELECT
  p.id,
  COALESCE(NULLIF(p.staff_overrides ->> 'title', ''), p.title) AS title,
  COALESCE(NULLIF(p.staff_overrides ->> 'subtitle', ''), p.subtitle) AS subtitle,
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
-- 🔵 同上:不重下 GRANT(CREATE OR REPLACE VIEW 保留既有 ACL)。

COMMENT ON VIEW public.products_list_public IS
  'P4 list projection: card-only public fields + brand/category display keys + created_at (16 cols). 20260927040000: title / subtitle prefer staff_overrides over supplier values (same names/types). security_invoker=true; excludes price_store, price_by_tier, metadata, detail content, delisted_at and the raw staff_overrides column.';

DO $post$
DECLARE
  v_n     int;
  v_md5   text;
BEGIN
  -- 事後閘①:欄在、型別 jsonb、NOT NULL、CHECK 在
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.products'::regclass AND a.attname = 'staff_overrides' AND NOT a.attisdropped
       AND a.atttypid = 'jsonb'::regtype AND a.attnotnull
  ) THEN
    RAISE EXCEPTION 'staff_overrides:事後欄不在,或不是 jsonb NOT NULL';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
     WHERE conrelid = 'public.products'::regclass AND conname = 'products_staff_overrides_shape' AND contype = 'c' AND convalidated
  ) THEN
    RAISE EXCEPTION 'staff_overrides:事後 CHECK products_staff_overrides_shape 不在或未驗證';
  END IF;

  -- 事後閘②:兩個 view 欄數不變,而且都沒有把原欄 / 經銷欄帶出去
  SELECT pg_catalog.count(*) INTO v_n FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.products_public'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_n <> 21 THEN RAISE EXCEPTION 'staff_overrides:products_public 事後 % 欄,不是 21', v_n; END IF;
  SELECT pg_catalog.count(*) INTO v_n FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.products_list_public'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_n <> 16 THEN RAISE EXCEPTION 'staff_overrides:products_list_public 事後 % 欄,不是 16', v_n; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
     WHERE a.attrelid IN ('public.products_public'::regclass, 'public.products_list_public'::regclass)
       AND a.attnum > 0 AND NOT a.attisdropped
       AND a.attname IN ('staff_overrides', 'price_by_tier', 'price_store', 'metadata', 'delisted_at')
  ) THEN
    RAISE EXCEPTION 'staff_overrides:前台 view 多出了不該公開的欄';
  END IF;

  -- 事後閘③:兩個 view 仍是 security_invoker
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_class c
       WHERE c.oid IN ('public.products_public'::regclass, 'public.products_list_public'::regclass)
         AND c.reloptions @> ARRAY['security_invoker=true']) <> 2 THEN
    RAISE EXCEPTION 'staff_overrides:前台 view 掉了 security_invoker=true';
  END IF;

  -- 事後閘④:anon / authenticated 讀得到那一欄(否則前台讀 view 會 permission denied)
  IF NOT pg_catalog.has_column_privilege('anon', 'public.products', 'staff_overrides', 'SELECT')
     OR NOT pg_catalog.has_column_privilege('authenticated', 'public.products', 'staff_overrides', 'SELECT') THEN
    RAISE EXCEPTION 'staff_overrides:anon / authenticated 讀不到 products.staff_overrides';
  END IF;

  -- 事後閘⑤:trigger 函式是新的那一代,而且 search_path 還在(CREATE OR REPLACE 會整組換掉 SET 子句)
  SELECT pg_catalog.md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.products_content_changed_guard()'::regprocedure;
  IF v_md5 IS DISTINCT FROM 'b697fd2c412c3a450d5ce19c84109591' THEN
    RAISE EXCEPTION 'staff_overrides:products_content_changed_guard() 事後 md5 = %,不是本支那一代', v_md5;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid = 'public.products_content_changed_guard()'::regprocedure
       AND p.proconfig @> ARRAY['search_path=""']
  ) THEN
    RAISE EXCEPTION 'staff_overrides:products_content_changed_guard() 掉了 SET search_path';
  END IF;
  IF pg_catalog.has_function_privilege('anon', 'public.products_content_changed_guard()'::regprocedure, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.products_content_changed_guard()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'staff_overrides:products_content_changed_guard() 對 anon / authenticated 開著 EXECUTE';
  END IF;

  RAISE NOTICE '✅ staff_overrides:欄與 CHECK 在、兩個 view 欄數不變且未外露原欄、anon 讀得到該欄、trigger 函式是新一代';
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
