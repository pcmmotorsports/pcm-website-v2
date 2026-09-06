-- ⟦b4-EMAILTRIAGE⟧ 甲-5 —— **我們自己跳過的那封信, 再也回不來。**
--
-- ══ 病灶 ═══════════════════════════════════════════════════════════════════
-- 五張排信掃描面的 anti-join **只問「那一列在不在」, 不問「它是什麼狀態」**
-- ⇒ 寄送前被我們自己擋下來的那些列(`skipped_*`)也算「已經排過」
-- ⇒ 📌 **後台把那張單修好之後, 那封信【永遠不會再被排一次】。**
--
-- ⚠️ **而 finding 原句要的是別的東西, 那句【被訂正】**:它說「`failed@max` 之後 scanner 不重排」
--    ⇒ 🛑 **放行 `failed` 會重開一個 2026-09-06(45f)才剛關掉的病** ——
--      唯一鍵 `(event_type, dedup_key)` 擋著 ⇒ **每一輪重撈而永遠插不進去** ⇒ 擠掉真的要寄的信。
--    ⇒ ✅ 死信怎麼救是**另一件事**(後台已有 `admin_requeue_dead_email` 那條路)
--      ⇒ 板列 `⟦mail-DEADMAILREQUEUE⟧`。**本支不碰 `failed`。**
--
-- ══ 修法 = 把 45f 的形狀套到全部五張 ═══════════════════════════════════════
-- `20260906190000`(貼板 45f)已經對**匯款那一張**做過這件事:
-- 「只擋【不是我們自己跳過的】列」。本支把它拉到**五張共用同一份清單**。
-- 🔴 **而清單只有一份, 是刻意的**(主視窗 B 2026-09-07 逐字「別留兩份」)——
--    兩份清單會分岔, 而**分岔時沒有任何東西會叫**。
--
-- ══ 🔬 正式庫今天的讀數(唯讀量的, 而它【沒有判別力】)═══════════════════════
-- 出貨信 outbox **2 列全 `sent`** · 卡住/已死 **0 列** · 出貨單 **3 箱** · 全站訂單 **4 張**
-- (🔵 負對照現造事件型別 ⇒ 0)。
-- 🛑 **⇒ 那個 0 是「還沒咬到人」不是「沒有這個 bug」** —— 分母 3 箱。
--    📌 **今天資料量是零, 正是改它最便宜的一天。**
--
-- ══ 🔴🔴 放行清單只有四個, 不是七個(codex 2026-09-07 12③ must-fix, 主視窗當日裁【甲】)══
-- **放回掃描面 ≠ 那封信排得進去。** 下一輪 scanner 撈到之後仍要 `enqueue()`,
-- 而它會撞唯一鍵 `(event_type, dedup_key)`:`resolveUniqueViolation`
-- (`packages/adapters/src/email/SupabaseEmailOutboxAdapter.ts:425`)確認是同事件就回 `duplicate`,
-- **舊列不重啟** ⇒ 📌 **每一輪重撈而永遠插不進去** —— 與放行 `failed` 是同一個病。
--
-- ✅ **放行 · 第一族:鍵【一定】會退休(skip 的那一發 UPDATE 自己改掉 `dedup_key`)**
--    · `shipment_voided` —— `dedup_key: ${currentDedupKey}:voided:${id}`(同上檔 `:859`;方法在 `:764`)
--    · `tracking_superseded` —— `dedup_key: ${currentDedupKey}:superseded:${id}`(`:760`;方法在 `:752`)
--    ⇒ 這兩族退休發生在**寫下 skip 的那一刻**, 與 status 同一發 UPDATE ⇒ 不受交錯順序影響。
--
-- 🟡 **放行 · 第二族:鍵【多半】會退休 —— 而那個「多半」要寫出來, 不是四捨五入成「會」**
--    · `bank_order_not_mailable_at_send`(`:690`)/ `bank_order_snapshot_stale`(`:698`)
--      —— 這兩支**自己不改 `dedup_key`**;鍵會不會變, 取決於**下一輪重排算出來的指紋**:
--         `orderId:sha256(total, balanceDue, recipientEmail)[0:16]`
--         (`packages/adapters/src/email/order-email-assembly.ts:280-293`)
--    🛑 **⇒ 兩種情形會算回【同一把鍵】**(codex `gpt-6-astra` 2026-09-07 R2 打出來的):
--       ① `not_mailable` 之後恢復資格, 而 total / balanceDue / recipientEmail **三欄逐一沒變**
--       ② 快照 A→B→A(中間那一版被跳過, 後來又回到 A)
--       ⇒ 撞舊鍵 ⇒ **每輪重撈而插不進去**, 佔掃描名額。
--    ✅ **而它仍然放行, 是主視窗 B 2026-09-07 裁的【甲】**:這是 `20260906190000`(45f)
--       **已經上線**的既有行為缺口, **不是本版新增**;拿掉它 = 讓匯款那張 view 比現在線上更嚴
--       = 拿一個**沒量過發生率**的缺口去換一個**確定的行為回退**。
--    ⇒ 發生率與修法(退休鍵算式)追在板列 `⟦mail-SKIPKEYNORETIRE⟧` 的第二族。
--
-- 🛑 **不放行(自己不改鍵, 而重排也算不出新的鍵)**
--    · `order_ineligible`(`:662`)/ `order_ineligible_at_send`(`:676`)—— 只改 status 與碼
--    · `before_send_cutoff`
--    ⇒ 修法是改 dedup_key 退休算式, 動六 writer + 五 scanner, **不是本片的體積**
--    ⇒ 板列 `⟦mail-SKIPKEYNORETIRE⟧`(與 `⟦mail-DEADMAILREQUEUE⟧` 互指)
--
-- ══ 🛑 本支證不到什麼 ═════════════════════════════════════════════════════
-- ① 它**不會讓任何一封已經寄出去的信重寄**(`sent` 的列 `last_error_code` 是 NULL ⇒ 仍然擋)。
-- ② 它**不修死信** —— 見上面那句訂正。
-- ③ 它**不保證那些單會再被寄** —— 只保證它們**回得到掃描面**;要不要寄由各自 view 的述詞決定。
-- ④ 🔴 **對 view 1(`order_created`)與 view 4(`order_unpaid_cancelled`)今天是【零行為改變】**
--    —— 它們自己會寫的碼(`order_ineligible*` / `before_send_cutoff`)全在不放行那半。
--    五張仍寫同一份清單是為了**不留兩份會分岔的清單**, 而那一段述詞在它們身上【是活的】:
--    拋棄式 PG 餵一個放行碼進去 ⇒ 兩張都從 0 變 1(世界 D)。
--    🛑 那證明的是「線接上了」, **不是**「有單子會因此回來」。
-- ⑤ 已知窄缺口(誠實列, 不是免責):匯款單取消後又復原, 而 total / balanceDue / recipientEmail
--    三者**逐一相同** ⇒ 指紋不變 ⇒ 鍵不變 ⇒ 那一列仍插不進去。未量測發生率。

BEGIN;

-- ── 前置閘:五張都要在(不在 ⇒ 停)────────────────────────────────
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
      SELECT 1 FROM pg_catalog.pg_views WHERE schemaname = 'public' AND viewname = v)
    THEN
      RAISE EXCEPTION '前置閘:找不到 view public.% ⇒ 它的 migration 還沒貼', v;
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
                 'bank_order_snapshot_stale'
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
                 'bank_order_snapshot_stale'
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
                 'bank_order_snapshot_stale'
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
                 'bank_order_snapshot_stale'
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
                 'bank_order_snapshot_stale'
                 -- 🛑 不放行(無退休鍵):'order_ineligible' / 'order_ineligible_at_send'
                 --    / 'before_send_cutoff' —— 見板列 ⟦mail-SKIPKEYNORETIRE⟧
               ));

-- ── 事後斷言:五張都帶【放行四碼】, 而且放行段不含 failed 也不含【無退休鍵那三碼】──
-- 🔴 codex 2026-09-07 12③ nit:上一版宣稱「七碼逐個釘」而只驗五碼 ⇒ 這一版【逐碼列全】,
--    正面四個一個都不能少, 反面四個(failed + 無退休鍵三碼)一個都不能出現。
-- ⚠️ 射程誠實寫:`pg_get_viewdef` 可能改寫 SQL, 而本段比的是【字面出現】不是結構
--    ⇒ 它擋得住「少一個碼 / 多一個不該放行的碼」, 擋不住「NOT IN 被改成 IN」。
--    後者由拋棄式 PG 的三世界 × 兩向突變守(證據在 ~/pcm-mailbox/0907甲-5驗證/)。
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
    'pcm_bank_order_created_email_pending'
  ] LOOP
    d := pg_catalog.pg_get_viewdef(('public.' || v)::pg_catalog.regclass, true);

    -- ✅ 正面:放行四碼一個都不能少(少一個 ⇒ 那一族單子仍然永久出不來)
    FOREACH c IN ARRAY ARRAY[
      'shipment_voided',
      'tracking_superseded',
      'bank_order_not_mailable_at_send',
      'bank_order_snapshot_stale'
    ] LOOP
      IF pg_catalog.strpos(d, '''' || c || '''') = 0 THEN
        RAISE EXCEPTION '斷言:% 的定義裡缺放行碼 % ⇒ 五張沒有共用同一份清單', v, c;
      END IF;
    END LOOP;

    -- 🛑 反面:這四個一個都不能出現在定義裡
    --    · failed 是【狀態】不是碼, 而放行它會被唯一鍵擋著每輪重撈(45f 檔頭量到的病)
    --    · 另外三個是【無退休鍵】的 skip 碼 ⇒ 放回掃描面同樣撞唯一鍵插不進去
    --      ⇒ 修法是改 dedup_key 退休算式, 動六 writer + 五 scanner ⇒ 板列 ⟦mail-SKIPKEYNORETIRE⟧
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
-- 🔴 這五張是 `security_invoker` 的 view ⇒ **裡面那幾支函式是用【查它的人】的權限跑的**。
--    view 建得起來、七道靜態全綠、三世界全對 —— 而如果那支函式的 EXECUTE 被收掉過,
--    **查它的人一次錯一次**, 而本 migration 不會有任何症狀。
-- 🔵 為什麼是 `service_role`:這五張 view 的 SELECT 只授給 `service_role`(+ owner)
--    ⇒ **實際會走進這些函式的就是它**。斷言問的是【量到的結果】, 不是我寫了 GRANT。
-- 🔵 反向那格不是裝飾:`anon` **必須叫不動** —— 少了它, 一個「順手 GRANT TO PUBLIC」
--    的改動會讓正向四格照樣全綠。
-- 🛑 `anon` 不存在的環境:反向那格是【沒有讀數】不是【通過】 —— 印出來, 不靜默。
-- ⚠️ 四支逐條寫開、簽章寫成字面, 是刻意的:迴圈把名字放進陣列時,
--    `scripts/invoker-view-execute-gate.py` 的尺(只看 `has_function_privilege(` 之後 200 字)
--    **抽不到那些名字** ⇒ 它會判「這支檔沒有斷言」。⇒ 尺看得到, 是這條斷言的一部分。
DO $exec$
DECLARE
  v_has_anon boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') INTO v_has_anon;
  IF NOT v_has_anon THEN
    RAISE NOTICE '🔵 本環境沒有 anon 角色 ⇒ 反向那四格【沒有讀數】, 不是通過';
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
END
$exec$;

COMMIT;
