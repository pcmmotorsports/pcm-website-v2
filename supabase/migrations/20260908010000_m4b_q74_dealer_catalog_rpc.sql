-- ⟦M-4b · Q74 第 2 片⟧ 經銷專用目錄 RPC `search_catalog_by_vehicle_dealer`
--
-- 兩個拍板:Q74-a = 丙′(主視窗 A:另開一支, 一般那支一個字不動)· Q74-b = 同一組(Sean:推薦價帶不隨身分換)
-- plan:docs/plans/2026-09-08-q74-dealer-rpc-plan.md(鐵則 8 已批;鐵則 12 ①③⑥ ⇒ codex 不降級)
--
-- 這支在做什麼(一句):**與 12 參數那支同簽章的複本, 只有兩處不同** ——
--   ① 讀 `public.products_list_dealer`(它讀得到 `price_store`)而不是 `public.products_list_public`
--   ② 開頭多一段 fail-closed 身分閘(`auth.uid()` ⇒ 查 `customers.tier` ⇒ 非 `store` 就 RAISE)
--   🔵 推薦價帶 `4000` / `13800` **維持不動**(Sean Q74-b = 同一組)。
--
-- 🔴🔴 **「逐字複本」不是宣稱, 是一道事後閘**(主視窗 A 2026-09-08 定為條件):
--   📌 **「我複製的時候很小心」與「它逐字相同」在 diff 上是同一件事, 而只有前者需要相信我。**
--   ⇒ 事後閘 A3 會把本支的 `prosrc` **反向重建**(拿掉兩段標記區、把 view 名換回), 再比 md5。
--   🔬 而那個反向重建**在寫這支檔的時候就先跑過了**:重建後 md5 = `336beaff1188c7670e85134db5aa623b`
--      = 正式庫 12 參數那支的 body md5, **逐字相同**。
--
-- 🔵 `products_list_public` 在 body 裡共 8 處字面, 而**只有 4 處是碼**(`FROM public.…`);
--    另外 4 處在**註解**裡(講「為什麼刻意不動公開投影」)⇒ **那 4 處刻意不動**, 它們是歷史理由不是引用。
--    ⇒ 📌 這也是為什麼 A3 比的是**原始 prosrc**(不剝註解)—— 剝了就分不出這件事。
--
-- 🛑 本支證不到什麼(寫在最前面):
--   · **`SET search_path = ''` 之下每一個沒加前綴的名字解析到哪裡, 我沒有逐行核過那 18k 字元**
--     ⇒ **那一格交 codex**, 題目寫在 plan §7-2(逐項列出 表/view/函式/型別/運算子/cast)。
--   · **它是 `SECURITY DEFINER`** ⇒ 函式體裡任何一條路徑都以 owner 的權限跑。**放大面沒有逐行審過。**
--   · **零呼叫端** —— 前端那半【待指派】(plan §7-5)⇒ 貼上去**對客人零行為改變**, 而**那不等於它是對的**。
--   · **正式庫今天 `tier='store'` 0 人、`price_store` 有值且與一般價不同 0 筆** ⇒ **行為在正式庫上驗不到**
--     (行為驗收只在拋棄式 PG, 見 plan §4)。

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL quote_all_identifiers = off;

DO $pre$
DECLARE
  v_md5 text; v_cfg text; v_sec boolean; v_own text; v_n int; v_txt text;
BEGIN
  -- 前置閘 P1:我抄的來源必須就是【我以為的那一版】
  SELECT md5(p.prosrc), coalesce(array_to_string(p.proconfig, ','), ''), p.prosecdef, pg_get_userbyid(p.proowner)
    INTO v_md5, v_cfg, v_sec, v_own
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'search_catalog_by_vehicle'
     AND pg_get_function_identity_arguments(p.oid) LIKE 'p_categories%';
  IF v_md5 IS NULL THEN
    RAISE EXCEPTION '前置閘 P1:找不到 12 參數那支 search_catalog_by_vehicle ⇒ 停(不是「它沒改」, 是它不在)。';
  END IF;
  IF v_md5 <> '336beaff1188c7670e85134db5aa623b' THEN
    RAISE EXCEPTION '前置閘 P1:來源 body md5 = %(期望 336beaff1188c7670e85134db5aa623b)⇒ 我抄的不是這一版, 停。', v_md5;
  END IF;
  IF v_sec OR v_cfg <> 'search_path=public, pg_temp' OR v_own <> 'postgres' THEN
    RAISE EXCEPTION '前置閘 P1:來源屬性不符(secdef=% cfg=% owner=%)⇒ 停。', v_sec, v_cfg, v_own;
  END IF;

  -- 前置閘 P2:經銷 view 在, 而且它不對 anon/authenticated 開
  SELECT coalesce(c.relacl::text, '(NULL)') INTO v_txt
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'products_list_dealer' AND c.relkind = 'v';
  IF v_txt IS NULL THEN
    RAISE EXCEPTION '前置閘 P2:找不到 public.products_list_dealer(view)⇒ 先貼 20260908000000。';
  END IF;
  IF v_txt ILIKE '%anon=%' OR v_txt ILIKE '%authenticated=%' THEN
    RAISE EXCEPTION '前置閘 P2:products_list_dealer 的 relacl 含 anon/authenticated(%)⇒ 停, 經銷價會外流。', v_txt;
  END IF;

  -- 前置閘 P3:三態 —— 不存在 ⇒ 建;已經是本片這一份 ⇒ 整筆回滾;是別的東西 ⇒ 拒絕
  SELECT md5(p.prosrc) INTO v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'search_catalog_by_vehicle_dealer';
  IF FOUND AND v_md5 IS NOT NULL THEN
    RAISE EXCEPTION '前置閘 P3(良性或衝突):public.search_catalog_by_vehicle_dealer 已存在(body md5 = %)⇒ 整筆回滾。⚠️ 本閘不判它是不是本片那一份 —— 要確認請人工比 prosrc。', v_md5;
  END IF;

  -- 前置閘 P4:身分閘要讀的兩欄在
  SELECT count(*) INTO v_n FROM pg_attribute a
   WHERE a.attrelid = 'public.customers'::regclass AND NOT a.attisdropped
     AND a.attname IN ('user_id','tier');
  IF v_n <> 2 THEN
    RAISE EXCEPTION '前置閘 P4:public.customers 的 user_id/tier 命中 % 欄(期望 2)⇒ 身分閘讀不到, 停。', v_n;
  END IF;
END
$pre$;

-- 🔴 用【裸 CREATE】不是 CREATE OR REPLACE —— `scripts/migration-static-checks.sh` 規則① 逐字
--    「OR REPLACE 只准【重定義既有物件】」, 而這是新物件。
--    ✅ 而那道規則在這裡是對的:裸 CREATE 撞名會紅, OR REPLACE 會【安靜蓋掉別人的東西】。
CREATE FUNCTION public.search_catalog_by_vehicle_dealer(p_categories text[], p_brand text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_offset integer DEFAULT 0, p_limit integer DEFAULT 25, p_sort text DEFAULT 'recommend'::text, p_category text DEFAULT NULL::text, p_brand_slugs text[] DEFAULT NULL::text[], p_price_min integer DEFAULT NULL::integer, p_price_max integer DEFAULT NULL::integer, p_new_since timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(item jsonb, total bigint)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
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
  -- 供應商批次門檻 N（Sean 2026-08-11 Q15=C 定 500 起手、明文委任 S 窗可調 → 本檔落 100）。
  -- 判準是「單一台灣日新增**達到** N 件」（>=，不是 >）；正當性與殘留風險見檔頭。
  -- 🔴 改這個數字要開**新的 migration** 重貼整支函式 —— 本檔一旦 apply 就不該再編輯，
  --    改舊檔 `db push` 不會重跑、正式庫的門檻不會變(codex R3)。
  -- 🔴 而且改 N ＝ 檔頭那組突變證據作廢，必須用 `scripts/269b-evidence.sql` §2b 重找切點重量。
  -- 單一定義點：下面兩個分支都讀這一個，不得各寫一個數字。
  c_batch_day_threshold constant int := 100;
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
    WITH new_batch_days AS (
      -- 只在 p_new_since 有值時才會被執行（見 filtered 的 OR 短路）。
      -- 下界 = p_new_since 所在台灣日的 00:00（不是 p_new_since 本身）：整日量才判得準。
      SELECT (pb.created_at AT TIME ZONE 'Asia/Taipei')::date AS day
      FROM public.products_list_dealer pb
      WHERE pb.created_at >= timezone('Asia/Taipei', date_trunc('day', timezone('Asia/Taipei', p_new_since)))
        -- 未來時戳不得參與批次日計數（codex R2）：那種列自己不會被回傳（filtered 有 <= now()），
        -- 但若同一天累積到 N，會把當天**真正的**新品整天一起誤殺。
        AND pb.created_at <= now()
      GROUP BY 1
      HAVING count(*) >= c_batch_day_threshold
    ), filtered AS (
      SELECT p.*
      FROM public.products_list_dealer p
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
              -- 只夾窗、不夾 new_batch_days：批次日要用「整日實際有幾列」判斷。
              AND p.created_at <= now()
              AND NOT EXISTS (
                SELECT 1 FROM new_batch_days nbd
                WHERE nbd.day = (p.created_at AT TIME ZONE 'Asia/Taipei')::date
              )
              -- 🔴 維修零件不進新品區。`coalesce` 少不得:category_raw 若為 NULL,
              --    `split_part(NULL,…) <> '維修零件'` 會回 NULL ⇒ 那一列會被【當成維修零件排掉】。
              --    現值空值 0 ⇒ 今天看不出差別, 而那正是它以後會安靜咬人的原因。
              AND coalesce(split_part(p.category_raw, ' · ', 1), '') <> c_new_arrivals_excluded_category
            ))
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
        row_number() OVER (PARTITION BY split_part(f.category_raw, ' · ', 1),
                                           CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                     AND c_recommend_band_hi THEN 0 ELSE 1 END
                           ORDER BY f.price_general DESC NULLS LAST, f.id) AS sort_rn
      FROM filtered f
      ORDER BY
        CASE WHEN p_sort = 'recommend' THEN
          CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
               THEN 0 ELSE 1 END
        END ASC NULLS LAST,
        CASE WHEN p_sort = 'recommend' THEN
          row_number() OVER (PARTITION BY split_part(f.category_raw, ' · ', 1),
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
  WITH new_batch_days AS (
    SELECT (pb.created_at AT TIME ZONE 'Asia/Taipei')::date AS day
    FROM public.products_list_dealer pb
    WHERE pb.created_at >= timezone('Asia/Taipei', date_trunc('day', timezone('Asia/Taipei', p_new_since)))
      AND pb.created_at <= now()                       -- 同上：未來時戳不參與批次日計數
    GROUP BY 1
    HAVING count(*) >= c_batch_day_threshold
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
  ), filtered AS (
    SELECT p.*
    FROM public.products_list_dealer p
    JOIN matched m ON m.product_id = p.id
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
            AND NOT EXISTS (
              SELECT 1 FROM new_batch_days nbd
              WHERE nbd.day = (p.created_at AT TIME ZONE 'Asia/Taipei')::date
            )
            -- 🔴 維修零件不進新品區。`coalesce` 少不得:category_raw 若為 NULL,
            --    `split_part(NULL,…) <> '維修零件'` 會回 NULL ⇒ 那一列會被【當成維修零件排掉】。
            --    現值空值 0 ⇒ 今天看不出差別, 而那正是它以後會安靜咬人的原因。
            AND coalesce(split_part(p.category_raw, ' · ', 1), '') <> c_new_arrivals_excluded_category
          ))
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
      row_number() OVER (PARTITION BY split_part(f.category_raw, ' · ', 1),
                                         CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                   AND c_recommend_band_hi THEN 0 ELSE 1 END
                         ORDER BY f.price_general DESC NULLS LAST, f.id) AS sort_rn
    FROM filtered f
    ORDER BY
      CASE WHEN p_sort = 'recommend' THEN
        CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
             THEN 0 ELSE 1 END
      END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN
        row_number() OVER (PARTITION BY split_part(f.category_raw, ' · ', 1),
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
    CASE WHEN p_sort = 'recommend' THEN pg.sort_band END ASC NULLS LAST,
    CASE WHEN p_sort = 'recommend' THEN pg.sort_rn   END ASC NULLS LAST,
    CASE WHEN p_sort = 'recommend' THEN pg.price_general END DESC NULLS LAST,
    CASE WHEN p_sort = 'price-asc' THEN pg.price_general END ASC NULLS LAST,
    CASE WHEN p_sort = 'price-desc' THEN pg.price_general END DESC NULLS LAST,
    CASE WHEN p_sort = 'new' THEN pg.created_at END DESC NULLS LAST,
    pg.id ASC;
END;
$function$;

-- ── 授權:兩道 REVOKE(少一道都是開的)後, 只授 authenticated ────────────
-- 🔴 照範本 public.get_effective_prices 的 proacl 逐字 {postgres, authenticated} —— **anon 不在**。
--    而本支是 SECURITY DEFINER ⇒ 給 anon 等於讓未登入者以 owner 身分跑 18k 字元的函式體。
REVOKE ALL ON FUNCTION public.search_catalog_by_vehicle_dealer(text[], text, text, integer, integer, integer, text, text, text[], integer, integer, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_catalog_by_vehicle_dealer(text[], text, text, integer, integer, integer, text, text, text[], integer, integer, timestamptz) FROM anon, authenticated;
-- ACL-GATE-EXEMPT: public.search_catalog_by_vehicle_dealer -- 經銷會員從顧客站以自己的身分呼叫;不能改用 service_role 因為函式靠 auth.uid() 讀 customers.tier 判經銷(Q74, 2026-09-08)
-- 🛑 而豁免只讓【這一行】過閘, 不代表這條權限之後有人在量 —— 事後閘 A2 每次 apply 會逐字比 proacl。
GRANT EXECUTE ON FUNCTION public.search_catalog_by_vehicle_dealer(text[], text, text, integer, integer, integer, text, text, text[], integer, integer, timestamptz) TO authenticated;

DO $post$
DECLARE
  v_src text; v_rebuilt text; v_md5 text; v_cfg text; v_sec boolean; v_own text; v_acl text;
  v_ctrl text; v_n int;
  v_relations text[] := ARRAY['public.search_catalog_by_vehicle_dealer']::text[];
  r_rel text;
BEGIN
  SELECT p.prosrc, coalesce(array_to_string(p.proconfig, ','), ''), p.prosecdef,
         pg_get_userbyid(p.proowner), coalesce(p.proacl::text, '(NULL)')
    INTO v_src, v_cfg, v_sec, v_own, v_acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'search_catalog_by_vehicle_dealer';
  IF v_src IS NULL THEN
    RAISE EXCEPTION '事後閘 A1:建完之後找不到它 ⇒ 停。';
  END IF;

  -- A1 姿態:DEFINER · search_path 空字串 · owner postgres
  IF NOT v_sec THEN RAISE EXCEPTION '事後閘 A1:prosecdef = f(期望 t)⇒ 它讀不到 price_store ⇒ 停。'; END IF;
  -- 🔴 codex must-fix ①:`SET search_path TO ''` 在 proconfig 裡存成 `search_path=""`(帶兩個引號),
  --    不是 `search_path=`。原本那個比對【正常建立也會紅】⇒ 整筆回滾。
  --    🔬 佐證:範本 get_effective_prices 的 proconfig 實測就是 {"search_path=\"\""}。
  IF v_cfg <> 'search_path=""' THEN
    RAISE EXCEPTION '事後閘 A1:proconfig = %(期望 search_path=""(空字串))⇒ 停。', v_cfg;
  END IF;
  IF v_own <> 'postgres' THEN RAISE EXCEPTION '事後閘 A1:owner = %(期望 postgres)⇒ 停。', v_own; END IF;

  -- A2 授權:anon 不得在 ACL 裡, 而 authenticated 必須在
  FOREACH r_rel IN ARRAY v_relations LOOP
    IF v_acl ILIKE '%anon=%' THEN
      RAISE EXCEPTION '事後閘 A2:% 的 proacl 含 anon(%)⇒ 停 —— DEFINER 給 anon 等於未登入者以 owner 身分跑。', r_rel, v_acl;
    END IF;
    IF v_acl NOT ILIKE '%authenticated=%' THEN
      RAISE EXCEPTION '事後閘 A2:% 的 proacl 沒有 authenticated(%)⇒ 經銷會員叫不動它 ⇒ 停。', r_rel, v_acl;
    END IF;
  END LOOP;
  -- 🟢 A2 的正對照:同一把尺問一支【一定有 anon】的 ⇒ 必須 true(否則這把尺的「沒有 anon」不算數)
  SELECT coalesce(p.proacl::text, '') INTO v_ctrl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'search_catalog_by_vehicle'
     AND pg_get_function_identity_arguments(p.oid) LIKE 'p_categories%';
  IF v_ctrl NOT ILIKE '%anon=%' THEN
    RAISE EXCEPTION '事後閘 A2:正對照失敗 —— 一般那支的 proacl 竟然沒有 anon ⇒ 這把尺今天壞了, 它的「沒有」不算數 ⇒ 停。';
  END IF;

  -- 🔴🔴 A3 逐字複本閘(主視窗 A 定為條件)——【反向重建】再比 md5
  v_rebuilt := regexp_replace(v_src,
    '-- ⟦DEALER-GUARD-DECL-BEGIN⟧.*?-- ⟦DEALER-GUARD-DECL-END⟧' || chr(10), '', 'gs');
  v_rebuilt := regexp_replace(v_rebuilt,
    '-- ⟦DEALER-GUARD-BEGIN⟧.*?-- ⟦DEALER-GUARD-END⟧' || chr(10), '', 'gs');
  v_rebuilt := replace(v_rebuilt, 'public.products_list_dealer', 'public.products_list_public');
  IF md5(v_rebuilt) <> '336beaff1188c7670e85134db5aa623b' THEN
    RAISE EXCEPTION '事後閘 A3:反向重建後 md5 = %(期望 336beaff1188c7670e85134db5aa623b)⇒ 本支【不是】那一支的逐字複本 ⇒ 停。', md5(v_rebuilt);
  END IF;
  -- 🔵 A3 的負對照:不做 view 名換回 ⇒ 必須【不等於】來源(否則上面那個相等是空的)
  v_rebuilt := regexp_replace(v_src,
    '-- ⟦DEALER-GUARD-DECL-BEGIN⟧.*?-- ⟦DEALER-GUARD-DECL-END⟧' || chr(10), '', 'gs');
  v_rebuilt := regexp_replace(v_rebuilt,
    '-- ⟦DEALER-GUARD-BEGIN⟧.*?-- ⟦DEALER-GUARD-END⟧' || chr(10), '', 'gs');
  IF md5(v_rebuilt) = '336beaff1188c7670e85134db5aa623b' THEN
    RAISE EXCEPTION '事後閘 A3:負對照失敗 —— 【不換 view 名】也等於來源 ⇒ 代表 view 名根本沒被換過 ⇒ 停。';
  END IF;

  -- 🔴🔴 A3b codex must-fix ②:**A3 對「四處只換了其中幾處」失明** ——
  --    若只換了 2 處, 反向重建會把那 2 處換回去, 而另外 2 處【本來就是 public】
  --    ⇒ 重建結果與來源仍然逐字相同 ⇒ A3 全綠, 而**一半的查詢還在按一般價篩選/排序**。
  --    ⇒ 所以要【額外釘住兩個計數】, 那是 A3 補不了的維度。
  v_n := (length(v_src) - length(replace(v_src, 'public.products_list_dealer', ''))) / length('public.products_list_dealer');
  IF v_n <> 4 THEN
    RAISE EXCEPTION '事後閘 A3b:body 裡 public.products_list_dealer 出現 % 次(期望恰 4)⇒ 有查詢沒換到 ⇒ 停。', v_n;
  END IF;
  v_n := (length(v_src) - length(replace(v_src, 'public.products_list_public', ''))) / length('public.products_list_public');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '事後閘 A3b:body 裡還有 % 處 public.products_list_public(期望 0)⇒ 停。', v_n;
  END IF;
  -- 🔵 而【註解裡】那 4 處裸的 products_list_public 是刻意留的(歷史理由)⇒ 本閘只數帶 public. 前綴的碼。

  -- 🔴🔴 A3c codex must-fix ③:**身分閘整段被 A3 排除掉了 ⇒ 把 `IF v_uid IS NULL` 改成 `IF FALSE`, A3/A4 仍全綠。**
  --    ⇒ 那一段要【獨立驗】, 而且驗的是它的內容不是它的存在。
  IF strpos(v_src, 'v_uid := auth.uid();') = 0 THEN
    RAISE EXCEPTION '事後閘 A3c:身分閘裡找不到 `v_uid := auth.uid();` ⇒ 停。';
  END IF;
  IF strpos(v_src, 'IF v_uid IS NULL THEN') = 0 THEN
    RAISE EXCEPTION '事後閘 A3c:身分閘裡找不到 `IF v_uid IS NULL THEN` ⇒ 有人把條件改掉了 ⇒ 停。';
  END IF;
  IF strpos(v_src, 'IF v_tier IS DISTINCT FROM ''store'' THEN') = 0 THEN
    RAISE EXCEPTION '事後閘 A3c:身分閘裡找不到 tier 必須是 store 那一條 ⇒ 停。';
  END IF;
  v_n := (length(v_src) - length(replace(v_src, 'PCM04', ''))) / length('PCM04');
  IF v_n <> 2 THEN
    RAISE EXCEPTION '事後閘 A3c:身分閘的 RAISE 用 ERRCODE PCM04 出現 % 次(期望 2)⇒ 少了一條拒絕路徑 ⇒ 停。', v_n;
  END IF;

  -- 🔴🔴🔴 A3d codex R2 must-fix:**上面那四條全是「字面在不在」, 而繞法有無限多種。**
  --    R2 的實錘:把 `SELECT c.tier INTO v_tier` 改成 `SELECT 'store' INTO v_tier`,
  --    ⇒ 上面四條【一條都不會紅】, 而任何有 customers 紀錄的一般會員都拿得到經銷價。
  --    ⇒ 所以真正的牙齒是【整段釘 md5】, 不是列舉字面。列舉留著只為了錯誤訊息好讀。
  --    🛑 而這代表:**以後任何人動這一段(連改錯字), 這裡就會紅** —— 那是刻意的。
  --
  --    ── 出口(照 scripts/board-row-shrink.py dab989466 的設計移植過來, 不是重新設計)──
  --    那道閘的安全性質是「放行【A】絕不可以順便放行【B】」。本閘的等價形狀是:
  --    🔴🔴 **不准把錯誤訊息印出來的那個 md5 貼回來。**
  --       那等於【放行全部】—— 它會一視同仁地祝福任何突變, 包含 codex R2 給的那個擊破法
  --       (`SELECT 'store' INTO v_tier`), 而錯誤訊息長得跟正當重構一模一樣。
  --    ✅ 正當的改法(出口要比繞過容易, 否則沒有人會走它):
  --       ① 先看你改了什麼:
  --          git diff -U0 -- supabase/migrations/20260908010000_m4b_q74_dealer_catalog_rpc.sql
  --       ② 從【檔案】重算(不是從錯誤訊息抄):
  --          python3 -c "import io,re,hashlib;s=io.open('supabase/migrations/20260908010000_m4b_q74_dealer_catalog_rpc.sql',encoding='utf-8').read();print(hashlib.md5(re.search('-- \u27e6DEALER-GUARD-BEGIN\u27e7.*?-- \u27e6DEALER-GUARD-END\u27e7',s,re.S).group(0).encode()).hexdigest())"
  --       ③ 把新值寫進本檔, 並在 commit body 寫【那一段的行為改成什麼、為什麼】——
  --          寫得出行為的差異才算走完出口;寫「更新 md5」等於沒走。
  --    🛑 **不做開關。** 沒有 env var、沒有旗標可以跳過 A3d —— 一個關掉整道閘的開關
  --       與 `--no-verify` 只差一個名字。
  v_ctrl := (regexp_match(v_src, '(-- ⟦DEALER-GUARD-BEGIN⟧.*?-- ⟦DEALER-GUARD-END⟧)'))[1];
  IF v_ctrl IS NULL THEN
    RAISE EXCEPTION '事後閘 A3d:抓不到身分閘區塊 ⇒ 停。';
  END IF;
  IF md5(v_ctrl) <> '20b461c1a844ee85eba4590bf6689cf1' THEN
    RAISE EXCEPTION '事後閘 A3d:身分閘區塊 md5 = %(期望 20b461c1a844ee85eba4590bf6689cf1)⇒ 有人動過那一段 ⇒ 停。', md5(v_ctrl);
  END IF;
  -- 🛑 而本閘證不到什麼:它比的是【字面在不在】, 不是【那段邏輯跑起來會拒絕】。
  --    真正的行為驗收只能在拋棄式 PG(plan §4 第 2 段), 而正式庫今天 tier='store' 0 人。

  -- A4 兩段標記各恰好一組(否則 A3 的移除會移錯範圍)
  v_n := (length(v_src) - length(replace(v_src, '⟦DEALER-GUARD-BEGIN⟧', ''))) / length('⟦DEALER-GUARD-BEGIN⟧');
  IF v_n <> 1 THEN RAISE EXCEPTION '事後閘 A4:⟦DEALER-GUARD-BEGIN⟧ 出現 % 次(期望 1)⇒ 停。', v_n; END IF;
  v_n := (length(v_src) - length(replace(v_src, '⟦DEALER-GUARD-DECL-BEGIN⟧', ''))) / length('⟦DEALER-GUARD-DECL-BEGIN⟧');
  IF v_n <> 1 THEN RAISE EXCEPTION '事後閘 A4:⟦DEALER-GUARD-DECL-BEGIN⟧ 出現 % 次(期望 1)⇒ 停。', v_n; END IF;

  -- A5 只有一支多載(同名多載會讓下游每一把尺失明)
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'search_catalog_by_vehicle_dealer';
  IF v_n <> 1 THEN RAISE EXCEPTION '事後閘 A5:同名函式有 % 支(期望 1)⇒ 停。', v_n; END IF;

  RAISE NOTICE '✅ search_catalog_by_vehicle_dealer 建好:secdef=% cfg=% owner=% acl=%', v_sec, v_cfg, v_own, v_acl;
  RAISE NOTICE '   🔬 A3 逐字複本閘通過:反向重建後 md5 = 336beaff1188c7670e85134db5aa623b(= 一般那支的 body)';
END
$post$;

COMMIT;
