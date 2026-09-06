-- ⟦search-VARIANTSKU⟧ · codex MF1 那一格的量測(唯讀, 零寫入)
--
-- 🔴 **它在量什麼**:`packages/adapters/src/supabase/SupabaseProductAdapter.ts:872` 逐字
--   `if (ids.length > RPC_ID_CAP) {`(`RPC_ID_CAP = 1000`, `:78`)⇒ 超過就 `return null`
--   ⇒ **整發搜尋退回舊路**, 而舊路**沒有正規化比對、也沒有變體比對**。
--   🎯 ⇒ 本片多帶回來的 id, 有可能把某個詞從 998 推到 1001 ⇒ **原本搜得到的反而不見了。**
--   ✅ 主視窗 2026-09-06 裁「接受降級, 不提高 cap」⇒ 本檔要答的是:**今天離那條線還有多遠。**
--
-- 🛑 **它答不出什麼(三條, 每條都會讓下面的數字被讀太寬)**:
--   1. 🔴 **它【沒有呼叫那支函式】** —— 唯讀身分 `pcm_readonly` 對它沒有 EXECUTE
--      (實測 `ERROR: permission denied for function storefront_search_product_ids`)
--      ⇒ 下面是**把函式的查詢【抄進來】**跑的。抄的是 `20260904180000` 那一代 + 本片的 ④。
--      ⇒ 📌 **「抄的那份」與「函式那份」是兩個東西** —— 抄錯了這裡照樣印得出數字。
--      🔴 **而那件事真的發生過**:第一版的第 ④ 塊抄成了**前綴**, 而出貨的碼是**包含式**
--        ⇒ 整張表**系統性低報**;codex 與 code-reviewer 2026-09-06 同時抓到。**已同形。**
--        ⇒ 🛑 改本檔或改 migration 時, **兩邊要一起改** —— 這一格沒有機制守著。
--   2. 這是**單一時刻**的量測, 而商品數天天在長 ⇒ 今天的餘裕不保證明天還在。
--   3. 詞是**我挑的**幾個, 「哪些詞會逼近 1000」**沒有掃過全集**。
--      🔬 **2026-09-06 19:5x 加了長度閘之後的讀數(可重跑)**:
--        `A1` 924 / `R1` 1540 / `1R` 32 / `M8` 305 / `R6` 601 / `Z1` 241 —— **block4_hits 全部 0**
--        (長度閘擋住兩三字元的詞)⇒ **沒有任何一個詞被本片推過 cap**。
--        而 `R1` 的 1540 是**今天就已經過了**, 與本片無關。
--        🟢 `PET52R` / `AZ203B` 各 block4_hits = 1、added_new = 1 ⇒ 本片要修的那件事有效。
\set ON_ERROR_STOP on
\pset pager off

\echo === 0 量具自陳(數字要帶著它的環境走)===
SELECT now() AS db_now,
       (SELECT count(*) FROM public.products_public)          AS products_visible,
       (SELECT count(*) FROM public.product_variants_public)  AS variants_visible;

\echo === 1 每個詞:現行三塊 vs 加上第 ④ 塊(cap = 1000)===
WITH terms(term) AS (
  VALUES -- 🔴 **短英數詞是 codex 與 code-reviewer 同時抓到的盲區** —— 上一版的詞表裡一個都沒有,
  -- 而「含字母」那個分支沒有長度下限 ⇒ A1 / R6 / M8 過得了三道閘。已加長度閘, 這裡量它有沒有生效。
  ('a'), ('e'), ('o'), ('油'), ('1'), ('0'), ('PET52R'), ('AZ203B'), ('排氣'), ('01022450101'),
  ('A1'), ('R1'), ('1R'), ('M8'), ('R6'), ('Z1')
), t AS (
  SELECT term, '%' || replace(replace(replace(term, '\', '\\'), '%', '\%'), '_', '\_') || '%' AS pat
    FROM terms
), b1 AS (   -- ① 四欄 OR
  SELECT t.term, p.id FROM public.products_public p JOIN t ON (
       p.title ILIKE t.pat OR p.subtitle ILIKE t.pat OR p.description ILIKE t.pat OR p.external_id ILIKE t.pat)
), b2 AS (   -- ② 品牌
  SELECT t.term, p.id FROM public.brands br JOIN t ON br.name ILIKE t.pat
    JOIN public.products_public p ON p.brand_id = br.id
), b3 AS (   -- ③ 母料號正規化前綴
  SELECT t.term, p.id FROM public.products_public p JOIN t ON (
         t.term ~ '[0-9]'
     AND (t.term ~ '[A-Za-z]' OR length(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) >= 7)
     AND upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) <> ''
     AND upper(regexp_replace(p.external_id, '[^A-Za-z0-9]', '', 'g'))
         LIKE upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) || '%')
), b4 AS (   -- ④ 本片新增:變體 sku
  SELECT t.term, pv.product_id AS id FROM public.product_variants_public pv JOIN t ON (
         t.term ~ '[0-9]'
     AND (t.term ~ '[A-Za-z]' OR length(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) >= 7)
     AND upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) <> ''
     AND length(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) >= 4
     AND upper(regexp_replace(pv.sku, '[^A-Za-z0-9]', '', 'g'))
         LIKE '%' || upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) || '%')
), old AS (SELECT term, id FROM b1 UNION SELECT term, id FROM b2 UNION SELECT term, id FROM b3)
SELECT te.term,
       (SELECT count(DISTINCT o.id) FROM old o WHERE o.term = te.term)                    AS ids_now,
       (SELECT count(DISTINCT n.id) FROM b4 n WHERE n.term = te.term)                     AS block4_hits,
       (SELECT count(DISTINCT n.id) FROM b4 n WHERE n.term = te.term
          AND NOT EXISTS (SELECT 1 FROM old o WHERE o.term = te.term AND o.id = n.id))    AS added_new,
       (SELECT count(DISTINCT o.id) FROM old o WHERE o.term = te.term)
     + (SELECT count(DISTINCT n.id) FROM b4 n WHERE n.term = te.term
          AND NOT EXISTS (SELECT 1 FROM old o WHERE o.term = te.term AND o.id = n.id))    AS ids_after,
       CASE WHEN (SELECT count(DISTINCT o.id) FROM old o WHERE o.term = te.term)
               + (SELECT count(DISTINCT n.id) FROM b4 n WHERE n.term = te.term
                    AND NOT EXISTS (SELECT 1 FROM old o WHERE o.term = te.term AND o.id = n.id)) > 1000
            THEN '🔴 跨過 cap' ELSE 'ok' END                                              AS verdict
  FROM terms te ORDER BY 5 DESC;

\echo === 2 🟢 正對照:這把尺會動嗎 —— PET52R 在【現行】應該是 0, 在 ④ 應該 >= 1 ===
\echo -- 🔴 上一版這裡【只有兩行 echo, 沒有任何查詢】—— 標題印在畫面上而失效條件不會紅。
\echo --    (code-reviewer 2026-09-06 抓的;CLAUDE.md Bash 紀律「結果標籤要由結果決定」那一格。)
SELECT 'PET52R' AS term,
  (SELECT count(*) FROM public.products_public p
    WHERE upper(regexp_replace(p.external_id,'[^A-Za-z0-9]','','g')) LIKE 'PET52R%')      AS 現行第三塊,
  (SELECT count(DISTINCT pv.product_id) FROM public.product_variants_public pv
    WHERE upper(regexp_replace(pv.sku,'[^A-Za-z0-9]','','g')) LIKE '%PET52R%')            AS 第四塊;
\echo -- ✅ 期望:現行第三塊 = 0(那就是 Sean 回報的症狀)· 第四塊 >= 1(本片要修的就是它)
\echo -- 🔴 兩邊都 0 ⇒ 我抄的查詢沒接上 ⇒ **上面整張表不算數**, 停下來查。
\echo === 3 🔴 負對照:一個現造的詞, 四塊都必須 0 ===
WITH t AS (SELECT 'ZZQ9999NOTATERM'::text AS term)
SELECT (SELECT count(*) FROM public.products_public p, t
         WHERE upper(regexp_replace(p.external_id, '[^A-Za-z0-9]', '', 'g'))
               LIKE upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) || '%') AS b3_must_be_zero,
       (SELECT count(*) FROM public.product_variants_public pv, t
         WHERE upper(regexp_replace(pv.sku, '[^A-Za-z0-9]', '', 'g'))
               LIKE upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) || '%') AS b4_must_be_zero;
