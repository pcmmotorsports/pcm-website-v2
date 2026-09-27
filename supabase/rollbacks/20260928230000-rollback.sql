-- 20260928230000-rollback.sql —— 退 20260928230000_m4b_sale_price_read_paths.sql(商品頁乙 P-M4)
-- 🔴 順序(計畫第八節第 5 節):先退後台特價入口(P14)⇒ 跑 20260928200000-rollback.sql 清光特價並確認規格表特價欄全空
--    ⇒ 退前台顯示(P12、P13)⇒ 最後跑本檔。
-- 退什麼:get_effective_prices 換回 20260925050000 那一版;三個 view 的價格欄換回商品層 / 規格表的一般價。
-- 🔴 不退什麼:
--   · create_order(單價核對與實際一般價)【不退】(R5-1):特價清光之後它和原本收一樣的錢,只多了核對;
--     P-M5 之後前台一律帶核對值,退回反而會打開「看舊價、付新價」的入口。
--   · 三個 view 最後的 original_price 欄【保留】,值一律 NULL(= 沒有特價)。不用 DROP VIEW:products_list_dealer 依賴
--     products_list_public,DROP 會被擋、CASCADE 會連經銷目錄一起刪(R4-2)。計畫原本寫「照抄一般價」;
--     改成 NULL:這一欄的意思是「生效中特價的原價」,NULL = 沒有生效的特價,和新版語意一致。
--   · 權限(anon / authenticated 讀特價欄、執行共用函式)留著:特價已清光,讀到的都是空值。
-- 冪等:前置閘比 P-M4 的指紋,已經退過就停。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $gate$
DECLARE
  v_sp text := pg_catalog.current_setting('search_path');
  v_pp text; v_lp text; v_vp text;
BEGIN
  PERFORM pg_catalog.set_config('search_path', '', true);
  v_pp := pg_catalog.md5(pg_catalog.pg_get_viewdef('public.products_public'::regclass, true));
  v_lp := pg_catalog.md5(pg_catalog.pg_get_viewdef('public.products_list_public'::regclass, true));
  v_vp := pg_catalog.md5(pg_catalog.pg_get_viewdef('public.product_variants_public'::regclass, true));
  PERFORM pg_catalog.set_config('search_path', v_sp, true);
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = 'public.get_effective_prices(uuid[], uuid[])'::regprocedure) IS DISTINCT FROM '636409bea9cff799d5636805809f177d'
     OR v_pp IS DISTINCT FROM 'aff5b27fd3d1607977af8759a9e41465'
     OR v_lp IS DISTINCT FROM '327d0722ce557c3adb7624946b762374'
     OR v_vp IS DISTINCT FROM 'e10ee1333d9d3c092034b9cf88d23a16' THEN
    RAISE EXCEPTION '退回前置閘①:現役不是 20260928230000 那一版(已經退過,或之後又有人改)⇒ 停。';
  END IF;
  IF EXISTS (SELECT 1 FROM public.product_variants WHERE sale_price_general IS NOT NULL) THEN
    RAISE EXCEPTION '退回前置閘②:還有規格設著特價 ⇒ 先跑 20260928200000-rollback.sql 清光,再退本檔(否則結帳收特價、畫面顯示原價)。';
  END IF;
END
$gate$;

CREATE OR REPLACE FUNCTION public.get_effective_prices(p_product_ids uuid[] DEFAULT NULL::uuid[], p_variant_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(kind text, id uuid, amount integer, currency text, tier text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_tier   text := 'general';
  v_n_prod integer;
  v_n_var  integer;
  v_uid  uuid := auth.uid();
BEGIN
  -- 🔴 輸入上限:防有人一次要十萬個 id 把 definer 權限當成掃表工具。
  -- 🔴 兩個陣列**一起數** —— 分開數會讓「100 + 150」通過一個 200 的上限。
  -- 🔴🔴 `coalesce` 不加 `pg_catalog.` —— **我在同一支檔裡犯了第二次**, 而這次是
  --    【那道強化過的斷言自己抓到的】(它真的叫了一發 ⇒ 立刻紅、apply 失敗)。
  --    📌 上一次是靜態全過 / apply 成功 / 斷言也過, 只有拋棄式 PG 真的叫才紅;
  --      這一次**斷言就是那個叫的人** ⇒ 那次的補強在同一支檔上立刻收到回報。
  v_n_prod := coalesce(pg_catalog.cardinality(p_product_ids), 0);
  v_n_var  := coalesce(pg_catalog.cardinality(p_variant_ids), 0);
  IF v_n_prod + v_n_var = 0 THEN
    RETURN;
  END IF;
  -- 🔴🔴 **`array_length(a, 1)` 只量【第一維】** —— codex R1 must-fix ①:
  --    餵一個 2×200 的陣列, 第一維長度是 **2** ⇒ 上限形同虛設而實際查了 400 個 id。
  --    ✅ `cardinality()` 數的是**總元素數**;而多維陣列本身沒有正當用途 ⇒ 直接拒。
  IF p_product_ids IS NOT NULL AND pg_catalog.array_ndims(p_product_ids) <> 1 THEN
    RAISE EXCEPTION 'get_effective_prices:p_product_ids 只收一維陣列(收到 % 維)',
      pg_catalog.array_ndims(p_product_ids);
  END IF;
  IF p_variant_ids IS NOT NULL AND pg_catalog.array_ndims(p_variant_ids) <> 1 THEN
    RAISE EXCEPTION 'get_effective_prices:p_variant_ids 只收一維陣列(收到 % 維)',
      pg_catalog.array_ndims(p_variant_ids);
  END IF;
  IF v_n_prod + v_n_var > 200 THEN
    RAISE EXCEPTION 'get_effective_prices:一次最多 200 個 id(商品 % + 變體 % = %)',
      v_n_prod, v_n_var, v_n_prod + v_n_var;
  END IF;

  -- 🔴 tier 只從 auth.uid() 查, 不從參數來。查不到 ⇒ 維持 general(fail-closed 方向:
  --    「拿不到身分」的結果是【看到公開價】, 不是【看到經銷價】)。
  -- 🔴 plan §G(codex R1 must-fix ③):**缺身分不得靜默成功。**
  --    有 EXECUTE 的人卻沒有 uid ⇒ 那不是訪客, 是接線壞了(client 用了不帶 JWT 的 key)。
  --    而它與「這件商品沒有經銷折扣」在回傳值上**長得一模一樣** ⇒ 沒有訊號就永遠不會有人知道。
  --    🛑 只記【有沒有拿到 uid】與【有沒有找到 customer】—— **不記 uid 本身**(那是個資)。
  IF v_uid IS NULL THEN
    RAISE WARNING 'get_effective_prices:沒有 auth.uid() ⇒ 一律 general。'
      '呼叫端若是【登入的客人】, 這代表它用了不帶 JWT 的 client(接線壞了, 不是訪客)。';
  END IF;
  IF v_uid IS NOT NULL THEN
    SELECT c.tier INTO v_tier
      FROM public.customers c
     WHERE c.user_id = v_uid
     LIMIT 1;
    IF NOT FOUND THEN
      RAISE WARNING 'get_effective_prices:有 auth.uid() 而 customers 查無此人 ⇒ 一律 general。'
        '這通常代表註冊流程沒有把 customers 那一列建起來。';
    END IF;
    IF v_tier IS NULL OR v_tier NOT IN ('general', 'store') THEN
      -- 🔵 `premiumStore` 也走這裡 ⇒ 本片降級成 general(plan §C:本片不做 premiumStore)。
      v_tier := 'general';
    END IF;
  END IF;

  -- 🔴🔴 **無效金額不得靜默回成功**(codex R1 must-fix ②)——
  --    表上的 CHECK 只保證 `general` / `store` 兩個【鍵存在】, 不保證裡面有 `amount`、
  --    也不保證它是正數。⇒ store 缺 amount ⇒ 以前會**成功回一列 amount = NULL**,
  --    而呼叫端的「RPC 失敗」處理**不會啟動** ⇒ 客人看到空白或 0, 而系統覺得一切正常。
  -- ✅ 處置分兩層:①那個 tier 取不到有效金額 ⇒ ~~退回 general~~ D1 起 store 回 NULL(不能買),其他 tier 仍退回 general
  --              ②連 general 都取不到 ⇒ **RAISE** —— 那是資料壞了, 要有人知道。
  RETURN QUERY
  SELECT 'product'::text, p.id,
         CASE
           -- 🔴 2026-09-24 經銷價修正(docs/plans/2026-09-24-dealer-price-fix-before-b2b-plan.md §3.4):
           --    經銷會員的商品價【不再讀 price_by_tier.store】—— 沒開灌價的供應商那一格是過期舊價
           --    (正式庫 2026-09-24 唯讀:1,086 件比一般價貴)。改讀【基準款變體】的 price_store,
           --    與結帳收錢的 create_order 同一欄;~~取不到退回一般價~~ D1 起取不到回 NULL。
           --    基準款 = 一般價最低、同價 sku 最小(COLLATE "C" 對齊 rpm-transform.ts:448-452 的 JS 比較)。
           -- 🔴 20260925040000(§10.3):再套品牌額外折扣, 與目錄、結帳同一支 dealer_discounted_amount。
           -- 🔴 20260925050000(B2B D1,Sean Q3 甲):缺經銷價 ⇒ NULL(畫面「價格暫時無法取得」、不能買),不再退回一般價。
           WHEN v_tier = 'store' THEN public.dealer_discounted_amount(v_uid, p.brand_id,
             (SELECT bv.price_store
                FROM public.product_variants bv
               WHERE bv.product_id = p.id
               ORDER BY bv.price_general ASC NULLS LAST, bv.sku COLLATE "C" ASC
               LIMIT 1))
           WHEN (p.price_by_tier -> v_tier ->> 'amount') ~ '^[0-9]+$'
             THEN (p.price_by_tier -> v_tier ->> 'amount')::integer
           WHEN (p.price_by_tier -> 'general' ->> 'amount') ~ '^[0-9]+$'
             THEN (p.price_by_tier -> 'general' ->> 'amount')::integer
           ELSE NULL
         END,
         -- 🔴 `coalesce` **不加 `pg_catalog.` 前綴** —— 它是 SQL 關鍵字不是 pg_catalog 裡的函式,
         --    加了前綴會在【執行期】丟 `function pg_catalog.coalesce(text, unknown) does not exist`。
         --    🛑 而 `SET search_path = ''` 之下它照樣解析得到(關鍵字不走 search_path)。
         --    🔬 這一格是**拋棄式 PG 實跑抓到的** —— 七道靜態檢查全過、apply 也成功、
         --      收權斷言也過(它們都沒有真的【叫】這支函式回一列)⇒ 📌 **只有真的叫一次才問得出來。**
         coalesce(p.price_by_tier -> v_tier ->> 'currency', 'TWD'),
         v_tier
    FROM public.products p
   WHERE p_product_ids IS NOT NULL
     AND p.id = ANY(p_product_ids)
     -- 🔵 下架的不回(與公開投影 `USING (delisted_at IS NULL)` 同一條線)。
     AND p.delisted_at IS NULL;

  -- ══ 變體那一半 ══════════════════════════════════════════════
  -- 🔴 **形狀與商品那一半【不同】, 而那不是我選的** —— `product_variants` 存的是
  --    **兩個整數欄** `price_general` / `price_store`(`20260531142533:31` 逐字),
  --    不是 `price_by_tier` jsonb。⇒ 這裡不能照抄上面那段 `->` 取值。
  -- 🔵 「取不到有效金額 ⇒ 退 general」兩半的**方向**一致(用 coalesce 的順序表達)。
  -- ⛔ ~~而我原本寫「規則兩半**一致**」~~ —— codex R2 推翻:**不一致**。
  --    商品半用 CASE + 正則(它要擋 jsonb 裡的非數字字串);變體半是整數欄, 沒有那個問題。
  --    而「兩價皆 NULL」那個世界**原本只有商品半會出聲** ⇒ 已補變體半的 WARNING(見下)。
  RETURN QUERY
  SELECT 'variant'::text, v.id,
         CASE
           -- 🔴 20260925040000(§10.3):品牌取【母商品】的 brand_id(變體沒有自己的品牌)。
           WHEN v_tier = 'store' THEN public.dealer_discounted_amount(v_uid, pp.brand_id, v.price_store) -- 20260925050000 D1:缺經銷價 ⇒ NULL
           ELSE v.price_general
         END,
         'TWD'::text,
         v_tier
    FROM public.product_variants v
    -- 🔴🔴 **母商品下架 ⇒ 變體也不回**(codex R2 must-fix ①)。
    --    ⛔ 我原本只查 `v.id = ANY(...)` ⇒ 母商品下架時**商品半不回價而變體半照回**
    --      ⇒ 📌 **客人買得到一個已經下架的東西, 而畫面上完全正常。**
    --    🛑 而既有的 RLS 過濾**保護不了這條** —— `SECURITY DEFINER` 用 owner 的權限跑。
    JOIN public.products pp ON pp.id = v.product_id AND pp.delisted_at IS NULL
   WHERE p_variant_ids IS NOT NULL
     AND v.id = ANY(p_variant_ids);

  -- 🔴 變體那半的「連 general 都取不到」也要出聲(codex R2 must-fix ②)——
  --    ⛔ 下面那道 WARNING **只查 `products`, 接不到變體** ⇒ 變體兩價皆 NULL 會靜默回空金額。
  IF EXISTS (
    SELECT 1 FROM public.product_variants v
      JOIN public.products pp ON pp.id = v.product_id AND pp.delisted_at IS NULL
     WHERE p_variant_ids IS NOT NULL
       AND v.id = ANY(p_variant_ids)
       AND coalesce(CASE WHEN v_tier = 'store' THEN coalesce(v.price_store, v.price_general)
                         ELSE v.price_general END, -1) < 0
  ) THEN
    RAISE WARNING 'get_effective_prices:有【變體】連 general 都取不到有效金額 ⇒ 那一列的 amount 是 NULL。'
      '這是【資料壞了】不是【沒有折扣】, 要有人去看。';
  END IF;

  -- 🔴 ②那一層:上面那個 CASE 只在「連 general 也壞」時才會留下 NULL ⇒ 這裡把它變成【出聲】。
  --    🛑 分開寫而不寫進 CASE:CASE 裡 RAISE 不了, 而**回一個 NULL 然後假裝成功**正是本條要修的病。
  IF EXISTS (
    SELECT 1 FROM public.products p
     WHERE p.id = ANY(p_product_ids)
       AND p.delisted_at IS NULL
       AND (p.price_by_tier -> 'general' ->> 'amount') !~ '^[0-9]+$'
       -- 🔴 2026-09-24:store 那一格改看基準款變體(與上面 RETURN QUERY 同一個來源), 不再看 price_by_tier.store。
       AND CASE WHEN v_tier = 'store'
                THEN (SELECT bv.price_store
                        FROM public.product_variants bv
                       WHERE bv.product_id = p.id
                       ORDER BY bv.price_general ASC NULLS LAST, bv.sku COLLATE "C" ASC
                       LIMIT 1) IS NULL
                ELSE (p.price_by_tier -> v_tier ->> 'amount') !~ '^[0-9]+$'
           END
  ) THEN
    RAISE WARNING 'get_effective_prices:有商品連 general 都取不到有效金額 ⇒ 那一列的 amount 是 NULL。'
      '這是【資料壞了】不是【沒有折扣】, 要有人去看。';
  END IF;
END;
$function$;

CREATE OR REPLACE VIEW public.products_public WITH (security_invoker = true) AS
SELECT
  p.id,
  p.external_id,
  COALESCE(NULLIF(pg_catalog.btrim(p.staff_overrides ->> 'title', E' \t\r\n　'), ''), p.title) AS title,
  COALESCE(NULLIF(pg_catalog.btrim(p.staff_overrides ->> 'subtitle', E' \t\r\n　'), ''), p.subtitle) AS subtitle,
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
  COALESCE(NULLIF(p.staff_overrides -> 'highlights', '[]'::jsonb), p.highlights) AS highlights,
  p.manuals,
  p.video_url,
  CASE WHEN t.url IS NULL THEN NULL ELSE jsonb_build_object(
    'l', t.bbox_left, 't', t.bbox_top, 'w', t.bbox_width, 'h', t.bbox_height,
    'nw', t.natural_width, 'nh', t.natural_height) END AS card_image_trim,
  p.sound_clips,
  p.content_changed_at,
  NULL::integer AS original_price
FROM public.products p
LEFT JOIN public.product_image_trim t ON t.url = p.images ->> 0 AND t.status = 'ok';

COMMENT ON VIEW public.products_public IS '20260928230000 已退回:price_general 為原本的一般價;最後一欄 original_price 保留、一律 NULL(沒有特價)。security_invoker=true。';

CREATE OR REPLACE VIEW public.products_list_public WITH (security_invoker = true) AS
SELECT
  p.id,
  COALESCE(NULLIF(pg_catalog.btrim(p.staff_overrides ->> 'title', E' \t\r\n　'), ''), p.title) AS title,
  COALESCE(NULLIF(pg_catalog.btrim(p.staff_overrides ->> 'subtitle', E' \t\r\n　'), ''), p.subtitle) AS subtitle,
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
  p.created_at,
  NULL::integer AS original_price
FROM public.products p
JOIN public.brands b ON b.id = p.brand_id
JOIN public.categories c ON c.id = p.category_id;

COMMENT ON VIEW public.products_list_public IS '20260928230000 已退回:price_general 為原本的一般價;最後一欄 original_price 保留、一律 NULL(沒有特價)。security_invoker=true。';

CREATE OR REPLACE VIEW public.product_variants_public WITH (security_invoker = true) AS
SELECT
  id,
  product_id,
  sku,
  spec,
  price_general,
  availability,
  images,
  sort_order,
  created_at,
  updated_at,
  supplier_slug,
  NULL::integer AS original_price
FROM public.product_variants;

COMMENT ON VIEW public.product_variants_public IS '20260928230000 已退回:price_general 為原本的一般價;最後一欄 original_price 保留、一律 NULL(沒有特價)。security_invoker=true。';


DO $post$
BEGIN
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = 'public.get_effective_prices(uuid[], uuid[])'::regprocedure) IS DISTINCT FROM 'c40796dbfc8c46a9592ea8ca7bf1701d' THEN
    RAISE EXCEPTION '退回事後閘①:get_effective_prices 沒有換回 20260925050000 那一版 ⇒ 停。';
  END IF;
  IF pg_catalog.strpos(pg_catalog.pg_get_viewdef('public.products_public'::regclass, true), 'pcm_effective_general_price') > 0
     OR pg_catalog.strpos(pg_catalog.pg_get_viewdef('public.products_list_public'::regclass, true), 'pcm_effective_general_price') > 0
     OR pg_catalog.strpos(pg_catalog.pg_get_viewdef('public.product_variants_public'::regclass, true), 'pcm_effective_general_price') > 0 THEN
    RAISE EXCEPTION '退回事後閘②:view 還在讀實際一般價 ⇒ 停。';
  END IF;
  IF pg_catalog.to_regclass('public.products_list_dealer') IS NULL THEN
    RAISE EXCEPTION '退回事後閘③:經銷目錄 view 不見了 ⇒ 停。';
  END IF;
  RAISE NOTICE '✅ rollback 20260928230000:get_effective_prices 與三個 view 已換回原價;create_order 的單價核對刻意保留';
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
