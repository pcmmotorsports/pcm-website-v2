-- M-4b · 顧客站搜尋拆三塊 —— 讓中文查詢拿回 trgm 索引
-- ⟦search-TRGMEXPRIDX⟧ 2026-09-04
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🎯 正式站量到的(唯讀連線 · `EXPLAIN (ANALYZE)` · 24,312 商品 / 25 品牌 · 2026-09-04)
-- ══════════════════════════════════════════════════════════════════════════
--    詞                計畫                              改後        今天      倍數
--    ['碳纖維']        🟢 BitmapOr · 四支 trgm 全上    **21.4 ms**  243.8 ms   **11×**
--    ['龍頭固定座']    🟢 BitmapOr · 四支 trgm 全上    ** 3.7 ms**  284.1 ms   **77×**
--    ['akrapov','排氣管'] 🟢 同上(loops=2)            **16.2 ms**    ——
--    🔵 每一發都印 `Seq Scan on brands (rows=25)` ⇒ 品牌那塊如預期免費
--    🔵 中文詞下印 `Seq Scan on products p_2 (never executed)`
--       ⇒ 🎯 料號那塊**根本沒跑** —— 那正是「三個條件缺一不可」那段註解在保護的東西,
--         而它現在有了**計畫層**的證據, 不只是註解。
--    ⚠️ 上述讀數由**主視窗**在唯讀連線上量;本窗(front)只有鑽機讀數。來源分開記。
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🔴🔴 殺手有【兩個】, 而它們各自足以殺掉整個 BitmapOr
-- ══════════════════════════════════════════════════════════════════════════
--  ① **料號那條無索引分支**(`upper(regexp_replace(external_id,…)) LIKE …`)
--     ⇒ 一個 OR 裡有一條用不到索引 ⇒ BitmapOr 建不起來 ⇒ 整句退回全表掃。
--     🔬 鑽機驗證:同一支函式, 只差這一條 ⇒ trgm idx_scan **+2 ⇒ +0**
--        (`scripts/trgm-index-attribution-probe.sh`, 七格, 每格只差一樣東西)
--  ② 🔴 **`b.name ILIKE …` —— 而 `b` 是【JOIN 進來的另一張表】**
--     ⇒ OR 裡混進跨表欄位 ⇒ planner 只能先 join 再過濾 ⇒ products 上的索引全用不到。
--     🔬 **正式站驗證(主視窗量)**:五欄 OR ⇒ Seq Scan 249.1ms · 拿掉 b.name 的四欄 OR ⇒ BitmapOr
--     🛑 **⇒ 所以只拿掉料號分支【不夠】** —— 實測 243.8 ⇒ 227.5ms, 幾乎沒動。
--
--  🛑 **而我一度把成因歸給「函式外殼」, 那是錯的。**
--     ⛔ ~~「包成函式就吃不到 trgm ⇒ 怎麼拆都沒用」~~
--     🔴 那一發的 fixture 是被汙染的(目標詞命中 22,699/22,804)⇒ 那個世界裡 seq scan 本來就是正解
--     ⇒ 📌 **那個 +0 誠實, 而它答的是另一個問題。尺是好的, 世界是壞的。**
--     ⇒ 舊字面留著加刪除線, 讓搜「函式外殼」的人同一發撞到這裡。
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🎯 改法:三塊, 而 UNION ALL 發生在【(商品, 詞)】那一層
-- ══════════════════════════════════════════════════════════════════════════
--  ① products 四欄 OR   ⇒ 純本表欄位、零跨表 ⇒ BitmapOr 吃得到 trgm
--  ② 品牌               ⇒ 先撈 brands(25 列)再 `p.brand_id = …`
--  ③ 料號               ⇒ 兩端正規化比前綴(三個條件缺一不可, 見下方原註解)
--
--  🔴🔴 **UNION 的層級是正確性核心, 不是實作細節。**
--     今天的語意 = 「**每個【詞】都要中(AND)· 而一個詞可以靠【任何一欄】中(OR)**」,
--     而那個 OR 是逐【(商品, 詞) 配對】判的。
--     ⛔ 若 UNION 搬到【商品】那一層(「四欄塊裡每個詞都中的商品」∪「品牌塊裡每個詞都中的」):
--        客人打「akrapov 排氣管」—— 一個詞只有品牌有、一個詞只有 title 有
--        ⇒ 兩塊各自都不是「每個詞都中」⇒ **兩邊都不回它 ⇒ 這筆商品消失**。
--     ⇒ 📌 而那不是邊角案例 —— 那是**品牌 + 品類**, Sean 自己舉的 `mt07 akrapovic` 就是這形狀。
--        正式站實測那一組回 **555 筆**。
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🔴🔴 `count(DISTINCT ord)`:今天是裝飾, 改完是**承重**
-- ══════════════════════════════════════════════════════════════════════════
--    今天(單一 JOIN)一個 (商品, 詞) 只出現一次 ⇒ 寫成 `count(ord)` **也會對** ⇒ 它看起來像冗贅。
--    🛑 UNION ALL 之後同一對會從多塊各來一次(例:`FCAP-06` 同時中四欄塊與料號塊)
--       ⇒ 多算 ⇒ `= want` **不成立** ⇒ **那一列被丟掉**。
--    ⇒ 🔴 **方向是【變窄】不是放寬:客人打料號會拿到 0 筆。**
--    ⇒ ⇒ 📌 **而「拿到 0 筆」不會有人回報, 他只會覺得我們沒賣。**
--    ✅ 而它有一格會紅的東西, 不是只有這段註解:
--       `scripts/storefront-search-split-reconcile.sh` 常駐 `fn_new_nodistinct`, 實測 2/2 抓到。
--
-- ══════════════════════════════════════════════════════════════════════════
-- ✅ 驗過的 / 🛑 沒驗到的
-- ══════════════════════════════════════════════════════════════════════════
--  ✅ **正式站集合差:11 組詞 × 兩個方向 = 22 個 EXCEPT, 全部 0 列。**
--  ✅ 鑽機語意對帳 28 格全綠(兩張表 · 4,006 商品 / 25 品牌),含:
--       · 常駐 `fn_wrong`(UNION 搬到商品層)⇒ 跨塊那兩發**各差 1 筆** ⇒ 尺會分辨
--       · 常駐 `fn_new_nodistinct` ⇒ 2/2 抓到
--       · 逃脫 `['%']` / `['_']` ⇒ 各 1 筆(fixture 有帶字面 % 與 _ 的商品)
--       · 鑽機自檢:fn_old(含 b.name)trgm **+0** · 新案 **+4** ⇒ 這個世界重現得出殺手②
--  🛑 **而 G5 `['fcap06','碳纖維']` 兩邊都回 0 列 ⇒ 它今天【零判別力】, 不要當成「已驗過」。**
--     🎯 真正驗到跨塊那一發的是 **G4 `['akrapov','排氣管']`(555 筆, 有內容)**。
--     🔵 待補:一發**料號跨塊而有結果**的詞組(`fcap06` 只中 1 筆, 而那筆標題裡沒有「碳纖維」)。
--  🛑 **本檔沒有比對「改前 / 改後客人看到的排序」** —— 本函式只回 id, 排序在呼叫端。
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🔵 權限:本檔**不新建任何物件**, 也**不下任何 GRANT**
-- ══════════════════════════════════════════════════════════════════════════
--    `CREATE OR REPLACE FUNCTION` 保留既有 ACL ⇒ 不需要重下 GRANT, 而下了會是新的 ACL 漂移面。
--    ⇒ ✅ 事後閘改成**驗它還在**(anon 仍叫得動 + 一個沒被 GRANT 的角色仍叫不動)。
--    ⚠️ 主視窗 2026-09-04 實測:**唯讀那條連線沒有 EXECUTE 這支函式的權限**
--       (`permission denied for function storefront_search_product_ids`)
--       ⇒ 📌 「新物件出生自帶 anon 權限」與「唯讀角色拿不拿得到」是**兩件事**, 不要混。
--
-- 🔴 呼叫端(TS)**不必改**:三塊都在同一支函式裡, 沒有路由。
--
-- 回退:把 20260903230000 的函式本體原樣 `CREATE OR REPLACE` 回去即可(同名同簽章, ACL 不動)。

BEGIN;

-- ── 前置閘:部署態要與我抄的那一代相符 ────────────────────────────────────
DO $$
DECLARE
  v_def  text;
  v_code text;   -- v_def 剝掉 `--` 註解之後的樣子
BEGIN
  IF to_regclass('public.products_public') IS NULL THEN
    RAISE EXCEPTION '前置閘①:找不到 public.products_public';
  END IF;
  IF to_regclass('public.brands') IS NULL THEN
    RAISE EXCEPTION '前置閘②:找不到 public.brands';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'storefront_search_product_ids'
     AND pg_get_function_identity_arguments(p.oid) = 'p_terms text[]';

  IF v_def IS NULL THEN
    RAISE EXCEPTION '前置閘③:public.storefront_search_product_ids(p_terms text[]) 不存在 ⇒ 停下來查部署態, 不要讓本支替你創造它。';
  END IF;

  -- 🔴 **釘身分不是釘存在**:庫上那一支必須是 20260903230000 那一代
  --    ⇒ 它的特徵 = 五欄 OR 裡有 `b.name`, 而且已經有料號正規化那條分支。
  --    🛑 少了任一 ⇒ 它不是我抄的那一代 ⇒ 我不知道 REPLACE 會蓋掉什麼 ⇒ 停。
  -- 🔴🔴 **先把 `--` 註解剝掉再找** —— 而這一格是實測出來的, 不是想到的:
  --    `pg_get_functiondef` **含函式體裡的註解**, 而我的新本體裡寫了一句
  --    「b.name 不得放回那個 OR 裡」⇒ 🛑 **貼第二次時這道閘【放行】了**(實測 rc=0)。
  --    ⇒ 📌 而那正是「註解被當成碼」那一族:一道防它的守門, 長得像那個東西本身。
  v_code := regexp_replace(v_def, '--[^' || chr(10) || ']*', '', 'g');
  IF position('b.name' IN v_code) = 0 THEN
    RAISE EXCEPTION '前置閘④a:庫上那支(剝掉註解後)不含 `b.name` ⇒ 它不是 050000/230000 那一代, 或**本支已經貼過了** ⇒ 停下來比對 pg_get_functiondef, 不要重貼。';
  END IF;
  IF position('regexp_replace' IN v_code) = 0 THEN
    RAISE EXCEPTION '前置閘④b:庫上那支不含料號正規化(regexp_replace)⇒ 20260903230000 可能沒有真的貼上 ⇒ 停。';
  END IF;
END
$$;

-- ── 本體 ──────────────────────────────────────────────────────────────────
-- 🔴 **刻意【不寫】 SECURITY DEFINER** —— 預設就是 INVOKER, 而那是本片的安全前提。
--    ⚠️ 下一個人若改成 DEFINER:那不是效能調整, 那是把客人的查詢升權 ⇒ 要重過鐵則 12②。
-- 🔵 **也刻意不寫 `SET search_path`** —— INVOKER + 只讀具名 `public.` 物件、零提權面。
--    🔬 而「search_path 是不是成因」已在正式站排除:`pg_proc.proconfig` = NULL(2026-09-04 實查)。
CREATE OR REPLACE FUNCTION public.storefront_search_product_ids(p_terms text[])
RETURNS TABLE (id uuid)
LANGUAGE sql
STABLE
AS $fn$
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
         AND t.term ~ '[A-Za-z]'
         AND upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) <> ''
         AND upper(regexp_replace(p.external_id, '[^A-Za-z0-9]', '', 'g'))
             LIKE upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) || '%'
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
$fn$;

COMMENT ON FUNCTION public.storefront_search_product_ids(text[]) IS
  '顧客站搜尋(只回 id)。⟦search-TRGMEXPRIDX⟧ 2026-09-04 拆三塊。
三塊:①products 四欄 OR(吃 trgm)②品牌(先撈 brands 再比 brand_id)③料號(兩端正規化比前綴)。
🔴 UNION ALL 必須在【(商品, 詞)】那一層 —— 搬到商品層會讓「品牌+品類」的查詢整筆消失。
🔴 HAVING 的 DISTINCT 是承重的 —— 拿掉會讓客人打料號拿到 0 筆。
🔴 b.name 不得放回那個 OR 裡 —— 跨表欄位進 OR ⇒ products 的索引全部用不到(正式站 249ms vs 21ms)。
🔴 SECURITY INVOKER(預設)—— 不要改成 DEFINER。
🔴 COMMENT ON 是覆寫不是追加 —— 改它的人請把這一段一起帶著。';

-- ── 事後閘 ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  -- ⚠️ 兩份清單都空是**明示**:本檔沒有新建任何可授權物件 —— 它 REPLACE 一支既有函式,
  --    而 `CREATE OR REPLACE FUNCTION` 保留既有 ACL ⇒ 沒有新的收權面。
  v_relations text[] := ARRAY[]::text[];
  v_functions text[] := ARRAY[]::text[];
  v_acl text;
  v_cnt bigint;
  v_all bigint;
BEGIN
  IF cardinality(v_relations) <> 0 OR cardinality(v_functions) <> 0 THEN
    RAISE EXCEPTION '收權斷言:本檔宣稱不新建物件, 而清單非空 ⇒ 兩者矛盾, 停下來看。';
  END IF;

  SELECT coalesce(p.proacl::text, '') INTO v_acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'storefront_search_product_ids';

  -- ⓪ REPLACE **不該**動 ACL。若它變成 NULL ⇒ 等於 PUBLIC 拿得到 EXECUTE
  IF v_acl = '' THEN
    RAISE EXCEPTION '事後閘⓪:proacl 是 NULL ⇒ 既有授權被吹掉了, 等於 PUBLIC 叫得動';
  END IF;
  IF v_acl LIKE '%{=%' OR v_acl LIKE '%,=%' THEN
    RAISE EXCEPTION '事後閘①:PUBLIC 出現在 ACL 裡 ⇒ %', v_acl;
  END IF;
  -- ② anon 要叫得動(否則顧客站整條搜尋掛掉)
  IF NOT has_function_privilege('anon', 'public.storefront_search_product_ids(text[])', 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘②:anon 執行不到 ⇒ 顧客站會拿不到結果';
  END IF;
  -- ③ 🔵 負對照:一個沒被 GRANT 的角色必須執行不到 —— 否則上面那個 true 沒有判別力
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pcm_readonly')
     AND has_function_privilege('pcm_readonly', 'public.storefront_search_product_ids(text[])', 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘③:pcm_readonly 也執行得到 ⇒ 上面那個 anon=true 沒有判別力';
  END IF;
  -- ④ 不得是 SECURITY DEFINER
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='storefront_search_product_ids' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION '事後閘④:本支是 SECURITY DEFINER ⇒ 那是把客人的查詢升權';
  END IF;

  -- ⑤ 🔴🔴 **行為閘 —— 而它有兩端**, 因為「回 0 筆」與「回全表」是這一片的兩個災難:
  SELECT count(*) INTO v_all FROM public.products_public;
  -- ⑤a 零個有效詞 ⇒ 必須回 0 列(不是回全表)
  SELECT count(*) INTO v_cnt FROM public.storefront_search_product_ids(ARRAY[]::text[]);
  -- ⚠️ **本閘殺不掉「把 `n.want > 0` 改成 `true`」那個突變**(實測 rc=0)——
  --    因為詞表空的時候 `hits` 本來就是空的(JOIN 不到東西)⇒ 那個突變不致命。
  --    ⇒ 📌 寫出來, 不要讓「⑤a 綠」被讀成「`n.want > 0` 有守門」。
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '事後閘⑤a:空詞回了 % 列(期望 0)⇒ 有東西讓空詞命中了', v_cnt;
  END IF;
  -- ⑤b 一個【字面的 %】不得被當成萬用字元 ⇒ 不得回全表
  SELECT count(*) INTO v_cnt FROM public.storefront_search_product_ids(ARRAY['%']);
  IF v_cnt = v_all THEN
    RAISE EXCEPTION '事後閘⑤b:`%%` 回了全表 % 列 ⇒ 逃脫沒生效(pat 那三層 replace 壞了)', v_all;
  END IF;
  -- ⑤c 🔵 正對照:一個**一定中得到**的詞必須回非零 —— 少了它, ⑤a/⑤b 的兩個「不是全表」
  --     在「這支函式對什麼都回 0」的世界裡照樣通過。
  SELECT count(*) INTO v_cnt FROM public.storefront_search_product_ids(
    ARRAY[(SELECT substr(title, 1, 4) FROM public.products_public
            WHERE title IS NOT NULL AND length(title) >= 4 ORDER BY id LIMIT 1)]);
  IF coalesce(v_cnt, 0) = 0 THEN
    RAISE EXCEPTION '事後閘⑤c:拿一筆真商品標題的前四個字去搜, 回了 0 列 ⇒ 這支函式對什麼都回 0 ⇒ ⑤a/⑤b 沒有判別力';
  END IF;

  -- ⑤d 🔴🔴 **釘住 `count(DISTINCT h.ord)`** —— 而它需要一個【同時中兩塊】的詞。
  --    一個帶字母又帶數字的 external_id:四欄塊(external_id ILIKE)與料號塊**各吐一次**
  --    ⇒ 拿掉 DISTINCT ⇒ 多算 ⇒ `= want` 不成立 ⇒ **這一列被丟掉** ⇒ 本閘紅。
  --    🔬 而這一格是實測補的:⑤c 用單一標題詞, **殺不掉那個突變**(實測 rc=0)——
  --      📌 而「突變全綠」有兩種原因:斷言太弱, 或那個突變沒壞掉任何東西。這裡是前者。
  SELECT count(*) INTO v_cnt FROM public.storefront_search_product_ids(
    ARRAY[(SELECT external_id FROM public.products_public
            WHERE external_id ~ '[0-9]' AND external_id ~ '[A-Za-z]'
            ORDER BY id LIMIT 1)]);
  IF coalesce(v_cnt, 0) = 0 THEN
    RAISE EXCEPTION '事後閘⑤d:拿一筆真料號去搜回了 0 列 ⇒ 同一個 (商品,詞) 從兩塊各來一次而被多算 ⇒ HAVING 的 DISTINCT 掉了(客人打料號會拿到 0 筆)';
  END IF;
END
$$;

COMMIT;
