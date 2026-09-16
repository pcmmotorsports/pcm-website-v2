-- 20260916220000_m4b_catalog_fit_scope.sql —— 選車結果分兩區:三支目錄 RPC 加 p_fit_scope
-- M-4b · 前台窗 pcm-website-v2-ce(版本號主視窗 pcm-website-v2-6d 指定 20260916220000)
-- Sean 2026-09-16 逐字「依照建議」⇒ Q1 甲(改 RPC 加範圍參數)/ Q2 甲(側欄選車時只算專用)
-- plan:docs/plans/plan-vehicle-results-split-universal.md §2 路 B · §3 側欄 · §7 Q1/Q2
--
-- ══ 為什麼要有這支 ═══════════════════════════════════════════
-- 選 Honda CB1000 Hornet 2026 ⇒ 專用 135 件 / 通用 5,657 件(正式庫實查)
-- ⇒ 畫面上 97.7% 不是為他的車做的。Sean 拍「分兩區, 第二區預設收合」。
-- 🔴 而**前端分組做不到那件事**:一頁 25 筆、專用 135 件 ⇒ 第二區從第 6 頁才開始、橫跨 226 頁
--    ⇒ 收合一個橫跨 226 頁的東西沒有意義 ⇒ 範圍必須下推 DB, 讓兩區各自分頁。
--
-- ══ 做什麼 ═══════════════════════════════════════════════════
-- 三支各加第 N+1 個參數 `p_fit_scope text DEFAULT 'all'::text`(all / fit / universal),
-- 只在**選車分支**的 `cand` 那一段生效;沒選車(p_brand IS NULL)完全不受影響。
--   public.search_catalog_by_vehicle         13 → 14 參數(SECURITY INVOKER)
--   public.search_catalog_by_vehicle_dealer  13 → 14 參數(🔴 SECURITY DEFINER · search_path '')
--   public.catalog_facet_counts               7 →  8 參數(LANGUAGE sql)
--
-- 🔴 **函式本體 = 正式庫現況逐字**(2026-09-16 唯讀 `pg_get_functiondef(oid)` 匯出後用程式打補丁,
--    **沒有手打、沒有整理縮排**)。理由:repo 的 migration 與正式庫是兩個宣稱, 而抄錯是手打來的。
--    前例 `20260902200000` 同一個作法。
--
-- ══ 🔴 簽章改變 ⇒ DROP + CREATE 同一交易 ═══════════════════════
-- `CREATE OR REPLACE` 遇到**不同簽章會【新建一支】**變成多載, 而「取代」與「新建」在事後計數上一樣。
-- ⇒ 本支先 `DROP FUNCTION` 舊簽章再**裸 `CREATE`**(不是 OR REPLACE):
--    DROP 沒發生 ⇒ CREATE 撞名 ⇒ 整支交易回捲而且**會出聲**。
-- 🔴 **DROP 會把 ACL 與 COMMENT 一起丟掉** ⇒ 下面逐支把 ACL 還原, 並在事後閘逐支逐角色驗。
--    (實查:三支都**沒有** COMMENT ⇒ 沒有要還原的。)
--
-- ⚠️ **公開那支在正式庫還留著一支 11 參數舊多載,本支【不碰它】**(不在範圍內)。
--    呼叫端送的名字集合含 `p_categories` + `p_terms` ⇒ 只可能命中新那支 14 參。
--
-- ══ 上線順序 ═══════════════════════════════════════════════════
-- 🟢 **板先貼, 再推碼。** 新參數帶 DEFAULT ⇒ 貼完之後**舊碼(送 13 個具名參數)照樣叫得動**、行為不變。
--    ⇒ 這**不是** 2026-09-16 板 199 那種兩個方向都有空窗的情況(那是加**必填**參數)。
--    碼先推 ⇒ 新碼送 p_fit_scope ⇒ PGRST202 ⇒ 所以順序不能反。
-- 貼完 NOTIFY pgrst。🔴 貼完同批跑 pcm_acl_approve_latest(p_note 帶版本號 20260916220000):3 支換一代。
-- 鎖:三支 DROP + CREATE, 不動表。
--
-- ══ rollback ═══════════════════════════════════════════════════
-- SET LOCAL lock_timeout = '5s';
-- (上一行 = 退回檔開頭那句, rollback-locktimeout-gate 要它在本段第一行)
-- supabase/rollbacks/20260916220000-rollback.sql:DROP 三支新簽章 + 回 13/13/7 參那一代本體(md5 釘)+ 還原 ACL。
-- ============================================================

BEGIN;
SET LOCAL lock_timeout = '5s';
-- 事後閘的行為格會對正式資料各叫幾次列表 / 件數(有車 = 全目錄掃描)⇒ 給 120s 上界
SET LOCAL statement_timeout = '120s';

-- ── 前置閘:三支必須是 2026-09-16 正式庫量到的那一代(md5 of prosrc)──────────
DO $pre$
BEGIN
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.search_catalog_by_vehicle(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[])'))
     IS DISTINCT FROM '58e35a8b6f40022ac7545a2488f0dcec' THEN
    RAISE EXCEPTION '前置閘一:search_catalog_by_vehicle(13 參) 不是 2026-09-16 量到的那一代(md5 對不上)⇒ 有人改過或施工窗先貼了, 停下對齊';
  END IF;
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.search_catalog_by_vehicle_dealer(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[])'))
     IS DISTINCT FROM '1c3f0386b9d20f12f12d5df44a744648' THEN
    RAISE EXCEPTION '前置閘二:search_catalog_by_vehicle_dealer(13 參) 不是那一代(md5 對不上), 停';
  END IF;
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.catalog_facet_counts(text[],text[],text,text,integer,text[],text[])'))
     IS DISTINCT FROM '37665499408108cbf2f1dc4fd7de42a5' THEN
    RAISE EXCEPTION '前置閘三:catalog_facet_counts(7 參) 不是那一代(md5 對不上), 停';
  END IF;
  IF pg_catalog.to_regprocedure('public.search_catalog_by_vehicle(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘四:14 參那支已經存在 ⇒ 本檔貼過了且沒退, 停';
  END IF;
  -- 🔴 兩張 view 少一欄, 下面的 cand 會在 CREATE 當下就炸;先講清楚是缺欄不是語法錯
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute a
       WHERE a.attrelid = 'public.products_list_public'::regclass
         AND a.attname IN ('fitments','category_raw','brand_slug') AND NOT a.attisdropped) <> 3
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute a
       WHERE a.attrelid = 'public.products_list_dealer'::regclass
         AND a.attname IN ('fitments') AND NOT a.attisdropped) <> 1 THEN
    RAISE EXCEPTION '前置閘五:products_list_public / products_list_dealer 缺欄';
  END IF;
END
$pre$;

-- ── DROP 舊簽章(ACL 與 COMMENT 跟著沒)───────────────────────────
DROP FUNCTION public.search_catalog_by_vehicle(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[]);
DROP FUNCTION public.search_catalog_by_vehicle_dealer(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[]);
DROP FUNCTION public.catalog_facet_counts(text[],text[],text,text,integer,text[],text[]);

-- ── ① 列表(公開)—— SECURITY INVOKER · search_path public, pg_temp ──────────
CREATE FUNCTION public.search_catalog_by_vehicle(p_categories text[], p_brand text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_offset integer DEFAULT 0, p_limit integer DEFAULT 25, p_sort text DEFAULT 'recommend'::text, p_category text DEFAULT NULL::text, p_brand_slugs text[] DEFAULT NULL::text[], p_price_min integer DEFAULT NULL::integer, p_price_max integer DEFAULT NULL::integer, p_new_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_terms text[] DEFAULT NULL::text[], p_fit_scope text DEFAULT 'all'::text)
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
-- ACL 還原(DROP 丟掉了, 這裡逐支寫回 2026-09-16 實查到的那一組)
--   實查 proacl:{postgres=X, anon=X, authenticated=X, service_role=X}
-- ACL-GATE-EXEMPT: public.search_catalog_by_vehicle -- 顧客站目錄頁 anon 直接叫的公開查詢, 這不是【打開】而是【還原 DROP 丟掉的既有授權】(2026-09-16 實查 proacl = anon/authenticated/service_role, 版本號 20260916220000);事後閘③c + ⑥ 同檔逐角色驗

-- 🔴🔴 **[R1 must-fix MF-1]`ALTER … OWNER TO postgres` —— 這是【裸 CREATE 第一次】才需要的一行。**
--   前兩代(20260916120000 / 20260916140000)走 `CREATE OR REPLACE` ⇒ **OR REPLACE 會保留 owner**;
--   本支是 `DROP` + 裸 `CREATE` ⇒ **新函式的 owner = 貼的人**(`current_user`)。
--   ⇒ 📌 **一個以前不用管的東西, 從今天起取決於「誰貼的」, 而驗它的那道閘同時不存在。**
--   🔬 為什麼對經銷那支是承重的(2026-09-16 正式庫實查):
--      `products_list_dealer` 的 relacl = `{postgres=arwdDxtm/postgres}` ⇒ **除了 owner 沒有任何角色讀得到**
--      ⇒ 經銷 RPC 是 SECURITY DEFINER、**它讀得到那張 view 靠的就是 owner 是 postgres**。
--      · owner 變成別的非特權角色 ⇒ 每一個經銷會員開目錄 = `permission denied for view products_list_dealer`
--      · owner 變成 superuser(例如 supabase_admin)⇒ 這支函式改用 superuser 身分跑, 而它 GRANT 給 authenticated
--   ⚠️ **照平常從 SQL Editor 以 postgres 貼, 今天不會壞** —— 這補的是【被刪掉而沒有替代品的閘】,
--      不是線上已經發生的洞。repo 裡沒有任何工具在看函式 owner(`acl-snapshot.sh` 只記 view 的 relowner)。
--   🔵 前例:出生那一片 `20260908010000:50` 有 owner 閘;兄弟片 `20260916140000:398` 有 `OWNER TO postgres`。
ALTER FUNCTION public.search_catalog_by_vehicle(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.search_catalog_by_vehicle(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_catalog_by_vehicle(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text) TO anon, authenticated, service_role;

-- ── ② 列表(經銷)—— 🔴 SECURITY DEFINER · SET search_path TO '' ────────────
--   🔴🔴 那兩個屬性**必須跟著本體一起回去**:`CREATE OR REPLACE` 會把 SET 子句整組換掉
--        (memory reference_create-or-replace-resets-set-clause), 而本支是 DROP+CREATE ⇒ 更是從零帶。
--        ⇒ 事後閘 ③ 逐支驗 prosecdef 與 proconfig, 不靠肉眼。
CREATE FUNCTION public.search_catalog_by_vehicle_dealer(p_categories text[], p_brand text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_offset integer DEFAULT 0, p_limit integer DEFAULT 25, p_sort text DEFAULT 'recommend'::text, p_category text DEFAULT NULL::text, p_brand_slugs text[] DEFAULT NULL::text[], p_price_min integer DEFAULT NULL::integer, p_price_max integer DEFAULT NULL::integer, p_new_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_terms text[] DEFAULT NULL::text[], p_fit_scope text DEFAULT 'all'::text)
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
-- ACL 還原 —— 🔴 **經銷那支跟公開那支不一樣**:實查 proacl 只有 {postgres=X, authenticated=X}
--   ⇒ **沒有 anon、也沒有 service_role**。照抄公開那支的 GRANT 會把經銷目錄開給 anon。
-- ACL-GATE-EXEMPT: public.search_catalog_by_vehicle_dealer -- 🔴 只給 authenticated, 刻意【不給 anon 也不給 service_role】(2026-09-16 實查 proacl = postgres/authenticated, 版本號 20260916220000);經銷會員自己讀自己的價, anon 拿到就是經銷價外洩 ⇒ 事後閘③a 反向驗 anon/service_role 叫不動
-- 🔴 三支裡【這一支】是 owner 真正承重的那個(理由見上面那段)。
ALTER FUNCTION public.search_catalog_by_vehicle_dealer(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.search_catalog_by_vehicle_dealer(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_catalog_by_vehicle_dealer(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text) TO authenticated;

-- ── ③ 側欄件數 —— LANGUAGE sql · 母體形狀照抄列表那支的 cand ────────────────
CREATE FUNCTION public.catalog_facet_counts(p_category_keys text[], p_brand_keys text[], p_brand text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_selected_categories text[] DEFAULT NULL::text[], p_selected_brand_slugs text[] DEFAULT NULL::text[], p_fit_scope text DEFAULT 'all'::text)
 RETURNS TABLE(facet text, key text, n bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH sel AS (
    -- 已選分類:與列表的 v_cats 同一個正規化(btrim 寫回、丟空字串、去重)
    SELECT coalesce(array_agg(DISTINCT btrim(x)), ARRAY[]::text[]) AS cats
      FROM unnest(coalesce(p_selected_categories, ARRAY[]::text[])) AS x
     WHERE btrim(x) <> ''
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
    -- 🔴🔴 形狀【逐字照抄列表那兩支的 cand】—— 側欄件數與清單母體**必須是同一個形狀**。
    --   ⛔ 不另外寫一份等價的 OR 條件:兩份各自寫的條件遲早分岔, 而**分岔的那天沒有任何東西會叫**
    --      (側欄說 29 而點進去 0 件 = 「亮法宣告的狀態跟母體對不起來」那一族)。
    --   🔵 對 'all' 這一段與被取代的那一代【同集合】。
    --   ⛔ ~~「舊的是 `matched OR fitments='[]'`」~~ —— [R1 N-4] **那句指的是更早的版本**:
    --      被本支取代的 `20260916120000` 起, facet 這裡已經是 `matched OR fitments='[]'`,
    --      而列表那兩支早就是 `matched UNION ALL (通用 AND NOT EXISTS matched)`。
    --      ⇒ 正確說法:本支把 facet 也換成列表那個形狀, 兩者在 'all' 之下同集合。
    -- 🔴 p_fit_scope(20260916220000):all = 兩區都要(= 今天的行為)/ fit = 只有專用 / universal = 只有通用。
    --   🛑 **一律走 coalesce**:`NULL <> 'universal'` 回的是 NULL 不是 false
    --      ⇒ 兩個分支都不成立 ⇒ **回零列, 而 HTTP 200、畫面完全正常**(壞掉跟正常長得一樣)。
    --      ⇒ NULL 與任何不明值一律退回 'all' = 今天的行為(fail-open 到現況, 不是 fail-closed 到空白)。
    --   ⚠️ [R1 N-2] **比對是大小寫敏感、不 trim**:`'Fit'` / `' fit'` 會落回 all。
    --      刻意不加 `lower(btrim(…))` —— 值域由呼叫端的 TS union `CatalogFitScope` 把關,
    --      而在這裡多一層正規化會讓「送錯值」變成靜默容錯, 那反而看不見。
    SELECT m.product_id AS id FROM matched m
     WHERE coalesce(p_fit_scope, 'all') <> 'universal'
    UNION ALL
    SELECT pu.id
      FROM public.products_list_public pu
     WHERE coalesce(p_fit_scope, 'all') <> 'fit'
       AND pu.fitments = '[]'::jsonb
       AND NOT EXISTS (SELECT 1 FROM matched m2 WHERE m2.product_id = pu.id)
  ), g AS (
    -- 一次掃描收成 (分類, 品牌) 組(正式庫全目錄 370 組)
    -- 🔵 沒車 = 列表的 `IF p_brand IS NULL` 那一支:不看 p_model / p_year
    SELECT p.category_raw, p.brand_slug, count(*) AS n
      FROM public.products_list_public p
     WHERE p_brand IS NULL OR p.id IN (SELECT c.id FROM cand c)
     GROUP BY p.category_raw, p.brand_slug
  ), ck AS (
    -- 🔵 key 原樣回傳, 比對用 btrim 後的值 —— 列表那一側的 facet key 也會被 v_cats btrim
    --    空白 key 不回列 ⇒ 前端當「沒有數字」(不是 0)
    SELECT DISTINCT k AS key, btrim(k) AS kt
      FROM unnest(coalesce(p_category_keys, ARRAY[]::text[])) AS k
     WHERE btrim(k) <> ''
  ), bk AS (
    SELECT DISTINCT b AS key
      FROM unnest(coalesce(p_brand_keys, ARRAY[]::text[])) AS b
  )
  SELECT 'category'::text, ck.key, coalesce(sum(g.n), 0)::bigint
    FROM ck
    LEFT JOIN g
      ON (g.category_raw = ck.kt OR g.category_raw LIKE ck.kt || ' · %')
     AND (p_selected_brand_slugs IS NULL OR cardinality(p_selected_brand_slugs) = 0
          OR g.brand_slug = ANY(p_selected_brand_slugs))
   GROUP BY ck.key
  UNION ALL
  SELECT 'brand'::text, bk.key, coalesce(sum(g.n), 0)::bigint
    FROM bk
    CROSS JOIN sel
    LEFT JOIN g
      ON g.brand_slug = bk.key
     AND (cardinality(sel.cats) = 0
          OR EXISTS (SELECT 1 FROM unnest(sel.cats) AS vc
                      WHERE g.category_raw = vc OR g.category_raw LIKE vc || ' · %'))
   GROUP BY bk.key;
$function$;
-- ACL 還原:實查 proacl {postgres=X, anon=X, authenticated=X, service_role=X}
-- ACL-GATE-EXEMPT: public.catalog_facet_counts -- 側欄件數與上面那支公開目錄同一條路、同一組角色, 還原既有授權(2026-09-16 實查 proacl = anon/authenticated/service_role, 版本號 20260916220000);事後閘③c + ⑥ 同檔驗
ALTER FUNCTION public.catalog_facet_counts(text[],text[],text,text,integer,text[],text[],text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.catalog_facet_counts(text[],text[],text,text,integer,text[],text[],text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_facet_counts(text[],text[],text,text,integer,text[],text[],text) TO anon, authenticated, service_role;

-- ══ 事後閘 ═══════════════════════════════════════════════════════
DO $post$
DECLARE
  v_brand text; v_model text;
  v_all bigint; v_fit bigint; v_uni bigint; v_def bigint;
BEGIN
  -- ① 三支新簽章都在, 三支舊簽章都不在
  IF pg_catalog.to_regprocedure('public.search_catalog_by_vehicle(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)') IS NULL
     OR pg_catalog.to_regprocedure('public.search_catalog_by_vehicle_dealer(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)') IS NULL
     OR pg_catalog.to_regprocedure('public.catalog_facet_counts(text[],text[],text,text,integer,text[],text[],text)') IS NULL THEN
    RAISE EXCEPTION '事後閘①a:新簽章沒建起來';
  END IF;
  IF pg_catalog.to_regprocedure('public.search_catalog_by_vehicle(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[])') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.search_catalog_by_vehicle_dealer(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[])') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.catalog_facet_counts(text[],text[],text,text,integer,text[],text[])') IS NOT NULL THEN
    RAISE EXCEPTION '事後閘①b:舊簽章還在 ⇒ 多載並存, PostgREST 會挑到誰沒有人保證';
  END IF;

  -- ② 🔴 SET 子句與 SECURITY 屬性逐支驗(不靠肉眼 —— CREATE 從零帶, 漏了不會有人叫)
  IF (SELECT p.proconfig FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.search_catalog_by_vehicle(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)'))
     IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] THEN
    RAISE EXCEPTION '事後閘②a:公開列表的 SET search_path 不是 public, pg_temp';
  END IF;
  IF (SELECT p.proconfig FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.search_catalog_by_vehicle_dealer(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)'))
     IS DISTINCT FROM ARRAY['search_path=""'] THEN
    RAISE EXCEPTION '事後閘②b:🔴 經銷列表的 SET search_path 不是空字串 ⇒ SECURITY DEFINER 下這是可利用的';
  END IF;
  IF (SELECT p.proconfig FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.catalog_facet_counts(text[],text[],text,text,integer,text[],text[],text)'))
     IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] THEN
    RAISE EXCEPTION '事後閘②c:側欄件數的 SET search_path 不對';
  END IF;
  IF (SELECT p.prosecdef FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.search_catalog_by_vehicle_dealer(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)')) IS NOT TRUE THEN
    RAISE EXCEPTION '事後閘②d:經銷列表掉了 SECURITY DEFINER ⇒ 經銷會員會拿不到自己的價';
  END IF;
  IF (SELECT p.prosecdef FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.search_catalog_by_vehicle(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)')) IS NOT FALSE
     OR (SELECT p.prosecdef FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.catalog_facet_counts(text[],text[],text,text,integer,text[],text[],text)')) IS NOT FALSE THEN
    RAISE EXCEPTION '事後閘②e:公開那兩支變成 SECURITY DEFINER ⇒ 多給了權限';
  END IF;

  -- ②f 🔴 [MF-1] owner 逐支驗 —— 裸 CREATE 的 owner 是【貼的人】, 不是自動的
  IF (SELECT pg_catalog.pg_get_userbyid(p.proowner) FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.search_catalog_by_vehicle_dealer(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)')) <> 'postgres' THEN
    RAISE EXCEPTION '事後閘②f:🔴 經銷列表的 owner 不是 postgres ⇒ 它是 SECURITY DEFINER 且 products_list_dealer 只有 owner 讀得到 ⇒ 經銷會員會 permission denied, 或反過來拿到過高的身分';
  END IF;
  IF (SELECT pg_catalog.pg_get_userbyid(p.proowner) FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.search_catalog_by_vehicle(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)')) <> 'postgres'
     OR (SELECT pg_catalog.pg_get_userbyid(p.proowner) FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.catalog_facet_counts(text[],text[],text,text,integer,text[],text[],text)')) <> 'postgres' THEN
    RAISE EXCEPTION '事後閘②g:公開那兩支的 owner 不是 postgres';
  END IF;

  -- ③ 🔴 ACL 逐支逐角色 —— DROP 丟掉的那一組有沒有原樣回來
  IF pg_catalog.has_function_privilege('anon', pg_catalog.to_regprocedure('public.search_catalog_by_vehicle_dealer(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)'), 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', pg_catalog.to_regprocedure('public.search_catalog_by_vehicle_dealer(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)'), 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘③a:🔴 anon 或 service_role 拿到了經銷目錄的執行權 ⇒ 經銷價會外洩';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', pg_catalog.to_regprocedure('public.search_catalog_by_vehicle_dealer(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)'), 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘③b:authenticated 叫不動經銷目錄 ⇒ 經銷會員的目錄頁會空';
  END IF;
  IF NOT (pg_catalog.has_function_privilege('anon', pg_catalog.to_regprocedure('public.search_catalog_by_vehicle(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)'), 'EXECUTE')
      AND pg_catalog.has_function_privilege('authenticated', pg_catalog.to_regprocedure('public.search_catalog_by_vehicle(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)'), 'EXECUTE')
      AND pg_catalog.has_function_privilege('service_role', pg_catalog.to_regprocedure('public.search_catalog_by_vehicle(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)'), 'EXECUTE')
      AND pg_catalog.has_function_privilege('anon', pg_catalog.to_regprocedure('public.catalog_facet_counts(text[],text[],text,text,integer,text[],text[],text)'), 'EXECUTE')
      AND pg_catalog.has_function_privilege('authenticated', pg_catalog.to_regprocedure('public.catalog_facet_counts(text[],text[],text,text,integer,text[],text[],text)'), 'EXECUTE')
      AND pg_catalog.has_function_privilege('service_role', pg_catalog.to_regprocedure('public.catalog_facet_counts(text[],text[],text,text,integer,text[],text[],text)'), 'EXECUTE')) THEN
    RAISE EXCEPTION '事後閘③c:公開那兩支的 anon/authenticated/service_role 執行權沒回來 ⇒ 顧客站目錄會 403';
  END IF;

  -- ④ 行為格:挑一台【真的有專用件】的車, 驗三件事
  --    🔵 空庫(schema dump)沒有資料 ⇒ 印 NOTICE 跳過, 不當成綠
  SELECT f.moto_brand, f.model_code INTO v_brand, v_model
    FROM public.product_fitments f
    JOIN public.products_list_public v ON v.id = f.product_id
   GROUP BY f.moto_brand, f.model_code HAVING pg_catalog.count(*) >= 5
   -- 🔵 [R1 N-3] ORDER BY 不是排版:少了它每次挑到哪台不保證一樣 ⇒ 重放時驗到的東西會漂。
   ORDER BY f.moto_brand, f.model_code LIMIT 1;
  IF v_brand IS NULL THEN
    RAISE NOTICE '事後閘④:沒有資料可驗行為(空庫重放)⇒ 跳過。🔴 這是【跳過】不是【通過】。';
  ELSE
    SELECT total INTO v_all FROM public.search_catalog_by_vehicle(
      ARRAY[]::text[], v_brand, v_model, NULL, 0, 1, 'recommend', NULL, NULL, NULL, NULL, NULL, NULL, 'all') LIMIT 1;
    SELECT total INTO v_fit FROM public.search_catalog_by_vehicle(
      ARRAY[]::text[], v_brand, v_model, NULL, 0, 1, 'recommend', NULL, NULL, NULL, NULL, NULL, NULL, 'fit') LIMIT 1;
    SELECT total INTO v_uni FROM public.search_catalog_by_vehicle(
      ARRAY[]::text[], v_brand, v_model, NULL, 0, 1, 'recommend', NULL, NULL, NULL, NULL, NULL, NULL, 'universal') LIMIT 1;
    -- 不傳 p_fit_scope ⇒ 吃 DEFAULT ⇒ 必須與 'all' 一樣(這一格守的是「舊碼貼完照樣正確」)
    SELECT total INTO v_def FROM public.search_catalog_by_vehicle(
      ARRAY[]::text[], v_brand, v_model, NULL, 0, 1, 'recommend', NULL, NULL, NULL, NULL, NULL, NULL) LIMIT 1;
    IF v_def IS DISTINCT FROM v_all THEN
      RAISE EXCEPTION '事後閘④a:不傳 p_fit_scope 的結果(%) 與 all(%) 不同 ⇒ 舊碼貼完行為就變了', v_def, v_all;
    END IF;
    IF coalesce(v_fit,0) + coalesce(v_uni,0) IS DISTINCT FROM coalesce(v_all,0) THEN
      RAISE EXCEPTION '事後閘④b:fit(%) + universal(%) <> all(%) ⇒ 兩區【不是】互斥且窮盡, 會有商品兩邊都不在或重複', v_fit, v_uni, v_all;
    END IF;
    IF coalesce(v_fit,0) = 0 THEN
      RAISE EXCEPTION '事後閘④c:挑到的車(% %)專用件是 0 ⇒ 這一格沒有驗到東西(分母 0 時任何結果都自動成立)', v_brand, v_model;
    END IF;
    -- 🟢 負對照:不明值必須退回 all 的行為, 不是回零列
    SELECT total INTO v_def FROM public.search_catalog_by_vehicle(
      ARRAY[]::text[], v_brand, v_model, NULL, 0, 1, 'recommend', NULL, NULL, NULL, NULL, NULL, NULL, 'xxx-不存在的值') LIMIT 1;
    IF v_def IS DISTINCT FROM v_all THEN
      RAISE EXCEPTION '事後閘④d:不明的 p_fit_scope 沒有退回 all(得 %, 期望 %)', v_def, v_all;
    END IF;
    SELECT total INTO v_def FROM public.search_catalog_by_vehicle(
      ARRAY[]::text[], v_brand, v_model, NULL, 0, 1, 'recommend', NULL, NULL, NULL, NULL, NULL, NULL, NULL) LIMIT 1;
    IF v_def IS DISTINCT FROM v_all THEN
      RAISE EXCEPTION '事後閘④e:🔴 p_fit_scope = NULL 回了 % 而不是 % ⇒ coalesce 沒生效, 而零列在畫面上看起來完全正常', v_def, v_all;
    END IF;
    RAISE NOTICE '事後閘④ 通過:% % ⇒ all=% fit=% universal=%', v_brand, v_model, v_all, v_fit, v_uni;
  END IF;
END
$post$;

-- ══ 事後閘⑤:🔴 側欄件數與清單【同一個母體】—— Q2 保的就是這件事 ══════════
--   側欄說 29 而點進去 0 件 = 「亮法宣告的狀態跟清單母體對不起來」那一族。
--   ⇒ 這一格用**大類 key 的件數總和** 對 **清單的 total**, 兩邊都傳 'fit'。
--   🛑 **[R1 N-5] 天花板明寫**:`catalog_facet_counts` 根本**沒有** p_terms / p_price_min /
--      p_price_max / p_new_since 四個參數, 而清單那兩支都套 ⇒ 客人**同時選車 + 拉價格或打關鍵字**時,
--      側欄數字仍然會比清單 total 大。**那是既有行為、不是本片引入**, 而本閘只跑無篩選那一格
--      ⇒ 🔴 **不要把這一格讀成「側欄與清單已經全等」。** 它只證了 cand 的形狀一致。
--     (每個商品的 category_raw 只會命中一個大類 key ⇒ 總和 = 商品數。)
DO $facet$
DECLARE
  v_brand text; v_model text; v_keys text[]; v_sum bigint; v_total bigint;
BEGIN
  SELECT f.moto_brand, f.model_code INTO v_brand, v_model
    FROM public.product_fitments f
    JOIN public.products_list_public v ON v.id = f.product_id
   GROUP BY f.moto_brand, f.model_code HAVING pg_catalog.count(*) >= 5
   -- 🔵 [R1 N-3] ORDER BY 不是排版:少了它每次挑到哪台不保證一樣 ⇒ 重放時驗到的東西會漂。
   ORDER BY f.moto_brand, f.model_code LIMIT 1;
  IF v_brand IS NULL THEN
    RAISE NOTICE '事後閘⑤:空庫 ⇒ 跳過。🔴 這是【跳過】不是【通過】。';
  ELSE
    SELECT pg_catalog.array_agg(DISTINCT pg_catalog.split_part(v.category_raw, ' · ', 1)) INTO v_keys
      FROM public.products_list_public v;
    SELECT pg_catalog.sum(n) INTO v_sum
      FROM public.catalog_facet_counts(v_keys, ARRAY[]::text[], v_brand, v_model, NULL, NULL, NULL, 'fit')
     WHERE facet = 'category';
    SELECT total INTO v_total FROM public.search_catalog_by_vehicle(
      ARRAY[]::text[], v_brand, v_model, NULL, 0, 1, 'recommend', NULL, NULL, NULL, NULL, NULL, NULL, 'fit') LIMIT 1;
    IF coalesce(v_sum,0) IS DISTINCT FROM coalesce(v_total,0) THEN
      RAISE EXCEPTION '事後閘⑤:側欄件數總和(%) <> 清單 total(%) ⇒ 兩邊母體不同, 側欄會說謊', v_sum, v_total;
    END IF;
    IF coalesce(v_total,0) = 0 THEN
      RAISE EXCEPTION '事後閘⑤b:total 是 0 ⇒ 分母 0 時「總和相等」自動成立, 這一格沒有驗到東西';
    END IF;
    RAISE NOTICE '事後閘⑤ 通過:% % ⇒ 側欄總和 = 清單 total = %', v_brand, v_model, v_total;
  END IF;
END
$facet$;

-- ══ 事後閘⑥:收權斷言清單(三支都是【新簽章 = 新物件】, ACL 從零帶)═══════
--   🔴 DROP 把舊 ACL 丟掉了 ⇒ 新建的那三支帶【出廠預設】, 而出廠預設 = PUBLIC 可執行。
--      ⇒ 這一格逐支驗「proacl 不是 NULL」與「PUBLIC 不在裡面」, 不靠上面的 GRANT 寫對。
DO $aclassert$
DECLARE
  v_functions text[] := ARRAY[
    'public.search_catalog_by_vehicle(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)',
    'public.search_catalog_by_vehicle_dealer(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)',
    'public.catalog_facet_counts(text[],text[],text,text,integer,text[],text[],text)'
  ]::text[];
  f    text;
  v_oid oid;
BEGIN
  FOREACH f IN ARRAY v_functions LOOP
    v_oid := pg_catalog.to_regprocedure(f)::oid;
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '事後閘⑥a:% 不存在', f;
    END IF;
    IF (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid) IS NULL THEN
      RAISE EXCEPTION '事後閘⑥b:% 的 proacl 是 NULL ⇒ 等於 PUBLIC 可執行(出廠預設沒被收掉)', f;
    END IF;
    IF pg_catalog.has_function_privilege('public', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '事後閘⑥c:PUBLIC 可以執行 % ⇒ 收權沒生效', f;
    END IF;
  END LOOP;
  RAISE NOTICE '事後閘⑥ 通過:三支 ACL 都收掉 PUBLIC 了';
END
$aclassert$;

COMMIT;
