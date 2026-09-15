# 2026-09-15 · 重試放棄章在單已處理後不會消失 —— plan(v1)

> A 窗寫。主視窗 pcm-website-v2-b7 派工;Sean 逐字「甲、甲」= 先寫計畫給他看。
> **本檔只是 plan,零碼、零 migration。** 會碰健康檢查函式定義(schema)+ 告警文案(錢的告警)⇒ 鐵則 8 + 12,等 Sean 拍 §8 的題、主視窗核過才開工。
> 來源:P1-6 文案片 adversarial-reviewer R2 的 nit(`9b9f846a5` commit body 末段)。

## 1. 白話

- 匯款 / 現金單收了錢而狀態沒翻,重試排程每 10 分鐘會再算一次;連續 5 次失敗就蓋一個「放棄章」。
- 告警信的【匯款單修不好】【現金單修不好】兩段,數的就是「身上有放棄章的單」。
- **問題**:員工後來把那張單處理好(補登收款、沖銷、取消、登記退款…),單就不在排程的重試範圍裡了 ⇒ **排程再也不會碰它 ⇒ 章永遠留著 ⇒ 那兩段每天都會叫同一張已經處理好的單。**
- 同一件事還有另一半:放棄那一刻寫的事故紀錄(`settle_retry_gave_up`)也永遠算「未處理」—— 而**所有種類的事故都一樣**,因為事故表的「已處理」欄位今天沒有任何寫入端(§8 Q2、Q3)。
- 正式庫今天那張表 **0 列**(§2 事實 #9)⇒ 目前沒有實害;這是「上線後第一次有單被放棄、又被人工處理掉」那天才會出現的噪音。

## 2. 查到的事實

| # | 事實 | 出處 |
|---|---|---|
| 1 | 排程候選 = 匯款 / 現金、未取消、(unpaid 且淨額 > 0)或(partiallyPaid 且淨額 >= total)、沒有未作廢人工退款;另加「沒章或章已滿 24 小時」 | `20260916060000_m4b_p16_settle_recompute_failure_visibility.sql:427-438` |
| 2 | 章只有兩個地方會被拿掉:① 重算成功(`gave_up_at = NULL`)② 滿 24 小時後重開、第一次失敗從 1 起算(`gave_up_at` 回 NULL)—— **兩者都要單先被候選查詢撈到** | 同檔 `:436`、`:454` 起的成功 / 失敗 upsert |
| 3 | 候選但 OP6a 判 overpaid / needs_human 的單:迴圈跳過、**不寫 attempts** ⇒ 章也不會被拿掉 | 同檔 `:454`(只處理 settled / underpaid)、`:417` ponytail 註解 |
| 4 | 放棄健康檢查只看 `gave_up_at IS NOT NULL`(JOIN orders 分匯款 / 現金),**不看單現在還在不在候選** | 同檔 `:629-673`(`'gave_up_count',` 在 `:641`) |
| 5 | 全 repo 沒有任何 `DELETE FROM public.pcm_settle_retry_attempts`;表只有 PK、沒有 FK 到 orders | grep migrations / scripts / apps / packages 零命中;建表 `20260905220000:47-53` |
| 6 | 讀這張表的只有:排程、放棄健康檢查、`pcm_readonly` 欄位 SELECT | `20260905220000`、`20260916060000:629`、`20260906380000:151` |
| 7 | 事故 `settle_retry_gave_up` 只在「這次 upsert 蓋了新章」時寫、同單未解決不重寫;`resolved_at` 全 repo 無寫入端(後台事故頁只讀) | `20260916060000` 排程事故段;`apps/admin/src/lib/incidents/incident-repository.ts:51`(只讀 `openOnly`) |
| 8 | 告警 `shouldAlert` 含 `pcmIncidentOpenTotal > 0`;`open_total` = `resolved_at IS NULL` 的列數 ⇒ **任何一筆事故寫下之後,每天都會觸發告警信**(不限本 kind) | `packages/use-cases/src/check-anomaly-alerts.ts:3138`;`20260905290000:200` |
| 9 | **正式庫唯讀量(2026-09-15)**:`pcm_settle_retry_attempts` 0 列、放棄章 0、attempts > 0 的 0;匯款單 unpaid 6 / refunded 1、現金單 0;`pcm-settle-retry` 排程 `*/10 * * * *` active。🔴 `pcm_incident` **未量**:唯讀角色對該表 permission denied | `bash scripts/readonly-prod-sql.sh`(查詢檔在 A 窗 scratchpad,只數不印單號) |
| 10 | 信件文案「放棄章 24 小時後會被拿掉」只在單仍是候選時成立 | `check-anomaly-alerts.ts:1823`、`:2447`(`GAVE_UP_SECTION_SPLIT`) |

### 2-1 單會離開候選的寫入路徑(逐條查最新一代)

盤點方法:grep migrations 寫入語句 ⇒ `scripts/latest-definition-of.sh` 取最新一代 ⇒ grep apps / packages 找呼叫端(Explore 盤點,A 窗抽核關鍵行)。

| 路徑 | 最新定義 | 讓單離開候選的方式 | 呼叫端 |
|---|---|---|---|
| **員工補登收款**(匯款 / 現金) | `admin_record_manual_payment` `20260915234000:92` | INSERT order_payments ⇒ trigger 重算 ⇒ 翻 paid / partiallyPaid(淨額 < total) | `apps/admin/src/lib/orders/payment-repository.ts:207,212` |
| **員工沖銷收款** | `admin_reverse_manual_payment` `20260812150000:344` | INSERT 反號列 ⇒ 重算 ⇒ 淨額降到 0(unpaid 且淨額 0)或 partiallyPaid 且淨額 < total | `payment-repository.ts:269` |
| 重算本身(收款 trigger / 排程) | `pcm_noncard_settle_recompute` `20260916060000:150` | 狀態翻對 ⇒ 不再是候選(若是排程那一次成功,章會被拿掉;**若是員工補登觸發的那一次成功,章不會被拿掉**) | trigger `pcm_noncard_settle_after_payment_ai`;排程 |
| **員工整單取消** | `admin_cancel_order` `20260914050000:295` | `cancelled_at` 有值 | `apps/admin/src/lib/orders/cancel-repository.ts:299` |
| **員工登記人工退款** | `admin_record_manual_refund` `20260912040000:63` | 有未作廢人工退款 ⇒ 排除 | `apps/admin/src/lib/payment/manual-refund-repository.ts:203` |
| 員工作廢人工退款 | `admin_void_manual_refund` `20260912040000:319` | **反向:可能重新回到候選** | `manual-refund-void-repository.ts:102` |
| 客人同一購物車改刷卡(supersede) | `begin_charge_attempt` `20260904050000:65`;`mark_charge_attempt_charged(_fallback)` `20260906700000:158/:354`;`confirm_order_payment` `20260906700000:522` | 同 cart 的 unpaid 匯款單被 `cancelled_at` | checkout 卡片流程(`PgChargeAttemptAdapter.ts:66,76`、`SupabaseChargeAttemptFallbackAdapter.ts:33`、`PaymentConfirmerAdapter.ts:128`) |
| 卡片確認付款 | `confirm_order_payment` `20260906700000:522` | 本體只驗 `payment_status='unpaid'`、不驗管道 ⇒ 理論上可把匯款 / 現金 unpaid 單翻 paid | 同上;**未確認**實際可達(卡片流程只傳卡片單) |

排除(與候選互斥,不會咬到):`pcm_cron.expire_unpaid_orders`(要求淨額 <= 0)、`admin_mark_order_cancelled`(只收刷卡且 refunded)、`settle_zero_total_order`(total = 0;repo 找不到呼叫端,**未確認**接線)。
`orders.total` / `payment_channel` 建單後沒有 UPDATE 寫入端;沒有任何 DELETE orders。

## 3. 缺口

| 缺口 | 現況 | 後果 |
|---|---|---|
| G1 放棄數不分「還在候選」 | 事實 #2、#4 | 單被處理好後【匯款單 / 現金單修不好】每天叫同一張 ⇒ 真正修不好的單混在噪音裡 |
| G2 事故「曾經放棄過」永遠未處理 | 事實 #7、#8 | 告警信每天寄(事故段);**這一條所有事故種類都一樣**,不是本 plan 造成的 |
| G3 文案「24 小時後會被拿掉」不完全對 | 事實 #10 | 讀信的人以為章會自己消失 |
| G4(既有、只記不修)候選但判 overpaid / needs_human 的單章不會被拿掉 | 事實 #3 | 那張單【修不好】段會一直在;而它同時也會出現在 A / B 世界(卡住 / 多收)⇒ 不是漏報,是重複講 |

## 4. 做法(推薦甲;§8 Q1)

### 甲(推薦):健康檢查只數「還在候選」的章 —— 讀端過濾,不刪任何資料

- 新增 `public.pcm_settle_retry_still_candidate(p_order_id uuid) RETURNS boolean`:SQL、STABLE、SECURITY DEFINER、`SET search_path = ''`;條件逐字等於排程候選的【單那一半】(事實 #1,不含 attempts / 24 小時那一條)。owner postgres、四道 REVOKE、零 GRANT(照 `pcm_settle_verdict_safe` 的形狀)。
- `CREATE OR REPLACE get_settle_retry_gaveup_health`:`gave_up_count` / `oldest_gave_up` / `sample_order_ids` 與現金三鍵,都加 `AND public.pcm_settle_retry_still_candidate(a.order_id)`。**鍵名、鍵數不變** ⇒ TS adapter 與 key-contract 測試不用改。`tracked_total` 語意不變(全表列數)。
- 排程**不動**(它的候選查詢是集合查詢 + LIMIT,改成逐列呼叫函式會變慢)。
  - ponytail:條件在排程與新函式各寫一份。上限:有人改排程候選條件而忘了改這支 ⇒ 兩者漂開。擋法:驗收世界 13(兩者對同一批 fixture 判定逐張相同);升級路徑:兩支都改讀同一個 view。
- 章與 attempts 列**原樣留著**:單之後若又回到候選(例:作廢人工退款),排程照舊處理、24 小時重開規則照舊。
- 文案(TS,同一顆或下一顆):`GAVE_UP_SECTION_SPLIT` 與事故段 `settle_retry_gave_up` 那行改成「單已不在重試範圍(已補登 / 取消 / 退款…)時不再算進這一段;事故那筆紀錄照樣留著」。

### 乙:排程每輪把「已不在候選」的章清掉(寫端)

- 排程開頭多一句 `UPDATE pcm_settle_retry_attempts SET gave_up_at = NULL, attempts = 0 WHERE gave_up_at IS NOT NULL AND NOT still_candidate(order_id)`(或 DELETE)。
- 代價:排程多一條寫入路徑(SECURITY DEFINER、每 10 分鐘);最多延遲 10 分鐘;歷史(試過幾次、最後錯誤)被抹掉;要再過一次 P1-6 那 21 個排程世界。
- 不推薦:甲做得到同樣的告警結果而零寫入。

### 丙:在 orders / order_payments / order_manual_refunds 掛 trigger 清章

- 事實 #2-1 有 8 條路徑、3 張表 ⇒ 三個 trigger + 與既有 trigger 的順序問題(`project_0914-orders-trigger-two-standards-not-unified`)。**不推薦。**

## 5. 影響

- Sean / 員工:單處理好之後,【匯款單 / 現金單修不好】隔天就不再列它。
- 事故段不變:`settle_retry_gave_up` 那筆照樣算未處理、照樣讓告警每天寄(§8 Q2 / Q3 決定要不要另外處理)。
- 客人:無。
- 效能:新函式只對「有章的列」逐列呼叫;正式庫 0 列,上限是放棄過的單數。
- G4 不修。

## 6. Rollback

- 同一交易:`CREATE OR REPLACE get_settle_retry_gaveup_health` 回 `20260916060000:629` 那一代(前置閘釘本片 md5;事後閘驗 md5 回到 `77690bb08e3aea51714ec53251ca296c`)⇒ `DROP FUNCTION pcm_settle_retry_still_candidate(uuid)`(先退呼叫端再 DROP)。
- `CREATE OR REPLACE` 保留 ACL / owner;事後閘逐角色核 `{postgres=X/postgres,service_role=X/postgres,payment_confirmer=X/postgres}`。
- 不會被撤銷的事實:無(甲零寫入)。
- TS 文案那顆:revert 即可;鍵沒變,DB 與 TS 先後退都不會 503。

## 7. 驗收

**拋棄式 PG**:從最新 schema dump 起,依序套到 188(`20260916060000`)⇒ 再套本片。每個世界先造一張「被蓋了放棄章」的單(attempts 5、`gave_up_at` 有值),再走一條路徑:

1. 仍是候選(什麼都不做)⇒ `gave_up_count = 1`(匯款)/ `gave_up_cash_count = 1`(現金)。
2. 員工補登收款到足額 ⇒ 重算翻 paid ⇒ 放棄數 0;attempts 列還在。
3. 員工補登到「部分付款且淨額 < total」⇒ 0。
4. 員工沖銷到淨額 0(unpaid)⇒ 0。
5. 員工整單取消 ⇒ 0。
6. 登記人工退款 ⇒ 0;再作廢那筆退款 ⇒ 回到 1。
7. 同 cart 改刷卡 supersede(直接寫 `cancelled_at`,原因 superseded_by_card)⇒ 0。
8. 訂單被刪(直接刪 fixture;正式碼沒有 DELETE)⇒ 0(JOIN 不到)。
9. 候選但 OP6a 判 overpaid(事實 #3,G4)⇒ 仍算 1(本 plan 不修,驗收寫明)。
10. 現金單把 1–6 各跑一次(同上結果)。
11. `tracked_total` 全程 = 全表列數,不因過濾改變。
12. `settle_retry_gave_up` 事故列全程不變(甲不碰事故表)。
13. 🔴 **條件對齊**:對一批 fixture(各狀態 × 管道 × 淨額 × 取消 × 人工退款)逐張比「排程候選查詢撈得到(去掉 attempts 條件)」與 `pcm_settle_retry_still_candidate()` ⇒ 全部相同。
14. 新函式以 PUBLIC / anon / authenticated / service_role / payment_confirmer 呼叫 ⇒ 全部 permission denied;健康檢查以 service_role / payment_confirmer 呼叫照常。
15. rollback 後 md5 回到 `77690bb0…`、新函式不存在、ACL 逐角色相同。
- TS:文案兩處改字、測試釘字面;key-contract / incident-kind-two-truths 綠;整包 `pnpm test`;三綠。
- 審查:adversarial-reviewer(缺 codex 那一路,09-20 前);R2 仍有 must-fix 停。
- 貼板前再唯讀量一次 `pcm_settle_retry_attempts`(若 > 0,列出其中「已不在候選」的張數寫進回報)。

## 8. 要 Sean 拍的題

```
Q1:放棄章在單被處理好之後怎麼辦?
A: 甲(推薦)告警只數「還在重試範圍裡」的章;資料不刪,單之後又出狀況照樣接得回來。
A: 乙 排程每 10 分鐘把已經處理好的單的章清掉;會多一條寫資料的路、會抹掉「試過幾次」的紀錄。
```

```
Q2:「重試放棄」那筆事故紀錄,單處理好之後要不要跟著變成「已處理」?
A: 甲(推薦)不動。它是「曾經放棄過」的紀錄,信裡已寫明是累計。
A: 乙 要。那等於新增「系統自動標已處理」的規則,要另寫 plan(會牽動事故表所有種類怎麼算已處理)。
```

```
Q3:事故表所有種類都沒有「標記已處理」的入口,只要有一筆事故,告警信就會天天寄。要處理嗎?
A: 甲(推薦)另開一片:後台事故紀錄頁加「標記已處理」按鈕(員工按,留操作紀錄),再寫 plan 給你看。
A: 乙 先不動,等真的有事故再說。
```

> ⚠️ Q3 的「天天寄」是讀碼推的(事實 #8),正式庫目前有幾筆未處理事故**沒量到**(唯讀角色讀不到 `pcm_incident`)。主視窗若有權限可補量。

## 9. 估時

甲:migration(新函式 + 健康檢查一支)+ 拋棄式 PG 15 個世界 ~90 分;TS 文案兩處 + 測試 ~20 分;審查另計。Q2 乙 / Q3 甲 各自另開 plan,不在此估。
