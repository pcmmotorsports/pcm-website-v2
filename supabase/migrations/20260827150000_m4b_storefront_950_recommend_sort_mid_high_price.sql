-- ============================================================
-- 20260827150000_m4b_storefront_950_recommend_sort_mid_high_price — backlog #950
--   「推薦排序」現在沒有在排任何東西 ⇒ 給它一個真的排序鍵。
-- ============================================================
-- 病灶(量的, 不是推的):`p_sort = 'recommend'` 時,原本那三個 CASE 全部回 NULL
--   ⇒ 整個 ORDER BY 塌成 `id ASC` ⇒ **問題不是「小零件被排前面」, 是【根本沒有在排】**,
--     而那個選項的字面叫「推薦排序」。
--   基線(2026-08-27 13:09 量於正式站 `/products` 零參數):第一頁第 1 筆就是「維修零件」,
--   前 10 筆裡它出現 3 次。完整那張表在 backlog `#950`(它是唯一的「改之前長什麼樣」)。
--
-- 🔴🔴 **鐵則 9 分級:主視窗裁定本題為 L3(Sean 會想調 ⇒ 那就是 L3 的定義)。**
--   **這一版是【硬編碼】—— 它是 L3 的第一步,不是它的替代品。**
--   而 Sean 2026-08-27 對「要不要現在做成後台可調」逐字回【甲】=
--   「這次先寫死在程式裡, 記一筆待辦(要改得叫我們)」。
--   ⚠️ **他看到的是那個選項的字面, 不是「L2」「L3」這兩個字** —— 不要寫成「Sean 拍 L2」。
--   📌 主視窗指定要放在這裡的那句(逐字):
--      **「Sean 說隨便排的那個欄位, 正是【一份沒有人維護的排序資料】的實例。
--        新建的這份如果也沒人維護, 三個月後它會變成同一個東西。」**
--      ⇒ 而本片的做法刻意讓它【不需要維護】(大類順序由資料算), 代價是【沒有人能調它】。
--
-- 🔴 Sean 2026-08-27 逐字:「商品目錄的預設排序,**中間~高 價位優先在前面好了**...」
--   選項給他之後回【乙】= 中高段優先 + 段內各大類輪流。
--   而 L3→L2 那題他回【甲】= 「這次先寫死在程式裡, 記一筆待辦(要改得叫我們)」。
--   ⚠️ **他看到的是那兩個選項的字面, 不是「L2」這個分級術語** —— 落檔不要寫成「Sean 拍 L2」。
--
-- 🔴🔴 **「要改得叫我們」是一個承諾, 而它需要一個地址**:
--   要改的是本檔 DECLARE 段的 `c_recommend_band_lo` / `c_recommend_band_hi` 兩個常數。
--   backlog `#950` 指到這裡。**一個「叫我們」的承諾, 如果沒寫下「我們要改哪裡」,
--   那個承諾在人換了之後就作廢了。**
--
-- ── 🔴 只在【沒指定分類】時生效 ──────────────────────────────────────────
--   `p_category IS NOT NULL` ⇒ 本片的三層排序**整段不參與**, 那一頁與改前【逐筆相同】。
--   理由(來自第一版權重表的硬約束, 而 Sean 批的 plan 逐字寫著它):
--     客人點進「精品螺絲與螺帽」分類頁時, 螺絲不該被降權 —— 他就是來看螺絲的。
--   ⚠️ **而換成價格排序之後, 那個理由其實已經不成立**(單一分類頁內沒有跨類降權可言)
--     ⇒ 這是一個【可能已經多餘的約束】, 而本片照 plan 實作、不自行拿掉。
--     要拿掉是另一個決定, 而它會改變分類頁的樣子 ⇒ 要有人拍。
--
-- ── 為什麼一定要「大類輪流」(這一格是實撈出來的, 不是設計美感)──────────────
--   只做「中高段優先 + 段內由高到低」⇒ 第一頁 12 筆【全部都是 13,800】。
--   成因:價格會叢聚在整數 ⇒ **任何純價格排序, 第一頁都會撞進一個價格叢集。**
--   (純由高到低沒撞到, 只因為最貴那一端夠稀疏 —— 10 萬以上只有 33 群。)
--   加上輪流之後:12 筆、12 個不同大類、12 個不同商品, 13,100–13,800。
--
-- ── 🔴 這片會順便改掉每一個品牌頁, 而那是【已知且已接受】的 ────────────────
--   `apps/storefront/src/lib/brand-products.ts:39-40` 的「熱門商品」用同一個 `sort:'recommend'`
--   ⇒ 走同一支 RPC、同一個 `p_sort`(讀碼確認, 不是推的)。
--   實撈:gilles 品牌頁在本排序下的價格順序 = 5,400 → 4,400 → 4,000 → 13,400 → 12,600 ⇒ 看不出規律。
--   成因:輪流是在【大類】上輪, 而一家品牌只覆蓋少數幾個大類。
--   ⚠️ 而【純由高到低在品牌頁上也不好】(akrapovic 前 5 全是同一條產品線)
--   ⇒ 🔴 **問題不在這個排序, 在「品牌頁沿用目錄排序」這件事本身。**
--   ⇒ Sean 2026-08-27 回【乙】= 「品牌頁先這樣、記進待辦」⇒ 另立 backlog 條目, 不在本片修。
--
-- ── 🔴 本片改變一個已知洞的【可見度】, 而不改變那個洞 ──────────────────────
--   `scripts/rpm-transform.ts:302` 群代表價 = 群內 `min(price_retail)`;
--   `:309-321` 自己標著:一個群混進 0 元贈品變體 ⇒ 整個商品標 NT$ 0。
--   ✅ 2026-08-27 量到【零元群 = 0】⇒ 這一刻不會發生。
--   🔴 而本片會讓它變顯眼:零元群一旦出現會落在段外、排在最後;
--      若哪天有人把 `c_recommend_band_lo` 往下調, 它會排到最前面。
--   📌 **一個現在是 0 的東西, 不是一個不會發生的東西。** 本片不修那個洞(那是 rpm-transform 的面)。
--
-- ── 效能(實測, 不是估的)────────────────────────────────────────────────
--   同一份合成資料 22,213 列, 同一個 DB:
--     ⚠️ 22,213 = 正式站【網站庫】目錄頁自己印的件數;而下面段界那段用的 22,193 是
--        【報價單庫 view】的群數 —— **兩個不同的庫、不同的分母, 差 20。**
--        (差的那些不從供應商來, 例如補差額那顆手動商品。兩個數字都不要互相引用。)
--     現況 `id ASC`                      ⇒ Execution Time **7.5 ms**
--     本片 band + row_number + price     ⇒ Execution Time **82.1 ms**
--     ⇒ +74.6 ms, 約 11 倍
--   ⚠️ **效度限制**:量在【報價單庫】、用【合成列】(generate_series), 不是網站庫的真表。
--      它量到的是「這個 ORDER BY 形狀本身多貴」, **不是這支 RPC 在正式站的實際延遲**。
--      要那個數字, 得在網站庫上對真的 `products_list_public` 跑一次 EXPLAIN ANALYZE ——
--      🔴 **本窗沒有網站庫的存取權, 沒有量過。**
--
-- Rollback = `scripts/20260827150000-down.sql`(內容 = 改動前的函式定義【逐字複製】, 不重寫)
--   ⚠️ 而最快的止血不是 rollback, 是把前端預設排序換成 'new'(另一支檔、另一次部署)。
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


-- ── 🔴 斷言①:同名函式恰 1 支(code-reviewer must-fix,逐字搬自 20260811040000:473-479)──
--   `CREATE OR REPLACE` 在【簽章漂移】時不會報錯, 它會**安靜地新建第二支 overload**
--   ⇒ 具名參數呼叫變成 `42725 ambiguous` ⇒ 型錄全頁掛, **而 migration 回報成功**。
--   📌 那正是原檔那句錯誤訊息在講的事 —— 而本片第一版把這道斷言【漏掉了】。
DO $assert$
DECLARE
  v_overloads int;
BEGIN
  SELECT count(*) INTO v_overloads
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'search_catalog_by_vehicle';
  IF v_overloads <> 1 THEN
    RAISE EXCEPTION '#950 斷言①失敗:public.search_catalog_by_vehicle 應恰 1 支、實得 % 支。overload 存活 ⇒ 正式站具名參數呼叫會 42725 ambiguous、型錄全頁掛掉。', v_overloads;
  END IF;
END
$assert$;

COMMIT;
