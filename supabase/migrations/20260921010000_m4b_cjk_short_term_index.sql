-- 20260921010000_m4b_cjk_short_term_index.sql
-- ⟦search-CJK2CHARTIMEOUT⟧ 中文 1-2 個字的搜尋撞 3 秒上限 —— 改走「中文字索引」
--
-- Sean 2026-09-20 拍 Q1 乙(自建索引)· 2026-09-21 拍甲:區塊① 把短詞切出去 ·
-- 2026-09-21 拍甲:改良版(1 字與 2 字都修、只收中文詞、英文照舊;codex 設計審推薦)。
-- plan:docs/plans/2026-09-20-cjk-two-char-search-seqscan-plan.md
-- 設計審全文:~/pcm-mailbox/codex-中文短詞搜尋設計審-20260921.txt
--
-- ── 為什麼 ─────────────────────────────────────────────────────────────────
-- pg_trgm 切 3 字一組;少於 3 字的 `%詞%` 切不出來 ⇒ 四欄 ILIKE 只能全表掃。
-- 正式庫 2026-09-20 EXPLAIN:碳(1 字)/ 煞車(2 字)Seq Scan cost 8679.66;排氣管(3 字)BitmapOr 2022.86。
-- 客人端(Vercel log):1 字 / 2 字中位 4,844 / 3,020 ms;3 字 325 ms;6 次 57014 逾時全是 ≤2 字。
--
-- ── 做什麼(三件)──────────────────────────────────────────────────────────
-- ① 新函式 public.pcm_cjk_grams(title, subtitle, description, external_id) IMMUTABLE:
--    四欄【各自】切出「單個中文字」與「相鄰兩個中文字」, 去重合併成 text[]。
--    碳纖維 ⇒ {碳,纖,維,碳纖,纖維}。逐欄切 ⇒ 不會拼出跨欄的假兩字(codex must-fix)。
-- ② 部分 GIN 索引 products_cjk_grams_gin_idx(只收上架商品)。
-- ③ 搜尋函式:詞表多一欄 cjk_short(剛好 1-2 個中文字), 區塊① 用 NOT cjk_short 排除,
--    新區塊 ①b 用 cjk_short 接手、以 `@> ARRAY[詞]` 查索引。其餘 5 塊、排序、tier 一字未改。
--    🔴 英文 / 數字 / 符號 / 帶空白 / 3 字以上的詞:cjk_short = false ⇒ 走 ①, 行為不變。
--
-- ── 實測(2026-09-21, 本機拋棄式庫, 正式庫 26,589 件商品四欄原文 + 正式庫函式原文 md5 92639ddd57e8aa92300ef70d210f5840)──
-- 讀數見 plan 檔 §8「2026-09-21 本機驗證」。🛑 正式庫上【還沒】量過 —— 貼完照 §驗收 量。
--
-- ── 鎖 ───────────────────────────────────────────────────────────────────
-- 不能 CONCURRENTLY(貼板每支都包交易)⇒ CREATE INDEX 取 SHARE 鎖:擋【寫】商品、不擋讀, 到 COMMIT 為止。
-- lock_timeout 5s:拿不到鎖(有長交易在寫 products)⇒ 整包放棄、什麼都沒改, 換時段重貼。
-- Sean 2026-09-15 拍:鎖表的板避開客人多的時段 ⇒ 也避開每日同步(rpm-sync)跑的時候。
--
-- ── 權限(照 20260916110000 pcm_search_fold 的前例)─────────────────────────
-- 🔴 索引運算式裡的函式, 寫入 products 的角色【必須】能執行 —— 否則那個角色 INSERT/UPDATE 當場
--    `permission denied for function`(2026-09-21 拋棄式 PG 實測)。
-- 正式庫 2026-09-21 唯讀實查 products 的寫入權:postgres / service_role(anon / authenticated 沒有)。
-- ⇒ pcm_cjk_grams 只給 service_role(postgres 是擁有者);客人走 DEFINER 以 postgres 身分呼叫。
-- 搜尋函式用 CREATE OR REPLACE ⇒ 既有 ACL 保留(事後閘④ 驗四個 grantee;
--    🔴 上一代 20260916140000 是 DROP+CREATE —— 那道閘守的是發生過的事)。
--
-- ── rollback ─────────────────────────────────────────────────────────────
-- supabase/rollbacks/20260921010000-rollback.sql(內含舊函式全文, md5 釘 92639ddd57e8aa92300ef70d210f5840)。
-- 前台 TS 零改動 ⇒ 貼上 / 回滾都不用重部署。
--
-- ── 本檔從 .sql.draft 改名而來 ────────────────────────────────────────────
-- 🔴 草稿階段副檔名不是 .sql ⇒ lint-staged 的 "*.sql" 閘一道都沒跑過它;
--    草稿曾帶 12 處 `pg_catalog.coalesce`(不存在的寫法)而沒被叫。改名後的第一顆 commit 才是第一次被閘看到。

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── 前置閘 ──────────────────────────────────────────────────────────────────
DO $pre$
DECLARE
  v_src text;
BEGIN
  IF pg_catalog.to_regprocedure('public.storefront_search_product_ids(text[])') IS NULL THEN
    RAISE EXCEPTION '前置閘⓪:public.storefront_search_product_ids(text[]) 不存在 ⇒ 停';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.storefront_search_product_ids(text[])'::regprocedure;
  -- ① 基底 = 正式庫 2026-09-21 唯讀讀到的那一版(= 20260916140000);有人改過就停
  IF pg_catalog.md5(v_src) <> '92639ddd57e8aa92300ef70d210f5840' THEN
    RAISE EXCEPTION '前置閘①:搜尋函式本體 md5 = % , 不是本檔抄的那一版(92639ddd57e8aa92300ef70d210f5840)⇒ 有人改過它 ⇒ 停', pg_catalog.md5(v_src);
  END IF;
  -- ② DEFINER + owner postgres(本檔的權限設計建立在這個前提上)
  IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = 'public.storefront_search_product_ids(text[])'::regprocedure)
     OR (SELECT pg_catalog.pg_get_userbyid(p.proowner) FROM pg_catalog.pg_proc p WHERE p.oid = 'public.storefront_search_product_ids(text[])'::regprocedure) <> 'postgres' THEN
    RAISE EXCEPTION '前置閘②:搜尋函式不是 SECURITY DEFINER 或 owner 不是 postgres ⇒ 停';
  END IF;
  -- ③ 新物件名沒被佔用
  IF pg_catalog.to_regprocedure('public.pcm_cjk_grams(text,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘③a:public.pcm_cjk_grams 已存在 ⇒ 停, 先查是誰建的';
  END IF;
  IF pg_catalog.to_regclass('public.products_cjk_grams_gin_idx') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘③b:索引 products_cjk_grams_gin_idx 已存在 ⇒ 停';
  END IF;
  -- ④ 權限設計的前提:會寫 products 的只有 postgres / service_role。多了誰 ⇒ 那個角色寫入會被新索引擋 ⇒ 停下重想
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) x
     WHERE c.oid = 'public.products'::regclass AND x.privilege_type IN ('INSERT', 'UPDATE')
       AND pg_catalog.pg_get_userbyid(x.grantee) NOT IN ('postgres', 'service_role')) THEN
    RAISE EXCEPTION '前置閘④:products 有 postgres / service_role 以外的寫入者 ⇒ 它寫商品會撞 pcm_cjk_grams 的 EXECUTE ⇒ 停';
  END IF;
END
$pre$;

-- ── ① 切字函式 ──────────────────────────────────────────────────────────────
-- 🔴 字元範圍 [\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff] 必須與搜尋函式 cjk_short 那一格【逐字相同】(事後閘⑥)。
--    範圍 = CJK 擴充 A / 基本區 / 相容表意字。擴充 B 以後(U+20000 起)不收 ⇒ 那些詞照舊走 ①。
CREATE FUNCTION public.pcm_cjk_grams(p_title text, p_subtitle text, p_description text, p_external_id text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $fn$
  SELECT coalesce(pg_catalog.array_agg(DISTINCT g.tok), ARRAY[]::text[])
    FROM pg_catalog.unnest(ARRAY[p_title, p_subtitle, p_description, p_external_id]) AS c(txt)
   CROSS JOIN LATERAL (
     SELECT pg_catalog.substr(c.txt, i, 1) AS tok
       FROM pg_catalog.generate_series(1, pg_catalog.length(c.txt)) AS i
      WHERE pg_catalog.substr(c.txt, i, 1) ~ '^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]$'
     UNION ALL
     SELECT pg_catalog.substr(c.txt, i, 2)
       FROM pg_catalog.generate_series(1, pg_catalog.length(c.txt) - 1) AS i
      WHERE pg_catalog.substr(c.txt, i, 2) ~ '^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]{2}$'
   ) AS g
   WHERE c.txt IS NOT NULL;
$fn$;
ALTER FUNCTION public.pcm_cjk_grams(text, text, text, text) OWNER TO postgres;
-- ACL-GATE-EXEMPT: public.pcm_cjk_grams -- 只給 service_role(20260921010000;2026-09-21 正式庫唯讀實查):對 products 有 INSERT/UPDATE 的只有 postgres/service_role, 索引運算式寫入時要能執行(拋棄式 PG 實測沒有 EXECUTE ⇒ permission denied);客人走 DEFINER 以 postgres 呼叫, anon/authenticated 不需要。同 20260916110000 pcm_search_fold 前例
REVOKE ALL ON FUNCTION public.pcm_cjk_grams(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pcm_cjk_grams(text, text, text, text) TO service_role;

-- ── ② 索引:運算式必須與搜尋函式 ①b 那一行【逐字相同】(別名除外), planner 才認得 ─────────
CREATE INDEX products_cjk_grams_gin_idx
  ON public.products USING gin ((public.pcm_cjk_grams(title, subtitle, description, external_id)) pg_catalog.array_ops)
  WHERE delisted_at IS NULL;

-- ── ③ 搜尋函式(正式庫原文 + 三處改動:詞表 cjk_short / 區塊① NOT cjk_short / 新區塊 ①b)──────
-- 🔴 CREATE OR REPLACE 會把 SET 子句整組換掉 ⇒ 下面照原文保留 SECURITY DEFINER + search_path ''。
CREATE OR REPLACE FUNCTION public.storefront_search_product_ids(p_terms text[])
 RETURNS TABLE(id uuid, is_exact boolean, tier smallint)
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
           '%' || replace(replace(replace(term, '\', '\\'), '%', '\%'), '_', '\_') || '%' AS pat,
           -- 🔵 2026-09-16 折疊版的詞與樣式(plan `docs/plans/2026-09-15-storefront-search-normalize-plan.md` §1-2)。
           --    `_` 已被折疊拿掉 ⇒ 只剩 `\` 與 `%` 要逃脫(順序同上:先 `\` 再 `%`)。
           public.pcm_search_fold(term) AS f,
           '%' || replace(replace(public.pcm_search_fold(term), '\', '\\'), '%', '\%') || '%' AS fpat,
           -- 🔵 2026-09-21 ⟦search-CJK2CHARTIMEOUT⟧:【剛好 1-2 個中文字、沒有別的字元】的詞。
           --    這一格決定它走 ①(四欄 ILIKE)還是 ①b(中文字索引)—— 兩塊用【同一欄】的正反兩面, 不會有詞兩邊都走或都不走。
           --    🔴 字元範圍必須與 public.pcm_cjk_grams 函式本體裡的那一串【逐字相同】(事後閘⑥ 比對)。
           --    🔴 詞沒有 trim:'碳 '(帶空白)不符合 ⇒ 照舊走 ①, 行為不變。
           (term ~ '^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]{1,2}$') AS cjk_short
      FROM unnest(coalesce(p_terms, ARRAY[]::text[])) WITH ORDINALITY AS u(term, ord)
     -- 空字串 / 全空白的詞丟掉 —— 留著會變成 `%%` 而那會命中全部
     WHERE btrim(term) <> ''
     -- 🔵 2026-09-16(R1 nit):DISTINCT ON 取【最早出現】的那個 ord ⇒ 重複詞時整串的拼法固定。
     ORDER BY term, ord
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
      JOIN t ON (
           br.name ILIKE t.pat
           -- 🔵 2026-09-16:品牌名也折疊比(`AKRAPOVIČ` ⇒ Akrapovic);品牌表小, 不需要索引, 也不進 products 的 OR。
        OR (t.term ~ '[A-Za-z0-9]' AND length(t.f) >= 4 AND public.pcm_search_fold(br.name) LIKE t.fpat)
      )
  ),
  -- ── hits:三塊各吐 `(id, ord)`, UNION ALL 在【(商品, 詞)】那一層 ──────────
  -- 🛑 **不可以搬到商品那一層**(理由見檔頭「UNION 的層級是正確性核心」)。
  hits AS (
    -- ① 四欄 OR:純 products_public 欄位、零跨表 ⇒ BitmapOr 吃得到 trgm
    SELECT p.id, t.ord
      FROM public.products p
      JOIN t ON (
           -- 🔵 2026-09-21:1-2 個中文字的詞改走 ①b。pg_trgm 對 <3 字切不出 trigram ⇒ 那些詞在這裡是全表掃。
           --    🔴 NOT 要包住【整組】OR —— 接在最後一個 OR 後面只會綁到 external_id 那一格。
           NOT t.cjk_short
       AND (
           p.title       ILIKE t.pat
        OR p.subtitle    ILIKE t.pat
        OR p.description ILIKE t.pat
        OR p.external_id ILIKE t.pat
       )
      )
     -- 🔴 2026-09-11 DEFINER:照 `products_select_public` 原文 `USING (delisted_at IS NULL)` 自己擋下架
     WHERE p.delisted_at IS NULL
    UNION ALL
    -- ①b ⟦search-CJK2CHARTIMEOUT⟧ 1-2 個中文字的詞:比「四欄各自切出來的單字 + 相鄰兩字」
    --    🔴 運算式必須與 products_cjk_grams_gin_idx 的定義【逐字相同】, planner 才用得到索引。
    --    🔵 與 ① 等價:詞只含中文字 ⇒ ILIKE '%詞%' 命中某一欄 ⇔ 那一欄含這個字 / 這兩個相鄰字。
    --       逐欄切(不是四欄串起來再切)⇒ 不會拼出跨欄的假兩字。
    SELECT p.id, t.ord
      FROM public.products p
      JOIN t ON (
             t.cjk_short
         AND public.pcm_cjk_grams(p.title, p.subtitle, p.description, p.external_id) @> ARRAY[t.term]
      )
     -- 🔴 DEFINER 不走 RLS ⇒ 自己擋下架(同 ①);這一行也讓 planner 對得上索引的 WHERE
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
    UNION ALL
    -- ── ⑤ 2026-09-16 折疊比對(plan §1-2 a):`MT07` = `MT-07` = `MT 07`、`AKRAPOVIČ` = `akrapovic` ──────
    -- 🔴 運算式必須與 `products_search_fold_trgm_idx` 逐字相同(別名 p 除外), planner 才認得那支索引。
    -- 🔴 只收【含英文或數字】的詞:純中文折疊前後一樣, 走 ① 的 title trigram 就好, 不多付一次。
    -- 🔴 `length(t.f) >= 4`(R1 must-fix 2 / 3):
    --    · 短詞跨字詞邊界會變寬 —— 資料那邊空白被拿掉後 `R1` 會中「R 1250 GS」、`1.25` 會中所有 125cc;
    --    · 1–2 字的詞 trigram 抽不出三字組 ⇒ 吃不到索引 ⇒ 每列重算 fold(正式庫全掃實測約 470 ms / 詞)。
    --    ⇒ 折完不足 4 碼的詞【不走】這一支, 照舊由 ① 字面比(`R1` / `R6` / `Z9` 行為不變)。
    --    ⇒ 只打符號的詞折完是空字串, 也一併被這道擋下(不會變成 `LIKE '%%'`)。
    --    目標詞都 ≥ 4 碼:mt07 / s1000rr / r1250gs / akrapovic / ohlins。
    SELECT p.id, t.ord
      FROM public.products p
      JOIN t ON (
             t.term ~ '[A-Za-z0-9]'
         AND length(t.f) >= 4
         AND public.pcm_search_fold(coalesce(p.title, '') || ' ' || coalesce(p.subtitle, '')) LIKE t.fpat
      )
     -- 🔴 2026-09-16:照 `products_select_public` 原文 `USING (delisted_at IS NULL)` 自己擋下架
     WHERE p.delisted_at IS NULL
  ),
  -- ── ⑥ 2026-09-16 整串優先(plan §1-2 b):`S 1000 RR` 整串折成 `s1000rr`, 拿來【收窄逐詞 AND 的結果】 ────────
  -- 🔴 觸發條件:兩個詞以上、每個詞都只有英數符號、沒有任何一個詞含 4 個以上連續英文字母、整串含數字
  --    —— 車款代號碎片的形狀(`S 1000 RR` / `R 1250 GS` / `MT 07`)。
  --    帶品牌或英文字(`Akrapovic MT-07` / `Yamaha MT-07` / `Ninja 400`)、混中文(`Akrapovic 排氣管`)一律不觸發。
  -- 🔴🔴 **它只從【每個詞都中】的那批裡挑, 不另找商品**(R1 must-fix 1 + R2 must-fix F1 的修法):
  --    ⛔ ~~第一版:整串只比 title+subtitle, 中了就只回那批~~ ⇒ 品牌 / 描述 / 料號 / 變體找到的商品會被悄悄丟掉。
  --    ⛔ ~~R1 修正版:從 hits(還沒做 HAVING, 中任一詞的商品都在)挑~~ ⇒ R2 F1:
  --       ① `S 1000 RR` 的 `S` 會中大半張表 ⇒ 對幾萬列折疊 description;
  --       ② 只中一個詞、而描述含整串的商品會把 use_ph 打開 ⇒ 每詞都中的商品被刪, 它自己再被 HAVING 擋掉 ⇒ 可能 0 筆。
  --    ✅ 現在:先算 and_ids(= 最後那道 HAVING 的同一個條件), 再看其中有沒有商品在
  --       title / subtitle / description / external_id 任一處(折疊後)含整串;有 ⇒ 只留那些;沒有 ⇒ 原樣回傳。
  --    🔬 正式庫 2026-09-15 唯讀量「第一版會丟掉、而描述或料號其實有寫整串」的件數:
  --       S 1000 RR 32 · MT 07 5 · Z 900 1 · R 1250 GS 0 ⇒ 現在這些都留著。
  --    🔵 描述沒有折疊索引, 但這裡只對 and_ids(每詞都中;正式庫 S 1000 RR 那發 872 列)算 fold, 不掃全表。
  --    🔵 and_ids 帶 `WHERE EXISTS (SELECT 1 FROM ph)`:沒觸發整串優先的查詢(單詞 / 中文 / 帶英文字)一列都不算。
  ph AS (
    SELECT public.pcm_search_fold(string_agg(t.term, '' ORDER BY t.ord)) AS f
      FROM t
    HAVING count(*) > 1
       AND bool_and(t.term ~ '^[A-Za-z0-9._/·-]+$')
       AND bool_and(t.term !~ '[A-Za-z]{4,}')
       AND bool_or(t.term ~ '[0-9]')
  ),
  and_ids AS (
    SELECT h.id
      FROM hits h CROSS JOIN n
     WHERE EXISTS (SELECT 1 FROM ph)
     GROUP BY h.id, n.want
    HAVING count(DISTINCT h.ord) = n.want
  ),
  ph_hits AS (
    SELECT a.id
      FROM and_ids a
      JOIN public.products p ON p.id = a.id
      JOIN ph ON (
             length(ph.f) >= 4
         AND public.pcm_search_fold(coalesce(p.title, '') || ' ' || coalesce(p.subtitle, '') || ' '
                                    || coalesce(p.description, '') || ' ' || coalesce(p.external_id, ''))
             LIKE '%' || replace(replace(ph.f, '\', '\\'), '%', '\%') || '%'
      )
     -- 🔴 2026-09-16:照 `products_select_public` 原文 `USING (delisted_at IS NULL)` 自己擋下架
     WHERE p.delisted_at IS NULL
  ),
  use_ph AS (SELECT EXISTS (SELECT 1 FROM ph_hits) AS yes),
  -- 🔵 收窄只刪列、不補列 ⇒ 下面那道 `count(DISTINCT h.ord) = n.want` 的語意不變(整串命中的那些本來就逐詞都中了)。
  hits2 AS (
    SELECT h.id, h.ord
      FROM hits h CROSS JOIN use_ph u
     WHERE NOT u.yes OR h.id IN (SELECT x.id FROM ph_hits x)
  )
  -- 🎯 ⟦db-SEARCHFACETMUTEX⟧ 2026-09-09:把「完全命中」從【只能排序】變成【看得見的欄位】。
  --   🔴 **原封用下面 ORDER BY 那一段的同一個運算式** —— 抄成兩份會漂,
  --     而漂了之後「排最前的那顆」與「被標成完全命中的那顆」會是不同的商品。
  --   ⇒ 所以下面的 ORDER BY 改成引用這個別名, 而不是再寫一次。
  ,
  -- Q4(20260916140000):命中集合與 is_exact 照 192 一字不動,包成 res 再加 tier 與排序
  res AS (
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
    FROM hits2 h
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
  )
  --   tier 0 料號完全相符 / 1 每個詞都強命中 / 2 部分詞 / 3 其他
  --   強命中 = 標題或副標原字 ILIKE、或 fold(標題 + 副標)(詞 fold 後 ≥ 4,與命中塊⑤同閘:短詞 fold 會跨字邊界變寬,R1 審查 nit)、或 fold(品牌名)(詞 fold 後 ≥ 3)
  --   同層:無真圖排後(與 Q9 同一支 helper)→ 價高在前 → id(分頁穩定)
  SELECT r.id, r.is_exact,
         (CASE
            WHEN r.is_exact THEN 0
            WHEN NOT EXISTS (SELECT 1 FROM t WHERE NOT ((length(t.f) >= 4 AND public.pcm_search_fold(coalesce(p.title, '') || ' ' || coalesce(p.subtitle, '')) LIKE t.fpat)
                  OR p.title ILIKE t.pat OR p.subtitle ILIKE t.pat
                  OR (length(t.f) >= 3 AND public.pcm_search_fold(coalesce(b.name, '')) LIKE t.fpat))) THEN 1
            WHEN EXISTS (SELECT 1 FROM t WHERE ((length(t.f) >= 4 AND public.pcm_search_fold(coalesce(p.title, '') || ' ' || coalesce(p.subtitle, '')) LIKE t.fpat)
                  OR p.title ILIKE t.pat OR p.subtitle ILIKE t.pat
                  OR (length(t.f) >= 3 AND public.pcm_search_fold(coalesce(b.name, '')) LIKE t.fpat))) THEN 2
            ELSE 3
          END)::smallint AS tier
    FROM res r
    JOIN public.products p ON p.id = r.id
    LEFT JOIN public.brands b ON b.id = p.brand_id
   ORDER BY tier,
            public.pcm_card_image_is_placeholder(p.images ->> 0),
            p.price_general DESC NULLS LAST,
            r.id;
$function$;

-- ── 事後閘 ──────────────────────────────────────────────────────────────────
DO $post$
DECLARE
  -- 新建的可授權物件清單(收權斷言在 ③d 逐支跑)
  v_functions text[] := ARRAY['public.pcm_cjk_grams(text,text,text,text)']::text[];
  v_fn    text;
  v_valid boolean;
  v_ready boolean;
  v_got   text;
  r       record;
  v_n     bigint;
BEGIN
  -- ① 搜尋函式本體 = 本檔寫的那一版
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = 'public.storefront_search_product_ids(text[])'::regprocedure) <> '8112e9bbe07a90c44933962b61189ea0' THEN
    RAISE EXCEPTION '事後閘①:搜尋函式本體 md5 不是 8112e9bbe07a90c44933962b61189ea0';
  END IF;
  -- ② 仍是 DEFINER + search_path 空字串
  IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = 'public.storefront_search_product_ids(text[])'::regprocedure)
     OR (SELECT p.proconfig FROM pg_catalog.pg_proc p WHERE p.oid = 'public.storefront_search_product_ids(text[])'::regprocedure)
        IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
    RAISE EXCEPTION '事後閘②:搜尋函式不再是 DEFINER 或 search_path 不是空字串';
  END IF;

  -- ③ 切字函式:IMMUTABLE、輸出值對、ACL 對
  IF (SELECT p.provolatile FROM pg_catalog.pg_proc p WHERE p.oid = 'public.pcm_cjk_grams(text,text,text,text)'::regprocedure) <> 'i' THEN
    RAISE EXCEPTION '事後閘③a:pcm_cjk_grams 不是 IMMUTABLE ⇒ 不能當索引運算式';
  END IF;
  -- 印【值】不是筆數:逐欄切(煞 在 title 尾、車 在 subtitle 頭 ⇒ 不得出現「煞車」)、英數與空白不收、NULL 欄略過
  SELECT pg_catalog.array_to_string(ARRAY(SELECT x FROM pg_catalog.unnest(
           public.pcm_cjk_grams('碳纖維 煞', '車AB', NULL, 'X1')) AS x ORDER BY x COLLATE "C"), ',') INTO v_got;
  -- 排序用 COLLATE "C"(字碼序)⇒ 與資料庫預設排序規則無關
  IF v_got IS DISTINCT FROM '煞,碳,碳纖,維,纖,纖維,車' THEN
    RAISE EXCEPTION '事後閘③b:pcm_cjk_grams 輸出 = % , 期望 煞,碳,碳纖,維,纖,纖維,車', v_got;
  END IF;
  IF (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = 'public.pcm_cjk_grams(text,text,text,text)'::regprocedure) IS NULL THEN
    RAISE EXCEPTION '事後閘③c:pcm_cjk_grams 的 proacl 是 NULL ⇒ 等於 PUBLIC 可執行';
  END IF;
  FOREACH v_fn IN ARRAY v_functions LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '事後閘③d:% 的 EXECUTE 名單不對(anon / authenticated 應為 f、service_role 應為 t)', v_fn;
    END IF;
  END LOOP;

  -- ④ 搜尋函式的四個 grantee 一個都沒掉(CREATE OR REPLACE 保留 ACL;上一代用過 DROP+CREATE)
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_proc p
   CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) x
   WHERE p.oid = 'public.storefront_search_product_ids(text[])'::regprocedure
     AND x.privilege_type = 'EXECUTE'
     AND pg_catalog.pg_get_userbyid(x.grantee) IN ('anon', 'authenticated', 'postgres', 'service_role');
  IF v_n <> 4 THEN
    RAISE EXCEPTION '事後閘④a:搜尋函式的 grantee 從 4 變成 %(是不是被改成 DROP+CREATE 了?)', v_n;
  END IF;
  -- 負對照:同一把尺問一個不存在的角色名 ⇒ 必須 0(證明上面那個 4 不是尺壞了數出來的)
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_proc p
   CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) x
   WHERE p.oid = 'public.storefront_search_product_ids(text[])'::regprocedure
     AND pg_catalog.pg_get_userbyid(x.grantee) = 'qk83m2_negctl_20260921';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '事後閘④b:負對照不是 0 ⇒ 上面那把尺壞了(v_n=%)', v_n;
  END IF;

  -- ⑤ 索引:存在、可用、是部分索引、運算式是 pcm_cjk_grams
  SELECT i.indisvalid, i.indisready INTO v_valid, v_ready
    FROM pg_catalog.pg_index i WHERE i.indexrelid = pg_catalog.to_regclass('public.products_cjk_grams_gin_idx');
  IF v_valid IS DISTINCT FROM true OR v_ready IS DISTINCT FROM true THEN
    RAISE EXCEPTION '事後閘⑤a:products_cjk_grams_gin_idx 不存在或不可用';
  END IF;
  IF position('pcm_cjk_grams' IN pg_catalog.pg_get_indexdef('public.products_cjk_grams_gin_idx'::regclass)) = 0
     OR position('delisted_at IS NULL' IN pg_catalog.pg_get_indexdef('public.products_cjk_grams_gin_idx'::regclass)) = 0 THEN
    RAISE EXCEPTION '事後閘⑤b:索引不是 pcm_cjk_grams 運算式或少了 WHERE delisted_at IS NULL';
  END IF;

  -- ⑥ 兩處字元範圍逐字相同(切字函式 vs 搜尋函式 cjk_short)
  IF position('[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]' IN (SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid = 'public.pcm_cjk_grams(text,text,text,text)'::regprocedure)) = 0
     OR position('[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]{1,2}' IN (SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid = 'public.storefront_search_product_ids(text[])'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '事後閘⑥:兩支函式的中文字範圍不是同一串 ⇒ 會有詞兩邊都不走';
  END IF;

  -- ⑦ 行為閘:拿一件上架商品標題的第一個中文字與前兩個中文字去搜, 那件必須在結果裡(正對照);
  --    同形狀的下架商品必須不在(負對照)。庫裡沒有這種商品 ⇒ NOTICE, 不把沉默印成通過。
  SELECT p.id, pg_catalog.substring(p.title, '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]{2}') AS w INTO r
    FROM public.products p
   WHERE p.delisted_at IS NULL AND p.title ~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]{2}'
   ORDER BY p.id LIMIT 1;
  IF FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.storefront_search_product_ids(ARRAY[r.w]) s WHERE s.id = r.id) THEN
      RAISE EXCEPTION '事後閘⑦a:上架商品 % 用兩字詞「%」搜不到', r.id, r.w;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.storefront_search_product_ids(ARRAY[pg_catalog.left(r.w, 1)]) s WHERE s.id = r.id) THEN
      RAISE EXCEPTION '事後閘⑦b:上架商品 % 用單字詞「%」搜不到', r.id, pg_catalog.left(r.w, 1);
    END IF;
  ELSE
    RAISE NOTICE '事後閘⑦a/b:沒有標題含兩個相鄰中文字的上架商品 ⇒ 本格沒有判別力(不是通過)';
  END IF;
  SELECT p.id, pg_catalog.substring(p.title, '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]{2}') AS w INTO r
    FROM public.products p
   WHERE p.delisted_at IS NOT NULL AND p.title ~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]{2}'
   ORDER BY p.id LIMIT 1;
  IF FOUND THEN
    IF EXISTS (SELECT 1 FROM public.storefront_search_product_ids(ARRAY[r.w]) s WHERE s.id = r.id) THEN
      RAISE EXCEPTION '事後閘⑦c:下架商品 % 用「%」搜得到 ⇒ ①b 沒擋下架', r.id, r.w;
    END IF;
  ELSE
    RAISE NOTICE '事後閘⑦c:沒有標題含中文的下架商品 ⇒ 本格沒有判別力(不是通過)';
  END IF;
END
$post$;

COMMIT;
