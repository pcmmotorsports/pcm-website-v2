-- 20260909070000_m4b_search_exact_match_first_in_catalog_rpc.sql
--
-- 🎯 **料號完全命中排最前 —— 把它接回兩支目錄 RPC。**
--
-- ✅ Sean 2026-09-09 拍【甲】(經主視窗轉達)。plan:
--    `docs/plans/2026-09-09-search-exact-match-first-in-catalog-rpc-plan.md`
--
-- 🔴 **這不是新功能, 是擋一個回歸。** 板列 `⟦db-SEARCHFACETMUTEX⟧` 要把顧客站的
--    「關鍵字」與「facet」兩條資料路併成一條;而併路的碼一旦上線,
--    `storefront_search_product_ids` 自己那段 `ORDER BY`(完全命中排最前,
--    Sean 2026-09-06 逐字「完全命中的排最前」)**會在目錄 RPC 這一行蒸發**:
--
--        OR p.id IN (SELECT k.id FROM public.storefront_search_product_ids(…) k)
--                    ^^^^^^^^^^^^ `IN (SELECT …)` 是集合語意 ⇒ 順序當場丟掉
--
--    ⇒ 然後外層照 `p_sort`(預設 `recommend`)重排。
--
-- 🔬 **影響量到了, 而它是最壞的形狀**(2026-09-09,樣本 `VF11`):
--        今天(未合路)  完全命中那顆排 **第 1**   ← 正式站瀏覽器實測, 逐一讀 14 張卡片
--        合路之後       排 **第 14 = 最後一名**  ← 唯讀 SQL 用線上那條 recommend 公式重算
--    成因:`recommend` 同價格帶內**依價格由高到低**, 而完全命中的 `VF11` 是 NT$290、
--    其餘 13 顆 320-350 ⇒ 📌 **「客人打的就是這一顆的料號」在 `recommend` 眼裡是零資訊。**
--    🟢 正對照:正式站搜 `VF11` 回 14 件, 與 SQL 列舉的 14 顆 `external_id` 逐一相同。
--    🛑 **這個樣本沒有更糟只是因為它小** —— 14 < 一頁 50;候選集一超過一頁,
--       完全命中那顆會掉到第二頁, 而客人不會翻。
--
-- ── 做法(plan §3 的【甲案】)─────────────────────────────────────────────────
--    ① `storefront_search_product_ids` 多回一欄 `is_exact`
--       —— 把它現行 `ORDER BY` 裡那整段 `EXISTS` **原封提成輸出欄**, `ORDER BY` 改成引用別名
--       ⇒ 🔵 那段 `EXISTS` 全檔仍然**只有一份**(抄成兩份會漂)。
--    ② 兩支目錄 RPC 各兩個分支:關鍵字命中集合提成 `kw AS MATERIALIZED` CTE,
--       `LEFT JOIN kw`, `WHERE` 的 `IN (SELECT …)` 換成 `kw.id IS NOT NULL`
--    ③ 兩支目錄 RPC 各兩個 `ORDER BY` 最前面插一鍵:
--       `CASE WHEN p_sort = 'recommend' AND p_terms IS NOT NULL THEN NOT f.kw_exact END`
--
-- 🔵 **為什麼是甲不是乙丙**(plan §3 逐字):
--    乙(`WITH ORDINALITY`)與丙(目錄 RPC 自己重算)**rollback 都比較小**,
--    而乙會把 `recommend` 整個換掉(helper 的第二鍵是 `h.id` 不是價格),
--    丙會讓那段 `EXISTS` 變成**三份**。
--    ⇒ 🎯 **乙丙省下的是 rollback 的工, 換來的是一個會漂的定義。**
--
-- ⚠️ **本片的成本, 明寫**:`kw` CTE 在 `p_terms IS NULL` 時**照樣跑一次**
--    (今天那個 `OR` 在 `IS NULL` 那一項就短路了 ⇒ 零次)。那一次是**零列**:
--    `array_agg` 對空集合回 NULL ⇒ 函式內 `unnest(NULL)` ⇒ 零詞 ⇒ 它自己的
--    `WHERE n.want > 0` 直接回零列。
-- ⚠️ **而這句要收窄(codex nit 4)**:⛔ ~~「一次零列呼叫」~~ ——
--    `MATERIALIZED` **不保證每次一定求值**(父查詢不需要時可能不求值), 而它同時
--    **擋掉條件下推** ⇒ 零列證不出零掃描、也證不出成本固定。
--    ✅ 說得準的是:**需要求值時回零列;沒有關鍵字的【結果與排序】維持不變
--    (2026-09-09 拋棄式 PG 實測前 20 筆逐列相同), 而【執行成本】可能改變。**
--    🛑 成本那一半要 `EXPLAIN (ANALYZE, BUFFERS)` 才算數 —— **本片沒量。**
--
-- 🔴🔴 **基底 = 正式庫的 `pg_get_functiondef`(2026-09-09 唯讀撈), 不是任何 migration 檔。**
--    理由是量到的:`search_catalog_by_vehicle` 今天是**第三次**被改
--    (`20260909010000` 加 `p_terms` · `20260909050000` 拿掉批次日 · 本支),
--    而我今天**已經差點用錯基底一次** —— 交辦給的落點是 `20260906910000`(12 參數版),
--    用它重貼會把同日稍早上線的關鍵字搜尋整個蓋掉, **而三綠全過**。
--
-- 🔴 **三支一起改、同一支 migration。** 只改公開那支的下場:
--    一般會員的搜尋完全命中排第一、經銷會員排第十四, **而兩邊都不會紅。**
--
-- 🛑 本檔由窗 A 產出、**未 apply**。貼正式庫由主視窗代貼(Sean 2026-09-08 常設授權)。
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── ① 關鍵字 helper:多回一個 `is_exact` 欄 ──────────────────────────────────
-- 🔴 `RETURNS TABLE` 加欄位**不能** `CREATE OR REPLACE`(`ERROR: cannot change return type`)
--    ⇒ 只能 `DROP` + `CREATE`。而 `DROP` 會把 ACL 一起丟 ⇒ 下面四行把它還原。
DROP FUNCTION IF EXISTS public.storefront_search_product_ids(text[]);
CREATE FUNCTION public.storefront_search_product_ids(p_terms text[])
 RETURNS TABLE(id uuid, is_exact boolean)
 LANGUAGE sql
 STABLE
AS $function$
  WITH t AS (
    -- 🔴 逐詞編號 ⇒ 下面用「不同詞的個數」判斷「每個詞都中了」
    --    `WITH ORDINALITY` 讓重複的詞不會被摺疊成一個(打兩次同一個字仍是一個條件)
    -- 🔵 `pat` = 逃脫後的完整 LIKE 樣式, **在這裡算一次、下面三處引用**。
    --    三層 replace 的順序有意義(先 `\` 再 `%` 再 `_`)⇒ 抄成三份會各自漂;
    --    而抽成 SQL 函式是一支**新 DB 物件**(GRANT/REVOKE/審查全部跟著來)⇒ 用 CTE 欄位。
    SELECT DISTINCT ON (term) term, ord,
           '%' || replace(replace(replace(term, '\', '\\'), '%', '\%'), '_', '\_') || '%' AS pat
      FROM unnest(coalesce(p_terms, ARRAY[]::text[])) WITH ORDINALITY AS u(term, ord)
     -- 空字串 / 全空白的詞丟掉 —— 留著會變成 `%%` 而那會命中全部
     WHERE btrim(term) <> ''
  ),
  n AS (SELECT count(*)::bigint AS want FROM t),
  -- ── ② 品牌:先自己撈, 再用 brand_id 回去比 ────────────────────────────
  -- 🔴🔴 **這一塊存在的唯一理由就是「不要讓 b.name 出現在 products 的 OR 裡」。**
  --    ⛔ ~~`LEFT JOIN brands b … OR b.name ILIKE …`~~ ⇒ 跨表欄位進 OR
  --       ⇒ planner 只能先 join 再過濾 ⇒ **products 上的索引全部用不到**(正式站 249.1ms)
  --    ⇒ 📌 下一個人「簡化」它回去合併成一個 OR:三綠全綠、行為零改變、而中文搜尋回到 243ms。
  bh AS (
    SELECT t.ord, br.id AS brand_id
      FROM public.brands br
      JOIN t ON br.name ILIKE t.pat
  ),
  -- ── hits:三塊各吐 `(id, ord)`, UNION ALL 在【(商品, 詞)】那一層 ──────────
  -- 🛑 **不可以搬到商品那一層**(理由見檔頭「UNION 的層級是正確性核心」)。
  hits AS (
    -- ① 四欄 OR:純 products_public 欄位、零跨表 ⇒ BitmapOr 吃得到 trgm
    SELECT p.id, t.ord
      FROM public.products_public p
      JOIN t ON (
           p.title       ILIKE t.pat
        OR p.subtitle    ILIKE t.pat
        OR p.description ILIKE t.pat
        OR p.external_id ILIKE t.pat
      )
    UNION ALL
    -- ② 品牌
    SELECT p.id, bh.ord
      FROM public.products_public p
      JOIN bh ON p.brand_id = bh.brand_id
    UNION ALL
    -- ③ ⟦search-PARTNOSEPINDIGITS⟧ 料號:兩端都正規化, 再比【前綴】
    -- 🔴🔴 **三個條件缺一不可, 而少了第一個會【回傳整張表】**:
    --    ① `regexp_replace(term) <> ''` —— 中文詞正規化之後是**空字串**,
    --       而 `LIKE '' || '%'` = `LIKE '%'` ⇒ **命中每一列**。
    --       ⇒ 📌 客人打「油箱貼」就會拿到全站商品, 而 HTTP 200、畫面完全正常。
    --    ② 詞裡**同時**有字母與數字 —— 少了它, 打 `a` ⇒ 前綴 `A%` ⇒ 命中所有 A 開頭的料號。
    --    ③ 用 `LIKE` 不是 `ILIKE` —— 兩端都已經 `upper()` 過了。
    -- 🔵 **不需要 escape**:正規化把 `%` `_` `\` 全都當成非英數刪掉了 ⇒ 構造不出萬用字元。
    -- 🔴 **順序刻意:兩個便宜的 `~` 排在最前面** —— 中文搜尋佔多數而它們一定不含數字。
    --    🔬 而正式站的 EXPLAIN 現在替這段註解背書:中文詞下這一塊印 **`never executed`**。
    SELECT p.id, t.ord
      FROM public.products_public p
      JOIN t ON (
             t.term ~ '[0-9]'
         AND (
               t.term ~ '[A-Za-z]'
            -- 🔴 2026-09-04 加的第二條路:【夠長的純數字】也算料號
            --    門檻 7 的來源與爆炸半徑量測 ⇒ 見本檔檔頭「門檻為什麼是 7 不是 9」
            OR length(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) >= 7
             )
         AND upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) <> ''
         AND upper(regexp_replace(p.external_id, '[^A-Za-z0-9]', '', 'g'))
             LIKE upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) || '%'
      )
    UNION ALL
    -- ── ④ ⟦search-VARIANTSKU⟧ 變體料號:形狀【逐字鏡射第 ③ 塊】────────────────
    -- 🔴 **為什麼鏡射而不是寫 `ILIKE '%sku%'`**:第 ③ 塊那三個條件是付過學費的
    --    (詞正規化後是空字串 ⇒ `LIKE '%'` ⇒ 命中每一列, 而 HTTP 200、畫面完全正常)。
    --    ⚠️ **而那段註解自己已經過期一半**(codex 2026-09-06 N3):現行還有數字閘在,
    --    單獨移除「正規化非空」那一條**不會**再讓中文變成全表命中 —— 防護保留, 理由訂正。
    -- 🔵 吐的是 `pv.product_id`, 不是變體 id ⇒ UNION ALL 仍在【(商品, 詞)】那一層。
    --    一個商品有多個變體 ⇒ 同一對 `(id, ord)` 會來很多次, 而外層 `count(DISTINCT h.ord)`
    --    只數**不同的詞**, 重複不影響(codex 2026-09-06 逐條驗過這一題)。
    -- 🛑 **走 `product_variants_public` 而不是 `product_variants`** —— 那支 view 是
    --    `security_invoker = true`, 而本函式是 INVOKER ⇒ 下架母商品的變體由 RLS 擋掉。
    --    ✅ **零價變體【刻意不擋】** —— Sean 2026-09-06 拍甲, 逐字「甲=沒價格的也讓客人搜到」。
    --    ⇒ 📌 這是**拍板**, 不是「還沒做」。下一個人想加 `price_general > 0` 之前, 先去問 Sean。
    SELECT pv.product_id AS id, t.ord
      FROM public.product_variants_public pv
      JOIN t ON (
             t.term ~ '[0-9]'
         AND (
               t.term ~ '[A-Za-z]'
            OR length(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) >= 7
             )
         AND upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) <> ''
         -- 🔴🔴 **最短長度閘 —— 這一條是 codex(gpt-6-astra)與 code-reviewer 同時抓到的, 而他們對:**
         --    上面那個「含字母」的分支**沒有任何長度下限** ⇒ `A1` / `R6` / `M8` 這種兩字元的詞
         --    過得了三道閘, 然後拿 `%A1%` 去掃 59,841 列 sku。
         --    🔬 **對正式庫唯讀量到的(可重跑, 見 `scripts/20260906900000-cap-headroom.sql`)**:
         -- ```
         --    詞    今天(舊三塊)  貼完(加 ④)   而 cap = 1000
         --    R1      1540          1696        ⇐ 今天就過了, 本片沒影響
         --    A1       924           964        ⇐ 🔴 **只差 36 就跨過去**
         --    1R        32           414
         --    M8       305           346
         -- ```
         --    ⇒ 🎯 **今天沒有任何一個詞被本片推過 cap, 而 `A1` 只差 36** ——
         --      而過 cap 的後果是**整發搜尋退回舊路**(`SupabaseProductAdapter.ts:872`),
         --      舊路沒有正規化也沒有變體比對 ⇒ 📌 **原本搜得到的東西會消失。**
         --    ✅ 所以加一道**最短 4 個英數字**:**兩三個字元的詞不是料號**, 而讓它進來的代價是
         --      「某天商品長多一點, 一個沒有人在看的門檻就跨過去了」。
         --    🔬 `PET52R`(6)· `AZ203B`(6)· `01022450101`(11)全部通得過這一道。
         --    ⚠️ **而它只擋第 ④ 塊** —— 第 ③ 塊(母料號)的門檻不是我這一片的範圍, 不動。
         AND length(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) >= 4
         -- 🔴🔴 **這裡是【包含】不是【前綴】—— 而那是量出來的, 不是風格**:
         --    Sean 打的兩個詞需要兩種不同的比法, 而沒有任何一種前綴同時抓得到:
         -- ```
         --    詞            整串前綴  右半前綴  整串包含
         --    PET52R           0        1        1     ⇐ 真實 sku 是 `PET52-PET52R`
         --    AZ203B           1        0        1
         --    01022450101      1        0        1
         --    ZZQ9999X(負對照) 0        0        0     ⇐ 尺會動
         -- ```
         --    🎯 成因:sku **沒有一致的形狀**(2026-09-06 正式庫唯讀全掃 59,841 列):
         --      有破折號 35,064 / 沒有 24,777;恰一個 8,357 / **多個 26,707**;
         --      而「破折號左半 = 母商品 external_id」**只有 16,348 列(27%)**
         --      ⇒ 📌 **「右半就是變體料號」這個假設對 73% 的列不成立** ⇒ 切字串那條路走不通。
         -- 🔵 **而【包含】在這裡不比前綴貴** —— sku 上沒有可用索引(見檔頭), 兩種都是全表掃 + 每列一次 regexp
         --    ⇒ 前綴唯一的好處(吃索引)在這條路上**本來就拿不到**。
         -- ⚠️ **爆炸半徑量過**:過得了上面三個守門條件的最寬那種詞(7 位以上數字),
         --    包含式實測命中 **≤ 1 筆**(`0102245` / `01022450` / `0102245010` 各 1、`0000000` / `1234567` 各 0);
         --    而 `'0'` `'1'` `'01'` 那種會命中上萬的詞 **根本進不了第 ④ 塊**(不含字母且不足 7 位)。
         AND upper(regexp_replace(pv.sku, '[^A-Za-z0-9]', '', 'g'))
             LIKE '%' || upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) || '%'
      )
  )
  -- 🎯 ⟦db-SEARCHFACETMUTEX⟧ 2026-09-09:把「完全命中」從【只能排序】變成【看得見的欄位】。
  --   🔴 **原封用下面 ORDER BY 那一段的同一個運算式** —— 抄成兩份會漂,
  --     而漂了之後「排最前的那顆」與「被標成完全命中的那顆」會是不同的商品。
  --   ⇒ 所以下面的 ORDER BY 改成引用這個別名, 而不是再寫一次。
  SELECT h.id, EXISTS (
              SELECT 1 FROM t
               WHERE upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) <> ''
                 AND ( EXISTS (SELECT 1 FROM public.products_public p2
                                WHERE p2.id = h.id
                                  AND upper(regexp_replace(p2.external_id, '[^A-Za-z0-9]', '', 'g'))
                                      = upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')))
                    OR EXISTS (SELECT 1 FROM public.product_variants_public pv2
                                WHERE pv2.product_id = h.id
                                  AND upper(regexp_replace(pv2.sku, '[^A-Za-z0-9]', '', 'g'))
                                      = upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')))
                     )
            ) AS is_exact
    FROM hits h
    CROSS JOIN n
   WHERE n.want > 0            -- 🔴 零個有效詞 ⇒ 回零列(不是回全表)
   GROUP BY h.id, n.want
  -- 🔴🔴 **這個 `DISTINCT` 是承重的, 不是冗贅。** 拿掉 ⇒ 同一對從多塊各來一次 ⇒ 多算
  --    ⇒ `= want` 不成立 ⇒ 那一列被【丟掉】⇒ **客人打料號拿到 0 筆**(變窄, 不是放寬)。
  --    ⇒ 📌 而「拿到 0 筆」不會有人回報, 他只會覺得我們沒賣。
  HAVING count(DISTINCT h.ord) = n.want
  -- ── 🔴 ⟦search-VARIANTSKUFIRST⟧ 完全命中排最前(Sean 2026-09-06:「完全命中的排最前」)──
  --   🛑 **本函式在此之前【一個 ORDER BY 都沒有】** —— `grep -c 'ORDER BY'` 對前一代 ⇒ **0**
  --     ⇒ 順序完全由 planner 決定。所以這不是「改排序」, 是**第一次給它一個排序**。
  --   🔵 **用 `=` 不是 `LIKE`**:要的是**完全命中** —— 兩端都正規化之後直接比相等。
  --   🔴🔴 **`h.id` 這個第二鍵是承重的, 不是湊數**:
  --     沒有它, 同一組(都完全命中 / 都不是)之間的順序**仍然由 planner 決定**
  --     ⇒ 📌 **「排序不穩定」與「排序錯了」在畫面上很像, 而分頁時前者更毒** ——
  --       同一筆商品會出現在兩頁, 而另一筆一頁都不出現。
  --   ⚠️ **代價(未量)**:那個 `EXISTS` 對結果集的每一列各跑一次。
  --     正式庫的延遲**沒有量**(主視窗裁乙:貼完之後用唯讀 `EXPLAIN` 量一次再關板列)。
   ORDER BY is_exact DESC,
            h.id;
$function$;

-- 🔴🔴 **`DROP` 把 ACL 一起丟了 —— 這四行是【還原】不是【新增】。**
--   2026-09-09 唯讀實查正式庫,那支的 `proacl` 逐字:
--     {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--   ⇒ 📌 **裡面沒有 PUBLIC** —— 有人收過。而 `CREATE` 會把 PUBLIC 那份**重新發回去**
--     (`docs/patterns/revoking-function-execute-in-supabase.md` §1:兩道 REVOKE 少一道都是開的)。
--   ⇒ 🛑 少了下面第一行, 這支 migration 會**悄悄把權限放寬**, 而每一格功能驗收都是綠的。
-- ACL-GATE-EXEMPT: public.storefront_search_product_ids -- DROP+CREATE 之後的還原不是新增, 授權集合與前一代 20260906950000:78 逐字相同 anon/authenticated/service_role(2026-09-09 唯讀複查正式庫 proacl;板列 db-SEARCHFACETMUTEX)
-- ↑ 那一行是給閘看的;下面幾行是給人看的:
--   2026-09-09 唯讀實查正式庫, 該支 proacl 逐字
--   {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--   ⇒ anon/authenticated 本來就有(前一代 20260906950000, 板列 db-SEARCHFACETMUTEX)。
--   🔴 誰要用:顧客站的搜尋走 anon、登入客人走 authenticated —— 那是【客人自己】打的查詢,
--     不是後端代打 ⇒ **不能改成只給 service_role**(那會讓客人一搜尋就 42501)。
--   🛑 而少了下面那行 REVOKE, `CREATE` 會把 PUBLIC 那份重新發回去 ⇒ 這一支會【放寬】權限,
--     而每一格功能驗收都是綠的。⇒ 下面那段收權斷言把 grantee 集合整組釘死。
REVOKE ALL ON FUNCTION public.storefront_search_product_ids(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storefront_search_product_ids(text[]) TO anon;
GRANT EXECUTE ON FUNCTION public.storefront_search_product_ids(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_search_product_ids(text[]) TO service_role;


-- ── ② 一般客人那支(基底 = 正式庫現行定義)────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_catalog_by_vehicle(p_categories text[], p_brand text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_offset integer DEFAULT 0, p_limit integer DEFAULT 25, p_sort text DEFAULT 'recommend'::text, p_category text DEFAULT NULL::text, p_brand_slugs text[] DEFAULT NULL::text[], p_price_min integer DEFAULT NULL::integer, p_price_max integer DEFAULT NULL::integer, p_new_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_terms text[] DEFAULT NULL::text[])
 RETURNS TABLE(item jsonb, total bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- 🔴🔴 **`v_cats` 把新舊兩個入口收成【一份】** —— 新的 `p_categories` 加上舊的 `p_category`。
  --    ⇒ 📌 下面每一處都只讀 `v_cats`, **不再有任何一處直接讀 `p_category`**
  --      ⇒ 那讓「漏改一處」變成不可能, 而不是靠人數對。
  -- 🔴🔴 **[2026-09-04 本支改的就是這件事 —— 而它【只動排序, 不動過濾】]**
  --    Sean 2026-09-04 逐字「3. 甲」= 帶分類時也照【中高價位優先】排。
  --    ⛔ ~~原本 12 處排序 CASE 都掛著 `AND cardinality(v_cats) = 0`~~
  --       ⇒ 一旦帶了分類, 那組 CASE 全部回 NULL ⇒ **唯一還在生效的鍵是 `f.id ASC`(UUID)**
  --       ⇒ 📌 **客人點進一個分類, 第一頁等於【隨機順序】** —— 而那不是「另一種排法」, 是沒有排法。
  --    ✅ 本支把那 12 處的 `AND cardinality(v_cats) = 0` 拿掉。
  --    🛑 **而【WHERE 那兩處一個字都沒動】** —— 那是過濾, 不是排序:
  --       `WHERE (cardinality(v_cats) = 0 OR ...)` 決定「要不要套分類過濾」。
  --       ⇒ 動它會改變**回傳哪些商品**, 而本支只改**它們的順序**。
  --    🔵 而「大類輪流」(`sort_rn` 的 PARTITION BY 大類)在只選一個分類時**自然變成 no-op**
  --       —— 同一個 partition ⇒ 剩下「中高價分帶 + 段內由高到低」, 那正是 Sean 要的。
  -- 🛑 **而「空」的判準一律是 `cardinality(v_cats) = 0`, 不是 `IS NULL`** ——
  --    陣列有兩種空(NULL 與 `{}`), 而**它們在 `IS NULL` 上不一樣**。
  --    🔬 本檔實測到的分母:`p_category IS NULL` 在原版出現 **12** 次(兩份查詢各 6)
  --      ⇒ ⚠️ 而 plan 裡我寫「三行」—— 那是**只 grep 到一份查詢**的數。**12 才是對的。**
  v_cats text[];
  -- ⛔ ~~`c_batch_day_threshold constant int := 100;`~~ 與它上面那段說明 ——
  --    2026-09-09 Sean 拍甲拿掉「一天超過 N 件就整天不算新品」那條規則,常數與兩個分支一起刪。
  --    🔴 舊字面刻意留刪除線:拿「批次門檻」去搜的人要同一發撞到這句訂正。
  -- ── #950 推薦排序:中高價位優先(Sean 2026-08-27「中間~高 價位優先在前面好了」, 選項回「乙」)──
  -- 🔴 這兩個數字是【我們挑的, 不是他挑的】。他看到的選項字面是
  --    「這次先寫死在程式裡, 記一筆待辦(要改得叫我們)」, 而他回【甲】
  --    ⇒ 他同意的是那個做法, **不是這兩個值**。
  -- 🔴🔴 **要改就是改這兩行。**
  --    ⚠️ **而 backlog `#950` 目前【還沒有】指回本檔**(code-reviewer 實查:
  --       `grep -n '20260827150000' docs/phase-1-backlog.md` ⇒ 0 命中)
  --       ⇒ 那句「要改得叫我們」的承諾,現在只有【這一行】是它的地址。
  --       ⇒ 條目改寫是欠著的工(見 checkpoint), 而在那之前不要說「backlog 指到這裡」。
  --      (改了要開新 migration 重貼整支函式, 理由同上面那個門檻常數。)
  -- 值的來源:全站群代表價分布, 2026-08-27 量於報價單庫 storefront_catalog_v(22,193 群)
  --    中位數 4,000 / P90 13,800 ⇒ 段界取【中位數 ~ P90】
  --    ⚠️ 換成 Q3~P95(7,480 ~ 約 21,000)⇒ 第一頁整批換人、平均單價高很多
  -- 分類第一段 = 這個字的商品【不進新品區】(Sean 2026-08-27 拍【甲】= 照大類切)。
  -- 🔴 用 split_part 取第一段, 不是整串比對 —— 以後多出「維修零件 · 油封」這種子類會【自動】跟著排除,
  --    不需要有人記得回來改。Sean 拍甲的理由就是這個(de 端題時已明說「今天甲乙行為一樣, 差別在以後」)。
  -- ⚠️ 只作用在【新品模式】(p_new_since IS NOT NULL)。目錄 / 搜尋 / 品牌頁 / 分類頁傳 NULL ⇒ 不受影響;
  --    客人在分類頁直接看「維修零件」時 p_new_since 也是 NULL ⇒ 那 1631 件照常看得到。
  c_new_arrivals_excluded_category constant text := '維修零件';
  c_recommend_band_lo constant int := 4000;
  c_recommend_band_hi constant int := 13800;
  -- 🔴🔴 ⟦db-SEARCHFACETMUTEX⟧ **「空白」的字集 —— 顯式列舉**(codex R1 nit + R2 nit)
  --   ⛔ ~~`btrim(pt)` 預設~~ 只剝 ASCII 空格;⛔ ~~`pt ~ '[^[:space:]]'`~~ **依 locale**
  --     (我自己的 harness 在 `--locale=C` 下抓到它對全形空格失效)。
  --   ⇒ 📌 兩個都不行, 而它們**在正式庫與拋棄式庫會給不同答案, 且兩邊都不報錯**。
  c_ws constant text := E' \t\n\r\x0B\f\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF';
BEGIN
  -- 🔵 新舊合流:兩個都給的話一起吃(聯集)。`p_category` 是舊入口, 保留到步驟 C 才 DROP。
  v_cats := (
    -- 🔴 **`btrim` 要寫回, 不是只拿來過濾**(codex nit):原版只用它排除空白字串,
    --    而 `' 排氣系統 '` 會**帶著空白留下來** ⇒ 比不到任何分類, 而且不會與無空白版去重。
    SELECT coalesce(array_agg(DISTINCT btrim(x)), ARRAY[]::text[])
      FROM unnest(coalesce(p_categories, ARRAY[]::text[])
                  || CASE WHEN p_category IS NULL THEN ARRAY[]::text[] ELSE ARRAY[p_category] END) AS x
     WHERE btrim(x) <> ''
  );
  IF p_brand IS NULL THEN
    RETURN QUERY
    WITH kw AS MATERIALIZED (
      -- 🎯 ⟦db-SEARCHFACETMUTEX⟧ 2026-09-09:關鍵字命中集合**提到 CTE**, 而理由有兩個。
      --   ① 要把 `is_exact` 帶進 `filtered` 當排序鍵 —— 寫成每列一次的純量子查詢的話,
      --      那支 SRF 會**對結果集的每一列各跑一次**。
      --   ② `MATERIALIZED` 是刻意的:少了它 planner 可能把它推進 JOIN 反覆求值。
      -- 🔵 **`p_terms IS NULL` 時它照樣跑一次, 而那一次是空的** ——
      --   `array_agg` 對空集合回 NULL ⇒ 該函式內部 `unnest(NULL)` ⇒ 零詞 ⇒ 它自己的
      --   `WHERE n.want > 0` 直接回零列。⛔ ~~今天每一發零成本~~ ⇒ 現在是**一次零列呼叫**。
      --   ⇒ 📌 那是本片的成本, 明寫在這裡而不是讓下一個人自己發現。
      SELECT k.id, k.is_exact
        FROM public.storefront_search_product_ids(
               (SELECT array_agg(pt) FROM unnest(p_terms) AS pt WHERE btrim(pt, c_ws) <> '')) k
    ), filtered AS (
      SELECT p.*, COALESCE(kw.is_exact, false) AS kw_exact
      FROM public.products_list_public p
      -- 🔵 LEFT JOIN 不是 INNER —— 沒有關鍵字時 `kw` 是空的,
      --    用 INNER 會把整張目錄濾光, 而 HTTP 200、畫面完全正常。
      LEFT JOIN kw ON kw.id = p.id
      -- 🔴🔴 **不是 `= ANY(v_cats)`** —— 分類的述詞有【兩個分支】(`=` 與 `LIKE 父 · %`),
      --    而品牌只有一個 ⇒ 照抄品牌那一格會**漏掉「打大類要涵蓋子類」那一半**,
      --    而它看起來完全正確。⇒ 每一個元素都要走那兩個分支。
      -- ✅ **聯集**(任一元素中就算中)= Sean 2026-09-04 拍的甲:
      --    逐字「甲 聯集 —— 排氣管【或】油箱貼, 兩種商品都列出來(比較多)」。
      WHERE (cardinality(v_cats) = 0
             OR EXISTS (SELECT 1 FROM unnest(v_cats) AS vc
                         WHERE p.category_raw = vc OR p.category_raw LIKE vc || ' · %'))
        AND (p_brand_slugs IS NULL OR cardinality(p_brand_slugs) = 0 OR p.brand_slug = ANY(p_brand_slugs))
        AND (p_price_min IS NULL OR p.price_general >= p_price_min)
        AND (p_price_max IS NULL OR p.price_general <= p_price_max)
        AND (p_new_since IS NULL OR (
              p.created_at >= p_new_since
              -- 上界（codex R2 NIT-2）：未來時戳的列不算新品，否則它會永遠釘在「新品」第一位。
              -- ⛔ ~~「只夾窗、不夾 new_batch_days」~~ —— 2026-09-09 批次日規則已拿掉,
              --    這一行留下的只有【上界】那半, 而它自己的理由(上一行)仍然成立。
              AND p.created_at <= now()
              -- 🔴 維修零件不進新品區。`coalesce` 少不得:category_raw 若為 NULL,
              --    `split_part(NULL,…) <> '維修零件'` 會回 NULL ⇒ 那一列會被【當成維修零件排掉】。
              --    現值空值 0 ⇒ 今天看不出差別, 而那正是它以後會安靜咬人的原因。
              AND coalesce(split_part(p.category_raw, ' · ', 1), '') <> c_new_arrivals_excluded_category
            ))
        -- 🔴🔴 ⟦db-SEARCHFACETMUTEX⟧ 關鍵字那一格 —— **比對【不在這裡】做**, 委給 `storefront_search_product_ids`。
        --    🎯 **為什麼委出去**:那支已經有四欄 ILIKE + 品牌名 + 母料號前綴 + 變體 sku 四塊,
        --      而每一塊的守門條件都付過學費(見 `20260906950000` 的註解)⇒ 自己再寫一份 ILIKE
        --      = 兩份會漂, 而漂的方向是【客人搜不到】, 那沒有人會回報。
        --    🛑 **而 `products_list_public` 上【沒有】`description` 與 `external_id` 兩欄**
        --      ⇒ 就算想在這裡比也比不完整;委出去那一側走的是 `products_public`。
        -- 🔴🔴 **第二個條件不可以省, 而少了它會【整站零商品】**:
        --    被委的那支在零個有效詞時逐字「回零列(不是回全表)」(`20260906950000` 的 `WHERE n.want > 0`)
        --    ⇒ 📌 `p_terms = ARRAY['']` 這種呼叫會讓每一列都被濾掉, 而 HTTP 200、畫面完全正常。
        --    ⇒ **「沒有關鍵字」這件事必須在【這裡】判, 不得委出去。**
        --    🔴🔴 **「有效詞」的判準【刻意與被委那支不同】, 而差的方向是承重的**(codex R1 nit):
--      被委那支用 `btrim(term) <> ''`, 而 **`btrim` 預設只剝 ASCII 空格**
--      ⇒ 📌 `ARRAY[E'\t']` / 換行 / 全形空格 `U+3000` 在它眼裡是**有效詞**
--        ⇒ 它會拿 `%<tab>%` 去比 ⇒ 回零列 ⇒ **整站零商品**, 又是同一個形狀。
--      ⛔ ~~我的第一版寫 `pt ~ '[^[:space:]]'`~~ —— 🔴 **那一版是【我自己的 harness 抓到的】**:
--        `[[:space:]]` 是**依 locale 的**, 而拋棄式庫跑在 `--locale=C` ⇒ 它只認 ASCII
--        ⇒ 全形空格 `U+3000` 那一格實測 **0(期望 4)**。
--        📌 而正式庫是 UTF-8 locale ⇒ 📌 **同一段碼在兩個環境會給不同答案, 而兩邊都不報錯。**
--      ✅ 改成**顯式列舉**(與 `normalizeSearchInput` 學到的同一課:`\s` 不含 `U+200B`)
--        `btrim(pt, ' '||chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(8203)||chr(12288)||chr(65279))`
--        ⇒ 空白 / tab / 換行 / 零寬空格 / 全形空格 / BOM,**locale 無關** ⇒ **比被委那支寬**
--        ⇒ 純空白的詞在這裡算「沒有關鍵字」⇒ **不過濾, 出全部**。
--    🔴🔴 **[codex R2 must-fix]** ⛔ ~~只擋「整組都是空白」就夠~~ —— **那句是假的, 而反例很小**:
--      `ARRAY['碳纖維', E'\t']` ⇒ 第一個詞有效 ⇒ 整組過了我的閘 ⇒ **連同那個 tab 原樣送出去**
--      ⇒ 被委那支把 tab 當成**第二個必要條件**(`count(DISTINCT ord) = want`)
--      ⇒ 📌 **一筆都不會中** ⇒ 客人打了字而拿到 0 件, 而畫面完全正常。
--      ✅ **所以不是【擋】, 是【濾】**:只把有效詞 `array_agg` 起來送出去。
--      🎯 兩邊不一致仍是刻意的, 而現在它**真的**只往【出全部】倒 —— 空白詞根本不會抵達那一支。
        AND (p_terms IS NULL
             OR NOT EXISTS (SELECT 1 FROM unnest(p_terms) AS pt WHERE btrim(pt, c_ws) <> '')
             -- ⛔ ~~`OR p.id IN (SELECT k.id FROM storefront_search_product_ids(…)) `~~
             -- 🎯 同一個集合改從上面那個 `kw` CTE 來 —— **`IN (SELECT …)` 是集合語意,
             --   那支函式自己的 `ORDER BY`(完全命中排最前)在那一行【蒸發】。**
             --   2026-09-09 實測:`VF11` 的完全命中那顆 第 1 名 ⇒ 第 14 名(最後一名)。
             OR kw.id IS NOT NULL)
    ), paged AS (
      -- count/排序/分頁先收斂到 ≤100 列，trim JOIN 只對當頁做（20260719150000 MF-4）
      SELECT f.*, count(*) OVER () AS total_rows,
        -- ── #950 recommend 的兩個排序欄。🔴 **算在這裡, 不算在外層 ORDER BY 裡** ──
        --   理由是實測踩到的:第一版把 row_number() 寫進【外層】那個 ORDER BY,
        --   它會對【已經分頁後的那幾列】重算一次 ⇒ 名次變成頁內名次、不是全域名次
        --   ⇒ 第一頁出現重複的大類(2026-08-27 實測:期望 12 個相異大類, 實得 11)。
        --   📌 而 11/12 看起來幾乎對 —— 那正是它難發現的地方。
  -- 🔴🔴 **第二個實測抓到的錯:PARTITION 要含【段】。**
  --   只用大類分割 ⇒ rn 是「這一類【全部】商品裡的名次」, 而段外(比段更貴)的也算在內
  --   ⇒ 各大類段外商品【數量不同】⇒ 每一類第一個段內商品拿到的 rn 不同
  --     (實測:第一頁的 rn 從 24 起跳、有 24 也有 25 ⇒ 同一個大類出現兩次)
  --   ⇒ 加上 band 之後, 每一類【在段內】的名次才從 1 開始, 輪流才真的是輪流。
        CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
             THEN 0 ELSE 1 END AS sort_band,
        -- 🔴 大類 = category_raw 的第一段。單段的分類是合法的(本函式自己的 WHERE 就有
        --    `= p_category` 與 `LIKE p_category || ' · %'` 兩個分支)⇒ split_part 對單段值
        --    回整串 ⇒ 它自成一個大類, 行為正確、不是 bug。
        row_number() OVER (PARTITION BY split_part(f.category_raw, ' · ', 1),
                                           CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                     AND c_recommend_band_hi THEN 0 ELSE 1 END
                           ORDER BY f.price_general DESC NULLS LAST, f.id) AS sort_rn
      FROM filtered f
      ORDER BY
        -- 🎯 ⟦db-SEARCHFACETMUTEX⟧ **料號完全命中排最前**(Sean 2026-09-06 逐字
        --   「完全命中的排最前」;2026-09-09 拍甲把它接回目錄 RPC)。
        -- 🔴 **只在【有關鍵字】而且【走預設推薦排序】時生效** ——
        --   客人自己點了「價格低到高 / 最新上架」就照他點的走, 不插隊。
        -- 🔵 `NOT f.kw_exact` ⇒ 完全命中是 false(0) ⇒ ASC 把它排在最前面。
        --   兩個條件任一不成立 ⇒ 整個 CASE 是 NULL ⇒ NULLS LAST ⇒ 全部同分
        --   ⇒ 📌 **沒有關鍵字的那一發, 行為一個位元組都不變。**
        CASE WHEN p_sort = 'recommend' AND p_terms IS NOT NULL
             THEN NOT f.kw_exact END ASC NULLS LAST,
        CASE WHEN p_sort = 'recommend' THEN
          CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
               THEN 0 ELSE 1 END
        END ASC NULLS LAST,
        CASE WHEN p_sort = 'recommend' THEN
          row_number() OVER (PARTITION BY split_part(f.category_raw, ' · ', 1),
                                             CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                       AND c_recommend_band_hi THEN 0 ELSE 1 END
                             ORDER BY f.price_general DESC NULLS LAST, f.id)
        END ASC NULLS LAST,
        CASE WHEN p_sort = 'recommend' THEN f.price_general END DESC NULLS LAST,
        CASE WHEN p_sort = 'price-asc' THEN f.price_general END ASC NULLS LAST,
        CASE WHEN p_sort = 'price-desc' THEN f.price_general END DESC NULLS LAST,
        CASE WHEN p_sort = 'new' THEN f.created_at END DESC NULLS LAST,
        f.id ASC
      OFFSET GREATEST(p_offset, 0)
      LIMIT LEAST(GREATEST(p_limit, 1), 100)
    )
    SELECT
      jsonb_build_object(
        'id', pg.id,
        -- 🔴 母料號:Sean 2026-09-06 拍「全部頁面都顯示料號」。
        --    來源是 `products_public`(下面 LEFT JOIN 的 `pe`), **不是 `products_list_public`** ——
        --    那支清單投影**沒有這一欄**(2026-09-06 正式庫唯讀逐欄查:16 欄, 無 `external_id`;
        --    而 `products_public` 有 ⇒ 🟢 正對照)。
        -- 🛑 **刻意不動 `products_list_public`**(主視窗 `Q-母料號來源 A: 甲`):它是**公開投影**,
        --    消費端沒有盤過 ⇒ 板列 `⟦search-LISTVIEWNOEXTID⟧` 記著未來若要動它的入口。
         --    ⛔ ~~理由之一是「它的 COMMENT 逐字寫著排除 external_id, 那個排除看起來是刻意的」~~
         --    🔴 **那句是錯的**(codex + code-reviewer 同時抓):現行 COMMENT(`20260811040000:229`)
         --      逐字是 `excludes price_store, price_by_tier, metadata, detail content and delisted_at`
         --      —— **沒有 external_id**。含它的是 9/10 欄時期那兩代, 而那份清單裡它跟
         --      `description / images / timestamps` 排在一起 ⇒ 那是**卡片瘦身**, 不是安全排除。
         --    ✅ **選甲仍然對, 而理由換成量到的那個**:動公開投影會改欄數與欄位順序,
         --      而**消費端沒有盤過** —— 這一條不需要那句 COMMENT 撐。
        'external_id', pe.external_id,
        'title', pg.title,
        'subtitle', pg.subtitle,
        'handle', pg.handle,
        'availability', pg.availability,
        'price_general', pg.price_general,
        'card_image', pg.card_image,
        'fits', pg.fits,
        'brand_name', pg.brand_name,
        'brand_slug', pg.brand_slug,
        'category_raw', pg.category_raw,
        'fitments', pg.fitments,
        'card_image_trim', CASE WHEN t.url IS NULL THEN NULL ELSE jsonb_build_object(
          'l', t.bbox_left, 't', t.bbox_top, 'w', t.bbox_width, 'h', t.bbox_height,
          'nw', t.natural_width, 'nh', t.natural_height) END
      ),
      pg.total_rows
    FROM paged pg
    LEFT JOIN public.product_image_trim t ON t.url = pg.card_image AND t.status = 'ok'
    -- 🔵 **只在【這一頁】上 join** —— `paged` 已經 LIMIT 過(最多 100 列), 而 join key 是主鍵。
    -- 🔴 用 `LEFT` 不是 `INNER`:兩支 view 都吃 RLS, 正常同進同出;而萬一某一列只在其中一邊,
    --    INNER 會把那張卡**整張弄不見**, LEFT 只讓料號是 null。
    --    ⇒ 📌 **少一個料號 vs 少一張商品卡, 後者嚴重得多。**
    LEFT JOIN public.products_public pe ON pe.id = pg.id
    ORDER BY
      -- #950:🔴 用內層算好的 sort_band / sort_rn, **不要在這裡重算 row_number()**(理由見內層註解)
      -- 🎯 ⟦db-SEARCHFACETMUTEX⟧ 料號完全命中排最前 —— **內外層都要有**, 理由見內層那段。
      CASE WHEN p_sort = 'recommend' AND p_terms IS NOT NULL
           THEN NOT pg.kw_exact END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN pg.sort_band END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN pg.sort_rn   END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN pg.price_general END DESC NULLS LAST,
      CASE WHEN p_sort = 'price-asc' THEN pg.price_general END ASC NULLS LAST,
      CASE WHEN p_sort = 'price-desc' THEN pg.price_general END DESC NULLS LAST,
      CASE WHEN p_sort = 'new' THEN pg.created_at END DESC NULLS LAST,
      pg.id ASC;
    RETURN;
  END IF;

  RETURN QUERY
  WITH kw AS MATERIALIZED (
      -- 🎯 ⟦db-SEARCHFACETMUTEX⟧ 2026-09-09:關鍵字命中集合**提到 CTE**, 而理由有兩個。
      --   ① 要把 `is_exact` 帶進 `filtered` 當排序鍵 —— 寫成每列一次的純量子查詢的話,
      --      那支 SRF 會**對結果集的每一列各跑一次**。
      --   ② `MATERIALIZED` 是刻意的:少了它 planner 可能把它推進 JOIN 反覆求值。
      -- 🔵 **`p_terms IS NULL` 時它照樣跑一次, 而那一次是空的** ——
      --   `array_agg` 對空集合回 NULL ⇒ 該函式內部 `unnest(NULL)` ⇒ 零詞 ⇒ 它自己的
      --   `WHERE n.want > 0` 直接回零列。⛔ ~~今天每一發零成本~~ ⇒ 現在是**一次零列呼叫**。
      --   ⇒ 📌 那是本片的成本, 明寫在這裡而不是讓下一個人自己發現。
      SELECT k.id, k.is_exact
        FROM public.storefront_search_product_ids(
               (SELECT array_agg(pt) FROM unnest(p_terms) AS pt WHERE btrim(pt, c_ws) <> '')) k
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
  ), filtered AS (
    SELECT p.*, COALESCE(kw.is_exact, false) AS kw_exact
    FROM public.products_list_public p
    JOIN matched m ON m.product_id = p.id
    -- 🔵 LEFT JOIN 不是 INNER —— 理由同上面那份。
    LEFT JOIN kw ON kw.id = p.id
    -- 🔴 與上面那份同一個修法(本函式有【兩份】查詢, 兩份都要改)。
    WHERE (cardinality(v_cats) = 0
           OR EXISTS (SELECT 1 FROM unnest(v_cats) AS vc
                       WHERE p.category_raw = vc OR p.category_raw LIKE vc || ' · %'))
      AND (p_brand_slugs IS NULL OR cardinality(p_brand_slugs) = 0 OR p.brand_slug = ANY(p_brand_slugs))
      AND (p_price_min IS NULL OR p.price_general >= p_price_min)
      AND (p_price_max IS NULL OR p.price_general <= p_price_max)
      AND (p_new_since IS NULL OR (
            p.created_at >= p_new_since
            AND p.created_at <= now()
            -- 🔴 維修零件不進新品區。`coalesce` 少不得:category_raw 若為 NULL,
            --    `split_part(NULL,…) <> '維修零件'` 會回 NULL ⇒ 那一列會被【當成維修零件排掉】。
            --    現值空值 0 ⇒ 今天看不出差別, 而那正是它以後會安靜咬人的原因。
            AND coalesce(split_part(p.category_raw, ' · ', 1), '') <> c_new_arrivals_excluded_category
          ))
      -- 🔴🔴 ⟦db-SEARCHFACETMUTEX⟧ 關鍵字那一格 —— **比對【不在這裡】做**, 委給 `storefront_search_product_ids`。
      --    🎯 **為什麼委出去**:那支已經有四欄 ILIKE + 品牌名 + 母料號前綴 + 變體 sku 四塊,
      --      而每一塊的守門條件都付過學費(見 `20260906950000` 的註解)⇒ 自己再寫一份 ILIKE
      --      = 兩份會漂, 而漂的方向是【客人搜不到】, 那沒有人會回報。
      --    🛑 **而 `products_list_public` 上【沒有】`description` 與 `external_id` 兩欄**
      --      ⇒ 就算想在這裡比也比不完整;委出去那一側走的是 `products_public`。
      -- 🔴🔴 **第二個條件不可以省, 而少了它會【整站零商品】**:
      --    被委的那支在零個有效詞時逐字「回零列(不是回全表)」(`20260906950000` 的 `WHERE n.want > 0`)
      --    ⇒ 📌 `p_terms = ARRAY['']` 這種呼叫會讓每一列都被濾掉, 而 HTTP 200、畫面完全正常。
      --    ⇒ **「沒有關鍵字」這件事必須在【這裡】判, 不得委出去。**
      --    🔴🔴 **「有效詞」的判準【刻意與被委那支不同】, 而差的方向是承重的**(codex R1 nit):
--      被委那支用 `btrim(term) <> ''`, 而 **`btrim` 預設只剝 ASCII 空格**
--      ⇒ 📌 `ARRAY[E'\t']` / 換行 / 全形空格 `U+3000` 在它眼裡是**有效詞**
--        ⇒ 它會拿 `%<tab>%` 去比 ⇒ 回零列 ⇒ **整站零商品**, 又是同一個形狀。
--      ⛔ ~~我的第一版寫 `pt ~ '[^[:space:]]'`~~ —— 🔴 **那一版是【我自己的 harness 抓到的】**:
--        `[[:space:]]` 是**依 locale 的**, 而拋棄式庫跑在 `--locale=C` ⇒ 它只認 ASCII
--        ⇒ 全形空格 `U+3000` 那一格實測 **0(期望 4)**。
--        📌 而正式庫是 UTF-8 locale ⇒ 📌 **同一段碼在兩個環境會給不同答案, 而兩邊都不報錯。**
--      ✅ 改成**顯式列舉**(與 `normalizeSearchInput` 學到的同一課:`\s` 不含 `U+200B`)
--        `btrim(pt, ' '||chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(8203)||chr(12288)||chr(65279))`
--        ⇒ 空白 / tab / 換行 / 零寬空格 / 全形空格 / BOM,**locale 無關** ⇒ **比被委那支寬**
--        ⇒ 純空白的詞在這裡算「沒有關鍵字」⇒ **不過濾, 出全部**。
--    🔴🔴 **[codex R2 must-fix]** ⛔ ~~只擋「整組都是空白」就夠~~ —— **那句是假的, 而反例很小**:
--      `ARRAY['碳纖維', E'\t']` ⇒ 第一個詞有效 ⇒ 整組過了我的閘 ⇒ **連同那個 tab 原樣送出去**
--      ⇒ 被委那支把 tab 當成**第二個必要條件**(`count(DISTINCT ord) = want`)
--      ⇒ 📌 **一筆都不會中** ⇒ 客人打了字而拿到 0 件, 而畫面完全正常。
--      ✅ **所以不是【擋】, 是【濾】**:只把有效詞 `array_agg` 起來送出去。
--      🎯 兩邊不一致仍是刻意的, 而現在它**真的**只往【出全部】倒 —— 空白詞根本不會抵達那一支。
      AND (p_terms IS NULL
           OR NOT EXISTS (SELECT 1 FROM unnest(p_terms) AS pt WHERE btrim(pt, c_ws) <> '')
           -- ⛔ ~~`OR p.id IN (SELECT k.id FROM storefront_search_product_ids(…)) `~~
           -- 🎯 同一個集合改從上面那個 `kw` CTE 來 —— **`IN (SELECT …)` 是集合語意,
           --   那支函式自己的 `ORDER BY`(完全命中排最前)在那一行【蒸發】。**
           --   2026-09-09 實測:`VF11` 的完全命中那顆 第 1 名 ⇒ 第 14 名(最後一名)。
           OR kw.id IS NOT NULL)
  ), paged AS (
    SELECT f.*, count(*) OVER () AS total_rows,
      -- ── #950 recommend 的兩個排序欄。🔴 **算在這裡, 不算在外層 ORDER BY 裡** ──
      --   理由是實測踩到的:第一版把 row_number() 寫進【外層】那個 ORDER BY,
      --   它會對【已經分頁後的那幾列】重算一次 ⇒ 名次變成頁內名次、不是全域名次
      --   ⇒ 第一頁出現重複的大類(2026-08-27 實測:期望 12 個相異大類, 實得 11)。
      --   📌 而 11/12 看起來幾乎對 —— 那正是它難發現的地方。
  -- 🔴🔴 **第二個實測抓到的錯:PARTITION 要含【段】。**
  --   只用大類分割 ⇒ rn 是「這一類【全部】商品裡的名次」, 而段外(比段更貴)的也算在內
  --   ⇒ 各大類段外商品【數量不同】⇒ 每一類第一個段內商品拿到的 rn 不同
  --     (實測:第一頁的 rn 從 24 起跳、有 24 也有 25 ⇒ 同一個大類出現兩次)
  --   ⇒ 加上 band 之後, 每一類【在段內】的名次才從 1 開始, 輪流才真的是輪流。
      CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
           THEN 0 ELSE 1 END AS sort_band,
      -- 🔴 大類 = category_raw 的第一段。單段的分類是合法的(本函式自己的 WHERE 就有
      --    `= p_category` 與 `LIKE p_category || ' · %'` 兩個分支)⇒ split_part 對單段值
      --    回整串 ⇒ 它自成一個大類, 行為正確、不是 bug。
      row_number() OVER (PARTITION BY split_part(f.category_raw, ' · ', 1),
                                         CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                   AND c_recommend_band_hi THEN 0 ELSE 1 END
                         ORDER BY f.price_general DESC NULLS LAST, f.id) AS sort_rn
    FROM filtered f
    ORDER BY
      -- 🎯 ⟦db-SEARCHFACETMUTEX⟧ **料號完全命中排最前**(Sean 2026-09-06 逐字
      --   「完全命中的排最前」;2026-09-09 拍甲把它接回目錄 RPC)。
      -- 🔴 **只在【有關鍵字】而且【走預設推薦排序】時生效** ——
      --   客人自己點了「價格低到高 / 最新上架」就照他點的走, 不插隊。
      -- 🔵 `NOT f.kw_exact` ⇒ 完全命中是 false(0) ⇒ ASC 把它排在最前面。
      --   兩個條件任一不成立 ⇒ 整個 CASE 是 NULL ⇒ NULLS LAST ⇒ 全部同分
      --   ⇒ 📌 **沒有關鍵字的那一發, 行為一個位元組都不變。**
      CASE WHEN p_sort = 'recommend' AND p_terms IS NOT NULL
           THEN NOT f.kw_exact END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN
        CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
             THEN 0 ELSE 1 END
      END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN
        row_number() OVER (PARTITION BY split_part(f.category_raw, ' · ', 1),
                                           CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                     AND c_recommend_band_hi THEN 0 ELSE 1 END
                           ORDER BY f.price_general DESC NULLS LAST, f.id)
      END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN f.price_general END DESC NULLS LAST,
      CASE WHEN p_sort = 'price-asc' THEN f.price_general END ASC NULLS LAST,
      CASE WHEN p_sort = 'price-desc' THEN f.price_general END DESC NULLS LAST,
      CASE WHEN p_sort = 'new' THEN f.created_at END DESC NULLS LAST,
      f.id ASC
    OFFSET GREATEST(p_offset, 0)
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  )
  SELECT
    jsonb_build_object(
      'id', pg.id,
      -- 🔴 母料號:Sean 2026-09-06 拍「全部頁面都顯示料號」。
      --    來源是 `products_public`(下面 LEFT JOIN 的 `pe`), **不是 `products_list_public`** ——
      --    那支清單投影**沒有這一欄**(2026-09-06 正式庫唯讀逐欄查:16 欄, 無 `external_id`;
      --    而 `products_public` 有 ⇒ 🟢 正對照)。
      -- 🛑 **刻意不動 `products_list_public`**(主視窗 `Q-母料號來源 A: 甲`):它是**公開投影**,
      --    消費端沒有盤過 ⇒ 板列 `⟦search-LISTVIEWNOEXTID⟧` 記著未來若要動它的入口。
         --    ⛔ ~~理由之一是「它的 COMMENT 逐字寫著排除 external_id, 那個排除看起來是刻意的」~~
         --    🔴 **那句是錯的**(codex + code-reviewer 同時抓):現行 COMMENT(`20260811040000:229`)
         --      逐字是 `excludes price_store, price_by_tier, metadata, detail content and delisted_at`
         --      —— **沒有 external_id**。含它的是 9/10 欄時期那兩代, 而那份清單裡它跟
         --      `description / images / timestamps` 排在一起 ⇒ 那是**卡片瘦身**, 不是安全排除。
         --    ✅ **選甲仍然對, 而理由換成量到的那個**:動公開投影會改欄數與欄位順序,
         --      而**消費端沒有盤過** —— 這一條不需要那句 COMMENT 撐。
      'external_id', pe.external_id,
      'title', pg.title,
      'subtitle', pg.subtitle,
      'handle', pg.handle,
      'availability', pg.availability,
      'price_general', pg.price_general,
      'card_image', pg.card_image,
      'fits', pg.fits,
      'brand_name', pg.brand_name,
      'brand_slug', pg.brand_slug,
      'category_raw', pg.category_raw,
      'fitments', pg.fitments,
      'card_image_trim', CASE WHEN t.url IS NULL THEN NULL ELSE jsonb_build_object(
        'l', t.bbox_left, 't', t.bbox_top, 'w', t.bbox_width, 'h', t.bbox_height,
        'nw', t.natural_width, 'nh', t.natural_height) END
    ),
    pg.total_rows
  FROM paged pg
  LEFT JOIN public.product_image_trim t ON t.url = pg.card_image AND t.status = 'ok'
  -- 🔵 **只在【這一頁】上 join** —— `paged` 已經 LIMIT 過(最多 100 列), 而 join key 是主鍵。
  -- 🔴 用 `LEFT` 不是 `INNER`:兩支 view 都吃 RLS, 正常同進同出;而萬一某一列只在其中一邊,
  --    INNER 會把那張卡**整張弄不見**, LEFT 只讓料號是 null。
  --    ⇒ 📌 **少一個料號 vs 少一張商品卡, 後者嚴重得多。**
  LEFT JOIN public.products_public pe ON pe.id = pg.id
  ORDER BY
    -- #950:🔴 用內層算好的 sort_band / sort_rn, **不要在這裡重算 row_number()**(理由見內層註解)
    -- 🎯 ⟦db-SEARCHFACETMUTEX⟧ 料號完全命中排最前 —— **內外層都要有**, 理由見內層那段。
    CASE WHEN p_sort = 'recommend' AND p_terms IS NOT NULL
         THEN NOT pg.kw_exact END ASC NULLS LAST,
    CASE WHEN p_sort = 'recommend' THEN pg.sort_band END ASC NULLS LAST,
    CASE WHEN p_sort = 'recommend' THEN pg.sort_rn   END ASC NULLS LAST,
    CASE WHEN p_sort = 'recommend' THEN pg.price_general END DESC NULLS LAST,
    CASE WHEN p_sort = 'price-asc' THEN pg.price_general END ASC NULLS LAST,
    CASE WHEN p_sort = 'price-desc' THEN pg.price_general END DESC NULLS LAST,
    CASE WHEN p_sort = 'new' THEN pg.created_at END DESC NULLS LAST,
    pg.id ASC;
END;
$function$;

-- ── ③ 經銷客人那支(SECURITY DEFINER + search_path='';基底 = 正式庫現行定義)──
-- 🔴 `CREATE OR REPLACE` 會把 `SET` 子句整組換掉 ⇒ 那一行**必須跟著在**。
--    (memory `reference_create-or-replace-resets-set-clause`;窗 C 今天在它那支踩過同族。)
CREATE OR REPLACE FUNCTION public.search_catalog_by_vehicle_dealer(p_categories text[], p_brand text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_offset integer DEFAULT 0, p_limit integer DEFAULT 25, p_sort text DEFAULT 'recommend'::text, p_category text DEFAULT NULL::text, p_brand_slugs text[] DEFAULT NULL::text[], p_price_min integer DEFAULT NULL::integer, p_price_max integer DEFAULT NULL::integer, p_new_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_terms text[] DEFAULT NULL::text[])
 RETURNS TABLE(item jsonb, total bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
-- ⟦DEALER-GUARD-DECL-BEGIN⟧
  v_uid  uuid;
  v_tier text;
-- ⟦DEALER-GUARD-DECL-END⟧
  -- 🔴🔴 **`v_cats` 把新舊兩個入口收成【一份】** —— 新的 `p_categories` 加上舊的 `p_category`。
  --    ⇒ 📌 下面每一處都只讀 `v_cats`, **不再有任何一處直接讀 `p_category`**
  --      ⇒ 那讓「漏改一處」變成不可能, 而不是靠人數對。
  -- 🔴🔴 **[2026-09-04 本支改的就是這件事 —— 而它【只動排序, 不動過濾】]**
  --    Sean 2026-09-04 逐字「3. 甲」= 帶分類時也照【中高價位優先】排。
  --    ⛔ ~~原本 12 處排序 CASE 都掛著 `AND cardinality(v_cats) = 0`~~
  --       ⇒ 一旦帶了分類, 那組 CASE 全部回 NULL ⇒ **唯一還在生效的鍵是 `f.id ASC`(UUID)**
  --       ⇒ 📌 **客人點進一個分類, 第一頁等於【隨機順序】** —— 而那不是「另一種排法」, 是沒有排法。
  --    ✅ 本支把那 12 處的 `AND cardinality(v_cats) = 0` 拿掉。
  --    🛑 **而【WHERE 那兩處一個字都沒動】** —— 那是過濾, 不是排序:
  --       `WHERE (cardinality(v_cats) = 0 OR ...)` 決定「要不要套分類過濾」。
  --       ⇒ 動它會改變**回傳哪些商品**, 而本支只改**它們的順序**。
  --    🔵 而「大類輪流」(`sort_rn` 的 PARTITION BY 大類)在只選一個分類時**自然變成 no-op**
  --       —— 同一個 partition ⇒ 剩下「中高價分帶 + 段內由高到低」, 那正是 Sean 要的。
  -- 🛑 **而「空」的判準一律是 `cardinality(v_cats) = 0`, 不是 `IS NULL`** ——
  --    陣列有兩種空(NULL 與 `{}`), 而**它們在 `IS NULL` 上不一樣**。
  --    🔬 本檔實測到的分母:`p_category IS NULL` 在原版出現 **12** 次(兩份查詢各 6)
  --      ⇒ ⚠️ 而 plan 裡我寫「三行」—— 那是**只 grep 到一份查詢**的數。**12 才是對的。**
  v_cats text[];
  -- ⛔ ~~`c_batch_day_threshold constant int := 100;`~~ 與它上面那段說明 ——
  --    2026-09-09 Sean 拍甲拿掉「一天超過 N 件就整天不算新品」那條規則,常數與兩個分支一起刪。
  --    🔴 舊字面刻意留刪除線:拿「批次門檻」去搜的人要同一發撞到這句訂正。
  -- ── #950 推薦排序:中高價位優先(Sean 2026-08-27「中間~高 價位優先在前面好了」, 選項回「乙」)──
  -- 🔴 這兩個數字是【我們挑的, 不是他挑的】。他看到的選項字面是
  --    「這次先寫死在程式裡, 記一筆待辦(要改得叫我們)」, 而他回【甲】
  --    ⇒ 他同意的是那個做法, **不是這兩個值**。
  -- 🔴🔴 **要改就是改這兩行。**
  --    ⚠️ **而 backlog `#950` 目前【還沒有】指回本檔**(code-reviewer 實查:
  --       `grep -n '20260827150000' docs/phase-1-backlog.md` ⇒ 0 命中)
  --       ⇒ 那句「要改得叫我們」的承諾,現在只有【這一行】是它的地址。
  --       ⇒ 條目改寫是欠著的工(見 checkpoint), 而在那之前不要說「backlog 指到這裡」。
  --      (改了要開新 migration 重貼整支函式, 理由同上面那個門檻常數。)
  -- 值的來源:全站群代表價分布, 2026-08-27 量於報價單庫 storefront_catalog_v(22,193 群)
  --    中位數 4,000 / P90 13,800 ⇒ 段界取【中位數 ~ P90】
  --    ⚠️ 換成 Q3~P95(7,480 ~ 約 21,000)⇒ 第一頁整批換人、平均單價高很多
  -- 分類第一段 = 這個字的商品【不進新品區】(Sean 2026-08-27 拍【甲】= 照大類切)。
  -- 🔴 用 split_part 取第一段, 不是整串比對 —— 以後多出「維修零件 · 油封」這種子類會【自動】跟著排除,
  --    不需要有人記得回來改。Sean 拍甲的理由就是這個(de 端題時已明說「今天甲乙行為一樣, 差別在以後」)。
  -- ⚠️ 只作用在【新品模式】(p_new_since IS NOT NULL)。目錄 / 搜尋 / 品牌頁 / 分類頁傳 NULL ⇒ 不受影響;
  --    客人在分類頁直接看「維修零件」時 p_new_since 也是 NULL ⇒ 那 1631 件照常看得到。
  c_new_arrivals_excluded_category constant text := '維修零件';
  c_recommend_band_lo constant int := 4000;
  c_recommend_band_hi constant int := 13800;
  -- 🔴🔴 ⟦db-SEARCHFACETMUTEX⟧ **「空白」的字集 —— 顯式列舉**(codex R1 nit + R2 nit)
  --   ⛔ ~~`btrim(pt)` 預設~~ 只剝 ASCII 空格;⛔ ~~`pt ~ '[^[:space:]]'`~~ **依 locale**
  --     (我自己的 harness 在 `--locale=C` 下抓到它對全形空格失效)。
  --   ⇒ 📌 兩個都不行, 而它們**在正式庫與拋棄式庫會給不同答案, 且兩邊都不報錯**。
  c_ws constant text := E' \t\n\r\x0B\f\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF';
BEGIN
-- ⟦DEALER-GUARD-BEGIN⟧
  -- 🔴🔴 fail-closed 身分閘 —— 而它【故意不 fallback 回一般價】。
  --    📌 一個「安全的 fallback」會讓這一整支存在的理由消失, 而且不會有人發現:
  --       退回一般價 = 這支變成 search_catalog_by_vehicle 的複本, 而呼叫端本來就該挑。
  --    ⇒ 查無 / 非 store ⇒ RAISE, 讓「叫錯支」在第一次就被看見。
  -- 🔵 寫法照範本 public.get_effective_prices(20260907010000):auth.uid() ⇒ 查 customers.tier。
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '經銷目錄:沒有登入身分 ⇒ 這支只給經銷會員, 一般客人請叫 public.search_catalog_by_vehicle'
      USING ERRCODE = 'PCM04';
  END IF;
  SELECT c.tier INTO v_tier FROM public.customers c WHERE c.user_id = v_uid;
  IF v_tier IS DISTINCT FROM 'store' THEN
    RAISE EXCEPTION '經銷目錄:這個帳號的 tier 是 %(期望 store)⇒ 拒絕', coalesce(v_tier, '(查無此人)')
      USING ERRCODE = 'PCM04';
  END IF;
-- ⟦DEALER-GUARD-END⟧
  -- 🔵 新舊合流:兩個都給的話一起吃(聯集)。`p_category` 是舊入口, 保留到步驟 C 才 DROP。
  v_cats := (
    -- 🔴 **`btrim` 要寫回, 不是只拿來過濾**(codex nit):原版只用它排除空白字串,
    --    而 `' 排氣系統 '` 會**帶著空白留下來** ⇒ 比不到任何分類, 而且不會與無空白版去重。
    SELECT coalesce(array_agg(DISTINCT btrim(x)), ARRAY[]::text[])
      FROM unnest(coalesce(p_categories, ARRAY[]::text[])
                  || CASE WHEN p_category IS NULL THEN ARRAY[]::text[] ELSE ARRAY[p_category] END) AS x
     WHERE btrim(x) <> ''
  );
  IF p_brand IS NULL THEN
    RETURN QUERY
    WITH kw AS MATERIALIZED (
      -- 🎯 ⟦db-SEARCHFACETMUTEX⟧ 2026-09-09:關鍵字命中集合**提到 CTE**, 而理由有兩個。
      --   ① 要把 `is_exact` 帶進 `filtered` 當排序鍵 —— 寫成每列一次的純量子查詢的話,
      --      那支 SRF 會**對結果集的每一列各跑一次**。
      --   ② `MATERIALIZED` 是刻意的:少了它 planner 可能把它推進 JOIN 反覆求值。
      -- 🔵 **`p_terms IS NULL` 時它照樣跑一次, 而那一次是空的** ——
      --   `array_agg` 對空集合回 NULL ⇒ 該函式內部 `unnest(NULL)` ⇒ 零詞 ⇒ 它自己的
      --   `WHERE n.want > 0` 直接回零列。⛔ ~~今天每一發零成本~~ ⇒ 現在是**一次零列呼叫**。
      --   ⇒ 📌 那是本片的成本, 明寫在這裡而不是讓下一個人自己發現。
      SELECT k.id, k.is_exact
        FROM public.storefront_search_product_ids(
               (SELECT array_agg(pt) FROM unnest(p_terms) AS pt WHERE btrim(pt, c_ws) <> '')) k
    ), filtered AS (
      SELECT p.*, COALESCE(kw.is_exact, false) AS kw_exact
      FROM public.products_list_dealer p
      -- 🔵 LEFT JOIN 不是 INNER —— 沒有關鍵字時 `kw` 是空的,
      --    用 INNER 會把整張目錄濾光, 而 HTTP 200、畫面完全正常。
      LEFT JOIN kw ON kw.id = p.id
      -- 🔴🔴 **不是 `= ANY(v_cats)`** —— 分類的述詞有【兩個分支】(`=` 與 `LIKE 父 · %`),
      --    而品牌只有一個 ⇒ 照抄品牌那一格會**漏掉「打大類要涵蓋子類」那一半**,
      --    而它看起來完全正確。⇒ 每一個元素都要走那兩個分支。
      -- ✅ **聯集**(任一元素中就算中)= Sean 2026-09-04 拍的甲:
      --    逐字「甲 聯集 —— 排氣管【或】油箱貼, 兩種商品都列出來(比較多)」。
      WHERE (cardinality(v_cats) = 0
             OR EXISTS (SELECT 1 FROM unnest(v_cats) AS vc
                         WHERE p.category_raw = vc OR p.category_raw LIKE vc || ' · %'))
        AND (p_brand_slugs IS NULL OR cardinality(p_brand_slugs) = 0 OR p.brand_slug = ANY(p_brand_slugs))
        AND (p_price_min IS NULL OR p.price_general >= p_price_min)
        AND (p_price_max IS NULL OR p.price_general <= p_price_max)
        AND (p_new_since IS NULL OR (
              p.created_at >= p_new_since
              -- 上界（codex R2 NIT-2）：未來時戳的列不算新品，否則它會永遠釘在「新品」第一位。
              -- ⛔ ~~「只夾窗、不夾 new_batch_days」~~ —— 2026-09-09 批次日規則已拿掉,
              --    這一行留下的只有【上界】那半, 而它自己的理由(上一行)仍然成立。
              AND p.created_at <= now()
              -- 🔴 維修零件不進新品區。`coalesce` 少不得:category_raw 若為 NULL,
              --    `split_part(NULL,…) <> '維修零件'` 會回 NULL ⇒ 那一列會被【當成維修零件排掉】。
              --    現值空值 0 ⇒ 今天看不出差別, 而那正是它以後會安靜咬人的原因。
              AND coalesce(split_part(p.category_raw, ' · ', 1), '') <> c_new_arrivals_excluded_category
            ))
        -- 🔴🔴 ⟦db-SEARCHFACETMUTEX⟧ 關鍵字那一格 —— **比對【不在這裡】做**, 委給 `storefront_search_product_ids`。
        --    🎯 **為什麼委出去**:那支已經有四欄 ILIKE + 品牌名 + 母料號前綴 + 變體 sku 四塊,
        --      而每一塊的守門條件都付過學費(見 `20260906950000` 的註解)⇒ 自己再寫一份 ILIKE
        --      = 兩份會漂, 而漂的方向是【客人搜不到】, 那沒有人會回報。
        --    🛑 **而 `products_list_public` 上【沒有】`description` 與 `external_id` 兩欄**
        --      ⇒ 就算想在這裡比也比不完整;委出去那一側走的是 `products_public`。
        -- 🔴🔴 **第二個條件不可以省, 而少了它會【整站零商品】**:
        --    被委的那支在零個有效詞時逐字「回零列(不是回全表)」(`20260906950000` 的 `WHERE n.want > 0`)
        --    ⇒ 📌 `p_terms = ARRAY['']` 這種呼叫會讓每一列都被濾掉, 而 HTTP 200、畫面完全正常。
        --    ⇒ **「沒有關鍵字」這件事必須在【這裡】判, 不得委出去。**
        --    🔴🔴 **「有效詞」的判準【刻意與被委那支不同】, 而差的方向是承重的**(codex R1 nit):
--      被委那支用 `btrim(term) <> ''`, 而 **`btrim` 預設只剝 ASCII 空格**
--      ⇒ 📌 `ARRAY[E'\t']` / 換行 / 全形空格 `U+3000` 在它眼裡是**有效詞**
--        ⇒ 它會拿 `%<tab>%` 去比 ⇒ 回零列 ⇒ **整站零商品**, 又是同一個形狀。
--      ⛔ ~~我的第一版寫 `pt ~ '[^[:space:]]'`~~ —— 🔴 **那一版是【我自己的 harness 抓到的】**:
--        `[[:space:]]` 是**依 locale 的**, 而拋棄式庫跑在 `--locale=C` ⇒ 它只認 ASCII
--        ⇒ 全形空格 `U+3000` 那一格實測 **0(期望 4)**。
--        📌 而正式庫是 UTF-8 locale ⇒ 📌 **同一段碼在兩個環境會給不同答案, 而兩邊都不報錯。**
--      ✅ 改成**顯式列舉**(與 `normalizeSearchInput` 學到的同一課:`\s` 不含 `U+200B`)
--        `btrim(pt, ' '||chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(8203)||chr(12288)||chr(65279))`
--        ⇒ 空白 / tab / 換行 / 零寬空格 / 全形空格 / BOM,**locale 無關** ⇒ **比被委那支寬**
--        ⇒ 純空白的詞在這裡算「沒有關鍵字」⇒ **不過濾, 出全部**。
--    🔴🔴 **[codex R2 must-fix]** ⛔ ~~只擋「整組都是空白」就夠~~ —— **那句是假的, 而反例很小**:
--      `ARRAY['碳纖維', E'\t']` ⇒ 第一個詞有效 ⇒ 整組過了我的閘 ⇒ **連同那個 tab 原樣送出去**
--      ⇒ 被委那支把 tab 當成**第二個必要條件**(`count(DISTINCT ord) = want`)
--      ⇒ 📌 **一筆都不會中** ⇒ 客人打了字而拿到 0 件, 而畫面完全正常。
--      ✅ **所以不是【擋】, 是【濾】**:只把有效詞 `array_agg` 起來送出去。
--      🎯 兩邊不一致仍是刻意的, 而現在它**真的**只往【出全部】倒 —— 空白詞根本不會抵達那一支。
        AND (p_terms IS NULL
             OR NOT EXISTS (SELECT 1 FROM unnest(p_terms) AS pt WHERE btrim(pt, c_ws) <> '')
             -- ⛔ ~~`OR p.id IN (SELECT k.id FROM storefront_search_product_ids(…)) `~~
             -- 🎯 同一個集合改從上面那個 `kw` CTE 來 —— **`IN (SELECT …)` 是集合語意,
             --   那支函式自己的 `ORDER BY`(完全命中排最前)在那一行【蒸發】。**
             --   2026-09-09 實測:`VF11` 的完全命中那顆 第 1 名 ⇒ 第 14 名(最後一名)。
             OR kw.id IS NOT NULL)
    ), paged AS (
      -- count/排序/分頁先收斂到 ≤100 列，trim JOIN 只對當頁做（20260719150000 MF-4）
      SELECT f.*, count(*) OVER () AS total_rows,
        -- ── #950 recommend 的兩個排序欄。🔴 **算在這裡, 不算在外層 ORDER BY 裡** ──
        --   理由是實測踩到的:第一版把 row_number() 寫進【外層】那個 ORDER BY,
        --   它會對【已經分頁後的那幾列】重算一次 ⇒ 名次變成頁內名次、不是全域名次
        --   ⇒ 第一頁出現重複的大類(2026-08-27 實測:期望 12 個相異大類, 實得 11)。
        --   📌 而 11/12 看起來幾乎對 —— 那正是它難發現的地方。
  -- 🔴🔴 **第二個實測抓到的錯:PARTITION 要含【段】。**
  --   只用大類分割 ⇒ rn 是「這一類【全部】商品裡的名次」, 而段外(比段更貴)的也算在內
  --   ⇒ 各大類段外商品【數量不同】⇒ 每一類第一個段內商品拿到的 rn 不同
  --     (實測:第一頁的 rn 從 24 起跳、有 24 也有 25 ⇒ 同一個大類出現兩次)
  --   ⇒ 加上 band 之後, 每一類【在段內】的名次才從 1 開始, 輪流才真的是輪流。
        CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
             THEN 0 ELSE 1 END AS sort_band,
        -- 🔴 大類 = category_raw 的第一段。單段的分類是合法的(本函式自己的 WHERE 就有
        --    `= p_category` 與 `LIKE p_category || ' · %'` 兩個分支)⇒ split_part 對單段值
        --    回整串 ⇒ 它自成一個大類, 行為正確、不是 bug。
        row_number() OVER (PARTITION BY split_part(f.category_raw, ' · ', 1),
                                           CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                     AND c_recommend_band_hi THEN 0 ELSE 1 END
                           ORDER BY f.price_general DESC NULLS LAST, f.id) AS sort_rn
      FROM filtered f
      ORDER BY
        -- 🎯 ⟦db-SEARCHFACETMUTEX⟧ **料號完全命中排最前**(Sean 2026-09-06 逐字
        --   「完全命中的排最前」;2026-09-09 拍甲把它接回目錄 RPC)。
        -- 🔴 **只在【有關鍵字】而且【走預設推薦排序】時生效** ——
        --   客人自己點了「價格低到高 / 最新上架」就照他點的走, 不插隊。
        -- 🔵 `NOT f.kw_exact` ⇒ 完全命中是 false(0) ⇒ ASC 把它排在最前面。
        --   兩個條件任一不成立 ⇒ 整個 CASE 是 NULL ⇒ NULLS LAST ⇒ 全部同分
        --   ⇒ 📌 **沒有關鍵字的那一發, 行為一個位元組都不變。**
        CASE WHEN p_sort = 'recommend' AND p_terms IS NOT NULL
             THEN NOT f.kw_exact END ASC NULLS LAST,
        CASE WHEN p_sort = 'recommend' THEN
          CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
               THEN 0 ELSE 1 END
        END ASC NULLS LAST,
        CASE WHEN p_sort = 'recommend' THEN
          row_number() OVER (PARTITION BY split_part(f.category_raw, ' · ', 1),
                                             CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                       AND c_recommend_band_hi THEN 0 ELSE 1 END
                             ORDER BY f.price_general DESC NULLS LAST, f.id)
        END ASC NULLS LAST,
        CASE WHEN p_sort = 'recommend' THEN f.price_general END DESC NULLS LAST,
        CASE WHEN p_sort = 'price-asc' THEN f.price_general END ASC NULLS LAST,
        CASE WHEN p_sort = 'price-desc' THEN f.price_general END DESC NULLS LAST,
        CASE WHEN p_sort = 'new' THEN f.created_at END DESC NULLS LAST,
        f.id ASC
      OFFSET GREATEST(p_offset, 0)
      LIMIT LEAST(GREATEST(p_limit, 1), 100)
    )
    SELECT
      jsonb_build_object(
        'id', pg.id,
        -- 🔴 母料號:Sean 2026-09-06 拍「全部頁面都顯示料號」。
        --    來源是 `products_public`(下面 LEFT JOIN 的 `pe`), **不是 `products_list_public`** ——
        --    那支清單投影**沒有這一欄**(2026-09-06 正式庫唯讀逐欄查:16 欄, 無 `external_id`;
        --    而 `products_public` 有 ⇒ 🟢 正對照)。
        -- 🛑 **刻意不動 `products_list_public`**(主視窗 `Q-母料號來源 A: 甲`):它是**公開投影**,
        --    消費端沒有盤過 ⇒ 板列 `⟦search-LISTVIEWNOEXTID⟧` 記著未來若要動它的入口。
         --    ⛔ ~~理由之一是「它的 COMMENT 逐字寫著排除 external_id, 那個排除看起來是刻意的」~~
         --    🔴 **那句是錯的**(codex + code-reviewer 同時抓):現行 COMMENT(`20260811040000:229`)
         --      逐字是 `excludes price_store, price_by_tier, metadata, detail content and delisted_at`
         --      —— **沒有 external_id**。含它的是 9/10 欄時期那兩代, 而那份清單裡它跟
         --      `description / images / timestamps` 排在一起 ⇒ 那是**卡片瘦身**, 不是安全排除。
         --    ✅ **選甲仍然對, 而理由換成量到的那個**:動公開投影會改欄數與欄位順序,
         --      而**消費端沒有盤過** —— 這一條不需要那句 COMMENT 撐。
        'external_id', pe.external_id,
        'title', pg.title,
        'subtitle', pg.subtitle,
        'handle', pg.handle,
        'availability', pg.availability,
        'price_general', pg.price_general,
        'card_image', pg.card_image,
        'fits', pg.fits,
        'brand_name', pg.brand_name,
        'brand_slug', pg.brand_slug,
        'category_raw', pg.category_raw,
        'fitments', pg.fitments,
        'card_image_trim', CASE WHEN t.url IS NULL THEN NULL ELSE jsonb_build_object(
          'l', t.bbox_left, 't', t.bbox_top, 'w', t.bbox_width, 'h', t.bbox_height,
          'nw', t.natural_width, 'nh', t.natural_height) END
      ),
      pg.total_rows
    FROM paged pg
    LEFT JOIN public.product_image_trim t ON t.url = pg.card_image AND t.status = 'ok'
    -- 🔵 **只在【這一頁】上 join** —— `paged` 已經 LIMIT 過(最多 100 列), 而 join key 是主鍵。
    -- 🔴 用 `LEFT` 不是 `INNER`:兩支 view 都吃 RLS, 正常同進同出;而萬一某一列只在其中一邊,
    --    INNER 會把那張卡**整張弄不見**, LEFT 只讓料號是 null。
    --    ⇒ 📌 **少一個料號 vs 少一張商品卡, 後者嚴重得多。**
    LEFT JOIN public.products_public pe ON pe.id = pg.id
    ORDER BY
      -- #950:🔴 用內層算好的 sort_band / sort_rn, **不要在這裡重算 row_number()**(理由見內層註解)
      -- 🎯 ⟦db-SEARCHFACETMUTEX⟧ 料號完全命中排最前 —— **內外層都要有**, 理由見內層那段。
      CASE WHEN p_sort = 'recommend' AND p_terms IS NOT NULL
           THEN NOT pg.kw_exact END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN pg.sort_band END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN pg.sort_rn   END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN pg.price_general END DESC NULLS LAST,
      CASE WHEN p_sort = 'price-asc' THEN pg.price_general END ASC NULLS LAST,
      CASE WHEN p_sort = 'price-desc' THEN pg.price_general END DESC NULLS LAST,
      CASE WHEN p_sort = 'new' THEN pg.created_at END DESC NULLS LAST,
      pg.id ASC;
    RETURN;
  END IF;

  RETURN QUERY
  WITH kw AS MATERIALIZED (
      -- 🎯 ⟦db-SEARCHFACETMUTEX⟧ 2026-09-09:關鍵字命中集合**提到 CTE**, 而理由有兩個。
      --   ① 要把 `is_exact` 帶進 `filtered` 當排序鍵 —— 寫成每列一次的純量子查詢的話,
      --      那支 SRF 會**對結果集的每一列各跑一次**。
      --   ② `MATERIALIZED` 是刻意的:少了它 planner 可能把它推進 JOIN 反覆求值。
      -- 🔵 **`p_terms IS NULL` 時它照樣跑一次, 而那一次是空的** ——
      --   `array_agg` 對空集合回 NULL ⇒ 該函式內部 `unnest(NULL)` ⇒ 零詞 ⇒ 它自己的
      --   `WHERE n.want > 0` 直接回零列。⛔ ~~今天每一發零成本~~ ⇒ 現在是**一次零列呼叫**。
      --   ⇒ 📌 那是本片的成本, 明寫在這裡而不是讓下一個人自己發現。
      SELECT k.id, k.is_exact
        FROM public.storefront_search_product_ids(
               (SELECT array_agg(pt) FROM unnest(p_terms) AS pt WHERE btrim(pt, c_ws) <> '')) k
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
  ), filtered AS (
    SELECT p.*, COALESCE(kw.is_exact, false) AS kw_exact
    FROM public.products_list_dealer p
    JOIN matched m ON m.product_id = p.id
    -- 🔵 LEFT JOIN 不是 INNER —— 理由同上面那份。
    LEFT JOIN kw ON kw.id = p.id
    -- 🔴 與上面那份同一個修法(本函式有【兩份】查詢, 兩份都要改)。
    WHERE (cardinality(v_cats) = 0
           OR EXISTS (SELECT 1 FROM unnest(v_cats) AS vc
                       WHERE p.category_raw = vc OR p.category_raw LIKE vc || ' · %'))
      AND (p_brand_slugs IS NULL OR cardinality(p_brand_slugs) = 0 OR p.brand_slug = ANY(p_brand_slugs))
      AND (p_price_min IS NULL OR p.price_general >= p_price_min)
      AND (p_price_max IS NULL OR p.price_general <= p_price_max)
      AND (p_new_since IS NULL OR (
            p.created_at >= p_new_since
            AND p.created_at <= now()
            -- 🔴 維修零件不進新品區。`coalesce` 少不得:category_raw 若為 NULL,
            --    `split_part(NULL,…) <> '維修零件'` 會回 NULL ⇒ 那一列會被【當成維修零件排掉】。
            --    現值空值 0 ⇒ 今天看不出差別, 而那正是它以後會安靜咬人的原因。
            AND coalesce(split_part(p.category_raw, ' · ', 1), '') <> c_new_arrivals_excluded_category
          ))
      -- 🔴🔴 ⟦db-SEARCHFACETMUTEX⟧ 關鍵字那一格 —— **比對【不在這裡】做**, 委給 `storefront_search_product_ids`。
      --    🎯 **為什麼委出去**:那支已經有四欄 ILIKE + 品牌名 + 母料號前綴 + 變體 sku 四塊,
      --      而每一塊的守門條件都付過學費(見 `20260906950000` 的註解)⇒ 自己再寫一份 ILIKE
      --      = 兩份會漂, 而漂的方向是【客人搜不到】, 那沒有人會回報。
      --    🛑 **而 `products_list_public` 上【沒有】`description` 與 `external_id` 兩欄**
      --      ⇒ 就算想在這裡比也比不完整;委出去那一側走的是 `products_public`。
      -- 🔴🔴 **第二個條件不可以省, 而少了它會【整站零商品】**:
      --    被委的那支在零個有效詞時逐字「回零列(不是回全表)」(`20260906950000` 的 `WHERE n.want > 0`)
      --    ⇒ 📌 `p_terms = ARRAY['']` 這種呼叫會讓每一列都被濾掉, 而 HTTP 200、畫面完全正常。
      --    ⇒ **「沒有關鍵字」這件事必須在【這裡】判, 不得委出去。**
      --    🔴🔴 **「有效詞」的判準【刻意與被委那支不同】, 而差的方向是承重的**(codex R1 nit):
--      被委那支用 `btrim(term) <> ''`, 而 **`btrim` 預設只剝 ASCII 空格**
--      ⇒ 📌 `ARRAY[E'\t']` / 換行 / 全形空格 `U+3000` 在它眼裡是**有效詞**
--        ⇒ 它會拿 `%<tab>%` 去比 ⇒ 回零列 ⇒ **整站零商品**, 又是同一個形狀。
--      ⛔ ~~我的第一版寫 `pt ~ '[^[:space:]]'`~~ —— 🔴 **那一版是【我自己的 harness 抓到的】**:
--        `[[:space:]]` 是**依 locale 的**, 而拋棄式庫跑在 `--locale=C` ⇒ 它只認 ASCII
--        ⇒ 全形空格 `U+3000` 那一格實測 **0(期望 4)**。
--        📌 而正式庫是 UTF-8 locale ⇒ 📌 **同一段碼在兩個環境會給不同答案, 而兩邊都不報錯。**
--      ✅ 改成**顯式列舉**(與 `normalizeSearchInput` 學到的同一課:`\s` 不含 `U+200B`)
--        `btrim(pt, ' '||chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(8203)||chr(12288)||chr(65279))`
--        ⇒ 空白 / tab / 換行 / 零寬空格 / 全形空格 / BOM,**locale 無關** ⇒ **比被委那支寬**
--        ⇒ 純空白的詞在這裡算「沒有關鍵字」⇒ **不過濾, 出全部**。
--    🔴🔴 **[codex R2 must-fix]** ⛔ ~~只擋「整組都是空白」就夠~~ —— **那句是假的, 而反例很小**:
--      `ARRAY['碳纖維', E'\t']` ⇒ 第一個詞有效 ⇒ 整組過了我的閘 ⇒ **連同那個 tab 原樣送出去**
--      ⇒ 被委那支把 tab 當成**第二個必要條件**(`count(DISTINCT ord) = want`)
--      ⇒ 📌 **一筆都不會中** ⇒ 客人打了字而拿到 0 件, 而畫面完全正常。
--      ✅ **所以不是【擋】, 是【濾】**:只把有效詞 `array_agg` 起來送出去。
--      🎯 兩邊不一致仍是刻意的, 而現在它**真的**只往【出全部】倒 —— 空白詞根本不會抵達那一支。
      AND (p_terms IS NULL
           OR NOT EXISTS (SELECT 1 FROM unnest(p_terms) AS pt WHERE btrim(pt, c_ws) <> '')
           -- ⛔ ~~`OR p.id IN (SELECT k.id FROM storefront_search_product_ids(…)) `~~
           -- 🎯 同一個集合改從上面那個 `kw` CTE 來 —— **`IN (SELECT …)` 是集合語意,
           --   那支函式自己的 `ORDER BY`(完全命中排最前)在那一行【蒸發】。**
           --   2026-09-09 實測:`VF11` 的完全命中那顆 第 1 名 ⇒ 第 14 名(最後一名)。
           OR kw.id IS NOT NULL)
  ), paged AS (
    SELECT f.*, count(*) OVER () AS total_rows,
      -- ── #950 recommend 的兩個排序欄。🔴 **算在這裡, 不算在外層 ORDER BY 裡** ──
      --   理由是實測踩到的:第一版把 row_number() 寫進【外層】那個 ORDER BY,
      --   它會對【已經分頁後的那幾列】重算一次 ⇒ 名次變成頁內名次、不是全域名次
      --   ⇒ 第一頁出現重複的大類(2026-08-27 實測:期望 12 個相異大類, 實得 11)。
      --   📌 而 11/12 看起來幾乎對 —— 那正是它難發現的地方。
  -- 🔴🔴 **第二個實測抓到的錯:PARTITION 要含【段】。**
  --   只用大類分割 ⇒ rn 是「這一類【全部】商品裡的名次」, 而段外(比段更貴)的也算在內
  --   ⇒ 各大類段外商品【數量不同】⇒ 每一類第一個段內商品拿到的 rn 不同
  --     (實測:第一頁的 rn 從 24 起跳、有 24 也有 25 ⇒ 同一個大類出現兩次)
  --   ⇒ 加上 band 之後, 每一類【在段內】的名次才從 1 開始, 輪流才真的是輪流。
      CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
           THEN 0 ELSE 1 END AS sort_band,
      -- 🔴 大類 = category_raw 的第一段。單段的分類是合法的(本函式自己的 WHERE 就有
      --    `= p_category` 與 `LIKE p_category || ' · %'` 兩個分支)⇒ split_part 對單段值
      --    回整串 ⇒ 它自成一個大類, 行為正確、不是 bug。
      row_number() OVER (PARTITION BY split_part(f.category_raw, ' · ', 1),
                                         CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                   AND c_recommend_band_hi THEN 0 ELSE 1 END
                         ORDER BY f.price_general DESC NULLS LAST, f.id) AS sort_rn
    FROM filtered f
    ORDER BY
      -- 🎯 ⟦db-SEARCHFACETMUTEX⟧ **料號完全命中排最前**(Sean 2026-09-06 逐字
      --   「完全命中的排最前」;2026-09-09 拍甲把它接回目錄 RPC)。
      -- 🔴 **只在【有關鍵字】而且【走預設推薦排序】時生效** ——
      --   客人自己點了「價格低到高 / 最新上架」就照他點的走, 不插隊。
      -- 🔵 `NOT f.kw_exact` ⇒ 完全命中是 false(0) ⇒ ASC 把它排在最前面。
      --   兩個條件任一不成立 ⇒ 整個 CASE 是 NULL ⇒ NULLS LAST ⇒ 全部同分
      --   ⇒ 📌 **沒有關鍵字的那一發, 行為一個位元組都不變。**
      CASE WHEN p_sort = 'recommend' AND p_terms IS NOT NULL
           THEN NOT f.kw_exact END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN
        CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
             THEN 0 ELSE 1 END
      END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN
        row_number() OVER (PARTITION BY split_part(f.category_raw, ' · ', 1),
                                           CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                     AND c_recommend_band_hi THEN 0 ELSE 1 END
                           ORDER BY f.price_general DESC NULLS LAST, f.id)
      END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN f.price_general END DESC NULLS LAST,
      CASE WHEN p_sort = 'price-asc' THEN f.price_general END ASC NULLS LAST,
      CASE WHEN p_sort = 'price-desc' THEN f.price_general END DESC NULLS LAST,
      CASE WHEN p_sort = 'new' THEN f.created_at END DESC NULLS LAST,
      f.id ASC
    OFFSET GREATEST(p_offset, 0)
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  )
  SELECT
    jsonb_build_object(
      'id', pg.id,
      -- 🔴 母料號:Sean 2026-09-06 拍「全部頁面都顯示料號」。
      --    來源是 `products_public`(下面 LEFT JOIN 的 `pe`), **不是 `products_list_public`** ——
      --    那支清單投影**沒有這一欄**(2026-09-06 正式庫唯讀逐欄查:16 欄, 無 `external_id`;
      --    而 `products_public` 有 ⇒ 🟢 正對照)。
      -- 🛑 **刻意不動 `products_list_public`**(主視窗 `Q-母料號來源 A: 甲`):它是**公開投影**,
      --    消費端沒有盤過 ⇒ 板列 `⟦search-LISTVIEWNOEXTID⟧` 記著未來若要動它的入口。
         --    ⛔ ~~理由之一是「它的 COMMENT 逐字寫著排除 external_id, 那個排除看起來是刻意的」~~
         --    🔴 **那句是錯的**(codex + code-reviewer 同時抓):現行 COMMENT(`20260811040000:229`)
         --      逐字是 `excludes price_store, price_by_tier, metadata, detail content and delisted_at`
         --      —— **沒有 external_id**。含它的是 9/10 欄時期那兩代, 而那份清單裡它跟
         --      `description / images / timestamps` 排在一起 ⇒ 那是**卡片瘦身**, 不是安全排除。
         --    ✅ **選甲仍然對, 而理由換成量到的那個**:動公開投影會改欄數與欄位順序,
         --      而**消費端沒有盤過** —— 這一條不需要那句 COMMENT 撐。
      'external_id', pe.external_id,
      'title', pg.title,
      'subtitle', pg.subtitle,
      'handle', pg.handle,
      'availability', pg.availability,
      'price_general', pg.price_general,
      'card_image', pg.card_image,
      'fits', pg.fits,
      'brand_name', pg.brand_name,
      'brand_slug', pg.brand_slug,
      'category_raw', pg.category_raw,
      'fitments', pg.fitments,
      'card_image_trim', CASE WHEN t.url IS NULL THEN NULL ELSE jsonb_build_object(
        'l', t.bbox_left, 't', t.bbox_top, 'w', t.bbox_width, 'h', t.bbox_height,
        'nw', t.natural_width, 'nh', t.natural_height) END
    ),
    pg.total_rows
  FROM paged pg
  LEFT JOIN public.product_image_trim t ON t.url = pg.card_image AND t.status = 'ok'
  -- 🔵 **只在【這一頁】上 join** —— `paged` 已經 LIMIT 過(最多 100 列), 而 join key 是主鍵。
  -- 🔴 用 `LEFT` 不是 `INNER`:兩支 view 都吃 RLS, 正常同進同出;而萬一某一列只在其中一邊,
  --    INNER 會把那張卡**整張弄不見**, LEFT 只讓料號是 null。
  --    ⇒ 📌 **少一個料號 vs 少一張商品卡, 後者嚴重得多。**
  LEFT JOIN public.products_public pe ON pe.id = pg.id
  ORDER BY
    -- #950:🔴 用內層算好的 sort_band / sort_rn, **不要在這裡重算 row_number()**(理由見內層註解)
    -- 🎯 ⟦db-SEARCHFACETMUTEX⟧ 料號完全命中排最前 —— **內外層都要有**, 理由見內層那段。
    CASE WHEN p_sort = 'recommend' AND p_terms IS NOT NULL
         THEN NOT pg.kw_exact END ASC NULLS LAST,
    CASE WHEN p_sort = 'recommend' THEN pg.sort_band END ASC NULLS LAST,
    CASE WHEN p_sort = 'recommend' THEN pg.sort_rn   END ASC NULLS LAST,
    CASE WHEN p_sort = 'recommend' THEN pg.price_general END DESC NULLS LAST,
    CASE WHEN p_sort = 'price-asc' THEN pg.price_general END ASC NULLS LAST,
    CASE WHEN p_sort = 'price-desc' THEN pg.price_general END DESC NULLS LAST,
    CASE WHEN p_sort = 'new' THEN pg.created_at END DESC NULLS LAST,
    pg.id ASC;
END;
$function$;

-- ── 收權斷言(新物件必附;`migration-static-checks.sh` 第③道在數這份清單)──────
-- 🔴 **`DROP` + `CREATE` 之後 ACL 是【重新發】的, 不是留下來的** ⇒ 這一段驗的是
--    上面那四行真的把它發回成 2026-09-09 唯讀量到的那一組。
-- ⚠️ **射程(codex nit 3 收窄)**:下面驗的是【grantee 集合】與【三個角色各有 EXECUTE】,
--    **沒有**驗 grant option 與 grantor ⇒ 說得出「沒有多發給別人、也沒有少發」,
--    說不出「整份 aclitem 逐位元組相同」。
-- 🛑 只驗「PUBLIC 不在」是不夠的 —— 一支【誰都叫不動】的函式也會通過那一句,
--    而症狀是客人一搜尋就 42501。⇒ 三個角色各一格【正對照】。
DO $newobj_guard$
DECLARE
  v_functions text[] := ARRAY[
    'public.storefront_search_product_ids(text[])'
  ]::text[];
  v_fn  text;
  v_acl aclitem[];
BEGIN
  FOREACH v_fn IN ARRAY v_functions LOOP
    SELECT p.proacl INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_fn::regprocedure;
    IF v_acl IS NULL THEN
      RAISE EXCEPTION '收權斷言失敗:% 的 ACL 是 NULL ⇒ REVOKE/GRANT 那四行沒生效', v_fn;
    END IF;
    IF EXISTS (SELECT 1 FROM aclexplode(v_acl) a WHERE a.grantee = 0) THEN
      RAISE EXCEPTION '收權斷言失敗:% 還有 PUBLIC 的授權 ⇒ CREATE 把它發回去了', v_fn;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM aclexplode(v_acl) a JOIN pg_roles r ON r.oid = a.grantee
                    WHERE r.rolname = 'anon' AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言失敗:% 上 anon 沒有 EXECUTE ⇒ 客人一搜尋就 42501', v_fn;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM aclexplode(v_acl) a JOIN pg_roles r ON r.oid = a.grantee
                    WHERE r.rolname = 'authenticated' AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言失敗:% 上 authenticated 沒有 EXECUTE', v_fn;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM aclexplode(v_acl) a JOIN pg_roles r ON r.oid = a.grantee
                    WHERE r.rolname = 'service_role' AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言失敗:% 上 service_role 沒有 EXECUTE ⇒ 我把授權集合安靜收緊了', v_fn;
    END IF;
    -- 🔴🔴 **反向那一半(codex 2026-09-09 nit 3 逼出來的)**:上面四格只證「該在的都在」,
    --   **證不到「不該在的都不在」** ⇒ 一個多發給別人的 grantee 會全部通過。
    --   ⇒ 這一格把 grantee 集合**整組**釘死成 2026-09-09 唯讀量到的那四個。
    IF EXISTS (
      SELECT 1 FROM aclexplode(v_acl) a
       WHERE COALESCE((SELECT r.rolname FROM pg_roles r WHERE r.oid = a.grantee), 'PUBLIC')
             NOT IN ('postgres', 'anon', 'authenticated', 'service_role')
    ) THEN
      RAISE EXCEPTION '收權斷言失敗:% 的 grantee 集合多了東西 ⇒ 我把授權安靜放寬了', v_fn;
    END IF;
  END LOOP;
END
$newobj_guard$;

-- ── 事後閘:三支函式的形狀都要對 ──────────────────────────────────────────
DO $post$
DECLARE
  v_src text;
  v_n   integer;
BEGIN
  -- ① helper 真的多了那一欄
  SELECT pg_get_functiondef(oid) INTO v_src FROM pg_proc
   WHERE oid = 'public.storefront_search_product_ids(text[])'::regprocedure;
  IF position('RETURNS TABLE(id uuid, is_exact boolean)' IN v_src) = 0 THEN
    RAISE EXCEPTION '事後閘①:helper 沒有 is_exact 欄 ⇒ 本片什麼都沒做';
  END IF;
  -- ⚪ 反向:那段 EXISTS 只准剩一份。抄成兩份會漂, 而漂了之後「排最前的那顆」
  --    與「被標成完全命中的那顆」會是不同的商品, 而畫面完全正常。
  v_n := (length(v_src) - length(replace(v_src, 'product_variants_public pv2', '')))
         / length('product_variants_public pv2');
  IF v_n <> 1 THEN
    RAISE EXCEPTION '事後閘①b:helper 裡那段 EXISTS 有 % 份(期望 1)⇒ 它會漂', v_n;
  END IF;

  -- ② 公開那支:內層與外層【都】要有那個排序鍵, 而且**兩個分支都要**
  -- 🔴 **用完整簽章定位, 不用參數名模糊比對**(codex nit 2):
  --    `LIKE '%p_terms%'` 在有多支多載時可能撈到別支, 而它不會叫。
  SELECT pg_get_functiondef(
           'public.search_catalog_by_vehicle(text[],text,text,int,int,int,text,text,text[],int,int,timestamptz,text[])'::regprocedure
         ) INTO v_src;
  -- 🔴 **數次數不是「有沒有」**(codex nit 2):本函式有【兩個分支】,
  --    只接一個分支的實作在 `position(...) <> 0` 底下照樣是綠的。
  v_n := (length(v_src) - length(replace(v_src, 'THEN NOT f.kw_exact END ASC NULLS LAST', '')))
         / length('THEN NOT f.kw_exact END ASC NULLS LAST');
  IF v_n <> 2 THEN
    RAISE EXCEPTION '事後閘②:公開那支【內層】排序鍵有 % 處(期望 2 —— 兩個分支各一)', v_n;
  END IF;
  -- 🔴🔴 **外層那一格是實跑逼出來的, 不是想到的**:只改內層時, 八道靜態閘、
  --    收權斷言、事後閘②全部綠, 而完全命中那顆在拋棄式 PG 上實測排【第 3】。
  --    ⇒ 📌 內層只決定「哪幾列進得了這一頁」, 外層才決定「印出來的順序」。
  v_n := (length(v_src) - length(replace(v_src, 'THEN NOT pg.kw_exact END ASC NULLS LAST', '')))
         / length('THEN NOT pg.kw_exact END ASC NULLS LAST');
  IF v_n <> 2 THEN
    RAISE EXCEPTION '事後閘②b:公開那支【外層】排序鍵有 % 處(期望 2)⇒ 內層改了也不會生效', v_n;
  END IF;
  IF position('kw AS MATERIALIZED' IN v_src) = 0 THEN
    RAISE EXCEPTION '事後閘②c:公開那支沒有 kw CTE';
  END IF;

  -- ③ 經銷那支:同樣四格 + DEFINER/search_path 不准掉
  SELECT pg_get_functiondef(p.oid) INTO v_src FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'search_catalog_by_vehicle_dealer';
  v_n := (length(v_src) - length(replace(v_src, 'THEN NOT f.kw_exact END ASC NULLS LAST', '')))
         / length('THEN NOT f.kw_exact END ASC NULLS LAST')
       + (length(v_src) - length(replace(v_src, 'THEN NOT pg.kw_exact END ASC NULLS LAST', '')))
         / length('THEN NOT pg.kw_exact END ASC NULLS LAST');
  IF v_n <> 4 THEN
    RAISE EXCEPTION '事後閘③:🔴 經銷那支的排序鍵有 % 處(期望 4 = 兩分支 × 內外層)—— 只改一半 = 一般會員與經銷會員的搜尋排序不同, 而兩邊都不會紅', v_n;
  END IF;
  -- 🔴 **直接查目錄欄位, 不比對字串**(codex nit 2):
  --    `position('SET search_path TO ''''')` 在 `search_path TO '', 'other'` 這種
  --    **後面追加了東西**的情況下照樣命中 ⇒ 那把尺對「被放寬」是瞎的。
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'search_catalog_by_vehicle_dealer'
                    AND p.prosecdef
                    -- 🔵 逐字 `search_path=""`(含那兩個雙引號)—— 2026-09-09 在拋棄式 PG
                    --   實查 `proconfig::text` 得到 {"search_path=\\"\\""}。
                    --   ⚠️ 我第一版猜成 `search_path=` ⇒ 事後閘當場擋下整筆交易(rc=3)。
                    --   📌 那正是這道閘該做的事, 而我把它寫進來當證據。
                    AND p.proconfig = ARRAY['search_path=""']) THEN
    RAISE EXCEPTION '事後閘③b:經銷那支的 SECURITY DEFINER 或 search_path="" 掉了(或被追加了別的 schema)';
  END IF;
END
$post$;

COMMIT;
