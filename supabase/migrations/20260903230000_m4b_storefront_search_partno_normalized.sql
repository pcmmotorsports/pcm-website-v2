-- M-4b · 顧客站搜尋:料號的不同打法要指向同一顆
--
-- 🔴🔴 **本函式的前一版在 `20260903050000_m4b_storefront_search_product_ids.sql:84`。**
--    那一支是 `CREATE`(裸的);本支是 `CREATE OR REPLACE`,**同一個簽名**。
--    ⇒ 📌 `bash scripts/latest-definition-of.sh storefront_search_product_ids` 會同時列出兩代。
--    ⇒ 🛑 **抄它去改的人:抄【本支】,不要抄 050000。**
--
-- ── 它要解的那件事 ────────────────────────────────────────────────────────
--    Sean 2026-09-03 逐字:
--      「但是打料號**一定要有**,而且要有- 無- 有空格無空格等等方式料號都要能帶出來建議的商品」
--    🔴 而同一分鐘他對膠囊解析說的是「**盡量就好**」⇒ 兩句不同級,不可合成一句。
--
--    🔬 **鑽機實測(2026-09-03,seed 後 postgrest 撈出的真實料號 `G3-0010`)**:
--    ```
--      打 G3-0010  ⇒ 1 件 ✅     打 G3 0010 ⇒ 1 件 ✅
--      打 g3-0010  ⇒ 1 件 ✅     打 g30010  ⇒ 🛑 **0 件**
--    ```
--    🎯 **⇒ 四種打法只有「無分隔號」那一種壞掉。**
--    ⇒ 📌 而知道這件事很重要:不知道的話會寫一個「四種都修」的大東西去修一個一格的病。
--
-- ── 🔴🔴 為什麼修在【這支函式】而不是在前端 ────────────────────────────────
--    `SupabaseProductAdapter.ts:558-559` 是 **early return**:
--      這支 RPC 拿得到結果 ⇒ **直接 return**,底下那條 `.or(buildIlikeOrFilter(…))` 整段不執行。
--    ⇒ 🛑 而這支 RPC **已經在正式站上**(`supabase/APPLIED.tsv:361`,Sean 2026-09-03 本人貼)
--    ⇒ ⇒ 📌 **所以前端那支 `partNumberPattern` 今天在正式站上一次都沒有被執行過。**
--      (⚠️ 而 `APPLIED.tsv` 那一列**自陳「證據等級=推論、正式庫未查證」** ——
--       所以下面有一道前置閘去問那個資料庫本人,見前置閘①。)
--
-- ── ✅ 做法:兩端都正規化 + 比【前綴】 ─────────────────────────────────────
--    正規化 = 去掉所有非英數 + 轉大寫。
--    ```
--      打 g30010  ⇒ G30010        資料 G3-0010 ⇒ G30010   ⇒ 前綴命中 ✅
--      打 G3-0010 ⇒ G30010        資料 G3-0010 ⇒ G30010   ⇒ 命中 ✅
--    ```
--    🔬 **31 筆語料實測(含真實形狀 + 碰撞候選),打 `ab123`**:
--    ```
--      甲 未錨定 %ab%123%   ⇒ 10 件  🔴 雜訊 CRAB-99123 · LAB-X-40123 · GRAB-123MM · SLAB123 · FAB-1230
--      乙 正規化+子字串      ⇒  6 件  🔴 仍含 GRAB-123MM · SLAB123 · FAB-1230
--      ✅ 丙 正規化+【前綴】 ⇒  3 件  ✅ 雜訊 0
--    ```
--    📌 **為什麼丙比乙準**:乙 是**子字串**比對(`GRAB123MM` 含 `AB123` ⇒ 中);
--      丙 是**前綴** ⇒ 那三顆自然掉出去。**正規化解的是【分隔號】,不是【位置】。**
--
--    ⚠️ 🔴 **而我第一版的語料是【構造的】,它不含正式站真正的形狀,而那讓我下錯結論** ——
--      我的語料 `AB-123`(分隔號在**字母↔數字交界**)vs 真實 `G3-0010`(分隔號在**數字中間**)。
--      ⇒ 我先前用「切段 + 錨定」修,它對前者有效、對後者無效,而**三個方向同時贏讓我更確信它**。
--      ⇒ 📌 **抓到它的是「真的開伺服器走一遍」** —— 語料是我構造的,它只含我想得到的形狀。
--
-- ── 🔬 成本(鑽機灌到 22,804 列 = 與正式站同列數;**量的是這支函式本人**,各三發)──
--    ```
--      打的詞                       舊 050000        新 230000        差
--      g30010   (料號, 進新分支)    42.5~43.9 ms     74.8~77.2 ms     🔴 +32ms
--      碳纖維   (中文, 被守衛擋掉)  42.5~43.3 ms     45.9~46.7 ms     🔵 +3.4ms
--      akrapovic(無數字, 被擋掉)    42.3~43.2 ms     45.8~46.0 ms     🔵 +3.2ms
--    ```
--    🎯 **⇒ 不是料號的搜尋只多付 ~8%;料號搜尋多付 ~76% 換一個【對的答案】。**
--    🔵 而那個 8% 是**述詞順序換來的** —— 兩個便宜的 `~` 排在 `regexp_replace` 前面
--      (adversarial-reviewer C4)。排錯順序時中文那格量到 +15~22ms。
--
--    ⛔ ~~舊版本檔頭寫「現行(四欄 ILIKE)25.9/27.1/30.4 ms ⇒ +14ms」~~
--    🔴 **那組數字量的不是這支函式**(adversarial-reviewer M4):我當時手打了一句四欄 ILIKE,
--      而正式站上這支是**五個分支 + `LEFT JOIN brands`**。
--      ⇒ 📌 **標籤與被量的物件不是同一個 ⇒ 那個「+14ms」算不出來。** 上表才是。
--
--    🛑 **射程,不要拿去當正式站的數字**:
--      · 鑽機 `datctype = C`(實查)、正式站是 glibc ⇒ **絕對毫秒數可能不同**
--      · 灌進去的 22,696 列是**複製同一列**改 `external_id`/`handle`
--        ⇒ `description` 全部一樣 ⇒ 那一欄的 ILIKE 成本不代表真實資料
--        ⇒ 而它對**兩邊同時**上升 ⇒ 那個差可能被稀釋,**但不會反轉**
--      · 我**沒有**跑正式庫 ⇒ 這是鑽機的數字
--
--    🔴🔴 **而我第一次量的數字是【汙染的】,記在這裡因為它是可複製的坑**:
--      第一發量到「正規化 20ms vs 現行 0.5ms ⇒ 慢 40 倍」⇒ 差點寫進 plan 當「太慢」的證據。
--      🛑 而那 0.5ms 是因為**鑽機上有 `products_external_id_trgm_idx`** ——
--         而那支索引住在 `20260903060000`,**它還沒貼上正式站**。
--      ⇒ 🎯 **我拿一個【正式站沒有的索引】去證明另一個做法太慢。**
--      ⇒ ✅ 抓到它的不是更仔細,是**去看 EXPLAIN 的 plan 那一行**(它把索引的名字印出來了)。
--      ⇒ ⇒ 📌 **判別句:「我這個毫秒數,是走了哪一條 plan 得到的?
--            而那條 plan 上的每一個索引,正式站都有嗎?」**
--
-- ── 🔬 語意回歸(adversarial-reviewer M2:我第一版抽的三個詞【零判別力】)────
--    ⛔ ~~原本抽 `a` / `G` / `碳纖維` 說「改前改後相同」~~
--    🔴 **那三個詞【結構上進不了新分支】**(新分支要同時有字母與數字)
--      ⇒ 「相同」是**必然**,不是證據。📌 又一次「量了一個到不了目標世界的東西」。
--    ✅ 改用**真的會進新分支**的詞重量(22,804 列):
--    ```
--      詞         舊    新     
--      g3         12    12     不變
--      G3-000      9     9     不變
--      g30010      0     1     🔴 變了(這就是本片要修的那一格)
--      g3000       0     9     🔴 變了 —— **而這一格我原本沒有宣告**
--      e46/m3/rpm2/a1  0  0    不變(此資料集無此料號)
--    ```
--    🎯 **⇒ 8 個裡 2 個變,而兩個都是【找到更多】,沒有任何一個變少。**
--      (與 reviewer 的證明一致:新分支是 `OR` 加在 join 述詞、`HAVING` 是門檻式
--       ⇒ 今天中的 (詞,商品) 對一個都不會消失。)
--    🔵 而 `g3000 ⇒ 0→9` 正是 Sean 逐字要的「**打差不多的料號,可以顯示類似的商品**」。
--
-- ── ⚠️ 與 20260903060000(pg_trgm GIN,尚未貼)的交互作用 ────────────────
--    ⛔ ~~舊版本檔頭寫「這一發會讓那支 trgm 索引對【料號搜尋】失效」~~
--    🔴 adversarial-reviewer M3 說它**比我寫的更嚴重**(BitmapOr 需要每個分支都有索引,
--      少一個 ⇒ 整個 OR 退回全表掃 ⇒ 連中文那條一起退)—— 而它**沒有量,是推的**。
--    ✅ **我去量了**(22,804 列 + 四支 trgm 索引都在,`EXPLAIN ANALYZE` 讀 plan):
--    ```
--      舊 050000 「碳纖維」 BitmapOr=0 · trgm 節點=0 · Seq Scan=1
--      新 230000 「碳纖維」 BitmapOr=0 · trgm 節點=0 · Seq Scan=1
--      舊/新     「akrapovic」 同上 —— 兩版都是 Seq Scan
--    ```
--    🎯 **⇒ 在這個 harness 上,【舊版本來就沒有在吃 trgm 索引】** ——
--      所以「我這一發會害它失效」**沒有被重現**:它沒有可以被害的東西。
--    🛑 **而這個結論的射程有兩個洞,兩個都要講**:
--      ① 中文那半在本機**結構性失明**(`pg_trgm` 對中文在 BSD libc 抽零 trigram,
--         `20260903060000` 檔頭記過)⇒ 碳纖維那一列**不算數**
--      ② 而 `akrapovic`(純 ASCII)那一列**算數** ⇒ 它說:這支函式的形狀
--         (view + LEFT JOIN + CTE join)本身就讓 planner 不走 trgm
--      ⇒ 📌 **要真正結案,得在【貼過 060000 的正式庫】上比同一組 term 的 plan。**
--         我沒有那個存取 ⇒ **標未確認,不要當成已排除。**
--    🔵 而若日後真的要救:**不需要改碼**,補一支 expression index 即可
--      `CREATE INDEX … ON public.products ((upper(regexp_replace(external_id,'[^A-Za-z0-9]','','g'))) text_pattern_ops);`
--      什麼時候算問題:**料號搜尋 p95 > 200ms**。
--      ⚠️ **那個 200 是我挑的,依據是體感,未與 Sean 對過** ⇒ 板列 ⟦search-TRGMEXPRIDX⟧。
--
-- ── 權限 ──────────────────────────────────────────────────────────────────
--    ✅ `CREATE OR REPLACE` 且**參數型別一個字都沒變**(`p_terms text[]`)
--      ⇒ **保留舊 ACL**,050000 的授權/撤銷原封不動
--      (依據:`docs/patterns/revoking-function-execute-in-supabase.md:153` 的表,
--       那一列是 2026-08-16 拋棄式 PG 17.10 **實跑**出來的,不是憑記憶)。
--    🔴 **⇒ 所以改簽名是禁止的** —— 同檔 `:154`:參數型別一變就**不是取代,是多一支**,
--      舊簽名連同它的 ACL 原封不動留著,而新簽名**重新拿到 anon 授權**。
--    ⇒ 📌 本支因此**不下任何 GRANT / REVOKE** —— 下了反而會蓋掉 050000 的決定。

BEGIN;

DO $$
BEGIN
  -- 🔴🔴 前置閘①:**這支函式必須【已經存在】。**
  --    理由不是防呆,是**要它替我回答一個我答不出來的問題**:
  --    `APPLIED.tsv` 那一列自陳「證據等級=推論、正式庫未查證」
  --    ⇒ 我不確定正式庫上到底有沒有 050000 那一版。
  --    🛑 而若它**不在**,`CREATE OR REPLACE` 會**創造**它
  --       ⇒ 那會把正式站的搜尋**從 filter 路整條切到 RPC 路**
  --       ⇒ 📌 那是一個比「加正規化」大得多的行為改變,**而它會靜靜發生**。
  --    ⇒ ✅ 所以這裡 fail-closed:不在就停下來,讓人去看一眼,而不是替他決定。
  -- ⛔ ~~原本只問 `pg_proc` 有沒有一支同名同簽章的函式~~
  -- 🔴 **那是釘【存在】不是釘【身分】**(adversarial-reviewer M1)——
  --    而本閘自己的目的(上一段)寫的是「我不確定正式庫上有沒有【050000 那一版】」。
  --    ⇒ 只問存在的話,它在「正式庫是 050000」與「正式庫是別人手改過的第三代」
  --      **兩個世界印同一個綠**,而 `CREATE OR REPLACE` 會把後者靜靜回捲。
  --    ⇒ 📌 `docs/launch-todo.md` ⟦c7-COR-IDENTITY-ASSERT⟧ 逐字要求的就是這一格。
  -- ✅ 改成讀本體:釘住**050000 那一代才有的字面**(它引進了 brands join 與 b.name 分支)。
  DECLARE
    v_def text;
  BEGIN
    SELECT pg_get_functiondef(p.oid) INTO v_def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'storefront_search_product_ids'
       AND pg_get_function_identity_arguments(p.oid) = 'p_terms text[]';

    IF v_def IS NULL THEN
      RAISE EXCEPTION
        '前置閘①a:public.storefront_search_product_ids(p_terms text[]) 不存在 ⇒ 20260903050000 可能沒有真的貼上。停下來查,不要讓本支替你創造它(那會把搜尋整條切到 RPC 路)。';
    END IF;

    -- 🔴 這兩個字面是 050000 引進的(品牌 join + b.name 分支)。
    --    少了它們 ⇒ 庫上那一支**不是我抄的那一代** ⇒ 我不知道我會蓋掉什麼 ⇒ 停。
    IF position('public.brands' IN v_def) = 0 OR position('b.name' IN v_def) = 0 THEN
      RAISE EXCEPTION
        '前置閘①b:庫上那支函式的本體【不含 050000 的特徵字面】(public.brands / b.name)⇒ 它不是我抄的那一代。停下來比對 pg_get_functiondef,不要讓 CREATE OR REPLACE 靜靜回捲別人的改動。';
    END IF;
  END;

  -- 前置閘②:要搜的那張 view 在(沿用 050000 的形狀)
  IF to_regclass('public.products_public') IS NULL THEN
    RAISE EXCEPTION '前置閘②:找不到 public.products_public ⇒ 部署態與預期不符';
  END IF;

  -- 前置閘③:brands 在
  IF to_regclass('public.brands') IS NULL THEN
    RAISE EXCEPTION '前置閘③:找不到 public.brands';
  END IF;
END
$$;

-- 🔴 **與 050000:84 逐字相同,只有 `external_id` 那一段多了一個 OR 分支。**
--    其餘每一行(簽名 / STABLE / 不寫 SECURITY DEFINER / 不寫 search_path / CTE / HAVING)
--    都是原樣搬過來的 —— 改動面 = 一個 OR 分支。
CREATE OR REPLACE FUNCTION public.storefront_search_product_ids(p_terms text[])
RETURNS TABLE (id uuid)
LANGUAGE sql
STABLE
-- 🔴 **刻意【不寫】 SECURITY DEFINER** —— 預設就是 INVOKER,而那是本片的安全前提(見 050000 檔頭①)。
--    ⚠️ 下一個人若把它改成 DEFINER:**那不是效能調整,那是把客人的查詢升權** ⇒ 要重過鐵則 12②。
-- 🔵 **也刻意不寫 `SET search_path`** —— INVOKER + 只讀具名 `public.` 物件、零提權面。
AS $fn$
  WITH t AS (
    -- 🔴 逐詞編號 ⇒ 下面用「不同詞的個數」判斷「每個詞都中了」
    --    `WITH ORDINALITY` 讓重複的詞不會被摺疊成一個(打兩次同一個字仍是一個條件)
    SELECT DISTINCT ON (term) term, ord
      FROM unnest(coalesce(p_terms, ARRAY[]::text[])) WITH ORDINALITY AS u(term, ord)
     -- 空字串 / 全空白的詞丟掉 —— 留著會變成 `%%` 而那會命中全部
     WHERE btrim(term) <> ''
  ),
  n AS (SELECT count(*)::bigint AS want FROM t)
  SELECT p.id
    FROM public.products_public p
    LEFT JOIN public.brands b ON b.id = p.brand_id
    CROSS JOIN n
    JOIN t ON (
         p.title       ILIKE '%' || replace(replace(replace(t.term, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      OR p.subtitle    ILIKE '%' || replace(replace(replace(t.term, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      OR p.description ILIKE '%' || replace(replace(replace(t.term, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      OR p.external_id ILIKE '%' || replace(replace(replace(t.term, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      OR b.name        ILIKE '%' || replace(replace(replace(t.term, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      -- ── ⟦search-PARTNOSEPINDIGITS⟧ 料號:兩端都正規化,再比【前綴】────────────
      -- 🔴🔴 **三個條件缺一不可,而少了第一個會【回傳整張表】**:
      --    ① `regexp_replace(term) <> ''` —— 中文詞正規化之後是**空字串**,
      --       而 `LIKE '' || '%'` = `LIKE '%'` ⇒ **命中每一列**。
      --       ⇒ 📌 客人打「油箱貼」就會拿到全站商品,而 HTTP 200、畫面完全正常。
      --    ② 詞裡**同時**有字母與數字 —— 少了它,打 `a` ⇒ 前綴 `A%` ⇒ 命中所有 A 開頭的料號。
      --       ⇒ 這一格把它限縮成「看起來像料號」,而不是每個字都拿去比料號。
      --    ③ 用 `LIKE` 不是 `ILIKE` —— 兩端都已經 `upper()` 過了,
      --       ⇒ 再用 ILIKE 是白付一次 case-folding,而且會讓它更難吃到索引。
      -- 🔵 **不需要 escape**:正規化把 `%` `_` `\` 全都當成非英數刪掉了
      --    ⇒ 正規化後的字串只可能是 `[A-Z0-9]*` ⇒ **構造不出萬用字元**。
      OR (
             -- 🔴 **順序刻意:兩個便宜的 `~` 排在最前面**(adversarial-reviewer C4)。
             --    中文搜尋佔多數而它們一定不含數字 ⇒ 第一格就被擋掉,
             --    **不必為每一個 (列 × 詞) 對白付一發 `regexp_replace`**。
             --    ⚠️ 而 SQL 的 `AND` 不保證求值順序(planner 可以重排)⇒ 這是**建議不是保證**;
             --       它不影響正確性, 只影響成本。
             -- 🔬 **而那個成本是量到的, 不是想的**(22,804 列, 中文詞「碳纖維」):
             --      這個順序        ⇒ 42.5~43.3 → 45.9~46.7 ms(**+3.4ms / +8%**)
             --      `regexp_replace` 排前面 ⇒ **+15~22ms**
             -- 🛑 **⇒ 下一個人「整理」這段 SQL 把順序換回去, 三綠全綠、行為零改變、
             --      而【絕大多數的搜尋】(不是料號的那些)會多付四到六倍。**
             --    ⇒ 📌 沒有任何測試守得住這一格 —— 它不是正確性, 是成本。**這段註解就是它的守門。**
             t.term ~ '[0-9]'
         AND t.term ~ '[A-Za-z]'
         AND upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) <> ''
         AND upper(regexp_replace(p.external_id, '[^A-Za-z0-9]', '', 'g'))
             LIKE upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) || '%'
         )
    )
   WHERE n.want > 0            -- 🔴 零個有效詞 ⇒ 回零列(不是回全表)
     AND p.id IS NOT NULL
   GROUP BY p.id, n.want
  HAVING count(DISTINCT t.ord) = n.want;   -- 🔴 每一個詞都要中(AND across terms)
$fn$;

COMMENT ON FUNCTION public.storefront_search_product_ids(text[]) IS
  '顧客站搜尋:回傳命中的商品 id(**只回 id,不回任何欄位**)。
🔴 **SECURITY INVOKER(預設)** —— 以呼叫者(anon)身分執行 ⇒ 拿不到任何 anon today 拿不到的東西。
**不要改成 SECURITY DEFINER**:那不是效能調整,那是把客人的查詢升權,要重過鐵則 12②。
🔴 **只回 id 是刻意的**:欄位由呼叫端用既有投影(products_public)取,**投影與 mapper 都不動**
⇒ 把「不得把 brands 欄位放進回傳」從一條【規則】變成一件【做不到的事】。
   (brands.premium_extra_pct 是品牌加價%,而它在 DB 這一層對 anon 是開著的。)
⟦search-PARTNOSEPINDIGITS⟧ 2026-09-03:料號多一條「兩端正規化 + 前綴」的比對
⇒ `g30010` 找得到 `G3-0010`。前一版在 20260903050000。
🔴 COMMENT ON 是**覆寫不是追加** —— 改它的人請把這一段一起帶著。';

-- ── 事後閘(adversarial-reviewer C1)───────────────────────────────────────
-- 🔴🔴 **050000 有八格事後閘,而我第一版一格都沒有。**
--    而本檔檔頭寫著「抄【本支】不要抄 050000」⇒ 📌 **下一代抄過去,那八格會一起不見。**
--    ⇒ 而 050000 自己寫過:「一個只在 apply 那一秒被檢查過的權限,之後就是沒有人在看的」
--      —— 而這次 `CREATE OR REPLACE` **正是那一秒**。
-- 🔵 這裡不重抄全部八格(本支零 GRANT / 零 REVOKE), 留的是「**REPLACE 有沒有動到授權**」那三格。
DO $$
DECLARE
  v_acl text;
  v_cnt int;
BEGIN
  -- 事後閘⓪:同名函式只能有一支 —— >1 = 我把簽名改到了 ⇒ 變成多載
  --   ⇒ 🛑 那會讓舊簽名連同它的 ACL 原封不動活著, 而新簽名**重新拿到 anon 授權**。
  SELECT count(*) INTO v_cnt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'storefront_search_product_ids';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '事後閘⓪:同名函式有 % 支(期望 1)⇒ 簽名被改到了, 變成多載', v_cnt;
  END IF;

  SELECT coalesce(p.proacl::text, '') INTO v_acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'storefront_search_product_ids';

  -- 事後閘①:ACL 不得是 NULL —— NULL = 「沒有人設過」= PUBLIC 拿得到預設 EXECUTE,
  --   而**它在 `pg_proc` 上看起來就是一片空白**(那正是 revoking-function 那份文件記的坑)。
  IF v_acl = '' THEN
    RAISE EXCEPTION '事後閘①:proacl 是 NULL ⇒ 050000 的授權被這次 REPLACE 洗掉了(預期是【保留】)';
  END IF;

  -- 事後閘②:PUBLIC 不得在 ACL 裡(PUBLIC 在 aclitem 裡的表示法是「= 開頭、grantee 空白」)
  IF v_acl LIKE '%{=%' OR v_acl LIKE '%,=%' THEN
    RAISE EXCEPTION '事後閘②:PUBLIC 出現在 ACL 裡 ⇒ %', v_acl;
  END IF;

  -- 事後閘③:本片的行為本身 —— 正規化那一發真的接上了。
  --   🔴 這一格不是驗權限, 是驗**這支 migration 有沒有做到它宣稱的事**;
  --      少了它, 一支「貼上去而 OR 分支被吃掉」的版本會拿到全綠。
  IF position('PARTNOSEPINDIGITS' IN (
       SELECT pg_get_functiondef(p.oid)
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'storefront_search_product_ids')) = 0 THEN
    RAISE EXCEPTION '事後閘③:庫上那支函式的本體找不到 PARTNOSEPINDIGITS 錨 ⇒ 我的分支沒有接上';
  END IF;
END
$$;

COMMIT;

-- ── 回退 ──────────────────────────────────────────────────────────────────
-- 🔴 回退 = 把函式**換回 050000 那一版的定義**(不是 DROP —— DROP 會讓搜尋整條切回
--    filter 路,而那是比「料號找不到」更大的行為改變)。
--    ⇒ 逐字從 `20260903050000_m4b_storefront_search_product_ids.sql:84-117` 抄回來,
--      把 `CREATE FUNCTION` 改成 `CREATE OR REPLACE FUNCTION`。
--    ✅ 參數型別不變 ⇒ ACL 一樣保留。
-- ⚠️ 而**碼那一半不需要退** —— 呼叫端一個字都沒動(仍然是 `rpc('storefront_search_product_ids', {p_terms})`)。
--    📌 這是本片刻意的形狀:**SQL 與碼解耦** ⇒ 貼 SQL 不必配合部署,退 SQL 也不必。
