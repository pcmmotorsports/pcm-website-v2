# 計畫：付款通知轉人工時，後台與每日提醒要看得到

- 日期：2026-09-22
- 待辦板：⟦db-WEBHOOKMANUALBACKLOG⟧（`docs/launch-todo.md:2566`）
- 狀態：計畫，尚未寫程式、尚未建立 migration、尚未寫正式庫。需要 Sean 批准（鐵則 8：新增資料庫函式與權限）。
- 審查：見文末「審查紀錄」。

## 1. 問題（白話）

客人刷卡後，TapPay 會另外送一則「付款通知」到我們的伺服器。系統收到後會拿這則通知去 TapPay 查帳，確認有沒有真的扣款，再把訂單改成已付款。如果連續查 8 次都查不到結果，系統就停止自動處理，把這則通知標成「需人工處理」（`payment_webhook_events.needs_manual_review = true`）。

目前標成「需人工處理」之後，**後台首頁沒有顯示，每日 LINE 摘要與告警信也不會提到**。現有的付款異常提醒只統計刷卡扣款紀錄（`payment_charge_attempts`），不看這張付款通知表。

受影響的人與後果：

- **客人**：可能錢已經被扣，但訂單仍顯示未付款，也不會出貨。程式註解明白寫著，這種「查不到」不代表沒扣款（`packages/use-cases/src/settle-charge.ts:105-108`）。客人只能自己打電話來問。
- **員工與 Sean**：沒有任何畫面或訊息會告訴他們有這筆待處理，只有自己去查資料庫才會發現。

正式庫現況（2026-09-22 12:28 台北，`scripts/readonly-prod-sql.sh` 唯讀查詢，連線角色 `pcm_readonly`）：

| 項目 | 數字 |
|---|---|
| 付款通知總數 | 52 筆 |
| 需人工處理且未處理 | 3 筆（金額 101、6、340 元） |
| 其他未處理 | 0 筆 |
| 這 3 筆收到時間 | 2026-07-24 09:07、2026-08-10 18:07、2026-08-10 18:10（UTC） |
| 這 3 筆對得到訂單 | 0 筆（用 `orders.id::text = order_number` 比對） |
| 第一張訂單建立時間 | 2026-09-02 02:53（UTC），全表 16 張 |
| 2026-09-02 之後收到的付款通知 | 5 筆，全部已處理，全部對得到訂單 |
| 最近一筆付款通知 | 2026-09-21 08:31（UTC） |

所以這 3 筆是上線前的測試資料，沒有客人受影響。缺的是提醒機制：第一位真客人卡在這一步時，一樣不會有人知道。

另外查到一件會影響設計的事：資料庫裡跟這張表有關的函式只有 5 支（`claim_due_webhook_events`、`expire_webhook_events_at_ceiling`、`mark_webhook_processed`、`mark_webhook_retry`、`record_webhook_event`），**沒有任何一支能把「需人工處理」結案**。也就是說，就算加了提醒，員工處理完之後提醒也不會消失。第 4 節處理這件事。

## 2. 做法

在既有的「付款異常提醒」（每天台北時間早上 9 點執行的 `check-anomaly-alerts`，同時送 Email 與 LINE）多加一組數字：「付款通知需人工確認」。另外在後台首頁「等你處理」那一區加一行。

### 2.1 後台哪裡看得到

後台首頁（`apps/admin/src/app/page.tsx`）目前「扣款重試已放棄」「3DS 釋鎖後待人工」「寄不出去的信」三行的下方，新增一行：

- 有待處理時：`付款通知待人工確認：3 筆（最早一筆 2026-07-24 收到）`
- 沒有時：`付款通知待人工確認：0 筆`（照既有做法，零筆也要顯示，才分得出「沒有」和「沒在顯示」）
- 讀不到時：`付款通知待人工確認：無法載入（原因）`，不顯示成 0。

後台首頁不設門檻，有一筆就顯示。這一行也加進「等你處理」清單（`apps/admin/src/lib/dashboard/needs-you-cards.ts`），那份清單有測試會比對畫面文字。

### 2.2 每日告警信與 LINE 摘要

**要一起加。** 理由：LINE 摘要是否印「要處理」，跟告警信用同一個判斷（`owner-line-digest.ts` 檔頭：`alerted` = `shouldAlert` 是唯一判準）。新項目只要進了告警信的判斷，LINE 就必須能說出它屬於哪一類，不然會出現「有事要處理」卻說不出是什麼。

- **告警信（Email）**：新增一段，寫筆數、最早一筆的收到時間、對得到的訂單單號（最多 5 個，對不到的寫「查無訂單」），以及下一步：「這幾筆刷卡付款系統無法自動確認，客人可能已被扣款。請通知工程人員處理；不要自己到 TapPay 退款，也不要用後台『登記收款』（後台不支援人工登記刷卡收款）。」不寫金額（沿用告警契約：可以帶訂單單號，不帶金額，`packages/domain/src/payment/anomaly-alert.ts` 檔頭）。
  - 為什麼不能叫員工自己登記：後台人工收款只接受匯款與現金（`apps/admin/src/lib/orders/payment-action-state.ts:81` 的 `PAYMENT_RAILS`），資料庫函式也明文拒收刷卡（`20260810200000:162-166`）。改用現金或匯款登記會記錯收款方式。真的卡住時的處理流程見第 4 節 Q3。
- **LINE 摘要**：不另加一行，歸到既有的「錢」那一類（`owner-line-digest.ts:98-104`）。讀不到時歸到「讀不到的項目」那一行。
- **告警信主旨**：實際主旨由 `check-anomaly-alerts.ts:1684` 的 `hasPayment` 決定，所以新項目要加進 `hasPayment`，並在 `ALERT_SUBJECT_TAG_BY_TRIGGER` 登記為 `payment`（登記表只供測試核對，光登記不會改變主旨）。
- **門檻只判斷一次**：use-case 裡用一個函式算出「是否已超過門檻」（`webhookManualReviewOverdue`），`shouldAlert`、`hasPayment` 與傳給 LINE 摘要的值都用這一個結果。LINE 摘要拿到的是已套門檻的布林值，不是原始筆數，避免「別的事觸發告警時，未滿 48 小時的付款通知也被歸成『錢』」。

### 2.3 門檻

- 後台首頁：沒有門檻，有一筆就顯示。
- 告警信與 LINE：**最早一筆收到超過 48 小時才響**。參考 Sean 2026-09-20 對「人工退款告警」拍的門檻（甲，48 小時才響；出處 memory `project_0920-board-must-be-completed-not-just-annotated.md`）。那次的對象是退款，不是付款通知，所以這一條列在第 4 節題目 Q2 請 Sean 確認，不當成已經決定。
- 實際效果：告警每天早上 9 點跑一次，所以從卡住到 LINE 響，最長約 72 小時（48 小時門檻加上最多 24 小時等下一次執行）。後台首頁則是員工一登入就看得到。
- 計時起點用 `received_at`（收到通知的時間）。這張表沒有「轉人工的時間」欄位；系統通常在收到後約 1 小時重試完畢轉人工（退避 1、2、4、8、16、16、16 分鐘，`20260615120000_m3_3ds_4a1_webhook_sweeper_rpc.sql:143-154`），但重試排程停過時會晚很多（這 3 筆的最後重試時間是 08-17）。用收到時間只會讓提醒提早，不會延後，方向是安全的。
- 門檻數字放在告警 route 的常數（`apps/storefront/src/app/api/cron/anomaly-alert/route.ts`，與 `ALERT_REFUNDING_STUCK_SECONDS` 同一處），改門檻只需改程式，不需改資料庫。

### 2.4 什麼算「待人工確認」

```
needs_manual_review = true AND processed = false
```

現況 `processed = true AND needs_manual_review = true` 為 0 筆（見第 1 節查詢），所以把這個組合定義為「人工結案」：確認這一筆不需要再處理後（處理方式見 Q3），把它設成 `processed = true`，它就不再計入，同時保留 `needs_manual_review = true` 與 `last_error` 作為曾經轉人工的紀錄。

## 3. 要改的東西

### 3.1 資料庫（有 schema 變更：新增一支函式，不改表、不加欄位、不加 view）

新 migration：`supabase/migrations/<施工當天版本號>_m4b_webhook_manual_review_health.sql`（版本號要大於目前最後一支 `20260921010000`），同一顆 commit 加 `supabase/APPLIED.tsv` 一列。

新增函式 `public.get_webhook_manual_review_health()`：

- 無參數（以後改門檻不必改函式簽章；CLAUDE.md〈貼板與推的順序〉記過改簽章兩邊都會壞）。
- `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''`，回傳 `jsonb`：
  - `manual_count`：第 2.4 節條件的筆數
  - `oldest_received_at`：其中最早的 `received_at`
  - `sample_display_ids`：最多 5 筆，依 `received_at` 排序，`LEFT JOIN public.orders o ON o.id::text = e.order_number` 取 `o.display_id`；對不到訂單時為 `null`
  - `total_count`：全表筆數（分母，用來分辨「0 筆待處理」與「表是空的或讀錯」）
- 為什麼要用 SECURITY DEFINER 函式：告警器用 `payment_confirmer` 連線，而這張表對 `payment_confirmer` 完全沒有權限（`20260613120000_m3_3ds_0a_webhook_events.sql` 的表層 ACL 斷言要求 `payment_confirmer` 全零）。不改表權限，改用函式。

權限（照 `docs/patterns/revoking-function-execute-in-supabase.md` §1、§3.5，並照抄隔壁 `get_settle_retry_gaveup_health` 的寫法，`20260905250000:65-70` 與 `20260906970000:29`）：

```sql
REVOKE ALL ON FUNCTION public.get_webhook_manual_review_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_webhook_manual_review_health() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.get_webhook_manual_review_health() FROM service_role, payment_confirmer;
GRANT EXECUTE ON FUNCTION public.get_webhook_manual_review_health() TO payment_confirmer;  -- 告警器
GRANT EXECUTE ON FUNCTION public.get_webhook_manual_review_health() TO service_role;       -- 後台首頁
```

同支 migration 內加斷言區塊（`DO $$ … RAISE EXCEPTION`），用具名 regprocedure 檢查：

- `payment_confirmer`、`service_role` 的 `has_function_privilege(..., 'EXECUTE')` 為 true；
- `anon`、`authenticated`、`public` 為 false；
- 前置檢查：`public.payment_webhook_events` 與 `needs_manual_review` 欄位存在，函式名稱尚未存在（避免 `CREATE OR REPLACE` 靜靜蓋掉同名函式，見 pattern §3.2），所以用 `CREATE FUNCTION` 不用 `CREATE OR REPLACE`。

貼上之後的驗收（照 pattern §3.1「寫完 GRANT 不等於驗過」與 §3.5「兩道 REVOKE 不是已關上的證明」）：

- 在交易內 `SET LOCAL ROLE payment_confirmer;` 與 `SET LOCAL ROLE service_role;` 各實際呼叫一次，預期拿到 `manual_count = 3`（Q1 甲貼完後為 0）、`total_count` 約 52；`SET LOCAL ROLE anon;` 呼叫要得到 42501。
- 函式 owner 不是 `anon`、`authenticated`、`service_role`、`payment_confirmer`（查 `pg_proc.proowner`）。
- `anon`、`authenticated` 不能切換到持有 EXECUTE 的角色：`pg_has_role('anon', 'service_role', 'SET')`、`pg_has_role('anon', 'payment_confirmer', 'SET')` 及 `authenticated` 對應兩項皆為 false。貼完照 memory `project_0914-acl-approve-after-paste.md` 跑一次 `pcm_acl_approve_latest`，不然隔天的權限變動提醒會響。

後台首頁為什麼也呼叫同一支函式，而不是像「扣款重試已放棄」那樣直接查表：同一個條件寫兩份會各自走樣，而且沒有東西會提醒（`stuck-payment-read.ts` 的 `loadReleasedStuckCount` 註解記過這個代價）。`service_role` 本來就能 SELECT 這張表，多給它這支函式的 EXECUTE 不擴大它能看到的資料。

### 3.2 程式

| 檔案 | 改什麼 |
|---|---|
| `packages/domain/src/payment/anomaly-alert.ts` | `AnomalyAlertSummary` 加 `webhookManualReviewCount`、`webhookManualReviewOldest`、`webhookManualReviewSampleIds`、`webhookManualReviewTotal`（皆可為 `null`）與 `webhookManualReviewUnknown` |
| `packages/adapters/src/payment/PgAnomalyAlertReaderAdapter.ts` | 新增一發 `SELECT public.get_webhook_manual_review_health() AS result`（字面字串，不用樣板，`anomaly-alert-key-contract.test.ts` 靠正則抽函式名）；讀失敗或形狀不對時落 Unknown 並記 log，不讓整封告警失敗（同 `get_settle_retry_gaveup_health` 那段，`:666-683`）；`manual_count > total_count` 視為讀錯，落 Unknown |
| `packages/use-cases/src/check-anomaly-alerts.ts` | 摘要型別同步；新增一個判斷函式算 `webhookManualReviewOverdue`（有筆數且最早一筆超過門檻）；`shouldAlert` 與 `hasPayment` 都用它；告警信新增一段（第 2.2 節文字）；Unknown 不進 `shouldAlert`；`ALERT_SUBJECT_TAG_BY_TRIGGER` 登記 `payment`；回傳結果（`:3400` 附近那段）明確帶出 `webhookManualReviewUnknown` 等欄位，route 才讀得到；把已套門檻的布林值傳給 LINE 摘要 |
| `packages/use-cases/src/owner-line-digest.ts` | 輸入型別加 `webhookManualReviewOverdue` 與 `webhookManualReviewUnknown`；「錢」那一類加上前者；讀不到清單加「付款通知」 |
| `apps/storefront/src/app/api/cron/anomaly-alert/route.ts` | 新常數 `ALERT_WEBHOOK_MANUAL_AGE_SECONDS = 172800`（48 小時，依 Q2 答案調整）傳給 use-case；`webhookManualReviewUnknown` 為 true 時列進「這一輪讀不到」清單（`:987` 的 `unreadable`），**不回 503**，照 `partialRefundCancelUnknown`、`paidAfterCancelUnknown` 的成例：避免萬一程式比資料庫函式早上線時，整支排程天天失敗 |
| `packages/adapters/src/payment/anomaly-alert-key-contract.test.ts` | `TARGETS` 加新函式與四個 key 的檢查；Unknown／Failed 欄位數由 28 改為 29（數字以當場測試印出的值為準）。列為片 2 驗收項目 |
| `apps/admin/src/lib/dashboard/stuck-payment-read.ts` | 新增 `loadWebhookManualReviewCount()` 與顯示文字函式，照 `loadStuckPaymentCount` 的形狀（自帶 5 秒逾時、讀不到不顯示成 0） |
| `apps/admin/src/app/page.tsx` | 首頁加一行（第 2.1 節），放在 `released-stuck-count` 下方 |
| `apps/admin/src/lib/dashboard/needs-you-cards.ts` | 清單加一項 `{ testId: 'webhook-manual-review-count', 名稱: '付款通知待人工確認' }` |
| 測試 | 上面每支檔的既有測試檔各補案例：0 筆、有筆但未滿 48 小時（不響）、超過 48 小時（響，主旨為付款類）、讀不到（不顯示成 0、不進 `shouldAlert`、route 列進讀不到清單、其他告警照樣送出）、LINE 歸「錢」、混合情況（寄信異常觸發告警＋付款通知未滿 48 小時 ⇒ LINE 不列「錢」、主旨不變成付款類） |

鐵則 13 ③：每個新測試在寫實作前先跑一次，確認它會紅。

### 3.3 部署順序

新函式要先在正式庫建好，程式才合進 dev（CLAUDE.md〈貼板與推的順序〉：部署時序閘會擋新的 `.rpc(`）。告警器那一側用原生 SQL 呼叫，即使順序顛倒也只會落 Unknown，不會讓整封告警失敗；後台那一側用 `.rpc(`，會被部署時序閘擋下。

## 4. 需要 Sean 回答的題目

**Q1　那 3 筆測試資料（101、6、340 元，07-24 到 08-10，查不到訂單）怎麼處理？**
新提醒一上線，這 3 筆超過 48 小時，會讓 LINE 每天早上都顯示「有錢的事要處理」。

- 甲（推薦）：寫一支一次性資料 migration，把這 3 筆標成「人工結案」（`processed = true`、`processed_at = now()`）。更新條件鎖定這 3 筆的主鍵 `rec_trade_id`（施工時唯讀查出、寫進檔頭），並在同一個交易裡檢查：更新前這 3 筆都是「需人工、未處理、`processed_at` 為空」，實際更新筆數剛好 3，任一不符就中止。保留原本的轉人工紀錄。可退回（見第 5 節）。這 3 筆查不到訂單，沒有「有沒有扣款」要處理的後續。
- 乙：不動資料，提醒只計算 2026-09-02（第一張真訂單）以後收到的。正式庫不用寫入，但程式裡會永久多一個日期特例，這 3 筆也會一直留在「需人工」狀態。
- 丙：直接刪掉這 3 筆。不可退回，也不留紀錄，不建議。

**Q2　告警信與 LINE 的門檻用多久？**（後台首頁不設門檻，一筆就顯示）

- 甲（推薦）：48 小時，與 09-20 人工退款告警同一個標準，員工有兩天先從後台處理，不會一卡住就吵。
- 乙：有一筆就響（下一次早上 9 點就通知）。最快知道，但付款通知偶爾卡一下也會響。
- 丙：24 小時。介於兩者之間。

**Q3　之後真的有客人卡住，要怎麼處理和結案？**
目前系統沒有任何結案方式，後台也不能人工登記刷卡收款（第 2.2 節）。這份計畫只負責「讓人知道」，處理方式要另外決定：

- 甲（推薦）：先不做後台功能。提醒出現後由工程人員逐筆處理，並寫成 runbook（片 4）：
  - 到 TapPay 查不到扣款：把那一筆標成人工結案（同 Q1 甲的做法），訂單照一般未付款流程處理。
  - 到 TapPay 查得到扣款：讓系統重新自動確認一次（把那一筆改回可重試，排程會再向 TapPay 查帳並把訂單改成已付款）。這一步會改動付款狀態，待辦板已註明需要 Sean 同意，所以每次都要 Sean 當次授權。runbook 的這個步驟要先在拋棄式資料庫演練，演練前不能當作可用。
  - 上線到現在 5 筆真通知全部自動處理成功（第 1 節查詢），預期很少發生。
- 乙：另開計畫做後台「刷卡人工對帳」功能，讓員工自己處理。會碰到收款、權限與資料庫函式，要另外寫計畫與審查，估計半天以上。

## 5. 分片、時間與退回方式

| 片 | 內容 | 預估 | 需要 |
|---|---|---|---|
| 1 | 資料庫函式 migration（含權限、斷言、退回區塊）、拋棄式 PG 試跑、Codex 審 diff | 30 分鐘 | Sean 批准本計畫；貼板（Sean 或其授權） |
| 2 | 告警器：domain、adapter、use-case、LINE 摘要、route 與測試 | 45 分鐘 | 片 1 已貼上；Codex 審 diff（碰金流提醒） |
| 3 | 後台首頁一行、「等你處理」清單與測試；本機後台開畫面看 | 30 分鐘 | 片 1 已貼上 |
| 4 | 依 Q1：甲＝一次性資料 migration（15 分鐘）；乙＝併入片 1 的條件（0 分鐘）。Q3 選甲則寫 runbook 並在拋棄式資料庫演練「重新自動確認」那一步（30 分鐘） | 0–45 分鐘 | Q1、Q3 的答案；Q1 甲需要貼板 |

合計約 1 小時 45 分到 2 小時 30 分，不含等待貼板與審查的時間。片 2、片 3 可以同時做。三綠（typecheck、lint、build）每片都跑；合併後推送前跑一次 `pnpm test`（鐵則 11）。

做完的標準：Sean 開後台首頁看得到「付款通知待人工確認」那一行與正確筆數；若 Q1 選甲，那一行在結案後變成 0 筆。

退回方式：

- **程式**：revert 片 2、片 3 的 commit 即可，告警信回到現在的樣子。只 revert 程式、不刪函式也沒問題。
- **資料庫函式**：`DROP FUNCTION public.get_webhook_manual_review_health();`（寫在 migration 檔尾的退回區塊）。函式只讀不寫，刪除不影響任何資料。要先 revert 程式再刪函式；反過來的話，告警器會落 Unknown（不會失敗），後台那一行會顯示「無法載入」。
- **測試資料（Q1 甲）**：migration 檔頭記下 3 筆的 `rec_trade_id` 與原值（`processed = false`、`processed_at = NULL`）。退回區塊用同一組 3 個主鍵，先檢查這 3 筆目前是「`processed = true`、仍是需人工」，再改回原值，並斷言實際更新 3 筆（不沿用正向的 `processed = false` 條件，那樣退回會更新 0 筆）。這 3 筆的訂單不存在，也不會再被自動重試（`attempt_count` 已經是 8，排程只撈 `attempt_count < 8` 且未轉人工的列，`20260615120000` 檔頭 ④），正向與退回都不會觸發扣款或寄信。

## 6. 這份計畫不做的事

- 不查這 3 筆到底有沒有在 TapPay 扣款：需要 TapPay 金鑰，唯讀連線做不到。它們查不到訂單，而且早於第一張真訂單，影響判斷為沒有客人受影響。
- 不改付款通知的重試次數或流程。
- 不改表權限、不加欄位。

## 審查紀錄

審查工具：Codex（`codex exec -s read-only --disable apps -m gpt-6-astra`），實際執行兩輪，未改用 adversarial-reviewer。

**R1：FAIL（5 項必修、1 項建議），已全部修進本計畫。**

1. 原本叫員工「到訂單頁登記收款」，但後台不支援人工登記刷卡 ⇒ 改成通知工程人員，處理方式移到 Q3。
2. 讀不到時的 route 接線漏列 ⇒ 補上 use-case 回傳欄位與 route 的讀不到清單。
3. 漏列 `anomaly-alert-key-contract.test.ts`（`TARGETS` 與欄位數 28）⇒ 補進檔案表。
4. 主旨與 LINE 分類沒有共用已套門檻的判斷 ⇒ 改成一個判斷函式，三處共用。
5. 測試資料退回沿用正向條件會更新 0 筆 ⇒ 改成鎖主鍵、檢查更新後狀態再還原。
6. （建議）權限驗收補 owner 與角色切換 ⇒ 已補一部分。

**R2：FAIL（3 項必修、1 項建議）。依鐵則 12 不跑 R3，以下尚未修改，停下等 Sean 決定。**

1. Q3 甲「TapPay 查不到扣款就結案」不夠嚴謹：系統查詢回零筆不代表沒扣款（`settle-charge.ts:105-108`）。要改成「查不到或結果不明一律保留待人工，只有取得確認未扣款的證據才結案」，runbook 要寫明判定條件與留存證據。
2. Q3 甲「查得到扣款就改回可重試」缺適用條件：已被新單取代的扣款紀錄不能認列（`20260906700000:192-198`）；沒有進行中的扣款紀錄時會回 `no_attempt` 且照樣標成已處理（`sweep-settlements.ts:181-188`）；只清人工旗標不夠，還受次數與重試時間限制（`20260615120000:54-57, 77-80`）。要限定可重新確認的狀態、加並發保護，演練要驗付款與收款紀錄。
3. 讀不到的揭露只接在「沒有其他告警」那一支（`route.ts:980` 的 `if (!result.alerted)` 內），其他告警成立時告警信不會提到付款通知讀不到。要在告警信 builder 加讀不到的文字，並補「其他告警成立＋本項讀不到」測試。
4. （建議）權限驗收應枚舉所有持有 EXECUTE 的可切換角色，並檢查能否切換到函式 owner。

R2 的第 1、2 項都在 Q3 甲的處理流程，不影響「讓人知道」的片 1–3；第 3 項是片 2 多補一段文字與一個測試。
