-- 20260905070000 · M-4b ⟦b4-NCPCRONRACE⟧
-- 錢落在一張【已取消】的單上時, 也要開一列待退款。
--
-- 🔴🔴 **這一片在補的洞, 是板上一句【假的】話**:
--   `⟦b4-NCPCRONRACE⟧` 逐字寫過「有既有安全網接住 ⇒ 那筆錢會落到 order_pending_refunds 上」。
--   🔬 開檔看那支網的【最新版】(`20260902030000:237`, 不是板上引的 `20260901080000`):
--     它掛 `orders` 的 AFTER UPDATE(`cancelled_at` 由 NULL 變非 NULL 那一刻),
--     而它 INSERT 的資料來自 `pcm_pending_refund_amounts(NEW.id)` ——【當下】算 `order_payments`。
--   🎯 而本競態的時序恰好是:**取消先提交, 收款【之後】才落帳**
--     ⇒ 取消那一刻 `order_payments` 零列 ⇒ 回 0 列 ⇒ **一列待退款都不開**;
--     ⇒ 連那句「收過錢而算出來不欠 ⇒ 出聲」的 RAISE WARNING 也不會響
--       (它的條件也是 `EXISTS (SELECT 1 FROM order_payments …)`)。
--   ⇒ 🛑 **錢落在一張已取消的單上, 而沒有任何一列、任何一句話。**
--
-- 🟢 **而有一件【不用擔心】, 寫出來免得下一個人重推一次**:
--   那張單**不會**被翻成 `paid`。`pcm_noncard_settle_recompute` 的 UPDATE 條件裡
--   **沒有** `cancelled_at IS NULL`(只有樂觀鎖 `payment_status = v_status`)——
--   ⇒ 我第一發從那個 WHERE 推出「已取消的單會被翻成 paid」, **而那是錯的**。
--   ✅ 擋住它的是 OP6a 自己:`20260901030000` 的 **P2「完全沒有取消痕跡(四處)」**
--     ⇒ 取消 ⇒ `p2` false ⇒ `all_ok` false ⇒ verdict = `needs_human` ⇒ 本片刻意不翻狀態。
--   ⇒ 📌 **擋下那個誤報的不是更小心, 是去讀 OP6a, 而不是從呼叫端的 WHERE 推。**
--
-- 範圍(主視觀 2026-09-05 裁, 依 plan §5 / 附錄 A0):**零新表、零新排程**。
--   ⛔ ~~「改既有函式 + 新表 + 排程」~~ 那是 plan 的【一甲 + 二乙 合起來】的清單;
--   Sean 逐字拍的是順序:「甲 = 先修那個洞(要你再貼一次 SQL), 修好再開匯款」。
--
-- 🔴🔴 **本片的已知代價(codex 那輪請特別看這一條)**:
--   它把「開待退款」這件事**放進客人那筆付款的交易裡** ⇒ 交易變長
--   ⇒ **加大 `⟦b4-NCPCANCELROLLBACK⟧`(競態二)的窗口** —— 那條是
--   「重算撞 statement_timeout ⇒ `EXCEPTION WHEN OTHERS` 不接 query_canceled ⇒ 客人那筆收款一起回滾」。
--   ⇒ 📌 **修競態一的動作, 讓競態二更容易發生。** Sean 拍板時不知道這一條(早上補問)。
--   🔵 而本片仍然值得做:競態一**零訊號**, 競態二至少會在應用層丟一個錯誤。
--
-- 🔴🔴 **本片【只修一半】—— 這一行放在檔頭, 因為它決定你怎麼讀底下每一段**:
--   ✅ 修好:取消【已提交】而錢之後才落帳。
--   🔵 **而「同時在飛」那半在【正式取消形狀】下塌成「取消已提交」= 本片修好的那半。**
--     ⛔ ~~沒修:取消與付款同時在飛…溢付那一支連 row lock 都不會拿 ⇒ 零列零訊號~~
--       **那是我的 fixture 造的** —— 我的取消側寫成裸 `UPDATE`, 比正式【少拿一把鎖】。
--     🔬 **兩把獨立的尺同向**(2026-09-05):
--       · 本線 fixture 改成同形後:世界 D 與 C2(溢付)各 0 ⇒ **1 列**
--         🔵 唯一變數就是那發 `FOR UPDATE`(兩個版本都有寫 `order_cancellations`, 從 git 比對過)
--       · 線【資料】`-db` 用**真** `admin_cancel_order` + 真 INSERT 兩連線:四個時序全部 **1 列**
--         (取消先 hold 3s ⇒ 付款等 2.03s · 付款端明確交易 1.96s · 反序取消等 5.05s · 溢付 1500/1000 ⇒ `amount_at_cancel=1500`)
--
--   🔴🔴 **而這件事有一個【前提】, 它比結論重要 —— 前提破, 洞就回來**:
--     **四支寫 `orders.cancelled_at` 的函式, 全部先對該列 `FOR UPDATE`。**逐字座標:
--       `20260904230000:493`  pcm_cron.expire_unpaid_orders     (`FOR UPDATE OF o SKIP LOCKED`)
--       `20260903093000:222`  admin_cancel_order
--       `20260903093000:677`  admin_mark_order_cancelled
--       `20260904050000:91`   begin_charge_attempt
--     ⇒ 🛑 **任何一支被改成裸 `UPDATE`(或新增第五支寫入端而沒拿鎖)⇒ 這一段立刻不成立。**
--     ✅ **而它不靠人記得** —— `scripts/cancelled-at-writers-lock-gate.test.ts` 會紅(本片一併加)。
--   🔵 而**事後掃描器仍然值得做**, 只是主詞從「修競態」變成**兜底**
--     (任何原因漏開的列每 10 分鐘補一次)⇒ 與 ⟦b4-SETTLERETRYNEVER⟧ 合一件, 板列 ⟦b4-NCPCRONRACE⟧。
--
-- rollback:見檔尾。

BEGIN;

-- ══ 前置閘 ══════════════════════════════════════════════════════════════
DO $gate$
BEGIN
  IF pg_catalog.to_regprocedure('public.pcm_pending_refund_amounts(uuid)') IS NULL THEN
    RAISE EXCEPTION '前置閘①失敗:public.pcm_pending_refund_amounts(uuid) 不存在 ⇒ 本片的共用函式沒有金額可算。先貼 20260902030000。';
  END IF;
  IF pg_catalog.to_regprocedure('public.pcm_pending_refund_on_cancel()') IS NULL THEN
    RAISE EXCEPTION '前置閘②失敗:public.pcm_pending_refund_on_cancel() 不存在。先貼 20260901080000 + 20260902030000。';
  END IF;
  IF pg_catalog.to_regprocedure('public.pcm_noncard_settle_recompute(uuid)') IS NULL THEN
    RAISE EXCEPTION '前置閘③失敗:public.pcm_noncard_settle_recompute(uuid) 不存在。先貼 20260904230000。';
  END IF;
  -- 🔴 部分唯一索引必須在 —— 下面那個 ON CONFLICT 指向它, 少了它整支炸。
  -- 🔴🔴 **不能只比 relname + relkind**(codex R1 must-fix ⑤)——
  --    ⛔ ~~我第一版只問「有沒有一個叫這個名字的索引」~~
  --    ⇒ 🛑 **別的 schema 有同名索引 / 正式表上那支被重建成不同 predicate ⇒ 這一格照樣過**,
  --      而下面那個 `ON CONFLICT … WHERE …` 會在 apply 當下才炸(或更糟:配到別的索引)。
  --    ✅ 改成問四件:①它在 public ②它掛的是 order_pending_refunds ③它是【唯一】且有效
  --      ④ 它的定義字面含我們要用的那個 predicate。
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = ic.relnamespace
     WHERE ic.relname  = 'order_pending_refunds_live_order_rail_key'
       AND n.nspname   = 'public'
       AND i.indrelid  = 'public.order_pending_refunds'::regclass
       AND i.indisunique
       AND i.indisvalid
       AND pg_catalog.pg_get_indexdef(i.indexrelid)
             LIKE '%WHERE ((voided_at IS NULL) AND (settled_at IS NULL))%'
       -- 🔴 **還要驗【唯一鍵就是 (order_id, rail)】**(codex R2 must-fix ⑤)——
       --    同名索引改成別的欄位而保留 predicate ⇒ 上面那幾格照樣過,
       --    而 helper 的 `ON CONFLICT (order_id, rail)` 會在執行時才找不到對應索引。
       AND i.indnatts = 2
       AND (SELECT a.attname FROM pg_catalog.pg_attribute a
             WHERE a.attrelid = i.indrelid AND a.attnum = i.indkey[0]) = 'order_id'
       AND (SELECT a.attname FROM pg_catalog.pg_attribute a
             WHERE a.attrelid = i.indrelid AND a.attnum = i.indkey[1]) = 'rail'
  ) THEN
    RAISE EXCEPTION '前置閘④失敗:public.order_pending_refunds 上沒有一支【有效、唯一、predicate 為 voided_at IS NULL AND settled_at IS NULL】的 order_pending_refunds_live_order_rail_key ⇒ 下面那個 ON CONFLICT 的目標落空或配到別支。';
  END IF;
END
$gate$;

-- ══ 1. 抽共用:開待退款的那段邏輯 ════════════════════════════════════════
-- 🔵 **抽出來而不是複製第二份**(plan 附錄 A2)——
--   這一段裡有三個容易漂的東西:`ON CONFLICT` 的部分索引條件 · `DO UPDATE` 的欄位集 ·
--   `cancellation_id` 那個「同一時刻的取消單不是 1 筆就留 NULL 不猜」的判斷。
--   📌 **複製一份, 兩份會各自漂, 而漂掉的那一半在 diff 上與「本來就這樣」長得一樣。**
-- 🔴🔴 **`p_overwrite_amount` 存在的理由 —— 先讀這段, 它是一份【既有合約】(codex R1 must-fix ①)**
--   `order_pending_refunds.amount_at_cancel` 的 `COMMENT ON COLUMN`(`20260901080000`)逐字寫著:
--     「🔴🔴 這是【取消當下】的快照, 不是【現在還欠多少】。**欄名就是那句警告。**」
--     「🛑 它會過期, 而它不會自己更新」
--   ⛔ ~~而我第一版讓 `DO UPDATE` 在【每一筆收款】都跑一次~~
--     ⇒ 🛑 **那把一個文件上說不會自己更新的快照, 變成一個會動的數字。**
--     📌 **我沒有改那個欄位的定義, 我改掉了它的行為 —— 而那兩件事在 diff 上長得一樣。**
--   ✅ 現在:**取消 trigger ⇒ 覆寫(行為不變, 那一刻本來就沒有既有列)**;
--            **收款重算 ⇒ 不覆寫(沒有列才開一列)**。
--   ⚠️ **而「開的那一列裝什麼數字」要照實說**:它不是取消當下的金額(取消當下是 0),
--      **它是我們第一次算得出來時的金額。** 那是這個欄位語意的一個新角落, 已補進欄位 COMMENT。
CREATE FUNCTION public.pcm_pending_refund_open_for(
  p_order_id         uuid,
  p_overwrite_amount boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_cid          uuid;
  v_n            integer;
  v_cancelled_at timestamptz;
BEGIN
  -- 🔴🔴 **`FOR UPDATE` 是這一片的樞紐 —— 它不是防禦性裝飾, 拿掉它整個修法失效。**
  --   🔬 **隔離實驗(拋棄式 PG, 兩條連線)**:取消交易先鎖住 orders 那一列 2 秒 ⇒
  --     付款的 INSERT 因 FK 被擋 ⇒ 取消提交 ⇒ 付款繼續
  --     ⇒ 🔴 **付款的 AFTER trigger 當下讀到的 `cancelled_at` 仍是 NULL**,
  --       而同一張單交易結束後實際是有值的。
  --   🎯 **成因是【快照】不是鎖序**:AFTER trigger 跑在那個 INSERT 語句【裡面】,
  --     用的是那個語句在【被擋之前】取的快照。等鎖等再久, 它看到的還是舊世界。
  --     ⇒ 🛑 **所以「把 advisory 鎖上移到四支取消路徑」那個方案【修不掉它】**(2026-09-05 已證偽)。
  --   🔬 三種讀法各實測一次:
  --     ⛔ 一般 SELECT       ⇒ 看不到取消(= lost-wakeup 重現)
  --     ⛔ `FOR KEY SHARE`   ⇒ **還是看不到** —— 那筆付款【本來就持有 KEY SHARE】(FK 給的)
  --                            ⇒ 它不需要重讀 ⇒ 📌 **一把更嚴格的鎖, 因為你已經持有它而完全沒作用。**
  --     ✅ `FOR UPDATE`      ⇒ 看得到(EvalPlanQual 重讀最新已提交的那一版)
  --   🛑 **而 `20260904230000:198` 逐字警告過「FOR UPDATE 是鎖升級 ⇒ 會死結」—— 我沒有忽略它**:
  --     那句話講的是【用 FOR UPDATE 取代 advisory lock】;
  --     而這裡是【advisory lock 之後再 FOR UPDATE】⇒ 兩筆併發付款先在 advisory L 排隊,
  --     不會兩個同時想升級;而取消側【不拿 advisory L】⇒ 沒有環。
  -- 🔴🔴 **[2026-09-05 R4-F3 之後回頭訂正這整段的【射程】]**
  --   下面那三個讀數(一般 SELECT / FOR KEY SHARE / FOR UPDATE)**每一個都是真的**,
  --   🛑 **而它們量的世界是【取消側裸 UPDATE】—— 那個世界在正式碼裡不存在。**
  --     四支正式取消端全部先 `FOR UPDATE`(座標見檔頭)⇒ 付款的 INSERT 被擋得夠久,
  --     等它進得來時取消已經提交 ⇒ trigger 讀得到 ⇒ **那三個讀數描述的困境到不了線上。**
  --   ⇒ 📌 **一組正確的量測, 量的是一個不存在的世界** —— 而它讀起來與量對了完全一樣。
  --   🔵 **整段留著不刪**, 兩個理由:①它記錄了「advisory lock 來得太晚」那個機制, 那是真的
  --     ②下一個想用 `FOR UPDATE` 繞過的人, 會在這裡撞到那個死結實測。
  --
  --   🔴🔴 **⇒ 而我試了那個排法, 它【被實測推翻】。原作者那句警告是對的。**
  --     🔬 探針世界 E(兩筆併發付款打同一張已取消的單):**真的死結, 而且只有一筆進得去**
  --       ⇒ 🛑 **客人的錢掉了一筆** —— 比原本那個洞更糟。
  --     🎯 **我的論證錯在哪(寫下來, 免得下一個人再推一次)**:
  --       我以為「advisory L 會讓兩筆付款排隊 ⇒ 不會兩個同時想升級」。
  --       ⇒ 而 **FK 的 KEY SHARE 是那個 INSERT 自己拿的, 在【任何 trigger 跑之前】** ——
  --         兩筆付款【都已經】持有 KEY SHARE, 然後才輪到 advisory L。
  --       ⇒ 📌 **advisory lock 來得太晚, 它序列化不了一個比它更早被拿走的鎖。**
  --   ✅ **所以這裡【不加 FOR UPDATE】** —— 那個競態改由**事後掃描器**收(見板列)。
  --   🔴🔴 **而那支掃描器現在有名字了**:`20260905180000` 的
  --      `pcm_cron.late_payment_pending_refund_sweep`(排程 `pcm-late-payment-sweep`, `*/10`)。
  --      ⇒ 🛑 **這一句是雙向的**:那支檔的檔頭也指回這裡。
  --        **關掉它 = 關掉這一行交出去的那個世界的唯一接手者** —— 而它的檔頭寫著「只是兜底」,
  --        📌 **一個讀起來像可有可無的東西, 其實是這裡明文託付的。兩邊都指對方, 誰關掉都撞得到。**
  SELECT o.cancelled_at INTO v_cancelled_at
    FROM public.orders o WHERE o.id = p_order_id;

  -- 🔴 **沒取消 ⇒ 什麼都不做。** 這一格讓呼叫端不必自己判斷 ——
  --    而那是刻意的:呼叫端有兩個(取消 trigger 與收款重算), 判斷放在這裡只有一份。
  IF v_cancelled_at IS NULL THEN
    RETURN;
  END IF;

  -- 🔴🔴 **一次查詢拿【兩個值】—— codex 2026-09-05 R1 must-fix ②。**
  --    ⛔ ~~我第一版寫成「先 count, count=1 才 SELECT id」~~ **那與原 trigger 不等價,
  --      而且重新引入 TOCTOU**:Read Committed 下兩次 SELECT 看得到【不同快照】
  --      ⇒ count 讀到 1 之後才插入第二筆 ⇒ 第二發 `SELECT INTO` **沒有 STRICT**
  --      ⇒ PostgreSQL **任取一列、其餘丟棄** ⇒ 寫進一個【任意的】cancellation_id。
  --    🛑 而主視窗要我「修回原寫法」—— **我做得更強一格**:原寫法(先 SELECT 再 count)
  --      在那個時序會清成 NULL(所以它是安全的), **而它仍然是兩次讀**。
  --      ✅ 合成一句 ⇒ **兩個值來自同一個快照** ⇒ 那個時序窗口【結構上不存在】。
  --    🔵 `(array_agg(c.id))[1]` 只在 v_n = 1 時被採用 ⇒ 「任取一列」那個危險用不到。
  SELECT count(*), (array_agg(c.id))[1] INTO v_n, v_cid
    FROM public.order_cancellations c
   WHERE c.order_id = p_order_id AND c.created_at = v_cancelled_at;

  IF v_n <> 1 THEN
    -- 🔵 歸屬留白不猜(照 20260902030000 原本的判斷)。
    IF v_n > 1 THEN
      RAISE WARNING
        '待退款歸屬留白 — 訂單 % 在 cancelled_at=% 這個時刻有 % 筆取消單(期望 1)⇒ cancellation_id 留 NULL 不猜。',
        p_order_id, v_cancelled_at, v_n;
    END IF;
    v_cid := NULL;
  END IF;

  -- 🔴 收過非卡的錢而算出來不欠 ⇒ 出聲(照 20260902030000 R3 must-fix, 逐字搬)。
  IF EXISTS (SELECT 1 FROM public.order_payments p
              WHERE p.order_id = p_order_id AND p.rail IN ('bank_transfer', 'cash'))
     AND NOT EXISTS (SELECT 1 FROM public.pcm_pending_refund_amounts(p_order_id)) THEN
    RAISE WARNING
      '取消單 %:這張單【收過非卡的錢】, 而算出來一列待退款都不用開。'
      '🔴 最常見的成因是【人工退款登記打錯金額】(例如多一個 0)—— 那會讓帳面看起來不欠錢。'
      '⇒ 請對一次 order_manual_refunds 上那幾筆的金額。', p_order_id;
  END IF;

  INSERT INTO public.order_pending_refunds
    (order_id, cancellation_id, rail, amount_at_cancel)
  SELECT p_order_id, v_cid, a.rail, a.amount
    FROM public.pcm_pending_refund_amounts(p_order_id) AS a
  ON CONFLICT (order_id, rail) WHERE voided_at IS NULL AND settled_at IS NULL
  DO UPDATE SET amount_at_cancel = EXCLUDED.amount_at_cancel,
                cancellation_id  = EXCLUDED.cancellation_id
  -- 🔴 **收款重算那條路 `p_overwrite_amount = false` ⇒ 這個 DO UPDATE 整段不執行**
  --    ⇒ 既有那一列的快照【不被動到】(見本函式上方那段合約)。
  --    🔵 而「沒有列」那個世界不受影響 —— INSERT 照樣開一列, 那正是本片要補的洞。
   WHERE p_overwrite_amount;
END
$fn$;

COMMENT ON FUNCTION public.pcm_pending_refund_open_for(uuid, boolean) IS
  'M-4b ⟦b4-NCPCRONRACE⟧:對一張【已取消】的單, 依 pcm_pending_refund_amounts 逐軌開/更新待退款列。'
  '沒取消 ⇒ 什麼都不做(判斷放在本函式, 兩個呼叫端不必各判一次)。'
  '呼叫端二:①pcm_pending_refund_on_cancel(取消那一刻, p_overwrite_amount 預設 true)'
  '②pcm_noncard_settle_recompute(錢比取消晚到那一刻, 傳 false)。'
  '⛔ ~~ON CONFLICT DO UPDATE ⇒ 冪等且自我修正:金額以最新算出來的為準~~ **那句作廢(codex 2026-09-05 R1 must-fix ①)**:'
  'amount_at_cancel 的 COMMENT 逐字寫著它是【取消當下的快照、不會自己更新】⇒ 讓它每筆收款都更新, 是改掉那個欄位的行為。'
  '✅ 現在:p_overwrite_amount=false 時 DO UPDATE 整段不執行 ⇒ 既有列的快照不被動到;沒有列才開一列。'
  '⚠️ 而【收款晚到那條路開的那一列】裝的不是取消當下的金額(那時是 0), 是我們第一次算得出來時的金額 —— 那是本欄語意的一個新角落。';

-- 🔴🔴 **補進【欄位】的 COMMENT, 不只寫在函式上**(codex R2 must-fix ②)——
--   ⛔ ~~我第一版的註解宣稱「新角落已補進欄位 COMMENT」而實際只補在函式 COMMENT~~
--   ⇒ 📌 又一次字面 vs 事實, 而且是我自己寫的那句。
-- 🛑 用 `COMMENT ON COLUMN` = **覆寫**, 不是追加 ⇒ 這裡把 20260901080000 那段【全文帶回來】再加新那一句。
COMMENT ON COLUMN public.order_pending_refunds.amount_at_cancel IS
  '🔴🔴 **這是【取消當下】的快照, 不是【現在還欠多少】。欄名就是那句警告。**'
  '口徑 = SUM(order_payments.amount 同軌) − SUM(order_manual_refunds.refund_amount 同軌且未作廢)。'
  '🛑 **它會過期, 而它不會自己更新** —— 取消之後仍然可以:登記一筆退款 / 沖銷一筆收款 / 作廢一筆退款,'
  '三件事都會讓這個數字與事實分岔(codex R1 #4/#5/#8)。'
  '✅ **要知道【現在】還欠多少, 不要讀本欄 —— 呼叫 public.pcm_manual_refund_rail_cap(order_id)**'
  '(`20260824010000:117`):它 SUM public.order_payments.amount(rail IN (bank_transfer, cash))'
  '減掉 SUM public.order_manual_refunds.refund_amount(voided_at IS NULL), 兩段皆 COALESCE(...,0)。'
  '⚠️ 差別:那支函式是【兩軌合計】, 本欄是【逐軌】⇒ 逐軌要自己加 rail 條件。'
  '🔴 而本表的金額【不在】那支函式的分母裡 —— 見 COMMENT ON TABLE。'
  '🔴 **第四種會讓本欄與事實分岔的情形(2026-09-05 補)**:取消【之後】又收到一筆錢 ——'
  '本欄停在第一次算出來的數, 而客人已經多付了。前三種見上(登記退款 / 沖銷收款 / 作廢退款)。'
  '🆕 **2026-09-05 新增一個角落(⟦b4-NCPCRONRACE⟧)**:錢比取消【晚】落帳時,'
  'pcm_pending_refund_open_for 會補開一列, 而那一列裝的**不是取消當下的金額**(那時是 0),'
  '是**我們第一次算得出來時的金額**。⇒ 它仍然是快照, 只是那個「當下」晚了一點。';

ALTER FUNCTION public.pcm_pending_refund_open_for(uuid, boolean) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.pcm_pending_refund_open_for(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_pending_refund_open_for(uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.pcm_pending_refund_open_for(uuid, boolean) FROM authenticated;
REVOKE ALL ON FUNCTION public.pcm_pending_refund_open_for(uuid, boolean) FROM service_role;

-- ══ 2. 取消 trigger 改成呼叫共用的那一支 ═════════════════════════════════
-- 🔵 **trigger 自己的那道 guard 留在 trigger 裡** —— 它問的是【這次 UPDATE 的轉換】
--    (`OLD.cancelled_at IS NULL` ⇒ `NEW.cancelled_at IS NOT NULL`), 而共用函式問的是
--    【這張單現在是不是已取消】。⇒ 📌 兩個問題不同, 不可以合併成一個。
CREATE OR REPLACE FUNCTION public.pcm_pending_refund_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF OLD.cancelled_at IS NOT NULL OR NEW.cancelled_at IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM public.pcm_pending_refund_open_for(NEW.id);
  RETURN NULL;
END;
$fn$;

ALTER FUNCTION public.pcm_pending_refund_on_cancel() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pcm_pending_refund_on_cancel() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_pending_refund_on_cancel() FROM anon;
REVOKE ALL ON FUNCTION public.pcm_pending_refund_on_cancel() FROM authenticated;
REVOKE ALL ON FUNCTION public.pcm_pending_refund_on_cancel() FROM service_role;

-- ══ 3. 收款重算:加一行呼叫(其餘【逐字取自 20260904230000, 用 awk 抽的, 沒有重打】)══
-- 🔬 產生方式:awk 抽出整支 → 只做兩處改動 → diff 驗:刪 1 行(CREATE ⇒ CREATE OR REPLACE)
--    + 加 13 行(那一段呼叫與它的理由)。**其餘一個字都沒動。**
CREATE OR REPLACE FUNCTION public.pcm_noncard_settle_recompute(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_status   public.payment_status;
  v_res      jsonb;
  v_verdict  text;
  v_received bigint;
  v_new      public.payment_status;
  v_hit      integer;
BEGIN
  -- 🔴🔴 例外區塊【整段包住】, 不是只包 OP6a 那一發(v4 §4 對 v2 的更正)。
  --    Sean 拍的那一條:計算器跑不動**不得**讓收款那一列跟著回滾。
  --    而 v2 只包了 OP6a ⇒ 兩個 SUM、UPDATE、以及 UPDATE 觸發的下游 trigger
  --    全在保護之外 ⇒ 它們任何一個拋錯, 客人那筆收款就消失了。
  --    plpgsql 的 BEGIN…EXCEPTION 自帶 savepoint ⇒ 這裡吞掉的只有重算, 不含外面那筆 INSERT。
  -- ⚠️ 誠實邊界:`EXCEPTION WHEN OTHERS` 依 PostgreSQL 定義**不接** query cancel
  --    (SQLSTATE 57014)⇒ statement_timeout 或人工 cancel 仍會冒出去、連帶回滾那筆收款。
  --    本片**沒有修掉這條路**, 它是已知殘留風險(與 20260903080000 心跳那段同一種)。
  BEGIN
    -- 🔴🔴 **每張單一把 advisory lock**(codex R1 must-fix, :203)。
    --    沒有它:兩筆【各自不足、合計付清】的收款同時進來 ⇒ READ COMMITTED 下
    --    兩邊的 SUM 都看不到對方【尚未提交】的那一筆 ⇒ 兩邊都算出 underpaid
    --    ⇒ 兩邊都寫 partiallyPaid ⇒ 🛑 **訂單永久停在「部分付款」, 而錢已經收齊了。**
    --    ⚠️ 而樂觀鎖擋不住這個 —— 它擋的是「別人改過我就不覆蓋」, 而這裡**兩邊算的都是舊世界**。
    -- ✅ 用 advisory 而不是 `SELECT … FOR UPDATE`:後者是鎖升級(那筆 INSERT 的 FK
    --    已對同一列持有 KEY SHARE)⇒ 會死結。advisory 不碰 orders 那一列的鎖。
    -- 🔵 xact 版 ⇒ 交易結束自動釋放, 不需要(也不可能忘記)解鎖。
    PERFORM pg_catalog.pg_advisory_xact_lock(
              pg_catalog.hashtextextended(p_order_id::text, 0));

    -- 🔴🔴 **⟦b4-NCPCRONRACE⟧(20260905070000 新增的唯一一段)**:
    --    錢比取消【晚】到時, `orders` 的 AFTER UPDATE 那道網已經跑完了(當時 order_payments 零列)
    --    ⇒ **一列待退款都不會開**。這一行是那個世界唯一的補救。
    -- 🔵 **沒取消 ⇒ 它自己 RETURN**(判斷在 `pcm_pending_refund_open_for` 裡, 只有一份)
    --    ⇒ 正常路徑的成本 = 一次 by-id 的 SELECT。
    -- 🛑 **位置刻意在【所有 RETURN 之前】** —— 下面每一條 early-return(狀態值域 / 有人工退款 /
    --    verdict 不翻)在【已取消】那個世界裡都會被走到, 而錢已經在庫裡了。
    --    ⇒ 📌 放在任何一條 RETURN 後面, 就會有一條路漏掉它。
    -- ⚠️ **而它在這個 BEGIN…EXCEPTION 區塊【之內】** —— 它丟例外時吞在這裡,
    --    **不得回滾客人那筆收款**(那正是 20260904230000 檔頭那段誠實邊界在講的事)。
    -- 🔴 `false` = **不覆寫既有列的金額**(見該函式上方那段合約:那一欄是快照, 不會自己更新)。
    -- 🔴🔴 **自己包一層 nested BEGIN…EXCEPTION**(adversarial-reviewer R3 must-fix ⑤)——
    --   ⛔ ~~我第一版讓這一行與【狀態重算】共用外面那個 `EXCEPTION WHEN OTHERS`~~
    --   ⇒ 🛑 **open_for 丟例外 ⇒ 整段被吞 ⇒ 錢入帳而 payment_status 不翻、付款信永遠不寄。**
    --     📌 **我為了補一個洞而加的一行, 會讓主線靜靜地不執行。**
    --   ✅ 現在:它自己吞自己的例外, **不影響下面的狀態重算**。
    --   🔵 而 plpgsql 的 BEGIN…EXCEPTION 自帶 savepoint ⇒ 這裡吞掉的只有這一行, 不含外面那筆 INSERT。
    BEGIN
      PERFORM public.pcm_pending_refund_open_for(p_order_id, false);
    -- 🛑 **`WHEN OTHERS` 吞的是什麼, 寫清楚**(R4 nit ①):它涵蓋一般錯誤
    --    (`deadlock_detected` / `lock_timeout` / 約束違反 / 權限),
    --    **而依 PostgreSQL 定義【不接】`query_canceled`(57014)與 `assert_failure`**
    --    ⇒ statement_timeout 或人工 cancel 仍會穿透這裡、連帶回滾外面那筆收款
    --      (那是既有的 ⟦b4-NCPCANCELROLLBACK⟧, 本片沒有修掉它)。
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG '[pcm_noncard_settle] order=% 補開待退款失敗(%), 狀態重算照常進行',
                p_order_id, SQLERRM;
    END;

    SELECT o.payment_status INTO v_status
      FROM public.orders o
     WHERE o.id = p_order_id;

    -- 🔵 單不見了(理論上不會 —— order_payments.order_id 是 FK)⇒ 不讓收款回滾。
    IF v_status IS NULL THEN
      RETURN;
    END IF;

    -- 🔴 可判定集:只有這三個值本片才動。
    --    (這三個值與 OP6a 的前提 P1 逐字相同 ⇒ 兩邊本來就對齊, 不是我另外挑的。)
    IF v_status NOT IN ('unpaid'::public.payment_status,
                        'paid'::public.payment_status,
                        'partiallyPaid'::public.payment_status) THEN
      RETURN;
    END IF;

    -- 🔴🔴 v4 的形狀:**有任何退款活動 ⇒ 交還退款管線, 本片一個字都不寫。**
    --    ⛔ ~~v2 在這裡自己算 refunded / partiallyRefunded~~ —— 那會是**第二個寫入端**。
    --    退款那半自 2026-08-23 起有人管:`admin_record_manual_refund` 會呼叫
    --    `pcm_sync_order_refund_payment_status`
    --    (`20260823020000_m4b_refund_notify_p2a_record_calls_sync.sql`, 檔名逐字
    --     `record_calls_sync`;該檔 :17 逐字「只加這一行, 其餘一字未改」)。
    -- 🔴🔴 **[2026-09-04 訂正]** 上面那句「退款那半自 2026-08-23 起有人管」**疑似不成立** ——
    --    完整因果與複量見檔頭那段訂正。
    --    ⛔ ~~「該支同步器只讀 `order_refunds`, 不讀 `order_manual_refunds`」~~
    --      ⚠️ **只在 `20260905010000` 【貼進正式庫之後】才不成立**(⟦b4-MANREFUNDNOOWNER2⟧)——
    --      🔴 **本句刻意不寫成「已經不成立」**(codex R2 must-fix):較早的 migration 不能替
    --        較晚那一支背書 —— **後片若失敗, 正式庫就留下一句假註解, 而沒有東西會叫。**
    --      ✅ 判法(不要問帳本):`SELECT position('order_manual_refunds' in prosrc) > 0
    --        FROM pg_proc WHERE proname = 'pcm_sync_order_refund_payment_status'`
    --    🔵 ⇒ **本片檔頭最早那句「退款那半有人管」現在【又成立了】** —— 而它繞了一圈:
    --      09-04 我寫它為真 ⇒ 同夜證實為假 ⇒ 09-05 把它做成真的。
    --      📌 三句都留著不刪, 因為**中間那句假的時候, 有人可能已經照它做過決定**。
    --    🛑 **本片的動作不變**(一律 RETURN, 那是安全的);**變假的是理由。**
    --    ⇒ 板列 `⟦b4-MANREFUNDNOOWNER2⟧`。舊字面留著不刪。
    -- 🎯 codex 演出的後果:total=1000, 先人工退 400(v2 寫 partiallyRefunded), 之後卡片再退 600
    --    ⇒ 兩本退款帳合計已達 1000, 而卡片 helper 只看自己的 600
    --    ⇒ **狀態永久停在 partiallyRefunded, 不會成為 refunded。而它不報錯。**
    -- 🔵 voided_at 非空 = 那筆退款被作廢 ⇒ 錢沒有真的離開 ⇒ 不算退款活動。
    -- 🔴🔴 **[2026-09-05 改成 EXISTS, 不再加總金額]**
    --    ⛔ ~~原本 `SELECT coalesce(sum(m.refund_amount), 0) INTO v_manual`~~ **作廢**。
    --    🔬 成因:`packages/domain/src/order/refund-remaining-single-source.test.ts`
    --      (⟦#473b-1⟧「已退/還能退」單一來源守門)判本檔紅 —— 逐字
    --      「如果它自己算『已退 / 還能退』, 那就是要防的繞路」。
    --    ✅ **而它抓對了一半:我確實在 SUM 退款金額** —— 🔵 **而那個和從來沒有被當成金額用**:
    --      剝註解後全檔 `v_manual` 只出現在 ①宣告 ②這一句 ③`> 0` ④一行 log。
    --    🎯 **⇒ 我要的一直是「有沒有」, 而我寫成了「多少」** ——
    --      ⇒ 📌 **多算出來的那個數字沒有用途, 而它讓一道正確的守門對我叫。**
    --      ⇒ ⇒ 🔴 **正確的修法不是去 allowlist 開一個例外, 是【不要算那個和】。**
    --        (開例外要寫 why 且要有人審 ⇒ 那是把一個我造出來的問題轉成別人的閱讀成本。)
    --    🔵 語意零改變:`sum(...) > 0` 與 `EXISTS` 在 `refund_amount > 0` 這個 CHECK 下等價
    --      —— 🔬 `20260820010000` 建表逐字 `refund_amount integer NOT NULL CHECK (refund_amount > 0)`
    --      ⇒ 不可能有 0 或負數列讓兩者分岔。
    IF EXISTS (
      SELECT 1 FROM public.order_manual_refunds m
       WHERE m.order_id = p_order_id
         AND m.voided_at IS NULL
    ) THEN
      RAISE LOG '[pcm_noncard_settle] order=% 有未作廢的人工退款 ⇒ 交還退款管線, 本片不寫',
                p_order_id;
      RETURN;
    END IF;

    v_res     := public.admin_compute_order_settlement(p_order_id);
    v_verdict := v_res ->> 'verdict';

    SELECT coalesce(pg_catalog.sum(p.amount), 0) INTO v_received
      FROM public.order_payments p
     WHERE p.order_id = p_order_id;

    -- 🔬 verdict 四個值域逐字取自 20260901030000_m4b_zero_total_settle.sql
    --    (該檔 OP6a 段 grep ⇒ settled 1 / underpaid 1 / overpaid 1 / needs_human 2;
    --     負對照一個不存在的 verdict ⇒ 0)。
    IF v_verdict = 'settled' THEN
      v_new := 'paid'::public.payment_status;

    ELSIF v_verdict = 'underpaid' THEN
      -- 收了一部分 ⇒ partiallyPaid;一毛都沒收(或被沖銷光)⇒ 回到 unpaid
      IF v_received > 0 THEN
        v_new := 'partiallyPaid'::public.payment_status;
      ELSE
        v_new := 'unpaid'::public.payment_status;
      END IF;

    ELSE
      -- 🔴 `overpaid` 與 `needs_human` 一律【不翻】。
      --    overpaid:payment_status 的值域裡**沒有**對應的值(unpaid / paid / partiallyPaid /
      --      refunded / partiallyRefunded 共 5 個)⇒ 開一列給人看, 不猜一個最接近的。
      --    needs_human:它自己宣告算不清 ⇒ 不該由它決定終態。
      -- 🛑 而「不翻是安全的」這句話**依賴 `20260904230000` 第 4 節那條 cron 腿**(R3 nit ②:
      --    這段是從那支檔【逐字搬過來】的, 而「本檔」兩個字跟著搬 ⇒ 在這裡指到了錯的檔。
      --    📌 **自指座標會在搬家的那一刻靜靜地指錯, 而它讀起來完全正常。**)—— 沒有它, 這兩種單
      --    仍然是 unpaid ⇒ 隔天照樣被取消 ⇒ 缺陷的形狀與今天一模一樣, 只是變窄。
      --    ⇒ 📌 **兩段必須同一支 migration**, 不可以拆開先上一半。
      RAISE LOG '[pcm_noncard_settle] order=% verdict=% ⇒ 不翻狀態(值域無對應值或算不清)',
                p_order_id, v_verdict;
      RETURN;
    END IF;

    -- 🔴🔴 條件式 UPDATE 取代 `SELECT … FOR UPDATE`(v4 §4 對 v2 的更正)。
    --    v2 一開頭就 `FOR UPDATE` 那一列, 而本函式是**在 order_payments 的 INSERT 之後**跑的
    --    ⇒ 那筆 INSERT 的 FK 已經在同一列上拿了 KEY SHARE ⇒ FOR UPDATE 是**鎖升級**
    --    ⇒ 兩筆收款同時進來時互等 ⇒ 死結。
    -- ✅ 改法:把「我讀到的狀態」寫進 WHERE ⇒ 別人先改過就 0 列, 我不覆蓋他。
    --    這是樂觀鎖, 不是少了一道保護 —— 而它會少寫的那一次, 正是該少寫的那一次。
    IF v_new IS DISTINCT FROM v_status THEN
      UPDATE public.orders o
         SET payment_status = v_new,
             -- 🔴🔴 **翻成 paid 必須同時填 `paid_at`**(codex R1 must-fix, :204)。
             --    🔬 全 repo 6 處 `paid_at = pg_catalog.now()` —— **全在卡片那條路**
             --      (最早 `20260611120000_m3_s2c_confirm_payment_rpc.sql:180`)。
             --    🔬 而 `20260831030000_m4b_e4_order_created_gap_counts.sql:134` 逐字:
             --      「述詞與 SupabasePaidOrderScannerAdapter 對齊:paid + cancelled_at IS NULL
             --       + **paid_at/created_at 皆 >= cutoff**」
             --    ⇒ 🎯 **只翻 payment_status 不填 paid_at ⇒ 匯款單結清成功, 而付款信永遠不寄**
             --       —— 它在掃描器眼裡不存在。而**沒有任何東西會叫**。
             --    🔵 `coalesce` 而非直接覆寫:同一張單若已經有付款時刻, 不得被後到的重算改掉
             --      (雙扣偵測 `20260701130000:98` 用 `paid_at IS NOT NULL` 配對, 時刻被動會誤判)。
             --    🔵 非 paid 的分支一個字都不碰它 —— 本片不負責把 paid_at 清掉。
             paid_at        = CASE WHEN v_new = 'paid'::public.payment_status
                                   THEN coalesce(o.paid_at, pg_catalog.now())
                                   ELSE o.paid_at END,
             updated_at     = pg_catalog.now()
       WHERE o.id             = p_order_id
         AND o.payment_status = v_status;   -- 🔴 樂觀鎖:狀態被別人改過就不寫
      GET DIAGNOSTICS v_hit = ROW_COUNT;

      IF v_hit = 0 THEN
        RAISE LOG '[pcm_noncard_settle] order=% 狀態在重算期間被別人改掉 ⇒ 本次不寫(讀到 %)',
                  p_order_id, v_status;
      ELSE
        RAISE LOG '[pcm_noncard_settle] order=% % -> % (verdict=% received=%)',
                  p_order_id, v_status, v_new, v_verdict, v_received;
      END IF;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    RAISE LOG '[pcm_noncard_settle] order=% 重算失敗(%), 收款事實保留、狀態不動',
              p_order_id, SQLERRM;
  END;
END
$fn$;

-- ══ 事後閘 ════════════════════════════════════════════════════════════════
DO $gate$
DECLARE
  v_src text;
  v_fn  text;
  -- 🔴 **具名清單**:收權斷言【只檢查你列出來的物件】—— 它防「忘記收權」, 不防「忘記列」。
  --    ⇒ 📌 所以清單本身要看得見, 而不是藏在一個 inline 的 IN (…) 裡。
  v_functions text[] := ARRAY[
    'public.pcm_pending_refund_open_for(uuid, boolean)',
    'public.pcm_pending_refund_on_cancel()',
    'public.pcm_noncard_settle_recompute(uuid)'
  ]::text[];
BEGIN
  -- ① 共用函式存在
  IF pg_catalog.to_regprocedure('public.pcm_pending_refund_open_for(uuid, boolean)') IS NULL THEN
    RAISE EXCEPTION '事後①失敗:public.pcm_pending_refund_open_for(uuid, boolean) 不存在。';
  END IF;

  -- ② 🔴 **取消 trigger 真的改成【呼叫共用的那一支】, 不是留了一份複製**
  --    ⇒ 這一格才是「抽共用」這個決定的守門;少了它, 一個把舊 INSERT 貼回去的版本會全綠。
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.pcm_pending_refund_on_cancel()'::regprocedure;
  -- 🔴🔴 **先剝掉 `--` 註解再比**(codex R1 must-fix ③)——
  --    ⛔ ~~我第一版直接對 prosrc 做 strpos~~ ⇒ **只要刪掉真正那行 PERFORM、
  --      留著一句提到它的註解, 這道閘照樣綠。**
  --    📌 那正是我今晚在別片修過的同一個病(閘被自己要守的東西的註解餵綠), 我在這裡又寫了一次。
  -- 🔴 剝 `--` 行註解 **與** `/* … */` 區塊註解(codex R2 must-fix ③:我第一版只剝了前者
  --    ⇒ 留一個 `/* pcm_pending_refund_open_for */` 照樣餵綠)。
  -- 🛑 **天花板照實寫**:它仍然剝不掉【字串常數】裡的那個名字
  --    ⇒ 有人寫 `RAISE NOTICE 'pcm_pending_refund_open_for'` 還是騙得過。
  --    ⇒ 📌 這道閘問的是「那個名字在不在」, 答不了「它在不在可達的控制流上」。
  --      真正把它釘住的是 `docs/probes/*.sh` 那兩支(行為層), 不是這裡。
  v_src := pg_catalog.regexp_replace(v_src, '--[^' || chr(10) || ']*', '', 'g');
  v_src := pg_catalog.regexp_replace(v_src, '/\*.*?\*/', '', 'gs');
  IF pg_catalog.strpos(v_src, 'pcm_pending_refund_open_for') = 0 THEN
    RAISE EXCEPTION '事後②失敗:pcm_pending_refund_on_cancel 沒有呼叫 pcm_pending_refund_open_for ⇒ 它還留著自己那一份複製。';
  END IF;
  IF pg_catalog.strpos(v_src, 'INSERT INTO public.order_pending_refunds') > 0 THEN
    RAISE EXCEPTION '事後②b失敗:pcm_pending_refund_on_cancel 裡【仍然有】自己的 INSERT ⇒ 兩份會各自漂。';
  END IF;

  -- ③ 收款重算也接上了
  SELECT pg_catalog.regexp_replace(
           pg_catalog.regexp_replace(p.prosrc, '--[^' || chr(10) || ']*', '', 'g'),
           '/\*.*?\*/', '', 'gs') INTO v_src
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.pcm_noncard_settle_recompute(uuid)'::regprocedure;

  -- 🔴🔴 **驗它【真的傳 false】**(codex R2 must-fix ⑥)——
  --    ⛔ ~~上一格只問「有沒有呼叫 open_for」~~ ⇒ 有人把那行改成省略參數(用預設 true)
  --      ⇒ 收款那條路會**覆寫既有列的快照** ⇒ 而閘照樣綠。
  -- 🔵 這一格【排在 ③ 之前跑】, 所以編號寫 ③a 不寫 ③b(R3 nit ⑤:編號與執行順序不一致
  --    ⇒ 真的紅的時候, 讀訊息的人會以為 ③ 已經過了)。
  IF pg_catalog.strpos(v_src, 'pcm_pending_refund_open_for(p_order_id, false)') = 0 THEN
    RAISE EXCEPTION '事後③a失敗:pcm_noncard_settle_recompute 沒有以 false 呼叫 open_for ⇒ 收款那條路會覆寫快照。(⚠️ 本格排在 ③ 之前, ③ 尚未驗)';
  END IF;
  IF pg_catalog.strpos(v_src, 'pcm_pending_refund_open_for') = 0 THEN
    RAISE EXCEPTION '事後③失敗:pcm_noncard_settle_recompute 沒有呼叫 pcm_pending_refund_open_for ⇒ 錢比取消晚到那條路仍然沒有網。';
  END IF;

  -- ④ 🟢 **正對照:那支重算的其他東西還在** —— 少了這一格, 一個「整支被我換成一行 PERFORM」
  --    的版本會讓 ③ 全綠。挑三個它本來就有的字面。
  IF pg_catalog.strpos(v_src, 'pg_advisory_xact_lock') = 0
     OR pg_catalog.strpos(v_src, 'admin_compute_order_settlement') = 0
     OR pg_catalog.strpos(v_src, 'EXCEPTION') = 0 THEN
    RAISE EXCEPTION '事後④失敗:pcm_noncard_settle_recompute 少了 advisory lock / OP6a 呼叫 / EXCEPTION 其中之一 ⇒ 我把它換掉了而不是加一行。';
  END IF;

  -- ⑤ ACL 白名單:owner 以外不得有 grantee(三支都問)
  FOREACH v_fn IN ARRAY v_functions LOOP
    IF EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc p,
             LATERAL pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
       WHERE p.oid = v_fn::regprocedure
         AND a.grantee <> p.proowner
    ) THEN
      RAISE EXCEPTION '事後⑤失敗:% 有 owner 以外的 grantee。', v_fn;
    END IF;
  END LOOP;

  -- ⑥ 🔴 **誰【變得成】 owner** —— ⑤只看直接 grantee(codex 2026-09-01 R1 must-fix ⑥ 同型)
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid = 'public.pcm_pending_refund_open_for(uuid, boolean)'::regprocedure
       AND (pg_catalog.pg_has_role('anon',          p.proowner, 'MEMBER')
         OR pg_catalog.pg_has_role('authenticated', p.proowner, 'MEMBER'))
  ) THEN
    RAISE EXCEPTION '事後⑥失敗:anon 或 authenticated 切得成本函式的 owner ⇒ 它們執行得了, 而⑤看不到這條路。';
  END IF;

  -- 🔴🔴 ⑦ **驗【trigger 本身】, 不只驗函式**(codex R1 must-fix ④)——
  --    ⛔ ~~前六道只問「那兩支函式存在、正文含什麼」~~
  --    ⇒ 🛑 **把 trigger disable、改掛別支函式、或直接移除, 六道全部照樣過。**
  --      而探針是手動呼叫 helper ⇒ 它也綠 ⇒ **正式收款 INSERT 不會開待退款, 而沒有東西會叫。**
  --    ⇒ 📌 「函式在」與「它真的會被觸發」是兩個宣稱 —— 今晚第五次同型。
  --    🔵 `tgenabled = 'O'`:O/D/R/A 四態裡只有 O 是安全的(A 在 Supabase restore 的 replica 模式下也會觸發)。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
     WHERE t.tgname    = 'pcm_noncard_settle_after_payment_ai'
       AND t.tgrelid   = 'public.order_payments'::regclass
       AND t.tgfoid    = 'public.pcm_noncard_settle_after_payment()'::regprocedure
       AND t.tgenabled = 'O'
       -- 🔴 **精確比對, 不是位元遮罩**(codex R2 must-fix ④):遮罩只問「有沒有 INSERT」,
       --    ⇒ 額外掛上 UPDATE / DELETE 照樣過。5 = ROW(1) + INSERT(4)。
       AND t.tgtype = 5
  ) THEN
    RAISE EXCEPTION '事後⑦失敗:order_payments 上的 pcm_noncard_settle_after_payment_ai 不存在 / 被 disable / 掛了別支函式 / 事件位元不對 ⇒ 收款晚到那條路【不會被觸發】。';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
     WHERE t.tgname    = 'order_pending_refund_open_au'
       AND t.tgrelid   = 'public.orders'::regclass
       AND t.tgfoid    = 'public.pcm_pending_refund_on_cancel()'::regprocedure
       AND t.tgenabled = 'O'
       -- 🔴 17 = ROW(1) + UPDATE(16)。同上:精確比對, 不用遮罩。
       AND t.tgtype = 17
  ) THEN
    RAISE EXCEPTION '事後⑦b失敗:orders 上的 order_pending_refund_open_au 不存在 / 被 disable / 掛了別支函式 / 事件位元不對 ⇒ 取消那條路也不會被觸發。';
  END IF;

  -- 🔵 數字寫「幾組」很容易過期(R3 nit ①:我寫八而實際七)⇒ 改成不帶數字。
  RAISE NOTICE '[20260905070000] 事後斷言全數通過(①共用函式在 ②/②b 取消端已改呼叫 ③/③b 重算端已接且傳 false ④重算其餘沒被換掉 ⑤ACL ⑥owner 路徑 ⑦/⑦b 兩支 trigger 形狀)。';
END
$gate$;

COMMIT;

-- ══ rollback(檔頭那句「見檔尾」指的是這一段;codex R1 must-fix ⑧)══════════
-- 🔴🔴 **不能只 DROP 新 helper** —— 本片用 `CREATE OR REPLACE` 蓋掉了【兩支既有函式】,
--   DROP helper 之後那兩支會呼叫一支不存在的函式 ⇒ **每一筆收款與每一次取消都炸。**
-- ✅ 正確順序(三步, 不可跳):
--   ① 先把那兩支既有函式還原成【它們各自上一版的全文】:
--        pcm_pending_refund_on_cancel()      上一版 = 20260902030000
--        pcm_noncard_settle_recompute(uuid)  上一版 = 20260904230000
--      🔴🔴 **不要用 `latest-definition-of.sh`**(codex R2 must-fix ⑧)——
--        ⛔ 本片貼上去之後, 它的 newest 會是【本支 20260905070000】⇒ 它會把你指回你要退的那一版。
--        📌 **一支答「repo 最新」的工具, 在你要退版的那一刻剛好答錯。**
--      ✅ **可執行的做法(貼本片【之前】先做, 那才來得及)**:
--        🔵 唯讀連線走 `~/pcm-mailbox/0905查證/run.sh` 那條路(R4 nit ②)——
--          🛑 **它只有唯讀授權** ⇒ 不得拿它 apply 任何東西;跑不動是【對的】不是壞掉;
--            絕不把連線字串印進對話。
--        用唯讀連線把線上那兩支的現況存下來 ——
--          SELECT pg_get_functiondef('public.pcm_pending_refund_on_cancel()'::regprocedure);
--          SELECT pg_get_functiondef('public.pcm_noncard_settle_recompute(uuid)'::regprocedure);
--        把兩段輸出各存成一個 .sql 檔。**那兩份就是真正的「上一版」。**
--      ⚠️ **貼完之後才想退版**:線上已經是新版了 ⇒ 上面那兩發撈到的是新的。
--        這時唯一的來源是 repo 檔:`20260902030000`(on_cancel)與 `20260904230000`(recompute)
--        ⇒ 用 awk 把那兩支的函式全文抽出來。
--        ⚠️ **而「改成 CREATE OR REPLACE」只適用 `pcm_noncard_settle_recompute`**(R4 nit ③)——
--          `pcm_pending_refund_on_cancel` 在 `20260902030000` 裡**本來就是** `CREATE OR REPLACE`。
--        🛑 而那**只在「線上跑的就是那兩支」時正確** —— 貼之前沒存快照, 這一點就無法證明。
--        ✅ **而它有一個【帳本級】的判法**(R4 consider ③;帳本級 = 比不上實查, 而比沒有好):
--          · `docs/reference/order-state-gates.md` 的代數表(它由 index 視圖重產, 反映 repo 現況)
--          · `supabase/APPLIED.tsv` 上那兩支的 sha256 列
--          🔴 **而 `APPLIED.tsv` 的【缺席】什麼都不代表**(⟦01-LEDGERFALSENEG⟧)——
--            它只在「有記」時提供證據, 不在「沒記」時提供反證。
--   ② 確認那兩支的 prosrc 都不再含 'pcm_pending_refund_open_for'(否則第③步會炸)。
--   ③ 才 DROP FUNCTION public.pcm_pending_refund_open_for(uuid, boolean);
-- 🔴🔴 **⛔ ~~本片不動任何 trigger 定義、不動任何表、不建索引 ⇒ 沒有 DDL 要回滾~~ 那句是假的**
--   (adversarial-reviewer R3 must-fix ③):本片有一發 `COMMENT ON COLUMN
--   public.order_pending_refunds.amount_at_cancel` —— **它是 DDL, 而且是覆寫。**
--   ⇒ 🛑 三步跑完之後, 那段 COMMENT 仍然指著一支已經被 DROP 的函式(open_for)。
--   ✅ **第 ④ 步(不可省)**:把 `20260901080000` 那段 `COMMENT ON COLUMN` 的**原文**貼回去
--      —— 它在該檔的 `COMMENT ON COLUMN public.order_pending_refunds.amount_at_cancel` 那一段,
--      逐字整段複製, 不要重打。
-- ⚠️ **而【資料】不回滾**:本片可能已經開出一些 order_pending_refunds 列。
--   那些列本來就該存在(那正是本片在補的洞)⇒ **不要把它們刪掉**;
--   要作廢請走既有的 `voided_at` 流程, 不要 DELETE。
