SET LOCAL lock_timeout = '5s';
-- 20260924100000 退回:products_list_dealer 與 get_effective_prices 換回 2026-09-24 貼之前的樣子
-- (view = 20260908000000 本體;函式 = 20260907010000 本體, 改用 CREATE OR REPLACE)。
-- 🔴 不可以直接重貼 20260907010000:那支是裸 CREATE FUNCTION, 函式已存在會報錯、整筆回滾, 等於沒退。
-- 退回後:經銷目錄回到永遠顯示一般價;商品頁還沒選規格時, 經銷會員會再看到 price_by_tier.store 的過期價(今天 0 人)。
-- 貼完手動跑 NOTIFY pgrst, 'reload schema'; 並跑 pcm_acl_approve_latest(p_note 帶 20260924100000 rollback)。
-- 🔴 前置閘的新版 view 指紋 08fce34c… 是在本機 PG 17.10 讀的;正式庫是 17.6, pg_get_viewdef 不保證跨版本逐字相同(Codex R2)。
--    ⇒ 正向那支貼完【當下】就要讀一次 md5(pg_get_viewdef('public.products_list_dealer'::regclass)),
--      不是 08fce34c6… 就先把這裡改成實際值再 commit;不要等到要退回時才發現被自己擋住。
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL quote_all_identifiers = off;

DO $pre$
DECLARE
  v_view text;
  v_fn   text;
BEGIN
  -- 要退的必須【逐字】是 20260924100000 那一版:比兩個物件的完整指紋(拋棄式 PG17 貼完讀到的 md5)。
  -- 🔴 用 IS DISTINCT FROM:物件不存在(NULL)也要擋。只比「有沒有某個字」會誤放行後來改過的版本(Codex R1 必修)。
  SELECT md5(pg_get_viewdef(to_regclass('public.products_list_dealer'))) INTO v_view;
  IF v_view IS DISTINCT FROM '08fce34c67d5ea1e6209112c212a6fdb' THEN
    RAISE EXCEPTION '退回前置閘a:products_list_dealer 不是 20260924100000 那一版(md5=%)⇒ 可能沒貼過、已退過或後來又改過, 停', coalesce(v_view, '(不存在)');
  END IF;
  SELECT pg_catalog.md5(p.prosrc) INTO v_fn
    FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.get_effective_prices(uuid[], uuid[])');
  IF v_fn IS DISTINCT FROM 'cc73a38bf5775da7b402c9c1c9fad140' THEN
    RAISE EXCEPTION '退回前置閘b:get_effective_prices 不是 20260924100000 那一版(md5=%)⇒ 停', coalesce(v_fn, '(不存在)');
  END IF;
END
$pre$;

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
  coalesce(pr.price_store, v.price_general) AS price_general,
  v.supplier_slug,
  v.card_image,
  v.fits,
  v.brand_name,
  v.brand_slug,
  v.category_raw,
  v.created_at
FROM public.products_list_public v
JOIN public.products pr ON pr.id = v.id
WHERE pr.delisted_at IS NULL;

COMMENT ON VIEW public.products_list_dealer IS
  '⟦M-4b Q74⟧ 經銷專用列表 view:列過濾整個委託給 products_list_public(⇒ 列集合逐列相同是構造出來的), 只把價格欄換成 coalesce(price_store, price_general)。security_invoker 刻意不設(=false)⇒ 以 owner 權限讀得到 price_store。🔴 誰都不 GRANT —— 只有 SECURITY DEFINER 的經銷 RPC 以 owner 身分讀它。';

REVOKE ALL ON TABLE public.products_list_dealer FROM PUBLIC;
REVOKE ALL ON TABLE public.products_list_dealer FROM anon, authenticated;

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
       AND (p.price_by_tier -> v_tier ->> 'amount') !~ '^[0-9]+$'
  ) THEN
    RAISE WARNING 'get_effective_prices:有商品連 general 都取不到有效金額 ⇒ 那一列的 amount 是 NULL。'
      '這是【資料壞了】不是【沒有折扣】, 要有人去看。';
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_effective_prices(uuid[], uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_effective_prices(uuid[], uuid[]) FROM anon, service_role;
-- ACL-GATE-EXEMPT: public.get_effective_prices -- 登入客人自己叫, 對照建表 20260907010000
GRANT EXECUTE ON FUNCTION public.get_effective_prices(uuid[], uuid[]) TO authenticated;

COMMENT ON FUNCTION public.get_effective_prices(uuid[], uuid[]) IS
$c$M-2-08 前半:回【呼叫者自己那個 tier】的有效價。
🔴 不收 tier 參數 —— tier 由內部 auth.uid() 查 customers.tier;NULL ⇒ general。
🔴 只回那一個 tier 的 amount/currency, 不回整個 price_by_tier ⇒ 一般會員拿不到 store 價。
🛑 它【不算稅】:稅由付款方式決定(Sean 2026-09-06 Q24), 那是 B2 與 M-2-08 後半的格子。
🛑 它【不管 premiumStore】:本片範圍只到 store, 其餘 tier 一律降級成 general。
⚠️ 一次最多 200 個 id。下架商品不回。$c$;

-- 事後閘:兩樣都回到 2026-09-24 貼之前正式庫讀到的指紋與姿態
DO $post$
DECLARE
  v text;
BEGIN
  IF md5(pg_get_viewdef('public.products_list_dealer'::regclass)) IS DISTINCT FROM 'cf5683acb5b69e9c96762fad84a88536' THEN
    RAISE EXCEPTION '退回事後閘a:view 指紋不是貼之前那一份 ⇒ 停';
  END IF;
  SELECT pg_catalog.md5(p.prosrc) || '|' || p.prosecdef::text || '|' || p.proconfig::text || '|' || p.proacl::text INTO v
    FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.get_effective_prices(uuid[], uuid[])');
  IF v IS DISTINCT FROM '208abb5ea084bb260f067c7e6640d355|true|{"search_path=\"\""}|{postgres=X/postgres,authenticated=X/postgres}' THEN
    RAISE EXCEPTION '退回事後閘b:get_effective_prices 與貼之前不同(%)⇒ 停', v;
  END IF;
  IF (SELECT relacl::text FROM pg_class WHERE oid = 'public.products_list_dealer'::regclass) ILIKE ANY (ARRAY['%anon=%', '%authenticated=%']) THEN
    RAISE EXCEPTION '退回事後閘c:view 對 anon/authenticated 開了 ⇒ 停';
  END IF;
  PERFORM public.get_effective_prices(
    ARRAY['00000000-0000-0000-0000-000000000000'::uuid],
    ARRAY['00000000-0000-0000-0000-000000000000'::uuid]);
  RAISE NOTICE '✅ 20260924100000 已退回';
END
$post$;

COMMIT;
