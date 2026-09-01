-- 20260901060000_m4b_e4_order_created_stuck_count.sql
--
-- 板 ⟦b4-SIG4ERRORS⟧:訊號4 的 `errors` 桶【持續失敗】那一種,今天不會叫。
--
-- 🔴🔴 **它今天的形狀,逐字**(2026-09-01 線DB `-2d` 逐處讀出來的):
--    · `packages/domain/src/payment/anomaly-alert.ts:201-202`:
--      「`errors` 那一桶【不在這裡】—— 它會自己好(下一輪重撈)
--        ⇒ 要叫它需要跨輪狀態,本片沒有。那是具名的已知缺口,不是被忽略的。」
--    · `orderCreatedPaidNoEmailCount` 刻意【不】進 shouldAlert(「拿它當判準 = 有生意就叫」)
--    · `orderCreatedNoRecipientCount` 會叫,而它只涵蓋【兩個信箱都空】那一種
--    ⇒ 📌 **所以「排進去了、而每一輪都寄失敗」= 零告警。而客人那端看到的是什麼都沒收到。**
--
-- 🛑🛑 **而比「當下不會叫」嚴重一級的是這個**:
--    那個 `errors` 數**只落在 cron 的回應 body,沒有進任何表**
--    ⇒ ⇒ **一個沒有進表的計數,它的歷史等於不存在 —— 事後也查不到。**
--    ⇒ 📌 **前者只是沒被發現,後者連補救的路都沒有。**
--    (這一段是本檔存在的理由,不是背景。放註解不放 commit body,因為 commit body 不會被讀第二次。)
--
-- ✅ **解法不是新的狀態表**(線【出貨】`-1e` 2026-08-31 找到,本線複驗它會成立):
--    持久訊號在【缺口本身的年齡】= `now() - o.paid_at`。
--    · 持續失敗 ⇒ 那一筆一直留在缺口集合裡 ⇒ **年齡單調成長**
--    · 正常單   ⇒ scanner 下一輪就把它排進去 ⇒ **離開集合**
--    ⇒ 📌 **兩個世界天生分得開,而且不必記住上一輪。**
--
-- 🔵 依賴:`20260831030000_m4b_e4_order_created_gap_counts.sql`
--    —— 本函式的述詞【逐字照抄】那一支的 `paid_no_email_count`,再加兩個條件:
--       ① 年齡 > 門檻  ② 排除【兩個信箱都空】那一群(它們已經有自己的告警,不要重複叫)
--    ⚠️ 兩支的述詞如果漂開,兩邊都不會紅 ⇒ 改任一支要同時看另一支。
--
-- 🛑 **門檻不寫死在這裡**:呼叫端從 env 傳進來(`B4_ORDER_CREATED_STUCK_MINUTES`)。
--    env 沒設 ⇒ 呼叫端根本不呼叫本函式 ⇒ **行為與今天逐字相同**。
--    ⇒ 📌 那讓「落地」與「拍板」脫鉤:這支可以先進正式庫而不改變任何行為。

-- 🔴 **整支包在一個交易裡, 而那不是慣例** —— 本檔的斷言宣稱「對不上就 RAISE, 整支回捲」,
--    而沒有 BEGIN/COMMIT 的話那句話【對某些通道是假的】:未被外層交易包住、逐句送出的通道會逐句提交 ⇒ DO 失敗時
--    函式與 ACL 已經留在庫裡了。(codex 2026-09-01 R1 must-fix 4;基準檔 20260831030000:33/:256 同形)
BEGIN;

CREATE FUNCTION public.get_order_created_stuck_count(
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
  JS_WS constant text := E' \t\n\r\f\v' || U&'\00a0' || U&'\feff'
                      || U&'\3000'                                   -- 全形空白
                      || U&'\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a';
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

COMMENT ON FUNCTION public.get_order_created_stuck_count(timestamptz, integer) IS
$c$訊號4 的【持續失敗】那一格:已付款、過了起始線、而 order_created 那一列超過 N 分鐘還沒被建出來。

🔴 它與 get_order_created_gap_counts 的 paid_no_email_count 差在【年齡】:
   那一個 > 0 是正常的(新訂單進來就會被數到一次, 下一輪就沒了);
   這一個 > 0 不正常 —— 因為正常的單活不過一輪。

🛑 已排除【兩個信箱都空】那一群(它們走 no_recipient_count), 不要重複叫。
🛑 oldest_stuck_minutes 沒有卡住時回 NULL 不是 0 —— 「沒有卡住」與「卡了 0 分鐘」是兩件事。$c$;

-- 🔴 **擁有者釘死** —— `SECURITY DEFINER` 是【用擁有者的權限跑】⇒ 擁有者是誰不是細節。
--    SQL 若由 `supabase_admin` 之類的角色貼進去, 沒有這一行它就用那個角色的權限執行。
--    (codex 2026-09-01 R1 must-fix 2;基準檔 20260831030000:126 同形)
ALTER FUNCTION public.get_order_created_stuck_count(timestamptz, integer) OWNER TO postgres;

-- ── ACL(兩道 REVOKE 是物理擋)──
-- 🔴 新物件出生就自帶權限, 而 repo 內零 GRANT 字面可掃、三綠不紅。
--    照 20260831030000 同一格:第一道蓋 PUBLIC, 第二道蓋 Supabase【直接授權給具名角色】那一層。
--    ⚠️ 第二道在拋棄式 PG 裡量不到判別力(那裡 anon 只經 PUBLIC)——
--       「這裡量不到判別力」與「它是多餘的」是兩個結論。不要刪。
REVOKE ALL ON FUNCTION public.get_order_created_stuck_count(timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_order_created_stuck_count(timestamptz, integer)
  FROM anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_order_created_stuck_count(timestamptz, integer)
  TO payment_confirmer;

-- ── 斷言(fail-closed:對不上就 RAISE, 整支回捲)──
-- 🔴 用 `strpos()` 不用 `POSITION(x IN y)` —— 後者也是**SQL 文法構造**, 一樣不能加 schema 前綴
--    (2026-09-01 實跑第三次撞到同一族:先 EXTRACT、再 POSITION;`strpos` 是真函式 ⇒ 前綴安全)
-- 🔴 直接讀 pg_proc.proacl 比對【完整集合】, 不用 has_function_privilege
--    (那把尺只答該物件自己的 ACL, 不看它 body 裡呼叫的東西 ⇒ 會說謊)。
DO $assert$
DECLARE
  v_functions text[] := ARRAY['public.get_order_created_stuck_count(timestamptz,integer)']::text[];
  v_fn text;
  v_acl text;
  v_extra text;
  v_shape jsonb;
BEGIN
  FOREACH v_fn IN ARRAY v_functions LOOP
    SELECT pg_catalog.array_to_string(p.proacl, ',') INTO v_acl
      FROM pg_catalog.pg_proc p
     WHERE p.oid = v_fn::regprocedure;
    IF v_acl IS NULL THEN
      RAISE EXCEPTION '斷言失敗 — % 的 proacl 是 NULL ⇒ PUBLIC 看不見它而【預設可執行】', v_fn;
    END IF;
    -- 🔴 **改成【允許集合】不是黑名單**(codex 2026-09-01 R1 must-fix 1;抄基準檔 20260831030000 那一格):
    --    列 anon/authenticated/service_role 三個名字 = **黑名單在跟【下一個沒想到的角色】賽跑**
    --    ⇒ 多一個 `ops_reader` 它就靜靜放行。把授權清單攤開, 只要不在允許集合裡就炸。
    SELECT pg_catalog.string_agg(g.grantee, ', ')
      INTO v_extra
      FROM (
        SELECT pg_catalog.pg_get_userbyid((aclexplode(p.proacl)).grantee) AS grantee
          FROM pg_catalog.pg_proc p
         WHERE p.oid = v_fn::regprocedure
      ) g
     -- `CURRENT_USER` 是關鍵字不是函式(寫成 pg_catalog.current_user 會被當成欄名)。
     WHERE g.grantee NOT IN ('payment_confirmer', CURRENT_USER);
    IF v_extra IS NOT NULL THEN
      RAISE EXCEPTION '斷言失敗 — % 的 EXECUTE 清單多出非預期角色(%)—— 只應有 payment_confirmer', v_fn, v_extra;
    END IF;
    IF pg_catalog.strpos(v_acl, 'payment_confirmer=') = 0 THEN
      RAISE EXCEPTION '斷言失敗 — % 沒有授給 payment_confirmer ⇒ 呼叫端叫不動它:%', v_fn, v_acl;
    END IF;
  END LOOP;

  -- 🟢 正對照:門檻 <= 0 必須 RAISE(否則那道護欄是裝飾)
  BEGIN
    PERFORM public.get_order_created_stuck_count(pg_catalog.now(), 0);
    RAISE EXCEPTION '斷言失敗 — p_stuck_minutes=0 竟然沒有 RAISE ⇒ 那道護欄沒有生效';
  EXCEPTION WHEN others THEN
    IF pg_catalog.strpos(SQLERRM, '必須 > 0') = 0 THEN RAISE; END IF;
  END;

  -- 🟢 正對照:正常呼叫要回得出兩個 key(不是只回 NULL)
  v_shape := public.get_order_created_stuck_count(pg_catalog.now(), 60);
  -- 🔴 兩個 key 都要檢查 —— 原本註解寫「兩個」而只檢查了一個(codex R1 must-fix 3)。
  --    少了 oldest_stuck_minutes 那一格:下游讀到 undefined 之後 `?? 0`,
  --    而那個 0 與「沒有卡住」的 0 一模一樣。
  -- 🔴🔴 `v_shape IS NULL` 那一格【必須排在最前面】(codex 2026-09-01 R2 must-fix):
  --    `NULL ? 'x'` 回 NULL ⇒ `NOT NULL` 回 NULL ⇒ `NULL OR NULL` 回 NULL
  --    ⇒ 而 PL/pgSQL 的 `IF` 對 NULL 【跳過 THEN】⇒ **斷言安靜地通過**。
  --    📌 拋棄式 PG 17.10 實測:餵 v jsonb := NULL 進同一個 IF ⇒ 印「跳過 THEN」。
  --    ⇒ ⇒ 一支「回 NULL」的函式會全綠上線, 而下游 `?? 0` 之後那個 0 與健康的 0 一模一樣。
  IF v_shape IS NULL
     OR NOT (v_shape ? 'stuck_count')
     OR NOT (v_shape ? 'oldest_stuck_minutes') THEN
    RAISE EXCEPTION '斷言失敗 — 回傳缺鍵(收到 %)', v_shape;
  END IF;
END $assert$;

COMMIT;
