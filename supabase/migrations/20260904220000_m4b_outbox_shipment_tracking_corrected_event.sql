-- 20260904220000 · M-4b ⟦5b-TRACKNUMGAP1⟧ 片 C-①:email_outbox 加第五個事件型別。
--
-- 🛑🛑 **草稿。未 commit、未 apply。**
-- 🔴 **它自己是惰性的** —— 沒有掃描器就不會有這個型別的列。
--    而**單獨落地沒有意義**:掃描器與模板不在 dev 之前, 這個值一列都不會被用到,
--    卻會佔掉 Sean 貼板佇列一個位子。⇒ **三件一起落。**
--
-- 🔴🔴 **而「一起落」不是我的判斷, 是 repo 的既有規矩**:
--    `packages/use-cases/src/enqueue-order-shipped-emails.ts:8-12` 逐字 ——
--    「掛上去的話, 列會排進佇列、每 5 分鐘被認領一次、每次 throw、燒掉 attempts 進死信,
--     **然後每天發告警**。**模板與掛 route 必須是同一片。**」
--
-- 📎 形狀逐格抄 `20260903040000`(`_v3`)與 `20260902120000`(`_v2`)—— 本支是 `_v4`。
--    🔴 **不用 `DROP` 再 `ADD`**:那會在驗證期間鎖表;先例走的是
--    `ADD _vN NOT VALID → VALIDATE → DROP 舊 → RENAME`。

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

  -- 前置閘②:forward-only —— 已經有第五個值就拒絕重跑
  IF pg_catalog.strpos(v_def, 'shipment_tracking_corrected') > 0 THEN
    RAISE EXCEPTION '前置閘②:shipment_tracking_corrected 已經在 CHECK 裡了 ⇒ forward-only,拒重跑';
  END IF;

  -- 前置閘③:🔴 前四個值都要在 —— 本片是【加一個】, 不是【重寫白名單】。
  --   少了任何一個 ⇒ 現況不是我以為的那一版 ⇒ 我這支的 IN(...) 會把它悄悄刪掉。
  IF pg_catalog.strpos(v_def, 'order_created') = 0
     OR pg_catalog.strpos(v_def, 'order_shipped') = 0
     OR pg_catalog.strpos(v_def, 'order_cancelled') = 0
     OR pg_catalog.strpos(v_def, 'order_unpaid_cancelled') = 0 THEN
    RAISE EXCEPTION '前置閘③:現行 CHECK 不是預期的四值(實得 %)⇒ 本片會覆寫白名單,停下人工確認', v_def;
  END IF;

  -- 前置閘④:這一欄上不該掛著別的 CHECK / FK(含 whole-row 寫法)
  --   ⚠️ 刻意誤報大於漏報:別欄的 whole-row CHECK 也會命中(形狀抄 20260903040000 前置閘④)。
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
  ADD CONSTRAINT email_outbox_event_type_check_v4
  CHECK (event_type IN (
    'order_created', 'order_shipped', 'order_cancelled', 'order_unpaid_cancelled',
    'shipment_tracking_corrected'
  )) NOT VALID;
ALTER TABLE public.email_outbox VALIDATE CONSTRAINT email_outbox_event_type_check_v4;
ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_event_type_check;
ALTER TABLE public.email_outbox
  RENAME CONSTRAINT email_outbox_event_type_check_v4 TO email_outbox_event_type_check;

COMMENT ON COLUMN public.email_outbox.event_type IS
  '事件型別(CHECK 白名單;**新增事件 = 新 migration**)。5 值:
order_created(付款成功通知)/ order_shipped(出貨通知)/ order_cancelled(2026-09-02 新增:刷卡且已全額退款的取消)/
order_unpaid_cancelled(2026-09-03 新增:**未付款**的單被【員工】取消)/
🔴 shipment_tracking_corrected(2026-09-04 新增:已出貨的箱【更正貨運單號】之後的更正信。
   Sean 2026-09-04 逐字「甲 = 做, 改完自動再寄一封對的信給客人」)。
🔴 **dedup_key = 箱 + 單號** ⇒ 同一個單號值只寄一次;連改兩次(A→B→C)只寄到 C ——
   拍板理由逐字:**客人要的是「哪一個號碼是對的」, 不是「你改過幾次」。**';

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
  IF pg_catalog.strpos(v_def, 'shipment_tracking_corrected') = 0 THEN
    RAISE EXCEPTION '事後閘②:新值不在 ⇒ 這一支沒有做到它宣稱的事';
  END IF;
  -- 🔴 事後閘③:**舊的四個一個都沒少** —— 一個把清單換掉的世界會通過事後閘②。
  IF pg_catalog.strpos(v_def, 'order_created') = 0
     OR pg_catalog.strpos(v_def, 'order_shipped') = 0
     OR pg_catalog.strpos(v_def, 'order_cancelled') = 0
     OR pg_catalog.strpos(v_def, 'order_unpaid_cancelled') = 0 THEN
    RAISE EXCEPTION '事後閘③:舊的事件型別不見了(實得 %)⇒ 我把白名單換掉了, 不是加一個', v_def;
  END IF;
END
$$;

COMMIT;
