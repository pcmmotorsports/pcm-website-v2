-- ⟦b4-NORECIPIENTWINDOW⟧ 第四條線的收件人訊號 —— **鏡像 `20260903070000`, 不是新設計。**
--
-- ══ 這一支為什麼存在 ══════════════════════════════════════════════════════
-- 板 `⟦b4-NORECIPIENTWINDOW⟧` 的主詞是「一封信找不到收件人 ⇒ 那一列不留任何痕跡」。
-- 2026-09-04 `-ship` 實查:**看得見那一半, 三條線都已經接上告警**
--   (`shippedNeverEnqueued` / `shippedUnsendable` / `orderCreatedNoRecipient` / `unpaidCancelledNoRecipient`)
-- 🔴 **而我同日加的第四條線(`shipment_tracking_corrected`, 片 C)一個計數都沒有。**
-- ⇒ 📌 **這一支就是把第四條線接上同一套儀器。照抄現成的, 不發明。**
--
-- 🟢 **而【佔名額】那一半, 第四條線本來就沒有**:掃描 view `pcm_tracking_corrected_email_pending`
--    自己就把「兩個信箱都空」的配對濾掉了(與出貨線同形)⇒ 它們連被撈的機會都沒有。
--    ⇒ 🛑 **所以本支解的是【看不見】, 不是【佔名額】** —— 兩件事, 不要合起來讀。
--    (付款信與取消信那兩條**仍然會**每輪重撈, 那是另一片:`-94` 2026-09-04 裁「明天單獨一片 codex」。)
--
-- ══ 🔴 這個桶【今天大概不會非零】, 而那不是省掉它的理由 ═══════════════════════
-- 本線的掃描面要求「出貨信**已經寄出**且早於更正時點」⇒ 那封信寄出的當下**一定有收件人**。
-- ⇒ 所以要落進這個桶, 得是**寄出之後**那兩個信箱**都被清空**。
-- ⛔ ~~「今天【不可能】非零」~~ **那個字太強**(codex 2026-09-04 nit):
--    🔴 **它不是一個 DB invariant** —— `customers.email` 與 `orders.notification_email`
--    **都沒有非空白約束** ⇒ 任何一發人工 / 管理 SQL 都做得到。
--    ⇒ 📌 而「不可能」與「我想不到怎麼發生」是兩件事, 而前者需要一道約束當靠山。
-- 🎯 而**有意圖的**那條路也存在:**客人行使刪除權**(`docs/runbooks/data-rights-sop.md`)
--    ⚠️ 而那條流程**今天實作到哪一步我沒查** —— 這一格標未確認, 不當成它已經在跑。
-- ⇒ 📌 **一個「今天不會亮」的計數與一個「永遠不會亮」的計數, 在儀表上長得一樣**
--   ⇒ 而它們的差別只有在**那一天**才看得出來。這一支就是為那一天裝的。
--
-- ══ 🛑 三件這一支【證不到】的事(codex 2026-09-04 逐條逼出來, 寫在這裡而不是修掉)══
-- ① **收權斷言看不到 role membership。** 下面那段只讀 `proacl` ⇒ 有人把 `payment_confirmer`
--    **授予**另一個角色之後, 斷言仍然全綠而那個角色執行得了這支 SECURITY DEFINER。
--    🔵 **而這是姊妹那幾支【一模一樣】的性質**(本段逐字抄自 `20260903070000`)
--    ⇒ 📌 **它是這個樣板的已知天花板, 不是我這一支的退步。** 要修得改整族, 不在本片。
-- ② **apply 期的形狀斷言只驗三個 key 在不在。** 把 `no_recipient_count` 那個查詢
--    整段換成常數 `0`, 本檔**照樣全綠** —— 因為 apply 當下庫裡沒有資料可以分辨。
--    🔴 **缺的那道檢查 = 在拋棄式 PG 上【造一筆會落進那個桶的資料】再呼叫它。**
--    而那需要一張「已出貨、已更正、出貨信已寄、兩個信箱都空」的箱 ——
--    ⚠️ 2026-09-04 實測:**這個 schema 裡插不出一張已出貨的箱, 只能走出來**(六道守門)
--    ⇒ 那是一片獨立的 fixture 工程。**今天沒有做, 而它不是不需要。**
-- ③ **前置閘只驗「同名的 relation / column 在不在」, 不驗那個 view 的定義。**
--    有人先貼了一個同名而內容不同的 view ⇒ 閘照過, 而互補集不再互補。
--
-- ⚠️ **前置:`20260904220000` 必須先貼**(它建 `tracking_corrected_at` 欄與那個 view)。
--    下面有一道前置閘會擋住順序反了的情況 —— 而**擋住比建出一個恆回 0 的函式好**:
--    🔴 一個查不到欄位的函式**不會安靜地回 0, 它會 42703** ⇒ 而那是在**告警要用它的時候**才炸。

BEGIN;

-- ── 前置閘:片 C 那一支貼了沒 ──────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'pcm_tracking_corrected_email_pending')
  THEN
    RAISE EXCEPTION '前置閘:找不到 pcm_tracking_corrected_email_pending ⇒ 20260904220000 還沒貼, 先貼那一支';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.shipments'::regclass
       AND a.attname = 'tracking_corrected_at' AND a.attnum > 0 AND NOT a.attisdropped)
  THEN
    RAISE EXCEPTION '前置閘:shipments 沒有 tracking_corrected_at ⇒ 20260904220000 還沒貼';
  END IF;
END
$$;

CREATE FUNCTION public.get_tracking_corrected_gap_counts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  JS_WS constant text := public.pcm_js_trim_whitespace();
  v_result jsonb;
BEGIN
  -- 🔴 **本支【沒有 cutoff 參數】, 而那與姊妹線不同 —— 不是漏了。**
  --    姊妹線要 cutoff, 因為它們的母體(orders)在功能上線前就存在。
  --    本線的觸發欄 `shipments.tracking_corrected_at` 是片 C 才新增的
  --    ⇒ 歷史上每一箱都是 NULL ⇒ **母體天生從空的開始長。**
  --    ⇒ 📌 而姊妹線那句「NULL 比較 = UNKNOWN ⇒ 恆回 0 = 靜默漏報」在這裡沒有對象可以擋。
  SELECT pg_catalog.jsonb_build_object(
    -- 🔵 **正常會 >0** —— 下一輪 scanner 就排掉了。**不要拿它當告警判準**(那會變成「有更正就叫」)。
    'pending_count',
      (SELECT pg_catalog.count(*) FROM public.pcm_tracking_corrected_email_pending),

    -- 🔴🔴 **告警的主詞。** 單號被更正過、出貨信【在更正之前】已經寄出去(⇒ 客人手上那個號碼是錯的)、
    --    而現在**兩個信箱都空** ⇒ 我們**寄不出那封更正信**, 而它**不會自己好**。
    -- 🛑 條件逐字鏡像掃描 view, 只把「有信箱」那一條**翻過來** ——
    --    ⇒ 兩者是**互補的兩半**, 加起來才是「該通知而還沒通知」的全部。
    'no_recipient_count',
      (SELECT pg_catalog.count(DISTINCT (s.id, o.id))
         FROM public.shipments s
         JOIN public.shipment_items si ON si.shipment_id = s.id
         JOIN public.order_items   oi ON oi.id = si.order_item_id
         JOIN public.orders         o ON o.id = oi.order_id
         LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
        WHERE s.shipped_at IS NOT NULL
          AND s.deleted_at IS NULL
          AND s.tracking_corrected_at IS NOT NULL
          AND NULLIF(pg_catalog.btrim(s.tracking_number, JS_WS), '') IS NOT NULL
          AND NULLIF(pg_catalog.btrim(o.notification_email, JS_WS), '') IS NULL
          AND NULLIF(pg_catalog.btrim(c.email, JS_WS), '') IS NULL
          AND EXISTS (
                SELECT 1 FROM public.email_outbox e0
                 WHERE e0.event_type = 'order_shipped'
                   AND e0.dedup_key  = public.pcm_shipped_email_dedup_key(s.id, o.id)
                   AND e0.status     = 'sent'
                   AND e0.sent_at IS NOT NULL
                   AND e0.sent_at < s.tracking_corrected_at)
          AND NOT EXISTS (
                SELECT 1 FROM public.email_outbox e
                 WHERE e.event_type = 'shipment_tracking_corrected'
                   AND e.dedup_key  = public.pcm_tracking_corrected_dedup_key(
                                        s.id, o.id, s.tracking_corrected_at))),

    -- 🔵 分母。**一個計數沒有分母, 讀的人會自己補一個**(而他補的那個多半是全部)。
    'corrected_shipments_total_count',
      (SELECT pg_catalog.count(*) FROM public.shipments s
        WHERE s.tracking_corrected_at IS NOT NULL AND s.deleted_at IS NULL)
  )
  INTO v_result;
  RETURN v_result;
END
$fn$;

ALTER FUNCTION public.get_tracking_corrected_gap_counts() OWNER TO postgres;

COMMENT ON FUNCTION public.get_tracking_corrected_gap_counts() IS
$c$回 jsonb{pending_count, no_recipient_count, corrected_shipments_total_count}。
🔴 告警的主詞是 no_recipient_count:單號更正過、出貨信在更正前已寄出(客人手上是錯號碼)、
   而兩個信箱都空 ⇒ 寄不出去, 而它不會自己好。
🔵 pending_count > 0 是正常的(下一輪 scanner 就排掉)—— 拿它當判準會變成「有更正就叫」。
🛑 本支【沒有 cutoff 參數】而姊妹線有:本線觸發欄 shipments.tracking_corrected_at 是 2026-09-04
   片 C 才新增的 ⇒ 歷史上每一箱都是 NULL ⇒ 母體天生從空的開始長, 沒有「上線第一秒等於歷史全部」那個病。
🛑 空白定義走 public.pcm_js_trim_whitespace() 單一來源 —— 不要在這裡寫第二份。
🛑 它答的是【現況】不是【歷史】, 也答不出「enqueue 一直失敗」那一種。
📌 這個桶今天不可能非零(要寄出去過才進得來, 而寄出去過就代表當時有信箱)——
   而它有一條真實的路:客人行使刪除權之後那兩個信箱被清空。**一個今天不會亮的計數,
   與一個永遠不會亮的計數, 在儀表上長得一樣。這一支是為那一天裝的。**$c$;

REVOKE ALL ON FUNCTION public.get_tracking_corrected_gap_counts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_tracking_corrected_gap_counts()
  FROM anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_tracking_corrected_gap_counts() TO payment_confirmer;

-- ── 收權斷言 + 形狀斷言(逐字鏡像 20260903070000)────────────────
DO $assert$
DECLARE
  v_functions text[] := ARRAY['public.get_tracking_corrected_gap_counts()']::text[];
  r           text;
  v_oid       oid;
  v_acl       text;
  v_extra     text;
  v_shape     jsonb;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    SELECT p.oid, pg_catalog.array_to_string(p.proacl, ',')
      INTO v_oid, v_acl
      FROM pg_catalog.pg_proc p
     WHERE p.oid = pg_catalog.to_regprocedure(r);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '更正信收件人訊號 收權斷言失敗:找不到函式 %(簽名打錯或沒建成)⇒ 拒繼續', r;
    END IF;
    IF v_acl IS NULL THEN
      RAISE EXCEPTION '更正信收件人訊號 收權斷言失敗:% 的 proacl 是 NULL(= 套用預設 ⇒ PUBLIC 可執行)⇒ 拒繼續', r;
    END IF;
    SELECT pg_catalog.string_agg(g.grantee, ', ')
      INTO v_extra
      FROM (
        SELECT pg_catalog.pg_get_userbyid((aclexplode(p.proacl)).grantee) AS grantee
          FROM pg_catalog.pg_proc p
         WHERE p.oid = v_oid
      ) g
     WHERE g.grantee NOT IN ('payment_confirmer', CURRENT_USER);
    IF v_extra IS NOT NULL THEN
      RAISE EXCEPTION '更正信收件人訊號 收權斷言失敗:% 的 EXECUTE 清單多出非預期角色(%)—— 只應有 payment_confirmer;拒繼續', r, v_extra;
    END IF;
    IF v_acl NOT LIKE '%payment_confirmer=%' THEN
      RAISE EXCEPTION '更正信收件人訊號 收權斷言失敗:% 對 payment_confirmer 沒有 EXECUTE(收到 %)⇒ 告警讀不到', r, v_acl;
    END IF;
  END LOOP;

  -- 🔴 形狀斷言:三個鍵一個都不能少 —— 少一個, TS 那側讀到 undefined
  --    ⇒ `?? null` 之後**告警恆不叫**, 而那正是這一支要防的東西。
  v_shape := public.get_tracking_corrected_gap_counts();
  IF v_shape IS NULL
     OR NOT (v_shape ? 'pending_count')
     OR NOT (v_shape ? 'no_recipient_count')
     OR NOT (v_shape ? 'corrected_shipments_total_count') THEN
    RAISE EXCEPTION '更正信收件人訊號 形狀斷言失敗:回傳缺鍵(收到 %)⇒ 告警那側會讀到 undefined 而恆不叫', v_shape;
  END IF;
END
$assert$;

COMMIT;
