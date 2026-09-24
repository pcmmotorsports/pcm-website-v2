-- ============================================================
-- 經銷價修正:目錄頁與商品頁改讀【基準款變體】的經銷價
-- ============================================================
-- plan:docs/plans/2026-09-24-dealer-price-fix-before-b2b-plan.md(Sean 2026-09-24 選 Q1 甲)
-- 退回檔:supabase/rollbacks/20260924100000-rollback.sql(檔內第一行就是 SET LOCAL lock_timeout)
--
-- 改兩樣東西, 都只改【讀】, 不改寫入、不改簽章、不改權限:
--   A. view `products_list_dealer`(經銷目錄頁):價格欄從 `coalesce(pr.price_store, …)`
--      改成基準款變體的 `product_variants.price_store`。`products.price_store` 同步程式永遠寫 NULL
--      (scripts/rpm-transform.ts:534)⇒ 今天經銷目錄一律退回一般價。
--   B. 函式 `get_effective_prices` 商品那一半(商品頁還沒選規格時):經銷會員原本讀
--      `price_by_tier.store`。那一格在沒開灌價的供應商是【過期舊價】
--      (rpm-transform.ts:653-658 只帶舊值, 而一般價每輪重算)。
--      正式庫 2026-09-24 唯讀:與一般價不同 1,109 件、比一般價貴 1,086 件。
--
-- 為什麼接基準款變體:真的經銷價只會灌進 `product_variants.price_store`, 結帳也只收這一欄
--   (create_order `20260915100000:377` 逐字 `coalesce(v_variant.price_store, v_variant.price_general)`)。
--   基準款 = 一般價最低、同價 sku 最小, 與同步程式選商品一般價那一支同一條規則(rpm-transform.ts:448-452)。
--   `COLLATE "C"`:同步程式用 JS 字元碼比較 sku;資料庫預設 en_US.UTF-8 大小寫與符號順序不同
--   (R2 實查:不加會有 12 件選到不同變體;sku 全 ASCII ⇒ "C" 與 JS 比較結果相同)。
--
-- 🔵 今天貼下去【畫面上一個數字都不會變】:變體經銷價非空只有 1 筆(PCM-BALANCE-1, 與一般價相等)。
--    經銷會員 0 人。真經銷價要等灌價(Sean 說「灌」)才會出現。
-- 🛑 本檔證不到:
--   · SQL 選的基準款與同步程式選的是不是同一支 —— 同步程式沒把基準款存進資料庫, 純 SQL 量不到。
--     另有 6 件商品一般價 ≠ 最低變體一般價(原因未查)。只影響目錄與商品頁【顯示】, 收錢照客人選的那一支。
--   · 效能:view 的價格欄參與篩選與排序, LATERAL 會對整個候選集算。貼前要用最差查詢量(plan 片 1)。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL quote_all_identifiers = off;

DO $pre$
DECLARE
  v_def   text;
  v_cols  text;
  v_want  text := 'id,title,subtitle,handle,brand_id,category_id,availability,fitments,'
                  || 'price_general,supplier_slug,card_image,fits,brand_name,brand_slug,category_raw,created_at';
  v_n     int;
  v_src   text;
  v_cfg   text;
  v_sec   boolean;
BEGIN
  -- 前置閘① 要換掉的是【20260908000000 那一份】view:定義裡還讀 pr.price_store、還沒有 LATERAL
  SELECT pg_get_viewdef('public.products_list_dealer'::regclass) INTO v_def;
  -- 指紋 = 2026-09-24 正式庫唯讀讀到的 md5(pg_get_viewdef);字面檢查留著當人話訊息。
  IF v_def IS NULL OR v_def NOT LIKE '%pr.price_store%' OR v_def ILIKE '%lateral%'
     OR md5(v_def) IS DISTINCT FROM 'cf5683acb5b69e9c96762fad84a88536' THEN
    RAISE EXCEPTION '前置閘①:products_list_dealer 不是 20260908000000 那一份(可能已經改過)⇒ 停, 不覆蓋。定義=%', v_def;
  END IF;

  -- 前置閘② 來源 view 的欄名欄序沒變(新 view 逐欄沿用它)
  SELECT string_agg(a.attname, ',' ORDER BY a.attnum) INTO v_cols
    FROM pg_attribute a
   WHERE a.attrelid = 'public.products_list_public'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols IS DISTINCT FROM v_want THEN
    RAISE EXCEPTION '前置閘②:products_list_public 的欄名/欄序變了 ⇒ 停。實際=% / 期望=%', v_cols, v_want;
  END IF;

  -- 前置閘③ 變體表有要用的四欄
  SELECT count(*) INTO v_n
    FROM pg_attribute a
   WHERE a.attrelid = 'public.product_variants'::regclass
     AND a.attname IN ('product_id', 'price_store', 'price_general', 'sku')
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_n <> 4 THEN
    RAISE EXCEPTION '前置閘③:product_variants 的 product_id/price_store/price_general/sku 只找到 % 欄 ⇒ 停。', v_n;
  END IF;

  -- 前置閘④ 本 view 繞過 RLS, 手抄的那一刀要還對得上(同 20260908000000 前置閘⑤)
  SELECT pg_get_expr(pl.polqual, pl.polrelid) INTO v_def
    FROM pg_policy pl
   WHERE pl.polrelid = 'public.products'::regclass AND pl.polname = 'products_select_public';
  IF v_def IS DISTINCT FROM '(delisted_at IS NULL)' THEN
    RAISE EXCEPTION '前置閘④:products_select_public 的 USING 不是 (delisted_at IS NULL)(實際=%)⇒ 停。', coalesce(v_def, '(查無此 policy)');
  END IF;

  -- 前置閘⑤ 要換掉的函式是【20260907010000 那一份】:DEFINER、search_path 空字串、商品半還讀 v_tier 那一格
  SELECT p.prosrc, pg_catalog.array_to_string(p.proconfig, ','), p.prosecdef
    INTO v_src, v_cfg, v_sec
    FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.get_effective_prices(uuid[], uuid[])');
  IF v_src IS NULL THEN
    RAISE EXCEPTION '前置閘⑤:找不到 get_effective_prices(uuid[], uuid[]) ⇒ 停。';
  END IF;
  IF NOT v_sec OR v_cfg IS DISTINCT FROM 'search_path=""' THEN
    RAISE EXCEPTION '前置閘⑤:get_effective_prices 姿態不同(prosecdef=% proconfig=%)⇒ 停, 先查誰改過。', v_sec, v_cfg;
  END IF;
  -- 指紋 = 2026-09-24 正式庫唯讀讀到的 md5(prosrc), 與 20260907010000 本體相同。
  IF v_src NOT LIKE '%p.price_by_tier -> v_tier ->> ''amount''%' OR v_src LIKE '%bv.price_store%'
     OR pg_catalog.md5(v_src) IS DISTINCT FROM '208abb5ea084bb260f067c7e6640d355' THEN
    RAISE EXCEPTION '前置閘⑤:get_effective_prices 不是 20260907010000 那一份(可能已經改過)⇒ 停, 不覆蓋。';
  END IF;
END
$pre$;

-- ─────────────────────────────────────────────────────────────
-- A. 經銷目錄 view。只改價格那一格與多一個 LATERAL;其餘逐字沿用 20260908000000。
--    security_invoker 照舊不設(以 owner 權限讀 product_variants.price_store)。
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.products_list_dealer AS
SELECT
  v.id,
  v.title,
  v.subtitle,
  v.handle,
  v.brand_id,
  v.category_id,
  v.availability,
  v.fitments,
  -- 🔴 唯一與 products_list_public 不同的一格。基準款變體沒有經銷價 ⇒ 退回商品一般價(= 今天的行為)。
  coalesce(b.price_store, v.price_general) AS price_general,
  v.supplier_slug,
  v.card_image,
  v.fits,
  v.brand_name,
  v.brand_slug,
  v.category_raw,
  v.created_at
FROM public.products_list_public v
JOIN public.products pr ON pr.id = v.id
LEFT JOIN LATERAL (
  SELECT pv.price_store
    FROM public.product_variants pv
   WHERE pv.product_id = pr.id
   ORDER BY pv.price_general ASC NULLS LAST, pv.sku COLLATE "C" ASC
   LIMIT 1
) b ON true
-- 🔴 RLS policy `products_select_public` 的手抄本(本 view 繞過 RLS)。少了它 = 已下架商品外流。
WHERE pr.delisted_at IS NULL;

COMMENT ON VIEW public.products_list_dealer IS
  '⟦經銷價修正 2026-09-24⟧ 經銷專用列表 view:列過濾委託給 products_list_public, 價格欄 = 基準款變體(一般價最低、同價 sku COLLATE "C" 最小)的 product_variants.price_store, 取不到退回一般價。security_invoker 刻意不設。🔴 誰都不 GRANT —— 只有 SECURITY DEFINER 的經銷 RPC 以 owner 身分讀它。';

REVOKE ALL ON TABLE public.products_list_dealer FROM PUBLIC;
REVOKE ALL ON TABLE public.products_list_dealer FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- B. get_effective_prices:全文照抄 20260907010000, 只改商品半的 store 那一格與對應的 WARNING。
--    🔴 CREATE OR REPLACE 會把 SET 子句整組換掉 ⇒ 下面這份全文裡的 `SET search_path = ''` 不可以刪。
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_effective_prices(
  p_product_ids uuid[] DEFAULT NULL,
  p_variant_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (kind text, id uuid, amount integer, currency text, tier text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
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
  -- ✅ 處置分兩層:①那個 tier 取不到有效金額 ⇒ **退回 general**(不是回 NULL)
  --              ②連 general 都取不到 ⇒ **RAISE** —— 那是資料壞了, 要有人知道。
  RETURN QUERY
  SELECT 'product'::text, p.id,
         CASE
           -- 🔴 2026-09-24 經銷價修正(docs/plans/2026-09-24-dealer-price-fix-before-b2b-plan.md §3.4):
           --    經銷會員的商品價【不再讀 price_by_tier.store】—— 沒開灌價的供應商那一格是過期舊價
           --    (正式庫 2026-09-24 唯讀:1,086 件比一般價貴)。改讀【基準款變體】的 price_store,
           --    與結帳收錢的 create_order 同一欄;取不到退回一般價。
           --    基準款 = 一般價最低、同價 sku 最小(COLLATE "C" 對齊 rpm-transform.ts:448-452 的 JS 比較)。
           WHEN v_tier = 'store' THEN coalesce(
             (SELECT bv.price_store
                FROM public.product_variants bv
               WHERE bv.product_id = p.id
               ORDER BY bv.price_general ASC NULLS LAST, bv.sku COLLATE "C" ASC
               LIMIT 1),
             CASE WHEN (p.price_by_tier -> 'general' ->> 'amount') ~ '^[0-9]+$'
                  THEN (p.price_by_tier -> 'general' ->> 'amount')::integer END)
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
           WHEN v_tier = 'store' THEN coalesce(v.price_store, v.price_general)
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
$fn$;

REVOKE ALL ON FUNCTION public.get_effective_prices(uuid[], uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_effective_prices(uuid[], uuid[]) FROM anon, service_role;
-- ACL-GATE-EXEMPT: public.get_effective_prices -- 登入客人自己叫, 對照建表 20260907010000
-- 理由同 20260907010000:顧客站 server component 代表【登入的客人】呼叫;tier 從 auth.uid() 來,
--   service_role 叫只會拿到 general 而且繞過 RLS ⇒ 不給。
GRANT EXECUTE ON FUNCTION public.get_effective_prices(uuid[], uuid[]) TO authenticated;

DO $post$
DECLARE
  v_acl    text;
  v_vacl   text;
  v_gt     int;
  v_owner  text;
  v_si     text;
  v_cols   text;
  v_want   text := 'id,title,subtitle,handle,brand_id,category_id,availability,fitments,'
                   || 'price_general,supplier_slug,card_image,fits,brand_name,brand_slug,category_raw,created_at';
  v_n      int;
  v_cfg    text;
  r        text;
  v_functions text[] := ARRAY['public.get_effective_prices(uuid[], uuid[])']::text[];
BEGIN
  -- ── A 的事後閘 ──
  SELECT string_agg(a.attname, ',' ORDER BY a.attnum) INTO v_cols
    FROM pg_attribute a
   WHERE a.attrelid = 'public.products_list_dealer'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols IS DISTINCT FROM v_want THEN
    RAISE EXCEPTION '事後閘A①:欄名/欄序對不上(實際=% / 期望=%)⇒ 停。', v_cols, v_want;
  END IF;

  SELECT o.option_value INTO v_si
    FROM pg_class c
    LEFT JOIN LATERAL pg_options_to_table(c.reloptions) o ON o.option_name = 'security_invoker'
   WHERE c.oid = 'public.products_list_dealer'::regclass;
  IF v_si IS NOT DISTINCT FROM 'true' THEN
    RAISE EXCEPTION '事後閘A②:security_invoker 是 true ⇒ 它讀不到經銷價, 只會安靜回一般價 ⇒ 停。';
  END IF;

  SELECT coalesce(c.relacl::text, '(NULL)'), pg_get_userbyid(c.relowner) INTO v_vacl, v_owner
    FROM pg_class c WHERE c.oid = 'public.products_list_dealer'::regclass;
  IF v_vacl ILIKE '%anon=%' OR v_vacl ILIKE '%authenticated=%' THEN
    RAISE EXCEPTION '事後閘A③:relacl 仍含 anon/authenticated(acl=%)⇒ 停。', v_vacl;
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated']::text[] LOOP
    IF NOT has_table_privilege(r, 'public.products_list_public', 'SELECT') THEN
      RAISE EXCEPTION '事後閘A④:正對照失敗 —— % 連 products_list_public 都讀不到 ⇒ 這把尺今天壞了 ⇒ 停。', r;
    END IF;
    IF has_table_privilege(r, 'public.products_list_dealer', 'SELECT') THEN
      RAISE EXCEPTION '事後閘A④:% 對 products_list_dealer 有有效 SELECT ⇒ 停。', r;
    END IF;
  END LOOP;
  IF v_owner <> 'postgres' THEN
    RAISE EXCEPTION '事後閘A⑤:owner 是 %(期望 postgres)⇒ 停。', v_owner;
  END IF;

  -- 已下架不得出現;列數要等於公開 view 扣掉已下架(LATERAL LIMIT 1 不可以扇出)
  SELECT count(*) INTO v_n
    FROM public.products_list_dealer d JOIN public.products pr ON pr.id = d.id
   WHERE pr.delisted_at IS NOT NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '事後閘A⑥:經銷 view 裡有 % 筆已下架 ⇒ 停。', v_n;
  END IF;
  SELECT (SELECT count(*) FROM public.products_list_dealer)
       - (SELECT count(*) FROM public.products_list_public v2
            JOIN public.products pr2 ON pr2.id = v2.id
           WHERE pr2.delisted_at IS NULL)
    INTO v_n;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '事後閘A⑦:列數差 %(期望 0)⇒ 扇出或漏列 ⇒ 停。', v_n;
  END IF;

  -- 只印不擋:今天預期兩個都是 0(真經銷價還沒灌)。不是 0 ⇒ 有人灌過價, 貼的人要知道。
  SELECT count(*) FILTER (WHERE d.price_general <> p.price_general),
         count(*) FILTER (WHERE d.price_general > p.price_general)
    INTO v_n, v_gt
    FROM public.products_list_dealer d JOIN public.products_list_public p ON p.id = d.id;
  RAISE NOTICE '經銷 view 與公開 view 價格不同 % 件, 其中經銷價比一般價貴 % 件(今天預期 0 / 0)', v_n, v_gt;

  -- ── B 的事後閘(照抄 20260907010000 的收權斷言, 加 search_path 與 DEFINER 姿態)──
  FOREACH r IN ARRAY v_functions LOOP
    SELECT pg_catalog.array_to_string(p.proacl, ','), pg_catalog.array_to_string(p.proconfig, ','),
           pg_catalog.pg_get_userbyid(p.proowner)
      INTO v_acl, v_cfg, v_owner
      FROM pg_catalog.pg_proc p
     WHERE p.oid = pg_catalog.to_regprocedure(r) AND p.prosecdef;
    IF NOT FOUND THEN
      RAISE EXCEPTION '事後閘B①:% 不存在或不是 SECURITY DEFINER ⇒ 停。', r;
    END IF;
    IF v_cfg IS DISTINCT FROM 'search_path=""' THEN
      RAISE EXCEPTION '事後閘B②:% 的 proconfig = %(期望 search_path="")⇒ CREATE OR REPLACE 把 SET 子句換掉了 ⇒ 停。', r, v_cfg;
    END IF;
    IF v_acl IS NULL OR v_acl NOT LIKE '%authenticated=%' THEN
      RAISE EXCEPTION '事後閘B③:% 對 authenticated 沒有 EXECUTE(proacl=%)⇒ 停。', r, v_acl;
    END IF;
    IF pg_catalog.has_function_privilege('anon', r, 'EXECUTE') THEN
      RAISE EXCEPTION '事後閘B④:anon 叫得動 % ⇒ 停。', r;
    END IF;
    IF pg_catalog.has_function_privilege('service_role', r, 'EXECUTE') THEN
      RAISE EXCEPTION '事後閘B④:service_role 叫得動 % ⇒ 停。', r;
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', r, 'EXECUTE') THEN
      RAISE EXCEPTION '事後閘B④:authenticated 叫不動 % ⇒ 停。', r;
    END IF;
    IF NOT pg_catalog.has_table_privilege(v_owner, 'public.product_variants', 'SELECT') THEN
      RAISE EXCEPTION '事後閘B⑤:% 的 owner(%)讀不到 product_variants ⇒ 經銷價會安靜退回一般價 ⇒ 停。', r, v_owner;
    END IF;
  END LOOP;

  -- 真的叫一次、走完兩個 RETURN QUERY(不存在的 id ⇒ 零列, 而查詢有被規劃執行)
  PERFORM public.get_effective_prices(ARRAY[]::uuid[], ARRAY[]::uuid[]);
  PERFORM public.get_effective_prices(
    ARRAY['00000000-0000-0000-0000-000000000000'::uuid],
    ARRAY['00000000-0000-0000-0000-000000000000'::uuid]);

  RAISE NOTICE '✅ 經銷價修正貼好:view acl=% / get_effective_prices proacl=% proconfig=%', v_vacl, v_acl, v_cfg;
END
$post$;

COMMENT ON FUNCTION public.get_effective_prices(uuid[], uuid[]) IS
$c$M-2-08 前半:回【呼叫者自己那個 tier】的有效價。
🔴 不收 tier 參數 —— tier 由內部 auth.uid() 查 customers.tier;NULL ⇒ general。
🔴 經銷(store)的商品價 = 基準款變體的 product_variants.price_store, 取不到退回一般價(2026-09-24 起;不再讀 price_by_tier.store)。
🛑 它【不算稅】:稅由付款方式決定(Sean 2026-09-06 Q24)。
🛑 它【不管 premiumStore】:其餘 tier 一律降級成 general。
⚠️ 一次最多 200 個 id。下架商品不回。$c$;

COMMIT;
