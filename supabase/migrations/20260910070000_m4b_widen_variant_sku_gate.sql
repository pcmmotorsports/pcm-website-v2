-- 20260910070000_m4b_widen_variant_sku_gate.sql
--
-- 🎯 **讓純字母料號搜得到 —— 363 種料號從搜不到變搜得到, 而噪音只多 1 件。**
--
-- ✅ Sean 2026-09-10 拍【甲】(經主視窗轉達)。他看到的白話逐字:
--    「**客人打 FIRE 會跑出 719 條防爆水管, 所以改成料號要【一模一樣】才算。**」
--    plan:`docs/plans/2026-09-10-widen-variant-sku-gate-plan.md`(**v2**)
--
-- 🔴🔴 **v1 被自己的證據推翻過一次, 寫在這裡免得下一個人再走一遍:**
--    v1 的風險模型是「放寬 ⇒ 某個詞跨過 `RPC_ID_CAP = 1000` ⇒ 整發搜尋退回舊路」。
--    **那個 cap 2026-09-07 就被拿掉了** —— `SupabaseProductAdapter.ts:79` 逐字
--    「⛔ ~~`const RPC_ID_CAP = 1000;`~~ 2026-09-07 拿掉(⟦search-RPC1000FALLBACK⟧)」,
--    `:1112` 那個退回舊路的 `if` 同樣是刪除線。
--    🎯 **而 v1 是從 `20260906900000` 的【註解】讀到那個 cap 的** —— 註解寫於 09-06,
--      隔天碼被拿掉而註解沒跟著改 ⇒ 四手轉述, 中間沒有一個人去看那段碼今天還在不在。
--    🛑 **⇒ 一個假的風險, 佔住了真的風險的位置。** 真的那個(噪音)v1 完全沒看到。
--    ⚠️ `20260906900000` 檔案裡那段舊註解**本片沒有動**(那要另一支 migration)。
--
-- 🔴 **為什麼是【改 SQL 的閘】而不是在 app 層接一條回查** —— 那條路試過而且被判掉了:
--    codex R2 判 FAIL 四條, 其中兩條是設計問題(回查繞過所有 facet · 經銷會員拿到牌價)。
--    🎯 **一條旁路要自己補齊 facet / tier / total / 分頁四件事, 而漏掉是必然的:主路的性質沒有清單。**
--
-- 🔬 **本片改兩處, 而那是機械驗過的**:產生器剝掉註解之後逐行 diff, **只有兩個 hunk**
--    (入口閘 1 行 → 1 行 · 比法 2 行 → 6 行), 第 ④ 塊以外一個字元沒動。
--
-- 🔴🔴 **基底 = 正式庫的 `pg_get_functiondef`(2026-09-10 唯讀撈), 不是任何 migration 檔。**
--    ⚠️ 這支 helper `20260909070000` 才改過(多了 `is_exact` 欄)⇒ 拿 repo 裡任何一支舊
--    migration 當基底都會把那一欄蓋掉, **而三綠全過、功能驗收也全綠**(排序失效不會叫)。
--
-- ⚠️ **延遲:本片有代價, 而它不是「多掃幾次」。**
--    今天純字母詞在計畫期就被證成 false(`One-Time Filter: false`)⇒ 第 ④ 塊**整個不執行**。
-- ```
--    今天 · 純字母 NINJA   One-Time Filter: false     0.035 ms
--    放寬 · 純字母 NINJA   Seq Scan                 126.209 ms
--    放寬 · 相等式 ADLA    Seq Scan                 124.871 ms
--    對照 · 含數字 PET52R  Seq Scan(今天就在掃)     124.576 ms
-- ```
--    🎯 ⇒ **本來一次都不掃的那一族, 現在每次都掃。**
--    🔴 **而「每次」不只一次(codex R2 nit, 他跑了實際的 TS 加模擬 RPC 數的)**:
--      `apps/storefront/src/lib/products.ts:566` 那條路, **尾頁會發 2 次、新品無結果會發 3 次**,
--      每次帶相同的 `p_terms`;而搜尋疊層經 `/api/search` 也呼叫同一支 helper。
--      ⇒ 📌 **125 ms 是【一次】的數字, 不是一個 request 的數字。**
--      ⚠️ 而**逾時沒有實測** ⇒ 不宣稱「整頁多 375 ms」, 也不宣稱它是故障。
--    🟢 **中文詞不受影響**(唯讀驗過 `'煞車' ~ '[A-Za-z]'` = `f`)⇒ 中文搜尋仍是 0.035 ms 那條路。
--    🔵 升級路徑(**不是本片**):相等式吃得到 btree 運算式索引;`pg_trgm` 也已經裝了。
--
-- 🛑 **CREATE OR REPLACE 保留 ACL**:本函式無 `SET` 子句、是 INVOKER ⇒ 沒有 `SET` 被重置的問題
--    (`reference_create-or-replace-resets-set-clause` 那個坑不適用本支, 而我核過了)。
--
-- 🛑 本檔由窗 A 產出、**未 apply**。貼正式庫由主視窗代貼。
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.storefront_search_product_ids(p_terms text[])
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

-- ── 事後閘 ────────────────────────────────────────────────────────────────
-- 🔴🔴 **這一版的閘先【剝註解】, 只比對可執行內容 —— 而那是被咬過才改的。**
--    上一版的四道閘命中的是**我自己寫在碼裡的註解** ⇒ codex 用記憶體內文字突變試:
--    把放寬條件改回舊值 ⇒ **四道全過**;把 `>= 4` 改成註解 ⇒ **全過**。
--    🎯 📌 **一道閘命中自己寫的註解 ⇒ 它永遠綠, 而寫那道閘的人是最不可能發現的** ——
--      他知道那道閘該擋什麼, 所以他讀那個綠的時候讀到的是「擋住了」。
--    ⇒ 🛑 **寫閘的人不能是驗那道閘的人。** 這一版交給 codex 用突變試, 不是我自己讀綠燈。
DO $post$
DECLARE
  v_code text;
  v_n    integer;
BEGIN
  -- 剝註解:整行 `--` 開頭的丟掉(本函式沒有行尾註解與 /* */ 區塊, 下面 ⓪ 守著這個前提)
  SELECT string_agg(ln, E'\n')
    INTO v_code
    FROM (SELECT ln
            FROM regexp_split_to_table(
                   pg_get_functiondef('public.storefront_search_product_ids(text[])'::regprocedure),
                   E'\n') AS ln
           WHERE btrim(ln) !~ '^--') s;

  -- ⓪ 🟢 **剝註解這件事本身要有正對照** —— 剝完之後那些註解裡的字必須【不見了】
  --    否則下面每一道閘都可能是在讀註解, 而它們會全部印綠。
  IF position('4 掉到 3 沒有懸崖' IN v_code) <> 0 THEN
    RAISE EXCEPTION '事後閘⓪:剝註解沒生效(註解裡的字還在)⇒ 下面每一道閘全部不算數';
  END IF;

  -- ⓪b 🔴🔴 **剝註解器【只認整行 `--`】, 而那是一個【前提】不是一個事實** ——
  --    codex R2 must-fix:PG 也不執行 `/* … */`, 而我的剝除器看不見它
  --    ⇒ 有人把條件包進區塊註解, 下面每一道文字閘照樣印綠, 而行為已經壞了。
  --    ✅ 修法不是去支援它, 是**明確拒絕剝除器不支援的形式** —— 本函式今天一個 `/*` 都沒有。
  IF position('/*' IN v_code) <> 0 OR position('*/' IN v_code) <> 0 THEN
    RAISE EXCEPTION '事後閘⓪b:函式裡出現區塊註解 /* */ ⇒ 本檔的剝註解器不支援它, 下面的文字閘全部不算數';
  END IF;
  IF position('storefront_search_product_ids' IN v_code) = 0 THEN
    RAISE EXCEPTION '事後閘⓪:剝過頭了, 連函式名都沒了 ⇒ 尺壞了';
  END IF;

  -- ① 入口閘真的放寬了(比對【碼】)
  IF position('( t.term ~ ''[0-9]'' OR t.term ~ ''[A-Za-z]'' )' IN v_code) = 0 THEN
    RAISE EXCEPTION '事後閘①:放寬那一行不在碼裡 ⇒ 本片什麼都沒做';
  END IF;

  -- ② 🔴 `is_exact` 那一欄不准掉(20260909070000 那一片)
  IF position('RETURNS TABLE(id uuid, is_exact boolean)' IN v_code) = 0 THEN
    RAISE EXCEPTION '事後閘②:is_exact 欄不見了 ⇒ 我用了舊基底, 把 20260909070000 蓋掉了';
  END IF;

  -- ③ 長度閘 >= 4 仍在, 而且【剛好一處】(它守的是包含式那一支的噪音, 見碼裡的新理由)
  v_n := (length(v_code) - length(replace(v_code, 'length(regexp_replace(t.term, ''[^A-Za-z0-9]'', '''', ''g'')) >= 4', '')))
         / length('length(regexp_replace(t.term, ''[^A-Za-z0-9]'', '''', ''g'')) >= 4');
  IF v_n <> 1 THEN
    RAISE EXCEPTION '事後閘③:長度閘 >= 4 在碼裡有 % 處(期望 1)', v_n;
  END IF;

  -- ④ 🔴 **比法必須分兩支** —— 而這一道要同時驗【新的在】與【舊的不在】
  IF position('CASE WHEN t.term ~ ''[0-9]''' IN v_code) = 0 THEN
    RAISE EXCEPTION '事後閘④a:兩支比法的 CASE 不在碼裡 ⇒ 純字母詞會走包含式 ⇒ 打 FIRE 拿到 719 條水管';
  END IF;
  -- ④b 🔴🔴 **純字母那一支必須是【相等式】** —— 這一格是被突變咬出來加的:
  --    第一版的 ④ 只驗「CASE 在不在」, 而突變「把 ELSE 改回包含式」**CASE 還在** ⇒ 閘沒叫,
  --    而行為已經壞了(拋棄式 PG 實測 `FIRE` 從 0 變 2)。
  --    🎯 📌 **一道閘驗的是【外殼】而不是【那一支分支的內容】, 它就對最像的那個錯誤沒有判別力。**
  IF position('ELSE upper(regexp_replace(pv.sku, ''[^A-Za-z0-9]'', '''', ''g''))' IN v_code) = 0
     OR v_code !~ 'ELSE upper\(regexp_replace\(pv\.sku[^\n]*\n\s*=\s+upper' THEN
    RAISE EXCEPTION '事後閘④b:純字母那一支不是相等式 ⇒ 打 FIRE 會拿到一整批不相干的商品';
  END IF;

  -- ④c ⚪ 反向:含數字那一支的包含式【剛好一處】。多一處 = 有人把相等式那支也改成包含式。
  --    🔵 第 ③ 塊用的是前綴式(`LIKE upper(...) || '%'`)⇒ 這把尺撈不到它, 對第 ④ 塊才有判別力。
  v_n := (length(v_code) - length(replace(v_code, 'LIKE ''%'' || upper(regexp_replace(t.term', '')))
         / length('LIKE ''%'' || upper(regexp_replace(t.term');
  IF v_n <> 1 THEN
    RAISE EXCEPTION '事後閘④c:第 ④ 塊的包含式在碼裡有 % 處(期望 1)⇒ 兩支比法被寫成同一支', v_n;
  END IF;
  -- ⑤ 🔴🔴 **行為閘 —— 而它是被 codex R2 逼出來的, 理由要寫在這裡**:
  --    上面每一道都是**文字閘**, 而 codex 給了一個**完全沒有註解**的反例:
  --      `CASE WHEN t.term ~ '[0-9]' AND false` ⇒ 每一道文字閘照樣過, 而 `PET52R` 從 1 變 0。
  --    🎯 📌 **一道閘讀的是【碼長什麼樣】, 它就對【碼做什麼】沒有判別力。**
  --    ⇒ ✅ 所以這一格**真的叫這支函式三次**, 拿正式庫自己的資料當固定樣本。
  --    🛑 **而它有分母**:replay-from-zero 那種空庫裡這三個詞一個都不存在
  --      ⇒ 那時候這三格**沒有判別力**, 而「沉默」不可以印成「通過」⇒ 印 NOTICE 說清楚。
  --    🔴🔴 **分母:三格各自要有【自己的】素材, 而這一條是被正式庫咬出來才寫的。**
  --      ⑤b 的分母不是「有 ADLAU」, 是「庫裡真的有【含 SCTP 而不等於 SCTP】的料號」——
  --      沒有那批料號, `SCTP ⇒ 0` 是白的:包含式與相等式在那個世界回一樣的東西。
  IF EXISTS (SELECT 1 FROM public.product_variants_public pv
              WHERE upper(regexp_replace(pv.sku, '[^A-Za-z0-9]', '', 'g')) = 'ADLAU')
     AND EXISTS (SELECT 1 FROM public.product_variants_public pv
                  WHERE upper(regexp_replace(pv.sku, '[^A-Za-z0-9]', '', 'g')) LIKE '%SCTP%'
                    AND upper(regexp_replace(pv.sku, '[^A-Za-z0-9]', '', 'g')) <> 'SCTP')
     AND EXISTS (SELECT 1 FROM public.product_variants_public pv
                  WHERE upper(regexp_replace(pv.sku, '[^A-Za-z0-9]', '', 'g')) LIKE '%PET52R%')
  THEN
    -- ⑤a 純字母料號:相等式那一支要真的有效。ADLAU 是【第 ①②③ 塊全部撈不到】的那種
    --     (唯讀量過:第 ① 塊 0 命中 · 相等式 1 命中)⇒ 它對本片有判別力。
    --     ⚠️ 不要用 `ADLA` —— 它第 ① 塊就有 2 件, 那一格對「相等式有沒有生效」是鈍的(codex R2 nit)。
    IF (SELECT count(*) FROM public.storefront_search_product_ids(ARRAY['ADLAU'])) < 1 THEN
      RAISE EXCEPTION '行為閘⑤a:ADLAU 搜不到 ⇒ 純字母那一支沒有生效, 本片什麼都沒做';
    END IF;
    -- ⑤b ⚪ 反對照:一個【只在 sku 中間出現】的純字母片段, 相等式下必須 0
    --    🔴🔴 **[2026-09-10 訂正 —— 這一格的第一版用 `FIRE`, 而它在正式庫上【誤報】]**
    --      ⛔ ~~`FIRE` 必須回 0~~ ⇒ 🔬 唯讀量到:`FIRE` 在正式庫回 **19**, 而那 19 件
    --        是**第 ① 塊的 `subtitle` ILIKE** 命中的(title 0 · subtitle 19 · description 0 · external_id 0),
    --        **合法命中, 與第 ④ 塊無關**(第 ④ 塊相等式對 FIRE 是 0, 我改的那一支是對的)。
    --      🎯 **⇒ 我的斷言受詞是「這支函式」, 而我心裡想的是「第 ④ 塊」** —— 兩者不是同一個東西。
    --      🔴 **而我的拋棄式資料照不出它:那裡的假商品 `subtitle` 是空字串**
    --        ⇒ 第 ① 塊永遠不命中 ⇒ 📌 **鑽機【資料太乾淨】而給了一個假的綠燈。**
    --        (今天早上我警告過「鑽機缺東西 ⇒ 假 bug」—— **這是同一個坑的另一面**, 而我只認得一面。)
    --      🔬 **那 19 件的樣本(唯讀撈的, 留著讓下一個人不用重跑就看得懂)**:
    --        `防爆水管 5件組`(HON-1)· `防爆水管 9件組 (HRC水箱改裝)`(HON-37)· `束環套件`(CKHON-27)
    --    🛑🛑 **而這一段存在的理由,是要讓下一個人分得出【訂正】與【降標】** ——
    --      📌 「閘紅了 ⇒ 改閘 ⇒ 過了」在檔案裡與**放水**長得一模一樣。
    --      ✅ **一句話**:⑤b 原本斷言「FIRE 必須 0」, 而**正確答案是 19** ——
    --        那道斷言**問錯了問題**, 它【不是被放寬】。新的 `SCTP` 那一問**比舊的嚴**:
    --        舊的錯誤答案差 19 件, 新的差 **446** 件。
    --      🔵 而改它之前**停下回報過**(主視窗 2026-09-10 批准), 照「想改期望值 ⇒ 停下回報」那條。
    --    ✅ **改用 `SCTP`** —— 2026-09-10 唯讀量的, 它是真的判別式:
    -- ```
    --    詞      ①    ②   ③   包含式   相等式
    --    SCTP     0    0    0    446       0     ✅ 退回包含式 ⇒ 從 0 跳到 446, 牙齒很大
    --    FIRE    19    0    0    727       0     ⛔ ① 有 19 件合法命中 ⇒ 沒有判別力
    -- ```
    --    ⚠️ **這一格的判別力【不在改前改後之間】, 而在【對抗突變】** —— 說清楚免得下一個人誤讀:
    --      `SCTP` 改前也是 0(純字母進不了舊的第 ④ 塊)· 改後也是 0(相等式不命中)
    --      🎯 **它會動的那個世界是「有人把 ELSE 改回包含式」** ⇒ 那時候它從 0 跳到 446。
    --      🔬 拋棄式 PG 實跑過那個突變, 這一格咬住了。
    IF (SELECT count(*) FROM public.storefront_search_product_ids(ARRAY['SCTP'])) <> 0 THEN
      RAISE EXCEPTION '行為閘⑤b:SCTP 撈到東西 ⇒ 純字母那一支走成包含式了(它只出現在 sku 中間, 正式庫實測包含式會回 446 件)';
    END IF;
    -- ⑤c ⚪ 反對照:含數字那一支【不准被相等式吃掉】。真實 sku 是 PET52-PET52R
    IF (SELECT count(*) FROM public.storefront_search_product_ids(ARRAY['PET52R'])) < 1 THEN
      RAISE EXCEPTION '行為閘⑤c:PET52R 搜不到 ⇒ 含數字那一支被改成相等式了, 這是回歸';
    END IF;
  ELSE
    RAISE NOTICE '⚠️ 行為閘⑤ 跳過:這個庫裡缺 ADLAU / 含 SCTP 的料號 / PET52R 其中之一(replay-from-zero 就是這種)⇒ ⑤a⑤b⑤c 今天【沒有判別力】, 不要把這次的綠讀成「行為驗過了」';
  END IF;
END
$post$;

COMMIT;
