-- 20260901070000_m4b_e4_js_trim_ws_single_source.sql
--
-- 板 ⟦b4-JSWSWIDEN1⟧:兩支函式各自寫了一份「什麼算空白」, 而【同一個窄】在兩支裡後果相反。
--
-- 🔴 **成因不是誰寫窄了, 是【有兩份】**:
--    `20260831030000:62` 與 `20260901060000` 各有一行 `JS_WS constant text := …`
--    ⇒ 而 `20260831030000` 的檔頭自己逐字警告過:
--      「**兩邊對『空』的定義必須一致, 不然告警與實際行為分岔**」
--    ⇒ ⇒ 📌 **那句話是對的, 而它防不了自己 —— 因為防它需要的是【一份】, 不是【兩份寫得一樣】。**
--
-- 🔴 **而「窄」在兩支裡的方向相反**(2026-09-01 Fable R3 F4 抓到, 本線實測複現):
--    · `get_order_created_gap_counts` 的 `no_recipient_count`
--      ⇒ 漏掉 ⇒ **少報一筆該叫的** ⇒ 安全側
--    · 🔴 `get_order_created_stuck_count`
--      ⇒ `notification_email` 是一個全形空白(U+3000)、`customers.email` 空
--      ⇒ TS 的 `trim()` 判它空 ⇒ **永遠不會 enqueue**;而 SQL 判它非空 ⇒ **不被排除**
--      ⇒ ⇒ 過門檻後開始叫, 而且**永遠不會停** ⇒ **永久誤報**
--    📌 **⇒ 而永久誤報比漏報難處理:它會訓練所有人忽略整個告警。**
--
-- ✅ **本片做兩件**:
--    ① 建一支 `public.pcm_js_trim_whitespace()` —— **單一來源**, 兩支函式都呼叫它
--    ② `CREATE OR REPLACE` 那兩支, 把各自那行 `JS_WS constant` 換成呼叫它
--    ⇒ 🔵 **從此「兩邊不一致」不是靠人記得, 是結構上做不到。**
--
-- ⚠️ **射程:它涵蓋的是 JS `trim()` 的【常見成員】, 不是 Unicode 全集。**
--    JS `trim()` 吃的是 WhiteSpace + LineTerminator(含 ` ` ` ` 與 ` `)。
--    下面列的是**實際會出現在信箱欄位裡**的那些。⇒ 仍是收窄, 而**現在只需要在一個地方加寬**。

BEGIN;

-- 🔴 `IMMUTABLE`:它是一個常數 —— 讓 planner 可以 inline, 也讓它能用在索引述詞裡(將來若需要)。
-- 🔴 `search_path = ''` 與其他兩支一致;本函式不碰任何表, 所以沒有 SECURITY DEFINER 的必要。
-- 🛑 裸 `CREATE` 不是 `OR REPLACE` —— 這是【新物件】:撞名要當場紅。
--    `OR REPLACE` 會把撞名靜靜蓋掉, 而 REVOKE 與斷言照樣綠
--    ⇒ 拿到綠燈, 卻蓋掉了一個你不知道存在的東西。
CREATE FUNCTION public.pcm_js_trim_whitespace()
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT E' \t\n\r\f\v'
      || U&'\00a0'                                          -- NBSP
      || U&'\feff'                                          -- BOM / ZWNBSP
      || U&'\3000'                                          -- 全形空白(這一個就是本片的成因)
      || U&'\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a'  -- en/em/thin space 那一族
      || U&'\2028\2029'                                     -- line / paragraph separator
      || U&'\1680';                                         -- ogham space mark
$fn$;

COMMENT ON FUNCTION public.pcm_js_trim_whitespace() IS
$c$「什麼算空白」的【單一來源】—— 與 JS 的 String.prototype.trim() 對齊。

🔴 為什麼要有它:2026-09-01 之前有兩份各自寫的字集(20260831030000 與 20260901060000),
   而同一個「窄」在兩支函式裡後果相反:一個少報(安全)、一個永久誤報。
   ⇒ 而 20260831030000 的檔頭警告過「兩邊定義必須一致」—— 那句話防不了自己,
     因為防它需要的是【一份】, 不是【兩份寫得一樣】。

⚠️ 它仍是收窄(不是 Unicode 全集), 而現在【只需要在一個地方加寬】。
🛑 要改它之前先想:任何加寬都會讓「判為空」的東西變多
   ⇒ 對 no_recipient_count 是多叫、對 stuck_count 是少叫。兩支一起看。$c$;

REVOKE ALL ON FUNCTION public.pcm_js_trim_whitespace() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_js_trim_whitespace()
  FROM anon, authenticated, service_role;
-- 🔵 兩支呼叫端都是 SECURITY DEFINER 且 owner = postgres ⇒ 它們以 owner 身分呼叫本函式,
--    所以本函式【不需要】授給 payment_confirmer。
--    ⚠️ 而那是一個【依賴】:若將來有非 DEFINER 的呼叫端, 這裡要補 GRANT。
ALTER FUNCTION public.pcm_js_trim_whitespace() OWNER TO postgres;

-- ══ ② 兩支呼叫端改用那個單一來源 ══
-- 🔴 **函式體是【從原始檔機械抽出來的】, 只換掉 `JS_WS constant` 那一行** ——
--    我沒有手抄任何一行邏輯。理由:手抄會引入第三份, 而本片要消滅的正是「有兩份」。

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

-- 🔵 這一支(20260901060000)本身還沒 apply ⇒ 它會先建、再被這裡 REPLACE。
--    版本號順序保證了那個先後(060000 < 070000)。
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

-- ══ ③ 斷言:兩支【真的】都在用那個單一來源 ══
-- 🔴 而這一格是本片的重點:**「兩邊一致」不能靠人記得, 要有東西會叫。**
DO $assert$
DECLARE
  -- 🔴 清單【必須自己一行, 而且叫 v_functions】—— 靜態閘取清單的 awk 錨是
  --    `^[[:space:]]*v_functions`(基準檔 20260831030000 檔內逐字寫過)。
  --    而它不是裝飾:下面的迴圈就是吃它, 漏列一個 ⇒ 那個物件不會被檢查到。
  --    📌 收權斷言【只檢查你列出來的物件】:它防「忘記收權」, 不防「忘記列」。
  v_functions text[] := ARRAY['public.pcm_js_trim_whitespace()', 'public.get_order_created_gap_counts(timestamptz)', 'public.get_order_created_stuck_count(timestamptz,integer)']::text[];
  v_src text;
  v_fn  text;
  v_ws  text;
BEGIN
  FOREACH v_fn IN ARRAY v_functions LOOP
    SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = v_fn::regprocedure;
    IF v_src IS NULL THEN
      RAISE EXCEPTION '單一來源斷言失敗 — 找不到 %', v_fn;
    END IF;
    -- 🔵 helper 自己跳過下面兩道(它【就是】那個來源, 不會呼叫自己)
    CONTINUE WHEN v_fn = 'public.pcm_js_trim_whitespace()';
    -- 🟢 正向:它必須呼叫那支 helper
    IF pg_catalog.strpos(v_src, 'pcm_js_trim_whitespace()') = 0 THEN
      RAISE EXCEPTION '單一來源斷言失敗 — % 沒有呼叫 public.pcm_js_trim_whitespace() ⇒ 它自己寫了一份', v_fn;
    END IF;
    -- 🔴 反向:它【不得】還留著自己那份字面(否則兩份會再度漂開, 而沒有東西會叫)
    IF pg_catalog.strpos(v_src, '\00a0') > 0 OR pg_catalog.strpos(v_src, '\feff') > 0 THEN
      RAISE EXCEPTION '單一來源斷言失敗 — % 的函式體裡還留著自己寫的空白字面 ⇒ 有兩份', v_fn;
    END IF;
  END LOOP;

  -- 🟢 helper 本身要真的含全形空白(那就是本片的成因)
  v_ws := public.pcm_js_trim_whitespace();
  IF pg_catalog.strpos(v_ws, U&'\3000') = 0 THEN
    RAISE EXCEPTION '單一來源斷言失敗 — helper 不含全形空白 U+3000 ⇒ 本片沒有解到那個 bug';
  END IF;
  -- 🔵 負對照:它不該含一個【不是空白】的字元(證明這把尺分得出來, 不是恆真)
  IF pg_catalog.strpos(v_ws, 'x') > 0 THEN
    RAISE EXCEPTION '單一來源斷言失敗 — helper 含一般字元 ⇒ 字集寫壞了';
  END IF;
END $assert$;

COMMIT;
