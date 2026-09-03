-- pcm:never-apply
--
-- 🛑🛑 **本支【刻意不貼】—— 而它不是「還沒貼」。**(2026-09-04)
--    行為全綠(34 格, 含那條跨兩半的 AND), 而**它的目的沒有被證明達成**:
--    索引**沒有被用到**(`pg_stat_user_indexes.idx_scan` 增量 = 0, 而計數器本身驗過會動),
--    而成因**未解** —— 見 `docs/launch-todo.md` ⟦search-PLPGSQLINDEXMISS⟧。
--    ⇒ 🔴 **而這一片的全部意義就是那個目的** ⇒ 貼一個「行為正確而效益未證」的東西,
--      **我們會以為那一格解決了, 而中文搜尋還是 1.9 秒, 而沒有人會回頭查一件『做完了』的事。**
--    ⇒ 🛑 **⇒ 它不得被讀成「料號與中文兩個都解決了」** —— 那一格今天**仍然是二選一**。
--    ✅ 保留理由:①一格【會綠的】不變式測試(它證明拆法本身是對的)
--                ②三發正/負對照的完整紀錄(哪一種 pattern 吃得到索引)
--                ③那個未解的謎 —— 下一個人不必重走
--
-- M-4b · 料號那半改成【吃得到索引】的形狀 —— 而中文搜尋因此拿回 trgm
--
-- 🔴🔴 **本函式的前一版在 `20260903230000_…:188`。**(再前一版 `20260903050000:84`)
--    ⇒ 📌 `bash scripts/latest-definition-of.sh storefront_search_product_ids` 會列出三代。
--    ⇒ 🛑 **抄它去改的人:抄【本支】。**
--
-- ── 它要解的那件事(而它是【我上一支造成的】)────────────────────────────
--    `20260903230000` 為了讓 `g30010` 找得到 `G3-0010`,在那個大 `OR` 裡加了一條
--    **表達式**分支 `upper(regexp_replace(p.external_id,…)) LIKE …`。
--    🛑 而 `20260903060000`(四支 trgm GIN)檔頭 :51-53 逐字警告過這件事:
--      「planner 要走 BitmapOr **需要 OR 的每一個分支都有可用索引**;
--        少一欄 ⇒ 那一支只能 Seq Scan ⇒ **整個 OR 退回全表掃**」
--    ⇒ 🎯 **⇒ 我加的正是那種分支 ⇒ 四支 trgm 索引【一支都用不到】。**
--
--    🔬 **鑽機實測(22,804 列 + 四支 trgm 索引, EXPLAIN 讀的是 plan 裡的索引名)**:
--    ```
--      只有四欄 ILIKE(unnest 版)  ⇒ BitmapOr=1 · trgm 節點=4 · **1.22 ms**
--      加上那條表達式分支          ⇒ BitmapOr=0 · trgm=0 · Seq Scan · **39.9 ms**
--    ```
--    🔵 而正式站黑箱計時方向一致:「碳纖維」1.87~2.10 s(而 060000 的判準是 < 0.5 s)。
--
-- ── 🔴 而【為什麼那個守衛救不了】—— 這一格是整支檔的關鍵 ──────────────────
--    上一版那條分支**有守衛**:`t.term ~ '[0-9]' AND t.term ~ '[A-Za-z]'`
--    ⇒ 對 `碳纖維` 兩個都是 false ⇒ 直覺上「中文不會走到那條」。
--    🛑 **而那是【runtime】的假,不是【plan time】的假** ——
--      `t.term` 來自 `unnest(p_terms)` ⇒ **planner 折不掉它**
--      ⇒ 📌 **那條分支留在計畫裡, 每一種查詢(含中文)都帶著它。**
--    ⇒ 🎯 **⇒ 所以「再加一個條件」修不好它。差別在【誰在什麼時候決定】。**
--
--    🔬 **而這一格我量錯過一次, 記在這裡因為它會再騙下一個人**:
--      我第一版的實驗把詞寫成 `(select 'akrapovic'::text as term)` —— **那是常數**
--      ⇒ planner 把守衛折掉了 ⇒ 兩邊都 BitmapOr=1 ⇒ **我差點回報「我的分支沒有影響」**。
--      ⇒ ✅ 換成 `unnest(ARRAY[…])`(= 真實形狀)才顯形。
--      ⇒ 📌 **⇒ 我的 harness 犯了它要測的那個錯 —— 常數 vs 非常數。**
--
-- ── ✅ 修法:料號那半改成【每個詞一發、pattern 當參數】────────────────────
--    🔬 **前提已證(22,804 列, 讀 plan 裡的索引名, 不是毫秒數)**:
--    ```
--      🟢 pattern 是【參數】(PREPARE/EXECUTE 模型)⇒ 索引名=1 · Seq=0 · 0.349 / 0.893 ms
--      🔴 pattern 每列算(上一版形狀)            ⇒ 索引名=0 · Seq=1 · 45.6 ms
--      🔴 同上 + `enable_seqscan=off`             ⇒ 索引名=0 · Seq=1 · 32.5 ms
--    ```
--    🎯 **⇒ 第三發把「做不到」與「planner 不想」分開了** —— 少了它,第二發有兩種讀法。
--    ⚠️ 而那是 `PREPARE/EXECUTE` **模型**, 不是這支函式本人 ⇒ **貼完要在鑽機上重量一次**。
--
-- ── 🔴🔴 而拆兩半之後,**有一條不變式沒有人保證了** ────────────────────────
--    上一版靠 `HAVING count(DISTINCT t.ord) = n.want` 保證「**每一個詞都要中**」,
--    而**一個詞可以只靠料號命中** —— 那條 AND 是**跨兩半**的。
--    🛑 **⇒ 拆掉之後不能寫成「文字結果 UNION 料號結果」** ——
--      那會 UNION 兩個**已經各自套過 HAVING** 的集合
--      ⇒ A 詞只中文字、B 詞只中料號的商品, **兩邊都不滿足 want ⇒ 聯集後它消失**。
--    ✅ **⇒ 正確形狀:先聯集【(商品, 詞) 命中對】, 再套 HAVING。** 本檔就是這樣寫的。
--    ✅ **⇒ 而那條不變式有守門了**:`scripts/storefront-search-brand-verify.sh` 的 **G 族**
--      (G3 = 兩個詞各中一半 ⇒ 仍要命中)。**它在改這支之前就寫好並跑綠過**,
--      用途正是**在拆的過程中變紅**。
--
-- ── 為什麼索引與函式在【同一支】 ──────────────────────────────────────────
--    分兩支貼會有一段「函式改了而索引還沒有」的窗口,而那一刻是**最慢的形狀**
--    (料號那半走參數化查詢卻沒有索引 ⇒ 每個詞一發全表掃)。⇒ 一支,原子。
--
-- ── 權限 ──────────────────────────────────────────────────────────────────
--    `CREATE OR REPLACE` 且**參數型別一個字沒變**(`p_terms text[]`)⇒ **保留舊 ACL**
--    (依據 `docs/patterns/revoking-function-execute-in-supabase.md:153`,2026-08-16 實跑的表)。
--    🔴 改簽名 = 多一支函式、而新簽名重新拿到 anon 授權 ⇒ **禁止**。
--    ⚠️ 而**語言從 `sql` 改成 `plpgsql`** —— 那不是簽名,ACL 不受影響(事後閘②會驗)。

BEGIN;

DO $$
DECLARE
  v_def text;
BEGIN
  -- 前置閘①:那支函式必須已經存在, **而且是我抄的那一代**(釘身分不是釘存在)
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'storefront_search_product_ids'
     AND pg_get_function_identity_arguments(p.oid) = 'p_terms text[]';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '前置閘①a:public.storefront_search_product_ids(p_terms text[]) 不存在 ⇒ 停下來查部署態。';
  END IF;
  IF position('PARTNOSEPINDIGITS' IN v_def) = 0 THEN
    RAISE EXCEPTION '前置閘①b:庫上那支【不含 20260903230000 的特徵字面】⇒ 它不是我抄的那一代。停下來比對 pg_get_functiondef。';
  END IF;

  IF to_regclass('public.products_public') IS NULL THEN
    RAISE EXCEPTION '前置閘②:找不到 public.products_public';
  END IF;
  IF to_regclass('public.brands') IS NULL THEN
    RAISE EXCEPTION '前置閘③:找不到 public.brands';
  END IF;
END
$$;

-- 🔴 料號正規化的表達式索引。**與函式同一支貼**(理由見檔頭)。
--    `text_pattern_ops` 是前綴比對(`LIKE 'X%'`)要用的 opclass —— 預設 opclass 在非 C locale 下
--    **不支援前綴比對**,而那會讓這支索引白建。
-- 🔴 **裸 `CREATE`, 不是 `IF NOT EXISTS`**(`migration-new-file-static-checks` 逼出來的,
--    而它的理由是對的):撞名要**當場紅**。
--    ⇒ 🛑 靜靜跳過的話, 下面那道事後閘③會對著**別人的那個同名索引**跑而且**通過**
--      ⇒ 📌 **拿到綠燈, 而這支 migration 什麼都沒建。**
CREATE INDEX products_external_id_normalized_idx
  ON public.products
  ((upper(regexp_replace(external_id, '[^A-Za-z0-9]', '', 'g'))) text_pattern_ops);

COMMENT ON INDEX public.products_external_id_normalized_idx IS
  '⟦search-TRGMEXPRIDX⟧ 料號正規化前綴索引。🔴 只有在【pattern 是參數/常數】時才吃得到 ——
pattern 若是每列算出來的(如 `LIKE upper(regexp_replace(t.term,…))||''%''`), planner 用不到它
(鑽機實測:強制 enable_seqscan=off 仍然 Seq Scan)。搭配的函式是 storefront_search_product_ids。';

CREATE OR REPLACE FUNCTION public.storefront_search_product_ids(p_terms text[])
RETURNS TABLE (id uuid)
LANGUAGE plpgsql
STABLE
-- 🔴 **仍然刻意不寫 SECURITY DEFINER** —— 預設 INVOKER, 那是這條線的安全前提。
--    ⚠️ 改成 DEFINER = 把客人的查詢升權 ⇒ 要重過鐵則 12②。
-- 🔵 也刻意不寫 `SET search_path`(INVOKER + 只讀具名 public. 物件)。
-- 🛑 **而 `EXECUTE` 用的是【參數化】`USING`, 不是字串拼接** —— 那是本檔唯一的動態 SQL,
--    而它拼進去的只有一個寫死的查詢字面, 使用者輸入永遠走 `$1`。
AS $fn$
DECLARE
  v_terms  text[];
  v_want   int;
  v_i      int;
  v_norm   text;
  v_batch  uuid[];
  v_pn_ids uuid[] := ARRAY[]::uuid[];
  v_pn_ord int[]  := ARRAY[]::int[];
BEGIN
  -- 去空白詞 + 去重(維持上一版 `DISTINCT ON (term)` 與 `btrim(term) <> ''` 的語意)
  SELECT array_agg(DISTINCT btrim(x)) INTO v_terms
    FROM unnest(coalesce(p_terms, ARRAY[]::text[])) AS x
   WHERE btrim(x) <> '';
  v_want := coalesce(array_length(v_terms, 1), 0);
  -- 🔴 零個有效詞 ⇒ 回零列(**不是回全表**)。上一版靠 `WHERE n.want > 0`, 這裡靠早退。
  IF v_want = 0 THEN
    RETURN;
  END IF;

  -- ── 料號那半:**每個詞一發, 而 pattern 走 `USING $1` ⇒ 對 planner 是常數** ──────
  FOR v_i IN 1 .. v_want LOOP
    -- 守衛與上一版逐字相同:同時含字母與數字、正規化後非空。
    -- 🔵 而**這裡的守衛是有效的** —— 它在 plpgsql 裡求值, 不進 planner 的述詞。
    IF v_terms[v_i] ~ '[0-9]' AND v_terms[v_i] ~ '[A-Za-z]' THEN
      v_norm := upper(regexp_replace(v_terms[v_i], '[^A-Za-z0-9]', '', 'g'));
      IF v_norm <> '' THEN
        EXECUTE
          'SELECT array_agg(p.id) FROM public.products_public p'
          || ' WHERE upper(regexp_replace(p.external_id, ''[^A-Za-z0-9]'', '''', ''g'')) LIKE $1'
          INTO v_batch USING v_norm || '%';
        IF v_batch IS NOT NULL THEN
          v_pn_ids := v_pn_ids || v_batch;
          v_pn_ord := v_pn_ord || array_fill(v_i, ARRAY[array_length(v_batch, 1)]);
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- ── 文字那半 + 合併 ────────────────────────────────────────────────────
  -- 🔴🔴 **先聯集【(商品, 詞) 命中對】, 再套 HAVING** —— 見檔頭那條不變式。
  --    ⛔ 不可以「文字結果 UNION 料號結果」(那會 UNION 兩個已套過 HAVING 的集合)。
  RETURN QUERY
  WITH t AS (
    SELECT term, ord FROM unnest(v_terms) WITH ORDINALITY AS u(term, ord)
  ),
  text_hits AS (
    -- 🔵 這五個分支**逐字沿用**上一版 —— 它們是 trgm 索引服務的那個形狀,
    --    而本片的全部意義就是**不要再污染它**。
    SELECT p.id AS pid, t.ord
      FROM public.products_public p
      LEFT JOIN public.brands b ON b.id = p.brand_id
      JOIN t ON (
           p.title       ILIKE '%' || replace(replace(replace(t.term, '\', '\\'), '%', '\%'), '_', '\_') || '%'
        OR p.subtitle    ILIKE '%' || replace(replace(replace(t.term, '\', '\\'), '%', '\%'), '_', '\_') || '%'
        OR p.description ILIKE '%' || replace(replace(replace(t.term, '\', '\\'), '%', '\%'), '_', '\_') || '%'
        OR p.external_id ILIKE '%' || replace(replace(replace(t.term, '\', '\\'), '%', '\%'), '_', '\_') || '%'
        OR b.name        ILIKE '%' || replace(replace(replace(t.term, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      )
     WHERE p.id IS NOT NULL
  ),
  pn_hits AS (
    SELECT pid, ord FROM unnest(v_pn_ids, v_pn_ord) AS z(pid, ord)
  ),
  all_hits AS (
    SELECT pid, ord FROM text_hits
    UNION
    SELECT pid, ord FROM pn_hits
  )
  SELECT ah.pid
    FROM all_hits ah
   GROUP BY ah.pid
  HAVING count(DISTINCT ah.ord) = v_want;   -- 🔴 每一個詞都要中(跨兩半的 AND)
END
$fn$;

COMMENT ON FUNCTION public.storefront_search_product_ids(text[]) IS
  '顧客站搜尋:回傳命中的商品 id(**只回 id,不回任何欄位**)。
🔴 **SECURITY INVOKER(預設)** —— 不要改成 DEFINER(那是把客人的查詢升權,要重過鐵則 12②)。
🔴 **只回 id 是刻意的**:欄位由呼叫端用既有投影(products_public)取。
⟦search-TRGMEXPRIDX⟧ 2026-09-04:料號那半改成【每詞一發、pattern 走 USING $1】
⇒ 對 planner 是常數 ⇒ 吃得到 products_external_id_normalized_idx;
而文字那半維持原形狀 ⇒ **四支 trgm GIN 索引拿回來**(上一版那條表達式分支會讓整個 OR 退回全表掃)。
🔴 不變式:「每一個詞都要中」是**跨兩半**的 —— 先聯集 (商品,詞) 命中對, 再 HAVING。
守門在 scripts/storefront-search-brand-verify.sh 的 G 族。前一版 20260903230000。
🔴 COMMENT ON 是覆寫不是追加 —— 改它的人請把這一段一起帶著。';

-- ── 事後閘 ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_acl text;
  v_cnt int;
BEGIN
  SELECT count(*) INTO v_cnt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'storefront_search_product_ids';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '事後閘⓪:同名函式有 % 支(期望 1)⇒ 簽名被改到了', v_cnt;
  END IF;

  SELECT coalesce(p.proacl::text, '') INTO v_acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'storefront_search_product_ids';
  -- 🔴 語言從 sql 改成 plpgsql ⇒ **而那不是簽名** ⇒ ACL 應該保留。這一格就是在驗那句話。
  IF v_acl = '' THEN
    RAISE EXCEPTION '事後閘①:proacl 是 NULL ⇒ 授權被這次 REPLACE 洗掉了(預期是保留)';
  END IF;
  IF v_acl LIKE '%{=%' OR v_acl LIKE '%,=%' THEN
    RAISE EXCEPTION '事後閘②:PUBLIC 出現在 ACL 裡 ⇒ %', v_acl;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname='public' AND tablename='products'
       AND indexname='products_external_id_normalized_idx'
  ) THEN
    RAISE EXCEPTION '事後閘③:表達式索引沒建起來 ⇒ 料號那半會退化成每詞一發全表掃';
  END IF;

  IF position('USING' IN (
       SELECT pg_get_functiondef(p.oid)
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname='public' AND p.proname='storefront_search_product_ids')) = 0 THEN
    RAISE EXCEPTION '事後閘④:函式本體找不到 USING ⇒ 參數化那一半沒有接上(而那正是本片的全部)';
  END IF;
END
$$;

COMMIT;

-- ── 回退 ──────────────────────────────────────────────────────────────────
-- 🔴 回退 = 把函式換回 `20260903230000` 那一版(逐字抄它的本體,`CREATE OR REPLACE`),
--    **而索引可以留著**(它只是沒有人用,不會讓任何東西變慢除了寫入)。
--    ⚠️ 而回退之後中文搜尋會**再次**吃不到 trgm —— 那是回到 2026-09-04 之前的狀態。
-- ✅ 參數型別不變 ⇒ ACL 一樣保留。而呼叫端(TS)一個字都不必動 —— 本片零碼改。
