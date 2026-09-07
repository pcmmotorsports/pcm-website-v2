-- ⟦mail-RECIPIENTNOTRECHECKED⟧ 甲 顆2 —— **地址變了而被擋下的那封信, 要回得了掃描面。**
--
-- ══ 病灶 ═══════════════════════════════════════════════════════════════════
-- `email_outbox.recipient_email` 是**排信當下凍住**的。客人在排信到寄出之間改了 email
-- ⇒ 寄的時候用列上那個 ⇒ 📌 **整張訂單的資訊寄到一個不再是他的信箱, 而信收不回來。**
-- 碼那一半(`e044a16c8`)已經會擋:比出不同 ⇒ 不寄、標終態 `recipient_stale_at_send`、
-- **並把舊鍵退休成 `{舊鍵}:recipientstale:{id}`**。
-- 🔴 **而擋下來之後它要回得來** —— 那是本支要做的事。少了它, 修法從「寄錯人」變成「不寄」。
--
-- ══ 🔴 原 scope 是 5 張, 開檔之後是 6 張 —— 而第 6 張不一樣 ════════════════
-- 主視窗 A 交辦時說的是「新碼進 5 張 view 放行清單」。**開檔數了才發現不是。**
-- · 五張(`20260907060000` 那五支)**本來就有**放行清單 ⇒ 本支只加一個碼。
-- · 🔴 `pcm_cancelled_email_pending`(`20260905310000:197-200`)**一段都沒有** ——
--   它的 anti-join 是裸的:只問「那一列在不在」, 不看 `last_error_code`、不看 `dedup_key`
--   ⇒ 📌 **退休 dedup_key 對它零作用**;只要那張單有過任何一列 `order_cancelled`,
--     它永遠不再進掃描面 ⇒ **對取消信這一族, skip = 永久丟掉一封信。**
--   ⇒ 而那是 Sean 2026-09-03 拍板那封「**客人唯一一封信**」。
-- ⇒ ✅ **⇒ 本支對第 6 張是【新加一整段】, 不是加一個碼。** 別讓下一個人以為六張本來就長一樣。
--
-- ══ 🛑 這一段最容易漏, 而漏了它守門會繼續印綠 ══════════════════════════════
-- `20260907060000` 檔尾那個 `DO $assert$` **自己帶著一份正對照碼陣列**。
-- 🔴 **少改它 ⇒ 斷言會拿【舊清單】去驗, 而它在你改對之後【繼續印綠】** ——
--    綠的理由是它在看舊的東西。📌 **一個守門自己的分母沒跟著改。**
-- ⇒ 本支的斷言:**正面五碼**(原四碼 + `recipient_stale_at_send`)× **六張**, 一個都不能少。
--
-- ══ 放行判準(逐字沿用 `20260907060000`, 不另立)═════════════════════════════
-- 「這個碼寫下去之後, 下一輪重排算得出【不同的】dedup_key 嗎?」
--   算得出 ⇒ 可放行;算不出 ⇒ 放回掃描面只會每輪撞唯一鍵、永遠插不進去。
-- ✅ `recipient_stale_at_send` **算得出** —— writer 那一支會把鍵退休(見上)。
-- 🔴 **而那正是為什麼碼那一半非退休鍵不可**:五族的 `dedup_key` **一個都不含收件地址**
--    (`orderId` / `{shipmentId}:{orderId}` / `{shipmentId}:{orderId}:{correctedKey}`)
--    ⇒ 不退休就等於「清單上有它, 而它一封都寄不出去」。
--    (匯款族是唯一例外:指紋吃 `recipientEmail` ⇒ 它走自己那條 `bank_order_snapshot_stale`。)
--
-- ══ 它【不保證】什麼(誠實列)══════════════════════════════════════════════
-- ① 本支**不碰 `failed`**(理由見 `20260907060000` 檔頭:會重開 45f 剛關掉的病)。
-- ② 它只保證那些單**回得到掃描面**, 不保證它們會被寄 —— 要不要寄由各自 view 的述詞決定。
-- ③ 🔴 **部署順序是硬的:本支要在【接線那一顆】之前 apply。**
--    反過來 ⇒ 標了終態的列再也排不回來 ⇒ 📌 **安靜地少寄, 而三綠不會紅。**
--    ⚠️ **而 `scripts/view-apply-before-wire-gate.py` 對這個形狀會印【綠】** ——
--      它的版本號從「哪一支 migration【建】了那支 view」推, 而本支是 REPLACE;
--      且它的呼叫端偵測只掃 `apps/**`(檔頭漏洞③明列), 而呼叫端在 `packages/**`。
--      🛑 **那個綠是【它看不到】, 不是【安全】** —— 順序要靠人守。
--
-- 🔵 view 本體**逐字抄自** `20260907060000`(五張)與 `20260905310000`(第六張),
--    本支只注入放行碼與第六張那一段 —— 不順手改任何述詞。

BEGIN;

-- ── 前置閘:六張都要在(不在 ⇒ 停)────────────────────────────────
DO $gate$
DECLARE
  v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'pcm_order_created_email_pending',
    'pcm_shipped_email_pending',
    'pcm_tracking_corrected_email_pending',
    'pcm_unpaid_cancelled_email_pending',
    'pcm_bank_order_created_email_pending',
    'pcm_cancelled_email_pending'
  ] LOOP
    IF to_regclass('public.' || v) IS NULL THEN
      RAISE EXCEPTION '前置閘:% 不存在 ⇒ 本支是 REPLACE, 拒在空氣上建東西', v;
    END IF;
  END LOOP;
END
$gate$;

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
           AND e.event_type = 'order_created'
           -- 🔴🔴 **只擋【不是我們自己跳過的】列**(形狀逐字照 45f `20260906190000` 那一段)。
           --    `COALESCE` 不可省:`last_error_code` 可以是 NULL(pending / sent 的列就是)
           --    ⇒ 少了它 `NULL NOT IN (…)` 回 NULL ⇒ WHERE 當假 ⇒ 🛑 **那些列就不擋了**
           --      ⇒ 📌 **每一輪重寄同一封**, 而那與本支的方向【相反】。
           --    🛑 **`failed` 不在清單裡, 而那是刻意的** —— 放行它會被唯一鍵
           --      `(event_type, dedup_key)` 擋著 ⇒ **每一輪重撈而永遠插不進去** ⇒ 擠掉真的要寄的信。
           --      (那是 45f 檔頭量到的病。死信怎麼救是另一件事 ⇒ 板列 ⟦mail-DEADMAILREQUEUE⟧。)
           --    🔴 **新增 skip 碼時要回來加這裡** —— 五張 view 共用同一份清單, 少一張就等於沒修。
           AND COALESCE(e.last_error_code, '') NOT IN (
                 -- ✅ 放行(這四個碼**有機會**在重排時算出新的 dedup_key ⇒ 插得進去)
                 --    🟡 前兩個是【一定】(skip 那一發自己改鍵);後兩個是【多半】
                 --       —— 匯款指紋在三欄全沒變 / 快照 A→B→A 時會回到同一把鍵。
                 --       那是 45f 既有缺口、非本版新增(裁【甲】), 詳檔頭與 ⟦mail-SKIPKEYNORETIRE⟧。
                 -- 🛑 **要不要放行一個新碼, 判準只有一句**:
                 --    「這個碼寫下去之後, 下一輪重排算得出【不同的】 dedup_key 嗎?」
                 --    算得出 ⇒ 可放行;算不出 ⇒ 放回掃描面只會每輪撞唯一鍵、永遠插不進去,
                 --    要先改鍵。(codex 2026-09-07 12③ must-fix, 主視窗當日裁【甲】)
                 'shipment_voided',
                 'tracking_superseded',
                 'bank_order_not_mailable_at_send',
                 'bank_order_snapshot_stale',
                 -- 🔴 ⟦mail-RECIPIENTNOTRECHECKED⟧ 新增:寄送當下地址已與快照不同 ⇒ 跳過 + 退休鍵。
                 --    放行判準逐字照本清單既有那句:「下一輪重排算得出【不同的】dedup_key 嗎?」
                 --    ⇒ 算得出 —— 因為 `markSkippedRecipientStale` 會把舊鍵改成
                 --      `{舊鍵}:recipientstale:{id}`(`SupabaseEmailOutboxAdapter.ts`)。
                 'recipient_stale_at_send'
                 -- 🛑 不放行(無退休鍵):'order_ineligible' / 'order_ineligible_at_send'
                 --    / 'before_send_cutoff' —— 見板列 ⟦mail-SKIPKEYNORETIRE⟧
               ))
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
           AND e.dedup_key = public.pcm_shipped_email_dedup_key(s.id, o.id)
           -- 🔴🔴 **只擋【不是我們自己跳過的】列**(形狀逐字照 45f `20260906190000` 那一段)。
           --    `COALESCE` 不可省:`last_error_code` 可以是 NULL(pending / sent 的列就是)
           --    ⇒ 少了它 `NULL NOT IN (…)` 回 NULL ⇒ WHERE 當假 ⇒ 🛑 **那些列就不擋了**
           --      ⇒ 📌 **每一輪重寄同一封**, 而那與本支的方向【相反】。
           --    🛑 **`failed` 不在清單裡, 而那是刻意的** —— 放行它會被唯一鍵
           --      `(event_type, dedup_key)` 擋著 ⇒ **每一輪重撈而永遠插不進去** ⇒ 擠掉真的要寄的信。
           --      (那是 45f 檔頭量到的病。死信怎麼救是另一件事 ⇒ 板列 ⟦mail-DEADMAILREQUEUE⟧。)
           --    🔴 **新增 skip 碼時要回來加這裡** —— 五張 view 共用同一份清單, 少一張就等於沒修。
           AND COALESCE(e.last_error_code, '') NOT IN (
                 -- ✅ 放行(這四個碼**有機會**在重排時算出新的 dedup_key ⇒ 插得進去)
                 --    🟡 前兩個是【一定】(skip 那一發自己改鍵);後兩個是【多半】
                 --       —— 匯款指紋在三欄全沒變 / 快照 A→B→A 時會回到同一把鍵。
                 --       那是 45f 既有缺口、非本版新增(裁【甲】), 詳檔頭與 ⟦mail-SKIPKEYNORETIRE⟧。
                 -- 🛑 **要不要放行一個新碼, 判準只有一句**:
                 --    「這個碼寫下去之後, 下一輪重排算得出【不同的】 dedup_key 嗎?」
                 --    算得出 ⇒ 可放行;算不出 ⇒ 放回掃描面只會每輪撞唯一鍵、永遠插不進去,
                 --    要先改鍵。(codex 2026-09-07 12③ must-fix, 主視窗當日裁【甲】)
                 'shipment_voided',
                 'tracking_superseded',
                 'bank_order_not_mailable_at_send',
                 'bank_order_snapshot_stale',
                 -- 🔴 ⟦mail-RECIPIENTNOTRECHECKED⟧ 新增:寄送當下地址已與快照不同 ⇒ 跳過 + 退休鍵。
                 --    放行判準逐字照本清單既有那句:「下一輪重排算得出【不同的】dedup_key 嗎?」
                 --    ⇒ 算得出 —— 因為 `markSkippedRecipientStale` 會把舊鍵改成
                 --      `{舊鍵}:recipientstale:{id}`(`SupabaseEmailOutboxAdapter.ts`)。
                 'recipient_stale_at_send'
                 -- 🛑 不放行(無退休鍵):'order_ineligible' / 'order_ineligible_at_send'
                 --    / 'before_send_cutoff' —— 見板列 ⟦mail-SKIPKEYNORETIRE⟧
               ))
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
           AND e.dedup_key = public.pcm_tracking_corrected_dedup_key(s.id, o.id, s.tracking_corrected_at)
           -- 🔴🔴 **只擋【不是我們自己跳過的】列**(形狀逐字照 45f `20260906190000` 那一段)。
           --    `COALESCE` 不可省:`last_error_code` 可以是 NULL(pending / sent 的列就是)
           --    ⇒ 少了它 `NULL NOT IN (…)` 回 NULL ⇒ WHERE 當假 ⇒ 🛑 **那些列就不擋了**
           --      ⇒ 📌 **每一輪重寄同一封**, 而那與本支的方向【相反】。
           --    🛑 **`failed` 不在清單裡, 而那是刻意的** —— 放行它會被唯一鍵
           --      `(event_type, dedup_key)` 擋著 ⇒ **每一輪重撈而永遠插不進去** ⇒ 擠掉真的要寄的信。
           --      (那是 45f 檔頭量到的病。死信怎麼救是另一件事 ⇒ 板列 ⟦mail-DEADMAILREQUEUE⟧。)
           --    🔴 **新增 skip 碼時要回來加這裡** —— 五張 view 共用同一份清單, 少一張就等於沒修。
           AND COALESCE(e.last_error_code, '') NOT IN (
                 -- ✅ 放行(這四個碼**有機會**在重排時算出新的 dedup_key ⇒ 插得進去)
                 --    🟡 前兩個是【一定】(skip 那一發自己改鍵);後兩個是【多半】
                 --       —— 匯款指紋在三欄全沒變 / 快照 A→B→A 時會回到同一把鍵。
                 --       那是 45f 既有缺口、非本版新增(裁【甲】), 詳檔頭與 ⟦mail-SKIPKEYNORETIRE⟧。
                 -- 🛑 **要不要放行一個新碼, 判準只有一句**:
                 --    「這個碼寫下去之後, 下一輪重排算得出【不同的】 dedup_key 嗎?」
                 --    算得出 ⇒ 可放行;算不出 ⇒ 放回掃描面只會每輪撞唯一鍵、永遠插不進去,
                 --    要先改鍵。(codex 2026-09-07 12③ must-fix, 主視窗當日裁【甲】)
                 'shipment_voided',
                 'tracking_superseded',
                 'bank_order_not_mailable_at_send',
                 'bank_order_snapshot_stale',
                 -- 🔴 ⟦mail-RECIPIENTNOTRECHECKED⟧ 新增:寄送當下地址已與快照不同 ⇒ 跳過 + 退休鍵。
                 --    放行判準逐字照本清單既有那句:「下一輪重排算得出【不同的】dedup_key 嗎?」
                 --    ⇒ 算得出 —— 因為 `markSkippedRecipientStale` 會把舊鍵改成
                 --      `{舊鍵}:recipientstale:{id}`(`SupabaseEmailOutboxAdapter.ts`)。
                 'recipient_stale_at_send'
                 -- 🛑 不放行(無退休鍵):'order_ineligible' / 'order_ineligible_at_send'
                 --    / 'before_send_cutoff' —— 見板列 ⟦mail-SKIPKEYNORETIRE⟧
               ))
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
           AND e.event_type = 'order_unpaid_cancelled'
           -- 🔴🔴 **只擋【不是我們自己跳過的】列**(形狀逐字照 45f `20260906190000` 那一段)。
           --    `COALESCE` 不可省:`last_error_code` 可以是 NULL(pending / sent 的列就是)
           --    ⇒ 少了它 `NULL NOT IN (…)` 回 NULL ⇒ WHERE 當假 ⇒ 🛑 **那些列就不擋了**
           --      ⇒ 📌 **每一輪重寄同一封**, 而那與本支的方向【相反】。
           --    🛑 **`failed` 不在清單裡, 而那是刻意的** —— 放行它會被唯一鍵
           --      `(event_type, dedup_key)` 擋著 ⇒ **每一輪重撈而永遠插不進去** ⇒ 擠掉真的要寄的信。
           --      (那是 45f 檔頭量到的病。死信怎麼救是另一件事 ⇒ 板列 ⟦mail-DEADMAILREQUEUE⟧。)
           --    🔴 **新增 skip 碼時要回來加這裡** —— 五張 view 共用同一份清單, 少一張就等於沒修。
           AND COALESCE(e.last_error_code, '') NOT IN (
                 -- ✅ 放行(這四個碼**有機會**在重排時算出新的 dedup_key ⇒ 插得進去)
                 --    🟡 前兩個是【一定】(skip 那一發自己改鍵);後兩個是【多半】
                 --       —— 匯款指紋在三欄全沒變 / 快照 A→B→A 時會回到同一把鍵。
                 --       那是 45f 既有缺口、非本版新增(裁【甲】), 詳檔頭與 ⟦mail-SKIPKEYNORETIRE⟧。
                 -- 🛑 **要不要放行一個新碼, 判準只有一句**:
                 --    「這個碼寫下去之後, 下一輪重排算得出【不同的】 dedup_key 嗎?」
                 --    算得出 ⇒ 可放行;算不出 ⇒ 放回掃描面只會每輪撞唯一鍵、永遠插不進去,
                 --    要先改鍵。(codex 2026-09-07 12③ must-fix, 主視窗當日裁【甲】)
                 'shipment_voided',
                 'tracking_superseded',
                 'bank_order_not_mailable_at_send',
                 'bank_order_snapshot_stale',
                 -- 🔴 ⟦mail-RECIPIENTNOTRECHECKED⟧ 新增:寄送當下地址已與快照不同 ⇒ 跳過 + 退休鍵。
                 --    放行判準逐字照本清單既有那句:「下一輪重排算得出【不同的】dedup_key 嗎?」
                 --    ⇒ 算得出 —— 因為 `markSkippedRecipientStale` 會把舊鍵改成
                 --      `{舊鍵}:recipientstale:{id}`(`SupabaseEmailOutboxAdapter.ts`)。
                 'recipient_stale_at_send'
                 -- 🛑 不放行(無退休鍵):'order_ineligible' / 'order_ineligible_at_send'
                 --    / 'before_send_cutoff' —— 見板列 ⟦mail-SKIPKEYNORETIRE⟧
               ))
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
           -- 🔴 **2026-09-07 拉齊成【五張共用的同一份清單】** —— ⛔ ~~只列 bank 那兩個~~。
           --    📌 主視窗 B 逐字:「別留兩份」—— 兩份清單會分岔, 而分岔時沒有東西會叫。
           --    🛑 **`failed` 仍然不在裡面**(45f 的理由沒有變:唯一鍵擋著 ⇒ 每輪重撈而永遠插不進去)。
           AND COALESCE(e.last_error_code, '') NOT IN (
                 -- ✅ 放行(這四個碼**有機會**在重排時算出新的 dedup_key ⇒ 插得進去)
                 --    🟡 前兩個是【一定】(skip 那一發自己改鍵);後兩個是【多半】
                 --       —— 匯款指紋在三欄全沒變 / 快照 A→B→A 時會回到同一把鍵。
                 --       那是 45f 既有缺口、非本版新增(裁【甲】), 詳檔頭與 ⟦mail-SKIPKEYNORETIRE⟧。
                 -- 🛑 **要不要放行一個新碼, 判準只有一句**:
                 --    「這個碼寫下去之後, 下一輪重排算得出【不同的】 dedup_key 嗎?」
                 --    算得出 ⇒ 可放行;算不出 ⇒ 放回掃描面只會每輪撞唯一鍵、永遠插不進去,
                 --    要先改鍵。(codex 2026-09-07 12③ must-fix, 主視窗當日裁【甲】)
                 'shipment_voided',
                 'tracking_superseded',
                 'bank_order_not_mailable_at_send',
                 'bank_order_snapshot_stale',
                 -- 🔴 ⟦mail-RECIPIENTNOTRECHECKED⟧ 新增:寄送當下地址已與快照不同 ⇒ 跳過 + 退休鍵。
                 --    放行判準逐字照本清單既有那句:「下一輪重排算得出【不同的】dedup_key 嗎?」
                 --    ⇒ 算得出 —— 因為 `markSkippedRecipientStale` 會把舊鍵改成
                 --      `{舊鍵}:recipientstale:{id}`(`SupabaseEmailOutboxAdapter.ts`)。
                 'recipient_stale_at_send'
                 -- 🛑 不放行(無退休鍵):'order_ineligible' / 'order_ineligible_at_send'
                 --    / 'before_send_cutoff' —— 見板列 ⟦mail-SKIPKEYNORETIRE⟧
               ));

CREATE OR REPLACE VIEW public.pcm_cancelled_email_pending
  WITH (security_invoker = true) AS
SELECT
  o.id                 AS order_id,
  o.display_id         AS display_id,
  o.cancelled_at       AS cancelled_at,
  o.cancelled_reason   AS cancelled_reason,
  o.created_at         AS created_at,
  o.notification_email AS notification_email,
  c.email              AS customer_email,
  o.order_source       AS order_source,
  -- 🔴 退款金額 = **回到那張卡的錢**, 算式住在上面那支函式裡, 這裡只呼叫。
  --    ⛔ ~~原本這裡對齊狀態機的 `v_moved`(卡 + 人工)~~ ⇒ 主視窗 2026-09-05 **改裁甲**:
  --       信那句宣稱的是那張卡, 人工現金不算。理由全文在函式上面那段。
  r.card_refunded      AS refunded_amount,
  -- 🔴 `refund_kind` **算出來, 不寫死** —— 本 view 的射程已經是 `payment_status='refunded'`
  --    ⇒ 它「應該」恆為 'full';而**寫死等於讓兩把尺各說各的**。
  --    ⇒ ✅ 判準 = **卡上退滿了沒**(`card_refunded >= o.total`)⇒ 🛑 **卡上沒退滿就印 'partial',
  --       而模板對 'partial' 是【那句與那個數字都不印】** —— fail-closed, 不會說一句可能是謊的話。
  --    🔵 而 view 射程已是 `payment_status='refunded'` ⇒ 它「應該」恆為 'full';
  --       印出 'partial' 就是【狀態機說全額退了, 而卡上沒有】的訊號 —— 那正是要看見的東西。
  CASE WHEN r.card_refunded >= o.total THEN 'full' ELSE 'partial' END AS refund_kind
FROM public.orders o
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
-- 🔴 body 裡**一個 `sum(` 都沒有** —— 算式只有一份, 在那支函式裡(自證②b 釘這件事)。
CROSS JOIN LATERAL (SELECT public.pcm_order_card_refunded(o.id) AS card_refunded) r
-- 🔴🔴 **`payment_method` 不是 `payment_channel` —— 而這是 DB 自己的 COMMENT 講的。**
--   ⛔ ~~本支第一版寫 `payment_channel = 'tappay'`~~(codex R2 ④ 抓到, 開檔查證屬實)
--   🛑 `20260712203000:87` 的 `COMMENT ON COLUMN public.orders.payment_channel` **逐字**:
--      「管理/預期收款管道(建單時定、admin 可改);算實收金額用 payment_method+payment_status,
--       **勿用本欄**」
--   ⇒ 📌 `payment_channel` 是【打算怎麼收】, `payment_method` 是【實際怎麼收的】(付款成功時寫)。
--   ⇒ 而本 view 要答的是「**這筆錢會退回哪裡**」—— 那是事實軸, 不是預期軸。
--   🔴 具體失敗情境:建單時 channel 填 tappay、客人實際付現金 ⇒ 舊版會掃進來
--      ⇒ 信說「全額退回**原付款方式**」而那張卡從來沒被扣過。
--   ⚠️ **反向的代價明寫**:`payment_method` 可為 NULL(建表 `20260604120000:109` nullable)
--      ⇒ 欄沒寫到的舊單會**掉出掃描面 = 不寄信**。而那是 fail-closed 的方向,
--      與本片其餘每一格一致:**寧可不寄, 不寄一封說錯錢的信。**
WHERE o.payment_method = 'tappay'
  AND o.payment_status = 'refunded'
  AND o.cancelled_at IS NOT NULL
  -- ══ 🔴🔴 混合退款的單【整張不寄】(主視窗 2026-09-05 裁 Q2 乙;codex R2 ③)══════════
  --   失敗情境(量過, 探針格6f):總額 5000、卡退 4000、**現金退 1000**
  --   ⇒ 狀態機的 `v_moved`(卡 + 人工)= 5000 ⇒ 它把 `payment_status` 翻成 `'refunded'`
  --   ⇒ 這張單進得了掃描面, 而 `card_refunded` 只有 4000 ⇒ `kind = 'partial'`
  --   ⇒ 🛑 模板對 `'partial'` 是**那句與那個數字都不印**
  --     ⇒ 📌 **客人收到一封【完全沒提到退款】的取消信** —— 而他的錢確實退了。
  --   ⇒ ⇒ 而 outbox 的 anti-join ⇒ **日後卡上補退滿, 也不會再寄。**
  --   ✅ 裁示:這類單**整張不寄**, 等人工處理(板列寫著「這類單要人工寄」)。
  -- 🔵 判準用「有沒有未作廢的人工退款」, **不是**比金額 —— 比金額會把
  --    「人工退款 0 元」這種列當成沒有, 而它仍然代表**這張單走過別條軌**。
  -- ⚠️ 它與 `refund_kind` 是**兩道不同的閘**, 不是重複:
  --    這一條擋【混合軌】, `refund_kind` 擋【純卡而沒退滿】。兩者失敗情境不同, 都要留。
  AND NOT EXISTS (
        SELECT 1 FROM public.order_manual_refunds m
         WHERE m.order_id = o.id
           AND m.voided_at IS NULL)
  -- 🔴🔴 ⟦mail-RECIPIENTNOTRECHECKED⟧ **這一段是本支【新加】的, 另外五張本來就有。**
  --    ⛔ ~~原本這裡是裸的 anti-join~~ —— 它**只問「那一列在不在」**,
  --      不看 `last_error_code`、也不看 `dedup_key`
  --      ⇒ 📌 **只要那張單有過任何一列 `order_cancelled`, 它永遠不再進掃描面** ——
  --        **退休 dedup_key 對它零作用。**
  --    🛑 而取消信是 Sean 2026-09-03 拍板那封「**客人唯一一封信**」
  --      ⇒ 對這一族, 寄送當下的 skip 等於**永久丟掉它**, 而不是「下一輪重排」。
  --    ✅ ⇒ 補上與另外五張**逐字相同**的放行段。
  -- 🔵 **語意要與那五張一樣窄, 不因為它是新加的就寬一點** —— 兩套規則比一套錯的規則糟。
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.order_id = o.id
           AND e.event_type = 'order_cancelled'
           -- `COALESCE` 不可省:`last_error_code` 可以是 NULL(pending / sent 的列就是)
           -- ⇒ 少了它 `NULL NOT IN (…)` 回 NULL ⇒ WHERE 當假 ⇒ 那些列就不擋了
           -- ⇒ 📌 **每一輪重寄同一封**, 而那與本支的方向【相反】。
           AND COALESCE(e.last_error_code, '') NOT IN (
                 'shipment_voided',
                 'tracking_superseded',
                 'bank_order_not_mailable_at_send',
                 'bank_order_snapshot_stale',
                 'recipient_stale_at_send'
               ))
  AND (
        nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      )
  AND (
        -- 🔴 `NULL NOT IN (…)` 回 NULL(不是 true)⇒ WHERE 當假 ⇒ 來源不明的單會被【排除】。
        --    而 TS 那半對 `null` 是【照舊寄】⇒ 兩層會給相反的答案 ⇒ 這一格對齊 TS 的 fail 方向。
        o.order_source IS NULL
     OR o.order_source NOT IN ('manual_phone', 'manual_line', 'manual_other')
     OR nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      );

-- ── 事後斷言:六張都帶【放行五碼】, 而放行段不含 failed 也不含【無退休鍵那三碼】──
-- 🔴 **正對照陣列多了 `recipient_stale_at_send`** —— 少改它, 斷言會拿舊清單驗而繼續印綠。
-- 🔴 **視野從五張變六張** —— 少改它, 第六張改沒改都不會被問到。
-- ⚠️ 射程誠實寫:`pg_get_viewdef` 可能改寫 SQL, 而本段比的是【字面出現】不是結構
--    ⇒ 它擋得住「少一個碼 / 多一個不該放行的碼」, 擋不住「NOT IN 被改成 IN」。
DO $assert$
DECLARE
  v text;
  d text;
  c text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'pcm_order_created_email_pending',
    'pcm_shipped_email_pending',
    'pcm_tracking_corrected_email_pending',
    'pcm_unpaid_cancelled_email_pending',
    'pcm_bank_order_created_email_pending',
    'pcm_cancelled_email_pending'
  ] LOOP
    d := pg_catalog.pg_get_viewdef(('public.' || v)::pg_catalog.regclass, true);

    -- ✅ 正面:放行五碼一個都不能少(少一個 ⇒ 那一族單子仍然永久出不來)
    FOREACH c IN ARRAY ARRAY[
      'shipment_voided',
      'tracking_superseded',
      'bank_order_not_mailable_at_send',
      'bank_order_snapshot_stale',
      'recipient_stale_at_send'
    ] LOOP
      IF pg_catalog.strpos(d, '''' || c || '''') = 0 THEN
        RAISE EXCEPTION '斷言:% 的定義裡缺放行碼 % ⇒ 六張沒有共用同一份清單', v, c;
      END IF;
    END LOOP;

    -- 🛑 反面:這四個一個都不能出現在定義裡
    --    · failed 是【狀態】不是碼, 而放行它會被唯一鍵擋著每輪重撈(45f 檔頭量到的病)
    --    · 另外三個是【無退休鍵】的 skip 碼 ⇒ 放回掃描面同樣撞唯一鍵插不進去
    FOREACH c IN ARRAY ARRAY[
      'failed',
      'order_ineligible',
      'order_ineligible_at_send',
      'before_send_cutoff'
    ] LOOP
      IF pg_catalog.strpos(d, '''' || c || '''') > 0 THEN
        RAISE EXCEPTION '斷言:% 的定義裡出現了 %(放行它會撞唯一鍵而永遠插不進去)⇒ 拒繼續', v, c;
      END IF;
    END LOOP;
  END LOOP;
END
$assert$;

-- ── EXECUTE 事後斷言(invoker-view-execute-gate 要的那一條)────────────────
-- 🔴 這六張是 `security_invoker` 的 view ⇒ **裡面那幾支函式是用【查它的人】的權限跑的**。
--    view 建得起來、七道靜態全綠、三世界全對 —— 而如果那支函式的 EXECUTE 被收掉過,
--    **查它的人一次錯一次**, 而本 migration 不會有任何症狀。
-- 🔵 為什麼是 `service_role`:這六張 view 的 SELECT 只授給 `service_role`(+ owner)
--    ⇒ **實際會走進這些函式的就是它**。斷言問的是【量到的結果】, 不是我寫了 GRANT。
-- 🔵 反向那格不是裝飾:`anon` **必須叫不動** —— 少了它, 一個「順手 GRANT TO PUBLIC」
--    的改動會讓正向四格照樣全綠。
-- 🛑 `anon` 不存在的環境:反向那格是【沒有讀數】不是【通過】 —— 印出來, 不靜默。
-- ⚠️ 五支逐條寫開、簽章寫成字面, 是刻意的:迴圈把名字放進陣列時,
--    `scripts/invoker-view-execute-gate.py` 的尺(只看 `has_function_privilege(` 之後 200 字)
--    **抽不到那些名字** ⇒ 它會判「這支檔沒有斷言」。⇒ 尺看得到, 是這條斷言的一部分。
DO $exec$
DECLARE
  v_has_anon boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') INTO v_has_anon;
  IF NOT v_has_anon THEN
    RAISE NOTICE '🔵 本環境沒有 anon 角色 ⇒ 反向那五格【沒有讀數】, 不是通過';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
           'service_role', 'public.pcm_js_trim_whitespace()'::pg_catalog.regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '斷言:service_role 叫不動 public.pcm_js_trim_whitespace() ⇒ invoker view 會在【查的時候】才錯, 拒繼續';
  END IF;
  IF v_has_anon AND pg_catalog.has_function_privilege(
           'anon', 'public.pcm_js_trim_whitespace()'::pg_catalog.regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '斷言(反向):anon 竟然叫得動 public.pcm_js_trim_whitespace() ⇒ 那不是本支要的授權面, 拒繼續';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
           'service_role', 'public.pcm_shipped_email_dedup_key(uuid, uuid)'::pg_catalog.regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '斷言:service_role 叫不動 public.pcm_shipped_email_dedup_key(uuid, uuid) ⇒ invoker view 會在【查的時候】才錯, 拒繼續';
  END IF;
  IF v_has_anon AND pg_catalog.has_function_privilege(
           'anon', 'public.pcm_shipped_email_dedup_key(uuid, uuid)'::pg_catalog.regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '斷言(反向):anon 竟然叫得動 public.pcm_shipped_email_dedup_key(uuid, uuid) ⇒ 那不是本支要的授權面, 拒繼續';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
           'service_role', 'public.pcm_tracking_corrected_at_key(timestamptz)'::pg_catalog.regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '斷言:service_role 叫不動 public.pcm_tracking_corrected_at_key(timestamptz) ⇒ invoker view 會在【查的時候】才錯, 拒繼續';
  END IF;
  IF v_has_anon AND pg_catalog.has_function_privilege(
           'anon', 'public.pcm_tracking_corrected_at_key(timestamptz)'::pg_catalog.regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '斷言(反向):anon 竟然叫得動 public.pcm_tracking_corrected_at_key(timestamptz) ⇒ 那不是本支要的授權面, 拒繼續';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
           'service_role', 'public.pcm_tracking_corrected_dedup_key(uuid, uuid, timestamptz)'::pg_catalog.regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '斷言:service_role 叫不動 public.pcm_tracking_corrected_dedup_key(uuid, uuid, timestamptz) ⇒ invoker view 會在【查的時候】才錯, 拒繼續';
  END IF;
  IF v_has_anon AND pg_catalog.has_function_privilege(
           'anon', 'public.pcm_tracking_corrected_dedup_key(uuid, uuid, timestamptz)'::pg_catalog.regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '斷言(反向):anon 竟然叫得動 public.pcm_tracking_corrected_dedup_key(uuid, uuid, timestamptz) ⇒ 那不是本支要的授權面, 拒繼續';
  END IF;
  -- 🔴 **本支比 `20260907060000` 多這一支** —— 它是第 6 張 view
  --    (`pcm_cancelled_email_pending`)帶進來的, 那五張裡沒有。
  --    簽章 `uuid` 取自 `20260905310000:108` 的 `CREATE FUNCTION`, 不是憑印象打的。
  IF NOT pg_catalog.has_function_privilege(
           'service_role', 'public.pcm_order_card_refunded(uuid)'::pg_catalog.regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '斷言:service_role 叫不動 public.pcm_order_card_refunded(uuid) ⇒ invoker view 會在【查的時候】才錯, 拒繼續';
  END IF;
  IF v_has_anon AND pg_catalog.has_function_privilege(
           'anon', 'public.pcm_order_card_refunded(uuid)'::pg_catalog.regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '斷言(反向):anon 竟然叫得動 public.pcm_order_card_refunded(uuid) ⇒ 那不是本支要的授權面, 拒繼續';
  END IF;

END
$exec$;

COMMIT;
