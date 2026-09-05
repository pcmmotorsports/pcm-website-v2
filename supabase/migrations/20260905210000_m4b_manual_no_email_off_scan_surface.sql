-- ⟦f3-MAILFALLBACKVSRULING⟧ 片 C-2 —— **讓「手動留白」的單離開掃描面。**
--
-- ══ 這一支在解什麼(它是片 C 造出來的病, 不是既有的)══════════════════════
-- 片 C 讓四支 use-case 對「`manual_*` 而且 `notification_email` 為空」判**不寄**
-- ⇒ 🔴 **不寫任何 outbox 列**。
-- 而這四支 pending view 的收錄條件是「兩個信箱**至少一個**非空」
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
-- ══ 🔴🔴 三者的順序寫死(codex ⑥:「同一批」不是可執行的指示)═══════════════
-- ```
-- ① 20260905180000(兜底掃描器)     ← 它與本支無依賴, 而它排前面(既有順序)
-- ② 20260905210000(本支)           ← 貼板 19 號
-- ③ 片 C 的碼(agent/line-mail, 走部署)
-- ```
-- 🔴 **②必須在③之前**:③先上而②沒貼 ⇒ 那些單開始**累積在掃描面上**(本支要解的病)。
-- 🔵 而**②先貼而③沒上** ⇒ 結果是對的(不寄)而**理由不在碼裡** ⇒ 軟傷。
-- 📌 **兩個順序都不完美, 而只有一個會【累積東西】。**
-- 🔵 今天兩個都無害 —— 正式庫手動單**總共 0 張**(唯讀量過)。這是寫給第一張手動單之後的人看的。
--
-- ══ ⚠️ 排除**不是永久決策**(codex ⑦ / R2 ⑦:⛔ ~~明寫接受~~ ⇒ **等 Sean 拍板**)══
-- 一張被排除的單, 之後**補填了信箱**(或 `order_source` 被改)⇒ 它**會回到掃描面**。
-- 而 cutoff 是**上線那一刻的固定戳** ⇒ 🔴 **那張單當初漏掉的那些事件會【一次補寄】。**
-- 🛑 **本片【不做】逐事件的「已選擇不寄」狀態** —— 那要一張新表 + 一套寫入端, 是另一片。
-- 🔴🔴 ⛔ ~~✅ 我們接受它~~ —— **那不是我們可以接受的**(codex R2 ⑦, 而它是對的):
--    「補填信箱之後要不要把那些歷史通知一次寄出去」是**對客人可見、不可回收**的行為
--    ⇒ 鐵則 12 ⑤ ⇒ 📌 **那是 Sean 的板, 不是我們的「已知接受」。**
--    🛑 **一個由我們自己寫下的「我們接受」, 讀起來與一筆拍板一模一樣** —— 而它沒有作者。
-- ⏳ **狀態:已端給 Sean, 等他答。**兩個選項各要動什麼:
--    甲 補寄(= 今天這支檔的行為):**零改動**;要做的是把它寫進客服/後台話術
--       ——「補填信箱之前先知道:這張單過去漏掉的通知會一次寄出」。
--    乙 不補寄:要**一張新表**(單 + 事件種類 + 決定時間)+ **四支 pending view 各再加一條
--       `NOT EXISTS`** + **一個寫入端**(誰在什麼時候寫進那張表)⇒ 一支新 migration、
--       四支 view 再改一次;`packages/` 那半不動。
-- 🔵 而**今天兩個選項的實際差別是 0** —— 正式庫手動單總共 0 張(唯讀量過)。
-- ⚠️ **而「一次補寄歷史通知」對客人看起來像系統壞了** ——
--    ⇒ 📌 這一段要留著:第一個遇到它的人才知道那不是 bug, 是這裡決定過的。

-- ══ 🔴 它與片 C 是【同一批】, 不得單獨上線 ═════════════════════════════════
-- 只貼本支而片 C 的碼沒上 ⇒ 那些單被排除在掃描面外, 而 use-case 仍會退回 `customers.email`
-- ⇒ 🛑 **等於悄悄把「手動留白也照寄」變成「手動留白不寄, 而且沒有人知道為什麼」** ——
--    行為對了, 而**理由不在碼裡**。⇒ 兩者同一批落。
--
-- ══ 🔴🔴 四支【全部】都改 —— 而我原本只改三支 ═════════════════════════════
-- ⛔ ~~本支不動 `unpaid_cancelled`:那一支自己已自陳同型缺口, 它是另一個題目~~
-- **那個決定被 codex 推翻, 而它是對的**:`unpaid_cancelled` 的收錄條件同樣是
-- 「兩個信箱至少一個非空」+ anti-join 靠 outbox ⇒ **同一族手動留白的單照樣每輪重撈、永不寫 outbox**
-- ⇒ 🛑 **它正是本片要消的那個阻塞, 而我把它留在原地。**
-- 📌 **我當時的理由(「不要把一個已寫下的已知缺口變成沒有人再讀的段落」)講的是【另一件事】** ——
--    那支檔自陳的是**它的 cutoff 會漏信**, 與本片要解的**掃描面阻塞**是兩個病。
--    ⇒ 一個成立的理由, 被我拿去擋一件它沒有涵蓋的事。
--
-- ══ 🛑 而它【證不到】什麼 ═══════════════════════════════════════════════
-- · 值域(三個 `manual_*`)在這裡與 `packages/domain/src/order/notification-fallback.ts`
--   **各有一份** ⇒ ⛔ ~~今天沒有機械守門把它們綁在一起~~ **已經有了**(codex ③ 升成 must-fix):
--   `packages/domain/src/order/notification-fallback-sql-parity.test.ts` **讀本檔的字面**去比 TS 陣列
--   ⇒ 🧬 突變驗過:把本檔任一個值改掉 ⇒ 那一格紅。
--   ⚠️ **而它綁的是【本檔】, 不是「正式庫現在跑的那一版」** —— 有人再開一支新 migration
--   改掉那個述詞, 它看不到。那一格是已知缺口, 不是漏掉。
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
                 ('pcm_tracking_corrected_email_pending'),
                 ('pcm_unpaid_cancelled_email_pending')) AS x(n)
   WHERE pg_catalog.to_regclass('public.' || x.n) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '前置閘:這些 view 不存在 ⇒ %', v_missing;
  END IF;

  -- 🔴 而「view 在」不等於「它有 order_source 那一欄」—— 本支的述詞要讀那一欄。
  SELECT pg_catalog.string_agg(x.n, ', ') INTO v_missing
    FROM (VALUES ('pcm_order_created_email_pending'),
                 ('pcm_shipped_email_pending'),
                 ('pcm_tracking_corrected_email_pending'),
                 ('pcm_unpaid_cancelled_email_pending')) AS x(n)
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
        -- 🔴🔴 **codex ②:`o.order_source IS NULL` 這一格【非加不可】。**
        --    `NULL NOT IN (…)` 回的是 **NULL**(不是 true)⇒ `NULL OR false` = NULL
        --    ⇒ WHERE 當假 ⇒ 🛑 **來源不明的單會被【排除】**。
        --    而 TS 那半(`notification-fallback.ts`)對 `null` 的判斷是 **照舊寄**
        --    ⇒ 📌 **兩層對同一個世界給相反的答案, 而 SQL 那半贏(它先篩掉)。**
        --    ⇒ ✅ 對齊 TS 的 fail 方向:**不知道來源 ⇒ 留在掃描面上(照舊寄)。**
        --       理由是不對稱的:**多寄一封信看得見, 少寄一封看不見。**
        --    🔬 當場問過:`SELECT (NULL::text NOT IN ('a','b')) IS NULL` ⇒ **t**。
        o.order_source IS NULL
     OR o.order_source NOT IN ('manual_phone', 'manual_line', 'manual_other')
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
        -- 🔴🔴 **codex ②:`o.order_source IS NULL` 這一格【非加不可】。**
        --    `NULL NOT IN (…)` 回的是 **NULL**(不是 true)⇒ `NULL OR false` = NULL
        --    ⇒ WHERE 當假 ⇒ 🛑 **來源不明的單會被【排除】**。
        --    而 TS 那半(`notification-fallback.ts`)對 `null` 的判斷是 **照舊寄**
        --    ⇒ 📌 **兩層對同一個世界給相反的答案, 而 SQL 那半贏(它先篩掉)。**
        --    ⇒ ✅ 對齊 TS 的 fail 方向:**不知道來源 ⇒ 留在掃描面上(照舊寄)。**
        --       理由是不對稱的:**多寄一封信看得見, 少寄一封看不見。**
        --    🔬 當場問過:`SELECT (NULL::text NOT IN ('a','b')) IS NULL` ⇒ **t**。
        o.order_source IS NULL
     OR o.order_source NOT IN ('manual_phone', 'manual_line', 'manual_other')
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
        -- 🔴🔴 **codex ②:`o.order_source IS NULL` 這一格【非加不可】。**
        --    `NULL NOT IN (…)` 回的是 **NULL**(不是 true)⇒ `NULL OR false` = NULL
        --    ⇒ WHERE 當假 ⇒ 🛑 **來源不明的單會被【排除】**。
        --    而 TS 那半(`notification-fallback.ts`)對 `null` 的判斷是 **照舊寄**
        --    ⇒ 📌 **兩層對同一個世界給相反的答案, 而 SQL 那半贏(它先篩掉)。**
        --    ⇒ ✅ 對齊 TS 的 fail 方向:**不知道來源 ⇒ 留在掃描面上(照舊寄)。**
        --       理由是不對稱的:**多寄一封信看得見, 少寄一封看不見。**
        --    🔬 當場問過:`SELECT (NULL::text NOT IN ('a','b')) IS NULL` ⇒ **t**。
        o.order_source IS NULL
     OR o.order_source NOT IN ('manual_phone', 'manual_line', 'manual_other')
     OR nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      )
;

CREATE OR REPLACE VIEW public.pcm_unpaid_cancelled_email_pending
  WITH (security_invoker = true) AS
SELECT
  o.id                 AS order_id,
  o.display_id         AS display_id,
  o.cancelled_at       AS cancelled_at,
  o.cancelled_reason   AS cancelled_reason,
  o.created_at         AS created_at,
  o.notification_email AS notification_email,
  c.email              AS customer_email,
  o.order_source       AS order_source
FROM public.orders o
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE o.payment_status = 'unpaid'
  AND o.cancelled_at IS NOT NULL
  AND EXISTS (
        SELECT 1 FROM public.order_cancellations oc
         WHERE oc.order_id = o.id)
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.order_id = o.id
           AND e.event_type = 'order_unpaid_cancelled')
  AND (
        nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      )
  AND (
        -- 🔴🔴 **codex ②:`o.order_source IS NULL` 這一格【非加不可】。**
        --    `NULL NOT IN (…)` 回的是 **NULL**(不是 true)⇒ WHERE 當假 ⇒ 來源不明的單被【排除】,
        --    而 TS 那半對 `null` 是**照舊寄** ⇒ 兩層對同一個世界給相反的答案。
        --    ⇒ ✅ 對齊 TS:**不知道來源 ⇒ 留在掃描面上。**(多寄一封看得見, 少寄一封看不見。)
        o.order_source IS NULL
     OR o.order_source NOT IN ('manual_phone', 'manual_line', 'manual_other')
     OR nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      );

-- ══ 🔴🔴 codex ⑤:被排除的那些單【要數得到】═══════════════════════════════
-- 上面那四支把「手動 + 留白」排除在掃描面外 ⇒ 它們**既沒有 outbox 紀錄, 也不進 no-recipient 計數**
-- ⇒ 🛑 **大量手動單留白時, 心跳與 gap 全綠, 而沒有任何一個數字說得出這件事在發生。**
-- ✅ 形狀照出貨線的 `pcm_shipped_email_unsendable`(080000 檔頭逐字:
--    「出貨線當初要另一個 view 是為了**看得見**」)—— **離開掃描面, 而不是消失。**
-- ⚠️ 而它**只是一個可查的清單**, 今天**沒有人在讀它**(接進 gap_counts / 儀表是下一片)。
--    📌 這一句明寫, 不假裝它已經有人看。
-- ══ 🔴🔴 codex R2 ①:上一版只判「手動 + 留白」⇒ 它把【本來就不在掃描面上的單】也算進來 ═══
--    (還沒付款的 / 兩個信箱都空的 / 已經有 outbox 的)⇒ 📌 **統計虛高, 而虛高的方向是**
--    「看起來被我們排除掉很多」⇒ 🛑 有人拿它去判「這個決定影響多大」時會判過頭。
-- ✅ 修法:**與四支 pending view 的【其餘述詞】同形** —— 一支 UNION ALL,
--    每一塊 = 那支 pending view 的 WHERE **減掉手動那一段**, 再交集「手動 + 留白」。
--    ⇒ 一列 = 「這張單(這批出貨)本來會進【哪一支】掃描面, 而被本片拿掉了」。
-- 🔴 值域**只寫一次**(下面那個 CTE)—— 上一版每一支 view 各一份, 五份會各自漂。
-- 🛑 而**述詞仍然是抄的**(四支 pending 各一份, 這裡再一份)⇒ **它們會漂**,
--    而今天沒有機械守門把「本 view 的第 N 塊」與「第 N 支 pending view」綁在一起。
--    ⚠️ 漂掉的症狀:這張表少列或多列 —— **它不會讓信寄錯**, 它只會讓數字說錯話。
--    📌 這是**已知缺口**, 不是漏掉。要補的話那是另一片(把四支 pending 的述詞抽成函式)。
-- 🔴 `CREATE`(裸的, 不是 `OR REPLACE`)—— codex R2 ③:新物件用 `OR REPLACE`
--    ⇒ 撞名時**靜默覆蓋**別人的東西, 而 apply 是綠的。(180000 已經踩過同一條。)
CREATE VIEW public.pcm_manual_no_email_excluded
  WITH (security_invoker = true) AS
WITH manual_blank AS (
  -- 🔴 **這是本檔第五份、也是最後一份值域** —— `notification-fallback-sql-parity.test.ts`
  --    把它與 TS 那份綁在一起(codex R2 ②)。
  SELECT o.id AS order_id
    FROM public.orders o
   WHERE o.order_source IN ('manual_phone', 'manual_line', 'manual_other')
     AND nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NULL
)
-- ① 本來會進 pcm_order_created_email_pending 的
SELECT
  'order_created'::text AS surface,
  o.id                  AS order_id,
  o.display_id          AS display_id,
  o.order_source        AS order_source,
  NULL::text            AS shipment_id,
  NULL::text            AS corrected_at_key
FROM public.orders o
JOIN manual_blank mb ON mb.order_id = o.id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE o.payment_status = 'paid'
  AND o.cancelled_at IS NULL
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.order_id = o.id
           AND e.event_type = 'order_created')
  AND nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL

UNION ALL

-- ② 本來會進 pcm_shipped_email_pending 的(一批出貨一列, 不是一張單一列)
SELECT DISTINCT
  'order_shipped'::text,
  o.id,
  o.display_id,
  o.order_source,
  s.id::text,
  NULL::text
FROM public.shipments s
JOIN public.shipment_items si ON si.shipment_id = s.id
JOIN public.order_items oi ON oi.id = si.order_item_id
JOIN public.orders o ON o.id = oi.order_id
JOIN manual_blank mb ON mb.order_id = o.id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE s.shipped_at IS NOT NULL
  AND s.deleted_at IS NULL
  AND nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.event_type = 'order_shipped'
           AND e.dedup_key = public.pcm_shipped_email_dedup_key(s.id, o.id))

UNION ALL

-- ③ 本來會進 pcm_tracking_corrected_email_pending 的
SELECT DISTINCT
  'shipment_tracking_corrected'::text,
  o.id,
  o.display_id,
  o.order_source,
  s.id::text,
  public.pcm_tracking_corrected_at_key(s.tracking_corrected_at)::text
FROM public.shipments s
JOIN public.shipment_items si ON si.shipment_id = s.id
JOIN public.order_items oi ON oi.id = si.order_item_id
JOIN public.orders o ON o.id = oi.order_id
JOIN manual_blank mb ON mb.order_id = o.id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE s.shipped_at IS NOT NULL
  AND s.deleted_at IS NULL
  AND s.tracking_corrected_at IS NOT NULL
  AND nullif(pg_catalog.btrim(s.tracking_number, public.pcm_js_trim_whitespace()), '') IS NOT NULL
  AND nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
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

UNION ALL

-- ④ 本來會進 pcm_unpaid_cancelled_email_pending 的
SELECT
  'order_unpaid_cancelled'::text,
  o.id,
  o.display_id,
  o.order_source,
  NULL::text,
  NULL::text
FROM public.orders o
JOIN manual_blank mb ON mb.order_id = o.id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE o.payment_status = 'unpaid'
  AND o.cancelled_at IS NOT NULL
  AND EXISTS (
        SELECT 1 FROM public.order_cancellations oc
         WHERE oc.order_id = o.id)
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.order_id = o.id
           AND e.event_type = 'order_unpaid_cancelled')
  AND nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
;

COMMENT ON VIEW public.pcm_manual_no_email_excluded IS
$c$「後台手動建的單 + 通知信箱留白」——**依 Sean 拍板不寄, 而被本片從四支 pending view 拿掉**的那些單。
🔴 它存在的理由是【看得見】:那些單既沒有 outbox 紀錄、也不進 no_recipient_count
⇒ 沒有這一支的話, 大量手動留白時心跳與 gap 全綠, 而沒有任何數字說得出這件事在發生。
🔴 **一列 = 一個【本來會發生的通知】**, 不是一張單:`surface` 說是哪一支掃描面,
出貨與追蹤更正那兩塊是**一批出貨一列**(`shipment_id` / `corrected_at_key` 才是它們的鍵)。
📌 ⛔ ~~上一版只判「手動 + 留白」~~(codex R2 ①)—— 那會把**本來就不在掃描面上**的單
(未付款 / 兩個信箱皆空 / 已有 outbox)一起算進來 ⇒ **統計虛高**。現在四塊各自對齊那支 view 的述詞。
🛑 而它今天**沒有人在讀**(接進 gap_counts / 儀表是下一片)—— 這一句不要拿掉。
🛑 述詞是**抄**四支 pending view 的 ⇒ **它們會各自漂**, 而今天沒有機械守門綁住。
漂掉時它只會讓**數字說錯話**, 不會讓信寄錯 —— 已知缺口, 不是漏掉。
⚠️ 它不含 `notification_email`(那一欄留白才會進來)也不含 `customers.email` ⇒ 零 PII;
而它仍然只給 service_role —— 訂單編號本身也是資訊。$c$;

REVOKE ALL ON public.pcm_manual_no_email_excluded FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pcm_manual_no_email_excluded TO service_role;

-- ── ACL 重述(防漂移;REPLACE 本身不重設 ACL)──────────────────────
REVOKE ALL ON public.pcm_order_created_email_pending      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.pcm_shipped_email_pending            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.pcm_tracking_corrected_email_pending FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.pcm_unpaid_cancelled_email_pending   FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pcm_order_created_email_pending      TO service_role;
GRANT SELECT ON public.pcm_shipped_email_pending            TO service_role;
GRANT SELECT ON public.pcm_tracking_corrected_email_pending TO service_role;
GRANT SELECT ON public.pcm_unpaid_cancelled_email_pending   TO service_role;
-- 🔴 security_invoker ⇒ view 內的函式用【呼叫者】權限跑
GRANT EXECUTE ON FUNCTION public.pcm_js_trim_whitespace() TO service_role;

-- ── 貼上去當場自證 ──────────────────────────────────────────────
DO $$
DECLARE
  v_n   integer;
  v_bad text;
BEGIN
  -- ⓪ 🔴🔴 **先問「四支都在嗎」**(codex R3 ④)——
  --    下面每一格都是 `count(*) … WHERE relname IN (四個名字)` 的形狀,
  --    🛑 **而少建一支時, 那個 IN 只是少數到一列** ⇒ ①會印 3(看得出來),
  --       而 ③(要求 0)與負對照(要求 0)**照樣印 0** ⇒ 📌 **「少一支」與「全都對」印同一個答案。**
  --    ⇒ 分母要先釘住, 再問分子。
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'v'
     AND c.relname IN ('pcm_order_created_email_pending','pcm_shipped_email_pending',
                       'pcm_tracking_corrected_email_pending','pcm_unpaid_cancelled_email_pending');
  IF v_n <> 4 THEN
    RAISE EXCEPTION '自證⓪:只找到 % 支 pending view(應為 4)⇒ 下面每一格的分母都是錯的', v_n;
  END IF;

  -- ① 【四】支的定義裡都要有那個述詞。(⛔ ~~三支~~ —— 下面那份 IN 清單一直是四個。)
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'v'
     AND c.relname IN ('pcm_order_created_email_pending','pcm_shipped_email_pending',
                       'pcm_tracking_corrected_email_pending','pcm_unpaid_cancelled_email_pending')
     AND pg_catalog.pg_get_viewdef(c.oid, true) LIKE '%manual_phone%';
  IF v_n <> 4 THEN
    RAISE EXCEPTION '自證①:只有 % 支帶那個述詞(應為 4)', v_n;
  END IF;

  -- 🔴 ② 三個值都要在 —— 只有 manual_phone 的話, 另兩種來源會靜靜地繼續卡在掃描面上。
  SELECT pg_catalog.string_agg(c.relname, ', ') INTO v_bad
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'v'
     AND c.relname IN ('pcm_order_created_email_pending','pcm_shipped_email_pending',
                       'pcm_tracking_corrected_email_pending','pcm_unpaid_cancelled_email_pending')
     AND NOT (pg_catalog.pg_get_viewdef(c.oid, true) LIKE '%manual_line%'
          AND pg_catalog.pg_get_viewdef(c.oid, true) LIKE '%manual_other%');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '自證②:這幾支只列了一部分 manual_* 值 ⇒ %', v_bad;
  END IF;

  -- 🔴🔴 invoker view 的 EXECUTE 事後斷言(`invoker-view-execute-gate` 逼出來的)。
  --    這四支是 `security_invoker = true` ⇒ **body 裡的函式用【呼叫者】的權限跑**。
  --    ⇒ GRANT 是【我寫的動作】,斷言才是【量到的結果】—— 兩者不是同一件事。
  --    🛑 四條**逐字寫開,不用迴圈** —— 那道閘的字面尺是
  --       `has_function_privilege( … '<fn>' … )`,名字在變數裡它撈不到(080000 踩過一次)。
  IF NOT pg_catalog.has_function_privilege(
           'service_role', 'public.pcm_js_trim_whitespace()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '自證④:service_role 叫不動 public.pcm_js_trim_whitespace() ⇒ 這四個 invoker view 會查一次錯一次';
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
                       'pcm_tracking_corrected_email_pending','pcm_unpaid_cancelled_email_pending')
     AND pg_catalog.pg_get_viewdef(c.oid, true) LIKE '%zzz_never_a_source%';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '負對照紅了:這把尺對任何字面都印命中 ⇒ 上面兩格不算數';
  END IF;

  -- ③ ACL:【四】支對 anon / authenticated 都不得可讀(含欄級)。(⛔ ~~三支~~)
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'v'
     AND c.relname IN ('pcm_order_created_email_pending','pcm_shipped_email_pending',
                       'pcm_tracking_corrected_email_pending','pcm_unpaid_cancelled_email_pending')
     AND (pg_catalog.has_any_column_privilege('anon', c.oid, 'SELECT')
       OR pg_catalog.has_any_column_privilege('authenticated', c.oid, 'SELECT'));
  IF v_n <> 0 THEN
    RAISE EXCEPTION '自證③:有 % 支對 anon/authenticated 開著(它們含 PII 兩個 email 欄)', v_n;
  END IF;

  -- ⑥ 🔴 **伴生 view 自己**(codex R2 ①/③ 改完之後它換了形狀 —— 而它以前一格都沒有)。
  --    這一格問三件事:它在不在 / 它是不是 invoker / 它的四塊都在不在。
  IF pg_catalog.to_regclass('public.pcm_manual_no_email_excluded') IS NULL THEN
    RAISE EXCEPTION '自證⑥:伴生 view 不存在';
  END IF;
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'pcm_manual_no_email_excluded'
     AND c.reloptions @> ARRAY['security_invoker=true'];
  IF v_n <> 1 THEN
    RAISE EXCEPTION '自證⑥:伴生 view 不是 security_invoker = true';
  END IF;
  -- 🔴 四塊各自的 surface 字面都要在定義裡 —— 少一塊 = 少統計一支掃描面, 而它印的還是一個合理的數字。
  SELECT pg_catalog.string_agg(x, ', ') INTO v_bad FROM (
    SELECT x FROM unnest(ARRAY['order_created','order_shipped',
                               'shipment_tracking_corrected','order_unpaid_cancelled']) AS x
     WHERE pg_catalog.pg_get_viewdef('public.pcm_manual_no_email_excluded'::regclass, true)
           NOT LIKE '%' || x || '%') q;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '自證⑥:伴生 view 少了這幾塊 ⇒ %', v_bad;
  END IF;
  -- 🔵 負對照:同一把尺餵一個一定不在的字面 ⇒ 必須說「少了它」(否則上面那格恆綠)。
  IF pg_catalog.pg_get_viewdef('public.pcm_manual_no_email_excluded'::regclass, true)
     LIKE '%zzz_never_a_surface%' THEN
    RAISE EXCEPTION '負對照紅了:這把尺對任何字面都印命中 ⇒ ⑥ 不算數';
  END IF;
  -- ⑦ ACL:伴生 view 對 anon / authenticated 全關、對 service_role 開。
  IF pg_catalog.has_any_column_privilege('anon', 'public.pcm_manual_no_email_excluded', 'SELECT')
     OR pg_catalog.has_any_column_privilege('authenticated', 'public.pcm_manual_no_email_excluded', 'SELECT') THEN
    RAISE EXCEPTION '自證⑦:伴生 view 對 anon/authenticated 開著';
  END IF;
  IF NOT pg_catalog.has_any_column_privilege('service_role', 'public.pcm_manual_no_email_excluded', 'SELECT') THEN
    RAISE EXCEPTION '自證⑦:service_role 讀不到伴生 view ⇒ 建了等於沒建';
  END IF;
END $$;

COMMIT;

-- ══ ROLLBACK ═══════════════════════════════════════════════════════════════
-- 🔴🔴 **本支動了【四】支, 而且【新增了第五支】** —— ⛔ ~~原本這裡寫「三支」~~
--    (codex R2 ④:一個少算一支的回退說明, 會讓照著做的人留下一支沒退回去的 view,
--     而那支 view 仍然在把單子擋在掃描面外 ⇒ **回退看起來做完了, 而病還在**。)
--
-- ── 回退分兩步, 順序不可換 ────────────────────────────────────────
-- **① 先 DROP 伴生 view**(它是本支【新建】的 ⇒ 回退 = 讓它消失, 不是改它)
-- ```sql
-- DROP VIEW IF EXISTS public.pcm_manual_no_email_excluded;
-- ```
--   🔵 `IF EXISTS` —— 本支若是在建它之前就掛掉, 這一行仍然要跑得過。
--   🛑 DROP 會一起帶走它的 ACL 與 `COMMENT ON` —— **而那正是我們要的**(它整支不留)。
--
-- **② 再把那【四】支 view 回 `20260905080000` 那一版**
-- 🔴🔴 ⛔ ~~原本這裡只寫「回 080000 那一版」~~ —— **那句話【不可執行】**(codex R3 ③):
--    🛑 **重貼整支 `20260905080000` 會被【它自己的前置閘】擋下** ——
--       `20260905080000:66-97` 逐字要求「四個 view 都存在, **而 `order_source` 欄要還沒有**」
--       ⇒ 退的時候那四支**已經有那一欄了** ⇒ 它第一段就 `RAISE EXCEPTION '本支貼過了'`。
--    📌 **一個看起來完整的回退說明, 照著做第一步就停住** —— 而停在半路的回退最糟:
--       伴生 view 已經 DROP 掉了, 而四支 view 還帶著述詞。
-- ✅ **可執行的形狀:只取 080000 裡那四段 view + ACL, 不要整支檔。**
-- ```sh
-- sed -n '/^CREATE OR REPLACE VIEW public\.pcm_order_created_email_pending$/,\
-- /^GRANT EXECUTE ON FUNCTION public\.pcm_js_trim_whitespace() TO service_role;$/p' \
--   supabase/migrations/20260905080000_m4b_pending_views_order_source.sql \
--   > /tmp/rollback-210000.sql
-- ```
-- 🔴 **餵給 psql 之前先數一次**(「我餵幾條 vs 它跑幾支」套在腳本產生這一層):
-- ```sh
-- grep -c '^CREATE OR REPLACE VIEW' /tmp/rollback-210000.sql    # 必須是 4
-- grep -c '^REVOKE ALL ON'          /tmp/rollback-210000.sql    # 必須是 4
-- grep -c '^GRANT SELECT ON'        /tmp/rollback-210000.sql    # 必須是 4
-- ```
--    ⚠️ **不是 4 就停下來** —— 那表示 080000 的字面被改過, 而這段抽取式沒跟著改。
-- 🔴🔴 **而【三族各數 4】仍然答不出「那四個是哪四個」**(codex R5 ②:我上一輪那句話講太滿)——
--    🛑 抽取式若因為 080000 被改而抽到**別支 view 的四套**, 三族照樣印 4/4/4,
--       而**那份錯的 SQL 已經先把別支 view 改掉了**(它是 `CREATE OR REPLACE`)。
--    ⇒ ✅ **名字也要逐一核**(這四行才是回答「是哪四個」的那一格):
-- ```sh
-- for V in pcm_order_created_email_pending pcm_shipped_email_pending \
--          pcm_tracking_corrected_email_pending pcm_unpaid_cancelled_email_pending; do
--   printf '%s CREATE=%s REVOKE=%s GRANT=%s\n' "$V" \
--     "$(grep -c "^CREATE OR REPLACE VIEW public.$V$" /tmp/rollback-210000.sql)" \
--     "$(grep -c "^REVOKE ALL ON public.$V "        /tmp/rollback-210000.sql)" \
--     "$(grep -c "^GRANT SELECT ON public.$V "      /tmp/rollback-210000.sql)"
-- done
-- ```
--    ✅ **四行都要印 `1 1 1`。任何一格不是 1 就停下來。**
--    📌 ⛔ ~~上一輪我在這裡寫「三族各數一次才答得出【那四個是哪四個】」~~ —— **那句話是假的**:
--       數量答的是「有幾個」, 只有**名字**答得出「是哪幾個」。而我把前者說成後者。
--
-- 🔴🔴 **`REVOKE` 那一行是 codex R4 ② 補的, 而它補的是一個【真的洞】**:
--    🔬 實測:把結尾錨那一行刪掉 ⇒ 抽出來的東西少了尾巴, 而 `CREATE=4 / GRANT=4` **照樣印 4/4**;
--       少抽一條 `REVOKE` ⇒ **`CREATE=4 / GRANT=4 / REVOKE=3`** ——
--    🛑 ⇒ **原本那兩行數不到 `REVOKE` 那一族** ⇒ 一份**少了一道 REVOKE 的回退**會通過自檢
--       ⇒ 退完之後那一支 view 對 `anon` 是開的, 而它含兩個 email 欄。
--    📌 **「我量到 4」與「我量對了那四個是哪四個」是兩個宣稱** ——
--       三族各數一次只答得出**第一個問得更細的版本**(哪一族少了);
--       **第二個要靠上面那四行【逐名】核**(codex R5 ② 訂正)。
--    🔵 抽取用的是**文字錨**不是行號:080000 是不可變歷史, 而**錨比行號活得久**。
-- 🔵 那四段本來就是 `CREATE OR REPLACE VIEW` ⇒ **可以直接重跑**, 它們不含前置閘。
-- 🔵 那四支的**欄位集合沒變** ⇒ `CREATE OR REPLACE` **夠用**, 不必 DROP
--    (與 080000 的回退不同 —— 那一支是【加欄】, 減欄才要 DROP)。
-- 🔬 退完自己驗一發(兩個世界會印不同的答案):
-- ```sql
-- SELECT pg_catalog.to_regclass('public.pcm_manual_no_email_excluded') IS NULL AS 伴生已消失,
--        pg_catalog.count(*) FILTER (WHERE pg_catalog.pg_get_viewdef(c.oid, true) LIKE '%manual_phone%')
--          AS 還帶著述詞的支數
--   FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
--  WHERE n.nspname = 'public' AND c.relkind = 'v'
--    AND c.relname IN ('pcm_order_created_email_pending','pcm_shipped_email_pending',
--                      'pcm_tracking_corrected_email_pending','pcm_unpaid_cancelled_email_pending');
-- ```
--   ✅ 退乾淨 = `t` 與 `0`。**任何一個不是, 就是還沒退完。**
-- 🛑 **而回退要與片 C 的碼一起退** —— 只退本支而 use-case 仍判「不寄」
--    ⇒ 那些單回到掃描面、而仍然沒有人寫 outbox 列 ⇒ **病原封不動回來。**
