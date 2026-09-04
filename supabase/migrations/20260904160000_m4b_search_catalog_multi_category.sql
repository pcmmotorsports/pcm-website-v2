-- 🔴🔴 **這是【第二版】—— 2026-09-04 第一次貼【失敗了, 而那不是你做錯】** 🔴🔴
--    第一次回的是 `ERROR: P0001: 斷言③失敗…p_category 出現 3 次(該是 2)` ⇒ **整份回滾, 你的庫零改動。**
--    🔬 失敗的是**我寫的期望值**(我數「行」而那把尺數「出現次數」), **不是這支 SQL 的功能**。
--    ✅ 已修並重驗。**這一份可以直接整份再貼一次。**
-- ============================================================
-- 🛑🛑 **貼這一支之前先讀這三行 —— 它【不能】獨立貼, 有順序依賴** 🛑🛑
-- ① 貼完之後**同一份 SQL 的最後有一行 `NOTIFY pgrst, 'reload schema';`** —— **不要跳過它**
--    (它已經寫在檔尾的 `COMMIT` 之前, 你整份貼就會跑到, 不必另外做事)
-- ② **貼完【先不要】部署 TS** —— 這是三步部署的 A, B(TS)是另一個動作、另一個時點
-- ③ 順序反過來(TS 先上而本檔沒貼)⇒ **`PGRST202` 打死整條顧客站搜尋**
-- ⚠️ 對照:`-ship` 那支的檔頭第一句是「本支可獨立貼」—— **本支不是。**
--    📌 Sean 貼的是這份 SQL, 不是我們的 plan ⇒ 所以這三行寫在【第一行】不是寫在下面那節。
-- ============================================================
-- M-4b · 分類膠囊改成【可以多顆】—— `search_catalog_by_vehicle` 加 `p_categories text[]`
-- ============================================================
-- Sean 2026-09-04 拍板(原話逐字, 正本 `~/pcm-mailbox/Sean拍板-20260904-七題.md` 檔尾):
--   「兩個都給，不用客氣」/「都給」/「反正就是盡可能的兼容，模糊搜尋但是盡可能地接近」
--   後續補問聯集/交集 ⇒ 「甲 聯集 —— 排氣管【或】油箱貼, 兩種商品都列出來(比較多)」
-- 🎯 他推翻的是「只能選一個」這個前提, 不是選了哪個選項。
--
-- 📎 plan(已批)= `docs/specs/2026-09-04-m4b-multi-category-capsule-plan.md`
--
-- ── 🔴🔴 三步部署, 而每一步單獨都安全(形狀抄 `20260904020000` 那一片)──────────
--   A(本檔)CREATE 帶 `p_categories` 那支 ⇒ 新舊兩支並存
--          ⇒ **線上的 TS 送的名字裡沒有 `p_categories`** ⇒ 它精準命中舊那支 ⇒ **零影響**
--   B      部署 TS:名字裡加 `p_categories` ⇒ 精準命中新那支 ⇒ **零影響**
--   C      另一支 migration `DROP` 舊簽章 ⇒ 此時已無人呼叫(板列 ⟦search-DROPOLDCATSIG⟧)
--   🎯 **⇒ 三步之間任何一個時刻, 【具名呼叫】都只有一個唯一解 —— 不是祈禱, 是結構保證。**
--   ⚠️ **射程(codex nit, 我原本寫太寬)**:那句只對**具名呼叫**成立。
--     🛑 **用【位置參數】呼叫 1~11 個值時, 兩支都可能符合** ⇒ 那條路仍然可能撞多載。
--     ✅ 而 PostgREST **一律具名呼叫** ⇒ 顧客站那條路安全;而**手動用 psql 位置呼叫的人不在保護範圍內**。
--
-- ── 🔴 貼完【立刻】要跑檔尾那一行 `NOTIFY pgrst, 'reload schema';` ─────────────
--   少了它, PostgREST 還用舊的 schema cache ⇒ **B 上線後【第一筆】才炸 `PGRST202`**
--   ⇒ 📌 **問題出現在最壞的時點。** 那一行寫在本檔裡, 不是寫在 plan 的備註。
--
-- ── ⚠️ 射程(照實寫, 不洗白)──────────────────────────────────────────
--   「新參數不給 DEFAULT 才不會撞 `PGRST203`」這一格, 線【信】`-mail` 的實測環境是
--   **PostgREST 14.16 + 本機 PG 17.10**, 而正式站是 **Supabase 的版本**。
--   🛑 **「正式站也一樣」是【推的】, 不是量到的。**
--   ✅ 而本檔的**行為**斷言(檔尾 DO 區塊)是在**正式庫上**跑的, 那一半不是推的。
--
-- ── 🔬 為什麼以 `20260827180000` 為底(這一格我量了, 沒有猜)────────────────
--   `scripts/latest-definition-of.sh search_catalog_by_vehicle` ⇒ repo 有 7 代,
--   而**最後兩代 `20260827150000` / `20260827180000` 帳本都【未記】**。
--   🛑 而 2026-09-04 已證「**帳本無紀錄 ≠ 沒貼**」(`⟦01-LEDGERFALSENEG⟧`)⇒ 兩個方向都不能推。
--   ✅ **唯讀正式庫實測** `pg_get_functiondef`:`c_recommend_band_lo` ⇒ **t**(150000 特徵)·
--     `維修零件` ⇒ **t**(180000 特徵)· 正對照 `p_brand_slugs` ⇒ **t** · 負對照現造字面 ⇒ **f**
--   ⇒ 🎯 **正式庫跑的就是 `20260827180000`, 帳本只是沒記。**
--   ⇒ 📌 **這一格若沒量, 我會在一個不確定的底上疊東西, 而三綠不會叫。**
--
-- ── 🔬 這一片實際改了幾處(數字是量的, 不是估的)──────────────────────────
--   WHERE 述詞 **2** 處(本函式有【兩份】查詢)· 排序條件 **12** 處(兩份各 6)
--   ⚠️ **而 plan 裡我寫「三行」—— 那是【只 grep 到一份查詢】的數。12 才是對的。**
--   ✅ 而修法讓那個數字不再需要人去對:**所有分支只讀 `v_cats` 一個變數**,
--     改完之後**碼裡直接讀 `p_category` 的只剩 2 處**:參數宣告, 與新舊合流那一行。
-- ============================================================

BEGIN;

-- ── 0. 前置閘:舊那支必須【已經存在】────────────────────────────────────
-- 🔴 本檔用 `CREATE`(不是 `OR REPLACE`)⇒ 同簽章已存在會 42723 當場叫。
--    而舊那支不在的話, 三步部署的前提就不成立 ⇒ 也要當場叫。
DO $pre$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.search_catalog_by_vehicle(text,text,int,int,int,text,text,text[],int,int,timestamptz)'
     ) IS NULL THEN
    RAISE EXCEPTION '前置閘:舊那支 11 參數的 search_catalog_by_vehicle 不存在 ⇒ 三步部署的 A 沒有可以並存的對象, 停。';
  END IF;
END
$pre$;

CREATE FUNCTION public.search_catalog_by_vehicle(
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


-- ── 2. 權限:照舊那支逐字, 只是簽章多一個 text[] 在【最前面】────────────────
-- 🔴 新簽章 = (text[], text, text, int, int, int, text, text, text[], int, int, timestamptz)
--    ⚠️ 第一個 text[] 是 `p_categories`, 第九個 text[] 是 `p_brand_slugs` —— **不要看錯。**
-- 🔴🔴 **[codex must-fix ③]** ⛔ ~~我原本只給 `anon, authenticated`~~ ——
--    基底 `20260827180000:325` 逐字還給了 **`service_role`**
--    ⇒ 🛑 **我寫「照舊那支逐字」而我【少給了一個角色】** ⇒ 那不是照舊, 是安靜地收緊。
--    📌 **而收緊在行為上不會立刻叫** —— 用 service_role 呼叫的那一條路會在某天回 42501。
-- ACL-GATE-EXEMPT: public.search_catalog_by_vehicle -- 型錄 RPC 多顆分類新多載, 授權集合與基底 20260827180000:325 逐字相同 anon/authenticated/service_role(2026-09-04 Sean 拍「兩個都給」+「甲 聯集」, 板列 search-PREFIXWRONGCAT)
REVOKE ALL ON FUNCTION public.search_catalog_by_vehicle(text[], text, text, int, int, int, text, text, text[], int, int, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_catalog_by_vehicle(text[], text, text, int, int, int, text, text, text[], int, int, timestamptz) TO anon, authenticated, service_role;

-- ── 2b. 新物件收權斷言(`migration-static-checks.sh` 規則③)────────────────
-- 🔴 本檔建的是**一支新的多載**(舊那支還在)⇒ 它是一個**真的新物件**, 要列進來。
--    🛑 而清單只檢查**列出來的**:它防「忘記收權」, **不防「忘記列」**
--    ⇒ 那道靜態檢查就是在數這個, 而它剛才抓到我漏列。
DO $newobj_guard$
DECLARE
  v_relations text[] := ARRAY[]::text[];
  v_functions text[] := ARRAY[
    'public.search_catalog_by_vehicle(text[],text,text,int,int,int,text,text,text[],int,int,timestamptz)'
  ]::text[];
  v_fn text;
  v_acl aclitem[];
BEGIN
  FOREACH v_fn IN ARRAY v_functions LOOP
    SELECT p.proacl INTO v_acl
      FROM pg_catalog.pg_proc p
     WHERE p.oid = v_fn::regprocedure;
    -- 🔴 **ACL 欄是 NULL 時 PUBLIC 看不見, 而那正是「沒有明寫收權」的形狀**
    --    ⇒ 本檔明寫了 REVOKE + GRANT ⇒ 這裡必須非 NULL。
    IF v_acl IS NULL THEN
      RAISE EXCEPTION '收權斷言失敗:% 的 ACL 是 NULL ⇒ REVOKE/GRANT 那兩行沒生效', v_fn;
    END IF;
    IF EXISTS (SELECT 1 FROM aclexplode(v_acl) a WHERE a.grantee = 0) THEN
      RAISE EXCEPTION '收權斷言失敗:% 還有 PUBLIC 的授權', v_fn;
    END IF;
  END LOOP;
END
$newobj_guard$;

-- ── 3. 事後閘:在【正式庫上】驗行為, 而不是驗「我以為我寫了什麼」──────────────
DO $assert$
DECLARE
  v_def  text;
  v_both int;
  v_one  int;
  v_none int;
BEGIN
  -- ① 新舊【兩支都在】—— 三步部署的 A 就是這個狀態
  IF pg_catalog.to_regprocedure(
       'public.search_catalog_by_vehicle(text[],text,text,int,int,int,text,text,text[],int,int,timestamptz)'
     ) IS NULL THEN
    RAISE EXCEPTION '斷言①失敗:新那支(12 參數)沒有建出來';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.search_catalog_by_vehicle(text,text,int,int,int,text,text,text[],int,int,timestamptz)'
     ) IS NULL THEN
    RAISE EXCEPTION '斷言②失敗:舊那支(11 參數)不見了 ⇒ 三步部署的 B 之前會斷線';
  END IF;

  -- ② 新那支的碼裡【不得】還有任何一處直接讀 `p_category` 做過濾或排序
  --    🔴 判別法:剝掉註解之後, `p_category` 只能出現在【參數宣告】與【合流那一行】。
  --    🛑 而 `pg_get_functiondef` **含註解** ⇒ 不剝的話這一格恆綠(本 repo 09-04 踩過)。
  SELECT pg_catalog.pg_get_functiondef(
           'public.search_catalog_by_vehicle(text[],text,text,int,int,int,text,text,text[],int,int,timestamptz)'::regprocedure
         ) INTO v_def;
  v_def := pg_catalog.regexp_replace(v_def, '--[^' || chr(10) || ']*', '', 'g');
  -- 🔴🔴 **[2026-09-04 第一次貼失敗於本格 —— 而失敗的是【期望值】不是碼]**
  --    ⛔ ~~原本數的是【出現次數】而期望值寫 2~~ ⇒ Sean 貼下去回:
  --      `ERROR: P0001: 斷言③失敗:剝註解後 p_category 出現 3 次(該是 2…)` ⇒ **整份回滾, 正式庫零改動。**
  --    🔬 成因(自己重量過):函式裡 `p_category` 在 **2 行**上, 而**合流那一行自己含兩個**
  --      (`WHEN p_category IS NULL … ELSE ARRAY[p_category]`)⇒ **次數 3 / 行數 2**。
  --    🎯 **⇒ 我的期望值數的是【行】, 而那把尺數的是【出現次數】—— 兩個各自正確, 而它們數的不是同一種東西。**
  --    ✅ **修法不是把 2 改成 3** —— 那會讓這道斷言變成「數一個我不知道為什麼是這個數的數」。
  --      **改成數【行】, 那才對得上原本的意圖(只剩兩個【地方】讀它)**;
  --      🔵 而它的好處是:合流那一行以後若改寫法(次數變), 這道斷言**不會假紅**。
  IF (
    SELECT count(*) FROM pg_catalog.regexp_split_to_table(v_def, chr(10)) AS ln
     WHERE ln ~ 'p_category[^a-z_]'
  ) <> 2 THEN
    RAISE EXCEPTION '斷言③失敗:剝註解後【有 % 行】讀 p_category(該是 2 行:參數宣告 + 合流那一行)⇒ 有分支漏改',
      (SELECT count(*) FROM pg_catalog.regexp_split_to_table(v_def, chr(10)) AS ln
        WHERE ln ~ 'p_category[^a-z_]');
  END IF;

  -- ③ 🔴🔴 **行為斷言:呼叫【那支函式】, 不是重打一份述詞**
  --    ⛔ ~~我第一版在這裡自己寫了一遍 `EXISTS(unnest(...))`~~ **⇒ codex must-fix, 作廢。**
  --    🛑 **那樣寫的話, 就算函式【完全忽略 `p_categories`】、或改成交集、或用 `= ANY`,
  --       這一格照樣全綠** —— 因為它量的是我重打的那份副本, 不是那支函式。
  --    📌 **而這正是同一天早上我在 `search-synonyms.test.ts` 抓到的同一個病**
  --      (「一道測試若把生產規則重打一份, 它守的是那份副本」)⇒ 🎯 **我知道那條規律, 而我又犯了一次。**
  --    ✅ 改成**具名呼叫新那支**(順便也演一次「名字集合能路由到新多載」)。
  SELECT coalesce(max(t.total), 0) INTO v_one
    FROM public.search_catalog_by_vehicle(p_categories := ARRAY['排氣系統'], p_limit := 1) AS t;
  SELECT coalesce(max(t.total), 0) INTO v_none
    FROM public.search_catalog_by_vehicle(p_categories := ARRAY['煞車系統'], p_limit := 1) AS t;
  SELECT coalesce(max(t.total), 0) INTO v_both
    FROM public.search_catalog_by_vehicle(p_categories := ARRAY['排氣系統','煞車系統'], p_limit := 1) AS t;

  -- 🔵 正對照:兩個各自都要 > 0, 否則下面那個等式在「兩邊都 0」時恆真 ⇒ 零判別力。
  IF v_one = 0 OR v_none = 0 THEN
    RAISE EXCEPTION '斷言④失敗(正對照):排氣系統 % 件 / 煞車系統 % 件 —— 有一個是 0 ⇒ 下面那個等式沒有判別力, 換兩個有貨的分類再貼',
      v_one, v_none;
  END IF;

  -- 🔴 聯集:兩個一起給 = 各自相加。
  -- 🛑 **而這個等式的前提是【兩個分類不重疊】** —— `排氣系統` 與 `煞車系統` 是兩棵不同的樹,
  --    而**若哪天有商品同時算進兩邊, 這一格會【假紅】**(codex nit)。
  --    ⇒ 📌 那是**誠實的紅**:它會叫「這兩個分類重疊了」, 而那本身就是要有人看的事。
  IF v_both <> v_one + v_none THEN
    RAISE EXCEPTION '斷言⑤失敗(聯集):兩個一起給回 % 件, 而各自是 % + % = % ⇒ 那不是聯集(或那兩個分類重疊了)',
      v_both, v_one, v_none, v_one + v_none;
  END IF;

  -- 🔴 **負對照:舊那支【不吃】新名字** —— 證明兩支真的是分開的, 而不是我在對同一支說話。
  BEGIN
    PERFORM 1 FROM public.search_catalog_by_vehicle(
      p_brand := NULL, p_model := NULL, p_year := NULL, p_offset := 0, p_limit := 1,
      p_sort := NULL, p_category := '排氣系統', p_brand_slugs := NULL,
      p_price_min := NULL, p_price_max := NULL, p_new_since := NULL) AS t2;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION '斷言⑥失敗(負對照):用【舊那支的名字集合】呼叫失敗(%) ⇒ 舊那支不見了或被蓋掉 ⇒ 三步部署的 B 之前會斷線', SQLERRM;
  END;

  -- 🛑 而這幾格證的是【述詞的形狀與路由】, 不是「客人會拿到對的東西」——
  --    後者要真實查詢紀錄, 而我們沒有在記(⟦search-NOSEARCHLOG⟧)。
END
$assert$;

-- ── 4. 🔴🔴 叫 PostgREST 重讀 schema —— **不可以跳過** ────────────────────
--    少了它, PostgREST 還用舊的 schema cache ⇒ **B 上線後【第一筆】才炸 `PGRST202`**
--    ⇒ 📌 **問題出現在最壞的時點。**
-- 🔵 **它刻意放在 `COMMIT` 之前** —— `NOTIFY` 本來就是**提交時才真的送出**,
--    而 `migration-static-checks.sh` 規則② 要求 `COMMIT` 是最後一句 SQL
--    ⇒ 兩件事沒有衝突, 而**放進來之後這一行就不可能被貼的人漏掉**(它在同一份 SQL 裡)。
NOTIFY pgrst, 'reload schema';

COMMIT;
