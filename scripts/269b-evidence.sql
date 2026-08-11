-- #269-b「新品」批次日門檻的證據查詢（唯讀，可重跑）
-- ============================================================
-- 存在理由：migration `20260811040000_m4b_storefront_269b_catalog_new_arrivals.sql`
-- 的檔頭引用了一堆數字（22 天分佈、99 vs 0 突變、48ms、never executed）。
-- codex 對抗審查 R2 NIT-4 指出：**repo 只留了結論、沒留產生它的查詢 ⇒ 外人無法複驗**。
-- 這支檔就是那些查詢本身。全部唯讀，不改任何東西。
--
-- 怎麼跑：psql 直連正式庫貼進去，或用 Supabase MCP `execute_sql` 逐段送。
-- 🔴 §4 需要 `SET plan_cache_mode`，pooled 連線每次呼叫是獨立 session ⇒ §4 三句要一起送。
--
-- 數字會隨資料變動 —— 重跑後對不上檔頭不代表誰寫錯，代表資料變了、門檻該重估。
-- ============================================================


-- ── §1. 每個台灣日進了幾件（判準的母體；🔴 全歷史，不要只掃近 N 天）──
-- 檔頭宣稱：22 天有商品進來；<30 件 16 天；30–185 件 0 天；186 件 1 天；>=648 件 5 天。
-- ⚠️ 我第一版只掃近 60 天、把「正常日最大 29」寫成全域事實，漏掉 2026-06-03 的 186 件。
WITH plp AS (
  SELECT p.id, p.created_at, p.supplier_slug
  FROM public.products p
  JOIN public.brands b ON b.id = p.brand_id
  JOIN public.categories c ON c.id = p.category_id
  WHERE p.delisted_at IS NULL          -- 客人看得到的那個宇宙
), d AS (
  SELECT (created_at AT TIME ZONE 'Asia/Taipei')::date AS day,
         count(*) AS n,
         count(DISTINCT created_at) AS distinct_ts,      -- 機器批次的指紋：時戳極少
         count(DISTINCT supplier_slug) AS suppliers
  FROM plp GROUP BY 1
)
SELECT day, n, distinct_ts, suppliers FROM d ORDER BY n DESC;

-- §1b. 分桶版（檔頭那五個數字就是這一列）
-- 🔴 這是**獨立的一句**、自己帶完整 CTE —— 前一句的 `d` 在它結束時就沒了，
--    上一版我把它寫成註解裡的 `... FROM d;`，解開註解會直接 42P01（codex R3 抓到）。
WITH plp AS (
  SELECT p.id, p.created_at
  FROM public.products p
  JOIN public.brands b ON b.id = p.brand_id
  JOIN public.categories c ON c.id = p.category_id
  WHERE p.delisted_at IS NULL
), d AS (
  SELECT (created_at AT TIME ZONE 'Asia/Taipei')::date AS day, count(*) AS n
  FROM plp GROUP BY 1
)
SELECT count(*)                                     AS total_days,
       count(*) FILTER (WHERE n < 30)               AS under_30,
       count(*) FILTER (WHERE n >= 30 AND n < 186)  AS between_30_185,
       count(*) FILTER (WHERE n >= 186)             AS at_or_over_186,
       max(n)   FILTER (WHERE n < 100)              AS max_below_threshold,
       min(n)   FILTER (WHERE n >= 100)             AS min_at_or_over_threshold
FROM d;


-- ── §2. 批次日下界為什麼要對齊「台灣日 00:00」──
-- 檔頭宣稱：窗起點 2026-07-05 01:04:40.646478+00（該日共 1,392 件）
--           對齊台灣日 00:00（本檔作法）→ 0 件存活
--           下界就用 p_new_since 本身（突變）→ **99 件**存活
-- 🔴 這組數字與門檻 N 綁死：換 N 就要換窗起點重跑（N=100 時要找「窗內殘量 < 100」的切點）。
--    找切點的查詢見 §2b。
WITH plp AS (
  SELECT p.id, p.created_at FROM public.products p
  JOIN public.brands b ON b.id = p.brand_id
  JOIN public.categories c ON c.id = p.category_id
  WHERE p.delisted_at IS NULL
), params AS (SELECT timestamptz '2026-07-05 01:04:40.646478+00' AS since, 100 AS n),
days_fixed AS (   -- 本檔作法：整個台灣日都數
  SELECT (pb.created_at AT TIME ZONE 'Asia/Taipei')::date AS day
  FROM plp pb, params
  WHERE pb.created_at >= timezone('Asia/Taipei', date_trunc('day', timezone('Asia/Taipei', params.since)))
    AND pb.created_at <= now()
  GROUP BY 1 HAVING count(*) >= (SELECT n FROM params)
),
days_naive AS (   -- 突變：只數窗內那半天
  SELECT (pb.created_at AT TIME ZONE 'Asia/Taipei')::date AS day
  FROM plp pb, params
  WHERE pb.created_at >= params.since AND pb.created_at <= now()
  GROUP BY 1 HAVING count(*) >= (SELECT n FROM params)
),
win AS (SELECT pb.* FROM plp pb, params
        WHERE pb.created_at >= params.since AND pb.created_at < timestamptz '2026-07-06 00:00+08')
SELECT (SELECT count(*) FROM win) AS window_rows_that_day,
       (SELECT count(*) FROM win w WHERE NOT EXISTS (
          SELECT 1 FROM days_fixed d WHERE d.day = (w.created_at AT TIME ZONE 'Asia/Taipei')::date)) AS with_fix_survivors,
       (SELECT count(*) FROM win w WHERE NOT EXISTS (
          SELECT 1 FROM days_naive d WHERE d.day = (w.created_at AT TIME ZONE 'Asia/Taipei')::date)) AS without_fix_survivors;


-- ── §2b. 換了 N 之後,怎麼找新的突變切點 ──
-- 要的是「整日 >= N、但從某個時戳往後數 < N」的那個時戳。找不到 ⇒ 該 N 下這條守門構造不出負測,
-- 那就要在檔頭誠實寫「本 N 下無法構造」,不要沿用舊 N 的數字（R2 就是抓到我沿用了）。
WITH plp AS (
  SELECT p.id, p.created_at FROM public.products p
  JOIN public.brands b ON b.id = p.brand_id
  JOIN public.categories c ON c.id = p.category_id
  WHERE p.delisted_at IS NULL
), n AS (SELECT 100 AS threshold),
days AS (SELECT (created_at AT TIME ZONE 'Asia/Taipei')::date AS day, count(*) cnt
         FROM plp GROUP BY 1 HAVING count(*) >= (SELECT threshold FROM n)),
ts AS (SELECT (p.created_at AT TIME ZONE 'Asia/Taipei')::date AS day, p.created_at, count(*) AS c
       FROM plp p JOIN days d ON d.day = (p.created_at AT TIME ZONE 'Asia/Taipei')::date
       GROUP BY 1,2),
run AS (SELECT day, created_at, sum(c) OVER (PARTITION BY day ORDER BY created_at DESC
                                             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS from_end
        FROM ts)
SELECT r.day, d.cnt AS day_total, r.created_at AS candidate_since, r.from_end
FROM run r JOIN days d ON d.day = r.day, n
WHERE r.from_end BETWEEN 1 AND n.threshold - 1
ORDER BY r.from_end DESC;


-- ── §3. 效能形狀（檔頭的 48.053 ms）──
-- ⚠️ 這是**等價形狀**、不是那支函式本體（函式要 apply 後才存在）。
--    真數字一律以 apply 後的真 PostgREST anon 量測為準（migration 檔頭「段二解鎖閘」五格）。
-- 🔴 **誠實標註（codex R3）**：這一段少了函式本體真正會做的事 ——
--    `count(*) OVER ()`、ORDER BY、OFFSET/LIMIT、以及當頁的 `product_image_trim` LEFT JOIN
--    ⇒ 它**產不出**檔頭引用的「25 列／48.053 ms／shared hit 8,874」那組數字（那組是另一個更完整的形狀量的）。
--    這裡保留的是「批次日 CTE + 窗篩選」這一段的成本量級，不是全函式成本。**不要拿它去對檔頭的 48ms。**
EXPLAIN (ANALYZE, BUFFERS, TIMING)
WITH new_batch_days AS (
  SELECT (p0.created_at AT TIME ZONE 'Asia/Taipei')::date AS day
  FROM public.products p0
  JOIN public.brands b0 ON b0.id = p0.brand_id
  JOIN public.categories c0 ON c0.id = p0.category_id
  WHERE p0.delisted_at IS NULL
    AND p0.created_at >= timezone('Asia/Taipei', date_trunc('day', timezone('Asia/Taipei', (now() - interval '7 days'))))
    AND p0.created_at <= now()
  GROUP BY 1 HAVING count(*) >= 100
), filtered AS (
  SELECT p.id, p.created_at, p.price_general
  FROM public.products p
  JOIN public.brands b ON b.id = p.brand_id
  JOIN public.categories c ON c.id = p.category_id
  WHERE p.delisted_at IS NULL
    AND p.created_at >= (now() - interval '7 days')
    AND p.created_at <= now()
    AND NOT EXISTS (SELECT 1 FROM new_batch_days nbd
                    WHERE nbd.day = (p.created_at AT TIME ZONE 'Asia/Taipei')::date)
)
SELECT count(*) FROM filtered;


-- ── §4. 「p_new_since IS NULL 時批次日 CTE 不會被執行」──
-- 檔頭宣稱：計畫裡該 SubPlan 逐字印 `(never executed)`。
-- 🔴 三句必須在同一個 session 送出（pooled 連線每次呼叫是獨立 session）。
-- ⚠️ 這仍是等價形狀,不是函式本體 ⇒ 檔頭把它標為「預期」而非「已驗」,真憑據是 apply 後的閘。
SET plan_cache_mode = force_generic_plan;
PREPARE q269b(timestamptz) AS
WITH plp AS (
  SELECT p.id, p.created_at FROM public.products p
  JOIN public.brands b ON b.id = p.brand_id
  JOIN public.categories c ON c.id = p.category_id
  WHERE p.delisted_at IS NULL
), new_batch_days AS (
  SELECT (pb.created_at AT TIME ZONE 'Asia/Taipei')::date AS day FROM plp pb
  WHERE pb.created_at >= timezone('Asia/Taipei', date_trunc('day', timezone('Asia/Taipei', $1)))
    AND pb.created_at <= now()
  GROUP BY 1 HAVING count(*) >= 100
), filtered AS (
  SELECT p.* FROM plp p
  WHERE ($1 IS NULL OR (p.created_at >= $1 AND p.created_at <= now()
        AND NOT EXISTS (SELECT 1 FROM new_batch_days nbd
                        WHERE nbd.day = (p.created_at AT TIME ZONE 'Asia/Taipei')::date)))
)
SELECT count(*) FROM filtered;
EXPLAIN (ANALYZE, BUFFERS) EXECUTE q269b(NULL);
-- 🔴 收尾必跑（codex R3）：不收的話同一個 psql session 第二次跑會撞
--    「prepared statement q269b already exists」，而且 force_generic_plan 會繼續污染後面每一句查詢。
DEALLOCATE q269b;
RESET plan_cache_mode;


-- ── §5. security_invoker view 需要的底表欄級權限（fail-closed 檢查）──
-- 檔頭宣稱：anon/authenticated 對 products.created_at 本來就有欄級 SELECT;price_by_tier 是 false。
SELECT a.attname,
       has_column_privilege('anon',          'public.products', a.attname, 'SELECT') AS anon_select,
       has_column_privilege('authenticated', 'public.products', a.attname, 'SELECT') AS auth_select
FROM pg_attribute a
WHERE a.attrelid = 'public.products'::regclass AND a.attnum > 0 AND NOT a.attisdropped
  AND a.attname IN ('created_at', 'id', 'price_general', 'price_by_tier', 'price_store', 'metadata', 'delisted_at')
ORDER BY a.attnum;
