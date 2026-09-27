-- 20260927070000_m4b_search_staff_override_titles.sql
-- 商品編輯片 10:客人關鍵字搜尋也比對【員工改過的標題 / 副標】(products.staff_overrides 的 title / subtitle 鍵)
--
-- plan:docs/plans/2026-09-27-search-staff-titles.md(主視窗 2026-09-27 派工;上層 ~/pcm-mailbox/計畫-後台商品編輯與上傳圖片-20260927.md §7 片 10)
--
-- ── 為什麼 ─────────────────────────────────────────────────────────────────
-- 20260927040000 起, 商品頁與目錄卡片顯示「員工的標題優先, 沒填才用供應商的」;
-- 而本函式直接比對 products.title / subtitle(供應商原字)⇒ 客人看得到新標題, 卻用新標題的字搜不到。
-- 目錄頁 / 品牌頁 / 經銷站的關鍵字搜尋(search_catalog_by_vehicle 與 _dealer, 20260922130000)都在裡面呼叫本函式 ⇒ 改這一支就全涵蓋。
--
-- ── 做什麼(兩件)──────────────────────────────────────────────────────────
-- ① 部分索引 products_staff_text_override_idx:只收「上架且員工改過標題或副標」的商品(正式庫 2026-09-27:0 件)。
--    讓新區塊 ①c 只讀這幾件, 不必每次搜尋都整張商品表(64 MB)逐列看 staff_overrides。
--    🔵 索引運算式沒有自訂函式 ⇒ 沒有「寫入商品的角色要能執行索引函式」的問題(對照 20260921010000 檔頭)。
-- ② 搜尋函式(正式庫原文 md5 8112e9bbe07a90c44933962b61189ea0 + 三處改動):
--    · 新命中區塊 ①c:員工標題 / 副標 ILIKE '%詞%', 或(含英數、折完 ≥ 4 碼)折疊比對 —— 規則同 ① 與 ⑤;
--    · ⑥ 整串優先 ph_hits:比對字串多放員工標題 / 副標;
--    · 相關度 tier(Sean 2026-09-15):「強命中」多認員工標題 / 副標(原字或折疊, 同閘)。
--    其餘區塊(①、①b、②、③、④、④b、⑤)、is_exact、排序鍵【一字未改】⇒ 供應商原字照舊搜得到(兩份都比, plan §2 甲)。
--    Sean 09-10 純字母料號相等式(④b)、09-06 零價變體照樣搜得到, 都原封不動。
--
-- ── 實測(2026-09-27, 本機拋棄式 PostgreSQL 17.10, 自造 2 萬件商品;讀數見 plan §4)──
-- 🛑 正式庫上【還沒】量過。
--
-- ── 鎖 ───────────────────────────────────────────────────────────────────
-- CREATE INDEX 取 SHARE 鎖:擋【寫】商品、不擋讀, 到 COMMIT 為止。符合條件的列是 0, 但建索引仍要掃整張 products
-- (正式庫約 64 MB)才知道哪幾列符合 ⇒ 秒級, 不是瞬間(Fable R1 建議訂正)。
-- lock_timeout 5s:拿不到鎖 ⇒ 整包放棄、什麼都沒改。避開每日同步(rpm-sync)與客人多的時段。
--
-- ── rollback ─────────────────────────────────────────────────────────────
-- supabase/rollbacks/20260927070000-rollback.sql(舊函式全文, md5 釘 8112e9bbe07a90c44933962b61189ea0)。
-- 前台 TS 零改動 ⇒ 貼上 / 回滾都不用重部署。

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
  -- ① 基底 = 正式庫 2026-09-27 唯讀讀到的那一版(= 20260921010000);有人改過就停
  IF pg_catalog.md5(v_src) <> '8112e9bbe07a90c44933962b61189ea0' THEN
    RAISE EXCEPTION '前置閘①:搜尋函式本體 md5 = % , 不是本檔抄的那一版(8112e9bbe07a90c44933962b61189ea0)⇒ 有人改過它 ⇒ 停', pg_catalog.md5(v_src);
  END IF;
  -- ② DEFINER + owner postgres
  IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = 'public.storefront_search_product_ids(text[])'::regprocedure)
     OR (SELECT pg_catalog.pg_get_userbyid(p.proowner) FROM pg_catalog.pg_proc p WHERE p.oid = 'public.storefront_search_product_ids(text[])'::regprocedure) <> 'postgres' THEN
    RAISE EXCEPTION '前置閘②:搜尋函式不是 SECURITY DEFINER 或 owner 不是 postgres ⇒ 停';
  END IF;
  -- ③ staff_overrides 已貼(20260927040000):jsonb NOT NULL, 而且有鎖鍵名的 CHECK(title / subtitle 只會是字串)
  IF (SELECT pg_catalog.format_type(a.atttypid, a.atttypmod) || '/' || a.attnotnull::text
        FROM pg_catalog.pg_attribute a
       WHERE a.attrelid = 'public.products'::regclass AND a.attname = 'staff_overrides' AND NOT a.attisdropped)
     IS DISTINCT FROM 'jsonb/true' THEN
    RAISE EXCEPTION '前置閘③a:products.staff_overrides 不存在或不是 jsonb NOT NULL ⇒ 20260927040000 還沒貼 ⇒ 停';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                  WHERE c.conrelid = 'public.products'::regclass AND c.conname = 'products_staff_overrides_shape') THEN
    RAISE EXCEPTION '前置閘③b:少了 CHECK products_staff_overrides_shape ⇒ title / subtitle 的形狀沒人擋 ⇒ 停';
  END IF;
  -- ④ 新索引名沒被佔用
  IF pg_catalog.to_regclass('public.products_staff_text_override_idx') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘④:索引 products_staff_text_override_idx 已存在 ⇒ 停, 先查是誰建的';
  END IF;
END
$pre$;

-- ── ① 部分索引:WHERE 必須與搜尋函式 ①c 的 WHERE【逐字相同】(別名 p 除外), planner 才認得 ─────────
CREATE INDEX products_staff_text_override_idx
  ON public.products (id)
  WHERE delisted_at IS NULL AND (staff_overrides ? 'title' OR staff_overrides ? 'subtitle');

-- ── ② 搜尋函式(正式庫原文 + 三處改動:①c / ph_hits / tier)─────────────────────────
-- 🔴 CREATE OR REPLACE 會把 SET 子句整組換掉 ⇒ 下面照原文保留 SECURITY DEFINER + search_path ''。
--    CREATE OR REPLACE 保留既有 ACL(事後閘③ 驗四個 grantee)。
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
    -- ①c 2026-09-27 商品編輯片 10:員工改過的標題 / 副標(products.staff_overrides 的 title / subtitle 鍵)。
    --    plan docs/plans/2026-09-27-search-staff-titles.md。供應商原字照舊由 ① / ①b / ⑤ 比 ⇒ 兩份都搜得到。
    --    🔴 WHERE 必須與 products_staff_text_override_idx 的條件【逐字相同】, planner 才用得到那支部分索引
    --       ⇒ 只讀「上架且員工改過標題或副標」那幾件, 不整表掃。
    --    🔵 這批很少 ⇒ 中文 1-2 字的詞也直接 ILIKE(與 ①b 切字比對等價, 見 ①b 註解), 不分流。
    --    🔵 折疊那一格與 ⑤ 同閘(含英數、折完 ≥ 4 碼), 理由見 ⑤。
    SELECT p.id, t.ord
      FROM public.products p
      JOIN t ON (
           (p.staff_overrides ->> 'title')    ILIKE t.pat
        OR (p.staff_overrides ->> 'subtitle') ILIKE t.pat
        OR (    t.term ~ '[A-Za-z0-9]'
            AND length(t.f) >= 4
            AND public.pcm_search_fold(coalesce(p.staff_overrides ->> 'title', '') || ' ' || coalesce(p.staff_overrides ->> 'subtitle', '')) LIKE t.fpat)
      )
     WHERE p.delisted_at IS NULL
       AND (p.staff_overrides ? 'title' OR p.staff_overrides ? 'subtitle')
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
         -- 🔵 2026-09-27 片 10:整串也比員工的標題 / 副標(不然員工標題才有整串的商品會被別的擠掉)
         AND public.pcm_search_fold(coalesce(p.title, '') || ' ' || coalesce(p.subtitle, '') || ' '
                                    || coalesce(p.staff_overrides ->> 'title', '') || ' ' || coalesce(p.staff_overrides ->> 'subtitle', '') || ' '
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
  --   🔵 2026-09-27 片 10:強命中也認員工的標題 / 副標(原字 ILIKE 或 fold, 與供應商那兩格同閘);兩份不分先後。
  --   🔴 員工那兩格【必須】coalesce 成 '':沒改過的商品 ->> 是 NULL ⇒ NOT (… OR NULL) = NULL ⇒ 第一個 WHEN 的
  --      NOT EXISTS 會把「沒強命中」的詞漏掉 ⇒ tier 2 被抬成 1(拋棄式 PG 實測:不 coalesce 時 35 組詞裡 487 列 tier 變了)。
  --   ⚠️ 供應商的 p.subtitle 那一格【原版就有同一個現象】(副標是 NULL 的商品會被抬成 tier 1)。
  --      那是既有行為, 本片為了「沒改過標題的商品結果逐筆不變」刻意不動;記在 plan §5, 要修另開一片。
  SELECT r.id, r.is_exact,
         (CASE
            WHEN r.is_exact THEN 0
            WHEN NOT EXISTS (SELECT 1 FROM t WHERE NOT ((length(t.f) >= 4 AND public.pcm_search_fold(coalesce(p.title, '') || ' ' || coalesce(p.subtitle, '')) LIKE t.fpat)
                  OR p.title ILIKE t.pat OR p.subtitle ILIKE t.pat
                  OR coalesce(p.staff_overrides ->> 'title', '') ILIKE t.pat OR coalesce(p.staff_overrides ->> 'subtitle', '') ILIKE t.pat
                  OR (length(t.f) >= 4 AND public.pcm_search_fold(coalesce(p.staff_overrides ->> 'title', '') || ' ' || coalesce(p.staff_overrides ->> 'subtitle', '')) LIKE t.fpat)
                  OR (length(t.f) >= 3 AND public.pcm_search_fold(coalesce(b.name, '')) LIKE t.fpat))) THEN 1
            WHEN EXISTS (SELECT 1 FROM t WHERE ((length(t.f) >= 4 AND public.pcm_search_fold(coalesce(p.title, '') || ' ' || coalesce(p.subtitle, '')) LIKE t.fpat)
                  OR p.title ILIKE t.pat OR p.subtitle ILIKE t.pat
                  OR coalesce(p.staff_overrides ->> 'title', '') ILIKE t.pat OR coalesce(p.staff_overrides ->> 'subtitle', '') ILIKE t.pat
                  OR (length(t.f) >= 4 AND public.pcm_search_fold(coalesce(p.staff_overrides ->> 'title', '') || ' ' || coalesce(p.staff_overrides ->> 'subtitle', '')) LIKE t.fpat)
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
  v_md5   text;
  v_valid boolean;
  v_ready boolean;
  v_def   text;
  v_n     bigint;
  r       record;
BEGIN
  -- ① 搜尋函式本體 = 本檔寫的那一版
  SELECT pg_catalog.md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.storefront_search_product_ids(text[])'::regprocedure;
  IF v_md5 <> '396e7d5ffae1af6bfccf2373ef86413b' THEN
    RAISE EXCEPTION '事後閘①:搜尋函式本體 md5 = % , 不是 396e7d5ffae1af6bfccf2373ef86413b', v_md5;
  END IF;
  -- ② 仍是 DEFINER + search_path 空字串
  IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = 'public.storefront_search_product_ids(text[])'::regprocedure)
     OR (SELECT p.proconfig FROM pg_catalog.pg_proc p WHERE p.oid = 'public.storefront_search_product_ids(text[])'::regprocedure)
        IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
    RAISE EXCEPTION '事後閘②:搜尋函式不再是 DEFINER 或 search_path 不是空字串';
  END IF;

  -- ③ 四個 grantee 一個都沒掉 + 負對照(同 20260921010000 事後閘④)
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_proc p
   CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) x
   WHERE p.oid = 'public.storefront_search_product_ids(text[])'::regprocedure
     AND x.privilege_type = 'EXECUTE'
     AND pg_catalog.pg_get_userbyid(x.grantee) IN ('anon', 'authenticated', 'postgres', 'service_role');
  IF v_n <> 4 THEN
    RAISE EXCEPTION '事後閘③a:搜尋函式的 grantee 從 4 變成 %', v_n;
  END IF;
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_proc p
   CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) x
   WHERE p.oid = 'public.storefront_search_product_ids(text[])'::regprocedure
     AND pg_catalog.pg_get_userbyid(x.grantee) = 'qk83m2_negctl_20260927';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '事後閘③b:負對照不是 0 ⇒ 上面那把尺壞了(v_n=%)', v_n;
  END IF;

  -- ④ 索引:存在、可用、是部分索引、條件對
  SELECT i.indisvalid, i.indisready INTO v_valid, v_ready
    FROM pg_catalog.pg_index i WHERE i.indexrelid = pg_catalog.to_regclass('public.products_staff_text_override_idx');
  IF v_valid IS DISTINCT FROM true OR v_ready IS DISTINCT FROM true THEN
    RAISE EXCEPTION '事後閘④a:products_staff_text_override_idx 不存在或不可用';
  END IF;
  v_def := pg_catalog.pg_get_indexdef('public.products_staff_text_override_idx'::regclass);
  IF position('delisted_at IS NULL' IN v_def) = 0
     OR position('staff_overrides ? ''title''::text' IN v_def) = 0
     OR position('staff_overrides ? ''subtitle''::text' IN v_def) = 0 THEN
    RAISE EXCEPTION '事後閘④b:索引條件不對:%', v_def;
  END IF;

  -- ⑤ 行為閘(只讀):供應商原字照舊搜得到(正對照)、下架照舊搜不到(負對照)
  SELECT p.id, pg_catalog.substring(p.title, '[㐀-䶿一-鿿豈-﫿]{2}') AS w INTO r
    FROM public.products p
   WHERE p.delisted_at IS NULL AND p.title ~ '[㐀-䶿一-鿿豈-﫿]{2}'
   ORDER BY p.id LIMIT 1;
  IF FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.storefront_search_product_ids(ARRAY[r.w]) s WHERE s.id = r.id) THEN
      RAISE EXCEPTION '事後閘⑤a:上架商品 % 用供應商標題裡的「%」搜不到', r.id, r.w;
    END IF;
  ELSE
    RAISE NOTICE '事後閘⑤a:沒有標題含兩個相鄰中文字的上架商品 ⇒ 本格沒有判別力(不是通過)';
  END IF;
  SELECT p.id, pg_catalog.substring(p.title, '[㐀-䶿一-鿿豈-﫿]{2}') AS w INTO r
    FROM public.products p
   WHERE p.delisted_at IS NOT NULL AND p.title ~ '[㐀-䶿一-鿿豈-﫿]{2}'
   ORDER BY p.id LIMIT 1;
  IF FOUND THEN
    IF EXISTS (SELECT 1 FROM public.storefront_search_product_ids(ARRAY[r.w]) s WHERE s.id = r.id) THEN
      RAISE EXCEPTION '事後閘⑤b:下架商品 % 用「%」搜得到', r.id, r.w;
    END IF;
  ELSE
    RAISE NOTICE '事後閘⑤b:沒有標題含中文的下架商品 ⇒ 本格沒有判別力(不是通過)';
  END IF;
  -- ⑤c 員工標題:庫裡已有員工改過標題的上架商品 ⇒ 用員工標題的整串去搜, 它必須在結果裡
  SELECT p.id, p.staff_overrides ->> 'title' AS w INTO r
    FROM public.products p
   WHERE p.delisted_at IS NULL AND p.staff_overrides ? 'title'
   ORDER BY p.id LIMIT 1;
  IF FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.storefront_search_product_ids(ARRAY[r.w]) s WHERE s.id = r.id) THEN
      RAISE EXCEPTION '事後閘⑤c:上架商品 % 用員工標題「%」搜不到', r.id, r.w;
    END IF;
  ELSE
    RAISE NOTICE '事後閘⑤c:還沒有員工改過標題的上架商品 ⇒ 本格沒有判別力(不是通過);員工改了之後照 plan §4 再驗一次';
  END IF;
END
$post$;

COMMIT;
