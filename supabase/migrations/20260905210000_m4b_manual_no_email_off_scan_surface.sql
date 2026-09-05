-- ⟦f3-MAILFALLBACKVSRULING⟧ 片 C-2 —— **讓「手動留白」的單離開掃描面。**
--
-- ══ 這一支在解什麼(它是片 C 造出來的病, 不是既有的)══════════════════════
-- 片 C 讓四支 use-case 對「`manual_*` 而且 `notification_email` 為空」判**不寄**
-- ⇒ 🔴 **不寫任何 outbox 列**。
-- 而這三支 pending view 的收錄條件是「兩個信箱**至少一個**非空」
-- ⇒ `customers.email` 非空時,那一列**照樣被收進來**;而 anti-join 靠 outbox 有沒有列
-- ⇒ 🛑 **每一輪重撈, 永遠。**
-- ⚠️ 而 cutoff 是**上線那一刻的固定戳**(不是滾動視窗)⇒ **它不會隨時間老化掉。**
-- ⇒ 掃描一輪有上限 ⇒ **卡住的列穩定累積, 而真的要寄的信被擠出前幾名。**
--
-- 🔴 **它不報錯、不進死信、心跳照綠**;而 `get_order_created_gap_counts` 的
--    `no_recipient_count` 要求**兩個信箱都空** ⇒ **數不到這一族**。
-- 📌 **⇒ 那正是 `pcm_order_created_email_pending` 自己 COMMENT 逐字寫著的那個病**
--    (「累積到上限就把名額佔滿, 讓真的要寄的信擠不進來」)——
--    **而片 C 造出了一個【符合 Sean 拍板常態】的新族群去撞它。**
--
-- ✅ **修法照 `⟦b4-NORECIPIENTWINDOW⟧ 甲` 那個形狀** —— repo 為同一個病已經選過一次:
--    **不在掃描面裡數它們, 讓它們不進來。**
--
-- ══ 🔴 它與片 C 是【同一批】, 不得單獨上線 ═════════════════════════════════
-- 只貼本支而片 C 的碼沒上 ⇒ 那些單被排除在掃描面外, 而 use-case 仍會退回 `customers.email`
-- ⇒ 🛑 **等於悄悄把「手動留白也照寄」變成「手動留白不寄, 而且沒有人知道為什麼」** ——
--    行為對了, 而**理由不在碼裡**。⇒ 兩者同一批落。
--
-- ══ ⚠️ 本支【不動】unpaid_cancelled ═══════════════════════════════════════
-- 那一支自己的檔頭已經自陳同型缺口(它的 cutoff 那一條會漏信), 而它是**另一個題目**。
-- 🛑 順手把它一起改, 會把一個已經被寫下來的已知缺口**變成一個沒有人再讀的段落**。
--
-- ══ 🛑 而它【證不到】什麼 ═══════════════════════════════════════════════
-- · 值域(三個 `manual_*`)在這裡與 `packages/domain/src/order/notification-fallback.ts`
--   **各有一份** ⇒ 兩份會各自漂,而**今天沒有機械守門把它們綁在一起**。這是誠實揭示, 不是免責。
-- · 它讓那些單**離開掃描面**, 而**不記錄「有幾張這樣的單」** ——
--   要那個數字, 去查 `orders` 本身(`order_source` LIKE manual 且 `notification_email` 為空)。

BEGIN;

-- ── 前置閘 ──────────────────────────────────────────────────────
DO $$
DECLARE v_missing text;
BEGIN
  SELECT pg_catalog.string_agg(x.n, ', ') INTO v_missing
    FROM (VALUES ('pcm_order_created_email_pending'),
                 ('pcm_shipped_email_pending'),
                 ('pcm_tracking_corrected_email_pending')) AS x(n)
   WHERE pg_catalog.to_regclass('public.' || x.n) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '前置閘:這些 view 不存在 ⇒ %', v_missing;
  END IF;

  -- 🔴 而「view 在」不等於「它有 order_source 那一欄」—— 本支的述詞要讀那一欄。
  SELECT pg_catalog.string_agg(x.n, ', ') INTO v_missing
    FROM (VALUES ('pcm_order_created_email_pending'),
                 ('pcm_shipped_email_pending'),
                 ('pcm_tracking_corrected_email_pending')) AS x(n)
   WHERE NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_attribute a
            WHERE a.attrelid = ('public.' || x.n)::regclass
              AND a.attname = 'order_source' AND a.attnum > 0 AND NOT a.attisdropped);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '前置閘:這些 view 沒有 order_source 欄 ⇒ %  (20260905080000 還沒貼)', v_missing;
  END IF;

  IF pg_catalog.to_regprocedure('public.pcm_js_trim_whitespace()') IS NULL THEN
    RAISE EXCEPTION '前置閘:找不到 public.pcm_js_trim_whitespace()';
  END IF;
END $$;

CREATE OR REPLACE VIEW public.pcm_order_created_email_pending
  WITH (security_invoker = true) AS
SELECT
  o.id                 AS order_id,
  o.display_id         AS display_id,
  o.paid_at            AS paid_at,
  o.created_at         AS created_at,
  o.notification_email AS notification_email,
  c.email              AS customer_email,
  o.order_source       AS order_source
FROM public.orders o
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE o.payment_status = 'paid'
  AND o.cancelled_at IS NULL
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.order_id = o.id
           AND e.event_type = 'order_created')
  AND (
        nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      )
  -- 🔴🔴 **手動建單留白 = 不寄 ⇒ 讓它【離開掃描面】**(片 C-2;R6 抓到的那個病)
  --    片 C 讓 use-case 對「manual_* 且 notification_email 為空」判不寄 ⇒ **不寫任何 outbox 列**,
  --    而本 view 的收錄條件是「兩個信箱至少一個非空」⇒ `customers.email` 非空時它【照樣被收進來】
  --    ⇒ 而 anti-join 靠 outbox 有沒有列 ⇒ 🛑 **每一輪重撈, 永遠。**
  --    ⚠️ 而 cutoff 是上線那一刻的**固定戳**(不是滾動視窗)⇒ 它不會隨時間老化掉
  --    ⇒ 掃描一輪有上限 ⇒ **卡住的列穩定累積, 而真的要寄的信被擠出去。**
  --    📌 **那正是本 view 自己 COMMENT 逐字寫著的那個病** —— 而片 C 造出了一個
  --       【符合 Sean 拍板常態】的新族群去撞它。
  -- ✅ 修法照 `⟦b4-NORECIPIENTWINDOW⟧ 甲` 那個形狀:**不在掃描面裡數它們, 讓它們不進來。**
  -- 🛑 值域**具名列出**, 不用 `LIKE 'manual\_%'` —— 前綴比對會讓一個未來的
  --    `manual_whatever` 靜靜地拿到「可以不寄」這個行為, 而沒有人決定過它。
  --    (與 `packages/domain/src/order/notification-fallback.ts` 同一組值, 而**那是兩份** ——
  --     🔴 兩份會各自漂, 而今天沒有機械守門把它們綁在一起。這一句是誠實揭示, 不是免責。)
  AND (
        o.order_source NOT IN ('manual_phone', 'manual_line', 'manual_other')
     OR nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      )
;

CREATE OR REPLACE VIEW public.pcm_shipped_email_pending
  WITH (security_invoker = true) AS
SELECT DISTINCT
  s.id                 AS shipment_id,
  s.shipment_reference AS shipment_reference,
  s.shipped_at         AS shipped_at,
  o.id                 AS order_id,
  o.display_id         AS display_id,
  o.notification_email AS notification_email,
  c.email              AS customer_email,
  o.order_source       AS order_source
FROM public.shipments s
JOIN public.shipment_items si ON si.shipment_id = s.id
JOIN public.order_items oi ON oi.id = si.order_item_id
JOIN public.orders o ON o.id = oi.order_id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE s.shipped_at IS NOT NULL
  AND s.deleted_at IS NULL
  AND (
        nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      )
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.event_type = 'order_shipped'
           AND e.dedup_key = public.pcm_shipped_email_dedup_key(s.id, o.id))
  -- 🔴🔴 **手動建單留白 = 不寄 ⇒ 讓它【離開掃描面】**(片 C-2;R6 抓到的那個病)
  --    片 C 讓 use-case 對「manual_* 且 notification_email 為空」判不寄 ⇒ **不寫任何 outbox 列**,
  --    而本 view 的收錄條件是「兩個信箱至少一個非空」⇒ `customers.email` 非空時它【照樣被收進來】
  --    ⇒ 而 anti-join 靠 outbox 有沒有列 ⇒ 🛑 **每一輪重撈, 永遠。**
  --    ⚠️ 而 cutoff 是上線那一刻的**固定戳**(不是滾動視窗)⇒ 它不會隨時間老化掉
  --    ⇒ 掃描一輪有上限 ⇒ **卡住的列穩定累積, 而真的要寄的信被擠出去。**
  --    📌 **那正是本 view 自己 COMMENT 逐字寫著的那個病** —— 而片 C 造出了一個
  --       【符合 Sean 拍板常態】的新族群去撞它。
  -- ✅ 修法照 `⟦b4-NORECIPIENTWINDOW⟧ 甲` 那個形狀:**不在掃描面裡數它們, 讓它們不進來。**
  -- 🛑 值域**具名列出**, 不用 `LIKE 'manual\_%'` —— 前綴比對會讓一個未來的
  --    `manual_whatever` 靜靜地拿到「可以不寄」這個行為, 而沒有人決定過它。
  --    (與 `packages/domain/src/order/notification-fallback.ts` 同一組值, 而**那是兩份** ——
  --     🔴 兩份會各自漂, 而今天沒有機械守門把它們綁在一起。這一句是誠實揭示, 不是免責。)
  AND (
        o.order_source NOT IN ('manual_phone', 'manual_line', 'manual_other')
     OR nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      )
;

CREATE OR REPLACE VIEW public.pcm_tracking_corrected_email_pending
  WITH (security_invoker = true) AS
SELECT DISTINCT
  s.id                  AS shipment_id,
  s.shipment_reference  AS shipment_reference,
  s.tracking_number     AS tracking_number,
  s.carrier_code        AS carrier_code,
  s.tracking_corrected_at AS tracking_corrected_at,
  public.pcm_tracking_corrected_at_key(s.tracking_corrected_at) AS corrected_at_key,
  o.id                  AS order_id,
  o.display_id          AS display_id,
  o.notification_email  AS notification_email,
  c.email               AS customer_email,
  o.order_source        AS order_source
FROM public.shipments s
JOIN public.shipment_items si ON si.shipment_id = s.id
JOIN public.order_items oi ON oi.id = si.order_item_id
JOIN public.orders o ON o.id = oi.order_id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE s.shipped_at IS NOT NULL
  AND s.deleted_at IS NULL
  AND s.tracking_corrected_at IS NOT NULL
  AND nullif(pg_catalog.btrim(s.tracking_number, public.pcm_js_trim_whitespace()), '') IS NOT NULL
  AND (
        nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      )
  AND EXISTS (
        SELECT 1 FROM public.email_outbox e0
         WHERE e0.event_type = 'order_shipped'
           AND e0.dedup_key = public.pcm_shipped_email_dedup_key(s.id, o.id)
           AND e0.status = 'sent'
           AND e0.sent_at IS NOT NULL
           AND e0.sent_at < s.tracking_corrected_at)
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.event_type = 'shipment_tracking_corrected'
           AND e.dedup_key = public.pcm_tracking_corrected_dedup_key(s.id, o.id, s.tracking_corrected_at))
  -- 🔴🔴 **手動建單留白 = 不寄 ⇒ 讓它【離開掃描面】**(片 C-2;R6 抓到的那個病)
  --    片 C 讓 use-case 對「manual_* 且 notification_email 為空」判不寄 ⇒ **不寫任何 outbox 列**,
  --    而本 view 的收錄條件是「兩個信箱至少一個非空」⇒ `customers.email` 非空時它【照樣被收進來】
  --    ⇒ 而 anti-join 靠 outbox 有沒有列 ⇒ 🛑 **每一輪重撈, 永遠。**
  --    ⚠️ 而 cutoff 是上線那一刻的**固定戳**(不是滾動視窗)⇒ 它不會隨時間老化掉
  --    ⇒ 掃描一輪有上限 ⇒ **卡住的列穩定累積, 而真的要寄的信被擠出去。**
  --    📌 **那正是本 view 自己 COMMENT 逐字寫著的那個病** —— 而片 C 造出了一個
  --       【符合 Sean 拍板常態】的新族群去撞它。
  -- ✅ 修法照 `⟦b4-NORECIPIENTWINDOW⟧ 甲` 那個形狀:**不在掃描面裡數它們, 讓它們不進來。**
  -- 🛑 值域**具名列出**, 不用 `LIKE 'manual\_%'` —— 前綴比對會讓一個未來的
  --    `manual_whatever` 靜靜地拿到「可以不寄」這個行為, 而沒有人決定過它。
  --    (與 `packages/domain/src/order/notification-fallback.ts` 同一組值, 而**那是兩份** ——
  --     🔴 兩份會各自漂, 而今天沒有機械守門把它們綁在一起。這一句是誠實揭示, 不是免責。)
  AND (
        o.order_source NOT IN ('manual_phone', 'manual_line', 'manual_other')
     OR nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      )
;

-- ── ACL 重述(防漂移;REPLACE 本身不重設 ACL)──────────────────────
REVOKE ALL ON public.pcm_order_created_email_pending      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.pcm_shipped_email_pending            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.pcm_tracking_corrected_email_pending FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pcm_order_created_email_pending      TO service_role;
GRANT SELECT ON public.pcm_shipped_email_pending            TO service_role;
GRANT SELECT ON public.pcm_tracking_corrected_email_pending TO service_role;
-- 🔴 security_invoker ⇒ view 內的函式用【呼叫者】權限跑
GRANT EXECUTE ON FUNCTION public.pcm_js_trim_whitespace() TO service_role;

-- ── 貼上去當場自證 ──────────────────────────────────────────────
DO $$
DECLARE
  v_n   integer;
  v_bad text;
BEGIN
  -- ① 三支的定義裡都要有那個述詞。
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'v'
     AND c.relname IN ('pcm_order_created_email_pending','pcm_shipped_email_pending',
                       'pcm_tracking_corrected_email_pending')
     AND pg_catalog.pg_get_viewdef(c.oid, true) LIKE '%manual_phone%';
  IF v_n <> 3 THEN
    RAISE EXCEPTION '自證①:只有 % 支帶那個述詞(應為 3)', v_n;
  END IF;

  -- 🔴 ② 三個值都要在 —— 只有 manual_phone 的話, 另兩種來源會靜靜地繼續卡在掃描面上。
  SELECT pg_catalog.string_agg(c.relname, ', ') INTO v_bad
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'v'
     AND c.relname IN ('pcm_order_created_email_pending','pcm_shipped_email_pending',
                       'pcm_tracking_corrected_email_pending')
     AND NOT (pg_catalog.pg_get_viewdef(c.oid, true) LIKE '%manual_line%'
          AND pg_catalog.pg_get_viewdef(c.oid, true) LIKE '%manual_other%');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '自證②:這幾支只列了一部分 manual_* 值 ⇒ %', v_bad;
  END IF;

  -- 🔴🔴 invoker view 的 EXECUTE 事後斷言(`invoker-view-execute-gate` 逼出來的)。
  --    這三支是 `security_invoker = true` ⇒ **body 裡的函式用【呼叫者】的權限跑**。
  --    ⇒ GRANT 是【我寫的動作】,斷言才是【量到的結果】—— 兩者不是同一件事。
  --    🛑 四條**逐字寫開,不用迴圈** —— 那道閘的字面尺是
  --       `has_function_privilege( … '<fn>' … )`,名字在變數裡它撈不到(080000 踩過一次)。
  IF NOT pg_catalog.has_function_privilege(
           'service_role', 'public.pcm_js_trim_whitespace()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '自證④:service_role 叫不動 public.pcm_js_trim_whitespace() ⇒ 這三個 invoker view 會查一次錯一次';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
           'service_role', 'public.pcm_shipped_email_dedup_key(uuid,uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '自證④:service_role 叫不動 public.pcm_shipped_email_dedup_key()';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
           'service_role', 'public.pcm_tracking_corrected_at_key(timestamptz)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '自證④:service_role 叫不動 public.pcm_tracking_corrected_at_key()';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
           'service_role', 'public.pcm_tracking_corrected_dedup_key(uuid,uuid,timestamptz)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '自證④:service_role 叫不動 public.pcm_tracking_corrected_dedup_key()';
  END IF;

  -- 🔴 而「service_role 叫得動」只答了一半 —— 另一半是「anon 叫不動」。
  --    🔬 正式庫 2026-09-05 唯讀實查:四支 anon 全 f、service_role 全 t。
  IF pg_catalog.has_function_privilege(
       'anon', 'public.pcm_js_trim_whitespace()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '自證⑤:anon 叫得動 public.pcm_js_trim_whitespace() ⇒ invoker view 的函式對外開著';
  END IF;
  IF pg_catalog.has_function_privilege(
       'anon', 'public.pcm_shipped_email_dedup_key(uuid,uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '自證⑤:anon 叫得動 public.pcm_shipped_email_dedup_key()';
  END IF;
  IF pg_catalog.has_function_privilege(
       'anon', 'public.pcm_tracking_corrected_at_key(timestamptz)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '自證⑤:anon 叫得動 public.pcm_tracking_corrected_at_key()';
  END IF;
  IF pg_catalog.has_function_privilege(
       'anon', 'public.pcm_tracking_corrected_dedup_key(uuid,uuid,timestamptz)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '自證⑤:anon 叫得動 public.pcm_tracking_corrected_dedup_key()';
  END IF;

  -- 🔵 負對照:一個現造的來源值必須【不在】任何一支的定義裡。
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'v'
     AND c.relname IN ('pcm_order_created_email_pending','pcm_shipped_email_pending',
                       'pcm_tracking_corrected_email_pending')
     AND pg_catalog.pg_get_viewdef(c.oid, true) LIKE '%zzz_never_a_source%';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '負對照紅了:這把尺對任何字面都印命中 ⇒ 上面兩格不算數';
  END IF;

  -- ③ ACL:三支對 anon / authenticated 都不得可讀(含欄級)。
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'v'
     AND c.relname IN ('pcm_order_created_email_pending','pcm_shipped_email_pending',
                       'pcm_tracking_corrected_email_pending')
     AND (pg_catalog.has_any_column_privilege('anon', c.oid, 'SELECT')
       OR pg_catalog.has_any_column_privilege('authenticated', c.oid, 'SELECT'));
  IF v_n <> 0 THEN
    RAISE EXCEPTION '自證③:有 % 支對 anon/authenticated 開著(它們含 PII 兩個 email 欄)', v_n;
  END IF;
END $$;

COMMIT;

-- ══ ROLLBACK ═══════════════════════════════════════════════════════════════
-- 回退 = 把這三支 `CREATE OR REPLACE VIEW` 回 `20260905080000` 那一版(刪掉本支加的那段 AND)。
-- 🔵 **欄位集合沒變** ⇒ 這一次 `CREATE OR REPLACE` **夠用**, 不必 DROP
--    (與 080000 的回退不同 —— 那一支是【加欄】, 減欄才要 DROP)。
-- 🛑 **而回退要與片 C 的碼一起退** —— 只退本支而 use-case 仍判「不寄」
--    ⇒ 那些單回到掃描面、而仍然沒有人寫 outbox 列 ⇒ **病原封不動回來。**
