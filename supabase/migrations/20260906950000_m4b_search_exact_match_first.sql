-- 🔴🔴 **貼板順序是死的:58(20260906900000)必須先於本片。** 反序 ⇒ 前置閘④會擋。
--
-- M-4b · ⟦search-VARIANTSKUFIRST⟧ 完全命中排最前
--
-- 🔴 **為什麼有這一支**:Sean 2026-09-06 逐字「完全命中的排最前」。
--   線【前台】在 TS 端試了四版都撞牆(PostgREST 寫不出「正規化後相等」的 filter)
--   ⇒ 主視窗裁 **乙′**:**在函式內排序, 對外簽章不變** ⇒ `CREATE OR REPLACE`, 零權限零型別零呼叫端改動。
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🛑 **貼完之後【看不出差別】—— 而那不是壞掉**
-- ══════════════════════════════════════════════════════════════════════════
--   `packages/adapters/src/supabase/SupabaseProductAdapter.ts:578` 逐字
--   `const ordered = [...brandIds].sort();` —— **呼叫端把 RPC 給的順序排掉了**。
--   ✅ front 已經把另一半改成接縫(`02499b9c6`, 今天是 no-op:`.order('id')` ⇒ 照 `pageIds` 重排)
--   ⇒ 🎯 **貼完本片之後, 要等 front 拿掉 `:578` 的 `.sort()` 才會生效。**
--   ⚠️ 而 `.sort()` **在本片貼進去之前不能拿掉** —— 現行 RPC 零 `ORDER BY` ⇒ 列序任意
--     ⇒ 先拿掉會**分頁重複與漏商品**。**兩顆的順序也是死的。**
--
-- 🛑 **它答不出什麼**:
--   · **正式庫的延遲沒有量** —— 那個 `EXISTS` 對結果集每一列各跑一次;
--     主視窗裁:貼完用唯讀 `EXPLAIN (ANALYZE, BUFFERS)` 量一次再關板列。
--   · 拋棄式 PG 的資料是驗證腳本自己造的 ⇒ 它答「排序邏輯對不對」, 答不出「正式庫會怎樣」。
--
-- 🛑 **本體逐字搬自 `20260906900000_m4b_storefront_search_variant_sku.sql`,
--    只在最後那個 `SELECT` 的 `HAVING` 後面加一段 `ORDER BY`。其餘一個位元組沒動。**

BEGIN;

-- ── 前置閘:庫上那一支必須就是我抄的那一代 ──────────────────────────────────
DO $pre$
DECLARE
  v_src text;
  r     record;
BEGIN
  IF to_regclass('public.product_variants_public') IS NULL THEN
    RAISE EXCEPTION '前置閘①:找不到 public.product_variants_public ⇒ 停。';
  END IF;

  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'storefront_search_product_ids'
     AND pg_get_function_identity_arguments(p.oid) = 'p_terms text[]';
  IF v_src IS NULL THEN
    RAISE EXCEPTION '前置閘②:那支函式不存在 ⇒ 停下來查部署態。';
  END IF;

  -- 🔴🔴 **前置閘③:必須先貼 58** —— 本片的排序要看變體 sku, 而那一塊是 58 加的。
  --    這一格就是「貼板順序是死的」那句話的機械形式。
  IF position('product_variants_public' IN v_src) = 0 THEN
    RAISE EXCEPTION '前置閘③:庫上那支【沒有】變體那一塊 ⇒ **貼板 58(20260906900000)還沒貼** ⇒ 先貼它, 不要反序。';
  END IF;

  -- 釘身分:58 貼完之後那一版的 prosrc md5(本 repo 算出來的)
  IF md5(v_src) <> '866c53e2ef071d187bc34061bf1b4816' THEN
    RAISE EXCEPTION '前置閘④:庫上那支的 prosrc md5 是 % ⇒ 不是 58 剛貼完那一版(期望 866c53e2ef071d187bc34061bf1b4816)⇒ 停下來比對。', md5(v_src);
  END IF;

  -- 🔴 已經貼過就不要重貼 —— 判準是【碼裡有沒有那個排序】, 不是版本號在不在帳本上
  IF position('ORDER BY (EXISTS' IN v_src) <> 0 THEN
    RAISE EXCEPTION '前置閘⑤:庫上那支已經有那段 ORDER BY ⇒ **本支已經貼過了** ⇒ 不要重貼。';
  END IF;

  -- 逐欄釘屬性(CREATE OR REPLACE 會把沒寫出來的重設回預設)
  SELECT p.provolatile, p.proparallel, p.procost, p.prorows, p.proleakproof,
         p.proisstrict, p.prosecdef, p.proconfig
    INTO r
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'storefront_search_product_ids'
     AND pg_get_function_identity_arguments(p.oid) = 'p_terms text[]';
  IF r.provolatile <> 's' OR r.proparallel <> 'u' OR r.procost <> 100 OR r.prorows <> 1000
     OR r.proleakproof OR r.proisstrict OR r.prosecdef OR r.proconfig IS NOT NULL THEN
    RAISE EXCEPTION '前置閘⑥:函式屬性不符(volatile=% parallel=% cost=% rows=% leakproof=% strict=% secdef=% config=%)⇒ 有人動過它 ⇒ 停。',
      r.provolatile, r.proparallel, r.procost, r.prorows, r.proleakproof, r.proisstrict, r.prosecdef, r.proconfig;
  END IF;
END
$pre$;

-- ── 本體(逐字搬 + 一段 ORDER BY)────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.storefront_search_product_ids(p_terms text[])
RETURNS TABLE (id uuid)
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
  SELECT h.id
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
   ORDER BY (EXISTS (
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
            )) DESC,
            h.id;
$function$;

-- ── 事後閘 ────────────────────────────────────────────────────────────────
DO $post$
DECLARE
  v_src text;
  r     record;
  i     integer;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'storefront_search_product_ids'
     AND pg_get_function_identity_arguments(p.oid) = 'p_terms text[]';
  IF v_src IS NULL THEN
    RAISE EXCEPTION '事後閘①:REPLACE 完之後找不到它 ⇒ 停。';
  END IF;

  -- 🔴 剝掉兩種註解再問(前置閘與事後閘要用同一把尺 —— 2026-09-06 code-reviewer 抓過同型)
  -- 🔴🔴 **而 PostgreSQL 的區塊註解可以【巢狀】** —— 單發 `regexp_replace` 剝不乾淨
  --   ⇒ codex 2026-09-06 的反例:`/* outer /* inner */ )) DESC h.id; */`
  --     剝完會留下一段**假的排序字面**, 而下面那幾格就對著它印綠。
  --   ✅ 由內而外反覆剝, 而**剝不完就 fail-closed** —— 不是「剝到一半算了」。
  v_src := regexp_replace(v_src, '--[^' || chr(10) || ']*', '', 'g');
  FOR i IN 1..20 LOOP
    EXIT WHEN position('/*' IN v_src) = 0;
    v_src := regexp_replace(v_src, '/\*[^/*]*\*/', '', 'g');
  END LOOP;
  IF position('/*' IN v_src) <> 0 THEN
    RAISE EXCEPTION '事後閘①b:區塊註解剝了 20 輪還剝不完 ⇒ 下面每一格都會對著沒剝乾淨的文字判 ⇒ 停(這不是通過)。';
  END IF;

  IF position('ORDER BY (EXISTS' IN v_src) = 0 THEN
    RAISE EXCEPTION '事後閘②:新版沒有那段 ORDER BY ⇒ 本片什麼都沒做。';
  END IF;
  -- 🔴🔴 **③ 與 ③b 要分開問, 而理由是量到的**:
  --   我第一版把兩件事寫成一個 `position(')) DESC,')` ⇒ 把 `DESC` 改成 `ASC` 的那一發突變
  --   紅了, **而它印的是「排序只剩一個鍵」** —— 那是**對的紅、錯的理由**。
  --   ⇒ 📌 **一個指向錯地方的紅, 會把下一個人送去修一個沒壞的東西。**
  IF position(')) DESC' IN v_src) = 0 THEN
    RAISE EXCEPTION '事後閘③:完全命中那個條件不是 DESC ⇒ 排序方向反了(完全命中會排到【最後】)⇒ 停。';
  END IF;
  -- 🔴 **第二排序鍵不能不見** —— 少了它, 同一組之間仍由 planner 決定 ⇒ 分頁會重複與漏。
  IF position('h.id;' IN v_src) = 0 THEN
    RAISE EXCEPTION '事後閘③b:排序只剩一個鍵(找不到第二鍵 h.id)⇒ 同一組之間仍不穩定 ⇒ 分頁會重複與漏商品 ⇒ 停。';
  END IF;
  -- 🔴🔴 **④ 要分得出「排序讀了變體」與「搜尋還留著變體那一塊」**(codex 2026-09-06 must-fix):
  --   本片的 `ORDER BY` 自己也提到 `product_variants_public`(別名 `pv2`)
  --   ⇒ 把 `hits` 裡的第 ④ 塊**整個刪掉**之後, `position('product_variants_public')` **照樣命中**
  --   ⇒ 📌 那一格會印綠, 而**只靠變體才找得到的商品已經不見了**。
  --   ✅ 分開問:`hits` 那一塊的別名是 `pv`(`FROM public.product_variants_public pv`),
  --     排序那一段用的是 `pv2` ⇒ **兩個都要在**。
  -- 🔴🔴 **不能用 `position('… pv')` 判「hits 那一塊在不在」** —— `pv` 是 `pv2` 的**前綴**
  --   ⇒ 把 hits 那一塊整個刪掉之後, 排序裡的 `pv2` 會讓那個 position **照樣命中**。
  --   🔬 2026-09-06 實測:那一發突變(刪掉 hits 第④塊)**沒有被這道閘擋下**, 是驗證腳本的格 B2 抓到的。
  --   ✅ 改成**數次數**:總數要 >= 2, 而 `pv2` 恰 1 ⇒ 兩邊各有一個。
  DECLARE
    v_all integer;
    v_pv2 integer;
  BEGIN
    v_all := (length(v_src) - length(replace(v_src, 'public.product_variants_public', '')))
             / length('public.product_variants_public');
    v_pv2 := (length(v_src) - length(replace(v_src, 'public.product_variants_public pv2', '')))
             / length('public.product_variants_public pv2');
    IF v_pv2 <> 1 THEN
      RAISE EXCEPTION '事後閘④b:排序裡的變體分支(別名 pv2)出現 % 次(期望 1)⇒ 變體完全命中不會排前面 ⇒ 停。', v_pv2;
    END IF;
    IF v_all - v_pv2 < 1 THEN
      RAISE EXCEPTION '事後閘④a:`hits` 裡的變體那一塊不見了(product_variants_public 共 % 次, 其中 pv2 佔 % 次)⇒ 只靠變體找得到的商品會消失 ⇒ 停。', v_all, v_pv2;
    END IF;
  END;
  IF position('regexp_replace(p.external_id' IN v_src) = 0
     OR position('bh.brand_id' IN v_src) = 0
     OR position('n.want > 0' IN v_src) = 0
     OR position('count(DISTINCT h.ord)' IN v_src) = 0 THEN
    RAISE EXCEPTION '事後閘④c:原本的塊或守門少了一個 ⇒ 我把別人的東西弄掉了 ⇒ 停。';
  END IF;

  SELECT p.prosecdef, p.proconfig, p.provolatile, p.proparallel, p.procost, p.prorows
    INTO r
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'storefront_search_product_ids'
     AND pg_get_function_identity_arguments(p.oid) = 'p_terms text[]';
  IF r.prosecdef OR r.proconfig IS NOT NULL
     OR r.provolatile <> 's' OR r.proparallel <> 'u' OR r.procost <> 100 OR r.prorows <> 1000 THEN
    RAISE EXCEPTION '事後閘⑤:REPLACE 把屬性改掉了 ⇒ 停。';
  END IF;
END
$post$;

COMMIT;
