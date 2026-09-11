-- 20260911150000-rollback.sql —— 退回 20260911150000_m4b_search_ids_definer_uses_indexes.sql
--
-- 退回之後 = 2026-09-11 以前的狀態:函式 INVOKER、無 SET 子句、讀 *_public view(下架由 RLS 擋)。
-- 慢, 但對;不會漏資料(RLS 重新接手)。
-- 🔴 函式本體 = 20260910070000 那一版逐字(md5 f685752eb0da9aa0e52433b9cc104ab7);事後閘驗這個 md5。
-- 🔴 CREATE OR REPLACE 會把 SET 子句整組換掉 ⇒ 下面不寫 SET = search_path 設定跟著消失(= 正確);
--    SECURITY INVOKER 顯式寫出來, 不靠預設。
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.storefront_search_product_ids(p_terms text[])
 RETURNS TABLE(id uuid, is_exact boolean)
 LANGUAGE sql
 STABLE SECURITY INVOKER
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
         -- 🔴 ⟦db-SEARCHFACETMUTEX⟧ 2026-09-10:放寬 —— **純字母也算料號**。
         --   量到的收益:純字母且正規化 >= 4 碼的料號 410 種, 其中【現行三塊全部撈不到】363 種。
         --   ⚠️ 而放寬的同時比法要換, 見下面那個 CASE —— **兩件事是一組的, 拆開做會出事。**
             ( t.term ~ '[0-9]' OR t.term ~ '[A-Za-z]' )
         AND (
               t.term ~ '[A-Za-z]'
            OR length(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) >= 7
             )
         AND upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) <> ''
         -- 🔴🔴 **最短長度閘 —— 而它 2026-09-10 換了理由, 舊理由【已作廢】, 照實寫:**
         --    ⛔ ~~舊理由:它守的是 `RPC_ID_CAP = 1000` 那個懸崖(過 cap ⇒ 整發退回舊路)~~
         --    🔴 **那個 cap 2026-09-07 就被拿掉了** —— `SupabaseProductAdapter.ts:79` 逐字
         --      「⛔ ~~`const RPC_ID_CAP = 1000;`~~ 2026-09-07 拿掉(⟦search-RPC1000FALLBACK⟧)」,
         --      `:1112` 那個退回舊路的 `if` 同樣是刪除線。⇒ 📌 **懸崖不存在。**
         --    🎯 而那句話是怎麼活下來的, 值得留在這裡:`20260906900000` 的註解寫於 09-06,
         --      09-07 那段碼被拿掉而**註解沒跟著改** ⇒ 09-10 有人讀註解當依據, 四手轉述都沒人去看碼。
         --      ⇒ 🛑 **一句擋人的話, 在障礙消失之後仍然擋著 —— 它擋得越有效, 問題越隱形。**
         --    ⚠️ `20260906900000` 那支檔案裡的舊註解**本片沒有動**(那要另一支 migration)。
         --
         --    🔴🔴 **而我第二個理由也被打掉了, 照實寫(codex R2 nit, 而他對)**:
         --      ⛔ ~~新理由:L=4 最大命中 727 而 L=3 是 3,649 ⇒ 5 倍懸崖~~
         --      🎯 **那把尺量的是【純字母】窗格, 而純字母現在走【相等式】** ——
         --        這道長度閘之後只剩「含數字」那一族會走包含式。**族群不對, 數字搬不過來。**
         --      🔬 **量對族群之後(含數字 且 (含字母 或 >=7 碼), 2026-09-10 唯讀)**:
         -- ```
         --    L=2  最大 3,894 (N0)      L=4  最大 3,606 (PRN0)
         --    L=3  最大 3,607 (RN0)     L=5  最大 3,065     L=6  最大 933
         -- ```
         --      ⇒ 🛑 **4 掉到 3 沒有懸崖 —— 3,607 對 3,606, 是平的。**
         --      🔬 而它實際擋掉的東西量得到(該詞經第 ④ 塊會多拉幾件 / 第 ① 塊本來就有幾件):
         --        `1B` 1,021 / 150 · `A1` 950 / 926 · `N0` 3,894 / 3,851 · `R1` 743 / 1,565
         --        ⇒ 真正新增最多的是 `1B`(約 +871), 而那不是客人會打的詞。
         --    ✅ **⇒ 所以這道閘留著的理由是【它不在本片範圍】, 不是「它守著什麼」。**
         --      🛑 **不要再替它編第三個理由。** 要動它就自己量一次, 而那是另一片。
         --    🔵 而**相等式那一支根本不需要它**(相等式的上界實測 = 1 件)⇒ 對純字母它是多餘的。
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
         -- 🔴🔴 **2026-09-10:比法【分兩支】, 而那不是風格, 是量出來的。**
         --    放寬之後若讓純字母詞也走包含式, 客人打的是英文字而 sku 裡的字母片段是
         --    **供應商的編碼慣例** ⇒ 唯讀實測:
         -- ```
         --    詞      現行三塊   包含式第 ④ 塊   真正新增給客人看見
         --    FIRE        19         727              719   🔴
         --    NINJA      867         727              702   🔴
         --    BLUE         3          31               30
         --    樣本 sku:APR-1-FIRE / HON-24-FIRE / KAW-44-FIRE ⇒ 商品是【防爆水管】
         --    ⇒ 📌 `FIRE` 不是料號, 是字尾慣例。客人打 FIRE 拿到 719 條水管。
         -- ```
         --    ✅ **改成相等式之後**:收益 **363/363 一件沒少**, 而噪音上界從 **727 降到 1**
         --      (全庫掃過:純字母料號用相等式最多拉 1 件 —— ADLAU=1 · ADLB=1 · ADLA=1 …)。
         --    🔬 唯讀跑過整支:`ADLA` ⇒ 1 · `PET52R` ⇒ 1 · `FIRE` ⇒ **0**。
         --    🛑 **含數字那一支【維持包含式】, 不要一起改成相等** ——
         --      真實 sku 是 `PET52-PET52R`, 而 Sean 打的是 `PET52R` ⇒ 相等式會讓它變 0。
         --      🔵 而含數字片段(`PRN0` / `RN014`)沒有人會打 ⇒ 包含式對它們本來就安全。
         AND CASE WHEN t.term ~ '[0-9]'
                  THEN upper(regexp_replace(pv.sku, '[^A-Za-z0-9]', '', 'g'))
                       LIKE '%' || upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) || '%'
                  ELSE upper(regexp_replace(pv.sku, '[^A-Za-z0-9]', '', 'g'))
                        =    upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g'))
             END
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
$function$
;

REVOKE ALL ON FUNCTION public.storefront_search_product_ids(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_search_product_ids(text[]) TO anon, authenticated, service_role;

DROP INDEX IF EXISTS public.product_variants_sku_norm_trgm_idx;
DROP INDEX IF EXISTS public.product_variants_sku_norm_idx;

DO $rb$
BEGIN
  IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = 'public.storefront_search_product_ids(text[])'::regprocedure) <> 'f685752eb0da9aa0e52433b9cc104ab7' THEN
    RAISE EXCEPTION '退回後閘①:函式本體不是 20260910070000 那一版';
  END IF;
  IF (SELECT p.prosecdef OR p.proconfig IS NOT NULL FROM pg_catalog.pg_proc p WHERE p.oid = 'public.storefront_search_product_ids(text[])'::regprocedure) THEN
    RAISE EXCEPTION '退回後閘②:仍是 DEFINER 或仍帶 SET 子句';
  END IF;
  IF to_regclass('public.product_variants_sku_norm_idx') IS NOT NULL
     OR to_regclass('public.product_variants_sku_norm_trgm_idx') IS NOT NULL THEN
    RAISE EXCEPTION '退回後閘③:索引還在';
  END IF;
END
$rb$;

COMMIT;
