-- ============================================================
-- 20260827180000_m4b_storefront_new_arrivals_exclude_repair_parts
--   新品區排除「維修零件」大類。
-- ============================================================
-- 拍板:Sean 2026-08-27 兩板, 都是他親口(經 de 轉述, 本窗未親見他的原始訊息):
--   ① 分類 = 維修零件 的商品【不進新品區】
--      🔴 他是【看著真實資料拍的】:首頁那排 10 件裡 5 件是維修零件
--   ② 以後多出子類(例「維修零件 · 油封」)⇒ 逐字「甲」= 一起排除, 照大類切
--      ⚠️ 而現值只有一種子類(`維修零件 · 維修零件`)⇒ **甲乙今天的行為一模一樣**, 差別在以後。
--         de 端題時明說了這一點 ⇒ **他是在知道今天沒差的情況下選甲的。**
--   規格 `~/pcm-mailbox/cf-spec-new-arrivals-exclude-repair-parts-20260827.md`(38 行, sha `2951f576b0d5`)
--   拍板全文 memory `project_0827-new-arrivals-exclude-repair-parts`
--
-- ⚠️ **精品螺絲與螺帽(1652 件)留著** —— 排除它是另一個決定, 本片不碰。
--
-- 🔴🔴 **本片只做一半就會製造出它要修的那個症狀。**
--   「新品區」有【兩個落點, 兩把不同的尺】:
--     A 新品頁 /products?filter=new ⇒ 本檔(RPC)
--     B 首頁那排「最新商品」        ⇒ **完全不走 RPC**(products_public + created_at desc)
--   ⇒ 只改一邊 = 首頁與新品頁又不同步, 而那正是 Sean 今天抱怨的另一件事。
--   ⇒ **B 那半在同一顆 commit 裡**(SupabaseProductAdapter / storefront products.ts)。
--
-- 🔴 為什麼是新開一支而不是改 20260827150000:
--   那支 Sean 今天才手動 apply 進正式庫 ⇒ 改舊檔 `db push` 不會重跑、正式庫不會變。
--   本檔的作法 = 把那支的函式本體【整份搬過來】再加排除條件, 其餘逐字未動。
--   驗法(可重跑):把本檔與 20260827150000 的函式段落 diff, 差異應【只有】
--     · DECLARE 多一個 c_new_arrivals_excluded_category
--     · 兩個 p_new_since 分支各多一行 AND coalesce(split_part(...))
--     · 斷言多第⑤道、訊息前綴由 #950 改為「本片」
--
-- ⚠️ **本檔 apply 完【不等於驗完】** —— 效果要在正式庫才看得到:
--   本機拋棄式庫 0 件商品 ⇒ 這裡只證得了語法與斷言, 證不了「真的排掉那 1631 件」。
--   驗收那發 SQL 由主視窗排進端給 Sean 的批次。
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.search_catalog_by_vehicle(
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
      WHERE (p_category IS NULL OR p.category_raw = p_category OR p.category_raw LIKE p_category || ' · %')
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
        CASE WHEN p_sort = 'recommend' AND p_category IS NULL THEN
          CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
               THEN 0 ELSE 1 END
        END ASC NULLS LAST,
        CASE WHEN p_sort = 'recommend' AND p_category IS NULL THEN
          row_number() OVER (PARTITION BY split_part(f.category_raw, ' · ', 1),
                                             CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                       AND c_recommend_band_hi THEN 0 ELSE 1 END
                             ORDER BY f.price_general DESC NULLS LAST, f.id)
        END ASC NULLS LAST,
        CASE WHEN p_sort = 'recommend' AND p_category IS NULL THEN f.price_general END DESC NULLS LAST,
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
      CASE WHEN p_sort = 'recommend' AND p_category IS NULL THEN pg.sort_band END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' AND p_category IS NULL THEN pg.sort_rn   END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' AND p_category IS NULL THEN pg.price_general END DESC NULLS LAST,
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
    WHERE (p_category IS NULL OR p.category_raw = p_category OR p.category_raw LIKE p_category || ' · %')
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
      CASE WHEN p_sort = 'recommend' AND p_category IS NULL THEN
        CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
             THEN 0 ELSE 1 END
      END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' AND p_category IS NULL THEN
        row_number() OVER (PARTITION BY split_part(f.category_raw, ' · ', 1),
                                           CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                     AND c_recommend_band_hi THEN 0 ELSE 1 END
                           ORDER BY f.price_general DESC NULLS LAST, f.id)
      END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' AND p_category IS NULL THEN f.price_general END DESC NULLS LAST,
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
    CASE WHEN p_sort = 'recommend' AND p_category IS NULL THEN pg.sort_band END ASC NULLS LAST,
    CASE WHEN p_sort = 'recommend' AND p_category IS NULL THEN pg.sort_rn   END ASC NULLS LAST,
    CASE WHEN p_sort = 'recommend' AND p_category IS NULL THEN pg.price_general END DESC NULLS LAST,
    CASE WHEN p_sort = 'price-asc' THEN pg.price_general END ASC NULLS LAST,
    CASE WHEN p_sort = 'price-desc' THEN pg.price_general END DESC NULLS LAST,
    CASE WHEN p_sort = 'new' THEN pg.created_at END DESC NULLS LAST,
    pg.id ASC;
END;
$fn$;


-- ── 🔴 斷言①:同名函式恰 1 支(code-reviewer must-fix,同邏輯搬自 20260811040000:473-479(錯誤訊息是本片改寫的, 不是逐字))──
--   `CREATE OR REPLACE` 在【簽章漂移】時不會報錯, 它會**安靜地新建第二支 overload**
--   ⇒ 具名參數呼叫變成 `42725 ambiguous` ⇒ 型錄全頁掛, **而 migration 回報成功**。
--   📌 那正是原檔那句錯誤訊息在講的事 —— 而本片第一版把這道斷言【漏掉了】。
-- ── ACL:逐字照 20260811040000:444-445(冪等;`CREATE OR REPLACE` 同簽章時本來就保留權限,
--    而【它不保證我們落在同簽章那個世界】—— 見下面斷言②。這兩行讓「新建」那條路也落在正確的 ACL 上,
--    而斷言③④ 才有東西可以驗。少了這兩行, 全新重放這支 migration 會被自己的斷言擋下。)
REVOKE ALL ON FUNCTION public.search_catalog_by_vehicle(text, text, int, int, int, text, text, text[], int, int, timestamptz) FROM PUBLIC;
-- ACL-GATE-EXEMPT: public.search_catalog_by_vehicle -- 型錄 RPC 的既有授權原樣補回(#950, 2026-08-27);
--   這一行逐字照 20260811040000:445, 不是新開的權限 —— 它存在的理由是 CREATE OR REPLACE 在
--   【新建】那條路上會拿 default ACL(codex must-fix)⇒ 補回來, 而同檔斷言③④ 會驗它:
--   ③ PUBLIC 不得有 EXECUTE、④ 這三個 role 都要有。**兩個方向都有東西在量, 不是只補不驗。**
GRANT EXECUTE ON FUNCTION public.search_catalog_by_vehicle(text, text, int, int, int, text, text, text[], int, int, timestamptz) TO anon, authenticated, service_role;

DO $assert$
DECLARE
  v_overloads int;
  v_public_exec boolean;
  v_missing_roles text;
  v_guard_hits int;
  v_cat_select_policies int;
  c_sig constant text :=
    'public.search_catalog_by_vehicle(text, text, int, int, int, text, text, text[], int, int, timestamptz)';
BEGIN
  -- ① 同名函式恰 1 支(code-reviewer must-fix;同邏輯搬自 20260811040000:473-479,
  --   而【錯誤訊息是本片改寫的】—— 不是逐字複製, codex 抓到我這句話寫得不精確)
  --   `CREATE OR REPLACE` 在【簽章漂移】時不報錯, 它會安靜新建第二支 overload
  --   ⇒ 具名參數呼叫 42725 ambiguous ⇒ 型錄全頁掛, **而 migration 回報成功**。
  SELECT count(*) INTO v_overloads
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'search_catalog_by_vehicle';
  IF v_overloads <> 1 THEN
    RAISE EXCEPTION '本片斷言①失敗:public.search_catalog_by_vehicle 應恰 1 支、實得 % 支。overload 存活 ⇒ 正式站具名參數呼叫會 42725 ambiguous、型錄全頁掛掉。', v_overloads;
  END IF;

  -- ② 🔴 **那 1 支必須是【我們要的那個簽章】**(codex must-fix)
  --   只數「恰 1 支」不夠:若套用【之前】那支函式根本不存在(0 支),
  --   `CREATE OR REPLACE` 會【新建】一支, 事後 count=1 照樣綠 ——
  --   而新建的那支拿的是 default ACL, 不是原本那組 grant。
  --   📌 「取代」與「新建」在事後的計數上長得一模一樣。
  IF to_regprocedure(c_sig) IS NULL THEN
    RAISE EXCEPTION '本片斷言②失敗:精確簽章不存在 ⇒ %', c_sig;
  END IF;

  -- ③ PUBLIC 不得握有 EXECUTE(新建的那支會拿 default ACL ⇒ 這一格才看得出來)
  SELECT has_function_privilege('public', c_sig, 'EXECUTE') INTO v_public_exec;
  IF v_public_exec THEN
    RAISE EXCEPTION '本片斷言③失敗:PUBLIC 對 % 有 EXECUTE。', c_sig;
  END IF;

  -- ④ 三個 role 都要有 EXECUTE(掉了 grant ⇒ 客人打不開型錄, 而 migration 會回報成功)
  SELECT string_agg(r, ', ') INTO v_missing_roles
  FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r
  WHERE NOT has_function_privilege(r, c_sig, 'EXECUTE');
  IF v_missing_roles IS NOT NULL THEN
    RAISE EXCEPTION '本片斷言④失敗:這些 role 對簽章沒有 EXECUTE ⇒ %', v_missing_roles;
  END IF;

  -- ⑤ 🔴 **排除條件必須在【兩個分支】都在** —— 這一格是本片自己的病灶守門。
  --   本函式有兩份 filtered CTE:`p_brand IS NULL` 那半、與帶車型篩選那半。
  --   2026-08-27 施工當下實測:那兩段【縮排不同】(14 空格 vs 12 空格)
  --   ⇒ 用單一字串比對去改, 會【安靜地只改到一個】, 而 SQL 照樣合法、migration 照樣成功。
  --   ⇒ 症狀 = 客人不帶車型看新品時乾淨、一按車型篩選維修零件就冒出來。
  --   📌 這不是恆真格:把任一分支的那行刪掉, 它就會紅。
  -- 🔴 codex nit 訂正:上一版數的是【變數名出現幾次】—— 而在函式裡隨手寫一行註解提到那個名字,
  --   就能把數字湊回 3 ⇒ 刪掉一個分支照樣過。那把尺量的是「這個字有沒有出現」, 不是「述詞在不在」。
  --   ⇒ 改成數【述詞本身的形狀】:`coalesce(split_part(p.category_raw` 出現幾次。
  SELECT count(*) INTO v_guard_hits
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
       LATERAL regexp_matches(p.prosrc, 'coalesce\(split_part\(p\.category_raw', 'g')
  WHERE n.nspname = 'public' AND p.proname = 'search_catalog_by_vehicle';
  IF v_guard_hits <> 2 THEN
    RAISE EXCEPTION '本片斷言⑤失敗:函式本體裡的排除述詞 coalesce(split_part(p.category_raw…) 應出現 2 次(兩個 filtered CTE 分支各 1)、實得 % 次。少於 2 ⇒ 有一個分支沒套到 ⇒ 帶車型篩選時維修零件會回到新品區。', v_guard_hits;
  END IF;

  -- ⑥ 🔴 **首頁那半靠 `categories!inner` embed 過濾, 而 embed 讀 categories 要過 RLS。**
  --   政策若被收窄(或整個不見)⇒ `!inner` 會讓【整排新品安靜消失】,
  --   而那與「它們被排除了」在畫面上是同一句話 —— 正是這一片自己要修的那個病的形狀。
  --   ⇒ 這裡釘住:categories 上要有一條 anon 讀得到的 SELECT 政策。
  --   ⚠️ **天花板(明寫, 不是免責)**:這道只在【apply 當下】燒一次。
  --      政策哪天被後面的 migration 改窄, 這一格不會回頭紅 —— 它擋的是「今天就已經是壞的」。
  --      持續盯著它需要另一支東西, 而那支今天不存在。
  SELECT count(*) INTO v_cat_select_policies
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'categories' AND cmd = 'SELECT'
    AND (roles = '{public}' OR 'anon' = ANY(roles));
  IF v_cat_select_policies < 1 THEN
    RAISE EXCEPTION '本片斷言⑥失敗:public.categories 上找不到 anon 讀得到的 SELECT 政策。⇒ 首頁那排的 categories!inner embed 會讀不到分類 ⇒ 整排新品會【安靜消失】, 而畫面上與「被排除了」長得一樣。';
  END IF;
END
$assert$;

COMMIT;
