-- 20260928235000-rollback.sql —— 兩支告警函式退回 20260901070000 那一代(不排除 manual 留白)
--
-- 退回之後,每日告警又會把「manual_* 且 notification_email 空白」的單算成訂單成立信卡住 / 沒有收件人(已知誤報)。
-- 函式體從 20260901070000 機械抽出,逐字相同;後置閘核對 md5。不動任何資料表。

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.get_order_created_gap_counts(
  p_cutoff timestamptz
)
RETURNS jsonb
-- 🔴 `plpgsql` 而不是 `sql`,而那不是風格:純 SQL 函式**沒有辦法 RAISE**
--    ⇒ `p_cutoff` 是 NULL 時只能被安靜地吞掉,而 `>= NULL` = UNKNOWN ⇒ **恆回 0 = 靜默漏報**
--    ⇒ 📌 **而 0 正是「一切正常」的樣子。** 照 `20260831020000` 的成例 fail-closed。
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_result jsonb;
  /**
   * 🔴 **`btrim(x)` 預設【只吃半形空白】,而 JS 的 `trim()` 吃一整族**
   * (codex 2026-08-31 R1 must-fix;拋棄式 PG 複現在下方註解)。
   * ⇒ 一個值是 `E'\t'` 的信箱:use-case 判它是空 ⇒ 落 `noRecipient` 桶、排不進去;
   *   而本函式若用預設 `btrim` 會判它【非空】⇒ **漏報那一筆**。
   * 📌 **⇒ 兩邊對「空」的定義不同 ⇒ 告警與實際行為分岔, 而分岔的方向是【漏】。**
   * ⚠️ 涵蓋 JS `trim()` 的常見成員:空白 / \t / \n / \r / \f / \v / NBSP(U+00A0) / BOM(U+FEFF)。
   * 🛑 **它不是 JS 的完整集合**(Unicode 還有 U+2000-200A 等)—— 這是**收窄了的近似**,
   *   而**未涵蓋的那些方向是「本函式判非空、JS 判空」⇒ 仍是【漏報】不是誤報**。**未數。**
   */
  -- 🔴 單一來源(20260901070000)—— 原本這裡是一份自己寫的字集。
  JS_WS constant text := public.pcm_js_trim_whitespace();
BEGIN
  IF p_cutoff IS NULL THEN
    RAISE EXCEPTION 'get_order_created_gap_counts:p_cutoff 不得為 NULL(NULL 比較 = UNKNOWN ⇒ 恆回 0 = 靜默漏報)';
  END IF;

  SELECT pg_catalog.jsonb_build_object(
    -- 🔵 **脈絡,不是告警**:已付款、未取消、在起始線之後,而通知信那一列還沒被建出來。
    --    🛑 **這個數 > 0 是【正常】的** —— 下一輪 scanner 就會把它們排進去。
    --    它存在的理由是:沒有它,下面那個 `no_recipient` 的 0 在
    --    「一切正常」與「這裡根本沒有訂單」之間分不出來。
    'paid_no_email_count',
      (SELECT pg_catalog.count(*)
         FROM public.orders o
        WHERE o.payment_status = 'paid'
          AND o.cancelled_at IS NULL
          AND o.paid_at >= p_cutoff
          AND o.created_at >= p_cutoff
          AND NOT EXISTS (
                SELECT 1 FROM public.email_outbox e
                 WHERE e.order_id = o.id
                   AND e.event_type = 'order_created')),

    -- 🔴🔴 **這一個才是告警的主詞**:上面那一群裡,**兩個信箱都空**的。
    --    ⇒ scanner 撈到它也 enqueue 不了(use-case 落 `noRecipient` 桶)
    --    ⇒ 📌 **它不會自己好** —— 那張單沒有信箱,下一輪、下下輪都一樣。
    --    ⇒ ✅ 所以 Sean 的「有一封就叫」套在這一格上不會變噪音。
    -- ⚠️ 兩個候選信箱的順序與 adapter 一致:`orders.notification_email` 優先,
    --    退回 `customers.email`(LEFT JOIN ⇒ 沒有 customer 也算「空」)。
    -- 🔴 **`NULLIF` 不加 `pg_catalog.` 前綴,而那不是漏寫** —— 我第一版寫了,
    --    拋棄式 PG 17.10 實跑 ⇒ `ERROR: function pg_catalog.nullif(text, unknown) does not exist`。
    --    成因:`NULLIF` / `COALESCE` / `CASE` 是**SQL 文法構造**,不是 `pg_catalog` 裡的函式,
    --    所以它們**不受 `search_path = ''` 影響**、也不能加 schema 前綴。
    --    (`btrim` / `count` / `now` 是真的函式 ⇒ 那些要加。)
    -- 📌 **⇒ 而五道靜態檢查全綠、我讀了兩遍也沒看出來 —— 抓到它的是【真的餵給 psql】。**
    'no_recipient_count',
      (SELECT pg_catalog.count(*)
         FROM public.orders o
         LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
        WHERE o.payment_status = 'paid'
          AND o.cancelled_at IS NULL
          AND o.paid_at >= p_cutoff
          AND o.created_at >= p_cutoff
          AND NULLIF(pg_catalog.btrim(o.notification_email, JS_WS), '') IS NULL
          AND NULLIF(pg_catalog.btrim(c.email, JS_WS), '') IS NULL
          AND NOT EXISTS (
                SELECT 1 FROM public.email_outbox e
                 WHERE e.order_id = o.id
                   AND e.event_type = 'order_created')),

    -- 🔴 **分母**(照 `20260831020000` 的成例):沒有它,上面兩個 0 在
    --    「一切正常」與「這裡根本沒有訂單資料 / 讀不到」之間分不出來。
    -- ⚠️ **用途寫在它旁邊,免得下一個人拿它去算比率**:它是**全域訂單數**,
    --    含未付款、含起始線以前的。它答的是「**這裡到底有沒有訂單資料**」,
    --    **不是**「這個告警視窗裡有幾筆」。
    -- 🔵 `orders` 沒有 `deleted_at` 欄(2026-08-31 查 `information_schema` 確認)⇒ 不濾。
    'orders_total_count',
      (SELECT pg_catalog.count(*) FROM public.orders)
  )
  INTO v_result;
  RETURN v_result;
END
$fn$;

CREATE OR REPLACE FUNCTION public.get_order_created_stuck_count(
  p_cutoff timestamptz,
  p_stuck_minutes integer
)
RETURNS jsonb
-- 🔴 `plpgsql` 不是 `sql`:純 SQL 函式沒辦法 RAISE ⇒ NULL 參數只能被安靜吞掉,
--    而 `>= NULL` = UNKNOWN ⇒ **恆回 0 = 靜默漏報**,而 0 正是「一切正常」的樣子。
--    照 `20260831030000` 的成例 fail-closed。
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  -- 🔴 與 20260831030000 逐字相同的空白集合 —— 兩邊對「空」的定義必須一致,
  --    不然告警與實際行為分岔,而分岔的方向是【漏】。
  -- 🔴 單一來源(本片)—— 原本這裡是一份自己寫的字集(而它與隔壁那支不同)。
  JS_WS constant text := public.pcm_js_trim_whitespace();
  v_result jsonb;
BEGIN
  IF p_cutoff IS NULL THEN
    RAISE EXCEPTION 'get_order_created_stuck_count:p_cutoff 不得為 NULL(NULL 比較 = UNKNOWN ⇒ 恆回 0 = 靜默漏報)';
  END IF;
  IF p_stuck_minutes IS NULL THEN
    RAISE EXCEPTION 'get_order_created_stuck_count:p_stuck_minutes 不得為 NULL(同上:NULL 會讓門檻條件恆為 UNKNOWN)';
  END IF;
  -- 🔴 負數或 0 = 「所有缺口都算卡住」⇒ 那會把每一筆新訂單都算進去 = 對常態發警報。
  --    ⇒ 而那正是本片要避免的東西 ⇒ fail-closed,不要靜靜接受。
  IF p_stuck_minutes <= 0 THEN
    RAISE EXCEPTION 'get_order_created_stuck_count:p_stuck_minutes 必須 > 0(收到 %);<= 0 會讓每一筆新訂單都算卡住 = 對常態發警報', p_stuck_minutes;
  END IF;

  SELECT jsonb_build_object(
    -- 🔴 這一個【才是】告警主詞:缺口年齡超過門檻的筆數。
    'stuck_count',
      (SELECT pg_catalog.count(*)
         FROM public.orders o
         LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
        WHERE o.payment_status = 'paid'
          AND o.cancelled_at IS NULL
          AND o.paid_at >= p_cutoff
          AND o.created_at >= p_cutoff
          AND o.paid_at < pg_catalog.now() - (p_stuck_minutes * INTERVAL '1 minute')
          -- 🛑 排除【兩個信箱都空】那一群 —— 它們有自己的告警(no_recipient_count)
          --    ⇒ 不排除的話同一張單會被兩個訊號各叫一次, 而收信的人分不出是一件還是兩件事。
          AND NOT (NULLIF(pg_catalog.btrim(o.notification_email, JS_WS), '') IS NULL
               AND NULLIF(pg_catalog.btrim(c.email, JS_WS), '') IS NULL)
          AND NOT EXISTS (
                SELECT 1 FROM public.email_outbox e
                 WHERE e.order_id = o.id
                   AND e.event_type = 'order_created')),

    -- 🔵 最舊那一筆的年齡(分鐘)—— 一個裸的筆數寫不出信裡那句「卡多久了」。
    --    🛑 沒有卡住的筆數時回 NULL,**不是 0** —— 「沒有卡住」與「卡了 0 分鐘」是兩件事。
    'oldest_stuck_minutes',
      -- 🔴 `EXTRACT` 不加 `pg_catalog.` 前綴, 而那不是漏寫 —— 我第一版寫了,
      --    拋棄式 PG 17.10 實跑 ⇒ `ERROR: syntax error at or near "FROM"`。
      --    成因與隔壁那支的 `NULLIF` 同一個:`EXTRACT` 是**SQL 文法構造**不是函式,
      --    所以它不受 `search_path = ''` 影響、也不能加 schema 前綴。
      --    (`floor` / `min` / `now` / `count` 是真的函式 ⇒ 那些要加。)
      --    📌 ⇒ 同一份檔頭已經記過這個坑, 而我還是踩了 —— **讀過不等於套用得到。**
      (SELECT pg_catalog.floor(
                extract(epoch FROM (pg_catalog.now() - pg_catalog.min(o.paid_at))) / 60)::bigint
         FROM public.orders o
         LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
        WHERE o.payment_status = 'paid'
          AND o.cancelled_at IS NULL
          AND o.paid_at >= p_cutoff
          AND o.created_at >= p_cutoff
          AND o.paid_at < pg_catalog.now() - (p_stuck_minutes * INTERVAL '1 minute')
          AND NOT (NULLIF(pg_catalog.btrim(o.notification_email, JS_WS), '') IS NULL
               AND NULLIF(pg_catalog.btrim(c.email, JS_WS), '') IS NULL)
          AND NOT EXISTS (
                SELECT 1 FROM public.email_outbox e
                 WHERE e.order_id = o.id
                   AND e.event_type = 'order_created'))
  ) INTO v_result;

  RETURN v_result;
END;
$fn$;

DO $post$
BEGIN
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.get_order_created_gap_counts(timestamptz)'))
     IS DISTINCT FROM '540baed792ed8cb1e98ca4636ec790af' THEN
    RAISE EXCEPTION '後置閘:get_order_created_gap_counts 沒有回到 20260901070000 那一代';
  END IF;
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.get_order_created_stuck_count(timestamptz,integer)'))
     IS DISTINCT FROM '46113ef0a608c2a58093ad2c4f645708' THEN
    RAISE EXCEPTION '後置閘:get_order_created_stuck_count 沒有回到 20260901070000 那一代';
  END IF;
  RAISE NOTICE '✅ 20260928235000 退回完成';
END
$post$;

COMMIT;
