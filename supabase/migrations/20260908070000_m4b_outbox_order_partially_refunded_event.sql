-- 20260908070000 · M-4b QB-16 片 ① :email_outbox 加第七個事件型別 `order_partially_refunded`。
--
-- 🛑🛑 **草稿。未 commit 時未 apply。**
-- 🔴 **它自己是惰性的** —— 沒有掃描器就不會有這個型別的列;而白名單放寬了而掃描面沒建,
--    這個值一列都不會出現。⇒ 📎 形狀逐格抄 `20260906140000`(`_v5`)、`20260904220000`(`_v4`)。
--    🔴 **不用 `DROP` 再 `ADD`**:那會在驗證期間鎖表;先例走
--    `ADD _vN NOT VALID → VALIDATE → DROP 舊 → RENAME`。
--
-- ══ 🔴🔴 **這一支存在的理由 = 一個【被取代的拍板】** ═══════════════════════════════
--   `20260905310000_m4b_cancelled_email_pending_view.sql:214` 註明 **Sean 2026-09-02 拍甲**,
--   而同一段 `:217` 逐字寫著「⇒ **不涵蓋匯款/現金的單, 也不涵蓋 `partiallyRefunded`(部分退款)。**」
--   ⛔ ~~那個排除~~ 🔴 **2026-09-08 被 Sean 的 QB-16【甲】取代**:
--      逐字「要寄的是**真正的部分退款**(退了一部分、單子沒有全退)—— 今天完全沒有信的那一群」。
--   🛑 **舊字面不刪**(那是那支 view 為什麼長那樣的紀錄)—— 訂正寫在片 ② 的 COMMENT 裡,
--      而**這裡也寫一份**:📌 **會讀到舊排除句的人不一定會讀到片 ②。**
--   ⚠️ **射程**:被取代的只有「不涵蓋 `partiallyRefunded`」那半;
--      **「不涵蓋匯款/現金的單」那半仍然成立**(本片同樣只做 `payment_method='tappay'`)。
--
-- ══ 🔴 為什麼是【新事件型別】而不是塞進 `order_cancelled` ══════════════════════════
--   `order_cancelled` 的 anti-join 是**按事件型別**做的(`20260907230000:495` 起那段)
--   ⇒ 塞進去 ⇒ 兩封信**互相吃掉對方的機會**,而症狀是「另一封永遠不寄」,
--     🛑 **且它與「沒有單要寄」印同一個東西** —— 零訊號。
--
-- ══ 🔴🔴 **`dedup_key` 綁【那一筆退款】, 不綁【那張單】** ═════════════════════════
--   唯一鍵是 `(event_type, dedup_key)`(`20260717020000:377`,**不含 order_id**)
--   ⇒ `dedup_key = order_refunds.id` ⇒ **同一張單退第二次 = 新的一列 = 再寄一封。**
--   🔵 **那是 Sean 佇列上的 QB-16 Q2, 而主視窗 A 2026-09-08 裁【甲 = 每次都寄】**,
--      理由是量到的:`20260812170000:598` 逐字 `IF v_ps NOT IN ('paid','partiallyRefunded')`
--      ⇒ **已經部分退款的單還能再退**(只有 `refunded` 才在 `:594` 硬擋 `REFUND_LEDGER_FULL`)
--      ⇒ 📌 **分批退不是假想** ⇒「只寄第一次」= 第二筆錢默默進客人帳戶而他零通知。
--   🛑 **下一個人若把 `dedup_key` 改回 `order_id`,行為會【安靜地】變成「只寄第一次」** ——
--      三綠不紅、測試不紅、畫面上沒有形狀。**要改它,先拿 Sean 新的一次拍板。**

BEGIN;

DO $$
DECLARE
  v_def    text;
  v_others text;
BEGIN
  -- 前置閘①:那條 CHECK 要在(否則下面炸的訊息不會告訴你現況是什麼)
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.email_outbox'::regclass
     AND c.conname = 'email_outbox_event_type_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '前置閘①:找不到 email_outbox_event_type_check ⇒ 部署態與預期不符,停下人工確認';
  END IF;

  -- 前置閘②:forward-only —— 已經有第七個值就拒絕重跑
  IF pg_catalog.strpos(v_def, 'order_partially_refunded') > 0 THEN
    RAISE EXCEPTION '前置閘②:order_partially_refunded 已經在 CHECK 裡了 ⇒ forward-only,拒重跑';
  END IF;

  -- 前置閘③:🔴 前六個值都要在 —— 本片是【加一個】, 不是【重寫白名單】。
  --   少了任何一個 ⇒ 現況不是我以為的那一版 ⇒ 我這支的 IN(...) 會把它悄悄刪掉。
  --   🛑 `order_created` 用【帶引號】比對:它是 `order_cancelled` 以外每個值的子字串來源之一,
  --      而裸字串比對會讓「只剩 order_created_v2 這種值」的世界也通過。
  IF pg_catalog.strpos(v_def, '''order_created''') = 0
     OR pg_catalog.strpos(v_def, '''order_shipped''') = 0
     OR pg_catalog.strpos(v_def, '''order_cancelled''') = 0
     OR pg_catalog.strpos(v_def, '''order_unpaid_cancelled''') = 0
     OR pg_catalog.strpos(v_def, '''shipment_tracking_corrected''') = 0
     OR pg_catalog.strpos(v_def, '''bank_order_created''') = 0 THEN
    RAISE EXCEPTION '前置閘③:現行 CHECK 不是預期的六值(實得 %)⇒ 本片會覆寫白名單,停下人工確認', v_def;
  END IF;

  -- 前置閘④:這一欄上不該掛著別的 CHECK / FK(含 whole-row 寫法)
  --   ⚠️ 刻意誤報大於漏報:別欄的 whole-row CHECK 也會命中(形狀抄 20260904220000 前置閘④)。
  SELECT string_agg(c.conname, ', ') INTO v_others
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = c.conrelid AND a.attname = 'event_type'
   WHERE c.conrelid = 'public.email_outbox'::regclass
     AND c.contype IN ('c', 'f')
     AND (0 = ANY (c.conkey) OR a.attnum = ANY (c.conkey))
     AND c.conname <> 'email_outbox_event_type_check';
  IF v_others IS NOT NULL THEN
    RAISE EXCEPTION '前置閘④:event_type 這一欄上還掛著別的 CHECK 或 FOREIGN KEY(%)⇒ 放寬了也可能被它擋', v_others;
  END IF;
END
$$;

ALTER TABLE public.email_outbox
  ADD CONSTRAINT email_outbox_event_type_check_v6
  CHECK (event_type IN (
    'order_created', 'order_shipped', 'order_cancelled', 'order_unpaid_cancelled',
    'shipment_tracking_corrected', 'bank_order_created',
    'order_partially_refunded'
  )) NOT VALID;
ALTER TABLE public.email_outbox VALIDATE CONSTRAINT email_outbox_event_type_check_v6;
ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_event_type_check;
ALTER TABLE public.email_outbox
  RENAME CONSTRAINT email_outbox_event_type_check_v6 TO email_outbox_event_type_check;

COMMENT ON COLUMN public.email_outbox.event_type IS
$c$事件型別(CHECK 白名單;**新增事件 = 新 migration**)。7 值:
order_created(付款成功通知)/ order_shipped(出貨通知)/ order_cancelled(2026-09-02 新增:刷卡且已全額退款的取消)/
order_unpaid_cancelled(2026-09-03 新增:**未付款**的單被【員工】取消)/
shipment_tracking_corrected(2026-09-04 新增:已出貨的箱【更正貨運單號】之後的更正信。
   dedup_key = 箱 + 單號 ⇒ 同一個單號值只寄一次;連改兩次(A→B→C)只寄到 C)/
bank_order_created(2026-09-06 新增:匯款建單通知)/
🔴 order_partially_refunded(2026-09-08 新增:**真正的部分退款** —— 退了一部分、單子沒有全退。
   Sean 2026-09-08 QB-16 拍甲。⛔ ~~20260905310000:217「不涵蓋 partiallyRefunded」~~ 那半被本次取代;
   而同句「不涵蓋匯款/現金」那半**仍然成立**。
   🔴 **dedup_key = `order_refunds.id`(那一筆退款), 不是 order_id** ⇒ **分批退每一筆各寄一封**
      —— 主視窗 A 2026-09-08 裁甲, 理由:`20260812170000:598` 逐字
      `IF v_ps NOT IN ('paid','partiallyRefunded')` ⇒ 部分退款的單還能再退 ⇒ 分批退是真的。
   🛑 改回綁 order_id 會【安靜地】變成「只寄第一次」, 三綠與測試都不紅。)$c$;

DO $$
DECLARE v_def text;
BEGIN
  -- 事後閘①:改名之後找得到
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.email_outbox'::regclass
     AND c.conname = 'email_outbox_event_type_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '事後閘①:改名後找不到 email_outbox_event_type_check';
  END IF;
  -- 事後閘②:新值在
  IF pg_catalog.strpos(v_def, '''order_partially_refunded''') = 0 THEN
    RAISE EXCEPTION '事後閘②:新值不在 ⇒ 這一支沒有做到它宣稱的事';
  END IF;
  -- 🔴 事後閘③:**舊的六個一個都沒少** —— 一個把清單換掉的世界會通過事後閘②。
  IF pg_catalog.strpos(v_def, '''order_created''') = 0
     OR pg_catalog.strpos(v_def, '''order_shipped''') = 0
     OR pg_catalog.strpos(v_def, '''order_cancelled''') = 0
     OR pg_catalog.strpos(v_def, '''order_unpaid_cancelled''') = 0
     OR pg_catalog.strpos(v_def, '''shipment_tracking_corrected''') = 0
     OR pg_catalog.strpos(v_def, '''bank_order_created''') = 0 THEN
    RAISE EXCEPTION '事後閘③:舊的事件型別不見了(實得 %)⇒ 我把白名單換掉了, 不是加一個', v_def;
  END IF;
  -- 🔴 事後閘④:**CHECK 真的還在生效**(NOT VALID 沒被 VALIDATE 的世界會通過①②③)
  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint c
        WHERE c.conrelid = 'public.email_outbox'::regclass
          AND c.conname = 'email_outbox_event_type_check'
          AND c.convalidated) THEN
    RAISE EXCEPTION '事後閘④:email_outbox_event_type_check 仍是 NOT VALID ⇒ 舊列沒被檢查過';
  END IF;
END
$$;

COMMIT;
