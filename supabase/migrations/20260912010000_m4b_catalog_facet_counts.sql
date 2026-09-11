-- 20260912010000_m4b_catalog_facet_counts.sql —— 目錄頁側欄件數:一發 GROUP BY 回全部分類 / 品牌件數
--
-- 起因:Sean 2026-09-12 在 www 選「外觀與後視鏡」+ 品牌「EAZI-GRIP」⇒ 右邊 0 件, 左邊分類件數仍是全站數。
--   原話「我以為會跟我們選車種的方式一樣」。Sean 拍乙(動 DB)+ 批 plan + 價格不疊(甲)。
--   plan:docs/plans/2026-09-12-facet-counts-groupby-rpc-plan.md
--
-- 做什麼:**只新增**一支函式 `catalog_facet_counts`, 不改任何既有函式 / 表 / view。
--   取代前端每次 108 發的 `search_catalog_by_vehicle(p_limit=1)` fan-out(lib/vehicle-facet-counts.ts)。
--
-- 語意(各面板不疊自己那一維):
--   分類面板 = 車 ∧ 已選品牌        (不看已選分類)
--   品牌面板 = 車 ∧ 已選分類(聯集)(不看已選品牌)
--   ⇒ 每一格回答的是「如果我再點這一格, 右邊會有幾件」。
--   不吃:關鍵字(有關鍵字時前端不印件數, Sean 09-11 拍乙)· 新品(Q21=B 不印)· 價格(Sean 09-12 拍甲不疊)。
--
-- 🔴 述詞是【抄】的, 來源 = `search_catalog_by_vehicle` 最新一代
--    `20260909070000_m4b_search_exact_match_first_in_catalog_rpc.sql`:
--      已選分類正規化 :323-330(btrim + 丟空字串)
--      分類比對 :356-358 / :548-550(`= vc OR LIKE vc || ' · %'`)
--      品牌比對 :359 / :551
--      matched(車)   :527-541(product_fitments UNION product_fitments_effective, 年份兩端可 NULL)
--    兩份會漂 ⇒ 三道釘:① scripts/20260912010000-verify.sh(拋棄式 PG 對照矩陣 + 突變)
--    ② apps/storefront/src/lib/facet-predicate-parity.test.ts(靜態比對兩支最新定義)
--    ③ 本檔尾段的行為閘:對正式資料逐格比對兩支函式, 不一致就整支回滾。
--
-- 權限:SECURITY INVOKER(與 search_catalog_by_vehicle 同, 讀公開投影 products_list_public)。
--   只回件數, 不回任何商品欄位 / 價格。anon 必須能執行(顧客站 route 用 anon client)。
--
-- 效能(2026-09-12 正式庫唯讀 EXPLAIN ANALYZE, 展開成純 SELECT, 不是本函式本身):
--   沒車兩面板 45.6 ms;有車只選 Ducati 3,959.8 ms(慢在 matched, 商品列表那支本來就付同一段)。
--
-- rollback:supabase/rollbacks/20260912010000-rollback.sql(DROP FUNCTION;無資料寫入)。
--   該檔第一行就是 SET LOCAL lock_timeout = '5s';(照 repo 慣例, 拿不到鎖就放棄, 不無限等)
--   🔴 前端先 revert 再撤這支, 反過來 = 前端叫不到 ⇒ 503 ⇒ 件數不顯示(fail-safe, 不會印錯數字)。
BEGIN;
SET LOCAL lock_timeout = '5s';
-- 事後閘③ 會對正式資料各跑 12 發兩支函式(6 發帶車);貼的 session 若有較短的逾時會整支回滾
-- ⇒ 放寬到 120 秒(前例 20260906400000 用 60s)。預期實際數秒內跑完(未量)。
SET LOCAL statement_timeout = '120s';

-- 🔴 用 CREATE, 不用 CREATE OR REPLACE:撞名要報錯停下, 不是靜靜蓋掉
--    (docs/patterns/revoking-function-execute-in-supabase.md §3.2)。
CREATE FUNCTION public.catalog_facet_counts(
  p_category_keys        text[],
  p_brand_keys           text[],
  p_brand                text    DEFAULT NULL,
  p_model                text    DEFAULT NULL,
  p_year                 integer DEFAULT NULL,
  p_selected_categories  text[]  DEFAULT NULL,
  p_selected_brand_slugs text[]  DEFAULT NULL
)
 RETURNS TABLE(facet text, key text, n bigint)
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH sel AS (
    -- 已選分類:與列表的 v_cats 同一個正規化(btrim 寫回、丟空字串、去重)
    SELECT coalesce(array_agg(DISTINCT btrim(x)), ARRAY[]::text[]) AS cats
      FROM unnest(coalesce(p_selected_categories, ARRAY[]::text[])) AS x
     WHERE btrim(x) <> ''
  ), matched AS (
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
  ), g AS (
    -- 一次掃描收成 (分類, 品牌) 組(正式庫全目錄 370 組)
    -- 🔵 沒車 = 列表的 `IF p_brand IS NULL` 那一支:不看 p_model / p_year
    SELECT p.category_raw, p.brand_slug, count(*) AS n
      FROM public.products_list_public p
     WHERE p_brand IS NULL OR p.id IN (SELECT m.product_id FROM matched m)
     GROUP BY p.category_raw, p.brand_slug
  ), ck AS (
    -- 🔵 key 原樣回傳, 比對用 btrim 後的值 —— 列表那一側的 facet key 也會被 v_cats btrim
    --    空白 key 不回列 ⇒ 前端當「沒有數字」(不是 0)
    SELECT DISTINCT k AS key, btrim(k) AS kt
      FROM unnest(coalesce(p_category_keys, ARRAY[]::text[])) AS k
     WHERE btrim(k) <> ''
  ), bk AS (
    SELECT DISTINCT b AS key
      FROM unnest(coalesce(p_brand_keys, ARRAY[]::text[])) AS b
  )
  SELECT 'category'::text, ck.key, coalesce(sum(g.n), 0)::bigint
    FROM ck
    LEFT JOIN g
      ON (g.category_raw = ck.kt OR g.category_raw LIKE ck.kt || ' · %')
     AND (p_selected_brand_slugs IS NULL OR cardinality(p_selected_brand_slugs) = 0
          OR g.brand_slug = ANY(p_selected_brand_slugs))
   GROUP BY ck.key
  UNION ALL
  SELECT 'brand'::text, bk.key, coalesce(sum(g.n), 0)::bigint
    FROM bk
    CROSS JOIN sel
    LEFT JOIN g
      ON g.brand_slug = bk.key
     AND (cardinality(sel.cats) = 0
          OR EXISTS (SELECT 1 FROM unnest(sel.cats) AS vc
                      WHERE g.category_raw = vc OR g.category_raw LIKE vc || ' · %'))
   GROUP BY bk.key;
$function$;

-- ── 權限:兩道 REVOKE 都下, 再具名 GRANT ─────────────────────────────────────
-- ACL-GATE-EXEMPT: public.catalog_facet_counts -- 顧客站目錄頁側欄件數, route 用 anon client 呼叫 ⇒ anon 必須能執行;INVOKER 讀公開投影、只回件數, 授權集合同 search_catalog_by_vehicle(anon/authenticated/service_role)(Sean 2026-09-12 拍乙, 20260912010000)
REVOKE ALL ON FUNCTION public.catalog_facet_counts(text[], text[], text, text, integer, text[], text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_facet_counts(text[], text[], text, text, integer, text[], text[]) TO anon, authenticated, service_role;

-- ── 事後閘 ──────────────────────────────────────────────────────────────────
DO $post$
DECLARE
  -- 收權斷言清單(house 慣例的形狀;下面 ①② 全部讀 c_fn = 這份清單的唯一一個)
  v_functions text[] := ARRAY['public.catalog_facet_counts(text[], text[], text, text, integer, text[], text[])']::text[];
  c_fn   regprocedure := v_functions[1]::regprocedure;
  r      record;
  v_cats text[];
  v_brs  text[];
  v_veh  record;
  v_got  bigint;
  v_want bigint;
  v_n    integer := 0;
BEGIN
  -- ① 屬性
  IF (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = c_fn) THEN
    RAISE EXCEPTION '事後閘①a:變成 SECURITY DEFINER 了 ⇒ 停';
  END IF;
  IF (SELECT p.proconfig FROM pg_catalog.pg_proc p WHERE p.oid = c_fn) IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] THEN
    RAISE EXCEPTION '事後閘①b:search_path 不是 public, pg_temp(實得 %)',
      (SELECT p.proconfig FROM pg_catalog.pg_proc p WHERE p.oid = c_fn);
  END IF;
  IF pg_catalog.pg_get_function_result(c_fn) <> 'TABLE(facet text, key text, n bigint)' THEN
    RAISE EXCEPTION '事後閘①c:回傳型別不是 TABLE(facet text, key text, n bigint)';
  END IF;

  -- ② ACL:只准 postgres / anon / authenticated / service_role;PUBLIC 不准;proacl 不得是 NULL
  IF (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = c_fn) IS NULL THEN
    RAISE EXCEPTION '事後閘②a:proacl 是 NULL ⇒ 等於 PUBLIC 可執行(pattern §3.6)';
  END IF;
  FOR r IN
    SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END AS who
      FROM pg_catalog.pg_proc p, LATERAL pg_catalog.aclexplode(p.proacl) a
     WHERE p.oid = c_fn AND a.privilege_type = 'EXECUTE'
  LOOP
    IF r.who NOT IN ('postgres', 'anon', 'authenticated', 'service_role') THEN
      RAISE EXCEPTION '事後閘②b:% 持有 EXECUTE ⇒ 名單外', r.who;
    END IF;
  END LOOP;
  IF NOT (has_function_privilege('anon', c_fn, 'EXECUTE')
          AND has_function_privilege('authenticated', c_fn, 'EXECUTE')
          AND has_function_privilege('service_role', c_fn, 'EXECUTE')) THEN
    RAISE EXCEPTION '事後閘②c:三個具名角色有人拿不到 EXECUTE ⇒ 目錄頁件數會壞';
  END IF;

  -- ③ 行為閘:對正式資料, 逐格比對「本函式的件數」與「search_catalog_by_vehicle 點下去的 total」
  --    ⇒ 「面板數字 = 點進去的件數」在【這個庫、這一刻】成立才准落地。不一致 ⇒ 整支回滾。
  --    樣本:件數最多的 3 個大類 + 3 個品牌;車 = fitment 數排第 3 的 (廠牌, 車型)(避開 Ducati 只選廠牌那種 4 秒的最壞情況)。
  SELECT array_agg(k) INTO v_cats FROM (
    SELECT split_part(category_raw, ' · ', 1) AS k FROM public.products_list_public
     WHERE category_raw IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 3) s;
  SELECT array_agg(b) INTO v_brs FROM (
    SELECT brand_slug AS b FROM public.products_list_public
     WHERE brand_slug IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 3) s;
  SELECT moto_brand, model_code INTO v_veh FROM public.product_fitments
   WHERE model_code IS NOT NULL GROUP BY 1, 2 ORDER BY count(*) DESC OFFSET 2 LIMIT 1;
  IF coalesce(cardinality(v_cats), 0) < 3 OR coalesce(cardinality(v_brs), 0) < 3 OR v_veh.moto_brand IS NULL THEN
    RAISE EXCEPTION '事後閘③⓪:這個庫抽不出樣本(大類 %/品牌 %/車 %)⇒ 行為沒有被驗到 ⇒ 停',
      coalesce(cardinality(v_cats), 0), coalesce(cardinality(v_brs), 0), v_veh.moto_brand;
  END IF;

  -- (a) 沒車, 分類面板疊第 1 個品牌;(b) 沒車, 品牌面板疊第 1 個大類;(c)(d) 同樣兩格換成有車
  FOR r IN
    SELECT * FROM (VALUES
      ('a', NULL::text, NULL::text), ('b', NULL, NULL),
      ('c', v_veh.moto_brand, v_veh.model_code), ('d', v_veh.moto_brand, v_veh.model_code)
    ) AS t(cell, vb, vm)
  LOOP
    IF r.cell IN ('a', 'c') THEN
      FOR i IN 1..3 LOOP
        SELECT f.n INTO v_got FROM public.catalog_facet_counts(v_cats, v_brs, r.vb, r.vm, NULL, NULL, ARRAY[v_brs[1]]) f
         WHERE f.facet = 'category' AND f.key = v_cats[i];
        SELECT coalesce(max(s.total), 0) INTO v_want FROM public.search_catalog_by_vehicle(
          ARRAY[v_cats[i]], r.vb, r.vm, NULL, 0, 1, 'new', NULL, ARRAY[v_brs[1]], NULL, NULL, NULL, NULL) s;
        IF v_got IS DISTINCT FROM v_want THEN
          RAISE EXCEPTION '事後閘③%:分類 % × 品牌 % × 車 %/% ⇒ 件數 % ≠ 列表 %', r.cell, v_cats[i], v_brs[1], r.vb, r.vm, v_got, v_want;
        END IF;
        v_n := v_n + 1;
      END LOOP;
    ELSE
      FOR i IN 1..3 LOOP
        SELECT f.n INTO v_got FROM public.catalog_facet_counts(v_cats, v_brs, r.vb, r.vm, NULL, ARRAY[v_cats[1]], NULL) f
         WHERE f.facet = 'brand' AND f.key = v_brs[i];
        SELECT coalesce(max(s.total), 0) INTO v_want FROM public.search_catalog_by_vehicle(
          ARRAY[v_cats[1]], r.vb, r.vm, NULL, 0, 1, 'new', NULL, ARRAY[v_brs[i]], NULL, NULL, NULL, NULL) s;
        IF v_got IS DISTINCT FROM v_want THEN
          RAISE EXCEPTION '事後閘③%:品牌 % × 分類 % × 車 %/% ⇒ 件數 % ≠ 列表 %', r.cell, v_brs[i], v_cats[1], r.vb, r.vm, v_got, v_want;
        END IF;
        v_n := v_n + 1;
      END LOOP;
    END IF;
  END LOOP;
  IF v_n <> 12 THEN
    RAISE EXCEPTION '事後閘③⑨:比對了 % 格(期望 12)', v_n;
  END IF;
  RAISE NOTICE '✅ catalog_facet_counts 事後閘全過:屬性 3 · ACL 3 · 行為 % 格(車 = % / %)', v_n, v_veh.moto_brand, v_veh.model_code;
END
$post$;

COMMIT;
