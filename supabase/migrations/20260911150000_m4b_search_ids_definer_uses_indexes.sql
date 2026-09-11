-- 20260911150000_m4b_search_ids_definer_uses_indexes.sql
--
-- 🎯 **讓客人(anon)的關鍵字搜尋用得到索引 —— 函式改 SECURITY DEFINER, 下架商品由函式自己擋。**
--
-- ✅ Sean 2026-09-11 拍甲(主視窗轉述白話題:「甲 = 要。搜尋自己擋下架商品, 就用得到索引」)。
--    plan:`docs/plans/2026-09-11-search-definer-plan.md`(v3;鐵則 8 已批)。
--
-- 🔴🔴 **為什麼要動權限(一句)**:客人走 `anon`, 要守 RLS;而搜尋條件(ILIKE / LIKE / upper / regexp_replace)
--    全部不是 leakproof ⇒ RLS 之下【一支索引都用不上】, 每個詞把 products 整張掃。
--    拋棄式 PG 照正式庫 policy 逐字重建、`SET ROLE anon` 實測(假資料, 毫秒只看比例):
-- ```
--    詞            舊版(anon)  本檔(anon)   結果集
--    DBK SPECIAL     148.1 ms     23.6 ms     逐列相同
--    PET52R          125.7        22.5        逐列相同
--    FIRE            108.2         0.75       逐列相同
--    APR-1-FIRE      186.0        35.4        逐列相同
--    排氣管            31.6        39.8        逐列相同(中文慢 8 ms, trigram 選擇性差)
-- ```
--    ⚠️ 之前量到的「0.25~0.66 秒」是 `pcm_readonly`(rolbypassrls = t)的數字, **不是客人的**。
--
-- 🔬 **本檔改三件事, 其餘逐字不動**(剝註解後與 plan §1 量過的 v3 逐行相同, 2026-09-11 比對過):
--    ① `STABLE SECURITY DEFINER` + `SET search_path TO ''`(house 規則, `definer-search-path-gate.py`)
--    ② 讀底表 `products` / `product_variants`, 並照 policy 原文在函式內自己擋下架(7 處):
--         products_select_public          USING (delisted_at IS NULL)
--         product_variants_select_public  USING (EXISTS (SELECT 1 FROM products p
--                                                 WHERE p.id = product_variants.product_id AND p.delisted_at IS NULL))
--         brands_select_public            USING (true)  ⇒ 不加
--    ③ 第 ④ 塊的 `CASE WHEN … LIKE … ELSE … = … END` 拆成兩個 UNION ALL + 兩支運算式索引(CASE 讓索引用不到)
--
-- 🔴🔴 **基底 = 正式庫 `prosrc`, md5 `f685752eb0da9aa0e52433b9cc104ab7`(2026-09-11 唯讀讀的)** ——
--    與 repo `20260910070000` 的函式本體逐字相同(同一個 md5)。前置閘①釘住它:不符就停, 不蓋掉別人改過的版本。
--
-- 🛑 **權限(docs/patterns/revoking-function-execute-in-supabase.md §1 / §3.5)**:
--    · owner 維持 `postgres`(rolsuper = f · rolbypassrls = t)⇒ DEFINER 以它執行 = 不受 RLS 管 ⇒ 過濾全靠 ②。
--    · REVOKE FROM PUBLIC, anon, authenticated 兩道都下, 再具名 GRANT 回 anon / authenticated / service_role
--      —— 與正式庫現行 EXECUTE 名單相同;anon 必須留(它就是客人的搜尋)。
--    · 回傳型別不變 `(id uuid, is_exact boolean)`。比對用到的欄位除了一個之外本來就在 `*_public` view 對 anon 公開;
--      🔴 **例外是 `products.delisted_at`**(`products_public` 刻意不放它)—— 本檔只拿它當 WHERE 過濾、不進回傳(Fable R1 N1 訂正)。
--    · ⚠️ service_role 行為會變:它今天經 RLS 看得到下架商品, 本檔之後一律看不到(repo 內 admin 零呼叫)。
--
-- 🔵 **CREATE OR REPLACE 保留 ACL 與 owner**;本檔仍顯式 REVOKE/GRANT 一次, 讓 ACL 形狀由本檔決定而不是由歷史決定。
--    🔴 `reference_create-or-replace-resets-set-clause`:CREATE OR REPLACE 會把 SET 子句整組換掉 ⇒ 本檔寫的就是完整的那一組。
-- 🔵 建索引:`product_variants` 約 6 萬列, `CREATE INDEX`(非 CONCURRENTLY, 在交易裡)會短暫擋寫入;`lock_timeout 5s` 拿不到就整包放棄。
--
-- 🛑 本檔由窗 A 產出、**未 apply**。貼正式庫由主視窗要編號授權。rollback:`supabase/rollbacks/20260911150000-rollback.sql`。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── 前置閘 ──────────────────────────────────────────────────────────────────
DO $pre$
DECLARE
  v_src  text;
  v_def  boolean;
BEGIN
  IF to_regprocedure('public.storefront_search_product_ids(text[])') IS NULL THEN
    RAISE EXCEPTION '前置閘⓪:public.storefront_search_product_ids(text[]) 不存在 ⇒ 停';
  END IF;
  SELECT p.prosrc, p.prosecdef INTO v_src, v_def
    FROM pg_catalog.pg_proc p WHERE p.oid = 'public.storefront_search_product_ids(text[])'::regprocedure;
  -- ① 基底必須是 2026-09-11 唯讀讀到的那一版(= 20260910070000)
  IF md5(v_src) <> 'f685752eb0da9aa0e52433b9cc104ab7' THEN
    RAISE EXCEPTION '前置閘①:正式庫的函式本體 md5 = % , 不是本檔抄的那一版 ⇒ 有人改過它 ⇒ 停(先重抄基底)', md5(v_src);
  END IF;
  -- ② 還沒是 DEFINER(是的話代表本檔或類似的已經貼過)
  IF v_def THEN
    RAISE EXCEPTION '前置閘②:它已經是 SECURITY DEFINER ⇒ 停, 先查是誰貼的';
  END IF;
  -- ③ 兩支索引名還沒被佔用
  IF to_regclass('public.product_variants_sku_norm_idx') IS NOT NULL
     OR to_regclass('public.product_variants_sku_norm_trgm_idx') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘③:索引名已存在 ⇒ 停, 先查它是不是同一個運算式';
  END IF;
  -- ④ owner 是 postgres 且它繞得過 RLS(DEFINER 的前提;不成立 ⇒ 改了等於沒改)
  IF (SELECT pg_catalog.pg_get_userbyid(p.proowner) FROM pg_catalog.pg_proc p WHERE p.oid = 'public.storefront_search_product_ids(text[])'::regprocedure) <> 'postgres'
     OR NOT (SELECT r.rolbypassrls FROM pg_catalog.pg_roles r WHERE r.rolname = 'postgres') THEN
    RAISE EXCEPTION '前置閘④:owner 不是 postgres 或 postgres 不是 BYPASSRLS ⇒ DEFINER 版在這個庫沒有效果 ⇒ 停';
  END IF;
END
$pre$;

-- ── 索引:運算式必須與函式體裡【逐字】相同, planner 才認得 ──────────────────
CREATE INDEX product_variants_sku_norm_idx
  ON public.product_variants ((upper(regexp_replace(sku, '[^A-Za-z0-9]', '', 'g'))));
CREATE INDEX product_variants_sku_norm_trgm_idx
  ON public.product_variants USING gin ((upper(regexp_replace(sku, '[^A-Za-z0-9]', '', 'g'))) extensions.gin_trgm_ops);

-- ── 函式 ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.storefront_search_product_ids(p_terms text[])
 RETURNS TABLE(id uuid, is_exact boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
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
      FROM public.products p
      JOIN t ON (
           p.title       ILIKE t.pat
        OR p.subtitle    ILIKE t.pat
        OR p.description ILIKE t.pat
        OR p.external_id ILIKE t.pat
      )
     -- 🔴 2026-09-11 DEFINER:照 `products_select_public` 原文 `USING (delisted_at IS NULL)` 自己擋下架
     WHERE p.delisted_at IS NULL
    UNION ALL
    -- ② 品牌
    SELECT p.id, bh.ord
      FROM public.products p
      JOIN bh ON p.brand_id = bh.brand_id
     -- 🔴 2026-09-11 DEFINER:照 `products_select_public` 原文 `USING (delisted_at IS NULL)` 自己擋下架
     WHERE p.delisted_at IS NULL
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
      FROM public.products p
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
     -- 🔴 2026-09-11 DEFINER:照 `products_select_public` 原文 `USING (delisted_at IS NULL)` 自己擋下架
     WHERE p.delisted_at IS NULL
    UNION ALL
    -- ── ④ ⟦search-VARIANTSKU⟧ 變體料號:形狀【逐字鏡射第 ③ 塊】────────────────
    -- 🔴 **為什麼鏡射而不是寫 `ILIKE '%sku%'`**:第 ③ 塊那三個條件是付過學費的
    --    (詞正規化後是空字串 ⇒ `LIKE '%'` ⇒ 命中每一列, 而 HTTP 200、畫面完全正常)。
    --    ⚠️ **而那段註解自己已經過期一半**(codex 2026-09-06 N3):現行還有數字閘在,
    --    單獨移除「正規化非空」那一條**不會**再讓中文變成全表命中 —— 防護保留, 理由訂正。
    -- 🔵 吐的是 `pv.product_id`, 不是變體 id ⇒ UNION ALL 仍在【(商品, 詞)】那一層。
    --    一個商品有多個變體 ⇒ 同一對 `(id, ord)` 會來很多次, 而外層 `count(DISTINCT h.ord)`
    --    只數**不同的詞**, 重複不影響(codex 2026-09-06 逐條驗過這一題)。
    -- ⛔ ~~**走 `product_variants_public` 而不是 `product_variants`** —— 那支 view 是~~
    -- ⛔ ~~`security_invoker = true`, 而本函式是 INVOKER ⇒ 下架母商品的變體由 RLS 擋掉。~~
    -- 🔴🔴 **[2026-09-11 本函式改 SECURITY DEFINER —— 上面那句的前提不在了]**
    --    INVOKER + RLS 之下, 搜尋條件(ILIKE / LIKE / upper / regexp_replace)全部不是 leakproof
    --    ⇒ 【一支索引都用不上】, 客人每個詞整張掃(plan `docs/plans/2026-09-11-search-definer-plan.md` §1)。
    --    ⇒ 改讀底表 `product_variants`, 下架母商品的變體由本函式【自己】照 policy 原文擋(下面每一支的 WHERE)。
    --    ✅ **零價變體【刻意不擋】** —— Sean 2026-09-06 拍甲, 逐字「甲=沒價格的也讓客人搜到」。
    --    ⇒ 📌 這是**拍板**, 不是「還沒做」。下一個人想加 `price_general > 0` 之前, 先去問 Sean。
    SELECT pv.product_id AS id, t.ord
      FROM public.product_variants pv
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
         -- 🔴 2026-09-11:原本這裡是一個 `CASE WHEN t.term ~ '[0-9]' THEN … LIKE '%…%' ELSE … = … END`,
         --   而 CASE 讓索引用不到 ⇒ 拆成兩個 UNION ALL 分支, 判斷條件逐字不變:
         --   這一支只收【含數字】的詞(包含式, 吃 `product_variants_sku_norm_trgm_idx`),
         --   下面那一支只收【不含數字】的詞(相等式, 吃 `product_variants_sku_norm_idx`)。
         --   🛑 兩支的前四道閘必須逐字相同 —— 改一支就要改另一支。
         AND t.term ~ '[0-9]'
         AND upper(regexp_replace(pv.sku, '[^A-Za-z0-9]', '', 'g'))
             LIKE '%' || upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) || '%'
      )
     -- 🔴 2026-09-11 DEFINER:照 `product_variants_select_public` 原文自己擋「母商品已下架」的變體
     WHERE EXISTS (SELECT 1 FROM public.products p WHERE p.id = pv.product_id AND p.delisted_at IS NULL)
    UNION ALL
    -- ── ④b 同一塊的純字母那一支(2026-09-11 從上面的 CASE 拆出來;理由同上)────────
    SELECT pv.product_id AS id, t.ord
      FROM public.product_variants pv
      JOIN t ON (
             ( t.term ~ '[0-9]' OR t.term ~ '[A-Za-z]' )
         AND (
               t.term ~ '[A-Za-z]'
            OR length(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) >= 7
             )
         AND upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) <> ''
         AND length(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) >= 4
         AND t.term !~ '[0-9]'
         AND upper(regexp_replace(pv.sku, '[^A-Za-z0-9]', '', 'g'))
             =    upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g'))
      )
     -- 🔴 2026-09-11 DEFINER:照 `product_variants_select_public` 原文自己擋「母商品已下架」的變體
     WHERE EXISTS (SELECT 1 FROM public.products p WHERE p.id = pv.product_id AND p.delisted_at IS NULL)
  )
  -- 🎯 ⟦db-SEARCHFACETMUTEX⟧ 2026-09-09:把「完全命中」從【只能排序】變成【看得見的欄位】。
  --   🔴 **原封用下面 ORDER BY 那一段的同一個運算式** —— 抄成兩份會漂,
  --     而漂了之後「排最前的那顆」與「被標成完全命中的那顆」會是不同的商品。
  --   ⇒ 所以下面的 ORDER BY 改成引用這個別名, 而不是再寫一次。
  SELECT h.id, EXISTS (
              SELECT 1 FROM t
               WHERE upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) <> ''
                 AND ( EXISTS (SELECT 1 FROM public.products p2
                                WHERE p2.id = h.id AND p2.delisted_at IS NULL
                                  AND upper(regexp_replace(p2.external_id, '[^A-Za-z0-9]', '', 'g'))
                                      = upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')))
                    OR EXISTS (SELECT 1 FROM public.product_variants pv2
                                WHERE pv2.product_id = h.id
                                  AND EXISTS (SELECT 1 FROM public.products p WHERE p.id = pv2.product_id AND p.delisted_at IS NULL)
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

-- ── 權限:兩道 REVOKE 都下, 再具名 GRANT(名單 = 正式庫現行)────────────────
-- ACL-GATE-EXEMPT: public.storefront_search_product_ids --REVOKE PUBLIC/anon/authenticated 後具名還原, 授權集合與正式庫現行 proacl 相同 anon/authenticated/service_role(2026-09-11 唯讀讀到 has_function_privilege 三者皆 t);anon 必須留, 它就是客人的搜尋
REVOKE ALL ON FUNCTION public.storefront_search_product_ids(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_search_product_ids(text[]) TO anon, authenticated, service_role;

-- ── 事後閘 ──────────────────────────────────────────────────────────────────
DO $post$
DECLARE
  v_code text;
  v_n    integer;
  r      record;
BEGIN
  -- ① 屬性:DEFINER + search_path = '' + 回傳型別不變
  IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = 'public.storefront_search_product_ids(text[])'::regprocedure) THEN
    RAISE EXCEPTION '事後閘①a:不是 SECURITY DEFINER';
  END IF;
  IF (SELECT p.proconfig FROM pg_catalog.pg_proc p WHERE p.oid = 'public.storefront_search_product_ids(text[])'::regprocedure) IS DISTINCT FROM ARRAY['search_path=""'] THEN
    RAISE EXCEPTION '事後閘①b:search_path 不是空字串(或被追加了別的設定)';
  END IF;
  IF pg_catalog.pg_get_function_result('public.storefront_search_product_ids(text[])'::regprocedure) <> 'TABLE(id uuid, is_exact boolean)' THEN
    RAISE EXCEPTION '事後閘①c:回傳型別變了 ⇒ DEFINER 函式多吐欄位 = 可能漏資料';
  END IF;

  -- ② 剝註解後的碼(只認整行 `--`;區塊註解明確拒絕, 同 20260910070000 的 ⓪b)
  SELECT string_agg(ln, E'\n') INTO v_code
    FROM (SELECT ln FROM regexp_split_to_table(
            pg_catalog.pg_get_functiondef('public.storefront_search_product_ids(text[])'::regprocedure), E'\n') AS ln
           WHERE btrim(ln) !~ '^--') s;
  IF position('/*' IN v_code) <> 0 OR position('*/' IN v_code) <> 0 THEN
    RAISE EXCEPTION '事後閘②a:函式裡出現區塊註解 ⇒ 剝註解器不支援, 下面的文字閘不算數';
  END IF;
  IF position('前提不在了' IN v_code) <> 0 THEN
    RAISE EXCEPTION '事後閘②b:剝註解沒生效(註解裡的字還在)⇒ 下面的文字閘不算數';
  END IF;
  -- 不得再經過 security_invoker 的 view(否則 DEFINER 的意義只剩一半)
  IF position('products_public' IN v_code) <> 0 OR position('product_variants_public' IN v_code) <> 0 THEN
    RAISE EXCEPTION '事後閘②c:碼裡還有 *_public view';
  END IF;
  -- 7 處下架過濾(① ② ③ · ④ 兩支 · is_exact 兩個子查詢)
  v_n := (length(v_code) - length(replace(v_code, 'delisted_at IS NULL', ''))) / length('delisted_at IS NULL');
  IF v_n <> 7 THEN
    RAISE EXCEPTION '事後閘②d:下架過濾在碼裡有 % 處(期望 7)', v_n;
  END IF;
  -- 不得碰 anon 讀不到的欄位
  IF v_code ~* '(price_store|price_by_tier|metadata)' THEN
    RAISE EXCEPTION '事後閘②e:DEFINER 函式碰到 price_store / price_by_tier / metadata ⇒ 可能漏經銷價或內部欄位';
  END IF;
  IF position('CASE WHEN t.term' IN v_code) <> 0 THEN
    RAISE EXCEPTION '事後閘②f:第 ④ 塊的 CASE 還在 ⇒ 變體料號索引用不到';
  END IF;

  -- ③ ACL:枚舉每一個持 EXECUTE 的 grantee, 只准 postgres / anon / authenticated / service_role;PUBLIC(grantee 0)不准
  FOR r IN
    SELECT a.grantee, CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END AS who
      FROM pg_catalog.pg_proc p, LATERAL pg_catalog.aclexplode(p.proacl) a
     WHERE p.oid = 'public.storefront_search_product_ids(text[])'::regprocedure AND a.privilege_type = 'EXECUTE'
  LOOP
    IF r.who NOT IN ('postgres', 'anon', 'authenticated', 'service_role') THEN
      RAISE EXCEPTION '事後閘③a:% 持有 EXECUTE ⇒ 名單外', r.who;
    END IF;
  END LOOP;
  IF (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = 'public.storefront_search_product_ids(text[])'::regprocedure) IS NULL THEN
    RAISE EXCEPTION '事後閘③b:proacl 是 NULL ⇒ 等於 PUBLIC 可執行(pattern §3.6)';
  END IF;
  IF NOT (has_function_privilege('anon', 'public.storefront_search_product_ids(text[])', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.storefront_search_product_ids(text[])', 'EXECUTE')
          AND has_function_privilege('service_role', 'public.storefront_search_product_ids(text[])', 'EXECUTE')) THEN
    RAISE EXCEPTION '事後閘③c:三個具名角色有人拿不到 EXECUTE ⇒ 客人搜尋會壞';
  END IF;

  -- ④ 行為閘:下架商品搜不到, 而同形狀的上架商品搜得到(正對照)。
  --    🛑 有分母:庫裡沒有「帶字母+數字料號的下架商品」時沒有判別力 ⇒ 印 NOTICE, 不把沉默印成通過。
  SELECT p.id, p.external_id INTO r FROM public.products p
   WHERE p.delisted_at IS NOT NULL AND p.external_id ~ '[A-Za-z]' AND p.external_id ~ '[0-9]'
     AND length(regexp_replace(p.external_id, '[^A-Za-z0-9]', '', 'g')) >= 4
   ORDER BY p.id LIMIT 1;
  IF FOUND THEN
    IF EXISTS (SELECT 1 FROM public.storefront_search_product_ids(ARRAY[r.external_id]) s WHERE s.id = r.id) THEN
      RAISE EXCEPTION '行為閘④a:下架商品 % 被搜到了 ⇒ DEFINER 在漏下架品', r.external_id;
    END IF;
  ELSE
    RAISE NOTICE '⚠️ 行為閘④a 跳過:這個庫沒有帶字母+數字料號的下架商品 ⇒ 下架過濾今天【沒有】被行為驗到';
  END IF;
  SELECT p.id, p.external_id INTO r FROM public.products p
   WHERE p.delisted_at IS NULL AND p.external_id ~ '[A-Za-z]' AND p.external_id ~ '[0-9]'
     AND length(regexp_replace(p.external_id, '[^A-Za-z0-9]', '', 'g')) >= 4
   ORDER BY p.id LIMIT 1;
  IF FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.storefront_search_product_ids(ARRAY[r.external_id]) s WHERE s.id = r.id) THEN
      RAISE EXCEPTION '行為閘④b:上架商品 % 用自己的料號搜不到 ⇒ 函式壞了(不是變嚴)', r.external_id;
    END IF;
  ELSE
    RAISE NOTICE '⚠️ 行為閘④b 跳過:這個庫沒有帶字母+數字料號的上架商品';
  END IF;
END
$post$;

COMMIT;
