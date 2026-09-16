-- 20260916240000_m4b_universal_excludes_vehicle_specific_categories.sql
--   通用區排除六個「一定要分車款」的櫃
-- M-4b · 前台窗 pcm-website-v2-ce(版本號主視窗 pcm-website-v2-6d 指定)
-- Sean 2026-09-16 走查後標的:1 維修零件 / 3 腳踏後移與傳動 / 9 碳纖維部品 / 12 四輪 ATV/UTV / 16 排氣系統 / 17 服務與其他
--
-- ══ 為什麼 ═══════════════════════════════════════════════════
-- 他的判準逐字:「通用零件 = 像護弓、螺絲、機油那種, 本來就不分車款的東西」
-- ⇒ 整流罩 / 排氣管 / 腳踏後移出現在通用區 = **資料壞了**, 不是通用款。
-- 🔴 **這一支是【不顯示】, 不是【修好】。** 那 1,993 件的修法在報價單那側,
--    清單 `~/pcm-mailbox/待修清單-通用區應該分車款的商品-0916.md`
--    ⇒ 五個供應商 × 櫃就佔 93%(GILLES 683 / BONAMICI 664 / LIGHTECH 348 / RPM 115 / SAMCO 44)。
--
-- ══ 影響(2026-09-16 正式庫實查, 客人口徑 delisted_at IS NULL)══
--   通用區現在 5,075 → 排除 1,993 → **客人看到 3,082**
--   ⚠️ 報價單側 2a-ii 上線後:通用區 5,075→4,960、要排除的 1,993→1,878,
--      而**剩下的仍然是 3,082** ⇒ 客人看到的數字不受 2a-ii 影響。
--   🔴 **第一區(專用)一個字都沒動** —— 那六櫃若真的有標車款的商品, 照樣出現在上面。
--
-- ══ 🔵 為什麼這一支【不 DROP】(下一個人會問)═══════════════
--   `20260916220000` 走 `DROP + 裸 CREATE`, 是因為它**改了簽章**(加 p_fit_scope)。
--   **本支簽章一個字沒動** ⇒ `CREATE OR REPLACE` 就是重定義同一支
--   ⇒ **owner 與 ACL 都保留** ⇒ 上一支那三個坑(owner 變成貼的人 / ACL 從零帶 / DEFINER 屬性)
--      **在這一支結構上不存在**, 不是「我們小心一點就好」。
--   🔴 **而「CREATE OR REPLACE 會保留」是一個【宣稱】** —— 同一句話在 SET 子句上是**假的**
--      (`CREATE OR REPLACE` 會把 SET 子句整組換掉, memory `reference_create-or-replace-resets-set-clause`)。
--      ⇒ **保留哪些、不保留哪些不靠記憶** ⇒ 事後閘逐支驗 owner / ACL / SET / prosecdef。
--
-- ══ 上線順序 ═══════════════════════════════════════════════════
-- 純 DB, TS 不用改(簽章與回傳形狀都沒變)⇒ **碼不用跟著推**。
-- 🔴 貼完仍要 `NOTIFY pgrst, 'reload schema';`(函式體換了)。
-- 🔴 貼完同批跑 pcm_acl_approve_latest(p_note 帶 20260916240000):3 支換一代。
-- 鎖:三支 CREATE OR REPLACE FUNCTION, 不動表。
--
-- ══ rollback ═══════════════════════════════════════════════════
-- SET LOCAL lock_timeout = '5s';
-- (上一行 = 退回檔開頭那句, rollback-locktimeout-gate 要它在本段第一行)
-- supabase/rollbacks/20260916240000-rollback.sql:三支回 20260916220000 那一代本體(md5 釘)。
-- ============================================================

BEGIN;
SET LOCAL lock_timeout = '5s';
-- 事後閘的行為格會對正式資料叫幾次列表 / 件數(有車 = 全目錄掃描)⇒ 給 120s 上界
SET LOCAL statement_timeout = '120s';

-- ── 前置閘:三支必須是 20260916220000 那一代(md5 of prosrc, 2026-09-16 貼板 201 之後實測)──
DO $pre$
BEGIN
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.search_catalog_by_vehicle(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)'))
     IS DISTINCT FROM 'f968fc5b9226bab9c2e9e0dddc1d0781' THEN
    RAISE EXCEPTION '前置閘一:search_catalog_by_vehicle(14 參) 不是 20260916220000 那一代 ⇒ 有人改過或先貼了, 停下對齊';
  END IF;
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.search_catalog_by_vehicle_dealer(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)'))
     IS DISTINCT FROM '9ebd52192f0f9a3c676b87e1dce07e41' THEN
    RAISE EXCEPTION '前置閘二:search_catalog_by_vehicle_dealer(14 參) 不是那一代, 停';
  END IF;
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.catalog_facet_counts(text[],text[],text,text,integer,text[],text[],text)'))
     IS DISTINCT FROM '8e41b0fb8f66b760df3098d6433cabb9' THEN
    RAISE EXCEPTION '前置閘三:catalog_facet_counts(8 參) 不是那一代, 停';
  END IF;
  -- 🔴 六櫃的名字必須真的在資料裡 —— 打錯一個字這一支會【安靜地少排除一櫃】
  IF (SELECT pg_catalog.count(DISTINCT pg_catalog.split_part(c.raw_path, ' · ', 1))
        FROM public.categories c
       WHERE pg_catalog.split_part(c.raw_path, ' · ', 1) = ANY (ARRAY[
             '維修零件', '腳踏後移與傳動', '碳纖維部品', '四輪 ATV/UTV', '排氣系統', '服務與其他'])) <> 6 THEN
    RAISE EXCEPTION '前置閘四:六個分類名不是每一個都對得到 categories ⇒ 有人改名或我打錯字, 停';
  END IF;
END
$pre$;

-- ── ① 列表(公開)────────────────────────────────────────────
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
       AND split_part(pu.category_raw, ' · ', 1) <> ALL (ARRAY[
             '維修零件', '腳踏後移與傳動', '碳纖維部品',
             '四輪 ATV/UTV', '排氣系統', '服務與其他'
           ])
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
-- 🔵 **不重下 GRANT** —— `CREATE OR REPLACE` 保留既有 ACL, 重下反而會讓
--    `acl-drift-gate` 把一個「沒有變化」報成「打開了一條權限」。事後閘逐角色驗它真的沒變。

-- ── ② 列表(經銷)—— 🔴 SECURITY DEFINER · SET search_path TO '' ────────────
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
       AND split_part(pu.category_raw, ' · ', 1) <> ALL (ARRAY[
             '維修零件', '腳踏後移與傳動', '碳纖維部品',
             '四輪 ATV/UTV', '排氣系統', '服務與其他'
           ])
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
-- ── ③ 側欄件數 ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.catalog_facet_counts(p_category_keys text[], p_brand_keys text[], p_brand text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_selected_categories text[] DEFAULT NULL::text[], p_selected_brand_slugs text[] DEFAULT NULL::text[], p_fit_scope text DEFAULT 'all'::text)
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
       AND split_part(pu.category_raw, ' · ', 1) <> ALL (ARRAY[
             '維修零件', '腳踏後移與傳動', '碳纖維部品',
             '四輪 ATV/UTV', '排氣系統', '服務與其他'
           ])
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

-- ══ 事後閘 ═══════════════════════════════════════════════════════
DO $post$
DECLARE
  v_functions text[] := ARRAY[
    'public.search_catalog_by_vehicle(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)',
    'public.search_catalog_by_vehicle_dealer(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)',
    'public.catalog_facet_counts(text[],text[],text,text,integer,text[],text[],text)'
  ]::text[];
  f text; v_oid oid;
  v_brand text; v_model text;
  v_uni bigint; v_fit bigint; v_all bigint;
BEGIN
  -- ① 🔴「CREATE OR REPLACE 會保留」是一個【宣稱】—— 同一句話在 SET 子句上是假的。
  --    ⇒ owner / ACL / SET / prosecdef 四樣逐支驗, 不靠記憶。
  FOREACH f IN ARRAY v_functions LOOP
    v_oid := pg_catalog.to_regprocedure(f)::oid;
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '事後閘①a:% 不存在(簽章不該變)', f;
    END IF;
    IF (SELECT pg_catalog.pg_get_userbyid(p.proowner) FROM pg_catalog.pg_proc p WHERE p.oid = v_oid) <> 'postgres' THEN
      RAISE EXCEPTION '事後閘①b:% 的 owner 不是 postgres', f;
    END IF;
    IF (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid) IS NULL
       OR pg_catalog.has_function_privilege('public', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '事後閘①c:% 的 PUBLIC 沒收掉(ACL 被 REPLACE 清掉了?)', f;
    END IF;
  END LOOP;

  -- ② 🔴 經銷那支:SECURITY DEFINER + search_path '' + ACL 只有 authenticated
  IF (SELECT p.proconfig FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.search_catalog_by_vehicle_dealer(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)'))
     IS DISTINCT FROM ARRAY['search_path=""'] THEN
    RAISE EXCEPTION '事後閘②a:🔴 經銷列表的 SET search_path 不是空字串 —— CREATE OR REPLACE 會把 SET 子句整組換掉';
  END IF;
  IF (SELECT p.prosecdef FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.search_catalog_by_vehicle_dealer(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)')) IS NOT TRUE THEN
    RAISE EXCEPTION '事後閘②b:經銷列表掉了 SECURITY DEFINER';
  END IF;
  IF pg_catalog.has_function_privilege('anon', pg_catalog.to_regprocedure('public.search_catalog_by_vehicle_dealer(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)'), 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', pg_catalog.to_regprocedure('public.search_catalog_by_vehicle_dealer(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)'), 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘②c:🔴 anon 或 service_role 拿到了經銷目錄的執行權 ⇒ 經銷價會外洩';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', pg_catalog.to_regprocedure('public.search_catalog_by_vehicle_dealer(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)'), 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘②d:authenticated 叫不動經銷目錄';
  END IF;

  -- ③ 公開那兩支:search_path 與 INVOKER 沒變、三個角色都叫得動
  IF (SELECT p.proconfig FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.search_catalog_by_vehicle(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)'))
     IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
     OR (SELECT p.proconfig FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.catalog_facet_counts(text[],text[],text,text,integer,text[],text[],text)'))
     IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] THEN
    RAISE EXCEPTION '事後閘③a:公開那兩支的 SET search_path 不對';
  END IF;
  IF (SELECT p.prosecdef FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.search_catalog_by_vehicle(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)')) IS NOT FALSE THEN
    RAISE EXCEPTION '事後閘③b:公開列表變成 SECURITY DEFINER ⇒ 多給了權限';
  END IF;
  IF NOT (pg_catalog.has_function_privilege('anon', pg_catalog.to_regprocedure('public.search_catalog_by_vehicle(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)'), 'EXECUTE')
      AND pg_catalog.has_function_privilege('anon', pg_catalog.to_regprocedure('public.catalog_facet_counts(text[],text[],text,text,integer,text[],text[],text)'), 'EXECUTE')) THEN
    RAISE EXCEPTION '事後閘③c:anon 叫不動公開目錄 ⇒ 顧客站會 403';
  END IF;

  -- ④ 行為格:挑一台有專用件的車, 驗三件事
  SELECT f2.moto_brand, f2.model_code INTO v_brand, v_model
    FROM public.product_fitments f2
    JOIN public.products_list_public v ON v.id = f2.product_id
   GROUP BY f2.moto_brand, f2.model_code HAVING pg_catalog.count(*) >= 5
   ORDER BY f2.moto_brand, f2.model_code LIMIT 1;
  IF v_brand IS NULL THEN
    RAISE NOTICE '事後閘④:空庫 ⇒ 跳過。🔴 這是【跳過】不是【通過】。';
  ELSE
    SELECT total INTO v_uni FROM public.search_catalog_by_vehicle(
      ARRAY[]::text[], v_brand, v_model, NULL, 0, 1, 'recommend', NULL, NULL, NULL, NULL, NULL, NULL, 'universal') LIMIT 1;
    SELECT total INTO v_fit FROM public.search_catalog_by_vehicle(
      ARRAY[]::text[], v_brand, v_model, NULL, 0, 1, 'recommend', NULL, NULL, NULL, NULL, NULL, NULL, 'fit') LIMIT 1;
    SELECT total INTO v_all FROM public.search_catalog_by_vehicle(
      ARRAY[]::text[], v_brand, v_model, NULL, 0, 1, 'recommend', NULL, NULL, NULL, NULL, NULL, NULL, 'all') LIMIT 1;
    -- ④a 🔴 通用區【不得】再出現那六櫃的商品
    IF EXISTS (
      SELECT 1 FROM public.search_catalog_by_vehicle(
        ARRAY[]::text[], v_brand, v_model, NULL, 0, 100, 'recommend', NULL, NULL, NULL, NULL, NULL, NULL, 'universal') r
       -- 🔴🔴 **[2026-09-16 · 突變測試抓到的]** 這裡原本寫 `r.item->'categories'->>'raw_path'`,
       --   而 **`item` 這顆 jsonb 根本沒有 `categories` 這個 key** —— 它的白名單是扁平的 `category_raw`
       --   (實查 key 集合:availability, brand_name, …, category_raw, …)。
       --   ⇒ 舊寫法回 NULL ⇒ `split_part(NULL,…) = ANY(…)` 回 NULL ⇒ EXISTS 永遠找不到
       --   ⇒ 📌 **這道閘會【永遠通過】, 而它看起來完全正常。**
       --   🧬 抓到它的是突變測試:把排除整段拿掉、以及改成整串比對, **兩發都照樣 COMMIT**
       --      ⇒ 那不是「碼對了」, 是「閘沒有在看」。
       --   ⚠️ `search_products_by_vehicle`(另一支 RPC)的 item **確實**有 `categories.raw_path`
       --      ⇒ 兩支 RPC 的回傳形狀不同, 而名字很像。抄錯的是我。
       WHERE pg_catalog.split_part(r.item->>'category_raw', ' · ', 1) = ANY (ARRAY[
             '維修零件', '腳踏後移與傳動', '碳纖維部品', '四輪 ATV/UTV', '排氣系統', '服務與其他'])
    ) THEN
      RAISE EXCEPTION '事後閘④a:通用區第一頁仍然出現那六櫃的商品 ⇒ 排除沒生效';
    END IF;
    -- ④b 🟢 正對照:第一區【不受影響】—— 那六櫃若有專用件, 照樣要出現
    --    (挑到的車不一定有 ⇒ 不能硬斷言有, 只能斷言「fit 沒有被這一支縮掉」)
    IF coalesce(v_fit,0) = 0 THEN
      RAISE EXCEPTION '事後閘④b:挑到的車(% %)專用件是 0 ⇒ 這一格沒有判別力(分母 0 時任何結果都成立)', v_brand, v_model;
    END IF;
    IF coalesce(v_fit,0) + coalesce(v_uni,0) IS DISTINCT FROM coalesce(v_all,0) THEN
      RAISE EXCEPTION '事後閘④c:fit(%) + universal(%) <> all(%) ⇒ 兩區不再互斥且窮盡', v_fit, v_uni, v_all;
    END IF;
    RAISE NOTICE '事後閘④ 通過:% % ⇒ all=% fit=% universal=%', v_brand, v_model, v_all, v_fit, v_uni;
  END IF;
END
$post$;

COMMIT;
