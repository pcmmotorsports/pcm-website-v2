-- 20260915150000-rollback.sql —— 退回 20260915150000_m4b_partially_cancelled_email_pending.sql
-- 🔴 email_outbox 若已有 order_partially_cancelled 的列 ⇒ CHECK 縮不回去 ⇒ 拒退(先處理那些列, 另一次有人簽名的動作)。
-- 退回後 TS 那半的 enqueue 會撞 42P01(view 不在)⇒ sweep route 那段回 failed / 503, 其餘信種照舊 ⇒ 要一起 revert TS 那顆。
-- 🔵 退回後匯款金額變更信的掃描面回到不看本信的那一版 ⇒ 本信已寄過的那幾次取消, 那條線若已上膛會再寄一封。
--    ⇒ 表裡有本信的列時退回前置閘一本來就拒退, 那個世界走不到。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF EXISTS (SELECT 1 FROM public.email_outbox WHERE event_type = 'order_partially_cancelled') THEN
    RAISE EXCEPTION '退回前置閘一:email_outbox 已有 order_partially_cancelled 的列 ⇒ CHECK 縮不回去, 先處理那些列';
  END IF;
  IF pg_catalog.to_regclass('public.pcm_partially_cancelled_email_pending') IS NULL THEN
    RAISE EXCEPTION '退回前置閘二:view 不在 ⇒ 20260915150000 沒貼過, 沒東西可退';
  END IF;
END
$pre$;

DROP VIEW public.pcm_partially_cancelled_email_current_v;
DROP VIEW public.pcm_partially_cancelled_email_pending;
-- 🔴 第 22 件 ②b 的反向:匯款金額變更信的掃描面退回 20260913010000:296-373 逐字(拿掉讓路給本信的那條 anti-join)。
--    🛑 要排在 DROP dedup 函式【之前】—— 新版那支 view 呼它, 先 DROP 函式會被依賴擋下。
--    CREATE OR REPLACE 保留原本的 ACL 與 COMMENT(同一個 OID)。
CREATE OR REPLACE VIEW public.pcm_bank_order_amount_changed_email_pending
  WITH (security_invoker = false, security_barrier = true) AS
SELECT
  m.order_id           AS order_id,
  oc.id                AS cancellation_id,
  m.display_id         AS display_id,
  m.created_at         AS created_at,
  m.total              AS total,
  m.balance_due        AS balance_due,
  m.notification_email AS notification_email,
  m.customer_email     AS customer_email,
  m.order_source       AS order_source
-- 🔴 七條合格性述詞全部**繼承**這一支(bank_transfer / unpaid / cancelled_at IS NULL /
--    order_source='web' / manual_request_id IS NULL / effective_balance_due 非 NULL 且 > 0
--    且 <= effective_total / 兩個信箱至少一個非空)。
--    🛑 **在這裡重寫一份 = 同一條錢的規則兩份, 而兩份會漂**(那正是 20260907220000 檔頭在講的事)。
FROM public.pcm_bank_order_still_mailable m
JOIN public.order_cancellations oc ON oc.order_id = m.order_id
WHERE
  -- 🔴 時間地板(不變式;理由見檔頭)。**不是「今天剛好是 0」。**
  oc.created_at >= public.pcm_bank_amount_changed_email_floor()
  -- 🔵 這一次取消真的有明細。
  --    ⚠️ 誠實標:`20260730140000` 那兩支 DEFERRED CONSTRAINT TRIGGER 已經擋掉「有 header、零明細」
  --      ⇒ 📌 **今天這一條恆為真, 它是第二道, 不是第一道。**
  --      留著的理由:那兩支 trigger 哪天被放寬 ⇒ 這裡讓一筆沒有明細的取消**不寄**, 而不是寄一封
  --      金額與取消前相同的信(客人會以為我們搞錯了)。
  AND EXISTS (
        SELECT 1 FROM public.order_cancellation_items ci
         WHERE ci.cancellation_id = oc.id
      )
  -- 🔴🔴 **anti-join 要帶 dedup_key, 不能只比 order_id + event_type。**
  --    只比那兩樣 ⇒ 第一次取消寄出去的那一列會把**第二次取消**一起擋掉
  --    ⇒ 📌 那就是 plan §3-bis-4 明文禁止的「用 order_id 當鍵」, 換一個地方發作。
  --    🔵 鍵的組法與 TS 那側 `composeEvent` 必須同一份字面 —— 兩邊漂掉時
  --      症狀是「每一輪重排同一封而永遠撞唯一鍵」或「同一次取消寄兩封」, 兩者都不會讓三綠紅。
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.order_id = m.order_id
           AND e.event_type = 'bank_order_amount_changed'
           AND e.dedup_key = public.pcm_bank_amount_changed_email_dedup_key(oc.id, m.order_id)
           -- 🔴🔴 **這裡【刻意沒有任何 last_error_code 的條件】, 而那是本 anti-join 最容易被
           --    「順手加回來」的一格 ⇒ 下面事後閘⑤e 釘死它。**
           --
           -- 🔬 **歷史(留痕, 兩次都錯過一輪)**:
           --   ⛔ 第一版:逐字抄 `20260907230000` 鄰居那份【五碼】可退休清單。
           --      🔴 Fable 5.1 F2 擊破:那份清單放行 `bank_order_snapshot_stale` /
           --        `bank_order_not_mailable_at_send` 的理由, 建立在**鄰居的鍵含三值指紋**
           --        (total / balanceDue / recipientEmail 的 sha256,`SupabaseEmailOutboxAdapter.ts:309-314`)
           --        ⇒ 快照一變就是另一把鑰匙 ⇒ 放行才插得進去。
           --        而**本型別的鍵沒有指紋**(plan §3-bis-4 明文禁止把金額放進鍵)⇒ 放行它們
           --        = 那一列回到掃描面而 INSERT 撞唯一鍵 ⇒ **每輪重撈、永遠插不進去**(⟦mail-SKIPKEYNORETIRE⟧)。
           --   ⛔ 第二版:拿掉那兩碼、留下三碼(主視窗 2026-09-13 第一次裁)。
           --      🔴🔴 Fable 5.1 第二輪 F1 擊破 ——**而它打掉的是那次裁示的【前提】**:
           --        留下那三碼的 writer **全都換鑰匙**
           --        (`SupabaseEmailOutboxAdapter.ts:1025` `:superseded:` / `:1045` `:recipientstale:`
           --         / `:1144` `:voided:`)
           --        ⇒ 📌 **它們的 dedup_key 永遠不等於上一行算出來的鍵 ⇒ 永遠不滿足上一行
           --          ⇒ 那段 `NOT IN` 根本讀不到。** 三碼是**死字面**。
           --      🎯 **而死碼不是中性的**:清單存在的唯一可能效果, 是哪天有人用那三碼之一 skip
           --        而**忘了換鑰匙** ⇒ 鍵相等、碼在清單裡 ⇒ 被放行回掃描面 ⇒ 每輪重撈。
           --        ⇒ 🛑 **那正是第一版在修的那個病, 換一個碼再犯一次。**
           --      📌 主視窗 2026-09-13 第二次裁【甲】並更正自己上一輪的裁示, 逐字:
           --        「**一道只有在被誤用時才會生效、而生效方向是壞的閘, 比沒有閘糟。**」
           --   ✅ 第三版(本版):**整段拿掉。** anti-join 只剩 event_type + dedup_key。
           --      🔬 行為零改變 —— 逐種列推過:碼為 NULL 的(pending / sending / sent)照樣擋;
           --        `failed` 照樣擋;**換過鑰匙的** skip 列鍵不同、本來就不被擋;
           --        **沒換鑰匙的** skip 列(`order_ineligible` / `before_send_cutoff`)兩版都被擋。
           --        ⇒ 對今天每一種真的會出現的列, 拿掉前後答案**完全相同**。
           --      🔵 順手消掉另一個壞世界(Fable F3):清單還在的話, 有人刪掉 `COALESCE`
           --        ⇒ `NULL NOT IN (…)` 回 NULL ⇒ WHERE 當假 ⇒ **連已 sent / pending 的列都不擋**
           --        ⇒ 每輪重撈;或 `NOT IN` 被誤改 `IN`。兩者舊閘全綠。
           --        ⇒ 📌 **沒有清單 ⇒ 沒有「清單被改壞」這個世界。**
           --
           -- 🛑🛑 **甲的代價, 寫成規則(主視窗 2026-09-13 指定留這句)**:
           --    **未來要讓某個 skip 碼的列能重排, 去那支 writer 加退休鍵(機制),
           --      不准回來在這裡開一個洞(約定)。**
           --    📌 這是甲唯一需要留下的字 —— 它留的是**方向**, 不是清單。
      );
DROP FUNCTION public.pcm_partially_cancelled_email_dedup_key(uuid, uuid);

ALTER TABLE public.email_outbox
  ADD CONSTRAINT email_outbox_event_type_check_v7
  CHECK (event_type IN (
    'order_created', 'order_shipped', 'order_cancelled', 'order_unpaid_cancelled',
    'shipment_tracking_corrected', 'bank_order_created',
    'order_partially_refunded',
    'bank_order_amount_changed'
  )) NOT VALID;
ALTER TABLE public.email_outbox VALIDATE CONSTRAINT email_outbox_event_type_check_v7;
ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_event_type_check;
ALTER TABLE public.email_outbox
  RENAME CONSTRAINT email_outbox_event_type_check_v7 TO email_outbox_event_type_check;

COMMIT;
