-- 20260913010000-rollback.sql —— 退回 20260913010000_m4b_bank_order_amount_changed_pending.sql
--
-- 🔵 **預設不要跑。** 那一片是惰性的:入列路徑不存在(零 TS)⇒ 這張 view 上有幾列都不會變成
--    `email_outbox` 的列, 而 CHECK 多一個值本身不會讓任何東西寄出去。
--    ⇒ 📌 **留著是零風險;要跑本檔的唯一理由是「決定不做這封信了」。**
--
-- 🔴 **真正承重的順序只有一條:view 要在函式【之前】DROP** —— view 的述詞呼那兩支函式,
--    `pg_depend` 會擋住先 DROP 函式。
-- ⛔ ~~我原本還寫「先收 CHECK 會讓 VALIDATE 炸而整個回捲失敗、腳本自己卡住」~~
--    🔴 **那個理由是假的**(Fable 5.1 2026-09-13 N5):**整檔包在一個 `BEGIN` / `COMMIT` 裡**
--    ⇒ VALIDATE 在第幾步炸,結果都一樣:**整筆回捲、什麼都沒動**, 不會留下半套狀態。
--    ✅ 「有列時會 fail-closed」這件事**仍然成立** —— 而它成立的理由是【交易】, 不是【順序】。
--    📌 留著這格是因為:一個把理由記錯的註解, 會讓下一個人為了「保護順序」而不敢重排,
--       或反過來以為拆成兩個交易也沒差。
--
-- 🔴 **跑本檔【之前】要先確認 outbox 裡沒有這個型別的列**(有的話先決定那些列怎麼辦,
--    本檔一列都不刪 —— append-only, 那些列記的是真的發生過的事):
--      SELECT count(*) FROM public.email_outbox WHERE event_type = 'bank_order_amount_changed';
--    🛑 count 非 0 而你照樣跑本檔 ⇒ 下面的 VALIDATE 會炸, 而那是刻意的(fail-closed, 不靜默丟資料)。
--
-- 🔵 **TS 那一側今天【沒有東西要退】** —— ⛔ ~~我原本寫「union 成員 / SUPPRESS 那一格 /
--    sweep 的 case 三處要先拿掉」~~ 🔴 **那三處不存在**(Fable N1:`grep bank_order_amount_changed
--    packages apps` 零命中;`IEmailOutbox.ts` 的 union 到 `order_partially_refunded` 為止)
--    ⇒ 叫人去拿掉三個不存在的東西, 讀的人會以為自己漏了什麼。
-- 🔴 **而那一段在【接線那一片落地之後】就會變成真的** ⇒ 屆時本檔要補回來:
--    那三處必須同一次拿掉(union 少一個成員 ⇒ `satisfies never` 會讓 switch 多一個 case 紅),
--    而順序是 **TS 先退、SQL 後退**(Sean 2026-09-11 Q4 甲:回捲檔要自足、順序要寫死)。

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ① 掃描面
DROP VIEW IF EXISTS public.pcm_bank_order_amount_changed_email_pending;

-- ①b 時間地板那支函式 —— 🔴 **順序在 view 之後**:view 的述詞呼它, 先 DROP 函式會被依賴擋住。
--     🔵 `IF EXISTS` 是刻意的:只有 forward 跑到一半失敗的世界才會「view 沒了而函式還在」。
DROP FUNCTION IF EXISTS public.pcm_bank_amount_changed_email_floor();

-- ② CHECK 收回七值(形狀與 forward 同款:ADD _vN NOT VALID → VALIDATE → DROP 舊 → RENAME,
--    🔴 不用 DROP 再 ADD —— 那會在驗證期間鎖表)
ALTER TABLE public.email_outbox
  ADD CONSTRAINT email_outbox_event_type_check_v7r
  CHECK (event_type IN (
    'order_created', 'order_shipped', 'order_cancelled', 'order_unpaid_cancelled',
    'shipment_tracking_corrected', 'bank_order_created',
    'order_partially_refunded'
  )) NOT VALID;
ALTER TABLE public.email_outbox VALIDATE CONSTRAINT email_outbox_event_type_check_v7r;
ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_event_type_check;
ALTER TABLE public.email_outbox
  RENAME CONSTRAINT email_outbox_event_type_check_v7r TO email_outbox_event_type_check;

-- ③ 🔴 COMMENT 也要退 —— 逐字還原成 `20260908070000` 那一版的七值全文。
--    🛑 不退的話, 一個「CHECK 只有七值、而 COMMENT 說有八值」的世界會留在正式庫裡,
--       而下一個讀 COMMENT 的人會以為那個型別可以用。
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
  -- 回捲後閘①:view 真的沒了
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
              JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public'
               AND c.relname = 'pcm_bank_order_amount_changed_email_pending') THEN
    RAISE EXCEPTION '回捲後閘①:view 還在';
  END IF;

  -- 回捲後閘①b:那支地板函式也真的沒了(留著 ⇒ 下一次 forward 的前置閘⑦b 會擋, 而那時很難懂)
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
              JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public'
               AND p.proname = 'pcm_bank_amount_changed_email_floor') THEN
    RAISE EXCEPTION '回捲後閘①b:pcm_bank_amount_changed_email_floor 還在';
  END IF;

  -- 回捲後閘②:CHECK 回到七值, 而**新值不在了**(只驗「舊值都在」會讓八值的世界也通過)
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.email_outbox'::regclass
     AND c.conname = 'email_outbox_event_type_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '回捲後閘②:找不到 email_outbox_event_type_check';
  END IF;
  IF pg_catalog.strpos(v_def, '''bank_order_amount_changed''') <> 0 THEN
    RAISE EXCEPTION '回捲後閘②b:新值還在 CHECK 裡(實得 %)', v_def;
  END IF;
  IF pg_catalog.strpos(v_def, '''order_partially_refunded''') = 0
     OR pg_catalog.strpos(v_def, '''bank_order_created''') = 0
     OR pg_catalog.strpos(v_def, '''order_created''') = 0 THEN
    RAISE EXCEPTION '回捲後閘②c:回捲把舊值也弄掉了(實得 %)', v_def;
  END IF;

  -- 回捲後閘③:CHECK 生效(NOT VALID 沒被 VALIDATE 的世界會通過②)
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
              WHERE c.conrelid = 'public.email_outbox'::regclass
                AND c.conname = 'email_outbox_event_type_check'
                AND NOT c.convalidated) THEN
    RAISE EXCEPTION '回捲後閘③:email_outbox_event_type_check 仍是 NOT VALID';
  END IF;
END
$$;

COMMIT;
