-- ══════════════════════════════════════════════════════════════════════════
-- OP4 · 歷史卡軌收款回填 —— 把「錢已收、帳本沒記」的舊單補進 `order_payments`
-- ══════════════════════════════════════════════════════════════════════════
-- 塊規格權威 = OP1 檔頭逐字「回填在 OP4」(`20260810100000…op1…sql:12`)。
-- 塊級 plan = `B-433-PLAN`(v1)→ **`B-434-PLAN`(v2,本檔照它實作)**。
-- 審查:關卡1 codex R1 = **16 must-fix + 3 nit**(全折,其中 1 條我駁回、見 §P14)+ 我自審 6 條。
-- 片型 = 高風險(鐵則 12③ 大量/不可逆寫入)。L 分級 = L1。
--
-- ── 🔴🔴 本片沒有回收路徑 —— 這是整份設計的主軸,不是附註 ──────────────────
--   ① `pcm_op2b_immutable_columns`:`amount` 等十二欄 UPDATE 一律拒(P2B34)
--   ② `pcm_op2b_no_delete`:DELETE 一律拒
--   ③ `admin_reverse_manual_payment` **明文拒卡軌**(`…opa12…sql:141-143`,P2B44)
--   catalog 實查全站 payment 相關函式共五支(confirm_order_payment / admin_record_manual_payment /
--   admin_reverse_manual_payment / admin_compute_order_settlement / get_payment_anomaly_alert_summary),
--   **沒有任何一支能沖掉卡軌的列**。
--   ⇒ 寫錯一列,唯一修法是再開一支 migration。⇒ 設計原則:**寧可少寫,不可寫錯。**
--      **十三條**前提全部 fail-closed(P1,P2,P4-P14;**P3 已刪** —— 它被 P4+P5 嚴格蘊含,見下):任一不成立 ⇒ 該單不寫,留在 OP6-a 的 needs_human。
--
-- ── 正式站事實(主視窗代跑兩輪唯讀盤點,2026-08-11;`scripts/op4-inventory.sql`)──
--   · 全站 12 張單:paid 6 / refunded 1 / unpaid 5
--   · 有 charged attempt 且帳本零列 = **5 張**;其中 `PCM-2026-0102` 是 `refunded`
--   · 有 rec 的 7 張單**全部**有 `payment_webhook_events` 列,且 `amount` 逐張 = `orders.total`
--   · `att.updated_at` 一律早於 `paid_at` **0.02–0.7 秒**
--   · `payment_method` × `payment_channel` = `tappay` × `tappay`,**7/7 單一值域**(P13 寫死的依據)
--   ⇒ 預期回填 **4 張**。實際列數由檔尾斷言對帳,不靠這行註解。
--
-- 🔴 **`PCM-2026-0102` 為什麼被具名排除**(寫在這裡,免得下一個人以為是漏了):
--    它是 `refunded`,P1 只收 `paid` ⇒ 從一開始就不在候選集。三個理由:
--      ① OP6-a 的可判定集是 `('unpaid','paid','partiallyPaid')` ⇒ `refunded` 不論帳本長怎樣都回
--         needs_human ⇒ 補收款腿**零收益**。
--      ② 它的退款事實不在 `order_refunds`(盤點實查 refund_n=0)⇒ 回填後帳本會是
--         「只有收、沒有退」的**半真列**,而卡軌沒有沖銷路 ⇒ 那列永久改不掉。
--      ③ 用「反正 OP6-a 不看」當理由去寫一列改不掉的錯帳,方向是反的。
--    (主視窗提過三選一;B 窗裁定「排除」,判為技術題、未上呈 Sean。)
--
-- ── 誠實邊界:`amount` **沒有結構性證明**,P10 是佐證不是驗證 ──────────────
--   `payment_charge_attempts` **沒有 amount 欄**(catalog 實查 25 欄,無金額欄)
--   ⇒ 「當時到底刷了多少」正式站**沒有權威紀錄**:`payment_webhook_events` 表 COMMENT 逐字
--   「notify 不可信(無簽章)、reported_status 僅稽核、**成交權威走 settleCharge 內 Record API 反查**」,
--   而 Record 反查的結果**不落 DB**。
--   ⇒ P10 能做到的最強是「兩個**不同來源**(我方 confirm 寫的 `orders.total` × TapPay 側 notify 的
--      `webhook.amount`)指向同一個數字」。**這是弱佐證、不是已驗證。**
--   ⇒ 檔尾斷言③(回問 OP6-a)驗得到 `rec_trade_id` 寫錯,**驗不到 amount 寫錯** —— 見該處。
--   ⚠️ 不要把這段讀成「金額已經確認過」。它沒有。
--
-- ── 假設清單(= 重估觸發清單)──────────────────────────────────────────────
--   B1 卡軌 `charged` = 錢真的動了(`…4a2_attempt_sweeper_rpc.sql:18-19` 逐字描述
--      「markCharged 成功但 confirm throw → attempt=charged/order unpaid」的異常態
--      ⇒ charged+paid 是正常完成態)。
--   B2 `orders.total` 至今仍等於當時刷款額(僅由 P10/P11 兩面佐證,非證明)。
--   B3 `payment_method` 值域為單值 `tappay`(量自正式庫 2026-08-11;**新增管道就要重估 P13**)。
--   B4 本片不改 `orders.payment_status`(那是 OP6-b)。
--   任一動搖 ⇒ 停下回報,不自行擴張解釋。
-- ══════════════════════════════════════════════════════════════════════════

-- 🔴 整片一交易(OP1 R2 #6 先例):repo 的 apply 路徑逐 statement 自動提交
--    ⇒ 檔尾斷言紅掉時,錢帳已經寫進去了。錢帳的片要嘛全上、要嘛全不上。
-- 🔴🔴 apply 前置:`transaction_timeout` 是 **PG17 才有**。正式站版本本片沒查過
--    ⇒ apply 前跑一次 `SHOW server_version;`。<17 就把這一行拿掉再送
--    (本檔**沒有**用到 `MAINTAIN` privilege,所以不像 OP1 有第二處要一起改)。
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL transaction_timeout = '90s';

-- ── 1. seed:回填的系統身分 ────────────────────────────────────────────────
-- 主視窗裁 Q2=A:**另立** `op4_backfill`,不沿用 OP3 的 `payment_confirmer`。
-- 理由 = 字面 vs 事實:回填不是「當時的收款行為」,借用付款確認的身分會讓稽核時
-- 「這筆是當時刷的、還是後來補的」永久分不出來。代價只有一列 seed。
-- 🔴 `is_active = false` 是功能性的:`listActiveStaff()` 逐字 filter 掉它 ⇒ 不出現在操作者下拉。
-- 🔴 裸 INSERT、不用 `ON CONFLICT DO NOTHING`(同 OP3 慣例):本檔 forward-only,
--    這一列若已存在代表有人先手動加過、值不見得對,**該當場紅**。
--    ⚠️ 所以「本片可以放心重跑」是**錯的** —— 見檔尾 §重跑語意。
INSERT INTO public.staff (id, label, is_manager, is_active)
VALUES ('op4_backfill', 'OP4 歷史回填(系統)', false, false);

-- ── 2. 凍結候選集 ─────────────────────────────────────────────────────────
-- 🔴🔴 **codex 關卡1 最重的一條(#15):寫入會改變前提 ⇒ 拿前提當驗收是有毒的。**
--    P2 是「該單帳本零列」。一張合格單寫入後 P2 立刻由真變假
--    ⇒ 若檔尾「重算前提」:①會得到命中數 0 卻實寫 N;③會把**正確的寫入**判成「違反 P2 仍被寫」。
--    ⇒ 候選集必須在 INSERT **之前**凍結,所有斷言只對凍結集發問。
--    這條是通用形狀,不只本片:**任何會改變自己前提的寫入片都要凍結。**
--
-- 🔴 併發(codex#18,我 v1 的鎖判斷是錯的):
--    v1 寫「FK 讓 orders 取得 SHARE ROW EXCLUSIVE」——**錯**,子表 INSERT 對 parent 列取的是
--    `FOR KEY SHARE`,而且那也不會序列化不同軌的 writer。
--    codex 的反例成立:我看到帳本零列、同時 OP5 寫一筆 bank_transfer、我再寫 card 列
--    ⇒ 兩筆唯一鍵不同、都能提交、帳本合計變兩倍。
--    ⇒ **先對候選 `orders` 列取 `FOR NO KEY UPDATE`,再判 P2。**
--      · 為什麼夠:兩支既有 writer(`op3:393`、`op5:208`)都取 `orders FOR UPDATE`,
--        而 `FOR NO KEY UPDATE` 與 `FOR UPDATE` **互斥** ⇒ 序列化得到。
--      · 為什麼不用 `FOR UPDATE`:它與 FK RI 的 `KEY SHARE` 衝突 = memory
--        `project_m4b-a2b1-guard-decisions` 記的 40P01 死結形狀。`FOR NO KEY UPDATE` 與 `KEY SHARE` 不衝突。
--      · `ORDER BY o.id` 固定取鎖順序;與兩支 writer 同向(先 orders 再 order_payments)⇒ 不互相死結。
--    ⚠️ 誠實邊界:鎖的範圍是 P1/P13/P6/P7-header 命中的那些單(**比最終候選寬** ——
--       判 P2 之前還不知道誰是最終候選)⇒ 這段期間那幾張單的結帳確認會被擋。
--       正式站 12 張單、離峰 apply ⇒ 可接受;`lock_timeout=5s` 讓「等不到就整片回滾」而不是無限等。
--       🔴 reviewer N3 更正我上一版的字面:我原本寫死「鎖的是超集」,但單關聯的 qual 有可能被
--          推進 `LockRows` 之下 ⇒ **實際鎖到的可能更窄**。方向無害(窄=擋更少人),
--          但「超集」是我沒量過就寫死的字面 ⇒ 改成不宣稱確切範圍。
-- 🔴🔴 **關卡2 codex C1(must-fix,而且我 v2 那句「P2 在鎖之後才判」是假的)**:
--    原本 `CREATE TEMP TABLE … AS WITH locked AS (… FOR NO KEY UPDATE) SELECT … WHERE NOT EXISTS(order_payments)`
--    是**單一 statement** ⇒ READ COMMITTED 下整句共用 statement 開始時的快照。
--    等鎖醒來後,PG 只對**被鎖關聯**做 EPQ 重評,`NOT EXISTS (order_payments …)` 這個子查詢
--    **仍用舊快照** ⇒ 我在等鎖期間 OP5/OP3 提交的收款列**我看不到** ⇒ 我再寫一列 = 帳本雙倍。
--    ⇒ **拆成兩個 statement**:先鎖、後判。第二句是新的 statement ⇒ 取新快照 ⇒ 看得到對方的提交。
--    ⚠️ 這條不是理論:對方拿得到鎖就代表他在我之前跑完,而「他跑完了」正是我必須看見的事實。
CREATE TEMP TABLE op4_locked ON COMMIT DROP AS
  SELECT o.id
    FROM public.orders o
   WHERE o.payment_status = 'paid'                    -- P1
     AND o.payment_method = 'tappay'                  -- P13
     AND o.paid_at IS NOT NULL                        -- P6
     AND o.paid_at <= pg_catalog.now()                -- P6
     AND o.total > 0                                  -- P6
     AND o.cancelled_at IS NULL                       -- P7
     AND o.cancelled_reason IS NULL                   -- P7
   ORDER BY o.id
   FOR NO KEY UPDATE;

-- ── 第二句:新快照下才判其餘前提(尤其 P2)────────────────────────────────
-- 🔴 為什麼鎖住 orders 就夠涵蓋子表(codex C2 的部分反駁,**我實查過鎖序合約才敢這樣寫**):
--    會新增取消/退款列的 writer **全部**以 `orders` 列鎖為第一觸表動作:
--      · A8a1 / A8a2 整單與部分取消:`FROM public.orders WHERE id = p_order_id FOR UPDATE`,
--        且有**碼錨**釘住它是「第一觸表」(§5.0 鎖序合約)
--      · A7c RW1a 退款寫入:先鎖 orders(FOR NO KEY UPDATE)再重讀退款列
--      · OP3 / OP5:同樣 `orders FOR UPDATE`
--    ⇒ 我持有該單的 `FOR NO KEY UPDATE` 期間,他們**進不來**。
--    ⚠️ 誠實邊界:`payment_refunds`(L5b 線)與 `payment_double_charge_anomalies`(3DS callback)
--       **我沒有逐支查過它們是否也遵守同一份鎖序合約** ⇒ 不宣稱它們被鎖涵蓋;
--       那兩面改由檔尾斷言②的**全量重驗**(新 statement、新快照)接住。
CREATE TEMP TABLE op4_candidates ON COMMIT DROP AS
WITH locked AS (
  SELECT o.id, o.total, o.subtotal, o.paid_at,
         o.tappay_rec_trade_id AS rec, o.customer_user_id
    FROM public.orders o
    JOIN op4_locked k ON k.id = o.id
   WHERE o.payment_status = 'paid'                    -- P1
     AND o.payment_method = 'tappay'                  -- P13(值域量自正式庫 2026-08-11,7/7 單值)
     AND o.paid_at IS NOT NULL                        -- P6
     AND o.paid_at <= pg_catalog.now()                -- P6(codex#7:未來 paid_at 會撞 OP2a 的 P2B31
                                                      --     ⇒ 整片回滾,連帶害死其他正確候選。
                                                      --     這裡先濾掉 = 讓它「不被回填」而不是「炸掉全片」)
     AND o.total > 0                                  -- P6
     AND o.cancelled_at IS NULL                       -- P7(codex#1:v1 只看兩張取消表、漏了 orders 自己這兩欄)
     AND o.cancelled_reason IS NULL                   -- P7
   -- 🔴 這裡**不再取鎖**:第一句已經持有這些列的 `FOR NO KEY UPDATE`,鎖隨交易結束才釋放。
   --    再寫一次 `FOR NO KEY UPDATE` 無害但會讓讀者以為「鎖是在這句拿的」——鎖在上一句,
   --    而本句的價值正是它是**另一個 statement**(新快照)。
)
SELECT l.id AS order_id, l.total, l.paid_at, l.rec
  FROM locked l
  -- P4:**存在** charged attempt。
  --   🔴 誠實標註(codex#14 + 自審):「至多一筆」由 `payment_charge_attempts_order_lock_idx`
  --      保證(拋棄式 PG17 實測:插第二筆 charged 被 unique 擋)⇒ **那一半恆真**。
  --      真正有判別力的只有「至少一筆」,所以這裡寫 JOIN 而不是 `count(*) = 1`。
  --      ⚠️ 該索引的真實 predicate 是**三值** `('pending','charged','released')`,不是原始 CREATE
  --         敘述的兩值 —— 我第一次讀 CREATE 差點寫錯(catalog 才是事實)。
  --      ⇒ **驗收不得宣稱 P4 有負測。**
  JOIN public.payment_charge_attempts a
    ON a.order_id = l.id
   AND a.status = 'charged'
   AND a.rec_trade_id = l.rec                         -- P5(兩邊各自 UNIQUE,但**沒有約束保證一致**)
   -- P9 🔴 我自審抓到、且它違反的是 Sean 拍板不是我的偏好:
   --   `…l5b0_reject_superseded_charge.sql:9-10` 逐字「被讓路的 attempt **永不准被認列成收款**、
   --   唯一出口=退款」,而 `superseded_at` 的欄位 COMMENT 逐字「這一欄是自動退款(L5b)的**授權依據**」。
   --   catalog 實查:**零條** constraint 擋 `charged` + `superseded_at` 共存 ⇒ 這種列構造得出來。
   --   P8 擋不到它:退款**還沒發起**時四本帳都是空的。
   AND a.superseded_at IS NULL
   AND a.customer_user_id = l.customer_user_id        -- P12(codex#9:反正規化欄可能與訂單客戶不一致)
   -- P14 🔴 **我駁回 codex#6 的修法,只採納它的顧慮**:
   --   它說 `received_at=paid_at` 沒證明是授權時點、`attempt.updated_at` 是另一個候選。
   --   現象成立,但那個替代值**更不可靠**:`updated_at` 是**通用 mtime**,settle sweeper
   --   每次退避重試都會 bump 它(`20260615120001`:`settle_attempt_count++` / `next_settle_at`)
   --   ⇒ 它是「最後被誰動過」,不是「授權成功於何時」;在有重試的單上會系統性偏晚,
   --      正好就是 codex 自己舉的失敗情境。
   --   ⇒ `received_at` 維持 `paid_at`(目的專一欄位、與 OP3 已上線的列同語意),
   --      而把它的顧慮變成**會紅的守門**:付款時點不得早於 attempt 最後異動。
   --      違反 = attempt 在付款後又被動過 = 有 sweeper 活動 = 正是該排除的形狀。
   --      正式站實測 7/7 滿足(早 0.02–0.7 秒)。
   AND l.paid_at >= a.updated_at
 WHERE
   -- P2:帳本零列。**在鎖之後才判**(見上方併發段)。
   NOT EXISTS (SELECT 1 FROM public.order_payments p WHERE p.order_id = l.id)
   -- P10:webhook 佐證。存在 + 金額相符。
   --   🔴 刻意**不看** `processed`:`amount` 在 `record_webhook_event` 落地當下就寫死,
   --      處理與否不改變那個值。(正式站 7/7 `processed=false`,已由主視窗立 backlog #392,本片不診斷。)
   --   🔴 金額不符 ⇒ `EXISTS` 為 false ⇒ 排除。fail-closed 方向正確。
   --      (`payment_webhook_events` 的 PK 就是 `rec_trade_id` ⇒ 每個 rec 至多一列,不必擔心多列干擾。)
   AND EXISTS (SELECT 1 FROM public.payment_webhook_events w
                WHERE w.rec_trade_id = l.rec AND w.amount = l.total)
   -- P7 續:兩張取消表
   AND NOT EXISTS (SELECT 1 FROM public.order_cancellations c       WHERE c.order_id  = l.id)
   AND NOT EXISTS (SELECT 1 FROM public.order_cancellation_items ci WHERE ci.order_id = l.id)
   -- P8 退款面四本。🔴 **比 OP6-a 嚴:任一列即排除,不做任何 status 除外。**
   --   OP6-a 的 `ref` CTE 除外 `order_refunds.status='failed'`,而它自己的註解就寫明那個除外
   --   **沒有結構撐腰**(不像另外三面有 DDL 保證外呼沒發生)。
   --   OP6-a 是**讀**、判錯只是多問一次人;OP4 是**寫**、判錯就是一列改不掉的錯帳。
   --   ⇒ 同一個判準在兩片取不同嚴格度,這裡取嚴(codex#2)。
   AND NOT EXISTS (SELECT 1 FROM public.order_refunds r             WHERE r.order_id = l.id)
   AND NOT EXISTS (SELECT 1 FROM public.payment_refunds pr
                     JOIN public.payment_charge_attempts a2 ON a2.id = pr.attempt_id
                    WHERE a2.order_id = l.id)
   AND NOT EXISTS (SELECT 1 FROM public.order_refund_jobs j         WHERE j.order_id = l.id)
   AND NOT EXISTS (SELECT 1 FROM public.payment_double_charge_anomalies dc
                    WHERE dc.old_order_id = l.id)
   -- P11(codex#5):品項快照是**獨立於 `orders.total` 的第二個金額來源**,v1 漏看了。
   --   `total = subtotal + shipping_fee - discount_total` 是既有 DDL CHECK(恆真、零判別力),
   --   但 `Σ line_total = subtotal` **跨表、沒有 DDL 在守** ⇒ 那才是會漂的地方。
   --   兩個來源打架 ⇒ 不可自動認定現在的 total 就是刷款額 ⇒ 留給人。
   AND (SELECT pg_catalog.count(*) FROM public.order_items oi WHERE oi.order_id = l.id) > 0
   AND (SELECT coalesce(pg_catalog.sum(oi.line_total), 0)
          FROM public.order_items oi WHERE oi.order_id = l.id) = l.subtotal;

-- ── 3. 回填 ───────────────────────────────────────────────────────────────
-- 欄位形狀對齊 OP3 常態 writer(`op3:503-504`):同六欄、同順序。
-- 差別只有三個,且都是「歷史 vs 當下」的必然差異:
--   · `received_at`:OP3 用 `pg_catalog.now()`(當下確認);本片用 `paid_at`(當時付款)。
--     🔴 OP2a 的未來時點閘**不擋過去的值**,那是設計:`…op2a_received_at_guard.sql:35` 逐字
--        「OP4 歷史回填寫的是**過去**的值 ⇒ 本閘不擋它,這是正確的、不是漏洞」。
--   · `amount`:OP3 用 `v_order.total`(當下);本片同樣用 `total`,但額外過了 P10/P11 兩面佐證。
--   · `actor`:OP3 用 `session_user`(= `payment_confirmer`);本片用具名的 `op4_backfill`。
INSERT INTO public.order_payments (order_id, rail, amount, received_at, rec_trade_id, actor)
SELECT c.order_id, 'card', c.total, c.paid_at, c.rec, 'op4_backfill'
  FROM op4_candidates c;

-- ── 4. 檔尾 fail-closed 斷言 ──────────────────────────────────────────────
-- 🔴 全部只對**凍結集** `op4_candidates` 發問(見 §2 的 codex#15)。
DO $op4_asserts$
DECLARE
  v_frozen   bigint;
  v_written  bigint;
  v_bad      text;
  v_reasons  jsonb;
  v_oid      uuid;
BEGIN
  SELECT pg_catalog.count(*) INTO v_frozen FROM op4_candidates;

  -- ① 存活性:實寫列數 = 凍結候選數。
  --    主 INSERT 被掏空 ⇒ `0 <> N` 當場紅(N>0 時具存活性)。
  --    ⚠️ 誠實邊界(codex#16):**N=0 時本條恆真**,連同②③④一起變空集恆真。
  --       那個盲區由 harness 的「N=0 路徑」格覆蓋,不由本檔覆蓋。
  SELECT pg_catalog.count(*) INTO v_written
    FROM public.order_payments p
   WHERE p.actor = 'op4_backfill';
  IF v_written <> v_frozen THEN
    RAISE EXCEPTION 'OP4:凍結候選 % 張,實寫 % 列 ⇒ 主 INSERT 沒做完或多做',
                    v_frozen, v_written
      USING ERRCODE = 'P2B50', CONSTRAINT = 'pcm_op4_written_count_mismatch';
  END IF;

  -- ② **全量重驗**(關卡2 codex C4:我原本叫它「獨立重數」——那個名字**超出事實**)。
  --    原版從已寫入列反推,漏掉 P2 / P6 時間與正值 / P7 兩張子表 / P8 全部 / P11 / P12 / P14
  --    ⇒ 大多數守門失效它都接不住。codex 對,改寫。
  -- 🔴 它到底獨立在哪、不獨立在哪(**不要再把它講大**):
  --    · **獨立**於「主查詢的文字」:突變只改得到一處 ⇒ 另一處會發現不一致。
  --    · **獨立**於「時間與快照」:這是**另一個 statement** ⇒ READ COMMITTED 下取新快照
  --      ⇒ 凍結之後才提交的 `payment_refunds` / 雙扣異常列(檔頭誠實邊界說沒被鎖涵蓋的那兩面)
  --        會在這裡現形。
  --    · **不獨立**於「前提本身對不對」:同一組判準寫兩次 ⇒ 判準錯,兩邊一起錯。
  --      這條斷言**證不了前提是對的**,只證得了「實作與前提一致、且期間沒有人動過」。
  -- 🔴 P2 在這裡必須排除**我自己剛寫的列**,否則正確路徑上必然自我失效(關卡1 codex#15 同形狀)。
  CREATE TEMP TABLE op4_recheck ON COMMIT DROP AS
  SELECT o.id AS order_id
    FROM public.orders o
    JOIN public.payment_charge_attempts a
      ON a.order_id = o.id
     AND a.status = 'charged'
     AND a.rec_trade_id = o.tappay_rec_trade_id
     AND a.superseded_at IS NULL
     AND a.customer_user_id = o.customer_user_id
     AND o.paid_at >= a.updated_at
   WHERE o.payment_status = 'paid'
     AND o.payment_method = 'tappay'
     AND o.paid_at IS NOT NULL
     AND o.paid_at <= pg_catalog.now()
     AND o.total > 0
     AND o.cancelled_at IS NULL
     AND o.cancelled_reason IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.order_payments p
                      WHERE p.order_id = o.id AND p.actor <> 'op4_backfill')
     AND EXISTS (SELECT 1 FROM public.payment_webhook_events w
                  WHERE w.rec_trade_id = o.tappay_rec_trade_id AND w.amount = o.total)
     AND NOT EXISTS (SELECT 1 FROM public.order_cancellations c       WHERE c.order_id  = o.id)
     AND NOT EXISTS (SELECT 1 FROM public.order_cancellation_items ci WHERE ci.order_id = o.id)
     AND NOT EXISTS (SELECT 1 FROM public.order_refunds r             WHERE r.order_id = o.id)
     AND NOT EXISTS (SELECT 1 FROM public.payment_refunds pr
                       JOIN public.payment_charge_attempts a2 ON a2.id = pr.attempt_id
                      WHERE a2.order_id = o.id)
     AND NOT EXISTS (SELECT 1 FROM public.order_refund_jobs j         WHERE j.order_id = o.id)
     AND NOT EXISTS (SELECT 1 FROM public.payment_double_charge_anomalies dc
                      WHERE dc.old_order_id = o.id)
     AND (SELECT pg_catalog.count(*) FROM public.order_items oi WHERE oi.order_id = o.id) > 0
     AND (SELECT coalesce(pg_catalog.sum(oi.line_total), 0)
            FROM public.order_items oi WHERE oi.order_id = o.id) = o.subtotal;

  -- 對稱差必須為空:凍結集與重驗集**互相**不得有對方沒有的單。
  SELECT pg_catalog.string_agg(x.order_id::text, ', ' ORDER BY x.order_id) INTO v_bad
    FROM ((SELECT order_id FROM op4_candidates EXCEPT SELECT order_id FROM op4_recheck)
          UNION ALL
          (SELECT order_id FROM op4_recheck    EXCEPT SELECT order_id FROM op4_candidates)) x;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'OP4:凍結集與全量重驗集不一致(差集:%)⇒ 期間有人動了前提所依賴的資料,或前提實作不一致',
                    v_bad
      USING ERRCODE = 'P2B50', CONSTRAINT = 'pcm_op4_recheck_set_mismatch';
  END IF;

  -- ③ 回頭問 OP6-a:每一張被回填的單,verdict 不得再含帳本缺口碼。
  --    🔴 **不是恆真**:若 `rec_trade_id` 寫錯,OP6-a 的 `att.uncovered_n` 仍為 1
  --       ⇒ 冒出 `G_LEDGER_WRITE_GAP` ⇒ 本條紅。判別力來源明確。
  --    ⚠️ **驗不到 `amount`** —— OP6-a 對金額只算不判(`amount` 沒有獨立驗證者,見檔頭誠實邊界)。
  --       不要把本條讀成「回填的金額被驗過了」。
  FOR v_oid IN SELECT c.order_id FROM op4_candidates c LOOP
    v_reasons := public.admin_compute_order_settlement(v_oid) -> 'reasons';
    -- 🔴 關卡2 codex C5:**NULL fail-open**。RPC 回 NULL、回 `{}`、或少了 `reasons` 鍵時,
    --    兩個 `@>` 都是 NULL,而 PL/pgSQL 的 `IF NULL THEN` **不進分支、也不報錯**
    --    ⇒ 帳本缺口沒補上卻一路綠。⇒ 先把「拿到的東西是不是一個陣列」變成硬前提。
    IF v_reasons IS NULL OR pg_catalog.jsonb_typeof(v_reasons) <> 'array' THEN
      RAISE EXCEPTION 'OP4:單 % 的 OP6-a 回傳沒有可用的 reasons 陣列(拿到 %)⇒ 無法驗證缺口是否補上,拒絕提交',
                      v_oid, coalesce(v_reasons::text, '(NULL)')
        USING ERRCODE = 'P2B50', CONSTRAINT = 'pcm_op4_settlement_reasons_unusable';
    END IF;
    IF v_reasons @> '["G_LEDGER_NOT_BACKFILLED"]'::jsonb
       OR v_reasons @> '["G_LEDGER_WRITE_GAP"]'::jsonb THEN
      RAISE EXCEPTION 'OP4:單 % 回填後 OP6-a 仍回帳本缺口碼(reasons=%)⇒ 這一列沒有真的補上',
                      v_oid, v_reasons
        USING ERRCODE = 'P2B50', CONSTRAINT = 'pcm_op4_ledger_gap_persists';
    END IF;
  END LOOP;

  -- ④ 逐欄形狀:不只數列數。任一欄寫錯都要在這裡紅。
  SELECT pg_catalog.string_agg(p.id::text, ', ' ORDER BY p.id) INTO v_bad
    FROM public.order_payments p
    JOIN op4_candidates c ON c.order_id = p.order_id
   WHERE p.actor = 'op4_backfill'
     AND (p.rail                <> 'card'
       OR p.reverses_payment_id IS NOT NULL
       OR p.amount              <> c.total
       OR p.received_at         <> c.paid_at
       OR p.rec_trade_id        IS DISTINCT FROM c.rec
       OR p.bank_reference      IS NOT NULL
       OR p.request_id          IS NOT NULL
       OR p.reversal_reason     IS NOT NULL
       OR p.reviewed_by         IS NOT NULL
       OR p.reviewed_at         IS NOT NULL);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'OP4:這些回填列的欄位形狀不對:% ⇒ 拒絕提交', v_bad
      USING ERRCODE = 'P2B50', CONSTRAINT = 'pcm_op4_row_shape_wrong';
  END IF;

  -- ④b 沒有寫到凍結集以外的單(擋「WHERE 被掏空、全表回填」)。
  -- 🔴 reviewer N1:原本標「⑤」與 plan §7 的「⑤=全表 md5(已移 harness)」**撞號**,
  --    同一個代號指兩件事。本條改標 ④b,plan 的 ⑤ 維持指 harness 那條。
  SELECT pg_catalog.string_agg(p.order_id::text, ', ' ORDER BY p.order_id) INTO v_bad
    FROM public.order_payments p
   WHERE p.actor = 'op4_backfill'
     AND NOT EXISTS (SELECT 1 FROM op4_candidates c WHERE c.order_id = p.order_id);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'OP4:這些單不在凍結候選集裡卻被回填:% ⇒ 前提沒生效', v_bad
      USING ERRCODE = 'P2B50', CONSTRAINT = 'pcm_op4_wrote_outside_frozen_set';
  END IF;

  RAISE NOTICE 'OP4 回填完成:凍結候選 % 張、實寫 % 列、檔內斷言 ①②③④④b 全過(actor=op4_backfill)。'
               '⚠️ amount 只有 webhook/品項兩面佐證,不是結構性驗證。', v_frozen, v_written;
END
$op4_asserts$;

-- ── 5. 重跑語意(誠實版;v1 寫「天然 no-op」是錯的)──────────────────────
-- **回填列**確實不會重複寫:P2 要求帳本零列,回填過的單第二次就不在候選集。
-- **但整支 migration 不是可重跑的**:上方 `INSERT INTO public.staff` 是裸 INSERT,
-- 二次 apply 會撞 PK 當場紅。那是 forward-only 的**刻意設計**(同 OP3),不是缺陷。
-- ⇒ 不要在 apply 失敗後「再跑一次看看」;失敗就是整片回滾,查清楚原因再送。
COMMENT ON COLUMN public.order_payments.actor IS
  '登錄者 staff id。`op4_backfill` = OP4 歷史回填寫的列(2026-08-11 一次性,非當時的收款行為);'
  '`payment_confirmer` = OP3 卡軌自動落帳;其餘為真人。'
  '🔴 回填列的 amount 只有 webhook 與品項快照兩面**佐證**,無結構性驗證 —— 見 20260811050000 檔頭。';

COMMIT;
