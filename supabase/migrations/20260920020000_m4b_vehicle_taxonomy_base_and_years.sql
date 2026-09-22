-- 20260920020000_m4b_vehicle_taxonomy_base_and_years.sql
-- M-4b · 前台線(worktree pcm-ops)· 板列 ⟦db-TAXONOMYVIEW⟧ :2550
-- plan:~/pcm-mailbox/plan-車款樹443KB搬太久-20260920.md
--   🛑 **敘事在 plan,不在這裡**(docs/patterns/where-migration-narrative-goes.md)。
--   Sean 2026-09-20 對 plan 逐字「依照推薦」⇒ 批的是方向(把那包 443 KB 瘦下來)。
--
-- ══ 做什麼 ═══════════════════════════════════════════════════════════════════
-- **新增兩支函式。舊的 `public.get_vehicle_taxonomy()` 一個字不動。**
--   · `get_vehicle_taxonomy_base()`        ⇒ DISTINCT(牌子, 車款), **年份兩欄一律 NULL**
--   · `get_vehicle_model_years(p_brand)`   ⇒ **那一個牌子**的真年份列
-- 兩支都回與舊那支**逐字相同的形狀** `{ n, rows }`,`rows` 是
-- array-of-arrays `[moto_brand, model_code, year_start, year_end]`。
--
-- ══ 為什麼 ═══════════════════════════════════════════════════════════════════
-- 🔬 正式站實測:舊那支一發回 **12,503 列 / 443 KB**,而 DB 只花 **1,225.7 ms**
--    (正式庫唯讀 `EXPLAIN (ANALYZE) SELECT public.get_vehicle_taxonomy()`)
--    ⇒ 📌 **約 3.3 秒花在【搬】不是【查】** —— 這不是 DB 調校題。
-- 🔬 而首屏只用 69 個牌子、server 的搜尋解析只用 3,770 組「牌子+車款」
--    (`apps/storefront/src/lib/parse-search-facets.ts` grep `years`/`yearStart`/`yearEnd` ⇒ **0 命中**)
--    ⇒ **年份那 8,733 列(70%)要等客人選了車款才有人看。**
-- 🔬 體積(正式庫唯讀實量):12,503 列 `503,424` bytes ⇒ 3,770 列 `113,872` bytes(**-77%**)。
--
-- ══ 🛑 為什麼是【新增兩支】而不是【給舊那支加參數】—— 不要刪這一段 ═════════════
-- 加參數那一版撞到 `apps/storefront/src/lib/single-flight-stale.ts:13-18` 一個硬約束:
-- 它吃的是**零參數** loader、而且只記**一份**值(`let last`)
-- ⇒ 參數一旦會變,那一層會把【A 牌子的年份】發給【問 B 牌子的人】。
-- 🔴 **那是【靜默的錯資料】**:typecheck 綠、測試綠、沒有任何東西會叫。
-- ✅ 新增兩支換來三件:
--    ① **板先貼零風險** —— 新增,舊碼一個都不叫它們 ⇒ **沒有簽章空窗、沒有 PGRST202**
--       (CLAUDE.md〈Git〉逐字:「改既有函式的簽章 ⇒ 兩個方向都有空窗」—— 本片**避開**那一格)
--    ② **rollback 只 revert 碼那一顆,DB 完全不用退**
--    ③ **舊函式留著 ⇒ 出事時的對照組還在**(主視窗 2026-09-20 補的第三個理由)
--
-- ══ 🔴 `p_brand` 吃的是【牌子的名字】不是 slug ════════════════════════════════
-- `apps/storefront/src/lib/vehicle-taxonomy.ts:116` 逐字 `id: uniqueId(slugify(brandName), …)`
-- ⇒ slug 是 **TS 那一側算出來的**(撞名還會加序號)⇒ SQL 這一端**還原不回去**。
-- ⇒ 呼叫端手上已經有底盤樹,由它把 id 換成 name 再送。
--
-- ══ 形狀與既有那支對齊(照抄, 不是重新發明)═══════════════════════════════════
-- SECURITY INVOKER(`prosecdef = false`)· `SET search_path = ''` · GRANT 給 `anon` / `authenticated`
-- —— 三項都與正式庫上 `get_vehicle_taxonomy()` 今天的樣子逐字一致(2026-09-20 唯讀實查)。
-- 🔵 `COALESCE` **不加 `pg_catalog.` 前綴**(保留語法;舊那支檔頭記過同一個坑)。
--
-- 回頭路:`supabase/rollbacks/20260920020000-rollback.sql`

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.vehicle_taxonomy_public') IS NULL THEN
    RAISE EXCEPTION '前置閘①:public.vehicle_taxonomy_public 不存在 ⇒ 本片的來源整個不成立 ⇒ 停下';
  END IF;
  IF pg_catalog.to_regprocedure('public.get_vehicle_taxonomy()') IS NULL THEN
    RAISE EXCEPTION '前置閘②:舊的 get_vehicle_taxonomy() 不存在 ⇒ 本片宣稱「舊那支一個字不動」的前提不成立 ⇒ 停下';
  END IF;
  -- 🔵 **這裡刻意【沒有】「已存在就跳過」那種話** —— 下面兩支是**裸 `CREATE`**:
  --    撞名要當場紅。`migration-static-checks` 規則① 逐字:「OR REPLACE 會把撞名靜靜蓋掉,
  --    而你的 REVOKE 與斷言照樣綠 —— 拿到綠燈, 卻蓋掉了一個你不知道存在的東西。」
  --    ⛔ ~~本片第一版寫 CREATE OR REPLACE~~ ⇒ 那道靜態閘當場擋下來, 改成裸 CREATE。
END
$pre$;

CREATE FUNCTION public.get_vehicle_taxonomy_base()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  -- 🔵 `MATERIALIZED` 讓聚合只算一次(照舊那支的做法, 少了它可能被 inline 成兩次全掃)。
  WITH r AS MATERIALIZED (
    SELECT COALESCE(
             pg_catalog.jsonb_agg(
               -- 🔴 年份兩欄**一律 NULL** —— 那不是壞掉, 是既有語意:
               --    `products-vehicle-taxonomy.test.ts:149`「year_start = null ⇒ 該列不貢獻年份」。
               pg_catalog.jsonb_build_array(d.moto_brand, d.model_code, NULL, NULL)
               ORDER BY d.moto_brand, d.model_code),
             '[]'::jsonb) AS rows_json
      FROM (SELECT DISTINCT v.moto_brand, v.model_code
              FROM public.vehicle_taxonomy_public v) d
  )
  SELECT pg_catalog.jsonb_build_object(
           'n', pg_catalog.jsonb_array_length(r.rows_json),
           'rows', r.rows_json)
    FROM r;
$fn$;

CREATE FUNCTION public.get_vehicle_model_years(p_brand text)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  WITH r AS MATERIALIZED (
    SELECT COALESCE(
             pg_catalog.jsonb_agg(
               -- 🔴🔴 **開放式(`year_end IS NULL`)的上界在這裡就算好** —— R1 must-fix M1。
               --   🎯 **這不是「選一個合理的上界」, 這是【逐字複製今天的行為】**:
               --      今天 `apps/storefront/src/lib/vehicle-taxonomy.ts:93` 逐字
               --      `else if (f.yearEnd === null) ye = Math.max(ys, maxYear);`
               --      而 `maxYear`(`:57-63`)是【餵進去那批列的最大年】—— **今天餵的是整張 view**
               --      ⇒ **全表 max == 今天的 maxYear**。
               --   🔴 **不這樣做會壞成什麼樣(正式庫 2026-09-20 實量, 不是構造的例子)**:
               --      全站最大年 2027 · 有開放式列的牌子 **31** 個 · 其中會縮的 **28** 個 ·
               --      受影響開放式列 **548 / 779 = 70%** · 縮最兇的上界 **2027 → 2017 = 少掉 10 年**。
               --      📌 **那不是邊角案例, 那是這條路的常態** ——
               --      下一個人想為了省這次全表 max 把它拿掉之前, 先讀這三行數字。
               --   ✅ 而它順手讓這條路上【不再有 null year_end】⇒ `:93` 那個分支走不到。
               pg_catalog.jsonb_build_array(
                 v.moto_brand, v.model_code, v.year_start,
                 COALESCE(v.year_end,
                          (SELECT GREATEST(pg_catalog.max(w.year_start),
                                           pg_catalog.max(w.year_end))
                             FROM public.vehicle_taxonomy_public w)))
               ORDER BY v.moto_brand, v.model_code, v.year_start, v.year_end),
             '[]'::jsonb) AS rows_json
      FROM public.vehicle_taxonomy_public v
     -- 🔴 原字面等值, **不 lower / 不 btrim** —— 與那張 view 的 anti-join 同一條理由
     --    (`20260811100000` 檔頭:正規化版實測 413ms → 1,170ms 且排序溢出磁碟)。
     --    ⇒ 呼叫端送的是**底盤樹裡那個 `moto_brand` 的原字面**, 兩邊同一個來源。
     WHERE v.moto_brand = p_brand
  )
  SELECT pg_catalog.jsonb_build_object(
           'n', pg_catalog.jsonb_array_length(r.rows_json),
           'rows', r.rows_json)
    FROM r;
$fn$;

-- ══ 收權:兩道 REVOKE 再 GRANT(docs/patterns/revoking-function-execute-in-supabase.md §1)══
-- 🔴 **新建的函式 Postgres 預設把 EXECUTE 給 `PUBLIC`** ⇒ 只 GRANT 不 REVOKE = 全世界叫得動。
--    §2 逐字:只下其中一道都收不乾淨(而且與 `rolinherit` 無關)。
REVOKE ALL ON FUNCTION public.get_vehicle_taxonomy_base() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_vehicle_taxonomy_base() FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_vehicle_model_years(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_vehicle_model_years(text) FROM anon, authenticated, service_role;

-- 形狀與既有那支對齊(2026-09-20 唯讀實查 get_vehicle_taxonomy() 的 proacl 就是這兩個角色
-- —— 🔵 **沒有 `service_role`**, 所以這裡也不給它)。
-- ACL-GATE-EXEMPT: public.get_vehicle_taxonomy_base -- 給顧客站客人(anon)讀車款下拉用;比照正式庫 get_vehicle_taxonomy() 現有 proacl(2026-09-20 唯讀實查 anon/authenticated);同檔事後斷言① 驗 anon 可執行、PUBLIC 已收;主視窗 2026-09-22 裁照前例豁免(20260920020000)
-- ACL-GATE-EXEMPT: public.get_vehicle_model_years -- 給顧客站客人(anon)讀單一牌子年份用;比照正式庫 get_vehicle_taxonomy() 現有 proacl(2026-09-20 唯讀實查 anon/authenticated);同檔事後斷言① 驗 anon 可執行、PUBLIC 已收;主視窗 2026-09-22 裁照前例豁免(20260920020000)
GRANT EXECUTE ON FUNCTION public.get_vehicle_taxonomy_base() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_vehicle_model_years(text) TO anon, authenticated;

DO $post$
DECLARE
  -- 🔴 收權斷言清單(`migration-static-checks` 規則③ 數的就是這個)——
  --    本片新增幾個可授權物件, 這裡就要列幾個。
  v_functions text[] := ARRAY[
    'public.get_vehicle_taxonomy_base()',
    'public.get_vehicle_model_years(text)'
  ]::text[];
  v_fn     text;
  v_base   jsonb;
  v_years  jsonb;
  v_brand  text;
  n_base   integer;
  n_years  integer;
  v_global_max integer;
  v_open_brand text;
BEGIN
  -- ① 兩支都要在、anon 叫得動(不然碼推上去 PGRST202), 而 PUBLIC 要收乾淨
  FOREACH v_fn IN ARRAY v_functions LOOP
    IF pg_catalog.to_regprocedure(v_fn) IS NULL THEN
      RAISE EXCEPTION '事後斷言①:% 沒建起來', v_fn;
    END IF;
    IF NOT pg_catalog.has_function_privilege('anon', v_fn::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION '事後斷言①:anon 叫不動 %', v_fn;
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', v_fn::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION '事後斷言①:authenticated 叫不動 %', v_fn;
    END IF;
    -- 🔴 照 §3.6:ACL 欄是 NULL 時 PUBLIC 那份【看不見】⇒ 一律 coalesce(acldefault)
    IF EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc p,
             LATERAL pg_catalog.aclexplode(
               -- 🔴 `COALESCE` **不加 `pg_catalog.` 前綴**(保留語法)——
               --    ⛔ ~~本片第一版加了~~ ⇒ 拋棄式 PG 當場
               --    `ERROR: function pg_catalog.coalesce(aclitem[], aclitem[]) does not exist`。
               --    📌 **而這個坑就寫在本檔檔頭**(舊那支 `get_vehicle_taxonomy` 記過同一個),
               --       我照樣踩了一次 —— 擋下它的是【真的跑一遍】, 不是讀那段註解。
               COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
       WHERE p.oid = v_fn::regprocedure
         AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION '事後斷言①:% 的 PUBLIC EXECUTE 沒有收掉', v_fn;
    END IF;
  END LOOP;

  -- ② 🔴 底盤【不可以】帶年份 —— 這一格是本片最重要的:帶了年份 = 什麼都沒省
  v_base := public.get_vehicle_taxonomy_base();
  n_base := (v_base ->> 'n')::integer;
  IF n_base IS NULL OR n_base = 0 THEN
    RAISE EXCEPTION '事後斷言②:底盤回 0 列 ⇒ 車款下拉會整個空掉 ⇒ 停下(n=%)', n_base;
  END IF;
  IF pg_catalog.jsonb_typeof((v_base -> 'rows' -> 0) -> 2) <> 'null'
     OR pg_catalog.jsonb_typeof((v_base -> 'rows' -> 0) -> 3) <> 'null' THEN
    RAISE EXCEPTION '事後斷言②:底盤第 0 列的年份兩欄不是 null ⇒ 沒有瘦到';
  END IF;

  -- ③ 🔴 而底盤必須【真的比舊那支少】—— 少不了就代表 DISTINCT 沒生效
  IF n_base >= ((public.get_vehicle_taxonomy() ->> 'n')::integer) THEN
    RAISE EXCEPTION '事後斷言③:底盤 % 列, 不比舊那支少 ⇒ DISTINCT 沒生效', n_base;
  END IF;

  -- ④ 年份那支要真的回年份, 而且只回那一個牌子
  SELECT (v_base -> 'rows' -> 0 ->> 0) INTO v_brand;
  v_years := public.get_vehicle_model_years(v_brand);
  n_years := (v_years ->> 'n')::integer;
  IF n_years IS NULL OR n_years = 0 THEN
    RAISE EXCEPTION '事後斷言④:牌子「%」的年份回 0 列 ⇒ 年份下拉會空掉', v_brand;
  END IF;
  IF EXISTS (SELECT 1
               FROM pg_catalog.jsonb_array_elements(v_years -> 'rows') e
              WHERE (e ->> 0) IS DISTINCT FROM v_brand) THEN
    RAISE EXCEPTION '事後斷言④:年份那支回了【別的牌子】的列 ⇒ 過濾沒生效';
  END IF;

  -- ⑤ 🔴🔴 **開放式年份的上界要是【全站】那一個, 不是這個牌子自己的** —— R1 must-fix M1。
  --    🔬 正式庫實量(2026-09-20):28 / 31 個有開放式列的牌子會縮, 最兇 2027 → 2017。
  --    🛑 這一格只有【SQL 這一端】做得到 —— TS 那端結構上不知道全站最大年(理由見 products.ts)。
  -- 🔴🔴 **兩欄一起取, 而【兩處都要】** —— R2 must-fix MF-1。
  --    🔬 `apps/storefront/src/lib/vehicle-taxonomy.ts:60-61` 是**兩行**:
  --       `if (typeof f.yearStart === 'number') maxYear = Math.max(maxYear, f.yearStart);`
  --       `if (typeof f.yearEnd   === 'number') maxYear = Math.max(maxYear, f.yearEnd);`
  --       ⇒ 今天的 `maxYear` 是 **year_start ∪ year_end 兩欄的最大值**。
  --    ⛔ ~~本片第一版兩處都只寫 `max(year_end)`~~ ⇒ 一列 `('Suzuki','GSX',2028,NULL)`
  --       **自己貢獻全站最大年而完全不進 `max(year_end)`** ⇒ 上界被壓成 2027
  --       ⇒ `vehicle-taxonomy.ts:96` 的 `for (y=2028; y<=2027)` **一圈都不跑** ⇒ 那個車款年份**整個空**。
  --    🔴 **而當時的斷言⑤ 用【同一個 max(year_end)】當尺** ⇒ 2027 >= 2027 恆過
  --       ⇒ 📌 **用瑕疵本身去量瑕疵。只改函式不改這一行, 這一格會繼續恆過。**
  --    🔵 `GREATEST` 會略過 NULL;而它順手讓「year_end 全 NULL ⇒ 上界 NULL ⇒ 每個牌子都 500」
  --       那個分支不可達(只要 year_start 還有值)—— R2 nit N-c。
  SELECT GREATEST(pg_catalog.max(w.year_start), pg_catalog.max(w.year_end))
    INTO v_global_max
    FROM public.vehicle_taxonomy_public w;
  SELECT w.moto_brand INTO v_open_brand
    FROM public.vehicle_taxonomy_public w
   WHERE w.year_end IS NULL AND w.year_start IS NOT NULL
   LIMIT 1;
  -- 🛑 R2 nit N-b:`LIMIT 1` 沒有 `ORDER BY` ⇒ 挑到哪一個牌子不保證;
  --    而更值得補的是 `ELSE` —— **一格「條件不成立就靜靜跳過」的斷言, 跟沒有那格長得一樣。**
  IF v_open_brand IS NOT NULL THEN
    v_years := public.get_vehicle_model_years(v_open_brand);
    IF EXISTS (SELECT 1
                 FROM pg_catalog.jsonb_array_elements(v_years -> 'rows') e
                WHERE pg_catalog.jsonb_typeof(e -> 3) = 'null') THEN
      RAISE EXCEPTION '事後斷言⑤:牌子「%」回了 null year_end ⇒ 開放式上界沒有被 COALESCE', v_open_brand;
    END IF;
    IF v_global_max IS NOT NULL
       AND (SELECT pg_catalog.max((e ->> 3)::integer)
              FROM pg_catalog.jsonb_array_elements(v_years -> 'rows') e) < v_global_max THEN
      RAISE EXCEPTION '事後斷言⑤:牌子「%」的上界只到 % ⇒ 比全站最大年 % 小 ⇒ 年份下拉會少掉好幾年',
        v_open_brand,
        (SELECT pg_catalog.max((e ->> 3)::integer) FROM pg_catalog.jsonb_array_elements(v_years -> 'rows') e),
        v_global_max;
    END IF;
  ELSE
    RAISE NOTICE '事後斷言⑤:**跳過** —— view 裡沒有任何開放式列(year_end IS NULL 且 year_start 非空)⇒ 這一格這次什麼都沒驗';
  END IF;

  -- ⑥ 🔴 **牌子字面:正規化之後同一群, 只准有一個原字面** —— R2 must-fix MF-2。
  --    🔬 底盤樹 `vehicle-taxonomy.ts:76` 用 `normalizeVehicleQuery`(NFKC + trim + lower)分群、
  --       `:80` 取 **first-seen** 字面 ⇒ view 同時有 `'Honda'` 與 `'HONDA'` 時, 底盤只留一種,
  --       而年份那支是**原字面等值** ⇒ **只拿得到一半的車款** ⇒ 另一半年份永遠是空的。
  --    🔴 **而那一種 `n` 是 1 不是 0 ⇒ TS 那道 `n = 0 ⇒ throw` 擋不到它。**
  --    ⛔ ~~🔬 2026-09-20 正式庫實查:69 群、群內多字面 **0**、未 trim 的列 **0**~~
  --       🔴 **那一發是用【舊鍵】量的 ⇒ 對 NFKC-only 那一種【證不到】。** 舊字面留著不刪。
  --    ⇒ 📌 **而「今天 0」本來就是【現況】不是【約束】** —— 這一格是把現況升級成 apply 當下的約束。
  --    🔵 刻意**不在 `WHERE` 包 `btrim/lower`**:`20260811100000` 檔頭量到那條路 413ms → 1,170ms。
  -- 🔴🔴 **分群的鍵必須與 app 那一把【逐字同源】** —— R3 must-fix MF-2。
  --    🔬 app 的鍵:`apps/storefront/src/lib/vehicle-match.ts:8`
  --       `q.normalize('NFKC').trim().toLowerCase()`
  --    ⛔ ~~本片前一版用 `btrim(lower(moto_brand))`~~ ⇒ 🔴 **NFKC 折得比它多**
  --       ⇒ 存在「這一格過, 而 app 仍然合併」的方向:view 同時有 `'Honda'` 與**全形** `'Ｈｏｎｄａ'`
  --       ⇒ 舊鍵算出 `'honda'` 與 `'ｈｏｎｄａ'` **兩群各一個字面 ⇒ 不 RAISE**,
  --          而 app NFKC 後同鍵 ⇒ 併成一個節點、只留 first-seen 字面
  --          ⇒ 年份那支只拿得到一半的車款, 而 **n = 1 不是 0** ⇒ TS 那道 throw 也擋不到。
  --    🔴 **而前一版檔頭那句「正式庫實查群內多字面 0」是用【舊鍵】量的**
  --       ⇒ 📌 **它結構上量不到 NFKC-only 那一種** —— 「用瑕疵本身當尺」在本片第三次。
  --    🔬 `normalize(x, NFKC)` 是**保留語法**, **不加 `pg_catalog.` 前綴**(加了會炸, 同 `COALESCE`)。
  --       ✅ 2026-09-20 拋棄式 PG 17.10 實跑, `SET search_path = ''` 之下:
  --          `lower(btrim(normalize('Ｈｏｎｄａ', NFKC)))` ⇒ `honda` = `'Honda'` 那一邊 ⇒ `t`
  --          而 `lower(btrim('Ｈｏｎｄａ')) = lower(btrim('Honda'))` ⇒ **`f`**(舊鍵確實瞎)
  --    🔬 靶的兩個方向都跑過:同一組資料, 舊鍵**不紅**、新鍵**紅** ⇒ 那一列真的是靶, 而舊鍵真的看不到。
  -- 🔴🔴 **trim 的字元集也要與 JS `String.prototype.trim()` 同源** —— R4 must-fix MF-3。
  --    ⛔ ~~`btrim(x)`~~ 只去半形空白;而 JS `trim()` 去的是 WhiteSpace + LineTerminator(ECMA-262):
  --       Tab / LF / VT / FF / CR / 空白 / NBSP / U+1680 / U+2000–200A / U+2028 / U+2029 / U+202F / U+205F / U+3000 / BOM(U+FEFF)。
  --    ⇒ NFKC **不會**把 BOM、Tab、U+2028 變成空白 ⇒ view 同時有 `'Honda'` 與 `'Honda'||BOM` 時,
  --       舊鍵分兩群(不 RAISE),而 app 併成一群 ⇒ 又是「只拿到一半的車款」那一種。
  --    ⇒ 下面那串是 JS trim 的完整字元集(U& 逸出, 需 standard_conforming_strings = on, Supabase 預設)。
  IF EXISTS (
    SELECT 1
      FROM public.vehicle_taxonomy_public
     GROUP BY lower(btrim(normalize(moto_brand, NFKC),
                          U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'))
    HAVING pg_catalog.count(DISTINCT moto_brand) > 1
  ) THEN
    RAISE EXCEPTION '事後斷言⑥:有牌子正規化後同一群而原字面不只一個 ⇒ 年份那支會只拿到一半的車款, 而 n 不是 0(TS 那道 throw 擋不到)⇒ 停下';
  END IF;

  RAISE NOTICE '底盤 % 列 / 牌子「%」年份 % 列 / 全站最大年 %', n_base, v_brand, n_years, v_global_max;
END
$post$;

-- R2 nit N-d:兩支都留一句 COMMENT(形狀照 20260906400000:127- 那一段)。
COMMENT ON FUNCTION public.get_vehicle_taxonomy_base() IS
  '車款樹【底盤】:DISTINCT(moto_brand, model_code), 年份兩欄一律 NULL。回 {n, rows}, rows 是 [brand, model, year_start, year_end]。年份請用 get_vehicle_model_years(牌子名)。';
COMMENT ON FUNCTION public.get_vehicle_model_years(text) IS
  '單一牌子的年份列。p_brand 吃【牌子的原字面】不是 slug。開放式(year_end IS NULL)的上界在這裡就 COALESCE 成全站最大年(year_start 與 year_end 兩欄一起取)。';

COMMIT;
