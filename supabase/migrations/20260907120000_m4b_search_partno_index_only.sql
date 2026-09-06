-- 20260907120000_m4b_search_partno_index_only.sql
-- pcm:idempotent: yes
--   本檔只建一支索引, 用 `IF NOT EXISTS` 語意的守衛(見下面 DO 區塊)+ 事後斷言。
-- ============================================================================
-- 🔴🔴 **這一支存在的唯一理由:`20260904010000` 【不能貼】, 而 front 只需要它裡面的三行。**
-- ============================================================================
--
-- ══ 病(唯讀對正式庫量到的, 2026-09-07 線【資料】`-db`)═══════════════════════
--   `products_external_id_normalized_idx` 在正式庫 **0 支**(負對照:問一個現造的索引名 ⇒ 也 0
--   ⇒ 尺會動)。而它擋住 front 的 `c850f1424` —— 部署順序閘認為那支函式住在一支未貼的 migration 裡。
--
-- ══ 🔴🔴 為什麼不能直接貼 `20260904010000`(**這一格是本片的重點**)═══════════
--   那支檔 267 行, 而 front 要的只有 `:115-117` 三行的 `CREATE INDEX`。
--   它的 `:124` 還有一發 `CREATE OR REPLACE FUNCTION public.storefront_search_product_ids`,
--   而那是**第 3 代**(`scripts/latest-definition-of.sh` 逐代列:共 7 代, 它排第 3;
--   今天線上是第 7 代 `20260906950000`)。
--   ⇒ 🛑 **貼下去 = 把 58(變體料號)與 62(完全命中排序)整個洗掉** —— 而那兩支是今晚才貼的。
--
--   🔵 **我原本以為它會自己擋住 —— 而那個假設是錯的, 錯的方向比較糟**:
--     它的前置閘①b(`:95`)用 `position('PARTNOSEPINDIGITS' IN pg_get_functiondef(...)) = 0` 判
--     「庫上那支是不是我抄的那一代」。
--     🔬 **唯讀實測(2026-09-07)**:`gate_1b_would_pass = t` ⇒ **那道閘會【放行】**。
--     🔬 **成因是逐代數出來的**:
--     ```
--       20260903230000  PARTNOSEPINDIGITS 4 次   ← 指紋的主人
--       20260904010000                    1 次
--       20260904030000                    1 次
--       20260904180000                    1 次
--       20260906900000                    1 次
--       20260906950000                    1 次   ← 今天線上這一代
--     ```
--     ⇒ 📌 **那個字面被【後面每一代繼承了】** ⇒ 它從「認第 3 代」退化成「第 3 代以後都答 yes」
--     ⇒ 🛑 **一道【釘身分】的閘, 在它保護的東西演化之後, 靜靜退化成一道【釘存在】的閘,
--       而退化的方向是【放行】。**
--   ⇒ ✅ 處置(主視窗 `-f1` 2026-09-07 裁):`20260904010000` 改成作廢殼(同顆), 本檔只建索引。
--
-- ══ 🔵 為什麼**不用** `CONCURRENTLY`(主視窗 2026-09-07 裁「乙」)═══════════════
--   `CREATE INDEX CONCURRENTLY` 不能在交易區塊裡 ⇒ 本檔就不能有 `BEGIN;/COMMIT;`
--   ⇒ 那與貼板每一支的形狀都不同, 連 `apply-paste-board.sh` 的 `-1` 判斷都要跟著改。
--   🔬 而 `public.products` 今晚量到 **25,769 列**(線【出貨】`-ship` 量, 我未複驗 ⇒ 標明來源)
--   ⇒ 建這種表達式索引的短鎖遠小於「天亮前改貼板路徑形狀」的風險。
--   ⚠️ **代價明寫**:建索引期間 `public.products` 的**寫入**會被擋住(讀不受影響)。
--     ⇒ 82b 有一格量【實際幾秒】—— 那個數字沒有人事先知道。
--
-- ══ 🛑 它答不出什麼 ══════════════════════════════════════════════════════════
--   · **本檔不保證那支索引【會被用到】** —— 板列 `⟦search-TRGMEXPRIDX⟧` 逐字記過:
--     「只有在 pattern 是參數/常數時才吃得到;pattern 若是每列算出來的, planner 用不到它」。
--     ⇒ 📌 **「索引建好了」與「搜尋變快了」是兩件事。** 82b 有一格 `EXPLAIN` 去問第二件。
--   · 本檔不動任何函式 ⇒ **搜尋行為零改變**。
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '300s';

-- 🔴🔴 **先把那支函式的身分釘下來(在動任何東西【之前】)** ——
--    事後斷言要比的是「它有沒有變」, 而**「變沒變」需要一個【貼之前】的值**。
--    ⛔ ~~事後去找一個特徵字面(例 `product_variants_public`)~~ —— codex 2026-09-07 R1 must-fix:
--      第 6 代含那個字面而【沒有 62 的排序】;而若第 7 代拿掉變體那一塊, 排序的特徵仍在
--      ⇒ **兩種被倒退的世界都會放行**。📌 **特徵字面答的是「像不像」, 不是「是不是同一個」。**
CREATE TEMP TABLE pcm_82_before ON COMMIT DROP AS
SELECT pg_catalog.md5(p.prosrc) AS fn_md5
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname = 'storefront_search_product_ids'
   -- 🔴 **釘完整簽章**(codex R1):`LIMIT 1` 不指定簽章時可能驗到別支 overload。
   AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_terms text[]';

DO $mk$
DECLARE
  v_oid oid;
  v_def text;
BEGIN
  -- 🔴 用 `to_regclass` 問而不是 `CREATE INDEX IF NOT EXISTS` ——
  --    後者被 `migration-static-checks.sh` 規則① 禁掉(新物件撞名要當場紅)。
  v_oid := pg_catalog.to_regclass('public.products_external_id_normalized_idx');
  -- 🔴🔴 **codex 2026-09-07 R1 must-fix:`to_regclass` 只問【名字】。**
  --    一支同名而**建在別張表 / 別的運算式 / 別的 opclass** 的索引, `indisvalid/indisready` 照樣 t
  --    ⇒ 我會【跳過建立】、覆寫它的 COMMENT、每一格斷言放行, **而我們根本沒有拿到要的那支索引**。
  --    🎯 **這與今晚那個 `PARTNOSEPINDIGITS` 是【同一個病】** —— 拿名字當身分。
  --    ✅ 已存在就比它的**定義字面**;不符 ⇒ 停, 不猜、不改、不覆寫。
  IF v_oid IS NOT NULL THEN
    v_def := pg_catalog.pg_get_indexdef(v_oid);
    IF pg_catalog.strpos(v_def, ' ON public.products ') = 0
       OR pg_catalog.strpos(v_def, 'text_pattern_ops') = 0
       OR pg_catalog.strpos(v_def, 'regexp_replace') = 0
       OR pg_catalog.strpos(v_def, 'USING btree') = 0 THEN
      RAISE EXCEPTION
        '撞名守衛:products_external_id_normalized_idx 已經存在, 而它【不是本檔要的那一支】⇒ 停。實際定義:%',
        v_def;
    END IF;
  ELSE
    EXECUTE $ddl$
      CREATE INDEX products_external_id_normalized_idx
        ON public.products
        ((upper(regexp_replace(external_id, '[^A-Za-z0-9]', '', 'g'))) text_pattern_ops)
    $ddl$;
  END IF;
END $mk$;

COMMENT ON INDEX public.products_external_id_normalized_idx IS
  '料號正規化前綴索引(⟦search-TRGMEXPRIDX⟧)。'
  '🔴 只有在【pattern 是參數或常數】時才吃得到 —— pattern 若是每列算出來的, planner 用不到它。'
  '🛑 所以「這支索引存在」不等於「搜尋走了它」⇒ 要問 EXPLAIN, 不要問 pg_class。'
  '🔵 2026-09-07 由 20260907120000 建立;它取代了 20260904010000(那一支【不能貼】: '
  '同檔還有一發把 storefront_search_product_ids 倒退回第 3 代的 CREATE OR REPLACE)。';

DO $assert$
DECLARE
  v_relations text[] := ARRAY['public.products_external_id_normalized_idx']::text[];
  r text; v_bad text := NULL; v_valid boolean; v_ready boolean; v_src text; v_before text;
BEGIN
  FOREACH r IN ARRAY v_relations LOOP
    IF pg_catalog.to_regclass(r) IS NULL THEN
      v_bad := pg_catalog.concat_ws(' | ', v_bad, r || ':建完之後查無');
    END IF;
  END LOOP;
  -- 🔴 **存在 ≠ 可用**:索引可能是 invalid / 未 ready(CONCURRENTLY 中斷會留下這種)。
  --    本檔沒用 CONCURRENTLY, 而這一格是為了**下一個人改用它時這道斷言仍然管得到**。
  SELECT i.indisvalid, i.indisready INTO v_valid, v_ready
    FROM pg_catalog.pg_index i
   WHERE i.indexrelid = pg_catalog.to_regclass('public.products_external_id_normalized_idx');
  IF v_valid IS DISTINCT FROM true OR v_ready IS DISTINCT FROM true THEN
    v_bad := pg_catalog.concat_ws(' | ', v_bad,
      pg_catalog.format('索引存在而不可用(indisvalid=%s indisready=%s)', v_valid, v_ready));
  END IF;
  -- 🔴🔴 **本片絕不可以動到那支函式** —— 這一格就是在防「有人把 20260904010000 的內容搬進來」。
  -- 🔴🔴 **本片絕不可以動到那支函式** —— 比的是【貼之前 vs 貼之後的 md5】, 不是特徵字面。
  --    ⛔ ~~`position('x' IN (SELECT …))`~~ —— 那個寫法**在執行期才炸**
  --      (`function pg_catalog.position(boolean) does not exist`), 而五道靜態檢查**全綠**
  --      ⇒ 📌 **靜態檢查看得到字面, 看不到型別。只有真的跑一次才問得出來。**
  --    ⛔ ~~改用 `strpos(prosrc,'product_variants_public')`~~ —— codex R1 must-fix:
  --      **特徵字面答的是「像不像」, 不是「是不是同一個」**(第 6 代含它而沒有 62 的排序)。
  SELECT pg_catalog.md5(p.prosrc) INTO v_src
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'storefront_search_product_ids'
     AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_terms text[]';
  SELECT b.fn_md5 INTO v_before FROM pcm_82_before b;
  IF v_src IS DISTINCT FROM v_before THEN
    v_bad := pg_catalog.concat_ws(' | ', v_bad,
      pg_catalog.format('storefront_search_product_ids(text[]) 的 body 變了(貼前 %s ⇒ 貼後 %s)⇒ 停',
                        coalesce(v_before,'(查無)'), coalesce(v_src,'(查無)')));
  END IF;
  -- 🔴 而「貼前就查無」也要紅 —— 否則函式不存在的世界會靜靜通過(兩邊都是 NULL ⇒ 不 DISTINCT)。
  IF v_before IS NULL THEN
    v_bad := pg_catalog.concat_ws(' | ', v_bad,
      'storefront_search_product_ids(text[]) 貼前就查無 ⇒ 這個庫不是我以為的那個 ⇒ 停');
  END IF;
  -- 🛑 **這一格答不出「這個庫【本來】就已經被倒退了嗎」** —— 貼前貼後都是同一個舊值 ⇒ 它會放行。
  --    ⇒ 📌 **本檔的承諾是「我沒有動它」, 不是「它是對的那一代」。兩件事不同。**
  --    ✅ 「它是不是對的那一代」由**對帳檔 82b 第 4 格**回答(那裡釘死 md5 8ca57ae3…),
  --      而那一格**貼前就要跑一次** —— 這正是「貼前貼後各跑一次」存在的理由。
  --    ⚠️ 舊版那個 `strpos(prosrc,'product_variants_public')` 有一半的這個能力,
  --      而它同時是**假的**(codex R1:第 6 代含那個字面而沒有 62 的排序)
  --      ⇒ 拿掉它不是放寬, 是把一個【看起來會擋而其實不會】的東西換成一個誠實的分工。
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '料號索引事後斷言失敗:%', v_bad;
  END IF;
END $assert$;

COMMIT;
