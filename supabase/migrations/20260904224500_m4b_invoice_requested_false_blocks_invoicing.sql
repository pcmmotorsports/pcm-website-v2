-- ============================================================
-- M-4b `⟦b4-INVOICE5PCT⟧` Q3(重問後的版本):
--   **`orders.invoice_requested` 是 `false`(決定不開發票)的單:**
--     **① 那個旗標不得改回 `true`**
--     **② 不得把 `invoice_status` 改成 `issued`, 也不得填發票號碼 / 發票金額**
--     **③ 不得替它建立【待開票紀錄】(`pending_invoices`)**
-- ============================================================
-- 🔴 **拍板**(逐字落檔 `~/pcm-mailbox/Sean拍板-20260904-七題.md`):
--   · 第十八題(重問)Sean 拍 **甲 = 「用現在就有的那一欄『這張單要不要開發票』」**。
--   · 第十六題 Sean 拍 **甲 = 「任何改動都擋(要改 ⇒ 作廢重開)」**
--     (推薦理由「乙可以分兩步繞過, 等於沒鎖」是**主視窗 `-94` 擬的**, 他選了甲 —— **不要寫成「Sean 說」**)。
--   · 第十九題(2026-09-04, 重問後)Sean 拍 **甲 = 「擋, 不開發票的單不准填發票(要開 ⇒ 作廢重開)」**。
--   ⇒ 三題合起來 = **本檔**。
--
-- 🔴🔴 **第十九題是【第二版才有的】, 而它的來源值得寫下來**:
--   我第一版只鎖那個旗標, 而 codex 對抗審查指出 —— **鎖住了【紀錄】, 而【結果】從兩條既有的路走掉**:
--     · 後台 workflow RPC 可以把 `invoice_status` 改成 `issued` 並填號碼與金額(該支掃該三欄 **45 處**, 掃本欄 **0**)
--     · `record_pending_invoice()` 付款後只檢查 `payment_status='paid'`(掃本欄 **0**)
--   ⇒ 🎯 **兩條路上旗標都維持 `false` ⇒ 第一版那道 trigger 完全不會叫。**
--   ⇒ 📌 **「守住那個決定的【紀錄】」與「守住那個決定的【結果】」是兩件事** —— 而我先前沒有分開講。
--
-- 🔬 **語意權威是那一欄自己的 `COMMENT`**(`20260828100000:258` 起, 逐字):
--   「這張單【要不要】開發票 —— 下單當下的決定。」`true` = 要開(DEFAULT)· `false` = 不開。
--
-- 🔵 **為什麼是這一欄, 而不是我先前那支(`invoice_status` 加第四值 `not_required`)**:
--   🔴 **那支【作廢了】** —— 第三輪換角度審查抓到:**這件事這張表上已經有一欄了, 而且 Sean 2026-09-03 本人貼過。**
--   ⇒ 📌 **而我寫給他的選項表把「加一欄」寫成假想方案、取了另一個名字, 全篇沒說那一欄已經存在**
--      ⇒ **他第一次批的「好」, 是對一份前提錯的選項表說的。** 重問之後他改選這一案。
--   ⚠️ **成因寫在這裡, 因為它會再發生**:我掃了 `invoice.type`(68 處)與 `invoice_status`(43 處)
--      ⇒ 🎯 **我掃了兩個【我自己挑的名字】, 而沒有問「這張表上還有哪些 `invoice` 開頭的欄」。**
--
-- 🔵 **而這一案結構上比前一案安全一格, 而那一格沒有人講過**:
--   `invoice_requested` 是**布林** ⇒ **沒有中間值** ⇒ 🎯 **第十六題那個「分兩步繞過」在本案【不存在】**
--   (前一案的 `not_required → not_issued → issued` 兩步都合法;這裡 `false → true` 是唯一的出口)。
--
-- ⚠️ **今天的觸發條件是零** —— 正式庫實查:那一欄 **1 列, 全部是 `true`**;
--    而**沒有任何一條路寫 `false`**(那要等本片第 2 步:手動建單的勾選)。
--    🛑 **而那不是「先不做」的理由**:鎖要先在, 第一個 `false` 才有東西守。
--
-- 🔴 **鐵則 12③**(DB 結構)⇒ codex 對抗審查。**鐵則 8** ⇒ 本案由 Sean 本人拍。
-- 📎 兩道 REVOKE 的基線照 `docs/patterns/revoking-function-execute-in-supabase.md`。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
-- 🔵 **這一行會產生一種【重貼就好】的紅**(codex R3 nit N2):正式站有人在下單時貼,
--    你會拿到 `canceling statement due to lock timeout`。
--    ⇒ 🎯 **那一種紅是【零物件落地】—— 直接再貼一次就好, 不用找人。**
--    🛑 **而本檔另一種紅寫著「請找人來看」** —— 兩種不要混:
--      · 訊息裡有 `lock timeout` / `deadlock` ⇒ **等一下再貼一次**
--      · 訊息開頭是「前置閘:」或「落地斷言失敗:」⇒ **照那句話做, 不要重貼**
SET LOCAL statement_timeout = '60s';

-- 🔴 **先取鎖, 再檢查** —— 中間有窗口的話, 我會對著一個沒檢查過的狀態動手。
LOCK TABLE public.orders IN ACCESS EXCLUSIVE MODE;

-- ── 前置閘 ──────────────────────────────────────────────────────────────────
DO $pre$
DECLARE
  v_type    text;
  v_notnull boolean;
  v_default text;
BEGIN
  SELECT a.atttypid::regtype::text, a.attnotnull, pg_catalog.pg_get_expr(d.adbin, d.adrelid)
    INTO v_type, v_notnull, v_default
    FROM pg_catalog.pg_attribute a
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.orders'::regclass
     AND a.attname  = 'invoice_requested'
     AND NOT a.attisdropped;

  IF v_type IS NULL THEN
    RAISE EXCEPTION
      '前置閘:public.orders 上沒有 invoice_requested 這一欄 ⇒ 本檔要鎖的東西不存在, 停。'
      '(它應該由 20260828100000 建立;那一支沒貼的話, 先貼它。)';
  END IF;
  -- 🔴 逐格比對, 不用子字串 —— `issued` 曾經被 `not_issued` 吃掉過(同片前一支的 must-fix)。
  IF v_type <> 'boolean' OR v_notnull IS NOT TRUE OR v_default IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION
      '前置閘:invoice_requested 的定義不是本檔預期的那一版 ⇒ 實際 型別=% / NOT NULL=% / DEFAULT=% ⇒ 停。'
      '⇒ 🔵 **下一步:把上面那三個值貼給工程師看。**本檔預期的是 boolean / NOT NULL / DEFAULT true;'
      '對不上代表那一欄被人改過, 而**本檔的三道門都是照舊定義寫的** ⇒ 不要重貼, 要先弄清楚它為什麼變了。',
      v_type, v_notnull, v_default;
  END IF;

  -- 🔴🔴 **撞名要報錯, 不要靜靜覆寫**(`revoking-function-execute-in-supabase.md` §3.2)
  --
  -- 🔴🔴 **而「已經貼過了」與「守門【壞掉了】」不可以印同一句**(codex 對抗審查 must-fix, 它是對的):
  --    ⛔ ~~我上一版一看到函式存在就印「本檔已經貼過一次了, 你不用做任何事」~~
  --    ⇒ 🎯 **函式在、而 trigger 被刪掉 / 停用 / 綁錯的那個世界, 也會印那句話**
  --    ⇒ 🔴 **Sean 會把紅字讀成「正常, 重貼而已」, 而實際上守門已經不存在。**
  --    📌 **⇒ 這個洞是我【修上一個 finding 的時候造出來的】** —— 上一輪 codex 說「訊息要讓不寫程式的人讀得懂」,
  --       我把它改得友善, 而**友善的那句話同時覆蓋了一個災難的世界**。
  --    ✅ ⇒ 先分辨兩個世界, 再決定印哪一句。
  -- 🔴🔴 **撞名要【數整組】, 不要逐一撞名**(codex R1 must-fix, 它是對的):
  --    ⛔ ~~我上一版一個一個 IF~~ ⇒ **兩個方向都誤報**:
  --      · 完整重貼 ⇒ 先撞到「第二支存在」⇒ 印成「只有第二支」
  --      · 只有第一組存在 ⇒ 印成「整檔已完整貼過」
  --    ⇒ 📌 **逐一撞名回答的是「這一個在不在」, 而我要問的是「這一【組】是什麼狀態」。**
  --    ✅ 三個世界:**全不在 ⇒ 貼** · **四個都在而且完好 ⇒ 已貼過, 不用做事** · **其餘 ⇒ 半套, 找人。**
  DECLARE
    v_n int := 0;
    v_intact boolean;
  BEGIN
    IF pg_catalog.to_regprocedure('public.pcm_invoice_requested_false_is_final()') IS NOT NULL THEN
      v_n := v_n + 1;
    END IF;
    IF pg_catalog.to_regprocedure('public.pcm_no_pending_invoice_when_not_requested()') IS NOT NULL THEN
      v_n := v_n + 1;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                WHERE t.tgrelid = 'public.orders'::regclass
                  AND t.tgname  = 'zzz_pcm_invoice_requested_false_is_final') THEN
      v_n := v_n + 1;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                WHERE t.tgrelid = 'public.pending_invoices'::regclass
                  AND t.tgname  = 'zzz_pcm_no_pending_invoice_when_not_requested') THEN
      v_n := v_n + 1;
    END IF;
    -- 🔴 **那道 CHECK 也要算進來**(codex R2 nit):只剩它而四個物件全沒了的世界,
    --    `v_n = 0` 會被當成「全未安裝」⇒ 一路走到 `ADD CONSTRAINT` 才炸成一個同名錯誤,
    --    ⇒ 📌 **而那個錯誤講的是「名字重複」, 不是「你這裡只裝了一半」** —— 讀的人會走錯方向。
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                WHERE c.conrelid = 'public.orders'::regclass
                  AND c.conname  = 'orders_no_invoice_when_not_requested') THEN
      v_n := v_n + 1;
    END IF;

    IF v_n > 0 THEN
      -- 四個都在 ⇒ 再問「它們完好嗎」。**「在」與「完好」是兩個宣稱。**
      v_intact := (v_n = 5)
        AND EXISTS (
          SELECT 1 FROM pg_catalog.pg_trigger t
           WHERE t.tgrelid = 'public.orders'::regclass
             AND t.tgname  = 'zzz_pcm_invoice_requested_false_is_final'
             AND NOT t.tgisinternal
             AND t.tgfoid = 'public.pcm_invoice_requested_false_is_final()'::regprocedure
             AND t.tgtype = 17 AND t.tgqual IS NULL AND t.tgattr::text = '' AND t.tgenabled = 'A'
        )
        AND EXISTS (
          SELECT 1 FROM pg_catalog.pg_trigger t
           WHERE t.tgrelid = 'public.pending_invoices'::regclass
             AND t.tgname  = 'zzz_pcm_no_pending_invoice_when_not_requested'
             AND NOT t.tgisinternal
             AND t.tgfoid = 'public.pcm_no_pending_invoice_when_not_requested()'::regprocedure
             AND t.tgtype = 23 AND t.tgqual IS NULL AND t.tgenabled = 'A'
        )
        AND EXISTS (
          SELECT 1 FROM pg_catalog.pg_constraint c
           WHERE c.conrelid = 'public.orders'::regclass
             AND c.conname = 'orders_no_invoice_when_not_requested' AND c.convalidated
             -- 🔴 **比定義不比名字**(codex R2):同名可以被換成 `CHECK(true)`。
             AND pg_catalog.pg_get_constraintdef(c.oid) =
                 'CHECK ((invoice_requested OR ((invoice_status <> ''issued''::text) AND (invoice_number IS NULL) AND (invoice_amount IS NULL))))'
        )
        -- 🔴🔴 **兩支函式的【內容】也要比**(codex R2 must-fix):
        --    它們可以被 `CREATE OR REPLACE` 換成「什麼都不擋」而 **OID / wiring / enabled 全部不變**
        --    ⇒ 上面每一格照樣綠。⇒ 📌 **「那個東西還在」與「它還在做那件事」是兩個宣稱。**
        --    ⚠️ **而這裡比的是【本體裡的關鍵字面】不是整支雜湊** —— 射程要說清楚:
        --       它擋得住「整段被換成 no-op」, **擋不住「有人改了條件而關鍵字面還在」**。
        --       (要擋後者得比整支 `prosrc`, 而那會讓任何一次註解修改都紅 ⇒ 那種閘會被關掉。)
        AND (SELECT p.prosrc FROM pg_catalog.pg_proc p
              WHERE p.oid = 'public.pcm_invoice_requested_false_is_final()'::regprocedure)
            LIKE '%要改請作廢重開%'
        AND (SELECT p.prosrc FROM pg_catalog.pg_proc p
              WHERE p.oid = 'public.pcm_no_pending_invoice_when_not_requested()'::regprocedure)
            LIKE '%不建立待開票紀錄%';

      IF v_intact THEN
        RAISE EXCEPTION
          '前置閘:本檔【已經貼過一次了, 而且五個物件(含那道 CHECK)都完好】。'
          '⇒ 🔵 **這是正常的, 你不用做任何事。**';
      ELSE
        RAISE EXCEPTION
          '🔴🔴 前置閘:本檔的物件【只裝了一部分】(五個裡有 %, 或其中某個被改壞了)—— 這【不是】正常的重貼。'
          '⇒ 🛑 請找人來看, 不要重貼本檔。', v_n;
      END IF;
    END IF;
  END;
  -- 🔴🔴 **`record_pending_invoice(uuid)` 必須【本來就在】**(codex R2 must-fix):
  --    本檔對它下 `CREATE OR REPLACE` ⇒ **它不在的話, 那一行會【新建】一支** ⇒ 拿到**預設 ACL**
  --    ⇒ 一支 `SECURITY DEFINER` 帶著 `service_role` 的 EXECUTE 落地。
  --    ⛔ ~~我第一版把這道閘寫在那支函式的【下面】~~ ⇒ 🔴 **它守的動作已經發生了, 它才問「在不在」**
  --       ⇒ 當然在 ⇒ **那道閘從來不會叫。**
  --    🔬 **抓到它的不是我讀出來的, 是【收權斷言】** —— 拋棄式 PG 上實跑, 它印
  --       「record_pending_invoice 被 service_role 拿到 EXECUTE」⇒ **codex 說的風險是真的, 而我的閘沒擋。**
  --    ⇒ 📌 **一道放在它要守的動作【後面】的閘, 與沒有那道閘, 在正常世界裡印同一個綠。**
  IF pg_catalog.to_regprocedure('public.record_pending_invoice(uuid)') IS NULL THEN
    RAISE EXCEPTION
      '前置閘:public.record_pending_invoice(uuid) 不存在 ⇒ 本檔的 CREATE OR REPLACE 會【新建】一支'
      '而不是重定義 ⇒ 它會拿到預設 ACL 而不是原本的「唯 payment_confirmer」。停。';
  END IF;
END
$pre$;

-- ── 狀態不變式:`false` 的單不得【被標成已開立, 也不得帶發票號碼或金額】────────
-- ⚠️ **標題刻意不寫「不得有任何開票事實」**(codex R2 nit):`invoice_status = 'voided'` **是通得過的**
--    (那是「開過而作廢」的狀態, 而本片沒有拍板說它該不該擋)⇒ 📌 **標題比它擋的東西寬, 就是一個宣稱。**
-- 🔴🔴 **這裡用 `CHECK` 不用 trigger, 而那是 codex R1 三條 must-fix 換來的**:
--   `CHECK` 管的是**那一列的狀態** ⇒ **INSERT 與 UPDATE 一視同仁**, 而且**順序繞不過去**
--   (先做完再翻旗標 / 直接 INSERT 一張違規單 / 改成另一個號碼 —— 三條全部擋)。
-- ⚠️ **而它擋不到跨表的那一半**(`pending_invoices`)—— 那由上面 trigger 的 ② 與下面那道門管。
-- 🔬 **不會被既有資料擋住**:2026-09-04 唯讀實查正式庫 ⇒ `orders` 1 列, `invoice_requested = true`。
ALTER TABLE public.orders
  ADD CONSTRAINT orders_no_invoice_when_not_requested
  CHECK (
    invoice_requested
    OR (invoice_status <> 'issued' AND invoice_number IS NULL AND invoice_amount IS NULL)
  );

-- ── 守門 ────────────────────────────────────────────────────────────────────
-- 🔴 **`AFTER UPDATE` 不是 `BEFORE`**:`BEFORE` 依名字順序跑
--    ⇒ 一支名字排在後面的 `BEFORE` trigger 可以在我檢查【之後】把值改回 `true`。
--    `AFTER` 看到的是**最後要落地的那一列**。而名字的 `zzz_` 前綴是**第二道獨立防線**。
CREATE FUNCTION public.pcm_invoice_requested_false_is_final()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  -- ① 旗標本身不得翻回去(第十六題)
  IF OLD.invoice_requested IS FALSE AND NEW.invoice_requested IS TRUE THEN
    RAISE EXCEPTION
      '這張單建單時決定不開發票, 要改請作廢重開。(訂單 %)', OLD.display_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- ② 🔴 **已經有【待開票紀錄】的單, 不得翻成「不開」**(codex R1 must-fix ③:順序繞過)
  --    ⛔ 那條路是:**先在 `true` 的時候建 pending 列, 再把旗標翻 `false`**
  --    ⇒ 兩道門都不叫(orders 這道不查 pending;pending 那道只管 INSERT)
  --    ⇒ **最後留下一張「不開發票」而【排隊等著開票】的單。**
  --    📌 **⇒ 一個跨兩張表的不變式, 要在【兩個方向】各有一道門** —— 只擋一邊等於沒擋。
  IF NEW.invoice_requested IS FALSE AND OLD.invoice_requested IS TRUE
     AND EXISTS (SELECT 1 FROM public.pending_invoices pi WHERE pi.order_id = NEW.id) THEN
    RAISE EXCEPTION
      '這張單已經在待開票名單上, 不能改成不開發票。要改請先處理那筆待開票。(訂單 %)', NEW.display_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- 🔴🔴 **②那三格【搬走了】—— 改由 `CHECK` 約束管**(codex R1 三條 must-fix, 它是對的):
  --    ⛔ ~~我在這裡擋 `invoice_status → issued` / 填號碼 / 填金額~~ ⇒ **三個洞, 而它們是同一個成因**:
  --      · **INSERT 那條路完全沒門** —— 直接 INSERT 一張 `false` + `issued` + 有號碼的單, **整張違規單落地**
  --      · 號碼/金額**只擋 `NULL → 非 NULL`** ⇒ **既有的號碼可以改成另一個號碼**
  --      · 先在 `true` 的時候做完再翻 `false` ⇒ **順序繞過去**
  --    🎯 **⇒ 三個都是「我在管【轉移】而不是管【狀態】」的後果。**
  --    📌 **⇒ 而那正是我同日寫進 `guard-and-instrument-traps.md` 的判別句:**
  --       **「我擋的是一個【轉移】還是一個【終點】?」** —— 我寫下它, 然後在這裡犯了它。
  --    ✅ **`CHECK` 管的是【那一列的狀態】** ⇒ INSERT 與 UPDATE 一視同仁, **順序繞不過去**。見下方約束。

  RETURN NULL;  -- AFTER trigger 的回傳值被忽略
END
$fn$;

-- 🔴 **兩道 REVOKE, 少一道都是開的**
REVOKE ALL ON FUNCTION public.pcm_invoice_requested_false_is_final() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_invoice_requested_false_is_final() FROM anon, authenticated;
-- ⚠️ **不 GRANT 給任何人** —— trigger 函式由 PG 以 owner 身分呼叫, 沒有人需要直接執行它。

COMMENT ON FUNCTION public.pcm_invoice_requested_false_is_final() IS
  'orders.invoice_requested 的終局守門:false ⇒ true 擋下(Sean 2026-09-04 第十六題拍甲「任何改動都擋, 要改就作廢重開」;推薦理由由主視窗 -94 擬)。🔵 布林沒有中間值 ⇒ 沒有「分兩步繞過」那條路。🔴 AFTER 不是 BEFORE:BEFORE 依名字順序跑,排在後面的 trigger 可以在檢查之後改掉那個值。';

CREATE TRIGGER zzz_pcm_invoice_requested_false_is_final
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.pcm_invoice_requested_false_is_final();

-- 🔴 **`ENABLE ALWAYS`**:預設 `tgenabled='O'` ⇒ `SET session_replication_role='replica'` 就繞過去。
-- ⚠️ **它不是防攻擊的門** —— owner 仍然 `DISABLE` / `DROP` 得掉;它防的是**一個開了 replica 模式而不自知的批次腳本**。
-- ⚠️ **運維註記**:`ALWAYS` 在 logical replication subscriber 上也會執行(違規資料可能讓 apply 停住);
--    **data-only restore** 也會觸發, 而 `--disable-triggers` 之後要回頭確認它仍是 `A`。
ALTER TABLE public.orders ENABLE ALWAYS TRIGGER zzz_pcm_invoice_requested_false_is_final;

-- ── 守門(二):`false` 的單不得建立【待開票紀錄】(第十九題的第二條路)──────────
-- 🔴 **為什麼是 trigger 而不是改 `record_pending_invoice()`**:
--   那支函式**不是本片的東西**, 而**改別人的函式會讓「誰在守這件事」散開** ——
--   ⇒ 📌 **一道掛在【那張表】上的門, 對【所有寫入路徑】都成立**;
--      而改一支函式只擋得住走那支函式的人, **下一支寫 `pending_invoices` 的碼不會被它擋。**
-- ⚠️ **而代價要寫出來**:`record_pending_invoice()` 自己**仍然不讀那一欄**
--   ⇒ 它會【丟例外】而不是【安靜跳過】。**那是刻意的** —— 安靜跳過會讓付款流程以為自己成功了。
CREATE FUNCTION public.pcm_no_pending_invoice_when_not_requested()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn2$
DECLARE
  v_requested boolean;
  v_display   text;
BEGIN
  -- 🔴 **鎖不是多餘的**(codex R1 must-fix:併發)
  -- 🔴🔴 **而它是 `FOR NO KEY UPDATE` 不是 `FOR UPDATE`**(codex R2 must-fix):
  --    本表對 `orders` 有 FK ⇒ 每一筆 INSERT 都先拿那一列的 **KEY SHARE**;
  --    兩個交易各持 KEY SHARE 再一起升級成 `FOR UPDATE` ⇒ 🔴 **互等 ⇒ 死鎖。**
  --    ⇒ ✅ `FOR NO KEY UPDATE` **擋得住非鍵欄的 UPDATE(我要擋的就是 `invoice_requested`)**,
  --      而**它與 KEY SHARE 不衝突** ⇒ 📌 **要的是【剛好夠強】的鎖, 不是最強的那個。**:沒有它, 本查詢可以與
  --    另一交易的 `true → false` UPDATE **各自通過** ⇒ 最後留下【`false` 的單 + pending 列】。
  --    ⇒ 📌 **兩道門各自都對, 而它們之間沒有互相排隊 ⇒ 中間那個瞬間沒有人守。**
  SELECT o.invoice_requested, o.display_id INTO v_requested, v_display
    FROM public.orders o WHERE o.id = NEW.order_id FOR NO KEY UPDATE;
  -- 🔴 查無那張單 ⇒ **不擋**:那是 FK 的工作, 不是本門的。
  IF v_requested IS FALSE THEN
    RAISE EXCEPTION
      '這張單決定不開發票, 不建立待開票紀錄。要開請作廢重開。(訂單 %)', v_display
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn2$;

REVOKE ALL ON FUNCTION public.pcm_no_pending_invoice_when_not_requested() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_no_pending_invoice_when_not_requested() FROM anon, authenticated;

COMMENT ON FUNCTION public.pcm_no_pending_invoice_when_not_requested() IS
  'pending_invoices 的守門:orders.invoice_requested = false 的單不得建立待開票紀錄(Sean 2026-09-04 第十九題拍甲)。🔴 掛在【表】上不是改 record_pending_invoice() —— 一道掛在表上的門對所有寫入路徑都成立。';

-- 🔴🔴 **`INSERT OR UPDATE` 不是只有 `INSERT`**(codex R2 must-fix):
--    ⛔ 只守 INSERT 的話, 這條路是開的 —— **先替 `true` 的單建 pending 列, 再把那一列的
--       `order_id` UPDATE 成 `false` 的單**:BEFORE INSERT 不觸發, 而 FK 與 UNIQUE 都通得過。
--    ⇒ 📌 **又一次「我只守了一個入口」** —— 而那正是本片一開始三條 must-fix 的同一個病。
CREATE TRIGGER zzz_pcm_no_pending_invoice_when_not_requested
  BEFORE INSERT OR UPDATE ON public.pending_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.pcm_no_pending_invoice_when_not_requested();

ALTER TABLE public.pending_invoices
  ENABLE ALWAYS TRIGGER zzz_pcm_no_pending_invoice_when_not_requested;

-- ── 守門(三):`record_pending_invoice()` 對 `false` 的單【安靜跳過】不丟例外 ────────
-- 🔴🔴 **這一段推翻了我自己寫在上面的一句話**(codex R1 must-fix):
--   ⛔ ~~我寫「它會丟例外而不是安靜跳過, 那是刻意的 —— 安靜跳過會讓付款流程以為自己成功了」~~
--   🔬 **而 codex 去讀了呼叫端**(`packages/use-cases/src/settle-charge.ts:596-604`, 我複驗過):
--      那是 `bestEffortRecordInvoice`, `Promise<void>`、**整段包在 try/catch 裡、回傳值根本沒人看**
--      ⇒ ✅ **例外【不會】弄掛付款(我那半是錯的)**
--      ⇒ 🔴 **而真正的後果是:每一張【正常的】不開發票訂單, 都會被當成故障**
--         ⇒ **重入持續重試 + 寫一行「待開票留 sweeper 重入自癒」的錯誤 log。**
--   📌 **⇒ 我的原則是對的(安靜跳過危險), 而【對這個呼叫端】是錯的** ——
--      **而我沒有去讀那個呼叫端就寫下了「刻意的」三個字。**
--
-- ✅ **修法:那支函式自己先問一句, 是 `false` 就回 `false`(= 沒有新增待開票列)。**
-- ⚠️ **而回傳值的語意要說清楚**:`false` 現在有**三個來源**(重入 / 不需開票 / 沒插入)——
--   🔬 **而它今天【沒有消費者】**(唯一呼叫端是 `Promise<void>`, 不看回傳值)
--   ⇒ 📌 **所以疊第三個意思進去今天不痛;而【有人開始讀它的那一天】這裡要先拆。**
--   🛑 那道掛在 `pending_invoices` 上的 trigger **仍然丟例外, 而那是對的** ——
--      它守的是**其他寫入路徑**(直接 INSERT / 未來的碼), 那些不是 best-effort。
CREATE OR REPLACE FUNCTION public.record_pending_invoice(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $rpi$
DECLARE
  v_generic_msg constant text := 'record_pending_invoice: 無法記錄';  -- 通用訊息(不洩內部)
  v_status    public.payment_status;
  v_requested boolean;
  v_inserted  boolean;
BEGIN
  -- 入口 + fail-closed 防呆:訂單存在且為 paid 才記待開票(p_order_id NULL → NOT FOUND → RAISE)
  SELECT payment_status, invoice_requested INTO v_status, v_requested
    FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND OR v_status <> 'paid'::public.payment_status THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 🔵 **這張單決定不開發票 ⇒ 不是故障, 是【不需要】** ⇒ 安靜回 false。
  IF v_requested IS FALSE THEN
    RETURN false;
  END IF;

  INSERT INTO public.pending_invoices (order_id)
  VALUES (p_order_id)
  ON CONFLICT (order_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;  -- true=首見(該單新記待開)/ false=重入、或不需開票
END
$rpi$;

-- 🔴 `CREATE OR REPLACE` **參數型別沒變 ⇒ 保留舊 ACL**(唯 `payment_confirmer`)。
-- 🔴🔴 **而那句話有一個前提:【它本來就在】**(codex R2 must-fix):
--    ⛔ 若那支函式**不存在**, `OR REPLACE` 會**新建一支** ⇒ **拿到預設 ACL, 不是舊的**
--    ⇒ 一支 `SECURITY DEFINER` 帶著錯的權限落地, 而**我的斷言清單裡沒有它** ⇒ 沒有東西會叫。
--    ⇒ ✅ **前置閘已加一格確認它存在**(見上方);而它也**進了下方的收權斷言清單**。

COMMENT ON FUNCTION public.record_pending_invoice(uuid) IS
  'M-3 3DS-0c:settleCharge 成交(paid)點冪等記「該單待開票」。INSERT ON CONFLICT DO NOTHING、回 inserted。fail-closed:非 paid 單通用 RAISE。🔴 2026-09-04 加:orders.invoice_requested = false 的單【安靜回 false】不丟例外 —— 呼叫端是 best-effort(settle-charge.ts:596),丟例外會讓每一張正常的不開發票訂單被當成故障重試。⚠️ 回傳 false 現有三個來源(重入 / 不需開票 / 沒插入),而今天沒有消費者;有人開始讀它時要先拆。只 payment_confirmer 可呼。';

-- ── 落地斷言 ───────────────────────────────────────────────────────────────
DO $post$
DECLARE
  v_t   pg_catalog.pg_trigger%ROWTYPE;
  v_t2  pg_catalog.pg_trigger%ROWTYPE;
  v_cdef text;
BEGIN
  SELECT * INTO v_t FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid = 'public.orders'::regclass
     AND t.tgname  = 'zzz_pcm_invoice_requested_false_is_final'
     AND NOT t.tgisinternal;
  IF v_t.tgname IS NULL THEN
    RAISE EXCEPTION '落地斷言失敗:trigger 不在 orders 上';
  END IF;
  IF v_t.tgfoid <> 'public.pcm_invoice_requested_false_is_final()'::regprocedure THEN
    RAISE EXCEPTION '落地斷言失敗:trigger 綁的不是本檔那支函式 ⇒ 實際 %', v_t.tgfoid::regprocedure;
  END IF;
  -- tgtype:bit0=ROW · bit4=UPDATE ⇒ AFTER+ROW+UPDATE = 1 + 16 = 17
  IF v_t.tgtype <> 17 THEN
    RAISE EXCEPTION '落地斷言失敗:不是 AFTER UPDATE FOR EACH ROW ⇒ tgtype=%', v_t.tgtype;
  END IF;
  IF v_t.tgqual IS NOT NULL THEN
    RAISE EXCEPTION '落地斷言失敗:帶了 WHEN 條件 ⇒ 一個永假的 WHEN 等於沒有守門';
  END IF;
  IF v_t.tgattr::text <> '' THEN
    RAISE EXCEPTION '落地斷言失敗:帶了欄位限定(UPDATE OF …)⇒ 前面的 trigger 改掉該欄時它不會觸發';
  END IF;
  IF v_t.tgenabled <> 'A' THEN
    RAISE EXCEPTION '落地斷言失敗:不是 ENABLE ALWAYS ⇒ session_replication_role=replica 繞得過去';
  END IF;

  -- 收權那半改用 repo 的具名清單形狀 —— 見本檔下方 $newobj_guard$。
  --    🔴 **而那不是風格問題**:`scripts/migration-static-checks.sh:573` 那道閘**數的是【那份清單】**,
  --    不是我寫了幾行斷言 ⇒ 📌 **它防的是「忘記【列】」, 而不是「忘記【收】」** ——
  --    我第一版把 ACL 檢查寫成內聯, 收權其實做對了, **而閘照樣紅, 且它紅得對**:
  --    **一份沒有清單的斷言, 下一個人加了第二個物件時不會有東西提醒他。**

  -- 🔴 **第二支 trigger 也要逐格驗**(codex R1 must-fix:落地斷言只驗第一支
  --    ⇒ 第二支被停用 / 綁錯函式 / 事件時機錯, 本檔仍會宣告成功)。
  SELECT * INTO v_t2 FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid = 'public.pending_invoices'::regclass
     AND t.tgname  = 'zzz_pcm_no_pending_invoice_when_not_requested'
     AND NOT t.tgisinternal;
  IF v_t2.tgname IS NULL THEN
    RAISE EXCEPTION '落地斷言失敗:第二支 trigger 不在 pending_invoices 上';
  END IF;
  IF v_t2.tgfoid <> 'public.pcm_no_pending_invoice_when_not_requested()'::regprocedure THEN
    RAISE EXCEPTION '落地斷言失敗:第二支綁的不是本檔那支函式 ⇒ 實際 %', v_t2.tgfoid::regprocedure;
  END IF;
  -- tgtype:bit0=ROW · bit1=BEFORE · bit2=INSERT · bit4=UPDATE ⇒ 1 + 2 + 4 + 16 = 23
  IF v_t2.tgtype <> 23 THEN
    RAISE EXCEPTION '落地斷言失敗:第二支不是 BEFORE INSERT OR UPDATE FOR EACH ROW ⇒ tgtype=%', v_t2.tgtype;
  END IF;
  IF v_t2.tgqual IS NOT NULL THEN
    RAISE EXCEPTION '落地斷言失敗:第二支帶了 WHEN 條件';
  END IF;
  IF v_t2.tgenabled <> 'A' THEN
    RAISE EXCEPTION '落地斷言失敗:第二支不是 ENABLE ALWAYS';
  END IF;

  -- 🔴 **而本片最主要的那道門是 `CHECK`, 它更要驗** —— 少了它, 上面每一格照樣綠。
  -- 🔴🔴 **比【定義】不是比【名字】**(codex R2 must-fix):同名的 CHECK 可以被換成 `CHECK(true)`
  --    ⇒ 名字在、`convalidated` 也是真 ⇒ **只驗名字的斷言會宣告「完好」而它什麼都不擋。**
  --    📌 **⇒ 這一招我今天上午在另一支 migration 用過(前置閘逐字比對), 而【沒有用在這裡】。**
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_cdef
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.orders'::regclass
     AND c.conname  = 'orders_no_invoice_when_not_requested'
     AND c.contype  = 'c'
     AND c.convalidated;
  IF v_cdef IS DISTINCT FROM
     'CHECK ((invoice_requested OR ((invoice_status <> ''issued''::text) AND (invoice_number IS NULL) AND (invoice_amount IS NULL))))' THEN
    RAISE EXCEPTION
      '落地斷言失敗:那道 CHECK 不在 / 未驗證 / 或定義被換過 ⇒ 實際是 %', COALESCE(v_cdef, '(不存在)');
  END IF;

  -- ⚠️⚠️ **本檔【沒有】寫入探針, 而那是刻意的**(同片前一支的 codex must-fix):
  --   ① 它會改到**真的訂單** ② 回滾撤不回外部副作用
  --   ③ 🔴 一個吞「任何 `check_violation`」的正對照, **會替它要驗的東西背書**
  --      (別的 CHECK 擋下時, 本守門失效也印綠)。
  --   ✅ 行為的證明放在**拋棄式 PG**, 而**那份 fixture 的射程**要一起讀:
  --      它沒有正式表的其他 CHECK / trigger / RLS / 權限
  --      ⇒ **證得到「這道 trigger 自己會動」, 證不到「在正式庫那一堆東西之間它仍然會動」。**
END
$post$;

-- ── 新物件收權斷言(repo 標準形狀;`migration-static-checks.sh` ③ 數的就是這份清單)──
DO $newobj_guard$
DECLARE
  -- 🔴 結尾的 ::text[] 不能拿掉 —— 清單清空時 ARRAY[] 無法推斷型別。
  v_relations text[] := ARRAY[]::text[];
  v_functions text[] := ARRAY[
    'public.pcm_invoice_requested_false_is_final()',
    'public.pcm_no_pending_invoice_when_not_requested()',
    -- 🔴 本檔 `CREATE OR REPLACE` 了它 ⇒ **它的 ACL 也是本檔的責任**(codex R2 must-fix)。
    'public.record_pending_invoice(uuid)'
  ]::text[];
  r         text;
  v_oid     oid;
  v_bad     int := 0;
  v_first   text;
  v_checked int := 0;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    v_oid := to_regprocedure(r);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '新物件收權斷言:找不到函式 % —— 簽名打錯或沒建成。拒繼續。', r;
    END IF;
    v_checked := v_checked + 1;
    IF has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      v_bad := v_bad + 1;
      IF v_first IS NULL THEN v_first := format('%s 上仍有 EXECUTE', r); END IF;
    END IF;
    -- 🔴 `has_function_privilege` 對 PUBLIC 那一半答不出來 ⇒ 直接讀 ACL(grantee = 0 就是 PUBLIC)。
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc pr, aclexplode(pr.proacl) a
       WHERE pr.oid = v_oid AND a.grantee = 0
    ) THEN
      v_bad := v_bad + 1;
      IF v_first IS NULL THEN v_first := format('%s 上 PUBLIC 仍有授權', r); END IF;
    END IF;
    -- 🔴 而 ACL 是 NULL ⇒ 「沒有明寫收權」的形狀 ⇒ PUBLIC 看不見, 而那不是我下的 REVOKE 造成的
    --    ⇒ 本檔明寫了兩道 REVOKE ⇒ 這裡必須非 NULL, 否則那兩行沒生效。
    IF (SELECT pr.proacl FROM pg_catalog.pg_proc pr WHERE pr.oid = v_oid) IS NULL THEN
      v_bad := v_bad + 1;
      IF v_first IS NULL THEN v_first := format('%s 的 ACL 是 NULL ⇒ 那兩道 REVOKE 沒生效', r); END IF;
    END IF;
  END LOOP;

  IF v_checked = 0 THEN
    RAISE EXCEPTION '新物件收權斷言:檢查數為 0 —— 這個斷言沒有分母, 不算通過。';
  END IF;

  -- 🔴 `record_pending_invoice` 還要驗它的**正向那一半** —— 上面那圈只問「有沒有多的」,
  --    而**「該有的還在不在」是另一個宣稱**(它原本唯 `payment_confirmer` 可執行)。
  IF NOT has_function_privilege('payment_confirmer', 'public.record_pending_invoice(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION
      '收權斷言失敗:record_pending_invoice 的 payment_confirmer EXECUTE 不見了 ⇒ 付款流程會叫不動它。';
  END IF;
  IF has_function_privilege('service_role', 'public.record_pending_invoice(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '收權斷言失敗:record_pending_invoice 被 service_role 拿到 EXECUTE。';
  END IF;
  IF v_bad > 0 THEN
    RAISE EXCEPTION
      E'❌ 新物件收權斷言失敗:仍持有 % 項權限(第一個:%)。檢查了 % 個物件。\n'
      '   ⇒ 補上:REVOKE ALL ON FUNCTION <簽名> FROM PUBLIC, anon, authenticated;\n'
      '   🔴 兩道都要下:FROM PUBLIC 收不到具名授權, FROM 具名 收不到 PUBLIC 授權。',
      v_bad, v_first, v_checked;
  END IF;
END
$newobj_guard$;

COMMIT;

-- ============================================================
-- 🔙 **回退 —— 這一段【可以整段貼】, 因為它不動任何資料**
--   ⛔ ~~上一版只移除第一組~~(codex R1 must-fix)⇒ **`pending_invoices` 那組會永久殘留**,
--      而**殘留的那道門會繼續擋** —— 一個「已經回退了」的系統裡, 還有一道沒有人記得的門在拒絕寫入。
--   BEGIN;
--     DROP TRIGGER IF EXISTS zzz_pcm_invoice_requested_false_is_final ON public.orders;
--     DROP TRIGGER IF EXISTS zzz_pcm_no_pending_invoice_when_not_requested ON public.pending_invoices;
--     DROP FUNCTION IF EXISTS public.pcm_invoice_requested_false_is_final();
--     DROP FUNCTION IF EXISTS public.pcm_no_pending_invoice_when_not_requested();
--     ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_no_invoice_when_not_requested;
--   COMMIT;
--
-- ⚠️ **而 `record_pending_invoice()` 的那一段【不在這裡】** —— 它是 `CREATE OR REPLACE`,
--    回退它要把**舊定義整支貼回去**(在 `20260613140000:252-276`)。
--    🔴 **而在回退它之前先想一件事**:舊定義**不讀 `invoice_requested`**
--    ⇒ 貼回去之後, `false` 的單會重新開始被記待開票。
--
-- 🛑 **拆掉之後, 「決定不開發票」就沒有任何東西在守** —— 三條路全部重新打開。
-- ============================================================
