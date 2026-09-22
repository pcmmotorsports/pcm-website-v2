SET LOCAL lock_timeout = '5s';
-- 20260922130000 退回:兩支目錄函式的上限 1000 → 100(= 20260916260000 那一代本體)。
-- 本體與正向檔相同, 只把 4 處 1000 改回 100;前置閘釘正向那一版的 md5, 事後閘釘回舊一代的 md5。
-- 退回後前端每頁選 200 / 500 / 1000 會回到「只顯示 100 件」的舊行為(不會壞頁)。
-- 貼完手動跑 NOTIFY pgrst, 'reload schema'; 並跑 pcm_acl_approve_latest(p_note 帶 20260922130000 rollback)。
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ── 前置閘:兩支必須是 20260922130000 那一版(md5 of prosrc)──
DO $pre$
BEGIN
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.search_catalog_by_vehicle(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)'))
     IS DISTINCT FROM '55d387e8901911dd16e993391bfe72d7' THEN
    RAISE EXCEPTION '退回前置閘a:search_catalog_by_vehicle(14 參) 不是 20260922130000 那一版 ⇒ 有人改過或已經貼過, 停下對齊';
  END IF;
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.search_catalog_by_vehicle_dealer(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)'))
     IS DISTINCT FROM 'e1760be9748ff230576e979ef518f685' THEN
    RAISE EXCEPTION '退回前置閘b:search_catalog_by_vehicle_dealer(14 參) 不是 20260922130000 那一版, 停';
  END IF;
  -- 🔴 md5 只看本體;有人只用 ALTER FUNCTION … SET 加設定時 md5 不變, 而 CREATE OR REPLACE 會把它清掉
  --    ⇒ 貼之前也逐字核 owner / DEFINER / SET / ACL 是 2026-09-22 讀到的值(Codex R1 should-fix)。
  IF (SELECT pg_catalog.pg_get_userbyid(p.proowner) || '|' || p.prosecdef::text || '|' || p.proconfig::text || '|' || p.proacl::text
        FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.search_catalog_by_vehicle(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)'))
     IS DISTINCT FROM 'postgres|false|{"search_path=public, pg_temp"}|{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION '退回前置閘c:search_catalog_by_vehicle 的 owner / SET / ACL / DEFINER 與 2026-09-22 讀到的不同 ⇒ 有人改過設定, 停下對齊';
  END IF;
  IF (SELECT pg_catalog.pg_get_userbyid(p.proowner) || '|' || p.prosecdef::text || '|' || p.proconfig::text || '|' || p.proacl::text
        FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.search_catalog_by_vehicle_dealer(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)'))
     IS DISTINCT FROM 'postgres|true|{"search_path=\"\""}|{postgres=X/postgres,authenticated=X/postgres}' THEN
    RAISE EXCEPTION '退回前置閘d:search_catalog_by_vehicle_dealer 的 owner / SET / ACL / DEFINER 與 2026-09-22 讀到的不同, 停';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.search_catalog_by_vehicle(p_categories text[], p_brand text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_offset integer DEFAULT 0, p_limit integer DEFAULT 25, p_sort text DEFAULT 'recommend'::text, p_category text DEFAULT NULL::text, p_brand_slugs text[] DEFAULT NULL::text[], p_price_min integer DEFAULT NULL::integer, p_price_max integer DEFAULT NULL::integer, p_new_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_terms text[] DEFAULT NULL::text[], p_fit_scope text DEFAULT 'all'::text)
 RETURNS TABLE(item jsonb, total bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- 🔴🔴 **`v_cats` 把新舊兩個入口收成【一份】** —— 新的 `p_categories` 加上舊的 `p_category`。
  --    ⇒ 📌 下面每一處都只讀 `v_cats`, **不再有任何一處直接讀 `p_category`**
  --      ⇒ 那讓「漏改一處」變成不可能, 而不是靠人數對。
  -- 🔴🔴 **[2026-09-04 本支改的就是這件事 —— 而它【只動排序, 不動過濾】]**
  --    Sean 2026-09-04 逐字「3. 甲」= 帶分類時也照【中高價位優先】排。
  --    ⛔ ~~原本 12 處排序 CASE 都掛著 `AND cardinality(v_cats) = 0`~~
  --       ⇒ 一旦帶了分類, 那組 CASE 全部回 NULL ⇒ **唯一還在生效的鍵是 `f.id ASC`(UUID)**
  --       ⇒ 📌 **客人點進一個分類, 第一頁等於【隨機順序】** —— 而那不是「另一種排法」, 是沒有排法。
  --    ✅ 本支把那 12 處的 `AND cardinality(v_cats) = 0` 拿掉。
  --    🛑 **而【WHERE 那兩處一個字都沒動】** —— 那是過濾, 不是排序:
  --       `WHERE (cardinality(v_cats) = 0 OR ...)` 決定「要不要套分類過濾」。
  --       ⇒ 動它會改變**回傳哪些商品**, 而本支只改**它們的順序**。
  --    🔵 而「大類輪流」(`sort_rn` 的 PARTITION BY 大類)在只選一個分類時**自然變成 no-op**
  --       —— 同一個 partition ⇒ 剩下「中高價分帶 + 段內由高到低」, 那正是 Sean 要的。
  -- 🛑 **而「空」的判準一律是 `cardinality(v_cats) = 0`, 不是 `IS NULL`** ——
  --    陣列有兩種空(NULL 與 `{}`), 而**它們在 `IS NULL` 上不一樣**。
  --    🔬 本檔實測到的分母:`p_category IS NULL` 在原版出現 **12** 次(兩份查詢各 6)
  --      ⇒ ⚠️ 而 plan 裡我寫「三行」—— 那是**只 grep 到一份查詢**的數。**12 才是對的。**
  v_cats text[];
  -- ⛔ ~~`c_batch_day_threshold constant int := 100;`~~ 與它上面那段說明 ——
  --    2026-09-09 Sean 拍甲拿掉「一天超過 N 件就整天不算新品」那條規則,常數與兩個分支一起刪。
  --    🔴 舊字面刻意留刪除線:拿「批次門檻」去搜的人要同一發撞到這句訂正。
  -- ── #950 推薦排序:中高價位優先(Sean 2026-08-27「中間~高 價位優先在前面好了」, 選項回「乙」)──
  -- 🔴 這兩個數字是【我們挑的, 不是他挑的】。他看到的選項字面是
  --    「這次先寫死在程式裡, 記一筆待辦(要改得叫我們)」, 而他回【甲】
  --    ⇒ 他同意的是那個做法, **不是這兩個值**。
  -- 🔴🔴 **要改就是改這兩行。**
  --    ⚠️ **而 backlog `#950` 目前【還沒有】指回本檔**(code-reviewer 實查:
  --       `grep -n '20260827150000' docs/phase-1-backlog.md` ⇒ 0 命中)
  --       ⇒ 那句「要改得叫我們」的承諾,現在只有【這一行】是它的地址。
  --       ⇒ 條目改寫是欠著的工(見 checkpoint), 而在那之前不要說「backlog 指到這裡」。
  --      (改了要開新 migration 重貼整支函式, 理由同上面那個門檻常數。)
  -- 值的來源:全站群代表價分布, 2026-08-27 量於報價單庫 storefront_catalog_v(22,193 群)
  --    中位數 4,000 / P90 13,800 ⇒ 段界取【中位數 ~ P90】
  --    ⚠️ 換成 Q3~P95(7,480 ~ 約 21,000)⇒ 第一頁整批換人、平均單價高很多
  -- 分類第一段 = 這個字的商品【不進新品區】(Sean 2026-08-27 拍【甲】= 照大類切)。
  -- 🔴 用 split_part 取第一段, 不是整串比對 —— 以後多出「維修零件 · 油封」這種子類會【自動】跟著排除,
  --    不需要有人記得回來改。Sean 拍甲的理由就是這個(de 端題時已明說「今天甲乙行為一樣, 差別在以後」)。
  -- ⚠️ 只作用在【新品模式】(p_new_since IS NOT NULL)。目錄 / 搜尋 / 品牌頁 / 分類頁傳 NULL ⇒ 不受影響;
  --    客人在分類頁直接看「維修零件」時 p_new_since 也是 NULL ⇒ 那 1631 件照常看得到。
  c_new_arrivals_excluded_category constant text := '維修零件';
  c_recommend_band_lo constant int := 4000;
  c_recommend_band_hi constant int := 13800;
  -- 🔴🔴 ⟦db-SEARCHFACETMUTEX⟧ **「空白」的字集 —— 顯式列舉**(codex R1 nit + R2 nit)
  --   ⛔ ~~`btrim(pt)` 預設~~ 只剝 ASCII 空格;⛔ ~~`pt ~ '[^[:space:]]'`~~ **依 locale**
  --     (我自己的 harness 在 `--locale=C` 下抓到它對全形空格失效)。
  --   ⇒ 📌 兩個都不行, 而它們**在正式庫與拋棄式庫會給不同答案, 且兩邊都不報錯**。
  c_ws constant text := E' \t\n\r\x0B\f\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF';
BEGIN
  -- 🔵 新舊合流:兩個都給的話一起吃(聯集)。`p_category` 是舊入口, 保留到步驟 C 才 DROP。
  v_cats := (
    -- 🔴 **`btrim` 要寫回, 不是只拿來過濾**(codex nit):原版只用它排除空白字串,
    --    而 `' 排氣系統 '` 會**帶著空白留下來** ⇒ 比不到任何分類, 而且不會與無空白版去重。
    SELECT coalesce(array_agg(DISTINCT btrim(x)), ARRAY[]::text[])
      FROM unnest(coalesce(p_categories, ARRAY[]::text[])
                  || CASE WHEN p_category IS NULL THEN ARRAY[]::text[] ELSE ARRAY[p_category] END) AS x
     WHERE btrim(x) <> ''
  );
  IF p_brand IS NULL THEN
    RETURN QUERY
    WITH kw AS MATERIALIZED (
      -- 🎯 ⟦db-SEARCHFACETMUTEX⟧ 2026-09-09:關鍵字命中集合**提到 CTE**, 而理由有兩個。
      --   ① 要把 `is_exact` 帶進 `filtered` 當排序鍵 —— 寫成每列一次的純量子查詢的話,
      --      那支 SRF 會**對結果集的每一列各跑一次**。
      --   ② `MATERIALIZED` 是刻意的:少了它 planner 可能把它推進 JOIN 反覆求值。
      -- 🔵 **`p_terms IS NULL` 時它照樣跑一次, 而那一次是空的** ——
      --   `array_agg` 對空集合回 NULL ⇒ 該函式內部 `unnest(NULL)` ⇒ 零詞 ⇒ 它自己的
      --   `WHERE n.want > 0` 直接回零列。⛔ ~~今天每一發零成本~~ ⇒ 現在是**一次零列呼叫**。
      --   ⇒ 📌 那是本片的成本, 明寫在這裡而不是讓下一個人自己發現。
      SELECT k.id, k.is_exact, k.tier
        FROM public.storefront_search_product_ids(
               (SELECT array_agg(pt) FROM unnest(p_terms) AS pt WHERE btrim(pt, c_ws) <> '')) k
    ), filtered AS (
      SELECT p.*, COALESCE(kw.is_exact, false) AS kw_exact, COALESCE(kw.tier, 3) AS kw_tier, 0 AS fit_rank,
             public.pcm_card_image_is_placeholder(p.card_image) AS no_img
      FROM public.products_list_public p
      -- 🔵 LEFT JOIN 不是 INNER —— 沒有關鍵字時 `kw` 是空的,
      --    用 INNER 會把整張目錄濾光, 而 HTTP 200、畫面完全正常。
      LEFT JOIN kw ON kw.id = p.id
      -- 🔴🔴 **不是 `= ANY(v_cats)`** —— 分類的述詞有【兩個分支】(`=` 與 `LIKE 父 · %`),
      --    而品牌只有一個 ⇒ 照抄品牌那一格會**漏掉「打大類要涵蓋子類」那一半**,
      --    而它看起來完全正確。⇒ 每一個元素都要走那兩個分支。
      -- ✅ **聯集**(任一元素中就算中)= Sean 2026-09-04 拍的甲:
      --    逐字「甲 聯集 —— 排氣管【或】油箱貼, 兩種商品都列出來(比較多)」。
      WHERE (cardinality(v_cats) = 0
             OR EXISTS (SELECT 1 FROM unnest(v_cats) AS vc
                         WHERE p.category_raw = vc OR p.category_raw LIKE vc || ' · %'))
        AND (p_brand_slugs IS NULL OR cardinality(p_brand_slugs) = 0 OR p.brand_slug = ANY(p_brand_slugs))
        AND (p_price_min IS NULL OR p.price_general >= p_price_min)
        AND (p_price_max IS NULL OR p.price_general <= p_price_max)
        AND (p_new_since IS NULL OR (
              p.created_at >= p_new_since
              -- 上界（codex R2 NIT-2）：未來時戳的列不算新品，否則它會永遠釘在「新品」第一位。
              -- ⛔ ~~「只夾窗、不夾 new_batch_days」~~ —— 2026-09-09 批次日規則已拿掉,
              --    這一行留下的只有【上界】那半, 而它自己的理由(上一行)仍然成立。
              AND p.created_at <= now()
              -- 🔴 維修零件不進新品區。`coalesce` 少不得:category_raw 若為 NULL,
              --    `split_part(NULL,…) <> '維修零件'` 會回 NULL ⇒ 那一列會被【當成維修零件排掉】。
              --    現值空值 0 ⇒ 今天看不出差別, 而那正是它以後會安靜咬人的原因。
              AND coalesce(split_part(p.category_raw, ' · ', 1), '') <> c_new_arrivals_excluded_category
            ))
        -- 🔴🔴 ⟦db-SEARCHFACETMUTEX⟧ 關鍵字那一格 —— **比對【不在這裡】做**, 委給 `storefront_search_product_ids`。
        --    🎯 **為什麼委出去**:那支已經有四欄 ILIKE + 品牌名 + 母料號前綴 + 變體 sku 四塊,
        --      而每一塊的守門條件都付過學費(見 `20260906950000` 的註解)⇒ 自己再寫一份 ILIKE
        --      = 兩份會漂, 而漂的方向是【客人搜不到】, 那沒有人會回報。
        --    🛑 **而 `products_list_public` 上【沒有】`description` 與 `external_id` 兩欄**
        --      ⇒ 就算想在這裡比也比不完整;委出去那一側走的是 `products_public`。
        -- 🔴🔴 **第二個條件不可以省, 而少了它會【整站零商品】**:
        --    被委的那支在零個有效詞時逐字「回零列(不是回全表)」(`20260906950000` 的 `WHERE n.want > 0`)
        --    ⇒ 📌 `p_terms = ARRAY['']` 這種呼叫會讓每一列都被濾掉, 而 HTTP 200、畫面完全正常。
        --    ⇒ **「沒有關鍵字」這件事必須在【這裡】判, 不得委出去。**
        --    🔴🔴 **「有效詞」的判準【刻意與被委那支不同】, 而差的方向是承重的**(codex R1 nit):
--      被委那支用 `btrim(term) <> ''`, 而 **`btrim` 預設只剝 ASCII 空格**
--      ⇒ 📌 `ARRAY[E'\t']` / 換行 / 全形空格 `U+3000` 在它眼裡是**有效詞**
--        ⇒ 它會拿 `%<tab>%` 去比 ⇒ 回零列 ⇒ **整站零商品**, 又是同一個形狀。
--      ⛔ ~~我的第一版寫 `pt ~ '[^[:space:]]'`~~ —— 🔴 **那一版是【我自己的 harness 抓到的】**:
--        `[[:space:]]` 是**依 locale 的**, 而拋棄式庫跑在 `--locale=C` ⇒ 它只認 ASCII
--        ⇒ 全形空格 `U+3000` 那一格實測 **0(期望 4)**。
--        📌 而正式庫是 UTF-8 locale ⇒ 📌 **同一段碼在兩個環境會給不同答案, 而兩邊都不報錯。**
--      ✅ 改成**顯式列舉**(與 `normalizeSearchInput` 學到的同一課:`\s` 不含 `U+200B`)
--        `btrim(pt, ' '||chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(8203)||chr(12288)||chr(65279))`
--        ⇒ 空白 / tab / 換行 / 零寬空格 / 全形空格 / BOM,**locale 無關** ⇒ **比被委那支寬**
--        ⇒ 純空白的詞在這裡算「沒有關鍵字」⇒ **不過濾, 出全部**。
--    🔴🔴 **[codex R2 must-fix]** ⛔ ~~只擋「整組都是空白」就夠~~ —— **那句是假的, 而反例很小**:
--      `ARRAY['碳纖維', E'\t']` ⇒ 第一個詞有效 ⇒ 整組過了我的閘 ⇒ **連同那個 tab 原樣送出去**
--      ⇒ 被委那支把 tab 當成**第二個必要條件**(`count(DISTINCT ord) = want`)
--      ⇒ 📌 **一筆都不會中** ⇒ 客人打了字而拿到 0 件, 而畫面完全正常。
--      ✅ **所以不是【擋】, 是【濾】**:只把有效詞 `array_agg` 起來送出去。
--      🎯 兩邊不一致仍是刻意的, 而現在它**真的**只往【出全部】倒 —— 空白詞根本不會抵達那一支。
        AND (p_terms IS NULL
             OR NOT EXISTS (SELECT 1 FROM unnest(p_terms) AS pt WHERE btrim(pt, c_ws) <> '')
             -- ⛔ ~~`OR p.id IN (SELECT k.id FROM storefront_search_product_ids(…)) `~~
             -- 🎯 同一個集合改從上面那個 `kw` CTE 來 —— **`IN (SELECT …)` 是集合語意,
             --   那支函式自己的 `ORDER BY`(完全命中排最前)在那一行【蒸發】。**
             --   2026-09-09 實測:`VF11` 的完全命中那顆 第 1 名 ⇒ 第 14 名(最後一名)。
             OR kw.id IS NOT NULL)
    ), paged AS (
      -- count/排序/分頁先收斂到 ≤100 列，trim JOIN 只對當頁做（20260719150000 MF-4）
      SELECT f.*, count(*) OVER () AS total_rows,
        -- ── #950 recommend 的兩個排序欄。🔴 **算在這裡, 不算在外層 ORDER BY 裡** ──
        --   理由是實測踩到的:第一版把 row_number() 寫進【外層】那個 ORDER BY,
        --   它會對【已經分頁後的那幾列】重算一次 ⇒ 名次變成頁內名次、不是全域名次
        --   ⇒ 第一頁出現重複的大類(2026-08-27 實測:期望 12 個相異大類, 實得 11)。
        --   📌 而 11/12 看起來幾乎對 —— 那正是它難發現的地方。
  -- 🔴🔴 **第二個實測抓到的錯:PARTITION 要含【段】。**
  --   只用大類分割 ⇒ rn 是「這一類【全部】商品裡的名次」, 而段外(比段更貴)的也算在內
  --   ⇒ 各大類段外商品【數量不同】⇒ 每一類第一個段內商品拿到的 rn 不同
  --     (實測:第一頁的 rn 從 24 起跳、有 24 也有 25 ⇒ 同一個大類出現兩次)
  --   ⇒ 加上 band 之後, 每一類【在段內】的名次才從 1 開始, 輪流才真的是輪流。
        CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
             THEN 0 ELSE 1 END AS sort_band,
        -- 🔴 大類 = category_raw 的第一段。單段的分類是合法的(本函式自己的 WHERE 就有
        --    `= p_category` 與 `LIKE p_category || ' · %'` 兩個分支)⇒ split_part 對單段值
        --    回整串 ⇒ 它自成一個大類, 行為正確、不是 bug。
        row_number() OVER (PARTITION BY f.kw_tier, f.fit_rank, f.no_img, split_part(f.category_raw, ' · ', 1),
                                           CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                     AND c_recommend_band_hi THEN 0 ELSE 1 END
                           ORDER BY f.price_general DESC NULLS LAST, f.id) AS sort_rn
      FROM filtered f
      ORDER BY
        -- 🎯 ⟦db-SEARCHFACETMUTEX⟧ **料號完全命中排最前**(Sean 2026-09-06 逐字
        --   「完全命中的排最前」;2026-09-09 拍甲把它接回目錄 RPC)。
        -- 🔴 **只在【有關鍵字】而且【走預設推薦排序】時生效** ——
        --   客人自己點了「價格低到高 / 最新上架」就照他點的走, 不插隊。
        -- 🔵 `f.kw_tier`(20260916140000 起取代 `NOT f.kw_exact`)⇒ 0 料號完全相符 / 1 詞全中 / 2 部分 / 3 其他, ASC 小的在前。
        --   兩個條件任一不成立 ⇒ 整個 CASE 是 NULL ⇒ NULLS LAST ⇒ 全部同分
        --   ⇒ 📌 **沒有關鍵字的那一發, 行為一個位元組都不變。**
        CASE WHEN p_sort = 'recommend' AND p_terms IS NOT NULL
             THEN f.kw_tier END ASC NULLS LAST,
      f.fit_rank ASC,
      f.no_img ASC,
        CASE WHEN p_sort = 'recommend' THEN
          CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
               THEN 0 ELSE 1 END
        END ASC NULLS LAST,
        CASE WHEN p_sort = 'recommend' THEN
          row_number() OVER (PARTITION BY f.kw_tier, f.fit_rank, f.no_img, split_part(f.category_raw, ' · ', 1),
                                             CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                       AND c_recommend_band_hi THEN 0 ELSE 1 END
                             ORDER BY f.price_general DESC NULLS LAST, f.id)
        END ASC NULLS LAST,
        CASE WHEN p_sort = 'recommend' THEN f.price_general END DESC NULLS LAST,
        CASE WHEN p_sort = 'price-asc' THEN f.price_general END ASC NULLS LAST,
        CASE WHEN p_sort = 'price-desc' THEN f.price_general END DESC NULLS LAST,
        CASE WHEN p_sort = 'new' THEN f.created_at END DESC NULLS LAST,
        f.id ASC
      OFFSET GREATEST(p_offset, 0)
      LIMIT LEAST(GREATEST(p_limit, 1), 100)
    )
    SELECT
      jsonb_build_object(
        'id', pg.id,
        -- 🔴 母料號:Sean 2026-09-06 拍「全部頁面都顯示料號」。
        --    來源是 `products_public`(下面 LEFT JOIN 的 `pe`), **不是 `products_list_public`** ——
        --    那支清單投影**沒有這一欄**(2026-09-06 正式庫唯讀逐欄查:16 欄, 無 `external_id`;
        --    而 `products_public` 有 ⇒ 🟢 正對照)。
        -- 🛑 **刻意不動 `products_list_public`**(主視窗 `Q-母料號來源 A: 甲`):它是**公開投影**,
        --    消費端沒有盤過 ⇒ 板列 `⟦search-LISTVIEWNOEXTID⟧` 記著未來若要動它的入口。
         --    ⛔ ~~理由之一是「它的 COMMENT 逐字寫著排除 external_id, 那個排除看起來是刻意的」~~
         --    🔴 **那句是錯的**(codex + code-reviewer 同時抓):現行 COMMENT(`20260811040000:229`)
         --      逐字是 `excludes price_store, price_by_tier, metadata, detail content and delisted_at`
         --      —— **沒有 external_id**。含它的是 9/10 欄時期那兩代, 而那份清單裡它跟
         --      `description / images / timestamps` 排在一起 ⇒ 那是**卡片瘦身**, 不是安全排除。
         --    ✅ **選甲仍然對, 而理由換成量到的那個**:動公開投影會改欄數與欄位順序,
         --      而**消費端沒有盤過** —— 這一條不需要那句 COMMENT 撐。
        'external_id', pe.external_id,
        'title', pg.title,
        'subtitle', pg.subtitle,
        'handle', pg.handle,
        'availability', pg.availability,
        'price_general', pg.price_general,
        'card_image', pg.card_image,
        'fits', pg.fits,
        'brand_name', pg.brand_name,
        'brand_slug', pg.brand_slug,
        'category_raw', pg.category_raw,
        'fitments', pg.fitments,
        'card_image_trim', CASE WHEN t.url IS NULL THEN NULL ELSE jsonb_build_object(
          'l', t.bbox_left, 't', t.bbox_top, 'w', t.bbox_width, 'h', t.bbox_height,
          'nw', t.natural_width, 'nh', t.natural_height) END
      ),
      pg.total_rows
    FROM paged pg
    LEFT JOIN public.product_image_trim t ON t.url = pg.card_image AND t.status = 'ok'
    -- 🔵 **只在【這一頁】上 join** —— `paged` 已經 LIMIT 過(最多 100 列), 而 join key 是主鍵。
    -- 🔴 用 `LEFT` 不是 `INNER`:兩支 view 都吃 RLS, 正常同進同出;而萬一某一列只在其中一邊,
    --    INNER 會把那張卡**整張弄不見**, LEFT 只讓料號是 null。
    --    ⇒ 📌 **少一個料號 vs 少一張商品卡, 後者嚴重得多。**
    LEFT JOIN public.products_public pe ON pe.id = pg.id
    ORDER BY
      -- #950:🔴 用內層算好的 sort_band / sort_rn, **不要在這裡重算 row_number()**(理由見內層註解)
      -- 🎯 ⟦db-SEARCHFACETMUTEX⟧ 料號完全命中排最前 —— **內外層都要有**, 理由見內層那段。
      CASE WHEN p_sort = 'recommend' AND p_terms IS NOT NULL
           THEN pg.kw_tier END ASC NULLS LAST,
      pg.fit_rank ASC,
      pg.no_img ASC,
      CASE WHEN p_sort = 'recommend' THEN pg.sort_band END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN pg.sort_rn   END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN pg.price_general END DESC NULLS LAST,
      CASE WHEN p_sort = 'price-asc' THEN pg.price_general END ASC NULLS LAST,
      CASE WHEN p_sort = 'price-desc' THEN pg.price_general END DESC NULLS LAST,
      CASE WHEN p_sort = 'new' THEN pg.created_at END DESC NULLS LAST,
      pg.id ASC;
    RETURN;
  END IF;

  RETURN QUERY
  WITH kw AS MATERIALIZED (
      -- 🎯 ⟦db-SEARCHFACETMUTEX⟧ 2026-09-09:關鍵字命中集合**提到 CTE**, 而理由有兩個。
      --   ① 要把 `is_exact` 帶進 `filtered` 當排序鍵 —— 寫成每列一次的純量子查詢的話,
      --      那支 SRF 會**對結果集的每一列各跑一次**。
      --   ② `MATERIALIZED` 是刻意的:少了它 planner 可能把它推進 JOIN 反覆求值。
      -- 🔵 **`p_terms IS NULL` 時它照樣跑一次, 而那一次是空的** ——
      --   `array_agg` 對空集合回 NULL ⇒ 該函式內部 `unnest(NULL)` ⇒ 零詞 ⇒ 它自己的
      --   `WHERE n.want > 0` 直接回零列。⛔ ~~今天每一發零成本~~ ⇒ 現在是**一次零列呼叫**。
      --   ⇒ 📌 那是本片的成本, 明寫在這裡而不是讓下一個人自己發現。
      SELECT k.id, k.is_exact, k.tier
        FROM public.storefront_search_product_ids(
               (SELECT array_agg(pt) FROM unnest(p_terms) AS pt WHERE btrim(pt, c_ws) <> '')) k
    ), matched AS (
    SELECT product_id
    FROM public.product_fitments
    WHERE moto_brand = p_brand
      AND (p_model IS NULL OR model_code = p_model)
      AND (p_year IS NULL OR ((year_start IS NULL OR year_start <= p_year)
                          AND (year_end IS NULL OR year_end >= p_year)))
    UNION
    SELECT product_id
    FROM public.product_fitments_effective
    WHERE moto_brand = p_brand
      AND (p_model IS NULL OR model_code = p_model)
      AND (p_year IS NULL OR ((year_start IS NULL OR year_start <= p_year)
                          AND (year_end IS NULL OR year_end >= p_year)))
  ), cand AS (
    -- 🔴 p_fit_scope(20260916220000):all = 兩區都要(= 今天的行為)/ fit = 只有專用 / universal = 只有通用。
    --   🛑 **一律走 coalesce**:`NULL <> 'universal'` 回的是 NULL 不是 false
    --      ⇒ 兩個分支都不成立 ⇒ **回零列, 而 HTTP 200、畫面完全正常**(壞掉跟正常長得一樣)。
    --      ⇒ NULL 與任何不明值一律退回 'all' = 今天的行為(fail-open 到現況, 不是 fail-closed 到空白)。
    --   ⚠️ [R1 N-2] **比對是大小寫敏感、不 trim**:`'Fit'` / `' fit'` 會落回 all。
    --      刻意不加 `lower(btrim(…))` —— 值域由呼叫端的 TS union `CatalogFitScope` 把關,
    --      而在這裡多一層正規化會讓「送錯值」變成靜默容錯, 那反而看不見。
    SELECT m.product_id AS id, 0 AS fit_rank FROM matched m
     WHERE coalesce(p_fit_scope, 'all') <> 'universal'
    UNION ALL
    SELECT pu.id, 1 AS fit_rank
      FROM public.products_list_public pu
     WHERE coalesce(p_fit_scope, 'all') <> 'fit'
       AND pu.fitments = '[]'::jsonb
       AND NOT EXISTS (SELECT 1 FROM matched m2 WHERE m2.product_id = pu.id)
       -- 🔴🔴 **[20260916240000 · Sean 2026-09-16 標了六櫃]「一定要分車款」的櫃不進通用區。**
       --   他的判準逐字:「通用零件 = 像護弓、螺絲、機油那種, 本來就不分車款的東西」
       --   ⇒ 整流罩 / 排氣管 / 腳踏後移出現在通用區 = **資料壞了**, 不是通用款。
       --   🛑 **這裡是【不顯示】, 不是【修好】** —— 那 1,993 件的修法在報價單那側,
       --      清單在 `~/pcm-mailbox/待修清單-通用區應該分車款的商品-0916.md`(五個供應商 × 櫃佔 93%)。
       --   🔴 **只擋通用區這一支, 第一區(專用)一個字都沒動** ——
       --      那六櫃若真的有標車款的商品, 照樣出現在上面。
       --   🔴 **`split_part(…, ' · ', 1)` 不是可選的, 今天就有 618 件靠它**:
       --      那六櫃裡四櫃有子類(碳纖維 13 個 / 排氣 7 個 / 腳踏後移 5 個 / ATV 2 個)
       --      ⇒ 2026-09-16 實測:取第一段認得到 1,993 件, 而**整串比對只認得到 1,375 件**。
       --      形狀與同檔 `c_new_arrivals_excluded_category` 一致(Sean 2026-08-27 拍甲的那條)。
       --   ⚠️ 名字改了這一格會失效 —— 而**失效是看得見的**(那六櫃重新出現在通用區, 而 Sean 正是抱怨它的人)。
       AND (
             split_part(pu.category_raw, ' · ', 1) <> ALL (ARRAY[
               '維修零件', '腳踏後移與傳動', '碳纖維部品',
               '四輪 ATV/UTV', '排氣系統', '服務與其他'
             ])
             -- ── ⑧ Sean 2026-09-17 拍甲:Gilles 的替換零件不受上面那條規則管 ──
             --   可以讀成:那六櫃要分車款,**而 gilles 的維修零件是例外**。
             --   🔬 依據(報價單窗實測 + 本側獨立重算,三個證人):
             --     它們在 Gilles 官網的分類是 `Spare parts`(替換零件)——
             --     墊片 / 底板 / 彈簧 / 支架,那些本來就不綁單一車款。
             --   🛑 **而 `category` 那一欄【顧客站這個庫裡不存在】**(`pg_attribute` 實查 = 0,
             --      gilles 的 metadata 只有 `name_en` 一個 key)⇒ 這裡用【等價條件】:
             --      ● 報價單窗量:Spare parts **100% 落在那兩櫃內**(不外溢)
             --      ● 報價單窗量:那兩櫃∧沒車款∧非 Spare parts = **0 列**(沒漏)
             --      ● 本窗用自己的母體獨立算:**810 群**,與 Sean 拍的那個數【逐字相同】
             --      ⇒ 📌 兩個方向都包住 + 第三個獨立證人 ⇒ 集合相同,不是「差不多」。
             --   🟢 **而換成這個條件反而少一個風險**:官網分類名是每晚重抓會覆寫的欄,
             --      Gilles 改官網分類名 ⇒ 原條件會【靜靜失效】;**本條件根本不讀那一欄。**
             --   🔴 **`supplier_slug = 'gilles'` 不是裝飾用的** —— 同兩櫃裡沒車款的還有:
             --      lightech 791 · bonamici 664 · gbracing 84 · evotech 82 · cncracing 23 …
             --      ⇒ **漏掉這一行會一次多放 1,600+ 群**(本窗 2026-09-17 實量,不是理論風險)。
             --   🔵 **不寫「精品螺絲與螺帽」那一櫃**:那 810 群裡有 127 群在那一櫃,
             --      而那一櫃**不在 Sean 標的六櫃裡** ⇒ 它們本來就沒被擋過。
             --      ⇒ 寫進去是一條**永遠不改變結果**的條件,下一個人會花時間看它。
             --      📌 **這一改實際讓 683 群重新看得到**(維修零件那些),**不是 810**。
             --   ⚠️ **它守不到的那一天**:貼完之後若 gilles 的商品被改分類到別櫃,
             --      這個例外會**靜靜失效**。事後閘只看得到貼的那一刻,看不到那一天。
             --      🛑 **而本片刻意不為它開常駐哨兵**(主視窗 2026-09-17 批)。
             OR (
               pu.supplier_slug = 'gilles'
               AND split_part(pu.category_raw, ' · ', 1) = '維修零件'
             )
           )
  ), filtered AS (
    SELECT p.*, COALESCE(kw.is_exact, false) AS kw_exact, COALESCE(kw.tier, 3) AS kw_tier, c.fit_rank,
           public.pcm_card_image_is_placeholder(p.card_image) AS no_img
    FROM public.products_list_public p
    JOIN cand c ON c.id = p.id
    -- 🔵 LEFT JOIN 不是 INNER —— 理由同上面那份。
    LEFT JOIN kw ON kw.id = p.id
    -- 🔴 與上面那份同一個修法(本函式有【兩份】查詢, 兩份都要改)。
    WHERE (cardinality(v_cats) = 0
           OR EXISTS (SELECT 1 FROM unnest(v_cats) AS vc
                       WHERE p.category_raw = vc OR p.category_raw LIKE vc || ' · %'))
      AND (p_brand_slugs IS NULL OR cardinality(p_brand_slugs) = 0 OR p.brand_slug = ANY(p_brand_slugs))
      AND (p_price_min IS NULL OR p.price_general >= p_price_min)
      AND (p_price_max IS NULL OR p.price_general <= p_price_max)
      AND (p_new_since IS NULL OR (
            p.created_at >= p_new_since
            AND p.created_at <= now()
            -- 🔴 維修零件不進新品區。`coalesce` 少不得:category_raw 若為 NULL,
            --    `split_part(NULL,…) <> '維修零件'` 會回 NULL ⇒ 那一列會被【當成維修零件排掉】。
            --    現值空值 0 ⇒ 今天看不出差別, 而那正是它以後會安靜咬人的原因。
            AND coalesce(split_part(p.category_raw, ' · ', 1), '') <> c_new_arrivals_excluded_category
          ))
      -- 🔴🔴 ⟦db-SEARCHFACETMUTEX⟧ 關鍵字那一格 —— **比對【不在這裡】做**, 委給 `storefront_search_product_ids`。
      --    🎯 **為什麼委出去**:那支已經有四欄 ILIKE + 品牌名 + 母料號前綴 + 變體 sku 四塊,
      --      而每一塊的守門條件都付過學費(見 `20260906950000` 的註解)⇒ 自己再寫一份 ILIKE
      --      = 兩份會漂, 而漂的方向是【客人搜不到】, 那沒有人會回報。
      --    🛑 **而 `products_list_public` 上【沒有】`description` 與 `external_id` 兩欄**
      --      ⇒ 就算想在這裡比也比不完整;委出去那一側走的是 `products_public`。
      -- 🔴🔴 **第二個條件不可以省, 而少了它會【整站零商品】**:
      --    被委的那支在零個有效詞時逐字「回零列(不是回全表)」(`20260906950000` 的 `WHERE n.want > 0`)
      --    ⇒ 📌 `p_terms = ARRAY['']` 這種呼叫會讓每一列都被濾掉, 而 HTTP 200、畫面完全正常。
      --    ⇒ **「沒有關鍵字」這件事必須在【這裡】判, 不得委出去。**
      --    🔴🔴 **「有效詞」的判準【刻意與被委那支不同】, 而差的方向是承重的**(codex R1 nit):
--      被委那支用 `btrim(term) <> ''`, 而 **`btrim` 預設只剝 ASCII 空格**
--      ⇒ 📌 `ARRAY[E'\t']` / 換行 / 全形空格 `U+3000` 在它眼裡是**有效詞**
--        ⇒ 它會拿 `%<tab>%` 去比 ⇒ 回零列 ⇒ **整站零商品**, 又是同一個形狀。
--      ⛔ ~~我的第一版寫 `pt ~ '[^[:space:]]'`~~ —— 🔴 **那一版是【我自己的 harness 抓到的】**:
--        `[[:space:]]` 是**依 locale 的**, 而拋棄式庫跑在 `--locale=C` ⇒ 它只認 ASCII
--        ⇒ 全形空格 `U+3000` 那一格實測 **0(期望 4)**。
--        📌 而正式庫是 UTF-8 locale ⇒ 📌 **同一段碼在兩個環境會給不同答案, 而兩邊都不報錯。**
--      ✅ 改成**顯式列舉**(與 `normalizeSearchInput` 學到的同一課:`\s` 不含 `U+200B`)
--        `btrim(pt, ' '||chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(8203)||chr(12288)||chr(65279))`
--        ⇒ 空白 / tab / 換行 / 零寬空格 / 全形空格 / BOM,**locale 無關** ⇒ **比被委那支寬**
--        ⇒ 純空白的詞在這裡算「沒有關鍵字」⇒ **不過濾, 出全部**。
--    🔴🔴 **[codex R2 must-fix]** ⛔ ~~只擋「整組都是空白」就夠~~ —— **那句是假的, 而反例很小**:
--      `ARRAY['碳纖維', E'\t']` ⇒ 第一個詞有效 ⇒ 整組過了我的閘 ⇒ **連同那個 tab 原樣送出去**
--      ⇒ 被委那支把 tab 當成**第二個必要條件**(`count(DISTINCT ord) = want`)
--      ⇒ 📌 **一筆都不會中** ⇒ 客人打了字而拿到 0 件, 而畫面完全正常。
--      ✅ **所以不是【擋】, 是【濾】**:只把有效詞 `array_agg` 起來送出去。
--      🎯 兩邊不一致仍是刻意的, 而現在它**真的**只往【出全部】倒 —— 空白詞根本不會抵達那一支。
      AND (p_terms IS NULL
           OR NOT EXISTS (SELECT 1 FROM unnest(p_terms) AS pt WHERE btrim(pt, c_ws) <> '')
           -- ⛔ ~~`OR p.id IN (SELECT k.id FROM storefront_search_product_ids(…)) `~~
           -- 🎯 同一個集合改從上面那個 `kw` CTE 來 —— **`IN (SELECT …)` 是集合語意,
           --   那支函式自己的 `ORDER BY`(完全命中排最前)在那一行【蒸發】。**
           --   2026-09-09 實測:`VF11` 的完全命中那顆 第 1 名 ⇒ 第 14 名(最後一名)。
           OR kw.id IS NOT NULL)
  ), paged AS (
    SELECT f.*, count(*) OVER () AS total_rows,
      -- ── #950 recommend 的兩個排序欄。🔴 **算在這裡, 不算在外層 ORDER BY 裡** ──
      --   理由是實測踩到的:第一版把 row_number() 寫進【外層】那個 ORDER BY,
      --   它會對【已經分頁後的那幾列】重算一次 ⇒ 名次變成頁內名次、不是全域名次
      --   ⇒ 第一頁出現重複的大類(2026-08-27 實測:期望 12 個相異大類, 實得 11)。
      --   📌 而 11/12 看起來幾乎對 —— 那正是它難發現的地方。
  -- 🔴🔴 **第二個實測抓到的錯:PARTITION 要含【段】。**
  --   只用大類分割 ⇒ rn 是「這一類【全部】商品裡的名次」, 而段外(比段更貴)的也算在內
  --   ⇒ 各大類段外商品【數量不同】⇒ 每一類第一個段內商品拿到的 rn 不同
  --     (實測:第一頁的 rn 從 24 起跳、有 24 也有 25 ⇒ 同一個大類出現兩次)
  --   ⇒ 加上 band 之後, 每一類【在段內】的名次才從 1 開始, 輪流才真的是輪流。
      CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
           THEN 0 ELSE 1 END AS sort_band,
      -- 🔴 大類 = category_raw 的第一段。單段的分類是合法的(本函式自己的 WHERE 就有
      --    `= p_category` 與 `LIKE p_category || ' · %'` 兩個分支)⇒ split_part 對單段值
      --    回整串 ⇒ 它自成一個大類, 行為正確、不是 bug。
      row_number() OVER (PARTITION BY f.kw_tier, f.fit_rank, f.no_img, split_part(f.category_raw, ' · ', 1),
                                         CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                   AND c_recommend_band_hi THEN 0 ELSE 1 END
                         ORDER BY f.price_general DESC NULLS LAST, f.id) AS sort_rn
    FROM filtered f
    ORDER BY
      -- 🎯 ⟦db-SEARCHFACETMUTEX⟧ **料號完全命中排最前**(Sean 2026-09-06 逐字
      --   「完全命中的排最前」;2026-09-09 拍甲把它接回目錄 RPC)。
      -- 🔴 **只在【有關鍵字】而且【走預設推薦排序】時生效** ——
      --   客人自己點了「價格低到高 / 最新上架」就照他點的走, 不插隊。
      -- 🔵 `f.kw_tier`(20260916140000 起取代 `NOT f.kw_exact`)⇒ 0 料號完全相符 / 1 詞全中 / 2 部分 / 3 其他, ASC 小的在前。
      --   兩個條件任一不成立 ⇒ 整個 CASE 是 NULL ⇒ NULLS LAST ⇒ 全部同分
      --   ⇒ 📌 **沒有關鍵字的那一發, 行為一個位元組都不變。**
      CASE WHEN p_sort = 'recommend' AND p_terms IS NOT NULL
           THEN f.kw_tier END ASC NULLS LAST,
      f.fit_rank ASC,
      f.no_img ASC,
      CASE WHEN p_sort = 'recommend' THEN
        CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
             THEN 0 ELSE 1 END
      END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN
        row_number() OVER (PARTITION BY f.kw_tier, f.fit_rank, f.no_img, split_part(f.category_raw, ' · ', 1),
                                           CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                     AND c_recommend_band_hi THEN 0 ELSE 1 END
                           ORDER BY f.price_general DESC NULLS LAST, f.id)
      END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN f.price_general END DESC NULLS LAST,
      CASE WHEN p_sort = 'price-asc' THEN f.price_general END ASC NULLS LAST,
      CASE WHEN p_sort = 'price-desc' THEN f.price_general END DESC NULLS LAST,
      CASE WHEN p_sort = 'new' THEN f.created_at END DESC NULLS LAST,
      f.id ASC
    OFFSET GREATEST(p_offset, 0)
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  )
  SELECT
    jsonb_build_object(
      'id', pg.id,
      -- 🔴 母料號:Sean 2026-09-06 拍「全部頁面都顯示料號」。
      --    來源是 `products_public`(下面 LEFT JOIN 的 `pe`), **不是 `products_list_public`** ——
      --    那支清單投影**沒有這一欄**(2026-09-06 正式庫唯讀逐欄查:16 欄, 無 `external_id`;
      --    而 `products_public` 有 ⇒ 🟢 正對照)。
      -- 🛑 **刻意不動 `products_list_public`**(主視窗 `Q-母料號來源 A: 甲`):它是**公開投影**,
      --    消費端沒有盤過 ⇒ 板列 `⟦search-LISTVIEWNOEXTID⟧` 記著未來若要動它的入口。
         --    ⛔ ~~理由之一是「它的 COMMENT 逐字寫著排除 external_id, 那個排除看起來是刻意的」~~
         --    🔴 **那句是錯的**(codex + code-reviewer 同時抓):現行 COMMENT(`20260811040000:229`)
         --      逐字是 `excludes price_store, price_by_tier, metadata, detail content and delisted_at`
         --      —— **沒有 external_id**。含它的是 9/10 欄時期那兩代, 而那份清單裡它跟
         --      `description / images / timestamps` 排在一起 ⇒ 那是**卡片瘦身**, 不是安全排除。
         --    ✅ **選甲仍然對, 而理由換成量到的那個**:動公開投影會改欄數與欄位順序,
         --      而**消費端沒有盤過** —— 這一條不需要那句 COMMENT 撐。
      'external_id', pe.external_id,
      'title', pg.title,
      'subtitle', pg.subtitle,
      'handle', pg.handle,
      'availability', pg.availability,
      'price_general', pg.price_general,
      'card_image', pg.card_image,
      'fits', pg.fits,
      'brand_name', pg.brand_name,
      'brand_slug', pg.brand_slug,
      'category_raw', pg.category_raw,
      'fitments', pg.fitments,
      'card_image_trim', CASE WHEN t.url IS NULL THEN NULL ELSE jsonb_build_object(
        'l', t.bbox_left, 't', t.bbox_top, 'w', t.bbox_width, 'h', t.bbox_height,
        'nw', t.natural_width, 'nh', t.natural_height) END
    ),
    pg.total_rows
  FROM paged pg
  LEFT JOIN public.product_image_trim t ON t.url = pg.card_image AND t.status = 'ok'
  -- 🔵 **只在【這一頁】上 join** —— `paged` 已經 LIMIT 過(最多 100 列), 而 join key 是主鍵。
  -- 🔴 用 `LEFT` 不是 `INNER`:兩支 view 都吃 RLS, 正常同進同出;而萬一某一列只在其中一邊,
  --    INNER 會把那張卡**整張弄不見**, LEFT 只讓料號是 null。
  --    ⇒ 📌 **少一個料號 vs 少一張商品卡, 後者嚴重得多。**
  LEFT JOIN public.products_public pe ON pe.id = pg.id
  ORDER BY
    -- #950:🔴 用內層算好的 sort_band / sort_rn, **不要在這裡重算 row_number()**(理由見內層註解)
    -- 🎯 ⟦db-SEARCHFACETMUTEX⟧ 料號完全命中排最前 —— **內外層都要有**, 理由見內層那段。
    CASE WHEN p_sort = 'recommend' AND p_terms IS NOT NULL
         THEN pg.kw_tier END ASC NULLS LAST,
      pg.fit_rank ASC,
      pg.no_img ASC,
    CASE WHEN p_sort = 'recommend' THEN pg.sort_band END ASC NULLS LAST,
    CASE WHEN p_sort = 'recommend' THEN pg.sort_rn   END ASC NULLS LAST,
    CASE WHEN p_sort = 'recommend' THEN pg.price_general END DESC NULLS LAST,
    CASE WHEN p_sort = 'price-asc' THEN pg.price_general END ASC NULLS LAST,
    CASE WHEN p_sort = 'price-desc' THEN pg.price_general END DESC NULLS LAST,
    CASE WHEN p_sort = 'new' THEN pg.created_at END DESC NULLS LAST,
    pg.id ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_catalog_by_vehicle_dealer(p_categories text[], p_brand text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_offset integer DEFAULT 0, p_limit integer DEFAULT 25, p_sort text DEFAULT 'recommend'::text, p_category text DEFAULT NULL::text, p_brand_slugs text[] DEFAULT NULL::text[], p_price_min integer DEFAULT NULL::integer, p_price_max integer DEFAULT NULL::integer, p_new_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_terms text[] DEFAULT NULL::text[], p_fit_scope text DEFAULT 'all'::text)
 RETURNS TABLE(item jsonb, total bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
-- ⟦DEALER-GUARD-DECL-BEGIN⟧
  v_uid  uuid;
  v_tier text;
-- ⟦DEALER-GUARD-DECL-END⟧
  -- 🔴🔴 **`v_cats` 把新舊兩個入口收成【一份】** —— 新的 `p_categories` 加上舊的 `p_category`。
  --    ⇒ 📌 下面每一處都只讀 `v_cats`, **不再有任何一處直接讀 `p_category`**
  --      ⇒ 那讓「漏改一處」變成不可能, 而不是靠人數對。
  -- 🔴🔴 **[2026-09-04 本支改的就是這件事 —— 而它【只動排序, 不動過濾】]**
  --    Sean 2026-09-04 逐字「3. 甲」= 帶分類時也照【中高價位優先】排。
  --    ⛔ ~~原本 12 處排序 CASE 都掛著 `AND cardinality(v_cats) = 0`~~
  --       ⇒ 一旦帶了分類, 那組 CASE 全部回 NULL ⇒ **唯一還在生效的鍵是 `f.id ASC`(UUID)**
  --       ⇒ 📌 **客人點進一個分類, 第一頁等於【隨機順序】** —— 而那不是「另一種排法」, 是沒有排法。
  --    ✅ 本支把那 12 處的 `AND cardinality(v_cats) = 0` 拿掉。
  --    🛑 **而【WHERE 那兩處一個字都沒動】** —— 那是過濾, 不是排序:
  --       `WHERE (cardinality(v_cats) = 0 OR ...)` 決定「要不要套分類過濾」。
  --       ⇒ 動它會改變**回傳哪些商品**, 而本支只改**它們的順序**。
  --    🔵 而「大類輪流」(`sort_rn` 的 PARTITION BY 大類)在只選一個分類時**自然變成 no-op**
  --       —— 同一個 partition ⇒ 剩下「中高價分帶 + 段內由高到低」, 那正是 Sean 要的。
  -- 🛑 **而「空」的判準一律是 `cardinality(v_cats) = 0`, 不是 `IS NULL`** ——
  --    陣列有兩種空(NULL 與 `{}`), 而**它們在 `IS NULL` 上不一樣**。
  --    🔬 本檔實測到的分母:`p_category IS NULL` 在原版出現 **12** 次(兩份查詢各 6)
  --      ⇒ ⚠️ 而 plan 裡我寫「三行」—— 那是**只 grep 到一份查詢**的數。**12 才是對的。**
  v_cats text[];
  -- ⛔ ~~`c_batch_day_threshold constant int := 100;`~~ 與它上面那段說明 ——
  --    2026-09-09 Sean 拍甲拿掉「一天超過 N 件就整天不算新品」那條規則,常數與兩個分支一起刪。
  --    🔴 舊字面刻意留刪除線:拿「批次門檻」去搜的人要同一發撞到這句訂正。
  -- ── #950 推薦排序:中高價位優先(Sean 2026-08-27「中間~高 價位優先在前面好了」, 選項回「乙」)──
  -- 🔴 這兩個數字是【我們挑的, 不是他挑的】。他看到的選項字面是
  --    「這次先寫死在程式裡, 記一筆待辦(要改得叫我們)」, 而他回【甲】
  --    ⇒ 他同意的是那個做法, **不是這兩個值**。
  -- 🔴🔴 **要改就是改這兩行。**
  --    ⚠️ **而 backlog `#950` 目前【還沒有】指回本檔**(code-reviewer 實查:
  --       `grep -n '20260827150000' docs/phase-1-backlog.md` ⇒ 0 命中)
  --       ⇒ 那句「要改得叫我們」的承諾,現在只有【這一行】是它的地址。
  --       ⇒ 條目改寫是欠著的工(見 checkpoint), 而在那之前不要說「backlog 指到這裡」。
  --      (改了要開新 migration 重貼整支函式, 理由同上面那個門檻常數。)
  -- 值的來源:全站群代表價分布, 2026-08-27 量於報價單庫 storefront_catalog_v(22,193 群)
  --    中位數 4,000 / P90 13,800 ⇒ 段界取【中位數 ~ P90】
  --    ⚠️ 換成 Q3~P95(7,480 ~ 約 21,000)⇒ 第一頁整批換人、平均單價高很多
  -- 分類第一段 = 這個字的商品【不進新品區】(Sean 2026-08-27 拍【甲】= 照大類切)。
  -- 🔴 用 split_part 取第一段, 不是整串比對 —— 以後多出「維修零件 · 油封」這種子類會【自動】跟著排除,
  --    不需要有人記得回來改。Sean 拍甲的理由就是這個(de 端題時已明說「今天甲乙行為一樣, 差別在以後」)。
  -- ⚠️ 只作用在【新品模式】(p_new_since IS NOT NULL)。目錄 / 搜尋 / 品牌頁 / 分類頁傳 NULL ⇒ 不受影響;
  --    客人在分類頁直接看「維修零件」時 p_new_since 也是 NULL ⇒ 那 1631 件照常看得到。
  c_new_arrivals_excluded_category constant text := '維修零件';
  c_recommend_band_lo constant int := 4000;
  c_recommend_band_hi constant int := 13800;
  -- 🔴🔴 ⟦db-SEARCHFACETMUTEX⟧ **「空白」的字集 —— 顯式列舉**(codex R1 nit + R2 nit)
  --   ⛔ ~~`btrim(pt)` 預設~~ 只剝 ASCII 空格;⛔ ~~`pt ~ '[^[:space:]]'`~~ **依 locale**
  --     (我自己的 harness 在 `--locale=C` 下抓到它對全形空格失效)。
  --   ⇒ 📌 兩個都不行, 而它們**在正式庫與拋棄式庫會給不同答案, 且兩邊都不報錯**。
  c_ws constant text := E' \t\n\r\x0B\f\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF';
BEGIN
-- ⟦DEALER-GUARD-BEGIN⟧
  -- 🔴🔴 fail-closed 身分閘 —— 而它【故意不 fallback 回一般價】。
  --    📌 一個「安全的 fallback」會讓這一整支存在的理由消失, 而且不會有人發現:
  --       退回一般價 = 這支變成 search_catalog_by_vehicle 的複本, 而呼叫端本來就該挑。
  --    ⇒ 查無 / 非 store ⇒ RAISE, 讓「叫錯支」在第一次就被看見。
  -- 🔵 寫法照範本 public.get_effective_prices(20260907010000):auth.uid() ⇒ 查 customers.tier。
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '經銷目錄:沒有登入身分 ⇒ 這支只給經銷會員, 一般客人請叫 public.search_catalog_by_vehicle'
      USING ERRCODE = 'PCM04';
  END IF;
  SELECT c.tier INTO v_tier FROM public.customers c WHERE c.user_id = v_uid;
  IF v_tier IS DISTINCT FROM 'store' THEN
    RAISE EXCEPTION '經銷目錄:這個帳號的 tier 是 %(期望 store)⇒ 拒絕', coalesce(v_tier, '(查無此人)')
      USING ERRCODE = 'PCM04';
  END IF;
-- ⟦DEALER-GUARD-END⟧
  -- 🔵 新舊合流:兩個都給的話一起吃(聯集)。`p_category` 是舊入口, 保留到步驟 C 才 DROP。
  v_cats := (
    -- 🔴 **`btrim` 要寫回, 不是只拿來過濾**(codex nit):原版只用它排除空白字串,
    --    而 `' 排氣系統 '` 會**帶著空白留下來** ⇒ 比不到任何分類, 而且不會與無空白版去重。
    SELECT coalesce(array_agg(DISTINCT btrim(x)), ARRAY[]::text[])
      FROM unnest(coalesce(p_categories, ARRAY[]::text[])
                  || CASE WHEN p_category IS NULL THEN ARRAY[]::text[] ELSE ARRAY[p_category] END) AS x
     WHERE btrim(x) <> ''
  );
  IF p_brand IS NULL THEN
    RETURN QUERY
    WITH kw AS MATERIALIZED (
      -- 🎯 ⟦db-SEARCHFACETMUTEX⟧ 2026-09-09:關鍵字命中集合**提到 CTE**, 而理由有兩個。
      --   ① 要把 `is_exact` 帶進 `filtered` 當排序鍵 —— 寫成每列一次的純量子查詢的話,
      --      那支 SRF 會**對結果集的每一列各跑一次**。
      --   ② `MATERIALIZED` 是刻意的:少了它 planner 可能把它推進 JOIN 反覆求值。
      -- 🔵 **`p_terms IS NULL` 時它照樣跑一次, 而那一次是空的** ——
      --   `array_agg` 對空集合回 NULL ⇒ 該函式內部 `unnest(NULL)` ⇒ 零詞 ⇒ 它自己的
      --   `WHERE n.want > 0` 直接回零列。⛔ ~~今天每一發零成本~~ ⇒ 現在是**一次零列呼叫**。
      --   ⇒ 📌 那是本片的成本, 明寫在這裡而不是讓下一個人自己發現。
      SELECT k.id, k.is_exact, k.tier
        FROM public.storefront_search_product_ids(
               (SELECT array_agg(pt) FROM unnest(p_terms) AS pt WHERE btrim(pt, c_ws) <> '')) k
    ), filtered AS (
      SELECT p.*, COALESCE(kw.is_exact, false) AS kw_exact, COALESCE(kw.tier, 3) AS kw_tier, 0 AS fit_rank,
             public.pcm_card_image_is_placeholder(p.card_image) AS no_img
      FROM public.products_list_dealer p
      -- 🔵 LEFT JOIN 不是 INNER —— 沒有關鍵字時 `kw` 是空的,
      --    用 INNER 會把整張目錄濾光, 而 HTTP 200、畫面完全正常。
      LEFT JOIN kw ON kw.id = p.id
      -- 🔴🔴 **不是 `= ANY(v_cats)`** —— 分類的述詞有【兩個分支】(`=` 與 `LIKE 父 · %`),
      --    而品牌只有一個 ⇒ 照抄品牌那一格會**漏掉「打大類要涵蓋子類」那一半**,
      --    而它看起來完全正確。⇒ 每一個元素都要走那兩個分支。
      -- ✅ **聯集**(任一元素中就算中)= Sean 2026-09-04 拍的甲:
      --    逐字「甲 聯集 —— 排氣管【或】油箱貼, 兩種商品都列出來(比較多)」。
      WHERE (cardinality(v_cats) = 0
             OR EXISTS (SELECT 1 FROM unnest(v_cats) AS vc
                         WHERE p.category_raw = vc OR p.category_raw LIKE vc || ' · %'))
        AND (p_brand_slugs IS NULL OR cardinality(p_brand_slugs) = 0 OR p.brand_slug = ANY(p_brand_slugs))
        AND (p_price_min IS NULL OR p.price_general >= p_price_min)
        AND (p_price_max IS NULL OR p.price_general <= p_price_max)
        AND (p_new_since IS NULL OR (
              p.created_at >= p_new_since
              -- 上界（codex R2 NIT-2）：未來時戳的列不算新品，否則它會永遠釘在「新品」第一位。
              -- ⛔ ~~「只夾窗、不夾 new_batch_days」~~ —— 2026-09-09 批次日規則已拿掉,
              --    這一行留下的只有【上界】那半, 而它自己的理由(上一行)仍然成立。
              AND p.created_at <= now()
              -- 🔴 維修零件不進新品區。`coalesce` 少不得:category_raw 若為 NULL,
              --    `split_part(NULL,…) <> '維修零件'` 會回 NULL ⇒ 那一列會被【當成維修零件排掉】。
              --    現值空值 0 ⇒ 今天看不出差別, 而那正是它以後會安靜咬人的原因。
              AND coalesce(split_part(p.category_raw, ' · ', 1), '') <> c_new_arrivals_excluded_category
            ))
        -- 🔴🔴 ⟦db-SEARCHFACETMUTEX⟧ 關鍵字那一格 —— **比對【不在這裡】做**, 委給 `storefront_search_product_ids`。
        --    🎯 **為什麼委出去**:那支已經有四欄 ILIKE + 品牌名 + 母料號前綴 + 變體 sku 四塊,
        --      而每一塊的守門條件都付過學費(見 `20260906950000` 的註解)⇒ 自己再寫一份 ILIKE
        --      = 兩份會漂, 而漂的方向是【客人搜不到】, 那沒有人會回報。
        --    🛑 **而 `products_list_public` 上【沒有】`description` 與 `external_id` 兩欄**
        --      ⇒ 就算想在這裡比也比不完整;委出去那一側走的是 `products_public`。
        -- 🔴🔴 **第二個條件不可以省, 而少了它會【整站零商品】**:
        --    被委的那支在零個有效詞時逐字「回零列(不是回全表)」(`20260906950000` 的 `WHERE n.want > 0`)
        --    ⇒ 📌 `p_terms = ARRAY['']` 這種呼叫會讓每一列都被濾掉, 而 HTTP 200、畫面完全正常。
        --    ⇒ **「沒有關鍵字」這件事必須在【這裡】判, 不得委出去。**
        --    🔴🔴 **「有效詞」的判準【刻意與被委那支不同】, 而差的方向是承重的**(codex R1 nit):
--      被委那支用 `btrim(term) <> ''`, 而 **`btrim` 預設只剝 ASCII 空格**
--      ⇒ 📌 `ARRAY[E'\t']` / 換行 / 全形空格 `U+3000` 在它眼裡是**有效詞**
--        ⇒ 它會拿 `%<tab>%` 去比 ⇒ 回零列 ⇒ **整站零商品**, 又是同一個形狀。
--      ⛔ ~~我的第一版寫 `pt ~ '[^[:space:]]'`~~ —— 🔴 **那一版是【我自己的 harness 抓到的】**:
--        `[[:space:]]` 是**依 locale 的**, 而拋棄式庫跑在 `--locale=C` ⇒ 它只認 ASCII
--        ⇒ 全形空格 `U+3000` 那一格實測 **0(期望 4)**。
--        📌 而正式庫是 UTF-8 locale ⇒ 📌 **同一段碼在兩個環境會給不同答案, 而兩邊都不報錯。**
--      ✅ 改成**顯式列舉**(與 `normalizeSearchInput` 學到的同一課:`\s` 不含 `U+200B`)
--        `btrim(pt, ' '||chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(8203)||chr(12288)||chr(65279))`
--        ⇒ 空白 / tab / 換行 / 零寬空格 / 全形空格 / BOM,**locale 無關** ⇒ **比被委那支寬**
--        ⇒ 純空白的詞在這裡算「沒有關鍵字」⇒ **不過濾, 出全部**。
--    🔴🔴 **[codex R2 must-fix]** ⛔ ~~只擋「整組都是空白」就夠~~ —— **那句是假的, 而反例很小**:
--      `ARRAY['碳纖維', E'\t']` ⇒ 第一個詞有效 ⇒ 整組過了我的閘 ⇒ **連同那個 tab 原樣送出去**
--      ⇒ 被委那支把 tab 當成**第二個必要條件**(`count(DISTINCT ord) = want`)
--      ⇒ 📌 **一筆都不會中** ⇒ 客人打了字而拿到 0 件, 而畫面完全正常。
--      ✅ **所以不是【擋】, 是【濾】**:只把有效詞 `array_agg` 起來送出去。
--      🎯 兩邊不一致仍是刻意的, 而現在它**真的**只往【出全部】倒 —— 空白詞根本不會抵達那一支。
        AND (p_terms IS NULL
             OR NOT EXISTS (SELECT 1 FROM unnest(p_terms) AS pt WHERE btrim(pt, c_ws) <> '')
             -- ⛔ ~~`OR p.id IN (SELECT k.id FROM storefront_search_product_ids(…)) `~~
             -- 🎯 同一個集合改從上面那個 `kw` CTE 來 —— **`IN (SELECT …)` 是集合語意,
             --   那支函式自己的 `ORDER BY`(完全命中排最前)在那一行【蒸發】。**
             --   2026-09-09 實測:`VF11` 的完全命中那顆 第 1 名 ⇒ 第 14 名(最後一名)。
             OR kw.id IS NOT NULL)
    ), paged AS (
      -- count/排序/分頁先收斂到 ≤100 列，trim JOIN 只對當頁做（20260719150000 MF-4）
      SELECT f.*, count(*) OVER () AS total_rows,
        -- ── #950 recommend 的兩個排序欄。🔴 **算在這裡, 不算在外層 ORDER BY 裡** ──
        --   理由是實測踩到的:第一版把 row_number() 寫進【外層】那個 ORDER BY,
        --   它會對【已經分頁後的那幾列】重算一次 ⇒ 名次變成頁內名次、不是全域名次
        --   ⇒ 第一頁出現重複的大類(2026-08-27 實測:期望 12 個相異大類, 實得 11)。
        --   📌 而 11/12 看起來幾乎對 —— 那正是它難發現的地方。
  -- 🔴🔴 **第二個實測抓到的錯:PARTITION 要含【段】。**
  --   只用大類分割 ⇒ rn 是「這一類【全部】商品裡的名次」, 而段外(比段更貴)的也算在內
  --   ⇒ 各大類段外商品【數量不同】⇒ 每一類第一個段內商品拿到的 rn 不同
  --     (實測:第一頁的 rn 從 24 起跳、有 24 也有 25 ⇒ 同一個大類出現兩次)
  --   ⇒ 加上 band 之後, 每一類【在段內】的名次才從 1 開始, 輪流才真的是輪流。
        CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
             THEN 0 ELSE 1 END AS sort_band,
        -- 🔴 大類 = category_raw 的第一段。單段的分類是合法的(本函式自己的 WHERE 就有
        --    `= p_category` 與 `LIKE p_category || ' · %'` 兩個分支)⇒ split_part 對單段值
        --    回整串 ⇒ 它自成一個大類, 行為正確、不是 bug。
        row_number() OVER (PARTITION BY f.kw_tier, f.fit_rank, f.no_img, split_part(f.category_raw, ' · ', 1),
                                           CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                     AND c_recommend_band_hi THEN 0 ELSE 1 END
                           ORDER BY f.price_general DESC NULLS LAST, f.id) AS sort_rn
      FROM filtered f
      ORDER BY
        -- 🎯 ⟦db-SEARCHFACETMUTEX⟧ **料號完全命中排最前**(Sean 2026-09-06 逐字
        --   「完全命中的排最前」;2026-09-09 拍甲把它接回目錄 RPC)。
        -- 🔴 **只在【有關鍵字】而且【走預設推薦排序】時生效** ——
        --   客人自己點了「價格低到高 / 最新上架」就照他點的走, 不插隊。
        -- 🔵 `f.kw_tier`(20260916140000 起取代 `NOT f.kw_exact`)⇒ 0 料號完全相符 / 1 詞全中 / 2 部分 / 3 其他, ASC 小的在前。
        --   兩個條件任一不成立 ⇒ 整個 CASE 是 NULL ⇒ NULLS LAST ⇒ 全部同分
        --   ⇒ 📌 **沒有關鍵字的那一發, 行為一個位元組都不變。**
        CASE WHEN p_sort = 'recommend' AND p_terms IS NOT NULL
             THEN f.kw_tier END ASC NULLS LAST,
      f.fit_rank ASC,
      f.no_img ASC,
        CASE WHEN p_sort = 'recommend' THEN
          CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
               THEN 0 ELSE 1 END
        END ASC NULLS LAST,
        CASE WHEN p_sort = 'recommend' THEN
          row_number() OVER (PARTITION BY f.kw_tier, f.fit_rank, f.no_img, split_part(f.category_raw, ' · ', 1),
                                             CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                       AND c_recommend_band_hi THEN 0 ELSE 1 END
                             ORDER BY f.price_general DESC NULLS LAST, f.id)
        END ASC NULLS LAST,
        CASE WHEN p_sort = 'recommend' THEN f.price_general END DESC NULLS LAST,
        CASE WHEN p_sort = 'price-asc' THEN f.price_general END ASC NULLS LAST,
        CASE WHEN p_sort = 'price-desc' THEN f.price_general END DESC NULLS LAST,
        CASE WHEN p_sort = 'new' THEN f.created_at END DESC NULLS LAST,
        f.id ASC
      OFFSET GREATEST(p_offset, 0)
      LIMIT LEAST(GREATEST(p_limit, 1), 100)
    )
    SELECT
      jsonb_build_object(
        'id', pg.id,
        -- 🔴 母料號:Sean 2026-09-06 拍「全部頁面都顯示料號」。
        --    來源是 `products_public`(下面 LEFT JOIN 的 `pe`), **不是 `products_list_public`** ——
        --    那支清單投影**沒有這一欄**(2026-09-06 正式庫唯讀逐欄查:16 欄, 無 `external_id`;
        --    而 `products_public` 有 ⇒ 🟢 正對照)。
        -- 🛑 **刻意不動 `products_list_public`**(主視窗 `Q-母料號來源 A: 甲`):它是**公開投影**,
        --    消費端沒有盤過 ⇒ 板列 `⟦search-LISTVIEWNOEXTID⟧` 記著未來若要動它的入口。
         --    ⛔ ~~理由之一是「它的 COMMENT 逐字寫著排除 external_id, 那個排除看起來是刻意的」~~
         --    🔴 **那句是錯的**(codex + code-reviewer 同時抓):現行 COMMENT(`20260811040000:229`)
         --      逐字是 `excludes price_store, price_by_tier, metadata, detail content and delisted_at`
         --      —— **沒有 external_id**。含它的是 9/10 欄時期那兩代, 而那份清單裡它跟
         --      `description / images / timestamps` 排在一起 ⇒ 那是**卡片瘦身**, 不是安全排除。
         --    ✅ **選甲仍然對, 而理由換成量到的那個**:動公開投影會改欄數與欄位順序,
         --      而**消費端沒有盤過** —— 這一條不需要那句 COMMENT 撐。
        'external_id', pe.external_id,
        'title', pg.title,
        'subtitle', pg.subtitle,
        'handle', pg.handle,
        'availability', pg.availability,
        'price_general', pg.price_general,
        'card_image', pg.card_image,
        'fits', pg.fits,
        'brand_name', pg.brand_name,
        'brand_slug', pg.brand_slug,
        'category_raw', pg.category_raw,
        'fitments', pg.fitments,
        'card_image_trim', CASE WHEN t.url IS NULL THEN NULL ELSE jsonb_build_object(
          'l', t.bbox_left, 't', t.bbox_top, 'w', t.bbox_width, 'h', t.bbox_height,
          'nw', t.natural_width, 'nh', t.natural_height) END
      ),
      pg.total_rows
    FROM paged pg
    LEFT JOIN public.product_image_trim t ON t.url = pg.card_image AND t.status = 'ok'
    -- 🔵 **只在【這一頁】上 join** —— `paged` 已經 LIMIT 過(最多 100 列), 而 join key 是主鍵。
    -- 🔴 用 `LEFT` 不是 `INNER`:兩支 view 都吃 RLS, 正常同進同出;而萬一某一列只在其中一邊,
    --    INNER 會把那張卡**整張弄不見**, LEFT 只讓料號是 null。
    --    ⇒ 📌 **少一個料號 vs 少一張商品卡, 後者嚴重得多。**
    LEFT JOIN public.products_public pe ON pe.id = pg.id
    ORDER BY
      -- #950:🔴 用內層算好的 sort_band / sort_rn, **不要在這裡重算 row_number()**(理由見內層註解)
      -- 🎯 ⟦db-SEARCHFACETMUTEX⟧ 料號完全命中排最前 —— **內外層都要有**, 理由見內層那段。
      CASE WHEN p_sort = 'recommend' AND p_terms IS NOT NULL
           THEN pg.kw_tier END ASC NULLS LAST,
      pg.fit_rank ASC,
      pg.no_img ASC,
      CASE WHEN p_sort = 'recommend' THEN pg.sort_band END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN pg.sort_rn   END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN pg.price_general END DESC NULLS LAST,
      CASE WHEN p_sort = 'price-asc' THEN pg.price_general END ASC NULLS LAST,
      CASE WHEN p_sort = 'price-desc' THEN pg.price_general END DESC NULLS LAST,
      CASE WHEN p_sort = 'new' THEN pg.created_at END DESC NULLS LAST,
      pg.id ASC;
    RETURN;
  END IF;

  RETURN QUERY
  WITH kw AS MATERIALIZED (
      -- 🎯 ⟦db-SEARCHFACETMUTEX⟧ 2026-09-09:關鍵字命中集合**提到 CTE**, 而理由有兩個。
      --   ① 要把 `is_exact` 帶進 `filtered` 當排序鍵 —— 寫成每列一次的純量子查詢的話,
      --      那支 SRF 會**對結果集的每一列各跑一次**。
      --   ② `MATERIALIZED` 是刻意的:少了它 planner 可能把它推進 JOIN 反覆求值。
      -- 🔵 **`p_terms IS NULL` 時它照樣跑一次, 而那一次是空的** ——
      --   `array_agg` 對空集合回 NULL ⇒ 該函式內部 `unnest(NULL)` ⇒ 零詞 ⇒ 它自己的
      --   `WHERE n.want > 0` 直接回零列。⛔ ~~今天每一發零成本~~ ⇒ 現在是**一次零列呼叫**。
      --   ⇒ 📌 那是本片的成本, 明寫在這裡而不是讓下一個人自己發現。
      SELECT k.id, k.is_exact, k.tier
        FROM public.storefront_search_product_ids(
               (SELECT array_agg(pt) FROM unnest(p_terms) AS pt WHERE btrim(pt, c_ws) <> '')) k
    ), matched AS (
    SELECT product_id
    FROM public.product_fitments
    WHERE moto_brand = p_brand
      AND (p_model IS NULL OR model_code = p_model)
      AND (p_year IS NULL OR ((year_start IS NULL OR year_start <= p_year)
                          AND (year_end IS NULL OR year_end >= p_year)))
    UNION
    SELECT product_id
    FROM public.product_fitments_effective
    WHERE moto_brand = p_brand
      AND (p_model IS NULL OR model_code = p_model)
      AND (p_year IS NULL OR ((year_start IS NULL OR year_start <= p_year)
                          AND (year_end IS NULL OR year_end >= p_year)))
  ), cand AS (
    -- 🔴 p_fit_scope(20260916220000):all = 兩區都要(= 今天的行為)/ fit = 只有專用 / universal = 只有通用。
    --   🛑 **一律走 coalesce**:`NULL <> 'universal'` 回的是 NULL 不是 false
    --      ⇒ 兩個分支都不成立 ⇒ **回零列, 而 HTTP 200、畫面完全正常**(壞掉跟正常長得一樣)。
    --      ⇒ NULL 與任何不明值一律退回 'all' = 今天的行為(fail-open 到現況, 不是 fail-closed 到空白)。
    --   ⚠️ [R1 N-2] **比對是大小寫敏感、不 trim**:`'Fit'` / `' fit'` 會落回 all。
    --      刻意不加 `lower(btrim(…))` —— 值域由呼叫端的 TS union `CatalogFitScope` 把關,
    --      而在這裡多一層正規化會讓「送錯值」變成靜默容錯, 那反而看不見。
    SELECT m.product_id AS id, 0 AS fit_rank FROM matched m
     WHERE coalesce(p_fit_scope, 'all') <> 'universal'
    UNION ALL
    SELECT pu.id, 1 AS fit_rank
      FROM public.products_list_dealer pu
     WHERE coalesce(p_fit_scope, 'all') <> 'fit'
       AND pu.fitments = '[]'::jsonb
       AND NOT EXISTS (SELECT 1 FROM matched m2 WHERE m2.product_id = pu.id)
       -- 🔴🔴 **[20260916240000 · Sean 2026-09-16 標了六櫃]「一定要分車款」的櫃不進通用區。**
       --   他的判準逐字:「通用零件 = 像護弓、螺絲、機油那種, 本來就不分車款的東西」
       --   ⇒ 整流罩 / 排氣管 / 腳踏後移出現在通用區 = **資料壞了**, 不是通用款。
       --   🛑 **這裡是【不顯示】, 不是【修好】** —— 那 1,993 件的修法在報價單那側,
       --      清單在 `~/pcm-mailbox/待修清單-通用區應該分車款的商品-0916.md`(五個供應商 × 櫃佔 93%)。
       --   🔴 **只擋通用區這一支, 第一區(專用)一個字都沒動** ——
       --      那六櫃若真的有標車款的商品, 照樣出現在上面。
       --   🔴 **`split_part(…, ' · ', 1)` 不是可選的, 今天就有 618 件靠它**:
       --      那六櫃裡四櫃有子類(碳纖維 13 個 / 排氣 7 個 / 腳踏後移 5 個 / ATV 2 個)
       --      ⇒ 2026-09-16 實測:取第一段認得到 1,993 件, 而**整串比對只認得到 1,375 件**。
       --      形狀與同檔 `c_new_arrivals_excluded_category` 一致(Sean 2026-08-27 拍甲的那條)。
       --   ⚠️ 名字改了這一格會失效 —— 而**失效是看得見的**(那六櫃重新出現在通用區, 而 Sean 正是抱怨它的人)。
       AND (
             split_part(pu.category_raw, ' · ', 1) <> ALL (ARRAY[
               '維修零件', '腳踏後移與傳動', '碳纖維部品',
               '四輪 ATV/UTV', '排氣系統', '服務與其他'
             ])
             -- ── ⑧ Sean 2026-09-17 拍甲:Gilles 的替換零件不受上面那條規則管 ──
             --   可以讀成:那六櫃要分車款,**而 gilles 的維修零件是例外**。
             --   🔬 依據(報價單窗實測 + 本側獨立重算,三個證人):
             --     它們在 Gilles 官網的分類是 `Spare parts`(替換零件)——
             --     墊片 / 底板 / 彈簧 / 支架,那些本來就不綁單一車款。
             --   🛑 **而 `category` 那一欄【顧客站這個庫裡不存在】**(`pg_attribute` 實查 = 0,
             --      gilles 的 metadata 只有 `name_en` 一個 key)⇒ 這裡用【等價條件】:
             --      ● 報價單窗量:Spare parts **100% 落在那兩櫃內**(不外溢)
             --      ● 報價單窗量:那兩櫃∧沒車款∧非 Spare parts = **0 列**(沒漏)
             --      ● 本窗用自己的母體獨立算:**810 群**,與 Sean 拍的那個數【逐字相同】
             --      ⇒ 📌 兩個方向都包住 + 第三個獨立證人 ⇒ 集合相同,不是「差不多」。
             --   🟢 **而換成這個條件反而少一個風險**:官網分類名是每晚重抓會覆寫的欄,
             --      Gilles 改官網分類名 ⇒ 原條件會【靜靜失效】;**本條件根本不讀那一欄。**
             --   🔴 **`supplier_slug = 'gilles'` 不是裝飾用的** —— 同兩櫃裡沒車款的還有:
             --      lightech 791 · bonamici 664 · gbracing 84 · evotech 82 · cncracing 23 …
             --      ⇒ **漏掉這一行會一次多放 1,600+ 群**(本窗 2026-09-17 實量,不是理論風險)。
             --   🔵 **不寫「精品螺絲與螺帽」那一櫃**:那 810 群裡有 127 群在那一櫃,
             --      而那一櫃**不在 Sean 標的六櫃裡** ⇒ 它們本來就沒被擋過。
             --      ⇒ 寫進去是一條**永遠不改變結果**的條件,下一個人會花時間看它。
             --      📌 **這一改實際讓 683 群重新看得到**(維修零件那些),**不是 810**。
             --   ⚠️ **它守不到的那一天**:貼完之後若 gilles 的商品被改分類到別櫃,
             --      這個例外會**靜靜失效**。事後閘只看得到貼的那一刻,看不到那一天。
             --      🛑 **而本片刻意不為它開常駐哨兵**(主視窗 2026-09-17 批)。
             OR (
               pu.supplier_slug = 'gilles'
               AND split_part(pu.category_raw, ' · ', 1) = '維修零件'
             )
           )
  ), filtered AS (
    SELECT p.*, COALESCE(kw.is_exact, false) AS kw_exact, COALESCE(kw.tier, 3) AS kw_tier, c.fit_rank,
           public.pcm_card_image_is_placeholder(p.card_image) AS no_img
    FROM public.products_list_dealer p
    JOIN cand c ON c.id = p.id
    -- 🔵 LEFT JOIN 不是 INNER —— 理由同上面那份。
    LEFT JOIN kw ON kw.id = p.id
    -- 🔴 與上面那份同一個修法(本函式有【兩份】查詢, 兩份都要改)。
    WHERE (cardinality(v_cats) = 0
           OR EXISTS (SELECT 1 FROM unnest(v_cats) AS vc
                       WHERE p.category_raw = vc OR p.category_raw LIKE vc || ' · %'))
      AND (p_brand_slugs IS NULL OR cardinality(p_brand_slugs) = 0 OR p.brand_slug = ANY(p_brand_slugs))
      AND (p_price_min IS NULL OR p.price_general >= p_price_min)
      AND (p_price_max IS NULL OR p.price_general <= p_price_max)
      AND (p_new_since IS NULL OR (
            p.created_at >= p_new_since
            AND p.created_at <= now()
            -- 🔴 維修零件不進新品區。`coalesce` 少不得:category_raw 若為 NULL,
            --    `split_part(NULL,…) <> '維修零件'` 會回 NULL ⇒ 那一列會被【當成維修零件排掉】。
            --    現值空值 0 ⇒ 今天看不出差別, 而那正是它以後會安靜咬人的原因。
            AND coalesce(split_part(p.category_raw, ' · ', 1), '') <> c_new_arrivals_excluded_category
          ))
      -- 🔴🔴 ⟦db-SEARCHFACETMUTEX⟧ 關鍵字那一格 —— **比對【不在這裡】做**, 委給 `storefront_search_product_ids`。
      --    🎯 **為什麼委出去**:那支已經有四欄 ILIKE + 品牌名 + 母料號前綴 + 變體 sku 四塊,
      --      而每一塊的守門條件都付過學費(見 `20260906950000` 的註解)⇒ 自己再寫一份 ILIKE
      --      = 兩份會漂, 而漂的方向是【客人搜不到】, 那沒有人會回報。
      --    🛑 **而 `products_list_public` 上【沒有】`description` 與 `external_id` 兩欄**
      --      ⇒ 就算想在這裡比也比不完整;委出去那一側走的是 `products_public`。
      -- 🔴🔴 **第二個條件不可以省, 而少了它會【整站零商品】**:
      --    被委的那支在零個有效詞時逐字「回零列(不是回全表)」(`20260906950000` 的 `WHERE n.want > 0`)
      --    ⇒ 📌 `p_terms = ARRAY['']` 這種呼叫會讓每一列都被濾掉, 而 HTTP 200、畫面完全正常。
      --    ⇒ **「沒有關鍵字」這件事必須在【這裡】判, 不得委出去。**
      --    🔴🔴 **「有效詞」的判準【刻意與被委那支不同】, 而差的方向是承重的**(codex R1 nit):
--      被委那支用 `btrim(term) <> ''`, 而 **`btrim` 預設只剝 ASCII 空格**
--      ⇒ 📌 `ARRAY[E'\t']` / 換行 / 全形空格 `U+3000` 在它眼裡是**有效詞**
--        ⇒ 它會拿 `%<tab>%` 去比 ⇒ 回零列 ⇒ **整站零商品**, 又是同一個形狀。
--      ⛔ ~~我的第一版寫 `pt ~ '[^[:space:]]'`~~ —— 🔴 **那一版是【我自己的 harness 抓到的】**:
--        `[[:space:]]` 是**依 locale 的**, 而拋棄式庫跑在 `--locale=C` ⇒ 它只認 ASCII
--        ⇒ 全形空格 `U+3000` 那一格實測 **0(期望 4)**。
--        📌 而正式庫是 UTF-8 locale ⇒ 📌 **同一段碼在兩個環境會給不同答案, 而兩邊都不報錯。**
--      ✅ 改成**顯式列舉**(與 `normalizeSearchInput` 學到的同一課:`\s` 不含 `U+200B`)
--        `btrim(pt, ' '||chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(8203)||chr(12288)||chr(65279))`
--        ⇒ 空白 / tab / 換行 / 零寬空格 / 全形空格 / BOM,**locale 無關** ⇒ **比被委那支寬**
--        ⇒ 純空白的詞在這裡算「沒有關鍵字」⇒ **不過濾, 出全部**。
--    🔴🔴 **[codex R2 must-fix]** ⛔ ~~只擋「整組都是空白」就夠~~ —— **那句是假的, 而反例很小**:
--      `ARRAY['碳纖維', E'\t']` ⇒ 第一個詞有效 ⇒ 整組過了我的閘 ⇒ **連同那個 tab 原樣送出去**
--      ⇒ 被委那支把 tab 當成**第二個必要條件**(`count(DISTINCT ord) = want`)
--      ⇒ 📌 **一筆都不會中** ⇒ 客人打了字而拿到 0 件, 而畫面完全正常。
--      ✅ **所以不是【擋】, 是【濾】**:只把有效詞 `array_agg` 起來送出去。
--      🎯 兩邊不一致仍是刻意的, 而現在它**真的**只往【出全部】倒 —— 空白詞根本不會抵達那一支。
      AND (p_terms IS NULL
           OR NOT EXISTS (SELECT 1 FROM unnest(p_terms) AS pt WHERE btrim(pt, c_ws) <> '')
           -- ⛔ ~~`OR p.id IN (SELECT k.id FROM storefront_search_product_ids(…)) `~~
           -- 🎯 同一個集合改從上面那個 `kw` CTE 來 —— **`IN (SELECT …)` 是集合語意,
           --   那支函式自己的 `ORDER BY`(完全命中排最前)在那一行【蒸發】。**
           --   2026-09-09 實測:`VF11` 的完全命中那顆 第 1 名 ⇒ 第 14 名(最後一名)。
           OR kw.id IS NOT NULL)
  ), paged AS (
    SELECT f.*, count(*) OVER () AS total_rows,
      -- ── #950 recommend 的兩個排序欄。🔴 **算在這裡, 不算在外層 ORDER BY 裡** ──
      --   理由是實測踩到的:第一版把 row_number() 寫進【外層】那個 ORDER BY,
      --   它會對【已經分頁後的那幾列】重算一次 ⇒ 名次變成頁內名次、不是全域名次
      --   ⇒ 第一頁出現重複的大類(2026-08-27 實測:期望 12 個相異大類, 實得 11)。
      --   📌 而 11/12 看起來幾乎對 —— 那正是它難發現的地方。
  -- 🔴🔴 **第二個實測抓到的錯:PARTITION 要含【段】。**
  --   只用大類分割 ⇒ rn 是「這一類【全部】商品裡的名次」, 而段外(比段更貴)的也算在內
  --   ⇒ 各大類段外商品【數量不同】⇒ 每一類第一個段內商品拿到的 rn 不同
  --     (實測:第一頁的 rn 從 24 起跳、有 24 也有 25 ⇒ 同一個大類出現兩次)
  --   ⇒ 加上 band 之後, 每一類【在段內】的名次才從 1 開始, 輪流才真的是輪流。
      CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
           THEN 0 ELSE 1 END AS sort_band,
      -- 🔴 大類 = category_raw 的第一段。單段的分類是合法的(本函式自己的 WHERE 就有
      --    `= p_category` 與 `LIKE p_category || ' · %'` 兩個分支)⇒ split_part 對單段值
      --    回整串 ⇒ 它自成一個大類, 行為正確、不是 bug。
      row_number() OVER (PARTITION BY f.kw_tier, f.fit_rank, f.no_img, split_part(f.category_raw, ' · ', 1),
                                         CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                   AND c_recommend_band_hi THEN 0 ELSE 1 END
                         ORDER BY f.price_general DESC NULLS LAST, f.id) AS sort_rn
    FROM filtered f
    ORDER BY
      -- 🎯 ⟦db-SEARCHFACETMUTEX⟧ **料號完全命中排最前**(Sean 2026-09-06 逐字
      --   「完全命中的排最前」;2026-09-09 拍甲把它接回目錄 RPC)。
      -- 🔴 **只在【有關鍵字】而且【走預設推薦排序】時生效** ——
      --   客人自己點了「價格低到高 / 最新上架」就照他點的走, 不插隊。
      -- 🔵 `f.kw_tier`(20260916140000 起取代 `NOT f.kw_exact`)⇒ 0 料號完全相符 / 1 詞全中 / 2 部分 / 3 其他, ASC 小的在前。
      --   兩個條件任一不成立 ⇒ 整個 CASE 是 NULL ⇒ NULLS LAST ⇒ 全部同分
      --   ⇒ 📌 **沒有關鍵字的那一發, 行為一個位元組都不變。**
      CASE WHEN p_sort = 'recommend' AND p_terms IS NOT NULL
           THEN f.kw_tier END ASC NULLS LAST,
      f.fit_rank ASC,
      f.no_img ASC,
      CASE WHEN p_sort = 'recommend' THEN
        CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
             THEN 0 ELSE 1 END
      END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN
        row_number() OVER (PARTITION BY f.kw_tier, f.fit_rank, f.no_img, split_part(f.category_raw, ' · ', 1),
                                           CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                     AND c_recommend_band_hi THEN 0 ELSE 1 END
                           ORDER BY f.price_general DESC NULLS LAST, f.id)
      END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN f.price_general END DESC NULLS LAST,
      CASE WHEN p_sort = 'price-asc' THEN f.price_general END ASC NULLS LAST,
      CASE WHEN p_sort = 'price-desc' THEN f.price_general END DESC NULLS LAST,
      CASE WHEN p_sort = 'new' THEN f.created_at END DESC NULLS LAST,
      f.id ASC
    OFFSET GREATEST(p_offset, 0)
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  )
  SELECT
    jsonb_build_object(
      'id', pg.id,
      -- 🔴 母料號:Sean 2026-09-06 拍「全部頁面都顯示料號」。
      --    來源是 `products_public`(下面 LEFT JOIN 的 `pe`), **不是 `products_list_public`** ——
      --    那支清單投影**沒有這一欄**(2026-09-06 正式庫唯讀逐欄查:16 欄, 無 `external_id`;
      --    而 `products_public` 有 ⇒ 🟢 正對照)。
      -- 🛑 **刻意不動 `products_list_public`**(主視窗 `Q-母料號來源 A: 甲`):它是**公開投影**,
      --    消費端沒有盤過 ⇒ 板列 `⟦search-LISTVIEWNOEXTID⟧` 記著未來若要動它的入口。
         --    ⛔ ~~理由之一是「它的 COMMENT 逐字寫著排除 external_id, 那個排除看起來是刻意的」~~
         --    🔴 **那句是錯的**(codex + code-reviewer 同時抓):現行 COMMENT(`20260811040000:229`)
         --      逐字是 `excludes price_store, price_by_tier, metadata, detail content and delisted_at`
         --      —— **沒有 external_id**。含它的是 9/10 欄時期那兩代, 而那份清單裡它跟
         --      `description / images / timestamps` 排在一起 ⇒ 那是**卡片瘦身**, 不是安全排除。
         --    ✅ **選甲仍然對, 而理由換成量到的那個**:動公開投影會改欄數與欄位順序,
         --      而**消費端沒有盤過** —— 這一條不需要那句 COMMENT 撐。
      'external_id', pe.external_id,
      'title', pg.title,
      'subtitle', pg.subtitle,
      'handle', pg.handle,
      'availability', pg.availability,
      'price_general', pg.price_general,
      'card_image', pg.card_image,
      'fits', pg.fits,
      'brand_name', pg.brand_name,
      'brand_slug', pg.brand_slug,
      'category_raw', pg.category_raw,
      'fitments', pg.fitments,
      'card_image_trim', CASE WHEN t.url IS NULL THEN NULL ELSE jsonb_build_object(
        'l', t.bbox_left, 't', t.bbox_top, 'w', t.bbox_width, 'h', t.bbox_height,
        'nw', t.natural_width, 'nh', t.natural_height) END
    ),
    pg.total_rows
  FROM paged pg
  LEFT JOIN public.product_image_trim t ON t.url = pg.card_image AND t.status = 'ok'
  -- 🔵 **只在【這一頁】上 join** —— `paged` 已經 LIMIT 過(最多 100 列), 而 join key 是主鍵。
  -- 🔴 用 `LEFT` 不是 `INNER`:兩支 view 都吃 RLS, 正常同進同出;而萬一某一列只在其中一邊,
  --    INNER 會把那張卡**整張弄不見**, LEFT 只讓料號是 null。
  --    ⇒ 📌 **少一個料號 vs 少一張商品卡, 後者嚴重得多。**
  LEFT JOIN public.products_public pe ON pe.id = pg.id
  ORDER BY
    -- #950:🔴 用內層算好的 sort_band / sort_rn, **不要在這裡重算 row_number()**(理由見內層註解)
    -- 🎯 ⟦db-SEARCHFACETMUTEX⟧ 料號完全命中排最前 —— **內外層都要有**, 理由見內層那段。
    CASE WHEN p_sort = 'recommend' AND p_terms IS NOT NULL
         THEN pg.kw_tier END ASC NULLS LAST,
      pg.fit_rank ASC,
      pg.no_img ASC,
    CASE WHEN p_sort = 'recommend' THEN pg.sort_band END ASC NULLS LAST,
    CASE WHEN p_sort = 'recommend' THEN pg.sort_rn   END ASC NULLS LAST,
    CASE WHEN p_sort = 'recommend' THEN pg.price_general END DESC NULLS LAST,
    CASE WHEN p_sort = 'price-asc' THEN pg.price_general END ASC NULLS LAST,
    CASE WHEN p_sort = 'price-desc' THEN pg.price_general END DESC NULLS LAST,
    CASE WHEN p_sort = 'new' THEN pg.created_at END DESC NULLS LAST,
    pg.id ASC;
END;
$function$;

-- ── 事後閘①:本體是預期那一版(md5), 而且上限字面是 100 ──
DO $post1$
BEGIN
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.search_catalog_by_vehicle(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)')) IS DISTINCT FROM '9242dea94a4ff272efdf485603d821bb' THEN
    RAISE EXCEPTION '退回事後閘①a:search_catalog_by_vehicle 本體不是預期那一版';
  END IF;
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.search_catalog_by_vehicle_dealer(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)')) IS DISTINCT FROM 'e577ec35d5545dcda3174fc1bb8407f3' THEN
    RAISE EXCEPTION '退回事後閘①b:search_catalog_by_vehicle_dealer 本體不是預期那一版';
  END IF;
END
$post1$;

-- ── 事後閘②:沒選車、選車各叫一次 p_limit = 5000(比上限大)⇒ 拿到的列數 = LEAST(100, 總數) ──
--   🔴 少了這一格, md5 對了也證不到「上限真的生效」;用 5000 同時驗「超過上限會被截」。
DO $post2$
DECLARE
  v_n bigint;
  v_total bigint;
BEGIN
  SELECT count(*), max(total) INTO v_n, v_total
    FROM public.search_catalog_by_vehicle(ARRAY[]::text[], NULL, NULL, NULL, 0, 5000);
  IF v_total IS NULL OR v_total <= 100 THEN
    RAISE EXCEPTION '退回事後閘②a:沒選車全站只有 % 件, 驗不到上限 100 ⇒ 停下看資料', v_total;
  END IF;
  IF v_n <> 100 THEN
    RAISE EXCEPTION '退回事後閘②b:p_limit=5000 拿到 % 列, 應為 100', v_n;
  END IF;
  -- 選車那一段是另一份查詢, 要另外驗;用適用商品最多的 Panigale V4(2026-09-22 客人口徑 4,926 件), 總數必須超過上限才驗得到截斷
  SELECT count(*), max(total) INTO v_n, v_total
    FROM public.search_catalog_by_vehicle(ARRAY[]::text[], 'Ducati', 'Panigale V4', NULL, 0, 5000);
  IF v_total IS NULL OR v_total <= 100 THEN
    RAISE EXCEPTION '退回事後閘②c:選車 Ducati Panigale V4 只有 % 件, 驗不到上限 100 ⇒ 停下看資料', v_total;
  END IF;
  IF v_n <> 100 THEN
    RAISE EXCEPTION '退回事後閘②d:選車 Ducati Panigale V4 p_limit=5000 拿到 % 列, 應為 100', v_n;
  END IF;
  RAISE NOTICE '退回事後閘② ok:上限 100 在沒選車與選車兩段都生效(Panigale V4 共 % 件)', v_total;
END
$post2$;

-- ── 事後閘③:owner / SET / ACL / DEFINER 都沒被換掉 ──
--   🔴 CREATE OR REPLACE 會把 SET 子句整組換掉(memory reference_create-or-replace-resets-set-clause)
--      ⇒ 逐字對 2026-09-22 正式庫唯讀讀到的值, 不靠「CREATE OR REPLACE 會保留」那句話。
DO $post3$
BEGIN
  IF (SELECT pg_catalog.pg_get_userbyid(p.proowner) || '|' || p.prosecdef::text || '|' || p.proconfig::text || '|' || p.proacl::text
        FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.search_catalog_by_vehicle(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)'))
     IS DISTINCT FROM 'postgres|false|{"search_path=public, pg_temp"}|{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION '退回事後閘③a:search_catalog_by_vehicle 的 owner / SET / ACL / DEFINER 與貼之前不同';
  END IF;
  IF (SELECT pg_catalog.pg_get_userbyid(p.proowner) || '|' || p.prosecdef::text || '|' || p.proconfig::text || '|' || p.proacl::text
        FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.search_catalog_by_vehicle_dealer(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)'))
     IS DISTINCT FROM 'postgres|true|{"search_path=\"\""}|{postgres=X/postgres,authenticated=X/postgres}' THEN
    RAISE EXCEPTION '退回事後閘③b:search_catalog_by_vehicle_dealer 的 owner / SET / ACL / DEFINER 與貼之前不同(經銷價不能給 anon)';
  END IF;
  RAISE NOTICE '退回事後閘③ ok:兩支 owner / SET / ACL / DEFINER 與貼之前相同';
END
$post3$;

COMMIT;
