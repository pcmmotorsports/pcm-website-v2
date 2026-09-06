-- M-4b · ⟦search-VARIANTSKU⟧ 讓【變體料號】搜得到
--
-- 🔴 **為什麼有這一支**:Sean 2026-09-06 18:3x 在正式站搜 `PET52R` / `AZ203B` 找不到。
--   根因(線【前台】查到、本線複驗):`storefront_search_product_ids` 搜的是
--   `brands.name` + `products_public` 的 title/subtitle/description/external_id,
--   而**變體料號住在 `product_variants.sku`**(`20260531142533:39`), 不在任何被搜的欄。
--
-- 🛑 **本體逐字搬自 `20260904180000_m4b_storefront_search_partno_long_numeric.sql:215`,
--    只在 `hits` 裡多插一塊 ④。其餘每一行(含註解)一個位元組沒動** ——
--    那些註解裡住著前面四代的拍板紀錄, 而「順手整理一下」在 diff 上與「搬移」長得一樣。
--
-- ── 🔴🔴 這一片最該先讀的一格:它可能讓【原本搜得到的東西消失】────────────────
--   `packages/adapters/src/supabase/SupabaseProductAdapter.ts:872` 逐字
--   `if (ids.length > RPC_ID_CAP) {`(`RPC_ID_CAP = 1000`, `:78`)
--   ⇒ 超過就 `return null` ⇒ **整發搜尋退回舊路**, 而舊路**沒有正規化比對、也沒有變體比對**。
--   🎯 反例:某詞原本命中 998 件, 其中幾件**只靠正規化**找到;本片多帶回 3 件 ⇒ 1001 > 1000
--      ⇒ 退回舊路 ⇒ **那幾件反而不見了。**
--   📌 **一個「讓更多東西搜得到」的改動, 可以讓原本搜得到的東西消失** —— 而它在 SQL 層看不出來。
--   ✅ **主視窗 2026-09-06 裁:接受降級, 不提高 cap**(cap 是 `:73` 那條「拿回來超過 cap 就知道被截了」
--      的設計, 動它會破壞那個判別)⇒ **改成板列記著**, 而本片附一格端到端的 1000→1001 演練。
--
-- ── 🛑 它答不出什麼 ─────────────────────────────────────────────────────────
--   · sku 上**沒有可用的前綴索引**(2026-09-06 正式庫唯讀親查:`product_variants` 6 支索引,
--     sku 只在 `UNIQUE (supplier_slug, sku)` 的第二欄)⇒ **預期是全表掃**(59,841 列);
--     而「實際計畫」要 EXPLAIN 才算數(codex N1:無合格詞可能根本不掃)。
--   · 🔴 **加運算式索引【解不了】** —— pattern 是每列算出來的, planner 用不到
--     (那支既有索引的 `COMMENT ON INDEX` 自己寫過, 鑽機實測 `enable_seqscan=off` 仍 Seq Scan)
--     ⇒ 真正的修法是**把 pattern 變成常數**, 那是函式重寫 ⇒ 板列 `⟦search-PATTERNCONSTIDX⟧`。
--   · 零價變體**沒有濾** —— ✅ **Sean 2026-09-06 拍甲, 逐字「甲=沒價格的也讓客人搜到」** ⇒ 這是定案不是缺口。

BEGIN;

-- ── 前置閘:庫上那一支必須就是我抄的那一代 ──────────────────────────────────
DO $$
DECLARE
  v_def  text;
  v_code text;
  v_md5  text;
  r      record;
BEGIN
  IF to_regclass('public.products_public') IS NULL THEN
    RAISE EXCEPTION '前置閘①a:找不到 public.products_public';
  END IF;
  -- 🔴 本片新增的相依:那支 view 不在 ⇒ 停, 不要讓 REPLACE 寫出一支會炸的函式。
  IF to_regclass('public.product_variants_public') IS NULL THEN
    RAISE EXCEPTION '前置閘①b:找不到 public.product_variants_public ⇒ 先貼 20260602135934。';
  END IF;

  SELECT pg_get_functiondef(p.oid), md5(p.prosrc) INTO v_def, v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'storefront_search_product_ids'
     AND pg_get_function_identity_arguments(p.oid) = 'p_terms text[]';

  IF v_def IS NULL THEN
    RAISE EXCEPTION '前置閘②:public.storefront_search_product_ids(p_terms text[]) 不存在 ⇒ 停下來查部署態, 不要讓本支替你創造它。';
  END IF;

  -- 🔴 **釘身分**:2026-09-06 18:5x 正式庫唯讀親量(`md5(prosrc)`)。
  --    這道閘紅了**不代表壞掉** —— 它代表「有人在我量完之後改過這支」
  --    ⇒ 🛑 停下來比對 `pg_get_functiondef`, 不要硬貼:`CREATE OR REPLACE` 會無聲蓋掉對方的改動。
  IF v_md5 <> 'a780b8052812395dbe65611dde927015' THEN
    RAISE EXCEPTION '前置閘③:庫上那支的 prosrc md5 是 % ⇒ 不是我抄的那一代(期望 a780b8052812395dbe65611dde927015)⇒ 有人改過它 ⇒ 停下來比對。', v_md5;
  END IF;

  -- 🔴🔴 `md5(prosrc)` **只釘函式本體** —— volatility / parallel / cost / rows / SET
  --    都不在 prosrc 裡, 而 `CREATE OR REPLACE` 會把沒寫出來的那些**重設回預設值**。
  --    ⇒ 逐欄釘住 2026-09-06 實測值(s / u / 100 / 1000 / NULL / f / f, 且 prosecdef=f)。
  SELECT p.provolatile, p.proparallel, p.procost, p.prorows,
         p.proconfig, p.proleakproof, p.proisstrict, p.prosecdef
    INTO r
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'storefront_search_product_ids';
  IF r.provolatile <> 's' OR r.proparallel <> 'u' OR r.procost <> 100 OR r.prorows <> 1000
     OR r.proconfig IS NOT NULL OR r.proleakproof OR r.proisstrict OR r.prosecdef THEN
    RAISE EXCEPTION '前置閘③b:函式屬性與 2026-09-06 實測不符(volatile=% parallel=% cost=% rows=% config=% leakproof=% strict=% secdef=%;期望 s/u/100/1000/NULL/f/f/f)⇒ 有人動過它 ⇒ 停。',
      r.provolatile, r.proparallel, r.procost, r.prorows, r.proconfig, r.proleakproof, r.proisstrict, r.prosecdef;
  END IF;

  -- 兩種註解都剝掉再找字面(只剝 `--` 的話, 旁邊放一段 `/* … */` 就能騙過下面的閘)
  v_code := regexp_replace(
              regexp_replace(v_def, '/\*.*?\*/', '', 'gs'),
              '--[^' || chr(10) || ']*', '', 'g');

  IF position('regexp_replace(p.external_id' IN v_code) = 0 THEN
    RAISE EXCEPTION '前置閘④a:庫上那支(剝註解後)沒有料號正規化那一塊 ⇒ 它不是我抄的那一代 ⇒ 停。';
  END IF;
  IF position('length(regexp_replace(t.term' IN v_code) = 0 THEN
    RAISE EXCEPTION '前置閘④b:庫上那支(剝註解後)沒有長度門檻 ⇒ 它比 20260904180000 舊 ⇒ 先貼那一支。';
  END IF;
  IF position('product_variants_public' IN v_code) <> 0 THEN
    RAISE EXCEPTION '前置閘④c:庫上那支已經含變體那一塊 ⇒ **本支已經貼過了** ⇒ 不要重貼。';
  END IF;
END
$$;

-- ── 本體(逐字搬 + 多一塊 ④)────────────────────────────────────────────────
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
  HAVING count(DISTINCT h.ord) = n.want;
$function$;

-- ── 事後閘 ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_code text;
  r      record;
  v_n    integer;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_code
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'storefront_search_product_ids'
     AND pg_get_function_identity_arguments(p.oid) = 'p_terms text[]';
  IF v_code IS NULL THEN
    RAISE EXCEPTION '事後閘①:REPLACE 完之後找不到它 ⇒ 停。';
  END IF;

  -- 🔴🔴 **數之前先把兩種註解都剝掉**(code-reviewer 2026-09-06 抓的, 他對):
  --    前置閘一直都有剝, 而事後閘沒有 ⇒ 📌 **同一份碼, 兩道閘用了兩把不同的尺。**
  --    後果很具體:`product_variants_public` 與 `count(DISTINCT h.ord)` **在註解裡也出現**
  --    ⇒ 把那整塊 SELECT 刪掉只留註解, 事後閘②a 照樣綠;
  --      把 `HAVING` 那一行刪掉, ②e 照樣綠 —— 而 ②e 自己寫的後果是「客人打料號拿到 0 筆」。
  v_code := regexp_replace(
              regexp_replace(v_code, '/\*.*?\*/', '', 'gs'),
              '--[^' || chr(10) || ']*', '', 'g');

  -- ② 四塊都要在 —— 少任何一塊都是【搜尋變窄】, 而變窄不會有人回報
  IF position('product_variants_public' IN v_code) = 0 THEN
    RAISE EXCEPTION '事後閘②a:新版沒有變體那一塊 ⇒ 本片什麼都沒做。';
  END IF;
  IF position('regexp_replace(p.external_id' IN v_code) = 0 THEN
    RAISE EXCEPTION '事後閘②b:料號那一塊不見了 ⇒ 我把別人的東西弄掉了。';
  END IF;
  IF position('bh.brand_id' IN v_code) = 0 THEN
    RAISE EXCEPTION '事後閘②c:品牌那一塊不見了。';
  END IF;
  IF position('n.want > 0' IN v_code) = 0 THEN
    RAISE EXCEPTION '事後閘②d:`WHERE n.want > 0` 不見了 ⇒ 🔴 零個有效詞會回【整張表】。';
  END IF;
  IF position('count(DISTINCT h.ord)' IN v_code) = 0 THEN
    RAISE EXCEPTION '事後閘②e:`count(DISTINCT h.ord)` 不見了 ⇒ 多塊各來一次會被多算 ⇒ 客人打料號拿到 0 筆。';
  END IF;

  -- ③ 安全前提:仍然是 INVOKER、仍然沒有 SET
  SELECT p.prosecdef, p.proconfig, p.provolatile, p.proparallel, p.procost, p.prorows
    INTO r
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'storefront_search_product_ids';
  IF r.prosecdef THEN
    RAISE EXCEPTION '事後閘③a:本支變成 SECURITY DEFINER ⇒ 那是把客人的查詢升權 ⇒ 停。';
  END IF;
  IF r.proconfig IS NOT NULL THEN
    RAISE EXCEPTION '事後閘③b:本支多了 SET(proconfig=%) ⇒ 與前置閘釘的世界不符。', r.proconfig;
  END IF;
  IF r.provolatile <> 's' OR r.proparallel <> 'u' OR r.procost <> 100 OR r.prorows <> 1000 THEN
    RAISE EXCEPTION '事後閘③c:屬性被 REPLACE 重設了(volatile=% parallel=% cost=% rows=%)⇒ 停。',
      r.provolatile, r.proparallel, r.procost, r.prorows;
  END IF;

  -- ④ EXECUTE 名單不能變(貼前實測:anon / authenticated / postgres / service_role)
  SELECT count(*) INTO v_n
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace,
    LATERAL aclexplode(p.proacl) a
   WHERE n.nspname = 'public' AND p.proname = 'storefront_search_product_ids'
     AND a.privilege_type = 'EXECUTE'
     AND a.grantee::regrole::text IN ('anon','authenticated','postgres','service_role');
  IF v_n <> 4 THEN
    RAISE EXCEPTION '事後閘④:EXECUTE 名單不是那四個(實 % 筆)⇒ REPLACE 動到權限了 ⇒ 停。', v_n;
  END IF;
END
$$;

COMMIT;
