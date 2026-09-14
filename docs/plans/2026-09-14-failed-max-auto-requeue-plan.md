# plan · 付款信燒完重試之後自動再排一次(⟦mail-FAILEDMAXNORESCAN⟧ launch-todo:1684)

> 2026-09-14 B 窗(`pcm-ops`)寫;主視窗派;鐵則 8(schema + cron)⇒ 等 Sean 批才動碼。只寫 plan, 零碼。
> 讀數(今天唯讀正式庫):`email_outbox` 10 列全 `sent`、`failed` 0、燒完 0 ⇒ 這個病**還沒發生過**, 修它是為了第一次。

## 1. 現在的鍵長什麼樣
- 唯一鍵:`UNIQUE (event_type, dedup_key)` —— `supabase/migrations/20260717020000_m4a_email_outbox.sql:377`。
- 鍵怎麼算:`packages/adapters/src/email/SupabaseEmailOutboxAdapter.ts:324` `composeEvent()` 一支決定七種信:
  `order_created` = orderId(`:400`)· `bank_order_created` = orderId + sha256(total, balanceDue, email)[0:16](`:384`, 算式在 `order-email-assembly.ts:280-293`)· `order_shipped` = shipmentId:orderId(`:414`)· `tracking_corrected` = 加 correctedKey(`:442`)· `order_cancelled` / `unpaid_cancelled` = orderId(`:458` / `:496`)· `partial_refund` = refundId(`:481`)。
- 撞鍵怎麼處理:`enqueue()` 撞 23505 ⇒ `resolveUniqueViolation()`(`:731`)回查同 (event_type, dedup_key) 的列 ⇒ 同單就回 `{kind:'duplicate'}`,**舊列一個欄位都不動**。

## 2. 為什麼燒完之後同單再也寄不出
1. sweeper 每輪撈 5 張 `pcm_*_email_pending` view;view 的 anti-join **只看「那一列存不存在」不看 status**(`20260822010000:271-276`,同檔 `:260-269` 自己警告過)⇒ `failed` + `attempts >= max_attempts`(5)的列仍然存在 ⇒ 那張單**不會再出現在掃描面**。
2. 就算 view 放行它(`20260907060000:8-12` 明文拒絕做的事):下一輪 `enqueue()` 撞同一把鍵 ⇒ `duplicate` ⇒ 舊列不重啟 ⇒ **每輪重撈、永遠插不進去、佔掃描名額**。這就是 09-06(45f)剛關掉的病。
3. 今天唯一的出口 = 人按後台「重排」⇒ `admin_requeue_dead_email(uuid)`(`20260831040000:70`):**原地** UPDATE 同一列 `status=pending, attempts=0, next_retry_at=now()`,鍵不變、不 INSERT。它只擋 `sent` 與「attempts 沒燒完」。
⇒ 📌 「鍵」本身不是病:**原地重啟同一列**已經是既有、被審過的路;缺的只是「沒有人自動按」。

## 3. 改成什麼(兩條路,推薦乙)
**甲 · 改鍵語意(板列 09-07 tidy 寫的那條)**:`resolveUniqueViolation` 撞鍵時若舊列是 failed@max ⇒ 原地重啟;同時五張 view 放行 failed@max。
- 代價:動 enqueue 核心不變式(七種信 + 人工救援共用)、五張 view、`countNewEvents` 閘的分母跟著變、`enqueueManualNoRecipient` 也要對齊 ⇒ 6-8 檔 + 2 支 migration。而**成果與乙一樣**:同一列 pending attempts=0。**不推。**

**乙 · 不碰鍵,定時器代替人按重排(推薦)**:一支純 SQL `pcm_dead_email_auto_requeue()` + pg_cron 每 30 分。
- 選列:`status='failed' AND attempts >= max_attempts AND auto_requeued_at IS NULL AND updated_at < now() - interval '1 hour' AND event_type IN ('order_created','bank_order_created')`(先只做**付款信兩種** —— 客人等的是它;出貨 / 取消 / 退款信另有 admin 路,不擴)。
- 動作:逐列呼叫**既有** `admin_requeue_dead_email(id)` 的同一段 UPDATE(抽成內部 helper 兩支共用,或直接呼叫該 RPC —— 以 codex 審為準),外加 `auto_requeued_at = now()`。
- 🔴 硬上限:**一列一生只自動重排一次**(`auto_requeued_at` 非空就不再選)⇒ 最壞 5+5 = 10 次嘗試,不會無限迴圈;第二次燒完 = 真死信,回到人工路 + 日報那一行數字。
- 為什麼 1 小時:sweeper 5 次退避(`packages/use-cases/src/email-backoff.ts`)已跨過短暫故障;1 小時後多半是 Resend 掛 / 模板壞,再試一次成本 = 一封信。
- 與 45f / 0907 不衝突:**不放行 `failed` 進 view、不動鍵**;重啟後那列是 pending attempts=0 ⇒ 它自己回到 sweeper 正常路。
- 與 signal2(死信數)互動:重啟期間那列不算死信 ⇒ 數字會降一、燒完再升;`emailDeadLetterCount` 那行字**不用改**。

## 4. 影響哪些信種
- 乙:只 `order_created` / `bank_order_created`。其餘五種**不動**(出貨 / 更正單號有作廢與 superseded 語意,自動重排會寄一封已作廢箱子的信;取消 / 部分退款讓人按)。
- 副作用要明講:provider 逾時但其實已寄出 ⇒ 重排 = 客人收兩封。與今天 attempts 2-5 的風險同族,不是新病;付款信收兩封不傷錢。

## 5. schema / migration / rollback
- 加欄 `email_outbox.auto_requeued_at timestamptz NULL`(不改 CHECK、不改唯一鍵、不改 view)。
- 新函式 `pcm_dead_email_auto_requeue()` SECURITY DEFINER `SET search_path=''`、零 GRANT(只給 pg_cron 以 postgres 跑;同 `pcm_settle_retry_sweep` 形狀 `20260905220000:230`)。
- pg_cron:`SELECT cron.schedule('pcm-dead-email-auto-requeue', '*/30 * * * *', …)`;`packages/domain/src/ops/cron-jobs.ts:94` 白名單加一列(staleMinutes 90)—— cron-allowlist-drift-gate 兩邊要同時改。
- 心跳:同 settle-retry 的物理限制(純 SQL,同交易失敗心跳會回捲),照它的寫法。
- rollback:`cron.unschedule` + DROP FUNCTION + DROP COLUMN(欄位只被本函式讀,drop 安全);已重排的列**留著**(那是發生過的事)。

## 6. 分片(每片 ≤45 分、各一 commit、不推)
1. migration + rollback + 拋棄式 PG 套 / 重貼擋 / 回滾 / 再套;造一列 failed@max 假信 ⇒ 跑函式 ⇒ 變 pending attempts=0 + auto_requeued_at 非空;再燒完 ⇒ 第二次不選。codex 兩輪(碰寄信 = 鐵則 12)。
2. `cron-jobs.ts` 白名單 + 測試;三綠。
3. 貼板由主視窗等 Sean 點名;貼完看一次 `cron.job` 有那一列。
- 板列 `⟦mail-DEADMAILREQUEUE⟧` / `⟦mail-SKIPKEYNORETIRE⟧`(鍵退休算式)**不在本 plan 射程**,互指不合併。

## 7. 要 Sean 答的
```
Q1: 付款信燒完 5 次之後, 系統 1 小時後自己再試一輪(最多再 5 次)?
A: 甲 要(推薦;客人等的是這封)| 乙 不要, 維持人按「重排」
Q2: 只做付款信兩種, 出貨 / 取消 / 退款信仍由人按?
A: 甲 是(推薦)| 乙 七種都自動
```
