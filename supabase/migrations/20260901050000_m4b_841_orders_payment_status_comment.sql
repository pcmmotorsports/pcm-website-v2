-- 20260901050000_m4b_841_orders_payment_status_comment.sql
--
-- 目的:把 `orders.payment_status` 的語意寫死在欄位上。
--
-- 🔴 來源是一句交辦,而它已經開著很久:
--    `docs/phase-1-backlog.md:29063` 逐字「**改述詞之前,先在那一欄的 COMMENT 上把語意寫死**」
--    (同檔 `:29082` 再記一次「而下面那句交辦【還沒有人做】」)
--
-- 🔴 而為什麼是今天寫:`#841`(登錄匯款後單子從畫面消失)的根因,
--    就是有人把這一欄讀成「錢收到了沒」,於是寫了
--      `query.or('payment_channel.neq.tappay,payment_status.neq.unpaid')`
--    ⇒ 人工匯款收了款而這一欄沒動 ⇒ **那張單被列表濾掉了**。
--    ⇒ 📌 也就是說:這道防護是在【它剛剛被證明有用】的那一天寫下去的。
--
-- ⚠️ **字面紀律(這一格是抄來的教訓,不要放寬)**:
--    `20260823030000_m4b_841_order_paid_total_view.sql` 檔頭逐字警告
--    「這一句話今天已經被證明寫太滿【三次】…把『我掃到的』講成『全部』
--      ⇒ 引用它之前先重掃一次」。
--    ⇒ 本次**已重掃**(2026-09-01,分母 `supabase/migrations/*.sql`):
--       · 提到 `payment_status` 的檔 **71 支**(工作樹);其中**同時含 `'paid'` 字面**的 **31 支**
--         🔴 **初稿把後者寫成前者** —— codex 2026-09-01 抓到, 我複量確認:71 vs 31。
--         📌 兩個都是我親手量的數, 而我把【窄的那個】貼上了【寬的那個】的標籤。
--       · `admin_record_manual_payment` 最新一代 = `20260812150000_m4b_e10_423_payment_audit.sql:74`
--         (用 `scripts/latest-definition-of.sh` 查,不是用 grep 猜檔)
--         ⇒ 其函式體內非註解提到 `payment_status` **7 行,全部是 SELECT / IF 的讀取與守門,
--            零 `SET payment_status`** ⇒ 🟢 正對照:同一段提到 `order_payments` **3 行**(尺會動)
--    ⇒ 🛑 **所以本 COMMENT 不寫「只有 X 會寫它」** —— 那個正向全稱句正是被寫壞三次的那一種。
--
-- 🔴🔴 **而初稿【還是錯了一句】, 而它的來源正是那支 view 的檔頭**:
--    初稿逐字抄了它的「**現金退款登記會寫這一欄**」⇒ **那句是假的**(codex 2026-09-01 抓, 我複量確認)。
--    真相:寫這一欄的是**卡片**退款那條路(`admin_finalize_order_refund`
--    ⇒ `pcm_sync_order_refund_payment_status` ⇒ `20260823010000:167` 的 `UPDATE … SET payment_status`);
--    而**現金 / 人工退款寫 `order_manual_refunds`**, 那支同步函式**只讀 `order_refunds`**
--    ⇒ 用 dollar-quote 標籤精確切它的函式體(1,474 字元)實量:
--       `order_refunds` **1** 行 / `order_manual_refunds` **0** 行。
--    ⚠️ 我第一次用固定視窗切, 量到 `order_manual_refunds` **1** 行 ——
--       **那一行是隔壁函式的**(視窗overrun)⇒ 差點拿它去反駁 codex。
--    📌 **⇒ 教訓不是「要小心」**:那支 view 的檔頭**自己標了一句「這句被寫太滿三次, 引用前先重掃」**,
--       而我**只重掃了它標的那一句**, 把**它沒標的那一句照抄**。
--       ⇒ ⇒ **一份文件標出自己的某一句不可信, 會讓讀者把【其餘各句】讀成可信。**

COMMENT ON COLUMN public.orders.payment_status IS
$c$這一欄【不是】「錢收到了沒」的單一真相。要問錢, 去看 order_payments 帳本(或 v_order_paid_total 的 paid_total)。

🔴 承重的那一句(#841 就是這樣壞的):
   人工匯款收款【不會】把這一欄變成 'paid' —— 錢進 order_payments, 這一欄沒動。
   ⇒ 所以 payment_status <> 'unpaid' 不等於「這張單收到錢了」,
     而 payment_status = 'unpaid' 也不等於「沒收到錢」。
   ⇒ 實例:query.or('payment_channel.neq.tappay,payment_status.neq.unpaid')
     把已匯款的單整個濾掉(修在 0853bf2b)。

🛑 而【不要相信任何一份「誰會寫這一欄」的清單, 包括這一段】:
   2026-09-01 實量, 全 repo 有 11 支檔在 SET 這一欄 —— 卡片確認 / 退款同步 /
   取消守門 / 券 / 0 元結清 / 還有一支維護腳本直接 UPDATE。
   ⇒ 這個數字【會長】。而這段 COMMENT 寫的當下, 前兩輪對抗審查各找到一條
     它漏掉的路 —— 也就是說, 列舉這件事本身失敗了三次。
   ⇒ 要現值自己跑:grep -rn "SET payment_status" --include='*.sql' --include='*.ts'

📌 所以這一欄的正確用法是:當成【狀態機的狀態】, 不要當成【錢的事實】。
   要判斷錢, 一律回 order_payments / order_refunds 加總。$c$;

DO $$
BEGIN
  -- 斷言:COMMENT 真的落上去了(而不是語法過了但沒生效)
  -- 🔴 這裡驗【內容】不只驗【非 NULL】 —— codex R1 指出:
  --    只驗非 NULL 的話, 欄位上若已有【別人寫的舊 COMMENT】而本次沒落地, 它會假綠。
  -- 🛑 而 codex R2 指出它仍證不到「是這一版」:任何保留這句話的舊 COMMENT 都會過。
  --    ⇒ 不修, 而理由寫下來:要證「是這一版」得比整段 hash, 而那會讓任何一次
  --      文字微調都變成【要改兩個地方】⇒ 那種閘會被繞過。本斷言的射程 =
  --      「有一段【像這一版】的 COMMENT 在」, 不是「逐字是這一版」。
  IF coalesce(col_description('public.orders'::regclass,
       (SELECT attnum FROM pg_attribute
         WHERE attrelid='public.orders'::regclass AND attname='payment_status')),'')
     NOT LIKE '%不要當成【錢的事實】%' THEN
    RAISE EXCEPTION 'COMMENT 沒有落到 orders.payment_status 上(或落上去的不是這一版)';
  END IF;
  -- 🟢 正對照:這把尺在【該說有】的時候會說有(上面那格若通過, 代表非 NULL)
  -- 🔵 負對照:同一把尺問一個【確定沒有 COMMENT】的欄位, 應為 NULL
  IF col_description('public.orders'::regclass,
       (SELECT attnum FROM pg_attribute
         WHERE attrelid='public.orders'::regclass AND attname='id')) IS NOT NULL THEN
    RAISE WARNING 'orders.id 竟然有 COMMENT ⇒ 上面那道斷言的判別力要重估, 不是失敗但要看一眼';
  END IF;
END $$;
