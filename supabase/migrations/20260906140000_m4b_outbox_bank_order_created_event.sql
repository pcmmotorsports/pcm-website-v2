-- 20260906140000 · M-4b ⟦b4-BANKNOEMAIL⟧ 片 ①:email_outbox 加第六個事件型別 bank_order_created。
--
-- 🛑🛑 **草稿。未 commit、未 apply。**
-- 🔴 **它自己是惰性的** —— 沒有掃描器就不會有這個型別的列。
--    而**單獨落地沒有意義**:掃描器與模板不在 dev 之前, 這個值一列都不會被用到,
--    卻會佔掉 Sean 貼板佇列一個位子。⇒ **三件一起落**(本支 + 20260906150000 的 view + 碼那半)。
--    依據逐字(`packages/use-cases/src/enqueue-order-shipped-emails.ts:8-12`):
--    「掛上去的話, 列會排進佇列、每 5 分鐘被認領一次、每次 throw、燒掉 attempts 進死信,
--     **然後每天發告警**。**模板與掛 route 必須是同一片。**」
--
-- 📎 形狀逐格抄 `20260904220000`(`_v4`)⇒ 本支是 `_v5`。
--    🔴 **不用 `DROP` 再 `ADD`**:那會在驗證期間鎖表;先例走
--    `ADD _vN NOT VALID → VALIDATE → DROP 舊 → RENAME`。
--
-- ══════════════════════════════════════════════════════════════════
-- 🔴🔴 **本支【刻意與先例不同的一格】—— 而它是先例的一個真缺陷, 不是我的偏好**
-- ══════════════════════════════════════════════════════════════════
-- 先例的閘用 `strpos(v_def, 'order_created')` 這種**裸字串**比對。
-- 🛑 而本片新增的值逐字是 `bank_order_created` —— 它**包含** `order_created` 這個子字串。
--    ⇒ 一個把 `'order_created'` 從白名單刪掉、只留 `'bank_order_created'` 的世界,
--      在裸字串比對之下 **`strpos` 仍然 > 0** ⇒ 🔴 **事後閘③(「舊值一個都沒少」)會【綠著放行】。**
--    ⇒ 📌 **那道閘的整個用途就是擋這件事, 而子字串會讓它在正好需要它的那一天失明。**
-- ✅ 本支全部改用**帶引號的字面** `'''order_created'''`(SQL 字串裡的單引號要寫兩個)
--    ⇒ 比對的是 CHECK 定義裡那個**被引號包起來的完整值**, `bank_order_created` 不會誤命中。
-- 🔬 **可自己驗**:`pg_get_constraintdef` 回的是 `CHECK ((event_type = ANY (ARRAY['order_created'::text, ...])))`
--    ⇒ 每個值都帶著單引號 ⇒ 帶引號比對是有東西可比的, 不是假設。
-- ⚠️ **射程**:本支只修**自己**這幾道閘;先例那三支裡的裸比對**我沒有回頭改**
--    (它們的值互相之間沒有子字串關係 ⇒ 今天無害)。🔴 **而下一個加 `*_order_shipped` 或
--    `*_order_cancelled` 這種前綴值的人會踩到同一格** ⇒ 這段註解就是留給他的。

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

  -- 前置閘②:forward-only —— 已經有第六個值就拒絕重跑
  IF pg_catalog.strpos(v_def, '''bank_order_created''') > 0 THEN
    RAISE EXCEPTION '前置閘②:bank_order_created 已經在 CHECK 裡了 ⇒ forward-only,拒重跑';
  END IF;

  -- 前置閘③:🔴 前五個值都要在 —— 本片是【加一個】, 不是【重寫白名單】。
  --   🔴 帶引號比對(檔頭那段的理由):`'order_created'` 不可以被 `bank_order_created` 誤命中。
  IF pg_catalog.strpos(v_def, '''order_created''') = 0
     OR pg_catalog.strpos(v_def, '''order_shipped''') = 0
     OR pg_catalog.strpos(v_def, '''order_cancelled''') = 0
     OR pg_catalog.strpos(v_def, '''order_unpaid_cancelled''') = 0
     OR pg_catalog.strpos(v_def, '''shipment_tracking_corrected''') = 0 THEN
    RAISE EXCEPTION '前置閘③:現行 CHECK 不是預期的五值(實得 %)⇒ 本片會覆寫白名單,停下人工確認', v_def;
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
  ADD CONSTRAINT email_outbox_event_type_check_v5
  CHECK (event_type IN (
    'order_created', 'order_shipped', 'order_cancelled', 'order_unpaid_cancelled',
    'shipment_tracking_corrected', 'bank_order_created'
  )) NOT VALID;
ALTER TABLE public.email_outbox VALIDATE CONSTRAINT email_outbox_event_type_check_v5;
ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_event_type_check;
ALTER TABLE public.email_outbox
  RENAME CONSTRAINT email_outbox_event_type_check_v5 TO email_outbox_event_type_check;

COMMENT ON COLUMN public.email_outbox.event_type IS
  '事件型別(CHECK 白名單;**新增事件 = 新 migration**)。6 值:
order_created(付款成功通知)/ order_shipped(出貨通知)/ order_cancelled(2026-09-02 新增:刷卡且已全額退款的取消)/
order_unpaid_cancelled(2026-09-03 新增:**未付款**的單被【員工】取消)/
shipment_tracking_corrected(2026-09-04 新增:已出貨的箱【更正貨運單號】之後的更正信)/
🔴 bank_order_created(2026-09-06 新增:顧客站選【匯款】而**尚未付款**的單, 告訴客人匯去哪、匯多少、幾天內。
   板列 ⟦b4-BANKNOEMAIL⟧;Sean 2026-09-06 逐字答「甲 = 可以」定案文案)。
🔴 **dedup_key = order_id::text**(一單一封)。
🛑 **它與 order_created 是【兩封不同的信】, 不是同一封的兩個狀態** ——
   匯款單成立時寄本封;客人真的匯款進來、payment_status 翻 paid 之後才寄 order_created。
   ⇒ 📌 **共用 order_created 的 dedup_key 會讓第二封【永遠寄不出去】**(那正是本片選開新型別的理由)。';

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
  IF pg_catalog.strpos(v_def, '''bank_order_created''') = 0 THEN
    RAISE EXCEPTION '事後閘②:新值不在 ⇒ 這一支沒有做到它宣稱的事';
  END IF;

  -- 🔴 事後閘③:**舊的五個一個都沒少** —— 一個把清單換掉的世界會通過事後閘②。
  --   🔴🔴 帶引號比對是這一格的**必要條件**, 不是風格:
  --      裸 `strpos(v_def, 'order_created')` 在只剩 `'bank_order_created'` 的世界仍然 > 0
  --      ⇒ 這道閘會在**正好需要它的那一天**綠著放行。
  IF pg_catalog.strpos(v_def, '''order_created''') = 0
     OR pg_catalog.strpos(v_def, '''order_shipped''') = 0
     OR pg_catalog.strpos(v_def, '''order_cancelled''') = 0
     OR pg_catalog.strpos(v_def, '''order_unpaid_cancelled''') = 0
     OR pg_catalog.strpos(v_def, '''shipment_tracking_corrected''') = 0 THEN
    RAISE EXCEPTION '事後閘③:舊的事件型別不見了(實得 %)⇒ 我把白名單換掉了, 不是加一個', v_def;
  END IF;

  -- 🔵 事後閘④:**帶引號比對本身要有判別力** —— 一個現造的值必須【找不到】。
  --   📌 少了它, 上面三道閘在「`pg_get_constraintdef` 回空字串」之類的世界會一起變成恆真。
  IF pg_catalog.strpos(v_def, '''zzz_never_an_event_type''') > 0 THEN
    RAISE EXCEPTION '事後閘④:現造的值居然命中 ⇒ 這把尺壞了, 上面三道閘不可信';
  END IF;
END
$$;

COMMIT;

-- ══════════════════════════════════════════════════════════════════
-- 回退(🔴 而它【做不到】—— 寫出來, 不要讓人以為退得回去)
-- ══════════════════════════════════════════════════════════════════
-- 🛑 **一旦 email_outbox 裡有 bank_order_created 的列, 把 CHECK 換回五值的 VALIDATE 會失敗。**
--    ⇒ 📌 **「最後退 CHECK」不是一個可執行的步驟**(codex R1-⑦ 抓到, plan §7 已改)。
-- ✅ **回退單位 = env → 碼 → view**, 本支**不回退** —— 白名單多一個合法值不傷任何東西。
-- 🔴 而「關 env 止血」也是假的:Vercel env 要**重新部署**才讀得到
--    ⇒ **止血的動作是 redeploy, 不是改 env**(plan §7 / R3-C4)。
