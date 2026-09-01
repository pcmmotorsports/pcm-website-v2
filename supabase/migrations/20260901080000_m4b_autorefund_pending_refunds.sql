-- ============================================================================
-- M-4b:整單取消時【自動開一筆待退款】 —— `order_pending_refunds`
-- ============================================================================
-- Sean 2026-09-01 拍板 **甲**,逐字:
--   「甲 現在就記 (推薦) —— 錢收了沒紀錄, 今天起停止。今天訂單是空的, 零回填」
-- Plan 全文 `docs/plans/2026-09-01-cancel-opens-pending-refund-plan.md`(§2 定案甲)。
--
-- ══ 📋 **貼這支之前先讀這一段(白話,給要按下 Run 的人)** ══════════════════════
--    **這支會做三件事:**
--      ① 新開一張表 `order_pending_refunds` —— 記「這張單被取消了,而我們還欠客人多少錢」。
--      ② 在 `orders` 掛一個 trigger:**整單取消的那一刻**自動逐軌(匯款 / 現金)開一筆。
--      ③ 🔴 **它動了一張【別片的】表**:`order_manual_refunds` 加一個
--         `UNIQUE (id, order_id)`(純加法,`id` 本來就是主鍵 ⇒ 對既有資料零影響)。
--         **那張表是 8/20 那一片建的,不是本片** —— 之所以要動它,是為了讓「哪一筆退款
--         結清了哪一筆待退款」綁得住**同一張訂單**,否則 A 單可以拿 B 單的退款假結清。
--
--    🔴 **貼下去之後會看到什麼(先講,免得被嚇到)**:
--      從此每一張「已收匯款/現金、而被取消」的單都會**正式留下一筆欠款紀錄**。
--      ⚠️ 而今天有一個【已知的、與本片無關的】缺口(板子 `⟦b4-NONCARDPAID1⟧`):
--         **登記匯款收款不會把 `payment_status` 翻成 paid** ⇒ 那種單會被逾期排程自動取消。
--      ⇒ 📌 **所以本支上線後那個數字可能一開始就不小 —— 而那【不是本支造成的】,**
--         **是本支讓一件本來靜悄悄發生的事變得看得見。**
--      🔵 建議與那一列的修法一起上,否則那個數字會看起來像新問題。
--
--    ✅ **它不會做的事**:不改任何既有函式、不動取消流程的其他行為、不改任何既有資料;
--       部分取消**不開**待退款(口徑未定,板子 `⟦b4-PARTCANCEL1⟧`)。
--    ⚠️ **關掉它的方法**(不必重新部署):
--       `ALTER TABLE public.orders DISABLE TRIGGER order_pending_refund_open_au;`
--
-- ══ 🔴🔴 **為什麼是【新表】而不是寫進 `order_manual_refunds`** ═══════════════
--    plan §3 原本建議寫進那張表,而 2026-09-01 開工時被**那張表自己的 COMMENT** 推翻
--    (`20260820010000:185-188`,出處 `Sean 2026-08-20 Q8=乙`「那只是記一筆帳」):
--      「本表記的是【一件已經發生的事】,不是【一個要發起的動作】」
--      「**刻意沒有 status**:… 這【不是還沒加】,是這張表的語意裡沒有那個狀態。」
--    ⇒ 📌 待退款正好是它逐字說它不收的那一種。
--    ⇒ 而形狀上也擋著:`occurred_at NOT NULL` 逐字是「錢**實際**交回去的時刻」——
--      待退款那一刻錢還沒交回去 ⇒ 只能填假值,
--      🔴 **而那個假值與「先退後登記」的真實情況長得一模一樣** ⇒ 它會弄瞎一個原本看得見的區分。
--    ⚠️ 隔壁 `order_refunds` 也不行:`rec_trade_id text NOT NULL`(`20260801120000:195`)= 卡片的 provider 鍵。
--
-- ══ 🔴 **本表的金額【不在】上限函式的分母裡 —— 這是刻意的,而它有到期日** ═════
--    主視窗 `-6f` 2026-09-01 裁:本片**不動** `pcm_manual_refund_rail_cap`,理由是可達性 ——
--      · 手動退款入口今天被 `MANUAL_REFUND_ENTRY_BLOCKED_BY_787` 關著(2026-09-01 複量,兩格前提仍成立)
--      · `service_role` 對 `order_manual_refunds` 只有 `r` ⇒ 沒有角色送得出那個 INSERT(2026-09-01 正式庫唯讀實查)
--      ⇒ **「重複退款」今天沒有可達路徑**,而 `CREATE OR REPLACE` 一支多代函式是**今天就可達**的風險。
--    📌 **用一個今天可達的風險,去防一個今天不可達的風險 ⇒ 那個交換是虧的。**
--    🛑 **而它的到期日寫在下面的 `COMMENT ON TABLE` 裡,並且同時寫進板子的 `#787` 那一列** ——
--       兩個落點缺一不可:**解封的人會去讀 `#787`,他不會去讀一張還沒人用的表的 COMMENT。**
--
-- ══ 🔴 **接線點是 trigger,不是改 `admin_cancel_order`** ══════════════════════
--    `admin_cancel_order` 最新代 445 行(`20260830020000:115-559`)⇒ `CREATE OR REPLACE`
--    整支 = 回捲風險(把後幾代的行為整個倒回去,而三綠不會紅)。
--    ⇒ 改掛 `orders` 的 AFTER UPDATE:`cancelled_at` 由 NULL 變成非 NULL 的那一刻。
--    ✅ **而那個判準比「呼叫時 p_items 是不是 NULL」更對** —— 那一刻正是該函式自己算出
--      `v_closed`(`:525` 逐字「關單判定:寫後全域重算」)並寫 `cancelled_at` 的時候
--      ⇒ 它**涵蓋「一連串部分取消把最後一件也取消掉」**,而 `p_items IS NULL` 涵蓋不到。
--    ✅ 附帶:`ALTER TABLE public.orders DISABLE TRIGGER order_pending_refund_open_au;`
--      = plan §5② 要的那個**不必重新部署**的開關。
--
-- ══ 🛑 已知缺口(刻意不做,不是漏做)═════════════════════════════════════════
--    ① **部分取消不開待退款。** 「部分取消該退多少」是一個沒有人答過的口徑題,
--       🔴 **猜一個金額比不記還糟 —— 它會進上限的分母。**
--       ⇒ **不修會痛在**:部分取消收了的錢,今天起【仍然】零紀錄。板子另開一列。
--    ② **`settled_at` / `voided_at` 今天零寫入端。** 消化那一端等 `#787` 解封(plan §2 甲)。
--       它們在本片出現的理由是**值域要一次定義完**,否則解封那天要再請 Sean 貼一次 SQL。
--    ③ **本表零寫入 GRANT** ⇒ 只有 owner(= 這支 trigger 以 SECURITY DEFINER 跑)寫得進來。
--
-- ══ 🔴🔴 **codex R1(2026-09-01, gpt-5.6-sol xhigh)= FAIL 14 must-fix + 1 nit** ══════
--    全部修完才是這一版。而其中【第 1 條會弄壞正式庫的排程】,值得寫在檔頭:
--
--    🔴 **我原本假設「`orders.cancelled_at` 只會由 `admin_cancel_order` 寫」——【那是錯的】。**
--      當場數:`grep -rln "SET cancelled_at" supabase/migrations/*.sql | wc -l` ⇒ **7 支檔**
--      其中 `20260828060000_…expire_unpaid_orders_heartbeat.sql:234` 是 **pg_cron 的批次 UPDATE**,
--      而 `grep -c 'order_cancellations'` 那支 ⇒ **0**(🔵 正對照同尺打 `cancelled_at` ⇒ 4 · ⚪ 負對照 ⇒ 0)
--      ⇒ 舊版在那裡 `RAISE P2C01` ⇒ **整批 rollback ⇒ 訂單從此不會自動過期,而沒有人在看那支的 rc。**
--    📌 **⇒ 根因:我挑了一個【看起來等於「整單取消」】的訊號, 而它是【好幾件事共用的一欄】。**
--    🛑 **⇒ 而我自己的七個測試世界一個都抓不到它** —— fixture 裡只有我自己寫的那條路
--       ⇒ **我的分母由「我做了什麼」決定, 而 bug 的分母由「誰碰得到這一欄」決定。**
--
--    ⇒ 兩個修法(主視窗 `-0a` 2026-09-01 裁):
--      ① **把【算金額】搬到【找 cancellation】之前** —— 逾期單零收款 ⇒ 一列都不開 ⇒ 走不到那個判斷。
--         🔵 它不是「例外掉逾期 cron」,是**把射程收窄到它真正管的世界**。
--      ② **`cancellation_id` 改 nullable** —— 而這一格主視窗要求我先量「有沒有合法路徑會產生
--         【收了錢 + `cancelled_at` 有值 + 零 cancellation】」。**量到了,有:**
--           `admin_record_manual_payment` 最新代(`20260812150000:74-342`)
--           `UPDATE public.orders` / `SET payment_status` ⇒ **0 命中**
--           🔵 正對照 同尺打 `INSERT INTO public.order_payments` ⇒ **2** · ⚪ 負對照 ⇒ **0**
--         ⇒ 🔴 **登記匯款/現金收款【不會】把 `payment_status` 翻成 paid ⇒ 那張單仍是 `unpaid`**
--         ⇒ 而逾期 cron 的述詞就是 `payment_status = 'unpaid'`(`20260828060000:211`)
--         ⇒ ⇒ **「已收匯款而狀態沒翻」的單會被 cron 掃到 ⇒ 收了錢 + 取消 + 零 cancellation。**
--         ⚠️ 而全 repo `SET payment_status = 'paid'` 的寫入端**全部**是卡片 `confirm_order_payment`
--            那一族的各代 + 零元單結清(`20260901030000`)⇒ **非卡軌沒有翻 paid 的路徑。**
--            🛑 **那是一個比本片大的問題, 本片不修它, 另開板子一列。**
--
-- ══ 🛑🛑 **本支斷言【證不到】的環境變化(4 條)—— 刻意不寫,不是漏寫** ══════════
--    codex R2 報了 15 條,其中 7 條的句型都是「**若【環境】日後被改成 X ⇒ 我的斷言不會叫**」。
--    我做了其中 3 條(FORCE RLS / proconfig 精確 / 索引真實鍵與述詞)—— 那三條**收窄射程**。
--    🔴 而下面這 4 條我**不做**,理由是同一句:
--
--      **一支 migration 的後置斷言,證得了【apply 那一刻】的狀態,證不了【未來沒有人改它】。**
--      🔴 **而寫一道永遠綠的斷言,比不寫更糟** —— 它不是弱的保護,它是一個**假的保護**,
--         而假的保護會讓下一個人不再去想那一格。
--
--      ① `service_role` 若失去 `BYPASSRLS` ⇒ 後台讀本表會被零 policy 濾成零列。
--         🛑 **那是【平台的角色屬性】,本支 migration 一個字都碰不到它** ⇒ 射程之外,不是難。
--      ② 函式 owner 若被改成沒有本表寫入權的角色 ⇒ INSERT permission denied。
--      ③ `anon` / `authenticated` 若能 `SET ROLE` 到函式 owner 或表 owner ⇒ ACL 斷言仍綠。
--         🛑 ②③ 都要證明「未來沒有人重新配置角色」—— 那是**角色治理**,不是一支 migration 的事。
--      ④ (R2 #11)一筆人工退款先被用來結清待退款、之後才被作廢
--         ⇒ 待退款會永久顯示「已退」而錢其實退回去了又被作廢。
--         🔵 **今天不可達**:`settled_at` 零寫入端。修它要一支 trigger ⇒ **留給做消化那一端的人**。
--
--    🔴🔴 **而這一節【不是唯一落點】** —— 同樣四條寫進 `docs/launch-todo.md` 的
--      `⟦b4-AUTOREFUND⟧` 那一列,標題可搜:「本支斷言【證不到】的環境變化」。
--      📌 理由是今晚剛量到的:`⟦b4-NONCARDPAID1⟧` 那筆債**誠實地寫在 migration 檔頭,三週沒有人回來**
--      ⇒ **做下一片的人不會去讀上一片的檔頭。**
--
-- ══ Rollback(三樣,缺一不可)═══════════════════════════════════════════════
--    `DROP TRIGGER order_pending_refund_open_au ON public.orders;`
--    `DROP FUNCTION public.pcm_pending_refund_on_cancel();`
--    `DROP TABLE public.order_pending_refunds;`
--    ⚠️ **而回退把表 DROP 掉之後,已經記下來的那幾筆待退款【就消失了】** ——
--       要保留就只 DROP TRIGGER,不 DROP TABLE。回退腳本要把這句印出來,不要只印 DROP 成功。
--    ⚠️ plan §5③:開錯的那幾筆用 `voided_at` / `void_reason` 作廢,**不刪列** ——
--       刪列會讓「它曾經存在」消失,而那正是本片要防的東西。
-- ============================================================================

BEGIN;

-- 改形狀要 ACCESS EXCLUSIVE lock;5 秒等不到就整支放棄(對齊 20260725130100:72)。
SET LOCAL lock_timeout = '5s';

-- ══ 0. 前置斷言(fail-closed;本檔不冪等,重放會在這裡或第一句 CREATE 失敗)══════
DO $pre$
BEGIN
  IF to_regclass('public.orders') IS NULL THEN
    RAISE EXCEPTION '前置失敗 — public.orders 不存在;拒繼續';
  END IF;
  IF to_regclass('public.order_cancellations') IS NULL THEN
    RAISE EXCEPTION '前置失敗 — public.order_cancellations 不存在(本表要 FK 到它);拒繼續';
  END IF;
  IF to_regclass('public.order_payments') IS NULL THEN
    RAISE EXCEPTION '前置失敗 — public.order_payments 不存在(金額由它算);拒繼續';
  END IF;
  IF to_regclass('public.order_manual_refunds') IS NULL THEN
    RAISE EXCEPTION '前置失敗 — public.order_manual_refunds 不存在(扣除側讀它);拒繼續';
  END IF;
  -- 🔴 `orders.cancelled_at` 是本片唯一的觸發訊號 —— 欄不在 ⇒ trigger 建得起來而永遠不發火。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.orders'::regclass
       AND a.attname = 'cancelled_at' AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION '前置失敗 — public.orders 沒有 cancelled_at 欄(本片的觸發訊號);拒繼續';
  END IF;
END
$pre$;

-- ══ 0b. 🔴🔴 **本支【碰了別片的表】—— 這一段是為了讓那一片的人搜得到** ══════════
--    對象:`public.order_manual_refunds`,建它的是
--    `20260820010000_m4b_manual_refunds.sql`(**已 apply**;Sean 2026-08-20 `Q8=乙`「那只是記一筆帳」)。
--    🔴 **為什麼本支要碰它**:本表的 `settled_manual_refund_id` 若只是單欄 FK,
--      **A 訂單的待退款可以指向 B 訂單的人工退款,而所有 FK / CHECK 全通過**
--      ⇒ A 會被【假結清】(codex R2 #2)。要綁住「同一張單」就需要複合 FK,
--      而複合 FK 的目標必須是一個 UNIQUE —— 那張表今天沒有。
--    ✅ **形狀是純加法**:`id` 已經是 PRIMARY KEY ⇒ `(id, order_id)` **天生唯一**
--      ⇒ 📌 **不可能有既有資料違反它** ⇒ 這道 ALTER 不會因為現有資料而失敗。
--    🛑 **而「我構造不出違反它的世界」這件事本身要寫出來**:
--      ⇒ **這道約束【今天】不可能紅。它是為將來守的, 不是為現在守的。**
--    ⚠️ 鎖:`ADD CONSTRAINT … UNIQUE` 會建索引 + 取短暫 `ACCESS EXCLUSIVE`
--      ⇒ 上面 `SET LOCAL lock_timeout = '5s'` 蓋得到它;等不到就整支放棄。
--    📎 同一件事也寫在板子上(`⟦b4-AUTOREFUND⟧` 那一列)——
--      🔴 因為今晚剛證過:**「我在自己的檔裡誠實寫了」不等於「他們會知道」。**
ALTER TABLE public.order_manual_refunds
  ADD CONSTRAINT order_manual_refunds_id_order_id_key UNIQUE (id, order_id);

COMMENT ON CONSTRAINT order_manual_refunds_id_order_id_key ON public.order_manual_refunds IS
  '複合 UNIQUE, 由 20260901080000(待退款自動開立)加上, **不是建表那一片加的**。'
  '用途:讓 public.order_pending_refunds.settled_manual_refund_id 可以做複合 FK, '
  '綁住「結清用的那筆人工退款必須屬於同一張訂單」。'
  '🔵 id 已是 PK ⇒ 本約束天生成立、對既有資料零影響;它是為將來守的。';

-- ══ 1. 表 ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.order_pending_refunds (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- RESTRICT 而非 CASCADE(對齊 order_manual_refunds / order_cancellations):
  -- 待退款是要留存的事實,不得因為刪一張單就無聲消失。
  order_id        uuid        NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,

  -- 🔴 **本表沒有 `actor` 欄,而那是刻意的**:這一筆不是人開的,是系統因為一次取消而開的。
  --    「那次取消是誰按的」住在 `order_cancellations.actor`。
  -- 🔴 **而它是 NULL-able —— 那是 codex R1 #1 的修法之一,理由在檔頭(已量到合法路徑)。**
  --    NULL 的意思是:**這張單的 `cancelled_at` 是由一條【沒有取消單】的路徑寫的。**
  --    今天量到的那一條是:**逾期 cron 掃到「已登記匯款/現金收款、而 `payment_status` 仍是
  --    `unpaid`」的單**(登記收款不翻 `payment_status`,見檔頭的三格量測)。
  --    ⚠️ **不要把這句讀成「今天唯一的一條」** —— 我上一個假設就是這麼死的。
  cancellation_id uuid,

  -- 值域與 order_manual_refunds.rail 逐字相同(刻意不含 card:卡退有自己的帳本與狀態機)。
  rail            text        NOT NULL CHECK (rail IN ('bank_transfer', 'cash')),

  -- 🔴 **欄名就是那句警告**(codex R1 #4/#5/#8;主視窗 2026-09-01 裁「快照 + 改名」):
  --    這是【取消當下】算出來的數字,**而世界會繼續動** —— 取消之後還可以登記退款、
  --    沖銷收款、作廢一筆退款 ⇒ 那三件事都會讓這個數字過期,而它不會自己更新。
  -- 🔴 **型別是 `bigint` 不是 `integer`, 而那是刻意的**(codex R1 #3 / R2 的溢位那一族):
  --    這一欄的值是 `SUM(order_payments.amount)` —— **而多筆合法的 integer 加總可以超過
  --    2,147,483,647**。用 integer 就要在 trigger 裡加一道守門, 而那道守門的失敗形態是
  --    「一個【錢太多】的算術錯誤, 長成【這張單取消不了】」。
  --    ⇒ 📌 **把型別放對, 那道守門就不需要存在 —— 而不存在的守門不會有恆綠問題。**
  amount_at_cancel bigint     NOT NULL CHECK (amount_at_cancel > 0),

  opened_at       timestamptz NOT NULL DEFAULT now(),

  -- ── 三態的另外兩態(今天零寫入端;理由見檔頭已知缺口②)────────────────────
  settled_at      timestamptz,
  settled_manual_refund_id uuid,
  voided_at       timestamptz,
  void_reason     text,

  -- 🔴 結清用的那筆人工退款也必須屬於【同一張單】(codex R2 #2)——
  --    單欄 FK 只保證「那筆退款存在」, 而那讓 A 單可以拿 B 單的退款假結清。
  --    目標 UNIQUE 由本檔 §0b 加上(那張表原本沒有)。
  CONSTRAINT order_pending_refunds_settled_same_order
    FOREIGN KEY (settled_manual_refund_id, order_id)
    REFERENCES public.order_manual_refunds (id, order_id) ON DELETE RESTRICT,

  -- 🔴 跨單 FK(codex R1 #10):沒有這一條的話,一筆待退款可以指向**別張訂單**的取消單,
  --    而所有 CHECK 都會通過。`order_cancellations` 自己備了 `UNIQUE (id, order_id)`
  --    (`20260730130000:125`,別人為了別的理由建的)⇒ 這裡直接拿它當複合 FK 的目標。
  CONSTRAINT order_pending_refunds_cancellation_same_order
    FOREIGN KEY (cancellation_id, order_id)
    REFERENCES public.order_cancellations (id, order_id) ON DELETE RESTRICT,

  -- 🔴 已退與已作廢互斥:兩個都非 NULL 時,「這筆錢到底有沒有回去」沒有答案。
  CONSTRAINT order_pending_refunds_settled_xor_voided
    CHECK (NOT (settled_at IS NOT NULL AND voided_at IS NOT NULL)),

  -- 結清必須指得出是哪一筆實付把它結掉的(否則「已退」是一個沒有憑證的宣稱)。
  CONSTRAINT order_pending_refunds_settled_needs_ref
    CHECK ((settled_at IS NULL) = (settled_manual_refund_id IS NULL)),

  -- 🔴 作廢必須寫**有內容的**理由(codex R1 #12):`''` 與純空白都通得過 NOT NULL,
  --    而一筆財務義務不該在沒有理由的情況下被作廢。字集顯式給,不用 btrim 預設
  --    (預設只吃一般空格 ⇒ `E'\n\t'` 會通過,同 `20260820010000:171` 那支檔的教訓)。
  CONSTRAINT order_pending_refunds_void_needs_reason
    CHECK ((voided_at IS NULL) = (void_reason IS NULL)
           AND (void_reason IS NULL
                OR btrim(void_reason, E' \t\r\n\u00A0\u3000\u2007\u202F') <> ''))
);

CREATE INDEX order_pending_refunds_order_idx ON public.order_pending_refunds (order_id);

-- 🔴 **唯一鍵只管【還活著的】那些**(codex R1 #7):舊版是表級 `UNIQUE (order_id, rail)`,
--    而它是**永久**的 ⇒ 一筆待退款被作廢、訂單被改回未取消、再次被取消時,
--    新的那一筆會撞到那個已作廢的舊列 ⇒ 被 `ON CONFLICT DO NOTHING` **吞掉**
--    ⇒ 📌 **第二次取消沒有留下任何有效的待退款,而沒有東西會紅。**
--    ⇒ 改成部分唯一索引:只在「未作廢且未結清」的列之間唯一。
CREATE UNIQUE INDEX order_pending_refunds_live_order_rail_key
  ON public.order_pending_refunds (order_id, rail)
  WHERE voided_at IS NULL AND settled_at IS NULL;

-- 🔴 一筆人工退款只能結清【一筆】待退款(codex R2 #12):沒有這道的話,
--    同一個退款 id 可以被填進多筆待退款 ⇒ **帳面顯示退了很多次, 而錢只退了一次。**
CREATE UNIQUE INDEX order_pending_refunds_settled_ref_key
  ON public.order_pending_refunds (settled_manual_refund_id)
  WHERE settled_manual_refund_id IS NOT NULL;

-- 「還有哪些沒退」是這張表唯一會被反覆問的問題 ⇒ 給它一個部分索引。
CREATE INDEX order_pending_refunds_open_idx ON public.order_pending_refunds (opened_at)
  WHERE settled_at IS NULL AND voided_at IS NULL;

-- ══ 2. COMMENT ══════════════════════════════════════════════════════════════
-- ⚠️ 已 apply 的 migration 連註解都不能再改(`supabase/APPLIED.tsv` 記 sha256)
--    ⇒ **這幾句話只有這一次機會寫。**
COMMENT ON TABLE public.order_pending_refunds IS
  '待退款:一張單被【整單取消】,而它在現金/匯款兩軌上還有收過而沒退回去的錢。'
  'Sean 2026-09-01 拍甲逐字「錢收了沒紀錄, 今天起停止」。'
  '🔴 本表與 order_manual_refunds 的語意【相反】:那張表記【已經發生的事】(它的 COMMENT 逐字'
  '「刻意沒有 status … 這不是還沒加, 是這張表的語意裡沒有那個狀態」, Sean 2026-08-20 Q8=乙);'
  '本表記的是【一個還沒發生、而我們欠著的動作】。⇒ 兩本帳分開, 各自誠實。'
  '🔴🔴 **本表的金額【不在】 pcm_manual_refund_rail_cap 的分母裡。**'
  '解封 #787(手動退款入口)之前, 必須先把本表接進那支函式, '
  '否則同一筆錢可能被記一次待退 + 退一次實付。'
  '🔴 三態不是一個 status 欄:待退 = 本列存在且兩個時刻都 NULL / 已退 = settled_at 非 NULL / '
  '已作廢 = voided_at 非 NULL。**刻意不開 enum** —— 開了就有兩個真相來源, 而它們會分岔而不會紅。'
  '⚠️ **誰讀得到本表**:RLS 已 ENABLE + **一條顯式 SELECT 政策給 service_role**;'
  '一般角色(anon / authenticated)零表權限、零政策 ⇒ 一列都讀不到。'
  '⛔ ~~前一版是【零 policy】, 靠 service_role 的 BYPASSRLS 讀~~ ⇒ 🔴 那依賴的是【平台角色屬性】'
  '不是本檔寫的政策 —— 拿掉它的那一天這張表會【讀到空的】, 而空資料看起來像正常資料。'
  '寫入零 GRANT ⇒ 只有 owner 寫得進來, 也就是本檔那支 SECURITY DEFINER trigger。'
  '⚠️ **本檔不宣稱本表不可竄改** —— owner 繞得過 trigger, TRUNCATE 也不受 RLS 管。';

COMMENT ON COLUMN public.order_pending_refunds.cancellation_id IS
  '哪一次取消開出了這筆待退款。🔴 本表【刻意沒有 actor 欄】—— 這一筆不是人開的, 是系統開的;'
  '「那次取消是誰按的」在 order_cancellations.actor, 而那一欄的意義是【誰按的鈕(自稱)】、'
  '不是【誰為這筆錢負責】:app 側 actor 是使用者自己下拉選的(cancel-actions.ts 自陳非授權邊界), '
  'DB 側只驗了「這個 staff 存在且在職」⇒ 驗了存在性, 沒驗身分(真身分是 E8-B 真登入線)。'
  '🔴 **NULL 是合法值**:代表這張單的 cancelled_at 是由一條【沒有取消單】的路徑寫的。'
  '2026-09-01 量到的那一條 = 逾期 cron 掃到「已登記匯款/現金收款、而 payment_status 仍是 unpaid」的單。'
  '⚠️ **不要讀成「唯一的一條」** —— 上一個版本就是死在「只有 admin_cancel_order 會寫那一欄」這個假設上。'
  '🔵 而它同時受複合 FK 約束:非 NULL 時, 那筆取消必須屬於【同一張訂單】。';
COMMENT ON COLUMN public.order_pending_refunds.rail IS
  '欠在哪一條軌上。🔴 逐軌一列, 不合併 —— 錢從哪條軌收進來, 就要從哪條軌退回去;'
  '合成一列會讓「收了現金 300 + 匯款 700」變成一個退不出去的 1000。';
COMMENT ON COLUMN public.order_pending_refunds.amount_at_cancel IS
  '🔴🔴 **這是【取消當下】的快照, 不是【現在還欠多少】。欄名就是那句警告。**'
  '口徑 = SUM(order_payments.amount 同軌) − SUM(order_manual_refunds.refund_amount 同軌且未作廢)。'
  '🛑 **它會過期, 而它不會自己更新** —— 取消之後仍然可以:登記一筆退款 / 沖銷一筆收款 / 作廢一筆退款,'
  '三件事都會讓這個數字與事實分岔(codex R1 #4/#5/#8)。'
  '✅ **要知道【現在】還欠多少, 不要讀本欄 —— 呼叫 public.pcm_manual_refund_rail_cap(order_id)**'
  '(`20260824010000:117`):它 SUM public.order_payments.amount(rail IN (bank_transfer, cash))'
  '減掉 SUM public.order_manual_refunds.refund_amount(voided_at IS NULL), 兩段皆 COALESCE(...,0)。'
  '⚠️ 差別:那支函式是【兩軌合計】, 本欄是【逐軌】⇒ 逐軌要自己加 rail 條件。'
  '🔴 而本表的金額【不在】那支函式的分母裡 —— 見 COMMENT ON TABLE。';
COMMENT ON COLUMN public.order_pending_refunds.settled_at IS
  '這筆待退款什麼時候被真的退掉了。🛑 **今天零寫入端** —— 消化那一端等 #787 解封。'
  '它現在就存在的理由是【值域要一次定義完】, 不是它壞了。'
  '🔴 而寫它的人必須先重算(見 amount_at_cancel 那一欄), 不得直接把 amount_at_cancel 當應退金額。';
COMMENT ON COLUMN public.order_pending_refunds.settled_manual_refund_id IS
  '✅ **同一張單【已經由複合 FK 保證】** —— order_pending_refunds_settled_same_order,'
  '目標 UNIQUE 由本檔 §0b 加在 order_manual_refunds 上(那張表原本沒有)。'
  '🛑 **而【同一條軌】與【金額相符】仍然沒有保證** ⇒ 消化那一端必須自己驗那兩格。'
  '🔴 **不要拆掉 §0b 那道 UNIQUE** —— 它今天在承重(拆了複合 FK 就建不起來)。'
  '⛔ ~~本欄只保證「那筆人工退款存在」, 不保證它屬於同一張單~~ —— 那是 codex R1 #11 時代的字面,'
  'R2 #2 落地後已不成立;舊字面留著, 讓搜它的人在同一發撞到這裡。';
COMMENT ON COLUMN public.order_pending_refunds.voided_at IS
  '這筆待退款是【開錯的】。🛑 今天零寫入端。⚠️ 語意對齊 order_manual_refunds.voided_at:'
  '作廢說的是「這筆登記本身是錯的」, 【不宣稱】錢沒動。';

-- ══ 🔵 **而「現在做」的理由是【今天限定】的, 而它會過期** ═══════════════════
--    Sean 2026-09-01 拍甲時的理由逐字:「今天訂單是空的, 零回填」——
--    🔴 **那是【那一天】的事實, 不是這張表的性質。**
--    下週才做, 就要面對「已經被取消而沒有紀錄的那些單」, 而那批**事後補不回來**
--    (取消那一刻沒有留下金額與收款來源)。
--    📌 **⇒ 這不是效率問題, 是【資料還原性】問題。**
--    ⚠️ 而這段寫在這裡而不是只寫在 plan 裡, 理由是:
--       **plan 會被歸檔, 而 COMMENT 跟著這張表活著。**

-- ══ 3. 權限(🔴 動 GRANT ⇒ 鐵則 12②)════════════════════════════════════════
-- ⚠️ `docs/patterns/revoking-function-execute-in-supabase.md`:
--    **新物件出生就自帶 PUBLIC/anon 的權限**,而 repo 內零 GRANT 字面可掃、三綠不紅。
ALTER TABLE public.order_pending_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.order_pending_refunds FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.order_pending_refunds TO service_role;

-- 🔴🔴 **顯式 SELECT 政策 —— 而它推翻了本檔前一版的「零 policy」設計** ══════════════
--    前一版照兄弟表 `order_manual_refunds` 抄:RLS on + **零 policy** + 只 GRANT SELECT
--    給 `service_role`,理由是「正式 Supabase 的 `service_role` 帶 `BYPASSRLS` ⇒ 它讀得到」。
--    🛑 **而 `scripts` 那道 `rls-service-role-policy-gate` 在 commit 前擋下了它,理由逐字:**
--      「今天它照樣會動 —— 因為 `service_role` 帶 `BYPASSRLS`。**那是【平台角色屬性】,
--        不是你寫的政策** ⇒ 拿掉它的那一天,這張表會變成【後台讀到空的】,
--        **而空資料看起來像正常資料,沒有人會叫。**」
--    🔴 **而這一條 codex R1 / R2 / Fable R3 三輪【都沒有抓到】** ——
--      Fable 的 F8 族點到過同一個風險(`service_role` 失去 `BYPASSRLS`),
--      而**我當時把它判成「射程之外」而不做**。⇒ 那個判斷在「證不到未來」那一半是對的,
--      🛑 **而它漏掉了另一半:我【現在】就可以把讀取路徑寫成不依賴平台屬性的樣子。**
--      📌 **⇒ 「我證不到那個未來」與「我今天沒有把它寫死」是兩件事,而我把前者當成了後者的理由。**
--    ⇒ 有了這條政策之後,`BYPASSRLS` 在不在都讀得到 ⇒ **那個風險不是被監控,是被拿掉。**
CREATE POLICY order_pending_refunds_select_service_role
  ON public.order_pending_refunds
  FOR SELECT TO service_role
  USING (true);

-- ══ 4. Trigger:整單取消 ⇒ 逐軌開待退款 ══════════════════════════════════════
-- SECURITY DEFINER:本表零寫入 GRANT ⇒ 呼叫者(service_role)寫不進來, 必須以 owner 身分寫。
CREATE FUNCTION public.pcm_pending_refund_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_cid uuid;
  v_n   int;
BEGIN
  -- 🔴 只在【由無變有】那一刻發火。`AFTER UPDATE OF cancelled_at` 已經限定了欄位,
  --    這一道再擋「已經取消過、只是又被 UPDATE 一次」。
  IF OLD.cancelled_at IS NOT NULL OR NEW.cancelled_at IS NULL THEN
    RETURN NULL;
  END IF;

  -- ══ 🔴 步 1:**先算錢**(codex R1 #1 的修法)═════════════════════════════════
  --    舊版先找 cancellation、找不到就 RAISE ⇒ 而【逾期 cron 那條路沒有 cancellation】
  --    ⇒ 整批 rollback。搬到後面之後,零收款的單一列都不開 ⇒ 根本不需要 cancellation。
  --    📌 **這不是把 cron 豁免掉,是把這段邏輯的射程收窄到它真正管的世界。**
  --
  -- ══ 🔴🔴 步 2:**哪一次取消 —— 用【交易時刻】精確配對, 不用「最新一筆」**(codex R2 #1/#3)══
  --    舊版取「`created_at` 最大的那一筆」⇒ 兩個錯:
  --      ① 訂單有【舊的部分取消】、之後被逾期 cron 寫 `cancelled_at`
  --         ⇒ 抓到那筆與本次無關的舊取消單 ⇒ **掛錯歸屬**(R2 #3)
  --      ② 「先數一次確認唯一、再查一次拿 id」中間別人可以 commit ⇒ race(R2 #1)
  --    ✅ 而 `pg_catalog.now()` 是**交易時刻**不是語句時刻(2026-09-01 當場實測:
  --       同一交易內隔 `pg_sleep(0.3)` 的兩句, `DEFAULT now()` 與 `SET = pg_catalog.now()`
  --       兩個值**逐字相同**)⇒ `admin_cancel_order` 同一交易寫的 cancellation 與 `cancelled_at`
  --       **必然同值** ⇒ 直接用它配對:精確、單發、不需要排序也不需要平手規則。
  --    🔵 而逾期 cron 那條路沒有 cancellation ⇒ 自然配不到 ⇒ `v_cid` 留 NULL(那是合法值)。
  --    ⚠️ **誠實邊界**:哪天有人把 `cancelled_at` 寫成**非** `now()` 的值(例如回填舊單),
  --       這裡會配不到 ⇒ 退化成 NULL。**那是安全的退化(留白),不是錯的歸屬。**
  -- 📌 **為什麼這裡沒有 `ORDER BY … LIMIT 1`**:那個寫法是【找最接近的那一筆】= 啟發式,
  --    而這裡是【找同一個值的那一筆】= 等式。**啟發式永遠有「猜錯」那一格,等式沒有。**
  SELECT c.id INTO v_cid
    FROM public.order_cancellations c
   WHERE c.order_id = NEW.id
     AND c.created_at = NEW.cancelled_at;
  -- 同一交易理論上只會有一筆;真的有兩筆(同值)時 `SELECT INTO` 取其一 ⇒ 顯式數一次,
  -- 平手就不猜(寧可留白, 也不要掛一個擲骰子的歸屬)。
  SELECT count(*) INTO v_n
    FROM public.order_cancellations c
   WHERE c.order_id = NEW.id AND c.created_at = NEW.cancelled_at;
  IF v_n <> 1 THEN
    -- 🔴 F5(Fable R3):NULL 是三義的 —— ①無取消單路徑 ②非 now() 寫入 ③這裡的平手。
    --    前兩義在 COMMENT 裡查得到,而【平手】原本零留痕 ⇒ 出事那天沒有人查得出來它發生過。
    -- 🔴🔴 **而只在 `> 1` 時叫,不在 `= 0` 時叫** —— 這一格是實跑之後改的:
    --    第一版寫 `v_n <> 1` ⇒ 而**逾期 cron 那條路(零取消單)是【預期的正常路徑】**
    --    ⇒ 每一張被 cron 取消的單都會噴一則 WARNING。
    --    📌 **⇒ 一個對【常態】發的警報,會讓人學會忽略它 —— 而那正好殺掉它要保護的那個訊號。**
    IF v_n > 1 THEN
      RAISE WARNING
        '待退款歸屬留白 — 訂單 % 在 cancelled_at=% 這個時刻有 % 筆取消單(期望 1)⇒ cancellation_id 留 NULL 不猜。',
        NEW.id, NEW.cancelled_at, v_n;
    END IF;
    v_cid := NULL;
  END IF;

  -- ══ 🔴🔴 步 3:**兩軌一發算完、一發寫入**(codex R2 #4/#5)═══════════════════
  --    舊版兩軌各跑一次 `SELECT`, 而 `READ COMMITTED` 之下兩句之間別人可以 commit
  --    ⇒ 兩筆 `amount_at_cancel` 可能來自**不同的資料庫時點**;更糟的是舊版還多一發
  --      「先算 count 決定要不要繼續」⇒ 那一發與後面兩發之間也會漂。
  --    ✅ 改成單一 `INSERT … SELECT`:兩軌在**同一個快照**裡算完, 而且沒有「先看一眼再決定」。
  --    🔴 而溢位那一族(R1 #3 / R2)不在這裡守 —— **欄位型別就是 `bigint`**, 見上面的欄位註解。
  INSERT INTO public.order_pending_refunds
    (order_id, cancellation_id, rail, amount_at_cancel)
  SELECT NEW.id, v_cid, x.rail, x.amt
    FROM (
      SELECT r.rail,
             COALESCE((SELECT SUM(p.amount) FROM public.order_payments p
                        WHERE p.order_id = NEW.id AND p.rail = r.rail), 0)::bigint
           - COALESCE((SELECT SUM(m.refund_amount) FROM public.order_manual_refunds m
                        WHERE m.order_id = NEW.id AND m.rail = r.rail AND m.voided_at IS NULL), 0)::bigint
             AS amt
        -- 🔴 F3:這是 order_payments.rail 值域的【手抄副本】(主人 20260810100000:189, 三值含 card)。
        --    新增第 4 條軌時本 trigger 會【靜默略過】那條軌的錢 ⇒ 加 rail 的人要回來改這裡。
        FROM (VALUES ('bank_transfer'), ('cash')) AS r(rail)
    ) x
   WHERE x.amt > 0
  -- 🔴 `ON CONFLICT` 指向【部分唯一索引】(codex R1 #7):它只在「未作廢且未結清」的列
  --    之間唯一 ⇒ 重放不會長出第二列, 而**作廢過的舊列不會吞掉一次新的取消**。
  ON CONFLICT (order_id, rail) WHERE voided_at IS NULL AND settled_at IS NULL
  DO NOTHING;

  RETURN NULL;
END;
$fn$;

COMMENT ON FUNCTION public.pcm_pending_refund_on_cancel() IS
  '整單取消 ⇒ 逐軌開一筆待退款。🔴 觸發訊號是 orders.cancelled_at 由 NULL 變非 NULL。'
  '🛑 而【那一欄不是 admin_cancel_order 專用的】—— 2026-09-01 當場數, 全 repo 有 7 支 migration '
  '寫 SET cancelled_at(含 pg_cron 的逾期批次 UPDATE, 而那條路不建 order_cancellations)。'
  '⇒ 所以本函式【先算錢, 再找取消單】:零收款的單一列都不開, 走不到需要取消單的地方。'
  '🛑 部分取消【不開】待退款:那該退多少是一個沒有人答過的口徑題, 而猜一個金額比不記還糟。'
  '⚠️ 開關:ALTER TABLE public.orders DISABLE TRIGGER order_pending_refund_open_au; ⇒ 不必重新部署。'
  '🔴 **F6(Fable R3):關掉期間的取消【永遠補不回來】** —— trigger 關著時 cancelled_at 由 NULL 變非 NULL '
  '那一發被消耗掉, re-enable 之後不會重放, 而且零訊號。⇒ **關過就要手工補列。**'
  '🔴 **F2(Fable R3):等式配對依賴一件【寫在別支檔裡而沒有人寫下來】的性質** —— '
  'admin_cancel_order 最新代(20260830020000)是先 INSERT order_cancellations(:497)才 UPDATE cancelled_at(:533)。'
  '哪一天有人 CREATE OR REPLACE 把順序倒過來 ⇒ **每一筆 cancellation_id 靜默退化成 NULL**, 而全部約束照綠, '
  '而 NULL 在本表被定義成「無取消單路徑」⇒ 那個世界裡這個定義是假話。**改那支 RPC 的語句順序前要回來看這一句。**'
  '🔴 **F3(Fable R3):下面那組 rail 是【手抄的副本】** —— 值域主人是 order_payments.rail '
  '(20260810100000:189, 三值含 card)。它新增第 4 條軌時, 本 trigger 對那條軌的錢是【靜默略過】'
  '⇒ **「錢收了沒紀錄」這個原罪對新軌重開。**⇒ 加 rail 的人要回來改這裡。'
  '🔴 **F4(Fable R3):repo 內建的「復活食譜」會與本表打架** —— '
  '20260809160000:100-101 是一段 in-tree 的資料回滾指令(SET cancelled_at = NULL WHERE cancelled_reason=payment_expired), '
  '而它正是誤逾期時最自然的救法。跑完之後那張單活了, 而本表的列還 live(voided_at 零寫入端 ⇒ 沒人清得掉)'
  '⇒ 值班會看到「這張活著的單欠著錢」;之後真的取消時, 部分唯一索引 + ON CONFLICT DO NOTHING '
  '會把新列【連同新金額與新歸屬一起吞掉】。⇒ **復活一張單時必須同時作廢本表對應的列。**'
  '🔵 而「不必重新部署」不是順手, 是刻意避開一個已知的坑(線 -7a 2026-09-01 量到):'
  'Vercel 的環境變數【刪掉也要 redeploy 才生效】⇒ 用 env 當開關的東西, 關它要走一次部署;'
  '而部署失敗 / 排隊 / 被別人的 commit 卡住的時候, 那個開關就關不掉。⇒ DB 層的開關沒有那一格。';

-- 🔴 **不用 `DROP TRIGGER IF EXISTS`**(codex R1 #14):那會把一個【同名而用途不同】的既有
--    trigger 靜默刪掉再取代 —— 而本檔自稱 fail-closed。⇒ 撞名就整支 rollback,讓人當場看到。
DO $trg_pre$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
              WHERE t.tgrelid = 'public.orders'::regclass
                AND t.tgname = 'order_pending_refund_open_au') THEN
    RAISE EXCEPTION
      '前置失敗 — public.orders 上已經有一個叫 order_pending_refund_open_au 的 trigger。'
      '⇒ 本檔不覆蓋它(覆蓋 = 靜默刪掉一個我沒看過的東西);請先確認那是什麼再決定;拒繼續。';
  END IF;
END
$trg_pre$;

CREATE TRIGGER order_pending_refund_open_au
  AFTER UPDATE OF cancelled_at ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.pcm_pending_refund_on_cancel();

REVOKE ALL ON FUNCTION public.pcm_pending_refund_on_cancel() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_pending_refund_on_cancel() FROM anon;
REVOKE ALL ON FUNCTION public.pcm_pending_refund_on_cancel() FROM authenticated;
REVOKE ALL ON FUNCTION public.pcm_pending_refund_on_cancel() FROM service_role;

-- ══ 5. 後置斷言(同一交易;任何一道不過 ⇒ 整筆 ROLLBACK)═══════════════════════
DO $post$
DECLARE
  -- 🔴 新物件收權斷言的【清單】(`scripts/migration-new-file-static-checks.sh` 要它可被數)。
  --    **它防的不是「忘記收權」,是「忘記列」** —— 下面兩個迴圈只檢查你列出來的物件。
  v_relations text[] := ARRAY['public.order_pending_refunds']::text[];
  v_functions text[] := ARRAY['public.pcm_pending_refund_on_cancel()']::text[];
  v_obj   text;
  v_bad   text;
  v_owner oid;
  v_n     int;
  v_att   int2;
BEGIN
  -- ── 5a. 表 ACL:閉世界(不是角色黑名單)──────────────────────────────────
  --    ⚠️ `aclexplode(NULL)` 回零列 ⇒ 只寫 EXISTS 的話,「relacl 是 NULL」會靜默通過。
  FOREACH v_obj IN ARRAY v_relations LOOP
    IF to_regclass(v_obj) IS NULL THEN
      RAISE EXCEPTION '斷言失敗 — 關聯 % 不存在(清單打錯字會讓下面整段靜默通過);拒繼續', v_obj;
    END IF;
    SELECT c.relowner INTO v_owner FROM pg_catalog.pg_class c WHERE c.oid = v_obj::regclass;
    IF (SELECT c.relacl FROM pg_catalog.pg_class c WHERE c.oid = v_obj::regclass) IS NULL THEN
      RAISE EXCEPTION 'ACL 異常 — % 的 relacl 是 NULL(表示本檔的 REVOKE/GRANT 沒生效);拒繼續', v_obj;
    END IF;
    -- 🔴 `is_grantable`(codex R1 #9):`GRANT … WITH GRANT OPTION` 之下 privilege_type 仍是
    --    'SELECT' ⇒ 舊版的 allowlist 會放行,而那個角色可以再把讀權轉授給別人。
    SELECT pg_catalog.string_agg(x.who || ':' || x.priv || CASE WHEN x.g THEN '(可轉授)' ELSE '' END,
                                 ', ' ORDER BY x.who, x.priv) INTO v_bad
      FROM (
        SELECT a.grantee::regrole::text AS who, a.privilege_type AS priv, a.is_grantable AS g
          FROM pg_catalog.pg_class c, aclexplode(c.relacl) a
         WHERE c.oid = v_obj::regclass
           AND a.grantee <> v_owner
           AND NOT (a.grantee = 'service_role'::regrole
                    AND a.privilege_type = 'SELECT'
                    AND NOT a.is_grantable)
      ) x;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'ACL 異常 — % 除了 owner 只准 service_role 的【不可轉授】SELECT,實際多出:%;拒繼續', v_obj, v_bad;
    END IF;
    -- 🔴 欄級 ACL(codex R1 #13):表級閉世界看不到 `GRANT SELECT (col) TO anon`
    --    —— `pg_attribute.attacl` 是另一本帳,而 `has_*_privilege` 對它會少報(memory MEMORY-supabase)。
    SELECT pg_catalog.string_agg(x.who || ':' || x.col, ', ' ORDER BY x.col, x.who) INTO v_bad
      FROM (
        SELECT a.attname AS col, e.grantee::regrole::text AS who
          FROM pg_catalog.pg_attribute a, aclexplode(a.attacl) e
         WHERE a.attrelid = v_obj::regclass AND a.attnum > 0 AND NOT a.attisdropped
           AND a.attacl IS NOT NULL
           AND e.grantee <> v_owner
      ) x;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'ACL 異常 — % 有【欄級】授權,而本檔一格都不該有,實際:%;拒繼續', v_obj, v_bad;
    END IF;
    -- 閉世界只擋多、不擋少 ⇒ 再正向問一次那一格真的在。
    IF NOT pg_catalog.has_table_privilege('service_role', v_obj, 'SELECT') THEN
      RAISE EXCEPTION 'ACL 異常 — service_role 應有 % 的 SELECT(後台顯示路徑);拒繼續', v_obj;
    END IF;
    -- RLS 必須 enabled(零 policy 之下少了它 = 表對非 owner 敞開)。
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                    WHERE c.oid = v_obj::regclass AND c.relrowsecurity) THEN
      RAISE EXCEPTION 'RLS 異常 — % 沒有 ENABLE ROW LEVEL SECURITY;拒繼續', v_obj;
    END IF;
    -- 🔴 policy 必須【恰好是本檔那一條】(codex R1 #13 的閉世界 + RLS 閘的修法)。
    --    ⛔ ~~本檔前一版要求【零 policy】~~ —— 那個模型依賴 service_role 的 BYPASSRLS
    --    ⇒ 已改成顯式政策(理由見上面 §3)。而斷言跟著改成閉世界:多一條、少一條、
    --    或名字/動詞/角色被換掉,都要炸 —— **「有 policy」與「有【對的】policy」是兩個宣稱。**
    SELECT count(*) INTO v_n FROM pg_catalog.pg_policy pol WHERE pol.polrelid = v_obj::regclass;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'RLS 異常 — % 應恰有 1 條 policy(本檔那條 SELECT),實際 % 條;拒繼續', v_obj, v_n;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
       WHERE pol.polrelid = v_obj::regclass
         AND pol.polname = 'order_pending_refunds_select_service_role'
         AND pol.polcmd = 'r'                      -- r = SELECT
         AND pol.polpermissive
         AND pol.polroles = ARRAY['service_role'::regrole]::oid[]
    ) THEN
      RAISE EXCEPTION
        'RLS 異常 — % 那條 policy 的形狀不對(要求:名為 order_pending_refunds_select_service_role、'
        'FOR SELECT、permissive、角色恰為 service_role);拒繼續', v_obj;
    END IF;
    -- 🔴 `FORCE ROW LEVEL SECURITY` 必須是 off(codex R2 #7):零 policy + FORCE
    --    ⇒ **連 owner 都被擋** ⇒ 本檔那支 SECURITY DEFINER trigger 的 INSERT 會失敗
    --    ⇒ 而它失敗的形態是【取消那筆交易一起回滾】。而「RLS 已開」那一格照樣綠。
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                WHERE c.oid = v_obj::regclass AND c.relforcerowsecurity) THEN
      RAISE EXCEPTION 'RLS 異常 — % 開了 FORCE ROW LEVEL SECURITY,而本表零 policy ⇒ 連 owner 都寫不進去;拒繼續', v_obj;
    END IF;
  END LOOP;

  -- ── 5b. 函式 ACL:閉世界。🔴 `proacl IS NULL` = 走預設,而**函式的預設是 PUBLIC EXECUTE** ──
  FOREACH v_obj IN ARRAY v_functions LOOP
    IF to_regprocedure(v_obj) IS NULL THEN
      RAISE EXCEPTION '斷言失敗 — 函式 % 不存在(簽章逐字比對, 打錯會回 NULL);拒繼續', v_obj;
    END IF;
    IF (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = v_obj::regprocedure) IS NULL THEN
      RAISE EXCEPTION 'ACL 異常 — % 的 proacl 是 NULL(=走預設, 而函式預設是 PUBLIC EXECUTE);拒繼續', v_obj;
    END IF;
    SELECT pg_catalog.string_agg(x.who || ':' || x.priv, ', ' ORDER BY x.who, x.priv) INTO v_bad
      FROM (
        SELECT a.grantee::regrole::text AS who, a.privilege_type AS priv
          FROM pg_catalog.pg_proc p, aclexplode(p.proacl) a
         WHERE p.oid = v_obj::regprocedure
           AND a.grantee <> p.proowner
      ) x;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'ACL 異常 — % 是 trigger 函式, 除了 owner 不該有任何 EXECUTE,實際多出:%;拒繼續', v_obj, v_bad;
    END IF;
    -- 🔴 codex R1 #15:只驗字面 ACL 不夠 —— 這支是 SECURITY DEFINER, 它的提權範圍由
    --    `prosecdef` 與 `proconfig` 決定,而那兩格被改掉時 ACL 一個字都不會變。
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                    WHERE p.oid = v_obj::regprocedure AND p.prosecdef) THEN
      RAISE EXCEPTION '函式異常 — % 應為 SECURITY DEFINER(本表零寫入 GRANT, 非 definer 寫不進去);拒繼續', v_obj;
    END IF;
    -- 🔴 **字面陷阱, 當場量到的**:原始碼寫的是 `SET search_path = ''`,
    --    而 PG 17 存進 `proconfig` 的是 **`search_path=""`**(帶兩個真的雙引號)。
    --    第一版比對 `'search_path='` ⇒ **一裝上就紅**, 而紅的是【尺】不是【碼】。
    --    ⇒ 兩種寫法都收, 並且把這句話留著 —— 下一個複製這段的人會撞到同一格。
    -- 🔴 比對【整個 proconfig 陣列】而不是「其中有沒有一項」(codex R2 #9/#15):
    --    舊版只問「有沒有一項是 search_path=」⇒ 有人再塞一個 `statement_timeout=1ms`
    --    進去時它照樣綠, 而那會讓 trigger 查詢逾時 ⇒ 取消整筆回滾。
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                    WHERE p.oid = v_obj::regprocedure
                      AND (p.proconfig = ARRAY['search_path=']
                           OR p.proconfig = ARRAY['search_path=""'])) THEN
      RAISE EXCEPTION '函式異常 — % 應帶 SET search_path = ''''(SECURITY DEFINER 少了它 = 可被搜尋路徑劫持);拒繼續', v_obj;
    END IF;
  END LOOP;

  -- ── 5c. trigger 裝上了, 而且【形狀】對(codex R1 #2)────────────────────────
  --    🔴 舊版只比名字 + 函式 + tgenabled ⇒ 改成 BEFORE、改成 INSERT、改成 STATEMENT level、
  --       或把監聽欄位從 cancelled_at 換掉, **它全部照樣綠**。
  --    tgtype 位元:ROW=1 · BEFORE=2 · INSERT=4 · DELETE=8 · UPDATE=16 · TRUNCATE=32 · INSTEAD=64
  --    ⇒ `AFTER UPDATE … FOR EACH ROW` = 1 | 16 = **17**(BEFORE / INSTEAD 兩位都必須是 0)。
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid = 'public.orders'::regclass
     AND t.tgname = 'order_pending_refund_open_au'
     AND NOT t.tgisinternal
     AND t.tgfoid = 'public.pcm_pending_refund_on_cancel()'::regprocedure
     AND t.tgenabled = 'O'
     AND t.tgtype = 17
     AND t.tgqual IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'trigger 異常 — order_pending_refund_open_au 應恰為 1 個:指向本檔的函式、狀態 O、'
      'tgtype=17(AFTER UPDATE FOR EACH ROW)、無 WHEN 子句。實際符合 % 個;拒繼續', v_n;
  END IF;
  -- 🔴 監聽欄位必須恰好是 cancelled_at 那一欄(`UPDATE OF` 的內容存在 tgattr)。
  --    少了這一格,把 `OF cancelled_at` 拿掉(=監聽整列)仍然 tgtype=17 ⇒ 上面那道看不見。
  SELECT a.attnum INTO v_att
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.orders'::regclass AND a.attname = 'cancelled_at'
     AND a.attnum > 0 AND NOT a.attisdropped;
  -- 🔴 **第二個字面陷阱, 也是當場量到的**:`tgattr` 是 `int2vector` 不是 `int2[]`。
  --    實測 `tgattr::int2[] = ARRAY[2]::int2[]` ⇒ **false**(而 `tgattr::text` ⇒ `'2'`)
  --    ⇒ 第一版寫成那個 cast ⇒ **一裝上就紅, 而紅的是尺不是碼**。
  --    ⇒ 改成比字串表示法, 並把這句留著給下一個複製這段的人。
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                  WHERE t.tgrelid = 'public.orders'::regclass
                    AND t.tgname = 'order_pending_refund_open_au'
                    AND t.tgattr::text = v_att::text) THEN
    RAISE EXCEPTION
      'trigger 異常 — order_pending_refund_open_au 的監聽欄位應【恰好】是 orders.cancelled_at(attnum %);'
      '監聽整列或多欄都會讓這支函式被無關的 UPDATE 叫醒;拒繼續', v_att;
  END IF;

  -- ── 5d. 部分唯一索引真的建起來了(codex R1 #7 的修法靠它)──────────────────
  -- 🔴 驗【真實的鍵與述詞】不只驗「有述詞」(codex R2 #6):述詞被改成只剩
  --    `voided_at IS NULL` 時, 舊版斷言仍綠 —— 而已結清的舊列會回來擋住新列、被 DO NOTHING 吞掉。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
     WHERE i.indexrelid = 'public.order_pending_refunds_live_order_rail_key'::regclass
       AND i.indisunique AND i.indisvalid AND i.indislive
       AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) LIKE '%voided_at IS NULL%'
       AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) LIKE '%settled_at IS NULL%'
       AND (SELECT pg_catalog.array_agg(a.attname::text ORDER BY a.attname::text)
              FROM pg_catalog.pg_attribute a
             WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey::int2[]))
           = ARRAY['order_id', 'rail']
  ) THEN
    RAISE EXCEPTION
      '索引異常 — order_pending_refunds_live_order_rail_key 應為【有述詞的】唯一索引且 valid/live。'
      '⇒ 沒有述詞 = 退回永久唯一 ⇒ 作廢過的舊列會吞掉下一次取消;拒繼續';
  END IF;
END
$post$;

COMMIT;
