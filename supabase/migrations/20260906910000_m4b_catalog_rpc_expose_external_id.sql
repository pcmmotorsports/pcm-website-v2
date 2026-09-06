-- M-4b · ⟦search-CARDPARTNO⟧ 商品卡顯示母料號:`search_catalog_by_vehicle` 多投一個 `external_id`
--
-- 🔴 **為什麼有這一支**:Sean 2026-09-06 拍「全部頁面都顯示料號」。
--   `/products` 目錄頁的卡片資料來自這支 RPC, 而它吐的 `item` jsonb 裡**沒有母料號**。
--
-- 🟢 **它比看起來便宜, 而那是量出來的**:本函式回傳 `RETURNS TABLE (item jsonb, total bigint)`
--   ⇒ 多一個 key **不改簽章** ⇒ 是 `CREATE OR REPLACE` 不是 DROP+CREATE ⇒ **不動任何權限**。
--   ⇒ 而 `packages/adapters/src/supabase/database.types.ts:4546` 逐字 `Returns: { item: Json; total: number }[]`
--     ⇒ 📌 **生成型別一個字都不會變** ⇒ 手動校正那套流程(㉑)這一片用不到。
--
-- 🛑 **本體逐字搬自 `20260904160000_m4b_search_catalog_multi_category.sql`, 只動三處**:
--   ① `CREATE FUNCTION` ⇒ `CREATE OR REPLACE FUNCTION`(簽章一個字不改)
--   ② **兩份** `jsonb_build_object` 各加 `'external_id', pe.external_id`
--   ③ **兩份** 最終 SELECT 各加 `LEFT JOIN public.products_public pe ON pe.id = pg.id`
--   🔴 **「兩份」是承重的** —— 本函式有兩份查詢(有車款 / 無車款兩條路), 而來源檔自己的註解逐字
--      寫著「本函式有【兩份】查詢, 兩份都要改」, 同一支檔還記著一個實錘:
--      「我 plan 裡寫三行, 那是**只 grep 到一份查詢**的數, **12 才是對的**」。
--      ⇒ ✅ 驗證腳本有一格突變就是**只改一份**, 它必須紅。
--
-- ── 🔴 它答不出什麼 ───────────────────────────────────────────────────────
--   · 卡片上要**怎麼顯示**那個料號是線【前台】那半(mapper 與 `ProductCard`), 本片只負責**把它送出來**。
--   · `products_list_public` **仍然沒有** `external_id` —— 那是刻意不動(見下面 ② 的註解)。
--   · 本片**沒有**改任何 RLS / GRANT;`products_public` 本來就是 anon 讀得到的投影。

BEGIN;

-- ── 前置閘:庫上那一支必須就是我抄的那一代 ──────────────────────────────────
DO $pre$
DECLARE
  v_src  text;
  v_n    integer;
BEGIN
  -- ① 12 參數那一支必須在(本片 REPLACE 的就是它)
  IF pg_catalog.to_regprocedure(
       'public.search_catalog_by_vehicle(text[],text,text,int,int,int,text,text,text[],int,int,timestamptz)'
     ) IS NULL THEN
    RAISE EXCEPTION '前置閘①:12 參數那支 search_catalog_by_vehicle 不存在 ⇒ 先貼 20260904160000, 停。';
  END IF;

  -- ② 來源必須有 external_id;而清單投影【沒有】也要在這裡講清楚, 免得下一個人以為可以直接改來源
  IF to_regclass('public.products_public') IS NULL THEN
    RAISE EXCEPTION '前置閘②a:找不到 public.products_public ⇒ 本片的 join 對象不在, 停。';
  END IF;
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'products_public' AND column_name = 'external_id';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '前置閘②b:products_public 沒有 external_id(實 % 欄)⇒ 我抄的來源不成立, 停。', v_n;
  END IF;

  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'search_catalog_by_vehicle'
     AND pg_get_function_identity_arguments(p.oid)
         = 'p_categories text[], p_brand text, p_model text, p_year integer, p_offset integer, p_limit integer, p_sort text, p_category text, p_brand_slugs text[], p_price_min integer, p_price_max integer, p_new_since timestamp with time zone';
  IF v_src IS NULL THEN
    RAISE EXCEPTION '前置閘③:找不到那個確切簽章的多載 ⇒ 停下來比對, 不要讓 REPLACE 創造一支新的。';
  END IF;
  -- 🔴 **已經貼過就不要重貼** —— 而判準是【碼裡有沒有那個 key】, 不是版本號在不在帳本上
  --    (`supabase/APPLIED.tsv` 檔頭逐字:「不在本表上什麼都不代表」)。
  IF position('''external_id'', pe.external_id' IN v_src) <> 0 THEN
    RAISE EXCEPTION '前置閘④:庫上那支已經含 external_id ⇒ **本支已經貼過了** ⇒ 不要重貼。';
  END IF;
  -- 🔴 兩份查詢都必須在(抄的來源就是兩份)—— 少一份代表庫上那支不是我抄的那一代
  v_n := (length(v_src) - length(replace(v_src, '''id'', pg.id', ''))) / length('''id'', pg.id');
  IF v_n <> 2 THEN
    RAISE EXCEPTION '前置閘⑤:庫上那支的 jsonb_build_object 不是 2 份(實 % 份)⇒ 它不是我抄的那一代, 停。', v_n;
  END IF;
END
$pre$;

-- ── 本體(逐字搬 + 三處改動)──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_catalog_by_vehicle(
  -- 🔴🔴 **`p_categories` 刻意【不給 DEFAULT】, 而它承重** ——
  --    新舊兩支的分辨器是【名字集合】不是參數個數(個數會重疊):
  --    舊那支沒有這個名字, 新那支它必填 ⇒ 兩邊各自被一個必填的名字釘死。
  --    🔬 給了 DEFAULT 會怎樣, 線【信】`-mail` 實測過(`20260904020000:14-40`):
  --      兩支都吃得下同一組名字 ⇒ `PGRST203 Could not choose the best candidate function`。
  -- 🔴 而它只能放【第一個】—— Postgres 不准「帶 DEFAULT 的參數後面還有必填的」,
  --    而本函式原本 11 個參數**全部**帶 DEFAULT。
  --    ✅ 位置不影響路由:PostgREST 用**名字**呼叫, 不用位置。
  p_categories text[],
  p_brand text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_year int DEFAULT NULL,
  p_offset int DEFAULT 0,
  p_limit int DEFAULT 25,
  p_sort text DEFAULT 'recommend',
  p_category text DEFAULT NULL,
  p_brand_slugs text[] DEFAULT NULL,
  p_price_min int DEFAULT NULL,
  p_price_max int DEFAULT NULL,
  p_new_since timestamptz DEFAULT NULL
)
RETURNS TABLE (item jsonb, total bigint)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  -- 🔴🔴 **`v_cats` 把新舊兩個入口收成【一份】** —— 新的 `p_categories` 加上舊的 `p_category`。
  --    ⇒ 📌 下面每一處都只讀 `v_cats`, **不再有任何一處直接讀 `p_category`**
  --      ⇒ 那讓「漏改一處」變成不可能, 而不是靠人數對。
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
      FROM public.products_list_public pb
      WHERE pb.created_at >= timezone('Asia/Taipei', date_trunc('day', timezone('Asia/Taipei', p_new_since)))
        -- 未來時戳不得參與批次日計數（codex R2）：那種列自己不會被回傳（filtered 有 <= now()），
        -- 但若同一天累積到 N，會把當天**真正的**新品整天一起誤殺。
        AND pb.created_at <= now()
      GROUP BY 1
      HAVING count(*) >= c_batch_day_threshold
    ), filtered AS (
      SELECT p.*
      FROM public.products_list_public p
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
        CASE WHEN p_sort = 'recommend' AND cardinality(v_cats) = 0 THEN
          CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
               THEN 0 ELSE 1 END
        END ASC NULLS LAST,
        CASE WHEN p_sort = 'recommend' AND cardinality(v_cats) = 0 THEN
          row_number() OVER (PARTITION BY split_part(f.category_raw, ' · ', 1),
                                             CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                       AND c_recommend_band_hi THEN 0 ELSE 1 END
                             ORDER BY f.price_general DESC NULLS LAST, f.id)
        END ASC NULLS LAST,
        CASE WHEN p_sort = 'recommend' AND cardinality(v_cats) = 0 THEN f.price_general END DESC NULLS LAST,
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
        --    那支清單投影**沒有這一欄**(2026-09-06 正式庫唯讀逐欄查:16 欄, 無 external_id;
        --    而 `products_public` 有 ⇒ 🟢 正對照)。
        -- 🛑 **刻意不去動 `products_list_public`**(主視窗 `Q-母料號來源 A: 甲`):
        --    它是**公開投影**, 消費端沒有盤過;而它的 COMMENT 逐字寫著「排除 … external_id …」
        --    ⇒ 📌 **那個排除看起來是刻意的, 而理由不明 ⇒ 不推翻一個不明的拍板。**
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
    -- 🔵 **只在【這一頁】上 join** —— `paged` 已經 `LIMIT LEAST(GREATEST(p_limit,1),100)`
    --    ⇒ 最多 100 列, 而 join key 是主鍵 ⇒ 代價可忽略。
    -- 🔴 用 `LEFT` 不是 `INNER`:`products_public` 與 `products_list_public` 都吃 RLS,
    --    正常情況兩邊同進同出;而**萬一某一列只在其中一邊**, INNER 會把那張卡**整張弄不見**,
    --    LEFT 只會讓料號是 null。⇒ 📌 **少一個料號 vs 少一張商品卡, 後者嚴重得多。**
    LEFT JOIN public.products_public pe ON pe.id = pg.id
    ORDER BY
      -- #950:🔴 用內層算好的 sort_band / sort_rn, **不要在這裡重算 row_number()**(理由見內層註解)
      CASE WHEN p_sort = 'recommend' AND cardinality(v_cats) = 0 THEN pg.sort_band END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' AND cardinality(v_cats) = 0 THEN pg.sort_rn   END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' AND cardinality(v_cats) = 0 THEN pg.price_general END DESC NULLS LAST,
      CASE WHEN p_sort = 'price-asc' THEN pg.price_general END ASC NULLS LAST,
      CASE WHEN p_sort = 'price-desc' THEN pg.price_general END DESC NULLS LAST,
      CASE WHEN p_sort = 'new' THEN pg.created_at END DESC NULLS LAST,
      pg.id ASC;
    RETURN;
  END IF;

  RETURN QUERY
  WITH new_batch_days AS (
    SELECT (pb.created_at AT TIME ZONE 'Asia/Taipei')::date AS day
    FROM public.products_list_public pb
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
    FROM public.products_list_public p
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
      CASE WHEN p_sort = 'recommend' AND cardinality(v_cats) = 0 THEN
        CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
             THEN 0 ELSE 1 END
      END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' AND cardinality(v_cats) = 0 THEN
        row_number() OVER (PARTITION BY split_part(f.category_raw, ' · ', 1),
                                           CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                     AND c_recommend_band_hi THEN 0 ELSE 1 END
                           ORDER BY f.price_general DESC NULLS LAST, f.id)
      END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' AND cardinality(v_cats) = 0 THEN f.price_general END DESC NULLS LAST,
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
      --    那支清單投影**沒有這一欄**(2026-09-06 正式庫唯讀逐欄查:16 欄, 無 external_id;
      --    而 `products_public` 有 ⇒ 🟢 正對照)。
      -- 🛑 **刻意不去動 `products_list_public`**(主視窗 `Q-母料號來源 A: 甲`):
      --    它是**公開投影**, 消費端沒有盤過;而它的 COMMENT 逐字寫著「排除 … external_id …」
      --    ⇒ 📌 **那個排除看起來是刻意的, 而理由不明 ⇒ 不推翻一個不明的拍板。**
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
  -- 🔵 **只在【這一頁】上 join** —— `paged` 已經 `LIMIT LEAST(GREATEST(p_limit,1),100)`
  --    ⇒ 最多 100 列, 而 join key 是主鍵 ⇒ 代價可忽略。
  -- 🔴 用 `LEFT` 不是 `INNER`:`products_public` 與 `products_list_public` 都吃 RLS,
  --    正常情況兩邊同進同出;而**萬一某一列只在其中一邊**, INNER 會把那張卡**整張弄不見**,
  --    LEFT 只會讓料號是 null。⇒ 📌 **少一個料號 vs 少一張商品卡, 後者嚴重得多。**
  LEFT JOIN public.products_public pe ON pe.id = pg.id
  ORDER BY
    -- #950:🔴 用內層算好的 sort_band / sort_rn, **不要在這裡重算 row_number()**(理由見內層註解)
    CASE WHEN p_sort = 'recommend' AND cardinality(v_cats) = 0 THEN pg.sort_band END ASC NULLS LAST,
    CASE WHEN p_sort = 'recommend' AND cardinality(v_cats) = 0 THEN pg.sort_rn   END ASC NULLS LAST,
    CASE WHEN p_sort = 'recommend' AND cardinality(v_cats) = 0 THEN pg.price_general END DESC NULLS LAST,
    CASE WHEN p_sort = 'price-asc' THEN pg.price_general END ASC NULLS LAST,
    CASE WHEN p_sort = 'price-desc' THEN pg.price_general END DESC NULLS LAST,
    CASE WHEN p_sort = 'new' THEN pg.created_at END DESC NULLS LAST,
    pg.id ASC;
END;
$fn$;

-- ── 事後閘 ────────────────────────────────────────────────────────────────
DO $post$
DECLARE
  v_src text;
  v_n   integer;
  r     record;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'search_catalog_by_vehicle'
     AND pg_get_function_identity_arguments(p.oid)
         = 'p_categories text[], p_brand text, p_model text, p_year integer, p_offset integer, p_limit integer, p_sort text, p_category text, p_brand_slugs text[], p_price_min integer, p_price_max integer, p_new_since timestamp with time zone';
  IF v_src IS NULL THEN
    RAISE EXCEPTION '事後閘①:REPLACE 完之後找不到它 ⇒ 停。';
  END IF;

  -- 🔴🔴 **兩份都要有** —— 只改一份的話, 「有車款」與「沒車款」兩條路會**吐不同形狀的 item**,
  --    而那在前台看起來是「有些卡片有料號有些沒有」, 不會有任何東西紅。
  v_n := (length(v_src) - length(replace(v_src, '''external_id'', pe.external_id', '')))
         / length('''external_id'', pe.external_id');
  IF v_n <> 2 THEN
    RAISE EXCEPTION '事後閘②:`external_id` 只出現 % 份(期望 2 —— 本函式有兩份查詢)⇒ 有一條路沒改到。', v_n;
  END IF;
  v_n := (length(v_src) - length(replace(v_src, 'LEFT JOIN public.products_public pe', '')))
         / length('LEFT JOIN public.products_public pe');
  IF v_n <> 2 THEN
    RAISE EXCEPTION '事後閘③:那個 LEFT JOIN 只出現 % 份(期望 2)⇒ 有一條路拿不到來源。', v_n;
  END IF;

  -- ④ 安全前提不能被 REPLACE 改掉
  SELECT p.prosecdef, p.proconfig, p.provolatile INTO r
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'search_catalog_by_vehicle'
     AND pg_get_function_identity_arguments(p.oid)
         = 'p_categories text[], p_brand text, p_model text, p_year integer, p_offset integer, p_limit integer, p_sort text, p_category text, p_brand_slugs text[], p_price_min integer, p_price_max integer, p_new_since timestamp with time zone';
  IF r.prosecdef THEN
    RAISE EXCEPTION '事後閘④a:本支變成 SECURITY DEFINER ⇒ 停。';
  END IF;
  IF r.proconfig IS NULL OR NOT ('search_path=public, pg_temp' = ANY(r.proconfig)) THEN
    RAISE EXCEPTION '事後閘④b:`SET search_path = public, pg_temp` 不見了(proconfig=%)⇒ REPLACE 把它吹掉了 ⇒ 停。', r.proconfig;
  END IF;
  IF r.provolatile <> 's' THEN
    RAISE EXCEPTION '事後閘④c:volatility 不是 STABLE(實 %)⇒ 停。', r.provolatile;
  END IF;
END
$post$;

COMMIT;
