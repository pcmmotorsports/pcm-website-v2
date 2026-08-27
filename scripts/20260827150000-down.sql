-- 20260827150000-down.sql — #950 推薦排序的回退
--
-- 🔴 內容 = `supabase/migrations/20260811040000_m4b_storefront_269b_catalog_new_arrivals.sql`
--    第 266–441 行的函式定義【逐字複製】(只把開頭那個 `CREATE FUNCTION` 換成 `CREATE OR REPLACE`),
--    **不是重寫的**。重寫的回退腳本會悄悄帶進今天的想法, 而回退要的是【當時那一版】。
--    (codex 2026-08-27 獨立驗過:原檔 266–441 首行換掉之後, 與本檔的函式體 SHA-256 完全相同。)
--
-- 用法:psql "$URL" -v ON_ERROR_STOP=1 -f scripts/20260827150000-down.sql
--
-- 退的判準:跑驗收 W2(指定分類 ⇒ 與改前逐筆相同)⇒ 應回到改前那組 id 序列。
-- ⚠️ 而最快的止血不是這個 —— 是把前端預設排序換成 'new'(另一支檔、另一次部署)。
--    兩條路都寫在這裡, 誰快用誰。
--
-- 🔴🔴 **codex must-fix(2026-08-27):退回也要證明自己落在「精確同簽章原地替換」那個世界。**
--    `CREATE OR REPLACE` 在【0 支】或【另有 overload】時一樣會回報成功,
--    而它新建的那支拿的是 default ACL ⇒ 退回之後型錄可能【打不開】, 而這支腳本印綠。
--    📌 「取代」與「新建」在事後的計數上長得一模一樣。
--    ⇒ 下面那組斷言與 migration 那支【同一組、逐條同義】, 並用交易包住。
--
-- 🔴 本檔【不刪】任何東西:它只把函式定義換回去。band 那兩個常數本來就只活在函式體裡。
--    而 GRANT/REVOKE 也【不搬】—— `CREATE OR REPLACE` 在同簽章原地替換時保留既有 ownership 與權限;
--    而「有沒有真的落在同簽章那個世界」由下面的斷言②③④回答, 不是靠假設。

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
      SELECT f.*, count(*) OVER () AS total_rows
      FROM filtered f
      ORDER BY
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
    SELECT f.*, count(*) OVER () AS total_rows
    FROM filtered f
    ORDER BY
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
    CASE WHEN p_sort = 'price-asc' THEN pg.price_general END ASC NULLS LAST,
    CASE WHEN p_sort = 'price-desc' THEN pg.price_general END DESC NULLS LAST,
    CASE WHEN p_sort = 'new' THEN pg.created_at END DESC NULLS LAST,
    pg.id ASC;
END;
$fn$;

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
  c_sig constant text :=
    'public.search_catalog_by_vehicle(text, text, int, int, int, text, text, text[], int, int, timestamptz)';
BEGIN
  -- ① 同名函式恰 1 支(同邏輯搬自 20260811040000:473-479,
  --   而【錯誤訊息是本片改寫的】—— 不是逐字複製, codex 抓到我這句話寫得不精確)
  --   `CREATE OR REPLACE` 在【簽章漂移】時不報錯, 它會安靜新建第二支 overload
  --   ⇒ 具名參數呼叫 42725 ambiguous ⇒ 型錄全頁掛, **而 migration 回報成功**。
  SELECT count(*) INTO v_overloads
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'search_catalog_by_vehicle';
  IF v_overloads <> 1 THEN
    RAISE EXCEPTION '#950-down 斷言①失敗:public.search_catalog_by_vehicle 應恰 1 支、實得 % 支。overload 存活 ⇒ 正式站具名參數呼叫會 42725 ambiguous、型錄全頁掛掉。', v_overloads;
  END IF;

  -- ② 🔴 **那 1 支必須是【我們要的那個簽章】**(codex must-fix)
  --   只數「恰 1 支」不夠:若套用【之前】那支函式根本不存在(0 支),
  --   `CREATE OR REPLACE` 會【新建】一支, 事後 count=1 照樣綠 ——
  --   而新建的那支拿的是 default ACL, 不是原本那組 grant。
  --   📌 「取代」與「新建」在事後的計數上長得一模一樣。
  IF to_regprocedure(c_sig) IS NULL THEN
    RAISE EXCEPTION '#950-down 斷言②失敗:精確簽章不存在 ⇒ %', c_sig;
  END IF;

  -- ③ PUBLIC 不得握有 EXECUTE(新建的那支會拿 default ACL ⇒ 這一格才看得出來)
  SELECT has_function_privilege('public', c_sig, 'EXECUTE') INTO v_public_exec;
  IF v_public_exec THEN
    RAISE EXCEPTION '#950-down 斷言③失敗:PUBLIC 對 % 有 EXECUTE。', c_sig;
  END IF;

  -- ④ 三個 role 都要有 EXECUTE(掉了 grant ⇒ 客人打不開型錄, 而 migration 會回報成功)
  SELECT string_agg(r, ', ') INTO v_missing_roles
  FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r
  WHERE NOT has_function_privilege(r, c_sig, 'EXECUTE');
  IF v_missing_roles IS NOT NULL THEN
    RAISE EXCEPTION '#950-down 斷言④失敗:這些 role 對簽章沒有 EXECUTE ⇒ %', v_missing_roles;
  END IF;
END
$assert$;

COMMIT;
