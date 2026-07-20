# M-4a Email 片 E2a-2 plan(對帳補寄 + 寄送時 ineligible gate + 五訊號 dead-man check)

> ⛔ **已作廢，禁止施工。** 2026-07-18 通知線轉向修正版 D′ 後，本 E2a-2 路線不再是下一步；
> 現行真權威是 `docs/specs/2026-07-18-b0-order-notification-email-prd.md`，下一片是 B-3。

> 2026-07-18 夜過夜自驅視窗。真權威 plan = `docs/specs/2026-07-16-m4a-email-notify-plan.md` v3.3;本檔=E2a-2 的落地拆片與檔案級規格。
> 開工依據:STATUS「下一步」+ CURRENT「E2a-2 執行視窗」+ memory `project_m4a-email-e2a-decisions`(Q3/Q4/Q13)+ migration `20260717020000` §⑦§⑧§⑨§⑩ + `IEmailOutbox`/`sweepEmailOutbox` JSDoc。

## 0. 範疇與拆片(超鐵則 4 → 拆三子片)

E2a-2 實含**三個關注點**,橫跨兩條 cron 路徑,實估 >90 分/10+ 檔 → 依鐵則 4 拆(同 E2a→a/b/c、E1c→1/2 先例):

| 子片 | 關注點 | 動的 route | 風險 | 審查 |
|---|---|---|---|---|
| **E2a-2a** | **寄送時 ineligible gate**(改已審 `sweepEmailOutbox` 寄送迴圈) | email-sweep | 🔴 高(動已審寄送路徑) | 三審含 codex |
| **E2a-2b** | **對帳補寄**(掃 orders anti-join → enqueue) | email-sweep | 🔴 高(order 對帳) | 三審含 codex |
| **E2a-2c** | **五訊號 dead-man check**(掛 anomaly-alert 獨立管道) | anomaly-alert | 🔴 高(order 對帳 count) | 三審含 codex |

順序 a→b→c(a/b 同動 email-sweep 路徑、a 先立 order gate 只讀模式;c 獨立)。**卡住跳下一子片**。

## 1. graphify 連動面(硬前置;偵察 agent 2026-07-18 跑)

- graphify 對 email_outbox 覆蓋薄:`graphify explain "email_outbox"` 只連到 07-13 舊 handoff 決策節點(觸發點 A/B/C 討論),無 E1b/E2a 現況;`"orders paid_at…email_outbox"` 查無節點(未索引 email_outbox 表 / reconciliation 概念)。→ 結構性連動靠直讀 code/migration。
- **抓到的關鍵鏡像**:`checkAnomalyAlerts` use-case(`packages/use-cases/src/check-anomaly-alerts.ts`)= 五訊號(E2a-2c)要平行/掛入的既有 dead-man 管道;`IAnomalyAlertReader`/`IAlertNotifier` 依賴。
- **連動邊(直讀確認)**:
  - `sweepEmailOutbox`(`packages/use-cases/src/sweep-email-outbox.ts`)= E2a-2a 改的寄送迴圈(逐封 `sender.send` 前插 gate)。
  - email-sweep route/composition(`apps/storefront/src/app/api/cron/email-sweep/`、`lib/email/composition.ts`)= E2a-2a/b 接線點(`SweepEmailOutboxDeps` 加 order 依賴)。
  - anomaly-alert route/composition(`api/cron/anomaly-alert/route.ts`、`lib/payment/composition.ts:210-221`)= E2a-2c 掛入點;既有 reader 走 `payment_confirmer` SECDEF RPC(`get_payment_anomaly_alert_summary`,`20260701120000`),email 五訊號**改走 service_role client 只讀**(新關注點、邊界不同,不擠進 payment_confirmer)。
  - `markSkippedOrderIneligible`(`IEmailOutbox.ts:227-232`)= E2a-2a 的落點(既存、E2a-a 已實作 adapter,sweeper 尚未呼叫)。

## 2. 硬事實(寫 plan 依據、直讀確認)

- `orders.payment_status` enum `('unpaid','paid','partiallyPaid','refunded')`(`20260604120000:50`,orders 欄 `:99`);`orders.paid_at` timestamptz nullable、階段②寫(`:108`);`orders.cancelled_at` timestamptz、獨立於 payment_status(`20260712203000:56`)。
- 🔴 **service_role 對 orders 只保留 SELECT**(`20260611120000` §4:REVOKE INSERT/UPDATE/DELETE、保留 SELECT)→ 新 order gate/對帳/訊號4 adapter 走 service_role client **純只讀 orders**、零寫 orders = 天然符合最小權限。email_outbox 本表 service_role 有 INSERT/SELECT/UPDATE(E1a)。
- `email_outbox_order_idx (order_id, event_type)`(E1a,`20260717020000`)= 對帳 NOT EXISTS anti-join + 訊號4 靠此索引(Fable EXPLAIN 實測兩欄全吃)。
- adapter export 走 `@pcm/adapters/server`;`createSupabaseServiceClient` + 文件化窄 cast(email_outbox 不在 database.types.ts、orders 在 → order gate adapter 可能直接吃生成型別、無需 cast,待實作確認)。
- **Q3=A ineligible gate** = `payment_status='refunded' OR cancelled_at IS NOT NULL`;🔴 **今日命中率 0**(兩者皆有欄零程式寫入、退款人工在 TapPay 後台;待退款線第一段落地才生效)→ 轉入必寫 `last_error_code='order_ineligible'`;抑制路徑必附測試(自造資料)。
- **Q4=A 對帳固定下界走 env**,未設 → 對帳+訊號4 skip 並在 response **明說 skipped**(非靜默;真起算點=E3 上線日、寫死會寫錯)。
- **Q13=A E2a 不做告警**;五訊號全歸 E2a-2c 獨立管道、不可放進 sweeper 自我監看。

---

## 3. E2a-2a:寄送時 ineligible gate(本視窗先做)

### 目標
`sweepEmailOutbox` 逐封寄送**前**查該 order 現況,若 ineligible(refunded/cancelled)→ `markSkippedOrderIneligible`(不呼 Resend、不寄已退款/取消訂單的「付款成功」信),否則正常寄。gate 正確性是本片責任(`IEmailOutbox.ts:230`)。

### 檔案級規格
1. **新 port `IOrderEmailGate`**(`packages/ports/src/IOrderEmailGate.ts` + index export):
   - `checkEmailEligibility(orderId: string): Promise<OrderEmailEligibility>`,型別 `'eligible' | 'ineligible'`(單筆查詢;抽象在 port、SQL 述詞在 adapter)。
   - JSDoc:述詞 = `payload/寄送時 gate`;ineligible = `payment_status='refunded' OR cancelled_at IS NOT NULL`(Q3=A);查無 order → 視為 ineligible(fail-closed:訂單消失不寄)還是 eligible?→ **決策**:查無 order 應該不可能(outbox 列有 FK RESTRICT 到 orders),但防禦性 → ineligible + 稽核(見下)。
2. **新 adapter `SupabaseOrderEmailGateAdapter`**(`packages/adapters/src/email/SupabaseOrderEmailGateAdapter.ts` + server.ts export):
   - service_role client 只讀 `orders`(select `payment_status, cancelled_at` where `id=orderId`)。
   - orders 在 database.types.ts → 儘量吃生成型別、避免 cast(待實作確認欄位型別)。
   - `import 'server-only'`(鏡像 SupabaseEmailOutboxAdapter)。
3. **改 `sweepEmailOutbox`**(`packages/use-cases/src/sweep-email-outbox.ts`):
   - `SweepEmailOutboxDeps` 加 `orderGate: IOrderEmailGate`。
   - 逐封迴圈:`sender.send` 前 `await orderGate.checkEmailEligibility(job.orderId)`;`ineligible` → `outbox.markSkippedOrderIneligible(job.id, job.attempts)`(帶世代柵欄)+ `result.skipped++`、`continue`(不呼 sender、不計 sent/failed)。
   - `SweepEmailOutboxResult` 加 `skipped: number`(counts-only)。
   - gate throw → per-job catch 計 `errors`(fail-closed:gate 掛掉不猜、列留 sending 下輪回收;不可「gate 錯就照寄」= 可能寄已退款信)。
4. **composition**(`lib/email/composition.ts`):`getSweepEmailOutboxDeps` 注入 `orderGate = new SupabaseOrderEmailGateAdapter(createSupabaseServiceClient()...)`。
5. **route**(`email-sweep/route.ts`):`pickCounts` allowlist 加 `skipped` 欄(顯式挑、不 blind spread)。
6. **測試**:`sweep-email-outbox.test.ts` 加 gate 分支(eligible→寄、ineligible→markSkippedOrderIneligible 不呼 sender、gate throw→errors 列留 sending);adapter 測試(refunded→ineligible / cancelled_at→ineligible / 正常→eligible);composition/route counts allowlist 含 skipped。

### 風險 / 邊界
- 🔴 動已審 `sweepEmailOutbox`(E2a-b 收工、審多輪)→ 改動最小化:只加 deps 一欄 + 迴圈內 gate 分支 + result 一欄。不動 lease/claim/退避/計數語意。
- 🔴 gate 查在**寄送前**(非認領前):認領後、寄送前 window 內 order 若轉 ineligible → 抑制(§4.1 寄送時 gate 語意)。
- 🔴 fail-closed:gate 錯→errors(不照寄);ineligible 判定唯一路徑=markSkippedOrderIneligible(不可翻轉終態)。
- PII:orderGate 只讀 payment_status/cancelled_at(非 PII)、result 只加 skipped count。

## 4. E2a-2b:對帳補寄(下一子片,方向)
- port 加 `findUnnotifiedPaidOrders(lowerBound, cap): Promise<ReconcileCandidate[]>`(掃 `orders WHERE payment_status='paid' AND paid_at >= lowerBound AND NOT EXISTS(email_outbox order_created)`;需 recipientEmail/displayId/paidAt → 確認 orders 是否 join customers 拿 email〔E3 enqueue 來源同源、待該片深挖〕)。
- 對帳 use-case `reconcileOrderEmails`(掃 → 逐筆 enqueue;固定下界 env `EMAIL_RECONCILE_LOWER_BOUND` 未設即 skip + response 明說)。
- 掛 email-sweep route:對帳補 enqueue **在** sweep 寄送前(§3.6:208 對帳跑在 sweeper 裡);response counts 加對帳欄。
- 🔴 首跑不回灌上線前舊單(固定下界=E3 上線日)。

## 5. E2a-2c:五訊號 dead-man check(方向)
- email health reader(service_role 只讀,查 5 訊號 count:①pending 堆積〔§⑨ 修正述詞:已到 next_retry_at 且逾寬限、排除 quota 兩碼〕②dead letter〔status IN pending,failed AND attempts>=max〕③stale sending〔claimed_at < now-lease〕④paid 但無列〔orders anti-join,固定下界+寬限〕⑤額度耗盡〔status=failed AND last_error_code IN quota 兩碼〕→ 走 LINE)。
- use-case:平行 `checkAnomalyAlerts`(共用 route + notifiers)或擴充;傾向平行 `checkEmailOutboxHealth`(reader 邊界不同、不擠進 payment_confirmer reader)。
- 掛 anomaly-alert route(獨立管道、不可自我監看);告警零 PII(只 outbox id/event_type/attempts/count)。
- 🔴 述詞照 migration §⑨(非 plan §3.6 舊表字面)。

## 6. 鐵則判定
- **鐵則 8**:跨 3+ 檔 + 動共用 use-case(sweepEmailOutbox)→ 觸發;但 E2a-2 內容已由過夜片單 + plan §8(S1/S3=A)授權 = 批准範圍內,不另等 Sean。deps 加 order reader = plan §4.1「寄送時 gate」的實作必然,非架構增項。
- **鐵則 12**:碰 order 對帳/寄送路徑 → 三審含 codex(片單明定高風險)。
- **鐵則 3**:機制片、無前台;告警訊息 = L1(運維、Sean 自看、年 0-1 次)、無 L3 內容。
- **鐵則 4**:拆三子片,各 35-45 分。

## 7. 驗收
- 三綠 typecheck+lint+build + 完整 pnpm test。
- E2a-2a:gate 分支測試(eligible/ineligible/throw)+ adapter 述詞測試(自造 refunded/cancelled 資料)+ counts allowlist 含 skipped。
- PII:client bundle grep 零 email_outbox/recipient_email/service_role;告警/log/response 零 PII。
- 🔴 無真流量(E3 未上線、refunded/cancelled 零寫入)→ 驗證靠單測 + client bundle grep;不宣稱肉眼驗。
