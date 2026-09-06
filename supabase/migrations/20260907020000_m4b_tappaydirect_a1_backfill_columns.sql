-- ⟦b4-TAPPAYDIRECT⟧ 片 A1(被動):`order_refunds` 加補登三欄 + 作廢三欄 + 進 immutable guard
--                     + 一個讀取介面 + 兩道 REVOKE。
--
-- ══ 🛑 本片【上線之後系統行為與今天完全相同】—— 那是刻意的 ═══════════════════════
--   六欄全部 nullable、既有列全是 NULL;**沒有任何入口寫得進來**(補登 RPC 在片 C 才存在,
--   不是「存在而沒人叫」)。⇒ 這一片單獨上線**不會**讓系統進入一個比今天更糟的中間狀態。
--   📎 來源:codex R2 框架四 must-fix #8 —— 原本「資料層先上」的順序會讓補登進得了帳,
--      而舊畫面把它當成一筆正常退款。⇒ 順序改成「被動 → 看得見 → 才啟用」。
--
-- ══ 🔵 骨架逐字抄 `20260820090000_m4b_e10_d3a_manual_refund_void_columns.sql` ══════
--   那一支對 `order_manual_refunds` 做過同一件事(加作廢三欄), 而且**它當初也是
--   「先加欄(被動), 另一片才改 `pcm_order_refundable_remaining`」** ⇒ 本片的 A1/A2 拆法
--   不是新發明, 是這個 repo 的既有做法。欄名與 CHECK 形狀**照它, 不自創**
--   (`voided_at` / `void_reason` / `voided_by`, 不叫 `void_at`)。
--
-- ══ 拍板鏈 ══════════════════════════════════════════════════════════════════
--   Sean 2026-09-06 21:58「q4: 甲」= 要留紀錄, 做補登入口
--   Sean 2026-09-07 00:1x「q29: 甲」= **信員工**(他在 TapPay 後台看到成功再登記, 系統不去問)
--   Sean 2026-09-07 00:3x「q33: 甲」= plan v2 整份批(含 cap guard 窄讓路)
--   mainB 2026-09-07  = A1/A2 拆片;**砍掉 `void_kind`**(見下方 §2 那段)
--
-- 🔴 **`record_refunded_before` 那一欄本片不動, 而補登路徑會填 0 —— 那個 0 是【未知】不是【零】。**
--    🔬 而它不污染任何金額計算, 這是量到的:全庫掃「哪些函式的 body 提到 record_refunded_before」
--       ⇒ **只有 2 支**(`admin_initiate_order_refund` 與 `pcm_a7c_refund_immutable_guard`),
--       **兩支都不是算錢的**;`pcm_order_refundable_remaining` 完全不讀它。
--    ⇒ 而「不污染計算」≠「不會誤導人」⇒ 讀取介面(§4)讓它對補登列回 NULL。

BEGIN;

-- ══ 0. 前置閘 ═══════════════════════════════════════════════════════════════
DO $pre$
DECLARE
  v_cnt     integer;
  v_control integer;
BEGIN
  -- P1. 目標表在
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'order_refunds';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'A1 前置閘 P1:找不到 public.order_refunds(命中 %);拒繼續', v_cnt;
  END IF;

  -- P2. 六欄【還沒有】。本支不冪等 —— 重跑會停在這裡, 而那是刻意的。
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.order_refunds'::regclass AND NOT attisdropped
     AND attname IN ('backfilled_source', 'backfill_attested_by', 'backfill_attested_at',
                     'voided_at', 'void_reason', 'voided_by');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A1 前置閘 P2:本支要加的六欄已存在 % 欄 ⇒ 已 apply 過(或有人手動加過);拒繼續。'
                    '🔴 這不是「有人破壞了什麼」—— 本支不冪等, 重跑本來就會停在這裡', v_cnt;
  END IF;

  -- 🔴 P3. **正向對照** —— 沒有它, P2 的 0 同時相容於「六欄不存在」與「我的查詢對任何欄名都回 0」。
  SELECT count(*) INTO v_control FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.order_refunds'::regclass AND NOT attisdropped
     AND attname IN ('order_id', 'bank_refund_id', 'record_refunded_before');
  IF v_control <> 3 THEN
    RAISE EXCEPTION 'A1 前置閘 P3(正向對照):本該命中的三個既有欄只命中 % 個 ⇒ '
                    '**我的量法壞了, 不是資料庫壞了** ⇒ P2 的 0 不可信;拒繼續', v_control;
  END IF;

  -- P4. `pcm_b2_is_blank` 在, 而且語意是我們以為的那個(配對 CHECK 的另一半靠它)。
  --     🔵 三個世界當場表演一次 —— 只驗「函式存在」不夠。
  IF to_regprocedure('public.pcm_b2_is_blank(text)') IS NULL THEN
    RAISE EXCEPTION 'A1 前置閘 P4:找不到 public.pcm_b2_is_blank(text);拒繼續';
  END IF;
  IF NOT (public.pcm_b2_is_blank(NULL) AND public.pcm_b2_is_blank(U&'\3000')
          AND NOT public.pcm_b2_is_blank('x')) THEN
    RAISE EXCEPTION 'A1 前置閘 P4b:pcm_b2_is_blank 的行為不是預期的三格;它被改過, 拒繼續';
  END IF;

  -- P5. immutable guard 在 —— 🔴 而「函式在」不等於「它在守這張表」(codex A1 R1 nit):
  --     函式可以存在而 trigger 沒綁、或綁了而被 `tgenabled='D'` 停用 ⇒ 那個世界裡它一句話都不會說。
  --     ⇒ 三件分開驗:函式在 / trigger 綁在這張表上 / 它是開著的。
  IF to_regprocedure('public.pcm_a7c_refund_immutable_guard()') IS NULL THEN
    RAISE EXCEPTION 'A1 前置閘 P5:找不到 pcm_a7c_refund_immutable_guard();拒繼續';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                  WHERE t.tgrelid = 'public.order_refunds'::regclass AND NOT t.tgisinternal
                    AND t.tgfoid = 'public.pcm_a7c_refund_immutable_guard()'::regprocedure) THEN
    RAISE EXCEPTION 'A1 前置閘 P5b:那支 guard 存在, 而【沒有綁在 order_refunds 上】'
                    '⇒ 我以為在守的東西沒有人在守;拒繼續';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
              WHERE t.tgrelid = 'public.order_refunds'::regclass AND NOT t.tgisinternal
                AND t.tgfoid = 'public.pcm_a7c_refund_immutable_guard()'::regprocedure
                AND t.tgenabled = 'D') THEN
    RAISE EXCEPTION 'A1 前置閘 P5c:那支 guard 綁著而是【停用】狀態;拒繼續';
  END IF;

  RAISE NOTICE 'A1 前置閘 P1-P5 全過(P3 正向對照 = %, 證明 P2 的 0 有判別力)。', v_control;
END
$pre$;

-- ══ 1. 補登三欄 ═════════════════════════════════════════════════════════════
-- 🔴🔴 **四欄不是三欄, 而第四欄是我一個【錯的結論】換來的**(2026-09-07, 自己揭)
--   我原本打算把「這筆退款在 TapPay 那邊實際發生的時刻」寫進既有的 `confirmed_at`。
--   codex R1 #1 說「immutable guard 會把它覆寫成 now()」, 而我**回報說我實測推翻了它**。
--   🛑 **我錯了, 而且那個錯我報上去兩次。**
--   🔬 成因量得出來:那支 guard 的 body 是 **83 行**, 而我讀到 **~55 行**(4.1–4.8)就下結論。
--      第 **76-78 行**逐字:`-- 4.6 confirmed_at 由 DB 決定(凍結呼叫端可造假的時間=沒有意義)`
--      接著 `NEW.confirmed_at := now();`
--   📌 **我讀的那一段(4.3 write-once「允許 NULL→值」)本身是對的 —— 而它不是全部。**
--      ⇒ **「我讀到的東西是真的」與「我讀完了」是兩件事**, 而前者讀起來很像後者。
--   ✅ **而正解不是去改那道 guard** —— 4.6 那句理由(呼叫端可造假的時間沒有意義)**對補登一樣成立**:
--      補登的時刻正是**員工自己填的**, 那是這一片裡最可能被填錯的一格。
--      ⇒ 兩個時刻**分開放**:`confirmed_at` = 我們把它記進帳本的時刻(DB 決定, 不動);
--        `backfill_occurred_at` = 員工說它在外面發生的時刻(**他的說法, 不是我們的事實**)。
ALTER TABLE public.order_refunds
  ADD COLUMN backfilled_source    text,
  ADD COLUMN backfill_attested_by text,
  ADD COLUMN backfill_attested_at timestamptz,
  ADD COLUMN backfill_occurred_at timestamptz;

-- 🔴 **值域用 `IN (...)` 而不是 `= '…'`** —— 之後多一種來源不必改 CHECK 的形狀。
--    (codex R2 nit #13:單一值 CHECK 會讓下一種來源沒地方放。)
ALTER TABLE public.order_refunds
  ADD CONSTRAINT order_refunds_backfill_trio
    CHECK (pg_catalog.num_nonnulls(backfilled_source, backfill_attested_by,
                                   backfill_attested_at, backfill_occurred_at) IN (0, 4)
           AND (backfilled_source    IS NULL OR backfilled_source IN ('tappay_console'))
           AND (backfill_attested_by IS NULL OR NOT public.pcm_b2_is_blank(backfill_attested_by)));

COMMENT ON COLUMN public.order_refunds.backfilled_source IS
  '⟦b4-TAPPAYDIRECT⟧ 這一列是【在我們系統外面完成、事後補登進來】的, 值 = 那個外面是哪裡。'
  'NULL = 一般路徑(我們自己發起的退款)。'
  '🔴 它是【給機器認的】—— 不寫進 reason 的理由:reason 是自由文字, 員工每次寫法都不同, 對帳程式認不出來。';
COMMENT ON COLUMN public.order_refunds.backfill_attested_by IS
  '⟦b4-TAPPAYDIRECT⟧ 是誰擔保「我在 TapPay 後台親眼看到這筆退款成功」。'
  '🔴 Sean 2026-09-07 q29 拍【甲 = 信員工】, 而【信】要留下【誰在什麼時候擔保】—— 不然它不是互信, 是無主。';
COMMENT ON COLUMN public.order_refunds.backfill_attested_at IS
  '⟦b4-TAPPAYDIRECT⟧ 他按下擔保的那一刻(由 DB 給, 不是員工填的)。';
COMMENT ON COLUMN public.order_refunds.backfill_occurred_at IS
  '⟦b4-TAPPAYDIRECT⟧ 員工說「這筆退款在 TapPay 那邊是這個時候發生的」。'
  '🔴🔴 **它與 confirmed_at 是兩件事, 而混用會出事**:'
  'confirmed_at 由 DB 給(guard 第 4.6 段逐字「confirmed_at 由 DB 決定 —— 凍結呼叫端可造假的時間=沒有意義」,'
  '它會被 now() 覆寫);本欄是**員工的說法**, 而那正是這一片裡最可能被填錯的一格。'
  '⇒ 📌 對帳時要知道你在問哪一個:「我們什麼時候記的」用 confirmed_at,「錢什麼時候動的」用本欄(而它未經查證)。';

-- ══ 2. 作廢三欄 ═════════════════════════════════════════════════════════════
-- 🔴🔴 **為什麼要作廢欄, 而不是「把 status 轉回 failed」** —— 那條路【走不通】, 這是量到的:
--    `pcm_order_refund_status_transition` 逐字只允許 `OLD.status='processing'` → {confirmed, failed, deferred}
--    ⇒ **`confirmed → failed` 直接 RAISE**「confirmed/failed/deferred 皆為終態」;
--    而 4.3 結案欄 write-once + 4.4 confirmed 必帶 DR 碼 ⇒ 改 status 這條路整個關著。
--    📌 而補登列**一出生就是 confirmed**(它記的是一件已經發生的事)⇒ 它需要自己的作廢管道。
--
-- 🔴 **⛔ ~~本來還有第四欄 `void_kind ('never_happened' | 'wrong_amount')`~~ —— mainB 2026-09-07 砍掉, 而它是對的。**
--    我原本想讓 `wrong_amount` 的作廢列**仍然被算**(理由:那筆錢真的動了)。
--    🔬 而走過四個情境之後, 「作廢列仍算」**沒有一次是對的**:
--      · 記 100 而實際退 200 ⇒ 作廢列仍算 + 重補 200 ⇒ 帳上 300 / 實際 200 ⇒ **多扣 100**
--      · 記 200 而實際退 100 ⇒ 帳上 300 / 實際 100 ⇒ **多扣 200**
--      · 記錯訂單     ⇒ 那筆錢動在**別張單**上, 留在這張單算 = 純錯
--      · 重複補登     ⇒ 那筆錢由**另一列**承載, 作廢列再算 = 重複
--    ⇒ 🎯 **「錢動了」這件事永遠由【留下來的那一列】承載, 不由作廢列承載。**
--    ⇒ 少一個狀態、少一條算錢的分支、少一格突變。
-- ⚠️ **而砍掉它露出一個殘餘風險, 照實寫**:作廢之後到重新補登之前, 帳上**少算了一筆真的動過的錢**
--    ⇒ `remaining` 被**高估** ⇒ 這時發起真退款可能超額。緩解兩層(都已存在):
--    ① 作廢 RPC 的訊息叫他**立刻**重補 ② 真的超了 `pcm_sync_order_refund_payment_status`
--    第 82-89 行會開 `refund_over_total` incident。**不是零風險, 是有記錄的風險。**
ALTER TABLE public.order_refunds
  ADD COLUMN voided_at   timestamptz,
  ADD COLUMN void_reason text,
  ADD COLUMN voided_by   text;

ALTER TABLE public.order_refunds
  ADD CONSTRAINT order_refunds_void_trio
    CHECK (pg_catalog.num_nonnulls(voided_at, void_reason, voided_by) IN (0, 3)
           AND (void_reason IS NULL OR NOT public.pcm_b2_is_blank(void_reason))
           AND (voided_by   IS NULL OR NOT public.pcm_b2_is_blank(voided_by))
           -- 🔴🔴 **只有補登列作廢得了。** 少了這一句, 這組欄位就變成
           --    「任何一筆真的卡片退款都可以被標成作廢」的入口 —— 而那是本片沒有被授權做的事。
           AND (voided_at IS NULL OR backfilled_source IS NOT NULL));

COMMENT ON COLUMN public.order_refunds.voided_at IS
  '⟦b4-TAPPAYDIRECT⟧ 這一筆【補登】被作廢的時刻。NULL = 沒被作廢。'
  '🔴 只有 backfilled_source 非 NULL 的列填得了它(order_refunds_void_trio 那道 CHECK)。'
  '🔴 A1 這一片只加欄 —— **算錢的兩支函式還沒有排除它**(那是片 A2)⇒ '
  '在 A2 上線前, 填了它【不會改變任何金額】。';
COMMENT ON COLUMN public.order_refunds.void_reason IS
  '⟦b4-TAPPAYDIRECT⟧ 為什麼作廢(自由文字)。'
  '⛔ ~~原本要配一個封閉集 void_kind (never_happened / wrong_amount)~~ —— mainB 2026-09-07 砍掉:'
  '「錢動了」永遠由【留下來的那一列】承載, 所以作廢一律排除, 不必分兩種。';
COMMENT ON COLUMN public.order_refunds.voided_by IS
  '⟦b4-TAPPAYDIRECT⟧ 誰作廢的。對本表而言「誰作廢的」沒有第二個落點 ⇒ 不加這一欄就等於不記錄。';

-- ══ 3. 七欄的 write-once ═══════════════════════════════════════════════════
-- 🔴🔴 **做成【第二支 trigger】, 而不是把 `pcm_a7c_refund_immutable_guard` 重寫一遍 ——
--        而這個選擇是為了避開一個 repo 記過的坑。**
--   要把七欄塞進既有那支, 我得 `CREATE OR REPLACE` 它, 而那表示**把 83 行 body 整個重打一次**。
--   🛑 那條路上有三個已知的地雷(memory 各有一條):
--     ① `CREATE OR REPLACE` 會把 `SET` 子句**整組換掉** ⇒ 漏抄 `search_path` = 安靜地把安全強化打回去
--     ② 逐字抄回舊檔只還原 body ⇒ **body md5 一模一樣而 proconfig 已經不同**, 錨照樣印綠
--     ③ 83 行裡任何一句抄漏, **三綠不會紅**(它是 DB 內容, 不是 TS)
--   ⇒ ✅ **新增一支只做一件事的 trigger** —— 它 20 行、它只 RAISE、它不碰 NEW 的任何欄位
--     ⇒ 兩支 BEFORE UPDATE 的**先後順序對結果沒有影響**(我這支不改值)。
--   📌 **⇒ 用「加一個小的」換掉「重寫一個大的」, 少一個抄錯的面。**
--   ⚠️ 代價明寫:以後查「哪些欄不可變」要看**兩個地方**。⇒ 兩邊的 COMMENT 互指(見下)。

-- 🔴 **裸 `CREATE`, 不是 `CREATE OR REPLACE`** —— `migration-static-checks` 規則① 擋下我一次,
--   而它是對的:這是一個**新物件**, 而 `OR REPLACE` 在新物件上有兩個壞處 ——
--   ① 它讓「本支重跑」從**炸掉**變成**安靜覆蓋**(而本支刻意不冪等, 前置閘 P2 就是在守這件事)
--   ② 它讓讀的人以為「這支之前就有」⇒ 去找一個不存在的前一版。
--   📌 **`OR REPLACE` 是給【已經存在的東西】用的, 而我打字時它只是個反射。**
CREATE FUNCTION public.pcm_a1_backfill_fields_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
-- 🔴 **`SET search_path = ''`(空字串), 不是 `public, pg_temp`** ——
--   `definer-search-path-gate.py` 擋下我一次。我是抄既有那支 guard 的寫法(它是 `public, pg_temp`),
--   而**那支已經 apply 了 ⇒ 它不受這道閘管**;新檔要走現行標準。
--   📌 **抄一支既有實作, 抄得到它的形狀, 抄不到「它是什麼時候寫的」。**
--   ⇒ 空字串表示不解析任何 schema ⇒ **底下每一個物件名都要寫全**(本函式只用 NEW/OLD, 沒有呼叫,
--     所以這一步對它是零成本 —— 而那是運氣, 不是設計)。
SET search_path = ''
AS $fn$
BEGIN
  -- 🔴 形狀與既有 4.3(結案欄 write-once)**逐字對齊**:允許 NULL→值一次, 禁改值、禁抹回 NULL。
  --    少了「禁抹回 NULL」那一半:有寫權的維護程序可以清掉來源與擔保人, 而配對 CHECK 照樣過
  --    ⇒ 留下一列**看起來完全正常的合成退款**(codex R2 must-fix #2 就是這一條)。
  IF (OLD.backfilled_source    IS NOT NULL AND NEW.backfilled_source    IS DISTINCT FROM OLD.backfilled_source)
  OR (OLD.backfill_attested_by IS NOT NULL AND NEW.backfill_attested_by IS DISTINCT FROM OLD.backfill_attested_by)
  OR (OLD.backfill_attested_at IS NOT NULL AND NEW.backfill_attested_at IS DISTINCT FROM OLD.backfill_attested_at)
  OR (OLD.backfill_occurred_at IS NOT NULL AND NEW.backfill_occurred_at IS DISTINCT FROM OLD.backfill_occurred_at) THEN
    RAISE EXCEPTION 'A7c 帳本:補登欄 write-once(退款 %)—— backfilled_source / backfill_attested_by / '
                    'backfill_attested_at / backfill_occurred_at 一經寫入不得再改或抹除', OLD.id
      USING ERRCODE = 'P7C20', CONSTRAINT = 'a1_backfill_fields_write_once';
  END IF;

  IF (OLD.voided_at   IS NOT NULL AND NEW.voided_at   IS DISTINCT FROM OLD.voided_at)
  OR (OLD.void_reason IS NOT NULL AND NEW.void_reason IS DISTINCT FROM OLD.void_reason)
  OR (OLD.voided_by   IS NOT NULL AND NEW.voided_by   IS DISTINCT FROM OLD.voided_by) THEN
    RAISE EXCEPTION 'A7c 帳本:作廢欄 write-once(退款 %)—— voided_at / void_reason / voided_by '
                    '一經寫入不得再改或抹除;作廢是一次性的事實, 不是一個可以來回切的旗子', OLD.id
      USING ERRCODE = 'P7C21', CONSTRAINT = 'a1_void_fields_write_once';
  END IF;

  -- 🔴 **補登欄本身也不得【事後補上】** —— 一列一般退款不可以在事後被標成「其實是補登的」。
  --    (那會讓任何一筆真的卡片退款都能被改寫成合成來源, 而 §2 那道 CHECK 只管作廢那一半。)
  IF OLD.backfilled_source IS NULL AND NEW.backfilled_source IS NOT NULL THEN
    RAISE EXCEPTION 'A7c 帳本:不得事後把一列標成補登(退款 %)—— 補登身分只能在 INSERT 的那一刻決定', OLD.id
      USING ERRCODE = 'P7C22', CONSTRAINT = 'a1_backfill_source_insert_only';
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER order_refunds_a1_backfill_immutable_bu
  BEFORE UPDATE ON public.order_refunds
  FOR EACH ROW EXECUTE FUNCTION public.pcm_a1_backfill_fields_immutable_guard();

COMMENT ON FUNCTION public.pcm_a1_backfill_fields_immutable_guard() IS
  '⟦b4-TAPPAYDIRECT⟧ A1:補登四欄 + 作廢三欄的 write-once。'
  '🔴 它是 pcm_a7c_refund_immutable_guard 的【第二支】, 不是取代 —— '
  '要看「哪些欄不可變」請【兩支都看】。分開的理由寫在 20260907010000 §3。';

-- ══ 4. 讀取介面 ═════════════════════════════════════════════════════════════
-- 🔴🔴 **為什麼不是「寫進 COMMENT 叫下游小心」**(codex R2 must-fix #1):
--   補登列的兩個值會**主動誤導**:
--     · `bank_refund_id` 是合成的 `TPC…`, 而既有稽核標籤(`apps/admin/src/lib/audit/audit-field-label.ts:106`)
--       會把它顯示成**銀行退款編號** ⇒ 有人會拿它去跟銀行對帳。
--     · `record_refunded_before` 補登路徑填 **0, 而那個 0 的意思是【未知】** ⇒ 它會**參與數值運算**。
--   ⇒ 📌 **要讓下游【拿不到】那個值, 而不是拿到之後被期待去理解它。**
--   ⇒ 本 view 對補登列讓那兩欄回 `NULL`。NULL 在數值運算裡會傳染成 NULL ⇒ **算錯會變成算不出來**,
--     而**算不出來會有人來問**。📌 **一個沉默的錯誤值, 比一個吵鬧的空值危險。**
CREATE VIEW public.order_refunds_readable AS
  SELECT r.id, r.order_id,
         CASE WHEN r.backfilled_source IS NULL THEN r.bank_refund_id         ELSE NULL END AS bank_refund_id,
         CASE WHEN r.backfilled_source IS NULL THEN r.record_refunded_before ELSE NULL END AS record_refunded_before,
         r.tappay_refund_id, r.rec_trade_id, r.refund_amount, r.status, r.kind,
         r.reason, r.actor, r.request_id, r.failed_reason, r.failed_detail,
         r.provider_refund_id_evidence, r.created_at, r.confirmed_at,
         r.backfilled_source, r.backfill_attested_by, r.backfill_attested_at, r.backfill_occurred_at,
         r.voided_at, r.void_reason, r.voided_by
    FROM public.order_refunds r;

COMMENT ON VIEW public.order_refunds_readable IS
  '⟦b4-TAPPAYDIRECT⟧ A1:讀 order_refunds 的建議入口。'
  '🔴 對【補登列】(backfilled_source 非 NULL)把 bank_refund_id 與 record_refunded_before 遮成 NULL —— '
  '前者是合成值(從未送 TapPay), 後者的 0 是「未知」不是「零」。'
  '⚠️ 它**不是**權限邊界(底表照樣在), 是一個**不要被誤導**的入口。';

-- ══ 5. 兩道 REVOKE ═════════════════════════════════════════════════════════
-- 🔴 新物件**出生就自帶 PUBLIC 權限** ⇒ 兩道都要, 而且要**顯式列 anon / authenticated**:
--    只 REVOKE FROM PUBLIC 的話, 若哪天有人直接 GRANT 給那兩個角色, 這裡看不出來。
--    📎 docs/patterns/revoking-function-execute-in-supabase.md
REVOKE ALL ON public.order_refunds_readable FROM PUBLIC;
REVOKE ALL ON public.order_refunds_readable FROM anon, authenticated;
-- 🔴🔴 **`service_role` 也要先 REVOKE —— 而這一行是【那道閘抓出來的】, 不是我想到的。**
--   codex 的 must-fix 說「service_role 沒有 SELECT ⇒ 後台會 permission denied」,
--   我照著補了 GRANT, 並順手加了兩個方向的事後閘(⑤c 讀得到 / ⑤d 不准有寫權)。
--   🔬 而 ⑤d **當場紅了**:`has_table_privilege('service_role', view, 'INSERT')` = true。
--   ⇒ 成因:這個叢集有**預設授權**(default privileges)把新物件的權限**整組給 service_role**
--     ⇒ 這個 view **一出生就是可寫的**, 而我的 REVOKE 只點名了 anon / authenticated。
--   📌 **⇒ 兩個人都推錯了方向**:codex 以為它「什麼都沒有」, 我以為「REVOKE 那兩個就夠」——
--     而真相是**它什麼都有**。**是那道【驗另一個方向】的閘把它問出來的, 不是我們任何一個人的推理。**
--   ⚠️ 而這個 view 是**可自動更新**的(單表投影)⇒ 有寫權 = 一條**繞過 CASE 遮罩**寫底表的路。
REVOKE ALL ON public.order_refunds_readable FROM service_role;
-- 🔴🔴 **而 REVOKE 完要記得【給該給的人】** —— codex A1 R1 must-fix:
--   新 view 出生時除了 owner 沒有任何授權, 我只寫了 REVOKE ⇒ **後台(service_role)會 permission denied**,
--   而我的事後閘⑤只驗「anon/authenticated 讀不到」⇒ 📌 **我只驗了一個方向。**
--   ⇒ 「壞人進不來」與「好人進得來」是兩個宣稱, 而一道只驗前者的閘, 在**兩個都壞**的世界裡照樣綠。
-- 🔵 **只給 SELECT, 不給別的** —— 這個 view 是**可自動更新**的(它只是單表投影),
--    給了 INSERT/UPDATE 就等於開了一條繞過 CASE 的寫入路。
GRANT SELECT ON public.order_refunds_readable TO service_role;
REVOKE ALL ON FUNCTION public.pcm_a1_backfill_fields_immutable_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_a1_backfill_fields_immutable_guard() FROM anon, authenticated;
-- 🔴 同上:預設授權會把新函式的 EXECUTE 整組給 service_role ⇒ 這一行不是多餘的。
REVOKE ALL ON FUNCTION public.pcm_a1_backfill_fields_immutable_guard() FROM service_role;

-- ══ 6. 事後閘 ═══════════════════════════════════════════════════════════════
DO $post$
DECLARE
  v_cnt integer;
  v_err text;
  v_id  uuid;
  -- 🔴 **收權斷言的具名清單** —— `migration-static-checks.sh:712` 那道閘要的就是它,
  --    而它擋下我的理由逐字是「收權斷言【只檢查你列出來的物件】:它防『忘記收權』, 不防『忘記列』」。
  --    📌 **我原本各寫了一段 has_*_privilege, 而閘要的是【一份清單】** ——
  --      兩者的差別是:清單會被【數】, 而散在各處的斷言只會被【讀】。
  --    ⇒ 本片有兩個新的可授權物件, 兩個都要在這裡出現。
  v_relations text[] := ARRAY['public.order_refunds_readable']::text[];
  v_functions text[] := ARRAY['public.pcm_a1_backfill_fields_immutable_guard()']::text[];
  v_obj       text;
  v_role      text;
BEGIN
  -- ① 七欄都在
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.order_refunds'::regclass AND NOT attisdropped
     AND attname IN ('backfilled_source','backfill_attested_by','backfill_attested_at',
                     'backfill_occurred_at','voided_at','void_reason','voided_by');
  IF v_cnt <> 7 THEN RAISE EXCEPTION 'A1 事後閘①:七欄只有 % 欄', v_cnt; END IF;

  -- ② 兩個 CHECK 都在
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.order_refunds'::regclass
     AND conname IN ('order_refunds_backfill_trio','order_refunds_void_trio');
  IF v_cnt <> 2 THEN RAISE EXCEPTION 'A1 事後閘②:兩個 CHECK 只有 % 個', v_cnt; END IF;

  -- ③ trigger 掛上了
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                  WHERE tgrelid = 'public.order_refunds'::regclass
                    AND tgname = 'order_refunds_a1_backfill_immutable_bu' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'A1 事後閘③:trigger 沒掛上';
  END IF;
  -- 🔴 ③b **而「掛上了」不等於「開著」** —— `tgenabled = 'D'` 的 trigger 一樣查得到。
  IF (SELECT tgenabled FROM pg_catalog.pg_trigger
       WHERE tgrelid = 'public.order_refunds'::regclass
         AND tgname = 'order_refunds_a1_backfill_immutable_bu') = 'D' THEN
    RAISE EXCEPTION 'A1 事後閘③b:trigger 掛上了但是【停用】狀態';
  END IF;

  -- ④ SET 子句沒掉(`CREATE OR REPLACE` 會把它整組換掉 —— 這一格就是在守那件事)
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='pcm_a1_backfill_fields_immutable_guard'
                    -- 🔴 **真值是 `search_path=""`(帶兩個引號), 不是 `search_path=`。**
                    --    我第一版寫後者 ⇒ **我自己的事後閘把我自己擋下來**(探針實跑紅在這一句)。
                    --    🔬 去問正式庫「已經用空字串的函式, proconfig 長什麼樣」⇒ `{"search_path=\"\""}`
                    --    (`create_order` / `supersede_charge_attempt_for_user` / `prl_append_only_guard` … 五支同形)。
                    --    📌 **`SET search_path = ''` 是我【寫下去】的字面, `search_path=""` 是它【存起來】的字面**
                    --      —— 而斷言要比對的是後者。兩者長得像, 而只有一個是真的。
                    AND p.proconfig @> ARRAY['search_path=""']) THEN
    RAISE EXCEPTION 'A1 事後閘④:新 trigger 函式的 search_path 不是空字串';
  END IF;

  -- ⑤ view 在, 而且 anon / authenticated 讀不到
  IF to_regclass('public.order_refunds_readable') IS NULL THEN
    RAISE EXCEPTION 'A1 事後閘⑤:view 不在';
  END IF;
  IF has_table_privilege('anon','public.order_refunds_readable','SELECT')
     OR has_table_privilege('authenticated','public.order_refunds_readable','SELECT') THEN
    RAISE EXCEPTION 'A1 事後閘⑤b:anon / authenticated 讀得到 order_refunds_readable ⇒ REVOKE 沒生效';
  END IF;
  -- 🔴 ⑤c **另一個方向** —— 沒有這一格, ⑤b 的綠同時相容於「REVOKE 對了」與「這個 view 誰都讀不到」。
  IF NOT has_table_privilege('service_role','public.order_refunds_readable','SELECT') THEN
    RAISE EXCEPTION 'A1 事後閘⑤c:service_role 讀不到 order_refunds_readable ⇒ 後台會 permission denied';
  END IF;
  -- 🔴 ⑤e **另一個可授權物件:那支 trigger 函式。**
  --    `migration-new-file-static-checks` 抓到我漏了它 —— 它數出**兩個**可授權物件,
  --    而我的斷言只列了 view 那一個。📌 **我補了 REVOKE 卻沒補【驗它】** ——
  --    而 REVOKE 有沒有生效, 與我有沒有寫那一行 REVOKE, 是兩件事。
  --    ⚠️ trigger 函式由 trigger 機制呼叫、不靠 EXECUTE 權限, 而它 `SECURITY DEFINER`
  --       ⇒ 任何人叫得動就是一條以 owner 身分執行的路。
  IF has_function_privilege('anon','public.pcm_a1_backfill_fields_immutable_guard()','EXECUTE')
     OR has_function_privilege('authenticated','public.pcm_a1_backfill_fields_immutable_guard()','EXECUTE')
     OR has_function_privilege('service_role','public.pcm_a1_backfill_fields_immutable_guard()','EXECUTE') THEN
    RAISE EXCEPTION 'A1 事後閘⑤e:有角色 EXECUTE 得了那支 trigger 函式 ⇒ REVOKE 沒生效';
  END IF;

  -- 🔵 ⑤d 而它**只能讀** —— 這個 view 可自動更新, 給了寫權就等於開一條繞過 CASE 的路。
  IF has_table_privilege('service_role','public.order_refunds_readable','INSERT')
     OR has_table_privilege('service_role','public.order_refunds_readable','UPDATE') THEN
    RAISE EXCEPTION 'A1 事後閘⑤d:service_role 對這個 view 有寫權 ⇒ 那是一條繞過遮罩的寫入路';
  END IF;

  -- 🔴 ⑥ **本片【沒有】改變任何既有列** —— 它是被動片, 這一格是它的定義。
  SELECT count(*) INTO v_cnt FROM public.order_refunds
   WHERE backfilled_source IS NOT NULL OR voided_at IS NOT NULL;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A1 事後閘⑥:有 % 列已經帶了補登/作廢欄 ⇒ 本片不該產生任何這種列', v_cnt;
  END IF;

  -- 🔴 ⑦ **正向對照** —— 沒有它, ⑥ 的 0 同時相容於「真的沒有」與「這張表是空的/我查錯表」。
  SELECT count(*) INTO v_cnt FROM public.order_refunds;
  -- 🔴 **這一格是【通知】不是【閘】, 而那個差別要寫出來**(codex A1 R1 nit):
  --    表是 0 列時它照樣印「全過」⇒ 它證明的只有「⑥ 是在一張有幾列的表上量的」,
  --    **證不到「⑥ 抓得到違規列」** —— 那要有一個已知的違規樣本, 而本片不製造任何列。
  --    ⇒ 讀這行的人:數字是 0 ⇒ ⑥ 這一輪沒有判別力, 不要當成通過。
  RAISE NOTICE 'A1 事後閘⑦(通知, 不是閘):order_refunds 共 % 列。0 ⇒ ⑥ 這一輪零判別力。', v_cnt;

  -- ⑧ 🔴 **照清單逐個收權斷言**(上面 ⑤ 那幾格是針對 view 的細部, 這一格是【分母】)。
  FOREACH v_obj IN ARRAY v_relations LOOP
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF has_table_privilege(v_role, v_obj, 'SELECT') THEN
        RAISE EXCEPTION 'A1 事後閘⑧:% 對 % 仍有 SELECT ⇒ 收權沒生效', v_role, v_obj;
      END IF;
    END LOOP;
  END LOOP;
  FOREACH v_obj IN ARRAY v_functions LOOP
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF has_function_privilege(v_role, v_obj, 'EXECUTE') THEN
        RAISE EXCEPTION 'A1 事後閘⑧:% 對 % 仍有 EXECUTE ⇒ 收權沒生效', v_role, v_obj;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'A1 事後閘①-⑧ 全過(收權清單:% 個 relation / % 個 function)。',
               array_length(v_relations,1), array_length(v_functions,1);
END
$post$;

COMMIT;
