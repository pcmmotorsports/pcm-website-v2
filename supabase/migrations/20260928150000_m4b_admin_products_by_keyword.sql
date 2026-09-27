-- 20260928150000_m4b_admin_products_by_keyword.sql —— 商品頁乙 D1(M3):後台商品搜尋也找得到車款
-- pcm:idempotent: yes
--   ↑ 重跑同形:函式 CREATE OR REPLACE(簽章不變)· REVOKE / GRANT 可重下。
-- pcm:rule1-exception: 新函式刻意用 CREATE OR REPLACE —— 為了重貼冪等(pcm:idempotent: yes);簽章固定。2026-09-28 寫這支時各分支與 repo 都查無此名(前置閘不另查)。
--
-- 🛑 未貼。只寫不貼,貼的人是主視窗(Sean 2026-09-28 Q3 甲:本計畫的 migration 由主視窗直接貼)。
--    plan:~/pcm-mailbox/計畫-後台商品頁乙-20260928.md(M3、片 D1–D3)
--
-- ══ 為什麼 ══════════════════════════════════════════
-- 員工要在同一個搜尋框用料號、商品名稱、車款名稱找商品(計畫 D2;審視 L4)。車款住在兩張子表
-- (product_fitments 直接適用、product_fitments_effective 繼承適用;前台車款搜尋也看這兩張,
--  20260916240000:340)。
-- D1 先試了計畫寫的「PostgREST 內嵌」做法(2026-09-28 本機 PostgREST 14.16):結果正確(兩張表都找得到、
-- 同一件商品多筆年份不會重複算),但它是逐件商品去查子表,正式庫唯讀實測暖快取每發約 1.1 秒,
-- 一次列表要打 7 發(清單、總數、五顆「要處理」件數)⇒ 不採用。
--
-- ══ 做什麼(和計畫原寫法的差別)════════════════════════
-- 計畫原寫 admin_list_products_by_vehicle 在 SQL 裡把篩選、排序、分頁、計數全做一遍,篩選規則就會有兩份
-- (PostgREST 一份、SQL 一份),要靠 D3 一致性測試盯著。這支改成:
--   public.admin_products_by_keyword(p_term text) RETURNS SETOF public.products
--   只回「關鍵字命中」的商品列:料號 / 供應商標題 / 員工改過的標題 / 車款(車廠 + 車型)含這個詞。
-- 後台把它當成資料來源(PostgREST /rpc 回傳資料表型別時,可以在上面照常 select、篩選、排序、分頁、計數、
-- 內嵌品牌分類、用計算欄篩選)⇒ 品牌、分類、要處理、料號清單、排序、分頁全部沿用列表同一段程式,
-- 篩選規則只有一份。
-- 比對規則同後台原本的關鍵字搜尋(product-repository.ts buildProductKeywordOrFilter):
--   · 子字串、不分大小寫(ILIKE);\ % _ 當字面;* 當萬用字元(輸入框提示寫明,與原本 PostgREST 行為一致)。
--   · 車款比對「車廠 + 空白 + 車型」整串 ⇒ 打 Panigale、Ducati、Ducati Panigale V4 都找得到。
-- 正式庫唯讀實測(2026-09-28,暖快取,照本支的查詢形狀,展開後):「panigale」命中 2,154 件約 0.6 秒;
-- 「a」命中 22,849 件、取前 50 件約 1.1 秒;不含車款的原查詢約 0.17 秒。欄位名(product_id / moto_brand / model_code)同日用唯讀查詢核對過。
-- 慢在車款兩張表共約 49 萬列的子字串比對。
--   ponytail: 全表 ILIKE。之後嫌慢,給兩張表的 moto_brand || ' ' || model_code 加 pg_trgm GIN 索引即可(另一支 migration)。
--
-- 權限:LANGUAGE sql STABLE、SECURITY INVOKER(不提權)、刻意不設 search_path(為了能展開,理由見函式上方);EXECUTE 只給 service_role。
-- 回傳整列 products(含店家價等欄):只有 service_role 叫得到,後台照常用 select 字串決定要哪幾欄
-- (經銷價外洩守門看的是 select 字串,不受影響)。
--
-- ══ 貼的時候 ══════════════════════════════════════════
-- · 只建一支函式,不動表、不鎖表 ⇒ 任何時段都可以貼。
-- · 後台 D2 那顆碼(搜尋改走這支)要在本支貼完之後才推:碼先上 ⇒ 員工一搜尋就看到「商品列表載入失敗」,
--   不搜尋時照常。不會寫壞資料。
-- · 回滾:supabase/rollbacks/20260928150000-rollback.sql(DROP FUNCTION;要先退回 D2 的後台碼,反過來做搜尋會立刻失敗)。
-- ═══════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE
  v_relations text[] := ARRAY['public.products', 'public.product_fitments', 'public.product_fitments_effective']::text[];
  v_name text;
BEGIN
  FOREACH v_name IN ARRAY v_relations LOOP
    IF pg_catalog.to_regclass(v_name) IS NULL THEN
      RAISE EXCEPTION '前置閘失敗 — % 不存在', v_name;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
     WHERE attrelid = 'public.products'::regclass AND attname = 'staff_overrides' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION '前置閘失敗 — products.staff_overrides 不存在(20260927040000 未套用)';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.admin_products_by_keyword(p_term text)
RETURNS SETOF public.products
LANGUAGE sql
STABLE
-- 🔴 刻意【沒有】SET search_path:有 SET 子句的 SQL 函式不會被展開(inline)進外層查詢,
--    會先把所有命中的商品整列(含圖片、說明等大欄)做出來,外層才篩選、排序、取 50 件。
--    正式庫唯讀實測(2026-09-28)「a」命中 22,849 件:不展開約 4.4–5.6 秒,展開約 1.1 秒。
--    安全性:函式內每個資料表與函式都寫明 schema(public. / pg_catalog.);運算子(|| ILIKE ->>)
--    一律先從 pg_catalog 找(pg_catalog 不在 search_path 明列時永遠隱含排第一);只有 service_role 叫得到。
AS $fn$
  WITH t AS (
    -- 先把 \ % _ 當字面跳脫,再把 * 換成萬用字元(順序不可換:先換 * 會讓它產生的 % 被跳脫掉)。
    SELECT '%' || pg_catalog.replace(
                    pg_catalog.regexp_replace(p_term, '([\\%_])', '\\\1', 'g'),
                    '*', '%') || '%' AS pat
     WHERE pg_catalog.btrim(COALESCE(p_term, '')) <> ''
  )
  -- 🔴 寫成「id IN (三個來源 UNION)」,不寫成「料號 ILIKE … OR id IN (車款)」:
  --    OR 裡的 IN 子查詢結果太大時(例如搜「a」,車款表幾乎每列都中),planner 會放棄雜湊、
  --    改成每件商品重掃一次子查詢 ⇒ 正式庫唯讀實測超過 2 分鐘沒跑完。UNION 形狀同一個詞約 1.1 秒。
  SELECT p.*
    FROM public.products p
   WHERE p.id IN (
           SELECT q.id FROM public.products q, t
            WHERE q.external_id ILIKE t.pat
               OR q.title ILIKE t.pat
               OR (q.staff_overrides ->> 'title') ILIKE t.pat
           UNION
           SELECT f.product_id FROM public.product_fitments f, t
            WHERE (f.moto_brand || ' ' || f.model_code) ILIKE t.pat
           UNION
           SELECT e.product_id FROM public.product_fitments_effective e, t
            WHERE (e.moto_brand || ' ' || e.model_code) ILIKE t.pat
         );
$fn$;

COMMENT ON FUNCTION public.admin_products_by_keyword(text) IS
  '商品頁乙 D1(20260928150000):後台商品搜尋。回傳料號、供應商標題、員工改過的標題或車款(車廠+車型,兩張車款表)含關鍵字的商品列;\ % _ 當字面、* 當萬用字元;空白詞回零列。後台在結果上照常篩選、排序、分頁、計數。EXECUTE 僅 service_role。';

REVOKE ALL ON FUNCTION public.admin_products_by_keyword(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_products_by_keyword(text) TO service_role;

DO $post$
DECLARE
  v_functions text[] := ARRAY['public.admin_products_by_keyword(text)']::text[];
  v_name text;
  v_fn   oid;
BEGIN
  FOREACH v_name IN ARRAY v_functions LOOP
    v_fn := pg_catalog.to_regprocedure(v_name);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION '%:函式沒有建立成功', v_name;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '%:anon / authenticated 仍可 EXECUTE', v_name;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '%:service_role 沒有 EXECUTE', v_name;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid = v_fn AND prosecdef) THEN
      RAISE EXCEPTION '%:不應是 SECURITY DEFINER', v_name;
    END IF;
    -- 刻意不設 search_path(才能展開, 見函式上方);有人之後整批補 SET 會靜靜退回 4–5 秒, 這一格讓它紅(Fable R2 建議)。
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid = v_fn AND proconfig IS NOT NULL) THEN
      RAISE EXCEPTION '%:不應帶 SET 子句(會無法展開進外層查詢)', v_name;
    END IF;
  END LOOP;
  RAISE NOTICE '✅ 20260928150000:admin_products_by_keyword 在、只有 service_role 可執行、SECURITY INVOKER、沒有 SET 子句';
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
