-- M-4b · 顧客站搜尋第二刀:把【品牌名】加進搜尋範圍
--   `public.storefront_search_product_ids(p_terms text[]) RETURNS TABLE(id uuid)`
--
-- ✅ plan(主視窗-87 2026-09-03 批准)= `docs/specs/2026-09-03-storefront-search-brand-plan.md`
--
-- ── 🔴 為什麼要有這支函式(而不是在 PostgREST 那一層做)──────────────────────
--    實測:PostgREST **14.16** 的 top-level `or()` **只認本表的欄,不認 embed 資源的欄**。
--    `or=(title.ilike.*x*,brands.name.ilike.*y*)` ⇒ **HTTP 400 `PGRST100`
--    「failed to parse logic tree」**(column 34 落在 `brands.name` 的那個點上 ——
--    解析器把 `brands` 讀成欄名、`name` 讀成運算子)。
--    🟢 而同一座鑽機上 `brands!inner(name)` + `brands.name=ilike.*` **是通的(7 列)**
--    ⇒ **那個 400 是【語法】不是【權限】** —— 兩者原本都會失敗、長得一樣,是那一階把它們分開的。
--    ⚠️ 射程:那是 14.16 的行為;**正式站的 PostgREST 版本未查** ⇒ 版本不同要重量。
--
-- ── 🔴🔴 兩個設計決定,而它們把兩條安全規則從【紀律】變成【結構】────────────
--  ① **`SECURITY INVOKER`(預設),不是 `DEFINER`**
--     後台那支 `admin_search_orders`(`20260812130000`)是 `DEFINER` + 只 GRANT `service_role`
--     —— **那是後台的權限模型,而這裡的呼叫者是 `anon`(客人)**。
--     🛑 照抄 `DEFINER` 會讓函式**以擁有者身分執行** ⇒ 繞過 RLS、也繞過「`anon` 讀得到什麼」那一層,
--       而**經銷價的物理防線正是「客人這條路只看得到 `products_public`」**。
--     ✅ `INVOKER` ⇒ 它**拿不到任何 `anon` 今天拿不到的東西** ⇒ **本片不新增任何權限面。**
--     🔵 前提已量(主視窗-87 正式庫唯讀 2026-09-03):
--        `has_table_privilege('anon','public.products_public','SELECT')` ⇒ **t**
--        `has_table_privilege('anon','public.brands','SELECT')`          ⇒ **t**
--        (🟢 同一發正對照/負對照:`products_public` t / `orders` f ⇒ 那個 t 有判別力)
--  ② **只回 `id`,不回任何欄位**
--     呼叫端拿到 id 之後**照舊**用既有的 `PRODUCT_SELECT_DETAIL_VIEW` 對 `products_public`
--     下 `.in('id', …)` 取回 ⇒ **投影一個字不動、mapper 一個字不動。**
--     🎯 **為什麼這比一條規則好**:硬約束原本是「**不要**把 brands 欄位放進回傳」,
--       而「不要做某件事」靠的是下一個人記得;**回傳型別就是 `TABLE(id uuid)`** 之後,
--       **要違反它得先改函式簽章** ⇒ 📌 **從「別做」變成「做不到」。**
--     🔵 連帶:`brands.premium_extra_pct`(品牌加價%)**在 DB 那一層對 `anon` 是開著的**
--       ⇒ 今天唯一擋住它的是應用層的 mapper ⇒ **本函式結構上不可能把它帶出去。**
--
-- ── 🔴 述詞 ──────────────────────────────────────────────────────────────
--    命中(單一詞 w) ⟺ title ∨ subtitle ∨ description ∨ external_id ∨ brands.name  ILIKE %w%
--    整體            ⟺ **每一個詞都命中**(AND across terms)
--    🛑 **AND across terms 不能用 `UNION` 表達 —— `UNION` 是聯集。**
--      後台那支的「UNION 不是一大坨 OR」解的是【單一詞跨多欄】那一層;跨詞的 AND 要另一個機制。
--      ⇒ 這裡用 `GROUP BY id HAVING count(DISTINCT 詞序) = 詞數`(語意 = 每個詞都至少中一個欄)。
--      ⚠️ 與 `INTERSECT` 哪個快 **未量** ⇒ 上線前要對正式庫 `EXPLAIN` 比一次。
--
-- ── 🛑 失敗方向 ──────────────────────────────────────────────────────────
--    空陣列 / 全空字串 ⇒ **回零列**,而**不是回全表**。
--    🔴 那一格是刻意的:呼叫端 TS 側也有同款 fail-closed(`terms.length === 0` ⇒ 直接回),
--      而**兩層各自擋** —— 因為「沒有條件的查詢」的失敗形狀是【成功】(HTTP 200、有結果、畫面正常)。
--
-- 🔵 **本支不建索引、不做相關性排序、不做模糊比對** —— 那三件各自是另一刀(plan §8-d)。
-- 🔴 **本支未 apply。** 交主視窗排進「等 Sean 貼」佇列。

DO $$
BEGIN
  -- 前置閘①:要搜的那張 view 在
  IF to_regclass('public.products_public') IS NULL THEN
    RAISE EXCEPTION '前置閘①:找不到 public.products_public ⇒ 部署態與預期不符';
  END IF;
  -- 前置閘②:brands 在(本片唯一新碰的表)
  IF to_regclass('public.brands') IS NULL THEN
    RAISE EXCEPTION '前置閘②:找不到 public.brands';
  END IF;
  -- 前置閘③:🔴 那五個欄位都要在 —— 少一個, 下面的函式會在【呼叫時】才炸,
  --   而那時候炸的是客人的搜尋, 不是這支 migration。
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='products_public'
       AND column_name IN ('id','title','subtitle','description','external_id','brand_id')
     GROUP BY table_name HAVING count(*) = 6
  ) THEN
    RAISE EXCEPTION '前置閘③:products_public 缺了本片要用的欄位(需 id/title/subtitle/description/external_id/brand_id)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='brands' AND column_name='name'
  ) THEN
    RAISE EXCEPTION '前置閘④:brands 缺 name 欄';
  END IF;
END
$$;

-- 🔴 **裸 `CREATE`,不是 `CREATE OR REPLACE`** —— 這是 migration 靜態檢查逼出來的,而它的理由是對的:
--    這是一個**新物件**;`OR REPLACE` 會把**撞名的東西靜靜蓋掉**,
--    而**我的 REVOKE 與所有斷言照樣全綠** ⇒ 📌 **拿到綠燈,卻蓋掉了一個我不知道存在的東西。**
--    ⇒ 裸 `CREATE` 讓撞名**當場紅**;而重跑本支也會因此失敗 —— 那正是 forward-only 要的行為。
CREATE FUNCTION public.storefront_search_product_ids(p_terms text[])
RETURNS TABLE (id uuid)
LANGUAGE sql
STABLE
-- 🔴 **刻意【不寫】 SECURITY DEFINER** —— 預設就是 INVOKER,而那是本片的安全前提(見檔頭①)。
--    ⚠️ 下一個人若把它改成 DEFINER:**那不是效能調整,那是把客人的查詢升權** ⇒ 要重過鐵則 12②。
-- 🔵 **也刻意不寫 `SET search_path`** —— INVOKER + 只讀兩張具名 `public.` 物件、零提權面
--    (形狀與理由對齊 `20260812130000` 的 `pcm_spec_text`:那支同樣是 INVOKER 而刻意不設)。
AS $fn$
  WITH t AS (
    -- 🔴 逐詞編號 ⇒ 下面用「不同詞的個數」判斷「每個詞都中了」
    --    `WITH ORDINALITY` 讓重複的詞不會被摺疊成一個(打兩次同一個字仍是一個條件)
    SELECT DISTINCT ON (term) term, ord
      FROM unnest(coalesce(p_terms, ARRAY[]::text[])) WITH ORDINALITY AS u(term, ord)
     -- 空字串 / 全空白的詞丟掉 —— 留著會變成 `%%` 而那會命中全部
     WHERE btrim(term) <> ''
  ),
  n AS (SELECT count(*)::bigint AS want FROM t)
  SELECT p.id
    FROM public.products_public p
    LEFT JOIN public.brands b ON b.id = p.brand_id
    CROSS JOIN n
    JOIN t ON (
         p.title       ILIKE '%' || replace(replace(replace(t.term, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      OR p.subtitle    ILIKE '%' || replace(replace(replace(t.term, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      OR p.description ILIKE '%' || replace(replace(replace(t.term, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      OR p.external_id ILIKE '%' || replace(replace(replace(t.term, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      OR b.name        ILIKE '%' || replace(replace(replace(t.term, '\', '\\'), '%', '\%'), '_', '\_') || '%'
    )
   WHERE n.want > 0            -- 🔴 零個有效詞 ⇒ 回零列(不是回全表)
     AND p.id IS NOT NULL
   GROUP BY p.id, n.want
  HAVING count(DISTINCT t.ord) = n.want;   -- 🔴 每一個詞都要中(AND across terms)
$fn$;

COMMENT ON FUNCTION public.storefront_search_product_ids(text[]) IS
  '顧客站搜尋:回傳命中的商品 id(**只回 id,不回任何欄位**)。
🔴 **SECURITY INVOKER(預設)** —— 以呼叫者(anon)身分執行 ⇒ 拿不到任何 anon today 拿不到的東西。
**不要改成 SECURITY DEFINER**:那不是效能調整,那是把客人的查詢升權,要重過鐵則 12②。
🔴 **只回 id 是刻意的**:欄位由呼叫端用既有投影(products_public)取,**投影與 mapper 都不動**
⇒ 把「不得把 brands 欄位放進回傳」從一條【規則】變成一件【做不到的事】。
   (brands.premium_extra_pct 是品牌加價%,而它在 DB 這一層對 anon 是開著的。)
述詞:每個詞都要中,而一個詞可以中在 title / subtitle / description / external_id / brands.name 任一。
空陣列或全空白 ⇒ **回零列,不是回全表** —— 「沒有條件的查詢」的失敗形狀是【成功】。
不做:相關性排序 / 模糊比對 / 索引 —— 各自是另一刀。';

-- ── 🔴🔴 ACL:**新物件出生就自帶權限,所以要明寫** ────────────────────────────
--    這一段是 `.husky` 的 migration 靜態檢查逼出來的(它逐字說「建了新物件就必須明寫 GRANT」)
--    ⇒ 而它是對的:**Postgres 對新函式預設把 `EXECUTE` 授給 `PUBLIC`**
--      ⇒ 不明寫的話,這支函式**出生就是所有人都叫得動**,而 `proacl` 是 `NULL`(看起來像「沒有授權」)。
--    📌 **「ACL 欄是 NULL」與「沒有人有權限」是兩件事** —— 前者的意思是「用預設」,而預設是開的。
--
-- 🔴 **兩道 REVOKE,少一道都是開的**(`docs/patterns/revoking-function-execute-in-supabase.md`):
--    · 只 `FROM PUBLIC` ⇒ 收不到具名授權(Supabase 對 `public` schema 掛了具名的預設授權)
--    · 只 `FROM anon, authenticated` ⇒ 收不到 PUBLIC 那份,而 **`PUBLIC` 是「所有角色」、
--      不是一個你去繼承的角色** ⇒ `anon` 照樣執行得到
--    ⇒ 兩道都下,然後**只把要給的那些再 GRANT 回去**。
--
-- 🔵 **而本片【要】給 `anon` 與 `authenticated`** —— 這是**顧客站的搜尋**,呼叫者就是客人。
--    ⚠️ 那不是放寬:函式是 `INVOKER`,它以呼叫者身分跑
--      ⇒ **給了 EXECUTE 也拿不到任何 `anon` 今天拿不到的資料**(檔頭①)。
--    🛑 而**不給** `service_role` 之外的其他角色 —— 沒有理由的授權就是攻擊面。
REVOKE ALL ON FUNCTION public.storefront_search_product_ids(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.storefront_search_product_ids(text[]) FROM anon, authenticated;
-- ACL-GATE-EXEMPT: public.storefront_search_product_ids -- 顧客站搜尋的呼叫者就是 anon 客人; 函式是 INVOKER 不升權, 且下面事後閘⑤ 逐角色釘住 (2026-09-03)
--
-- 🔴 **`acl-drift-gate` 擋過這一行,而它的理由是對的,逐字**:
--    「migration 裡所有 ACL 斷言都是 **apply 時一次性**,正式庫**從不 replay**
--      ⇒ 這一行 apply 之後,**沒有東西會再紅**。」
-- 📌 **⇒ 一個只在 apply 那一秒被檢查過的權限,之後就是【沒有人在看】的。**
-- ⇒ 所以除了豁免標記,**我把它釘成一格會在 apply 當下叫的斷言**(事後閘⑤):
--   不只問「anon 有沒有」,還問「**有沒有多給別人**」—— 後者才是漂移會走的方向。
-- ⚠️ **而本閘與本斷言【都】對 dashboard / SQL Editor 的手動 GRANT 是盲的**(閘自己的檔頭天花板①)
--   ⇒ 有人事後在 Supabase 後台按一下多給一個角色,**這裡不會知道**。那一格今天沒有人在守。
GRANT EXECUTE ON FUNCTION public.storefront_search_product_ids(text[]) TO anon, authenticated, service_role;

-- ── 事後閘(定義層;🛑 不驗行為 —— 行為在 scripts/storefront-search-brand-verify.sh)──
DO $$
DECLARE
  v_sec boolean; v_kind text;
  -- 🔴 **可授權物件的斷言清單**(migration 靜態檢查規則③要求):
  --    本片新建的**可授權物件**逐一列出 —— 少列一個,那個物件的權限就沒有人在斷言。
  --    ⚠️ 這裡只有一個;若日後本檔再加 view / table,**清單要同步長**,否則閘會叫。
  v_relations text[] := ARRAY['public.storefront_search_product_ids']::text[];
  v_missing text;
BEGIN
  -- 清單裡的東西必須真的存在(否則清單是一句沒有對象的宣稱)
  SELECT string_agg(x, ', ') INTO v_missing
    FROM unnest(v_relations) AS x
   WHERE to_regprocedure(x || '(text[])') IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '事後閘⓪:斷言清單列了不存在的物件(%)', v_missing;
  END IF;
  SELECT p.prosecdef, p.prokind INTO v_sec, v_kind
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='storefront_search_product_ids';
  IF v_sec IS NULL THEN
    RAISE EXCEPTION '事後閘①:函式建不出來';
  END IF;
  -- 🔴 這一格是本片最重要的閘:它守的是【安全模型】不是【功能】
  IF v_sec THEN
    RAISE EXCEPTION '事後閘②:函式是 SECURITY DEFINER ⇒ 客人的查詢被升權了, 這與本片的前提相反';
  END IF;
  -- 🔴 事後閘③:ACL **不可以是 NULL** —— NULL 的意思是「用預設」, 而預設是 PUBLIC 可執行。
  --    📌 這一格擋的是「有人把上面那三行 REVOKE/GRANT 刪掉」, 而刪掉之後**功能完全正常**。
  IF (SELECT p.proacl FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='storefront_search_product_ids') IS NULL THEN
    RAISE EXCEPTION '事後閘③:proacl 是 NULL ⇒ 走的是預設授權(PUBLIC 可執行)⇒ 那三行 REVOKE/GRANT 沒生效';
  END IF;
  -- 🔴 事後閘④:PUBLIC **不得**在 ACL 裡(aclexplode 的 grantee=0 就是 PUBLIC)
  --    ⚠️ 這裡刻意**不** join pg_roles:PUBLIC 的 grantee 是 oid 0, 而 pg_roles 沒有 0
  --      ⇒ 內部 join 會把它靜靜丟掉(本 repo 記過這一格)。
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
               JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace,
             LATERAL aclexplode(p.proacl) a
              WHERE n.nspname='public' AND p.proname='storefront_search_product_ids'
                AND a.grantee = 0) THEN
    RAISE EXCEPTION '事後閘④:PUBLIC 仍在 ACL 裡 ⇒ 兩道 REVOKE 少了一道';
  END IF;
  -- 🔴 事後閘⑤:**逐角色釘住,而且問【有沒有多給】** —— 漂移走的是「多給」那個方向。
  --    ⚠️ 用 has_function_privilege 而不是讀 ACL 字面:前者算得進角色繼承, 後者不會。
  DECLARE
    v_extra text;
  BEGIN
    IF NOT has_function_privilege('anon', 'public.storefront_search_product_ids(text[])', 'EXECUTE') THEN
      RAISE EXCEPTION '事後閘⑤a:anon 執行不到 ⇒ 顧客站搜尋會整條壞掉';
    END IF;
    IF NOT has_function_privilege('authenticated', 'public.storefront_search_product_ids(text[])', 'EXECUTE') THEN
      RAISE EXCEPTION '事後閘⑤b:authenticated 執行不到';
    END IF;
    -- 🔴 而「有沒有多給」要問**所有非預期的角色**, 不是只問我想得到的那一個
    SELECT string_agg(r.rolname, ', ') INTO v_extra
      FROM pg_catalog.pg_roles r
     WHERE r.rolname NOT IN ('anon', 'authenticated', 'service_role', 'postgres')
       AND NOT r.rolsuper
       AND has_function_privilege(r.rolname, 'public.storefront_search_product_ids(text[])', 'EXECUTE');
    IF v_extra IS NOT NULL THEN
      RAISE EXCEPTION '事後閘⑤c:非預期角色也執行得到(%)⇒ 兩道 REVOKE 沒收乾淨, 或有人多 GRANT 了', v_extra;
    END IF;
  END;
  RAISE NOTICE '事後閘通過(①建得出來 ②是 INVOKER 不是 DEFINER ③proacl 非 NULL ④PUBLIC 不在 ACL 裡 ⑤逐角色:該有的有、不該有的沒有)。🛑 它們證不到的:(a)**不驗行為** —— 回傳對不對、AND 是不是真的 AND, 在 scripts/storefront-search-brand-verify.sh;(b)不驗**呼叫端有沒有照約定只拿 id 去取投影**, 那是 TS 側的測試;(c)不驗效能。';
END
$$;
