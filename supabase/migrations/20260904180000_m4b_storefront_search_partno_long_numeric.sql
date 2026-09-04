-- 🛑 **檔頭第一行:本支【可以獨立貼】,不依賴任何其他 SQL、不需要先部署 TS。**
--    呼叫端(TS)一個字都不用改 —— 改的是同一支函式的內部條件, 簽章與回傳型別零變動。
--    ⚠️ 對照:`20260904160000`(多顆膠囊)那支【不能】獨立貼, 它有三步部署順序。本支沒有。
-- ============================================================
-- M-4b · 打料號:【夠長的純數字】也走料號那條路
-- ⟦search-PARTNOSEPINDIGITS⟧ 續集 · 2026-09-04 · 線【身分】`-auth`
-- ============================================================
-- Sean 原話(逐字):
--   「但是打料號一定要有,而且要有- 無- 有空格無空格等等方式料號都要能帶出來建議的商品。」
--
-- 🔬 而我逐格量過了(7 個活料號 × 8 種寫法, 打線上顧客站 `/api/search`)——
--    **6 個八格全中, 只有一個缺口**:`01-0110058` 打成 `010110058`(去掉 `-`)⇒ **0 筆**。
--    📎 那張表 = `~/pcm-mailbox/量-料號七種寫法-20260904-auth.md`
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🎯 成因:料號那一塊要求「詞裡必須有【字母】」, 而那個條件是【刻意的】
-- ══════════════════════════════════════════════════════════════════════════
--    庫上那支自己的註解逐字寫著理由:
--      「少了它, 打 `a` ⇒ 前綴 `A%` ⇒ **命中所有 A 開頭的料號**。」
--    ⇒ 🔴 全數字的 `010110058` 走不進去;而第①塊的 `ILIKE '%010110058%'`
--       又對不上原文 `01-0110058`(中間有 `-`)⇒ **兩條路都不通 ⇒ 0 筆。**
--
--    📌 **那個條件擋的是【短的】, 而它順手擋掉了【長的全數字】。**
--       ⇒ 本支只把「長的」放回來, **短的原樣不動。**
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🔴🔴 門檻為什麼是 7 不是 9 —— 而每一個數字都是量的, 不是挑的
-- ══════════════════════════════════════════════════════════════════════════
-- 量測環境:正式庫唯讀連線 · 2026-09-04 晚 · 分母 = `delisted_at IS NULL` 的 **24,478** 件
--
-- ① **這個放寬到底要服務誰**(活著 + 正規化後全數字 + 原文有分隔符 ⇒ 現行兩條路都撈不到):
--    ```
--    01-0110058     ⇒ 010110058    (gilles)   9 位
--    01022.4501-01  ⇒ 01022450101  (gilles)  11 位
--    🎯 全站【就這 2 筆】。最短 = 9。
--    ```
-- ② **短的全數字會不會被拖進來 ⇒ 不會, 而理由是量到的**:
--    全站正規化後全數字的料號共 **531** 筆、最短 3 位;
--    而其中 **529 筆今天就撈得到** —— 它們原文本身沒有分隔符 ⇒ 第①塊 `ILIKE '%931%'` 直接命中。
--    🔬 線上實測:打 `931` ⇒ 6 筆(第一筆 `lightech-931b`)· 打 `0041` ⇒ 3 筆(第一筆 `bonamici-0041`)
--    ⇒ 📌 **放寬不需要涵蓋短的。短的不是壞的。**
-- ③ **爆炸半徑, 帶正對照**:
--    ```
--    一個 k 位純數字的詞前綴命中幾筆:k=1 ⇒ 271 · k=3 ⇒ 152 · k=6 ⇒ 10 · k=7 ⇒ 7 · k=9 ⇒ 1
--    🟢 對照組(今天【已經允許】的詞):有字母又有數字的 2 字詞 ⇒ 最壞 348
--                                      同樣形狀的 4 字詞      ⇒ 最壞 3,528
--    ⇒ 🎯 門檻 7 的最壞是 7 筆 —— 比今天已經在發生的小【兩個量級】⇒ 不是新風險。
--    ```
-- ④ 🔴🔴 **而門檻寫 7 不寫 9, 是刻意的**:
--    今天全站最短的那一筆是 **9** 位 ⇒ 🛑 **一個剛好等於今天最小值的門檻, 明天就會被撞** ——
--    下一個供應商送來一個 7 位或 8 位的全數字料號, 那一列就會靜靜地撈不到,
--    而**撈不到不會有人回報, 客人只會覺得我們沒賣**。
--    ⇒ ✅ 7 留了兩格餘裕, 而它的代價(最壞 7 筆 vs 9 的最壞 1 筆)在上面量過了。
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🟢 兩個世界各餵一發 —— 而本檔把它寫成【會紅的斷言】, 不是寫成一段話
-- ══════════════════════════════════════════════════════════════════════════
--    事後閘⑥在同一個交易裡, **貼之前先量一次、貼之後再量一次**, 逐詞比對:
--    ```
--    010110058     0 ⇒ 1   🟢 該修好的修好了
--    01022450101   0 ⇒ 1   🟢
--    987654321     0 ⇒ 0   🟢 負對照:一個不存在的 9 位數字仍然回 0(沒有退化成「找最像的」)
--    13 / 100 / 931 / 0041 / 123456   ⇒ 前後【必須完全相等】🟢 該不動的沒動
--    ```
--    📌 **⇒ 這不是「我唯讀模擬過」, 是這支 SQL 自己會在你的庫上量一遍。對不上就整份回滾。**
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🔴 回退
-- ══════════════════════════════════════════════════════════════════════════
--    把 `20260904030000` 那支的函式本體原樣 `CREATE OR REPLACE` 回去即可(同名同簽章、ACL 不動)。
--    ⚠️ 而本支的前置閘④c 會擋住重貼 ⇒ 回退後想再貼一次, 那道閘會自己放行(條件變回 false)。

BEGIN;

-- ── 前置閘:庫上那一支必須就是我抄的那一代 ──────────────────────────────────
DO $$
DECLARE
  v_def  text;
  v_code text;   -- v_def 剝掉 `--` 註解之後的樣子
  v_md5  text;
BEGIN
  IF to_regclass('public.products_public') IS NULL THEN
    RAISE EXCEPTION '前置閘①:找不到 public.products_public';
  END IF;

  SELECT pg_get_functiondef(p.oid), md5(p.prosrc) INTO v_def, v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'storefront_search_product_ids'
     AND pg_get_function_identity_arguments(p.oid) = 'p_terms text[]';

  IF v_def IS NULL THEN
    RAISE EXCEPTION '前置閘②:public.storefront_search_product_ids(p_terms text[]) 不存在 ⇒ 停下來查部署態, 不要讓本支替你創造它。';
  END IF;

  -- 🔴 **釘身分**:我抄的是 2026-09-04 晚間正式庫上的那一版。
  --    ⚠️ 這道閘紅了**不代表壞掉** —— 它代表「有人在我量完之後改過這支函式」
  --       ⇒ 🛑 **停下來, 去比對 `pg_get_functiondef`, 不要硬貼** ——
  --          因為 `CREATE OR REPLACE` 會把對方的改動整個蓋掉, 而它不會出聲。
  IF v_md5 <> 'a5d89aa5dfad14e6cdb9182bb58cdfd6' THEN
    RAISE EXCEPTION '前置閘③:庫上那支的 prosrc md5 是 % ⇒ 不是我抄的那一代(期望 a5d89aa5dfad14e6cdb9182bb58cdfd6)⇒ 有人改過它 ⇒ 停下來比對, 不要讓 REPLACE 蓋掉別人的改動。', v_md5;
  END IF;

  -- 🔴🔴 **先剝 `--` 註解再找** —— `pg_get_functiondef` 含函式體裡的註解,
  --    而我的新本體裡就寫著一行講門檻的註解 ⇒ 不剝的話, 貼第二次時這道閘會【放行】。
  --    📌 那是「註解被當成碼」那一族:一道防它的守門, 長得像那個東西本身。
  v_code := regexp_replace(v_def, '--[^' || chr(10) || ']*', '', 'g');

  IF position('regexp_replace(p.external_id' IN v_code) = 0 THEN
    RAISE EXCEPTION '前置閘④a:庫上那支(剝註解後)沒有料號正規化那一塊 ⇒ 它不是 030000 那一代 ⇒ 停。';
  END IF;
  IF position('b.name' IN v_code) <> 0 THEN
    RAISE EXCEPTION '前置閘④b:庫上那支(剝註解後)還含 `b.name` ⇒ 它是拆三塊【之前】那一代 ⇒ 先貼 20260904030000。';
  END IF;
  -- ④c 🔴 擋重貼:本支加的東西若已經在庫上, 停。
  IF position('length(regexp_replace(t.term' IN v_code) <> 0 THEN
    RAISE EXCEPTION '前置閘④c:庫上那支已經含長度門檻 ⇒ **本支已經貼過了** ⇒ 不要重貼。';
  END IF;
END
$$;

-- ── 🔬 貼之前先量一次(兩個世界的「之前」那一半)────────────────────────────
--    🔴 `ON COMMIT DROP` ⇒ 這張表只活在本交易裡, 不留痕。
CREATE TEMP TABLE _partno_before ON COMMIT DROP AS
SELECT t.term,
       (SELECT count(*) FROM public.storefront_search_product_ids(ARRAY[t.term])) AS n
  FROM (VALUES
          ('010110058'),      -- 🎯 該被修好的(01-0110058)
          ('01022450101'),    -- 🎯 該被修好的(01022.4501-01)
          ('987654321'),      -- 🟢 負對照:不存在的 9 位數字
          ('13'), ('100'), ('931'), ('0041'), ('123456')   -- 🟢 該完全不動的
       ) AS t(term);

-- ── 本體 ──────────────────────────────────────────────────────────────────
-- 🔴 **刻意【不寫】 SECURITY DEFINER** —— 預設 INVOKER, 那是本片的安全前提。
-- 🔵 **也刻意不寫 `SET search_path`** —— INVOKER + 只讀具名 `public.` 物件、零提權面。
-- 🛑 **本體逐字抄自 2026-09-04 晚正式庫的 `pg_get_functiondef`, 只改了料號那一塊的一個條件。**
--    其餘每一行註解都是原作者寫的, 一個字都沒動 —— 那些註解裡住著拍板紀錄。
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
  -- ⚠️ 兩份清單都空是**明示**:本檔沒有新建任何可授權物件 —— 它 REPLACE 一支既有函式,
  --    而 `CREATE OR REPLACE FUNCTION` 保留既有 ACL ⇒ 沒有新的收權面。
  v_relations text[] := ARRAY[]::text[];
  v_functions text[] := ARRAY[]::text[];
  v_acl  text;
  v_cnt  bigint;
  v_all  bigint;
  v_code text;
  r      record;
BEGIN
  IF cardinality(v_relations) <> 0 OR cardinality(v_functions) <> 0 THEN
    RAISE EXCEPTION '收權斷言:本檔宣稱不新建物件, 而清單非空 ⇒ 兩者矛盾, 停下來看。';
  END IF;

  -- ── ① 字面:新條件真的在庫上那支裡(剝註解後看, 免得看到自己寫的那行說明)──
  SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g')
    INTO v_code
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'storefront_search_product_ids';
  -- 🛑 **這裡刻意【不數次數】** —— 期望值若是「出現 N 次」, 那個 N 是我照著自己要寫的碼數出來的,
  --    ⇒ 它從出生起就不可能抓到我寫錯的東西。(2026-09-04 多顆膠囊那支第一版就是這樣失敗的。)
  --    ⇒ ✅ 只問「在不在」, 而**行為那一半交給下面的 ⑥**。
  IF position('length(regexp_replace(t.term' IN v_code) = 0 THEN
    RAISE EXCEPTION '事後閘①:長度門檻那個條件不在庫上那支裡 ⇒ REPLACE 沒有貼上我以為的東西。';
  END IF;
  IF position('>= 7' IN v_code) = 0 THEN
    RAISE EXCEPTION '事後閘①b:門檻數字 7 不在庫上那支裡。';
  END IF;

  -- ── ② ACL:REPLACE 不該動授權 ──────────────────────────────────────────
  SELECT coalesce(p.proacl::text, '') INTO v_acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'storefront_search_product_ids';
  IF v_acl = '' THEN
    RAISE EXCEPTION '事後閘②⓪:proacl 是 NULL ⇒ 既有授權被吹掉了, 等於 PUBLIC 叫得動';
  END IF;
  IF v_acl LIKE '%{=%' OR v_acl LIKE '%,=%' THEN
    RAISE EXCEPTION '事後閘②a:PUBLIC 出現在 ACL 裡 ⇒ %', v_acl;
  END IF;
  IF NOT has_function_privilege('anon', 'public.storefront_search_product_ids(text[])', 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘②b:anon 執行不到 ⇒ 顧客站會拿不到結果';
  END IF;
  -- 🔵 負對照:一個沒被 GRANT 的角色必須執行不到 —— 否則上面那個 true 沒有判別力
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pcm_readonly')
     AND has_function_privilege('pcm_readonly', 'public.storefront_search_product_ids(text[])', 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘②c:pcm_readonly 也執行得到 ⇒ 上面那個 anon=true 沒有判別力';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='storefront_search_product_ids' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION '事後閘②d:本支是 SECURITY DEFINER ⇒ 那是把客人的查詢升權';
  END IF;

  -- ── ③ 原有的兩端行為閘照抄(空詞不得回全表 / 字面 % 不得當萬用字元 / 正對照)──
  SELECT count(*) INTO v_all FROM public.products_public;
  SELECT count(*) INTO v_cnt FROM public.storefront_search_product_ids(ARRAY[]::text[]);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '事後閘③a:空詞回了 % 列(期望 0)', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM public.storefront_search_product_ids(ARRAY['%']);
  IF v_cnt = v_all THEN
    RAISE EXCEPTION '事後閘③b:`%%` 回了全表 % 列 ⇒ 逃脫沒生效', v_all;
  END IF;
  SELECT count(*) INTO v_cnt FROM public.storefront_search_product_ids(
    ARRAY[(SELECT substr(title, 1, 4) FROM public.products_public
            WHERE title IS NOT NULL AND length(title) >= 4 ORDER BY id LIMIT 1)]);
  IF coalesce(v_cnt, 0) = 0 THEN
    RAISE EXCEPTION '事後閘③c:正對照 —— 拿一筆真商品標題前四個字去搜回了 0 列 ⇒ 這支對什麼都回 0 ⇒ ③a/③b 沒有判別力';
  END IF;
  SELECT count(*) INTO v_cnt FROM public.storefront_search_product_ids(
    ARRAY[(SELECT external_id FROM public.products_public
            WHERE external_id ~ '[0-9]' AND external_id ~ '[A-Za-z]'
            ORDER BY id LIMIT 1)]);
  IF coalesce(v_cnt, 0) = 0 THEN
    RAISE EXCEPTION '事後閘③d:拿一筆真料號去搜回了 0 列 ⇒ HAVING 的 DISTINCT 掉了';
  END IF;

  -- ── ⑥ 🔴🔴 **兩個世界各餵一發 —— 貼前 vs 貼後, 逐詞比對** ────────────────
  --    🎯 這一格是本支的核心斷言:它同時證明「該修好的修好了」與「該不動的沒動」,
  --       而**兩邊都要**成立 —— 只驗前者的話, 一個「全數字通通放行」的實作也會全綠。
  FOR r IN
    SELECT b.term, b.n AS n_before,
           (SELECT count(*) FROM public.storefront_search_product_ids(ARRAY[b.term])) AS n_after
      FROM _partno_before b
     ORDER BY b.term
  LOOP
    IF r.term IN ('010110058', '01022450101') THEN
      IF r.n_before <> 0 THEN
        RAISE EXCEPTION '事後閘⑥a:`%` 在貼之前就回了 % 列 ⇒ 前提不成立(它本來就撈得到)⇒ 停下來重新量, 不要照貼。', r.term, r.n_before;
      END IF;
      IF r.n_after <> 1 THEN
        RAISE EXCEPTION '事後閘⑥b:`%` 貼完回了 % 列(期望 1)⇒ 修法沒有落在目標上。', r.term, r.n_after;
      END IF;
    ELSIF r.term = '987654321' THEN
      -- 🟢 負對照:一個不存在的 9 位數字必須仍然回 0 —— 否則「放寬」變成了「退化成找最像的」
      IF r.n_after <> 0 THEN
        RAISE EXCEPTION '事後閘⑥c:負對照 `987654321` 貼完回了 % 列(期望 0)⇒ 放寬變成了亂撈。', r.n_after;
      END IF;
    ELSE
      -- 🟢 該完全不動的:13 / 100 / 931 / 0041 / 123456
      IF r.n_before <> r.n_after THEN
        RAISE EXCEPTION '事後閘⑥d:短詞 `%` 的結果變了(% ⇒ %)⇒ 門檻沒有守住, 短的被拖進料號那條路了。', r.term, r.n_before, r.n_after;
      END IF;
    END IF;
  END LOOP;

  -- 🔵 而 ⑥ 自己也需要一格正對照:上面那張表若是空的, 整個 LOOP 一次都不跑而全綠。
  SELECT count(*) INTO v_cnt FROM _partno_before;
  IF v_cnt <> 8 THEN
    RAISE EXCEPTION '事後閘⑥e:貼前那張量測表有 % 列(期望 8)⇒ ⑥ 的 LOOP 沒有跑完該跑的世界 ⇒ 它的綠沒有判別力。', v_cnt;
  END IF;
END
$$;

COMMIT;
