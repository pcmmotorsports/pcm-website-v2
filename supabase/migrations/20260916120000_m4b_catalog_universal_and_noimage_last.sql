-- 20260916120000_m4b_catalog_universal_and_noimage_last.sql —— 目錄頁:選車也列通用款(Q8)+ 無圖排最後(Q9)
-- M-4b · 主視窗 pcm-website-v2-b7 派(版本號主視窗指定);Sean 2026-09-15 22:4x Q8 甲 / Q9 甲
-- plan:docs/plans/2026-09-15-catalog-universal-and-noimage-plan.md(§5 三題 Sean 全答甲)
-- adversarial-reviewer R1 FAIL 三條 must-fix 已修:① sort_rn 分區加 fit_rank / no_img(否則推薦排序各大類輪流上第一頁會被打亂)
--   ② helper 不用 STABLE 的 concat(否則不 inline)③ 事後閘④a 不寫 `OR p.id IN (…)`(P3 F7 同形)
--
-- ══ 做什麼 ═════════════════════════════════════════════════
-- ① 新增 public.pcm_card_image_is_placeholder(text):卡片首圖「沒有真圖」判準的 SQL 版
--    = packages/domain/src/catalog/supplier-placeholder.ts 的 hasNoRealImage(null / 空白 / PCM no-photo.png / 供應商佔位圖前綴)
--    🔴 兩份清單會分岔 ⇒ apps/storefront/src/lib/card-image-placeholder-sql-parity.test.ts 從本檔抽 regex 與 TS 清單逐組比
--    🔵 刻意【不】設 search_path:設了就不能被 inline,每列多一次函式呼叫;本體函式都寫 pg_catalog. 前綴,運算子 = / ~ / || 靠 pg_catalog 隱式排第一
--    🔴 本體只准用 IMMUTABLE 的東西(R1 must-fix:原本用 concat 是 STABLE ⇒ planner 不 inline);現在是兩個 regex 比對,都是 IMMUTABLE
-- ② search_catalog_by_vehicle(公開)與 _dealer(經銷)同一組改動:
--    · 選車分支:`matched` 之後加 `cand` = 專用(fit_rank 0)UNION ALL 通用款 fitments='[]' 且不在 matched(fit_rank 1)
--      🔴 不用 `p.id IN (matched) OR p.fitments = '[]'`:plpgsql 走 plan cache,custom plan 下同形 OR + IN 實測 > 60s(catalog-timeout plan §P3 F7)
--    · 兩個分支都算 no_img;內層 paged 與外層 SELECT 排序鍵都加在「關鍵字完全命中」之後:fit_rank → no_img → 既有鍵(所有排序模式)
-- ③ catalog_facet_counts:選車時也算通用款(`OR p.fitments = '[]'::jsonb`)⇒ 側欄件數 = 點進去的 total
--    LANGUAGE sql 走 generic plan(P3 F2 證實)⇒ hashed SubPlan,不走 custom plan 那條
--
-- ══ 上線順序 ═══════════════════════════════════════════════
-- 純 DB,TS 不用改(RPC 回傳形狀不變)。貼完 NOTIFY pgrst。
-- 🔴 貼完同批跑 pcm_acl_approve_latest(p_note 帶版本號 20260916120000):新增 1 支 public 函式 + 3 支換一代。
-- 鎖:三支 CREATE OR REPLACE FUNCTION + 一支 CREATE FUNCTION,不動表。
--
-- ══ 拋棄式 PG 驗證 ════════════════════════════════════════════
-- 空庫(schema dump)上事後閘的行為格會印 NOTICE 跳過;要驗行為先塞種子。
--
-- ══ rollback ════════════════════════════════════════════════
-- SET LOCAL lock_timeout = '5s';
-- (上一行 = 退回檔開頭那句,rollback-locktimeout-gate 要它在本段第一行)
-- supabase/rollbacks/20260916120000-rollback.sql:三支函式回 20260909070000 / 20260912010000 本體(md5 釘)+ DROP helper。

BEGIN;
SET LOCAL lock_timeout = '5s';
-- 事後閘行為格會對正式資料各叫幾次列表 / 件數(有車 = 全目錄掃描)⇒ 給 120s 上界
SET LOCAL statement_timeout = '120s';

-- ── 前置閘:三支函式必須是 2026-09-15 正式庫量到的那一代(md5 of prosrc)────────
DO $pre$
BEGIN
  IF pg_catalog.to_regprocedure('public.pcm_card_image_is_placeholder(text)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘一:pcm_card_image_is_placeholder(text) 已存在 ⇒ 本檔貼過了且沒退, 停';
  END IF;
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.search_catalog_by_vehicle(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[])')) IS DISTINCT FROM '1757ca8bd92a6d8c10f08fbcb1338fe1' THEN
    RAISE EXCEPTION '前置閘二:search_catalog_by_vehicle 不是 20260909070000 那一代(md5 對不上)⇒ 有人改過或施工窗先貼了, 停下對齊';
  END IF;
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.search_catalog_by_vehicle_dealer(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[])')) IS DISTINCT FROM 'eaee6f2f418312775746676d51300a35' THEN
    RAISE EXCEPTION '前置閘三:search_catalog_by_vehicle_dealer 不是 20260909070000 那一代(md5 對不上), 停';
  END IF;
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.catalog_facet_counts(text[],text[],text,text,integer,text[],text[])')) IS DISTINCT FROM 'aae85942d04afaa0cc2f3a89a83e1275' THEN
    RAISE EXCEPTION '前置閘四:catalog_facet_counts 不是 20260912010000 那一代(md5 對不上), 停';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute a
       WHERE a.attrelid = 'public.products_list_public'::regclass AND a.attname IN ('fitments', 'card_image') AND NOT a.attisdropped) <> 2
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute a
       WHERE a.attrelid = 'public.products_list_dealer'::regclass AND a.attname IN ('fitments', 'card_image') AND NOT a.attisdropped) <> 2 THEN
    RAISE EXCEPTION '前置閘五:products_list_public / products_list_dealer 缺 fitments 或 card_image 欄';
  END IF;
END
$pre$;

-- ── ① helper ─────────────────────────────────────────────────
CREATE FUNCTION public.pcm_card_image_is_placeholder(p_url text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $helper$
  -- 一條不分大小寫的 regex 對整個網址:scheme:// [userinfo@] host [:port] / 任意路徑段 / 最後一段檔名(前綴或全等)[?#…]
  -- = TS:new URL().hostname 全等 + pathname 最後一段 toLowerCase().startsWith(prefix);PCM 那組是檔名全等。
  -- 🔵 原本拆成 substring × 2 + regexp_replace + lower × 2,正式庫沒選車推薦多 ~520ms;單一 regex 約 ~290ms(本機 118,807 組網址兩種寫法答案全同)
  SELECT p_url IS NULL
      OR p_url ~ '^[[:space:]]*$'
      OR p_url ~* '^[A-Za-z][A-Za-z0-9+.-]*://(?:[^@/?#]*@)?(?:www\.gillestooling\.com(?::[^/?#]*)?/(?:[^?#]*/)?(?:spareparts-mit-tesxt[^/?#]*|bild-schraube-[^/?#]*|bild-folgt-in-kurze-[^/?#]*)|www\.extreme-components\.com(?::[^/?#]*)?/(?:[^?#]*/)?(?:noimage\.jpg[^/?#]*)|www\.gbracing\.eu(?::[^/?#]*)?/(?:[^?#]*/)?(?:no-image-[^/?#]*)|www\.motogadget\.com(?::[^/?#]*)?/(?:[^?#]*/)?(?:no-image-[^/?#]*)|rpmcarbon\.com(?::[^/?#]*)?/(?:[^?#]*/)?(?:no-image-[^/?#]*)|quote\.pcmmotorsports\.com(?::[^/?#]*)?/(?:[^?#]*/)?(?:no-photo\.png))(?:[?#]|$)';
$helper$;

COMMENT ON FUNCTION public.pcm_card_image_is_placeholder(text) IS
  '卡片首圖「沒有真圖」(20260916120000;Q9 無圖排最後)。= packages/domain/src/catalog/supplier-placeholder.ts hasNoRealImage 的 SQL 版:'
  ' null / 空白 / quote.pcmmotorsports.com 的 no-photo.png / 供應商佔位圖(host 全等 + 檔名前綴,檔名小寫比)。'
  ' 解析不了的字串回 false(與 TS fail-open 同)。清單兩份由 card-image-placeholder-sql-parity.test.ts 釘住。不設 search_path 是為了 inline。';

-- ACL-GATE-EXEMPT: public.pcm_card_image_is_placeholder -- 純字串判斷(IMMUTABLE、不讀任何表), 由公開目錄 RPC(SECURITY INVOKER, anon 呼叫)在本體內呼叫 ⇒ anon 必須能執行(pattern §3.1);授權集合同 search_catalog_by_vehicle(anon/authenticated/service_role)(Sean Q9 甲, 20260916120000)
REVOKE ALL ON FUNCTION public.pcm_card_image_is_placeholder(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pcm_card_image_is_placeholder(text) TO anon, authenticated, service_role;

-- ── ② 列表(公開)────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_catalog_by_vehicle(p_categories text[], p_brand text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_offset integer DEFAULT 0, p_limit integer DEFAULT 25, p_sort text DEFAULT 'recommend'::text, p_category text DEFAULT NULL::text, p_brand_slugs text[] DEFAULT NULL::text[], p_price_min integer DEFAULT NULL::integer, p_price_max integer DEFAULT NULL::integer, p_new_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_terms text[] DEFAULT NULL::text[])
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
      SELECT k.id, k.is_exact
        FROM public.storefront_search_product_ids(
               (SELECT array_agg(pt) FROM unnest(p_terms) AS pt WHERE btrim(pt, c_ws) <> '')) k
    ), filtered AS (
      SELECT p.*, COALESCE(kw.is_exact, false) AS kw_exact, 0 AS fit_rank,
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
        row_number() OVER (PARTITION BY f.fit_rank, f.no_img, split_part(f.category_raw, ' · ', 1),
                                           CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                     AND c_recommend_band_hi THEN 0 ELSE 1 END
                           ORDER BY f.price_general DESC NULLS LAST, f.id) AS sort_rn
      FROM filtered f
      ORDER BY
        -- 🎯 ⟦db-SEARCHFACETMUTEX⟧ **料號完全命中排最前**(Sean 2026-09-06 逐字
        --   「完全命中的排最前」;2026-09-09 拍甲把它接回目錄 RPC)。
        -- 🔴 **只在【有關鍵字】而且【走預設推薦排序】時生效** ——
        --   客人自己點了「價格低到高 / 最新上架」就照他點的走, 不插隊。
        -- 🔵 `NOT f.kw_exact` ⇒ 完全命中是 false(0) ⇒ ASC 把它排在最前面。
        --   兩個條件任一不成立 ⇒ 整個 CASE 是 NULL ⇒ NULLS LAST ⇒ 全部同分
        --   ⇒ 📌 **沒有關鍵字的那一發, 行為一個位元組都不變。**
        CASE WHEN p_sort = 'recommend' AND p_terms IS NOT NULL
             THEN NOT f.kw_exact END ASC NULLS LAST,
      f.fit_rank ASC,
      f.no_img ASC,
        CASE WHEN p_sort = 'recommend' THEN
          CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
               THEN 0 ELSE 1 END
        END ASC NULLS LAST,
        CASE WHEN p_sort = 'recommend' THEN
          row_number() OVER (PARTITION BY f.fit_rank, f.no_img, split_part(f.category_raw, ' · ', 1),
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
           THEN NOT pg.kw_exact END ASC NULLS LAST,
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
      SELECT k.id, k.is_exact
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
    SELECT m.product_id AS id, 0 AS fit_rank FROM matched m
    UNION ALL
    SELECT pu.id, 1 AS fit_rank
      FROM public.products_list_public pu
     WHERE pu.fitments = '[]'::jsonb
       AND NOT EXISTS (SELECT 1 FROM matched m2 WHERE m2.product_id = pu.id)
  ), filtered AS (
    SELECT p.*, COALESCE(kw.is_exact, false) AS kw_exact, c.fit_rank,
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
      row_number() OVER (PARTITION BY f.fit_rank, f.no_img, split_part(f.category_raw, ' · ', 1),
                                         CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                   AND c_recommend_band_hi THEN 0 ELSE 1 END
                         ORDER BY f.price_general DESC NULLS LAST, f.id) AS sort_rn
    FROM filtered f
    ORDER BY
      -- 🎯 ⟦db-SEARCHFACETMUTEX⟧ **料號完全命中排最前**(Sean 2026-09-06 逐字
      --   「完全命中的排最前」;2026-09-09 拍甲把它接回目錄 RPC)。
      -- 🔴 **只在【有關鍵字】而且【走預設推薦排序】時生效** ——
      --   客人自己點了「價格低到高 / 最新上架」就照他點的走, 不插隊。
      -- 🔵 `NOT f.kw_exact` ⇒ 完全命中是 false(0) ⇒ ASC 把它排在最前面。
      --   兩個條件任一不成立 ⇒ 整個 CASE 是 NULL ⇒ NULLS LAST ⇒ 全部同分
      --   ⇒ 📌 **沒有關鍵字的那一發, 行為一個位元組都不變。**
      CASE WHEN p_sort = 'recommend' AND p_terms IS NOT NULL
           THEN NOT f.kw_exact END ASC NULLS LAST,
      f.fit_rank ASC,
      f.no_img ASC,
      CASE WHEN p_sort = 'recommend' THEN
        CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
             THEN 0 ELSE 1 END
      END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN
        row_number() OVER (PARTITION BY f.fit_rank, f.no_img, split_part(f.category_raw, ' · ', 1),
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
         THEN NOT pg.kw_exact END ASC NULLS LAST,
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

-- ── ② 列表(經銷)────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_catalog_by_vehicle_dealer(p_categories text[], p_brand text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_offset integer DEFAULT 0, p_limit integer DEFAULT 25, p_sort text DEFAULT 'recommend'::text, p_category text DEFAULT NULL::text, p_brand_slugs text[] DEFAULT NULL::text[], p_price_min integer DEFAULT NULL::integer, p_price_max integer DEFAULT NULL::integer, p_new_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_terms text[] DEFAULT NULL::text[])
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
      SELECT k.id, k.is_exact
        FROM public.storefront_search_product_ids(
               (SELECT array_agg(pt) FROM unnest(p_terms) AS pt WHERE btrim(pt, c_ws) <> '')) k
    ), filtered AS (
      SELECT p.*, COALESCE(kw.is_exact, false) AS kw_exact, 0 AS fit_rank,
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
        row_number() OVER (PARTITION BY f.fit_rank, f.no_img, split_part(f.category_raw, ' · ', 1),
                                           CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                     AND c_recommend_band_hi THEN 0 ELSE 1 END
                           ORDER BY f.price_general DESC NULLS LAST, f.id) AS sort_rn
      FROM filtered f
      ORDER BY
        -- 🎯 ⟦db-SEARCHFACETMUTEX⟧ **料號完全命中排最前**(Sean 2026-09-06 逐字
        --   「完全命中的排最前」;2026-09-09 拍甲把它接回目錄 RPC)。
        -- 🔴 **只在【有關鍵字】而且【走預設推薦排序】時生效** ——
        --   客人自己點了「價格低到高 / 最新上架」就照他點的走, 不插隊。
        -- 🔵 `NOT f.kw_exact` ⇒ 完全命中是 false(0) ⇒ ASC 把它排在最前面。
        --   兩個條件任一不成立 ⇒ 整個 CASE 是 NULL ⇒ NULLS LAST ⇒ 全部同分
        --   ⇒ 📌 **沒有關鍵字的那一發, 行為一個位元組都不變。**
        CASE WHEN p_sort = 'recommend' AND p_terms IS NOT NULL
             THEN NOT f.kw_exact END ASC NULLS LAST,
      f.fit_rank ASC,
      f.no_img ASC,
        CASE WHEN p_sort = 'recommend' THEN
          CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
               THEN 0 ELSE 1 END
        END ASC NULLS LAST,
        CASE WHEN p_sort = 'recommend' THEN
          row_number() OVER (PARTITION BY f.fit_rank, f.no_img, split_part(f.category_raw, ' · ', 1),
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
           THEN NOT pg.kw_exact END ASC NULLS LAST,
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
      SELECT k.id, k.is_exact
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
    SELECT m.product_id AS id, 0 AS fit_rank FROM matched m
    UNION ALL
    SELECT pu.id, 1 AS fit_rank
      FROM public.products_list_dealer pu
     WHERE pu.fitments = '[]'::jsonb
       AND NOT EXISTS (SELECT 1 FROM matched m2 WHERE m2.product_id = pu.id)
  ), filtered AS (
    SELECT p.*, COALESCE(kw.is_exact, false) AS kw_exact, c.fit_rank,
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
      row_number() OVER (PARTITION BY f.fit_rank, f.no_img, split_part(f.category_raw, ' · ', 1),
                                         CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                   AND c_recommend_band_hi THEN 0 ELSE 1 END
                         ORDER BY f.price_general DESC NULLS LAST, f.id) AS sort_rn
    FROM filtered f
    ORDER BY
      -- 🎯 ⟦db-SEARCHFACETMUTEX⟧ **料號完全命中排最前**(Sean 2026-09-06 逐字
      --   「完全命中的排最前」;2026-09-09 拍甲把它接回目錄 RPC)。
      -- 🔴 **只在【有關鍵字】而且【走預設推薦排序】時生效** ——
      --   客人自己點了「價格低到高 / 最新上架」就照他點的走, 不插隊。
      -- 🔵 `NOT f.kw_exact` ⇒ 完全命中是 false(0) ⇒ ASC 把它排在最前面。
      --   兩個條件任一不成立 ⇒ 整個 CASE 是 NULL ⇒ NULLS LAST ⇒ 全部同分
      --   ⇒ 📌 **沒有關鍵字的那一發, 行為一個位元組都不變。**
      CASE WHEN p_sort = 'recommend' AND p_terms IS NOT NULL
           THEN NOT f.kw_exact END ASC NULLS LAST,
      f.fit_rank ASC,
      f.no_img ASC,
      CASE WHEN p_sort = 'recommend' THEN
        CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
             THEN 0 ELSE 1 END
      END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN
        row_number() OVER (PARTITION BY f.fit_rank, f.no_img, split_part(f.category_raw, ' · ', 1),
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
         THEN NOT pg.kw_exact END ASC NULLS LAST,
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

-- ── ③ 側欄件數 ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.catalog_facet_counts(
  p_category_keys        text[],
  p_brand_keys           text[],
  p_brand                text    DEFAULT NULL,
  p_model                text    DEFAULT NULL,
  p_year                 integer DEFAULT NULL,
  p_selected_categories  text[]  DEFAULT NULL,
  p_selected_brand_slugs text[]  DEFAULT NULL
)
 RETURNS TABLE(facet text, key text, n bigint)
 LANGUAGE sql
 STABLE SECURITY INVOKER
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
  ), g AS (
    -- 一次掃描收成 (分類, 品牌) 組(正式庫全目錄 370 組)
    -- 🔵 沒車 = 列表的 `IF p_brand IS NULL` 那一支:不看 p_model / p_year
    SELECT p.category_raw, p.brand_slug, count(*) AS n
      FROM public.products_list_public p
     WHERE p_brand IS NULL OR p.id IN (SELECT m.product_id FROM matched m) OR p.fitments = '[]'::jsonb
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

-- ── 事後閘 ──────────────────────────────────────────────────────
DO $post$
DECLARE
  -- 收權斷言清單(靜態閘 ③ 數的就是這個陣列;裸 CREATE FUNCTION 1 支)
  v_functions text[] := ARRAY['public.pcm_card_image_is_placeholder(text)']::text[];
  c_helper regprocedure := v_functions[1]::regprocedure;
  r        record;
  v_src    text;
  v_n      integer;
  v_veh    record;
  v_want   bigint;
  v_got    bigint;
  v_fac    bigint;
  v_first  jsonb;
BEGIN
  -- ① helper 屬性:IMMUTABLE、INVOKER、沒有 SET(才 inline 得了)
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = c_helper
                  AND p.provolatile = 'i' AND NOT p.prosecdef AND p.proconfig IS NULL) THEN
    RAISE EXCEPTION '事後閘①a:helper 不是 IMMUTABLE + INVOKER + 無 SET';
  END IF;
  IF (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = c_helper) IS NULL THEN
    RAISE EXCEPTION '事後閘①b:helper proacl 是 NULL ⇒ 等於 PUBLIC 可執行';
  END IF;
  FOR r IN
    SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END AS who
      FROM pg_catalog.pg_proc p, LATERAL pg_catalog.aclexplode(p.proacl) a
     WHERE p.oid = c_helper AND a.privilege_type = 'EXECUTE'
  LOOP
    IF r.who NOT IN ('postgres', 'anon', 'authenticated', 'service_role') THEN
      RAISE EXCEPTION '事後閘①c:helper 的 % 持有 EXECUTE ⇒ 名單外', r.who;
    END IF;
  END LOOP;
  IF NOT pg_catalog.has_function_privilege('anon', c_helper, 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘①d:anon 叫不動 helper ⇒ 客人一開目錄頁就 42501';
  END IF;

  -- ② helper 行為:每一組規則 + 反例(與 TS hasNoRealImage 同答案;TS 那邊由 parity 測試逐組比)
  FOR r IN SELECT * FROM (VALUES
      (NULL::text, true),
      (''::text, true),
      ('   '::text, true),
      ('https://quote.pcmmotorsports.com/storage/no-photo.png'::text, true),
      ('https://quote.pcmmotorsports.com/storage/no-photo.png.jpg'::text, false),
      ('https://cdn.example.com/no-photo.png'::text, false),
      ('not a url'::text, false),
      ('https://www.gbracing.eu:443/templates/x/NO-IMAGE-300x300.jpg?v=1'::text, true),
      ('https://www.gbracing.eu/templates/x/real-part.jpg'::text, false),
      ('https://www.gillestooling.com/a/b/spareparts-mit-tesxtxyz.png'::text, true),
      ('https://other.www.gillestooling.com/a/b/spareparts-mit-tesxtxyz.png'::text, false),
      ('https://www.gillestooling.com/a/b/bild-schraube-xyz.png'::text, true),
      ('https://other.www.gillestooling.com/a/b/bild-schraube-xyz.png'::text, false),
      ('https://www.gillestooling.com/a/b/bild-folgt-in-kurze-xyz.png'::text, true),
      ('https://other.www.gillestooling.com/a/b/bild-folgt-in-kurze-xyz.png'::text, false),
      ('https://www.extreme-components.com/a/b/noimage.jpgxyz.png'::text, true),
      ('https://other.www.extreme-components.com/a/b/noimage.jpgxyz.png'::text, false),
      ('https://www.gbracing.eu/a/b/no-image-xyz.png'::text, true),
      ('https://other.www.gbracing.eu/a/b/no-image-xyz.png'::text, false),
      ('https://www.motogadget.com/a/b/no-image-xyz.png'::text, true),
      ('https://other.www.motogadget.com/a/b/no-image-xyz.png'::text, false),
      ('https://rpmcarbon.com/a/b/no-image-xyz.png'::text, true),
      ('https://other.rpmcarbon.com/a/b/no-image-xyz.png'::text, false)
    ) AS t(u, want)
  LOOP
    IF public.pcm_card_image_is_placeholder(r.u) IS DISTINCT FROM r.want THEN
      RAISE EXCEPTION '事後閘②:pcm_card_image_is_placeholder(%) 應為 %', coalesce(r.u, 'NULL'), r.want;
    END IF;
  END LOOP;

  -- ③ 列表兩支的形狀:兩分支 × 內外層都有 fit_rank / no_img 鍵;選車分支接 cand
  v_src := pg_catalog.pg_get_functiondef('public.search_catalog_by_vehicle(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[])'::regprocedure);
  FOR r IN SELECT * FROM (VALUES ('f.fit_rank ASC'), ('pg.fit_rank ASC'), ('f.no_img ASC'), ('pg.no_img ASC')) AS t(k) LOOP
    v_n := (pg_catalog.length(v_src) - pg_catalog.length(pg_catalog.replace(v_src, r.k, ''))) / pg_catalog.length(r.k);
    IF v_n <> 2 THEN
      RAISE EXCEPTION '事後閘③a:公開那支「%」有 % 處(期望 2 = 兩分支各一)', r.k, v_n;
    END IF;
  END LOOP;
  IF pg_catalog.strpos(v_src, 'JOIN cand c ON c.id = p.id') = 0 THEN
    RAISE EXCEPTION '事後閘③b:公開那支選車分支沒接 cand';
  END IF;
  v_src := pg_catalog.pg_get_functiondef('public.search_catalog_by_vehicle_dealer(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[])'::regprocedure);
  FOR r IN SELECT * FROM (VALUES ('f.fit_rank ASC'), ('pg.fit_rank ASC'), ('f.no_img ASC'), ('pg.no_img ASC')) AS t(k) LOOP
    v_n := (pg_catalog.length(v_src) - pg_catalog.length(pg_catalog.replace(v_src, r.k, ''))) / pg_catalog.length(r.k);
    IF v_n <> 2 THEN
      RAISE EXCEPTION '事後閘③c:🔴 經銷那支「%」有 % 處(期望 2)⇒ 一般會員與經銷會員排序會不同', r.k, v_n;
    END IF;
  END LOOP;
  IF pg_catalog.strpos(v_src, 'JOIN cand c ON c.id = p.id') = 0 THEN
    RAISE EXCEPTION '事後閘③d:經銷那支選車分支沒接 cand';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = 'public.search_catalog_by_vehicle_dealer(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[])'::regprocedure
                  AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']) THEN
    RAISE EXCEPTION '事後閘③e:經銷那支的 SECURITY DEFINER 或 search_path="" 掉了';
  END IF;
  -- ACL 沿用(CREATE OR REPLACE 保留):公開 anon 叫得動、經銷 anon 叫不動
  IF NOT pg_catalog.has_function_privilege('anon', 'public.search_catalog_by_vehicle(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[])'::regprocedure, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.search_catalog_by_vehicle_dealer(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[])'::regprocedure, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('anon', 'public.catalog_facet_counts(text[],text[],text,text,integer,text[],text[])'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘③f:三支函式的 anon 權限跟前一代不一樣';
  END IF;
  IF pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.catalog_facet_counts(text[],text[],text,text,integer,text[],text[])'::regprocedure), 'OR p.fitments = ''[]''::jsonb') = 0 THEN
    RAISE EXCEPTION '事後閘③g:catalog_facet_counts 沒有算通用款';
  END IF;

  -- ④ 行為(要有資料):車 = fitment 數排第 3 的 (廠牌, 車型)
  SELECT moto_brand, model_code INTO v_veh FROM public.product_fitments
   GROUP BY 1, 2 ORDER BY pg_catalog.count(*) DESC, 1, 2 OFFSET 2 LIMIT 1;
  IF v_veh.moto_brand IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.products_list_public WHERE fitments = '[]'::jsonb) THEN
    RAISE NOTICE '⚠️ 事後閘④ 跳過:這個庫沒有 fitments 或沒有通用款 ⇒ 行為沒被驗到(拋棄式 PG 空庫才會走到這裡)';
  ELSE
    -- ④a 選車 total = 專用 ∪ 通用款(直接數)
    --    🔴 不寫 `fitments = '[]' OR p.id IN (…)`:plpgsql custom plan 下同形 = 不 hash 的 SubPlan(P3 F7,>60s)⇒ 兩塊 id UNION 再數
    SELECT pg_catalog.count(*) INTO v_want FROM (
      SELECT u.id FROM public.products_list_public u WHERE u.fitments = '[]'::jsonb
      UNION
      SELECT p.id FROM public.products_list_public p
        JOIN (SELECT product_id FROM public.product_fitments WHERE moto_brand = v_veh.moto_brand AND model_code = v_veh.model_code
              UNION SELECT product_id FROM public.product_fitments_effective WHERE moto_brand = v_veh.moto_brand AND model_code = v_veh.model_code) m
          ON m.product_id = p.id
    ) x;
    SELECT coalesce(max(s.total), 0), (array_agg(s.item))[1] INTO v_got, v_first
      FROM public.search_catalog_by_vehicle(NULL, v_veh.moto_brand, v_veh.model_code, NULL, 0, 1, 'price-asc', NULL, NULL, NULL, NULL, NULL, NULL) s;
    IF v_got IS DISTINCT FROM v_want THEN
      RAISE EXCEPTION '事後閘④a:車 %/% ⇒ 列表 total % ≠ 專用∪通用款 %', v_veh.moto_brand, v_veh.model_code, v_got, v_want;
    END IF;
    -- ④b 第一名一定是專用的(price-asc 也一樣:Q8-1 甲)
    --    🔵 判「通用款」看車型列不看 fitments 欄(R2 nit:fitments='[]' 但有車型列的那 21 件算專用,不能誤報)
    IF v_first IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.product_fitments WHERE product_id = (v_first->>'id')::uuid AND moto_brand = v_veh.moto_brand AND model_code = v_veh.model_code)
       AND NOT EXISTS (SELECT 1 FROM public.product_fitments_effective WHERE product_id = (v_first->>'id')::uuid AND moto_brand = v_veh.moto_brand AND model_code = v_veh.model_code) THEN
      RAISE EXCEPTION '事後閘④b:車 %/% ⇒ price-asc 第一名是通用款(應排在專用之後)', v_veh.moto_brand, v_veh.model_code;
    END IF;
    -- ④c 側欄品牌件數總和 = 列表 total(每件商品恰一個品牌)
    SELECT coalesce(sum(f.n), 0) INTO v_fac
      FROM public.catalog_facet_counts(ARRAY[]::text[],
             (SELECT array_agg(DISTINCT brand_slug) FROM public.products_list_public),
             v_veh.moto_brand, v_veh.model_code, NULL, NULL, NULL) f
     WHERE f.facet = 'brand';
    IF v_fac IS DISTINCT FROM v_want THEN
      RAISE EXCEPTION '事後閘④c:車 %/% ⇒ 側欄品牌件數總和 % ≠ 列表 total %', v_veh.moto_brand, v_veh.model_code, v_fac, v_want;
    END IF;
    -- ④d 沒選車 total 不變(Q9 只改順序)
    SELECT coalesce(max(s.total), 0) INTO v_got
      FROM public.search_catalog_by_vehicle(NULL, NULL, NULL, NULL, 0, 1, 'recommend', NULL, NULL, NULL, NULL, NULL, NULL) s;
    IF v_got IS DISTINCT FROM (SELECT pg_catalog.count(*) FROM public.products_list_public) THEN
      RAISE EXCEPTION '事後閘④d:沒選車 total % ≠ products_list_public 列數', v_got;
    END IF;
    RAISE NOTICE '✅ 事後閘④ 行為過:車 %/% total % = 專用∪通用款 = 側欄件數總和', v_veh.moto_brand, v_veh.model_code, v_want;
  END IF;
  RAISE NOTICE '✅ 20260916120000 事後閘全過:helper 屬性 / ACL / 行為 %組 · 列表兩支形狀 · 件數算通用款', 23;
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
