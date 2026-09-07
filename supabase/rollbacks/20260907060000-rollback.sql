-- 回退貼板 74:把五張排信掃描面**還原成貼 74 之前的定義**。
--
-- 🔴🔴 **這一支【不是 DROP】—— 那五張 view 在貼 74 之前就已經存在。**
--    74 做的是 `CREATE OR REPLACE`(改 anti-join 的 skip-code 白名單), 不是新建;
--    它自己的**前置閘**逐字要求「五張都要在, 不在 ⇒ 停」(`20260907060000:83-86`)。
--    ⇒ 📌 **`DROP VIEW` 五句會把整個掃描面刪掉 ⇒ 六種信全部停排, 而那比 74 本身的風險大得多。**
--    (`latest-definition-of.sh` 逐支撈:四張共 4-5 代、匯款那張 4 代 ⇒ **每一張都有上一代**。)
--
-- ══ 這一支的內容是【逐字取自上一代】, 不是重打 ═════════════════════════════
--   · 四張取自 `20260905210000_m4b_manual_no_email_off_scan_surface.sql`
--     (行 109-157 / 159-211 / 213-277 / 279-313)
--   · 匯款那張取自 `20260906190000_m4b_bank_order_pending_skips_rearmable.sql`(行 68-91)
--   🔵 **產生方式**:用程式從那兩支檔按行號切出來, **沒有經過人手重打**。
--
-- ══ 🛑 回退之後會怎樣 ════════════════════════════════════════════════════
--   回到「anti-join 只問【那一列在不在】」的行為 ⇒ **我們自己判定不該寄而寫下的 `skipped_*` 列,
--   會再度把那張單永久趕出掃描面**(那正是 74 要修的病)。
--   ⇒ 📌 **回退是止血不是修好** —— 回退之後那個病回來了, 要記得它還在。
--
-- ══ 前置閘 ══════════════════════════════════════════════════════════════

BEGIN;

DO $gate$
DECLARE
  v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'pcm_order_created_email_pending',
    'pcm_shipped_email_pending',
    'pcm_tracking_corrected_email_pending',
    'pcm_unpaid_cancelled_email_pending',
    'pcm_bank_order_created_email_pending'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = v AND c.relkind = 'v'
    ) THEN
      RAISE EXCEPTION '前置閘:找不到 view public.% ⇒ 沒有東西可回退(74 沒貼, 或已回退過)', v;
    END IF;
  END LOOP;
END
$gate$;


-- ── pcm_order_created_email_pending —— 逐字取自 20260905210000_m4b_manual_no_email_off_scan_surface.sql 行 109-157 ──
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

-- ── pcm_shipped_email_pending —— 逐字取自 20260905210000_m4b_manual_no_email_off_scan_surface.sql 行 159-211 ──
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

-- ── pcm_tracking_corrected_email_pending —— 逐字取自 20260905210000_m4b_manual_no_email_off_scan_surface.sql 行 213-277 ──
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

-- ── pcm_unpaid_cancelled_email_pending —— 逐字取自 20260905210000_m4b_manual_no_email_off_scan_surface.sql 行 279-313 ──
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

-- ── pcm_bank_order_created_email_pending —— 逐字取自 20260906190000_m4b_bank_order_pending_skips_rearmable.sql 行 68-91 ──
CREATE OR REPLACE VIEW public.pcm_bank_order_created_email_pending
  WITH (security_invoker = false, security_barrier = true) AS
SELECT
  m.order_id           AS order_id,
  m.display_id         AS display_id,
  m.created_at         AS created_at,
  m.total              AS total,
  m.balance_due        AS balance_due,
  m.notification_email AS notification_email,
  m.customer_email     AS customer_email,
  m.order_source       AS order_source
FROM public.pcm_bank_order_still_mailable m
WHERE NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.order_id = m.order_id
           AND e.event_type = 'bank_order_created'
           -- 🔴🔴 **只有【不是我們自己跳過的】列才擋。**
           --    `COALESCE` 不可省:`last_error_code` 可以是 NULL(pending / sent 的列就是)
           --    ⇒ 少了它, `NULL NOT IN (…)` 回 NULL ⇒ WHERE 當假 ⇒ 🛑 **那些列就不擋了**
           --    ⇒ 📌 **每一輪重寄同一封**, 而那與本支要修的方向【相反】。
           AND COALESCE(e.last_error_code, '') NOT IN (
                 'bank_order_not_mailable_at_send',
                 'bank_order_snapshot_stale'
               ));


-- ══ 事後斷言:五張都回到【貼 74 之前】的樣子 ══════════════════════════════
-- 🔴🔴 **這一段第一版寫錯了, 而是這段自己抓到的 —— 留著當紀錄**:
--    我原本斷言「四個放行碼一個都不剩」, 而**匯款那張的上一代本來就有兩個**
--    (`20260906190000` = 45f, 它就是把那兩個碼放進去的那一支)
--    ⇒ 貼回上一代之後它們**應該還在**, 那才是「貼 74 之前的樣子」。
--    ⇒ 📌 **回退的驗收條件不是「什麼都沒有」, 是【回到上一代那個樣子】** —— 兩者不同。
--    🔵 而第一版跑起來直接 RAISE ⇒ 整個交易回捲 ⇒ **沒有留下半套的狀態**。
DO $assert$
DECLARE
  d text;
  v text;
  c text;
BEGIN
  -- ① 四張(非匯款):`shipment_voided` / `tracking_superseded` / 匯款那兩碼 **一個都不該有**
  FOREACH v IN ARRAY ARRAY[
    'pcm_order_created_email_pending',
    'pcm_shipped_email_pending',
    'pcm_tracking_corrected_email_pending',
    'pcm_unpaid_cancelled_email_pending'
  ] LOOP
    d := pg_catalog.pg_get_viewdef(('public.' || v)::pg_catalog.regclass, true);
    FOREACH c IN ARRAY ARRAY[
      'shipment_voided',
      'tracking_superseded',
      'bank_order_not_mailable_at_send',
      'bank_order_snapshot_stale'
    ] LOOP
      IF pg_catalog.strpos(d, pg_catalog.quote_literal(c)) > 0 THEN
        RAISE EXCEPTION '斷言:% 的定義裡還有放行碼 % ⇒ 這一張沒有回退成功, 拒繼續', v, c;
      END IF;
    END LOOP;
  END LOOP;

  -- ② 匯款那張:它的上一代(45f)**本來就有自己那兩個碼** ⇒ 回退後應該【還在】
  d := pg_catalog.pg_get_viewdef('public.pcm_bank_order_created_email_pending'::pg_catalog.regclass, true);
  FOREACH c IN ARRAY ARRAY['bank_order_not_mailable_at_send', 'bank_order_snapshot_stale'] LOOP
    IF pg_catalog.strpos(d, pg_catalog.quote_literal(c)) = 0 THEN
      RAISE EXCEPTION '斷言:匯款那張回退後少了它上一代本來就有的碼 % ⇒ 回退回錯版本, 拒繼續', c;
    END IF;
  END LOOP;
  -- 🔵 反向:而 74 才加給它的那兩個(出貨 / 更正)**不該留下**
  FOREACH c IN ARRAY ARRAY['shipment_voided', 'tracking_superseded'] LOOP
    IF pg_catalog.strpos(d, pg_catalog.quote_literal(c)) > 0 THEN
      RAISE EXCEPTION '斷言:匯款那張還留著 74 才加的碼 % ⇒ 沒有回退成功, 拒繼續', c;
    END IF;
  END LOOP;
END
$assert$;

COMMIT;
