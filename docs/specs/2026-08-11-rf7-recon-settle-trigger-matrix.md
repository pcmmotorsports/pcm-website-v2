# RF7-recon — `settleCharge` 觸發路 × 訂單狀態 × Record 狀態 矩陣

> E 窗六代 / 2026-08-11 夜。派工 = `E-318-A`。樹 = `75e04091`。
> **產出是矩陣、不是修法**(RF7-fix 的 plan 等這份出來才寫)。
> **存在理由**:RF7 的 plan 連寫三版、三版的中心主張都建立在「我列的清單是完整的」,三次都不完整
> (v1 漏角色 ACL 與 `deferred` 語意、v2 漏 Portal 案終態、v3 漏 inbox 不濾與 paid 短路與 `flagNonUnpaidActive`)。
> ⇒ 本檔把「完整性」從**宣稱**變成**可核的產出物**:每軸附窮舉數法、格數 = 軸積、缺格顯式標 N/A。

---

## §0 三軸的窮舉數法(**先看這段,不然下面每個數字都不可核**)

### 軸 1:觸發路 —— **兩法交叉**

```bash
# 法 A:語法呼叫點(不數關鍵字;數關鍵字會得到三位數、幾乎全是註解)
grep -rnE "(await |=> )settleCharge\(|\.settle\(" apps packages --include='*.ts' --include='*.tsx' | grep -v '\.test\.'
# = 10 個呼叫點,分佈 8 支檔

# 法 B:composition 注入點(抓「不是直接 import 而是被注入」的消費者)
grep -rn "getSettleChargeDeps\|settle:" apps/storefront/src/lib/payment/composition.ts
# = 注入點恰 1 個(composition.ts:165 的 `settle:`)→ 消費者 preflight-release-sibling.ts:91
```
**兩法交叉的理由**:法 A 單獨用會漏掉「經由 deps 注入」的消費者(v1 的 7 路就是這樣漏掉 preflight 的);
法 B 單獨用則看不到直接 import 的 7 條。
⇒ **10 個呼叫點收斂成 9 條「閘不同」的路**(`charge-actions.ts:391` 與 `:538` 共用同一個閘,合為一列)。

### 軸 2:訂單 `payment_status` —— **5 值,問 catalog 不數 migration**

```sql
select enumlabel from pg_enum where enumtypid='public.payment_status'::regtype order by enumsortorder;
-- unpaid / paid / partiallyPaid / refunded / partiallyRefunded
```

### 軸 3:Record 狀態 —— **6 類(7 個具名碼 + default)**

數法 = 讀 `classifyRecordStatus` 的 switch 本體(`settle-charge.ts:399-413`),不憑 TapPay 文件:

| 類 | 碼 | verdict |
|---|---|---|
| A | `0` AUTH / `1` OK | `paid_candidate` |
| B | `4` PENDING | `pending / auth_or_pending` |
| C | `-1` ERROR / `5` CANCEL | `explicit_failed` |
| **D** | **`2` PARTIALREFUNDED / `3` REFUNDED** | **`refund_anomaly`** ← RF7 的標的 |
| E | 其他任何碼 | `pending / record_unverified`(fail-closed) |

**格數 = 9 × 5 × 6 = 270**(軸積;三軸的數各自可複跑,見上三段)。
下面**不逐格寫 270 格** —— 先用表 A 把「走不到的格」消掉,再對剩下的格標處置;
**被消掉的格全部附閘的座標**(= N/A 的顯式標記),所以 270 這個母體沒有被偷偷縮小。

---

## §1 表 A:**9 條路 × 5 個訂單狀態 = 45 格「這條路走得到嗎」**

圖例:**✅ 走得到** / **⛔ 閘擋住(附閘的座標)** / **⚠️ 走得到但另有機制先處理**

| # | 觸發路 | 呼叫點 | 前置閘 | unpaid | paid | partiallyPaid | refunded | partiallyRefunded |
|---|---|---|---|---|---|---|---|---|
| 1 | **sweeper·inbox** | `sweep-settlements.ts:173` | **無訂單狀態閘**(claim RPC `20260615120000` 全檔 `payment_status` **0 命中**) | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2 | **sweeper·attempt** | `sweep-settlements.ts:211` | `orders.payment_status='unpaid'`(`20260615120001:16`) | ✅ | ⛔ | ⛔ | ⛔ | ⛔ |
| 3 | **webhook** | `tappay-notify/[secret]/route.ts:191` | 只有 `if (inserted)` 首見(`:189`) | ✅ | ✅ | ✅ | ✅ | ✅ |
| 4 | **callback** | `callback/page.tsx:125` | 只有歸屬閘 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 5 | **輪詢** | `payment-status/route.ts:143` | `raw === 'unpaid'`(`:135-136` 逐字「partiallyPaid/refunded **不觸發** settle」) | ✅ | ⛔ | ⛔ | ⛔ | ⛔ |
| 6 | **黑洞反查** | `reconcile-actions.ts:101` | `paid` 先短路(`:85-87`)+ 節流閘(「order 非 unpaid」回 false) | ✅ | ⛔ | ⛔ | ⛔ | ⛔ |
| 7 | **重刷裁決** | `charge-actions.ts:391` / `:538` | `needs_settle` / in-flight;**不看 payment_status** | ✅ | ✅ | ✅ | ✅ | ✅ |
| 8 | **preflight 兄弟單** | `composition.ts:165` → `preflight-release-sibling.ts:91` | `sibling.kind==='active'`;**不看 payment_status** | ✅ | ✅ | ✅ | ✅ | ✅ |
| 9 | **B1b 孤兒再確認** | `reconfirm-expired-orphans.ts:96` | age≥12h + **order unpaid**(`20260627120000:15`) | ✅ | ⛔ | ⛔ | ⛔ | ⛔ |

**小計(逐列機械複點,不口算)**:45 格 = ✅ **29** / ⛔ **16**。
數法:各列 ✅ 數 = `5,1,5,5,1,1,5,5,1`(照表逐列數)⇒ 和 = 29。
🔴 **本行第一版寫 25/20 是錯的** —— 我口算了一次。這份檔存在的理由就是不要口算,
所以更正留在這裡不擦掉:**寫小計時要對著表逐列數,或用腳本重數**。
🔴 **這張表就是 v3 死掉的地方**:v3 的中心主張是「訂單一旦非 unpaid 就不會被反覆觸發」,
而**第 1、3、4、7、8 這五條路(共 20 個非-unpaid 格)完全沒有訂單狀態閘**。
v3 只看了第 2 條(sweeper·attempt)就下了全稱結論。

---

## §2 表 B:`settleCharge` **內部**對訂單狀態的短路(進得來之後)

| 條件 | 行為 | 座標 | 對 RF7 的意義 |
|---|---|---|---|
| `orderPaymentStatus === 'paid'` | **立即 return paid、不查 Record** | `settle-charge.ts:68-71` | 🔴 **`paid` 那一整欄(5 格 ✅)其實碰不到 Record** ⇒ Portal 對已 paid 單退款,**今天連告警都沒有**。該處註解逐字寫「嚴格 `=== 'paid'`…避免誤短路退款/partiallyPaid 態」—— **設計者想過,是 plan 三版都沒讀到** |
| 其餘 4 值 | 繼續走 Record 查詢 | 同上 | 這 4 值 × 走得到的路 = RF7 真正的作用域 |

⇒ **表 A 的 29 個 ✅ 扣掉 `paid` 欄的 5 格(路 1/3/4/7/8)= 24 格會真的打到 Record**。

---

## §3 表 C:Record 六類 × 現行處置(不分路,`settleCharge` 內部統一)

| 類 | verdict | 現行處置 | 座標 |
|---|---|---|---|
| A `0/1` | `paid_candidate` | 走 `settlePaid` 收斂 | `settle-charge.ts:~155` |
| B `4` | `pending/auth_or_pending` | 回 pending | `:190` |
| C `-1/5` | `explicit_failed` | 守衛後 `markFailed`(弱識別不釋鎖) | `:153-180` |
| **D `2/3`** | **`refund_anomaly`** | **`console.error` + `pending/record_unverified`** | **`:181-188`** ← RF7 標的 |
| E 其他 | `pending/record_unverified` | 回 pending | `:412` |

---

## §4 交叉後 RF7 真正要處理的格 = **24 格**

「會打到 Record」的 24 格在 Record 回 `2/3`(D 類)時全部進 `refund_anomaly`:

| 訂單狀態 | 走得到的路 | 格數 |
|---|---|---|
| `unpaid` | 全 9 條 | **9** |
| `partiallyPaid` | 1,3,4,7,8 | **5** |
| `refunded` | 1,3,4,7,8 | **5** |
| `partiallyRefunded` | 1,3,4,7,8 | **5** |
| `paid` | (1,3,4,7,8) | **N/A** —— 被 §2 的短路擋在 Record 之前,永遠不進 D 類 |

**數法**:`9 + 5×3 = 24`,可對著表 A 逐列數;與 §2 的「29 − 5 = 24」**兩條路徑得到同一個數**
(一條從狀態切、一條從路切)⇒ 這是本檔唯一一個有交叉驗算的數字。

## §5 D 類進來之後,**哪幾條路會累積**(v3 漏掉的那一層)

| 路 | 回 pending 之後 | 會不會累積 | 座標 |
|---|---|---|---|
| 1 sweeper·inbox | `markRetry` → 退避重試 | 🔴 **會**,重試至 ceiling(≥8)→ `needs_manual_review` | `20260615120000` claim **不濾訂單狀態** ⇒ 即使訂單已 refunded 照樣重試 |
| 2 sweeper·attempt | `markSettleRetry` → 退避 | 🔴 會(但**只有 unpaid** 進得來) | `sweep-settlements.ts:213` |
| 3 webhook | 一次性 `after()` | 不累積(但每次新 notify 都會再 log 一次) | `route.ts:189-193` |
| 4 callback | 一次性(使用者開頁才發生) | 不累積 | `page.tsx:125` |
| 5 輪詢 | 一次性 + per-order throttle | 不累積 | `payment-status/route.ts:135-143` |
| 6 黑洞反查 | 一次性 + 節流閘 | 不累積 | `reconcile-actions.ts:91-101` |
| 9 B1b | 每輪 claim + **獨立 6h throttle**(繞 ceiling) | 🔴 **會**(低頻),但**只有 unpaid** 進得來 | `20260627120000:15`;`reconfirm-expired-orphans.ts:96` |
| 7 重刷裁決 | 一次性(使用者重刷才發生) | 不累積 | `charge-actions.ts:391,538` |
| 8 preflight | 一次性;**outcome 決定兄弟單 release/hold** | 不累積,但**影響是否放行重刷** | `preflight-release-sibling.ts:91` |

⚠️ **本表的母體是「§4 那 24 格裡出現過的路」= 全部 9 條**(不是只有非-unpaid 那 5 條)——
第一版我把 5/6/9 併成一列寫「進不來」,那是**只看非-unpaid 欄**的說法:它們對 `unpaid` **是進得來的**,
而 `unpaid` 正是 24 格裡最大的一列(9 格)。已拆開逐條標。

🔴 **另有一條與 D 類無關、但同樣把單子送進人工的既有機制**:
**`flagNonUnpaidActive`**(`PgChargeAttemptAdapter.ts:210`)—— 專門把「**訂單非 unpaid 但 attempt 仍 active**」標成人工。
⇒ 已退款的單只要 attempt 還活著,**不需要經過 RF7 的路徑就會被標人工**。
**這是設計上已經存在的處置**,RF7-fix 必須先回答「它算不算已經解決了那一類」,而不是另外再發明一套。

---

## §6 這份矩陣**沒有**回答的事(誠實界)

1. **沒有實跑任何一格** —— 全部是讀 code / migration / catalog 得出的靜態盤點。
   `order_refunds` 正式庫 0 列 ⇒ D 類的格今天**構造不出真資料**(constructibility 標記:
   要造得先有一筆真退款,而那要 flag 開 + Sean 動作)。
2. **沒查 `flagNonUnpaidActive` 的觸發頻率與實際掃描條件**(只確認它存在與它的意圖)。
3. **軸 3 的 E 類(未知碼)沒有窮舉 TapPay 官方碼表** —— 只知道「switch 沒列到的一律 fail-closed」。
4. **表 A 的閘我讀的是 code 與 migration 原文,沒有實跑驗證任一格的閘真的擋得住**。
5. `paid` 欄標 N/A 的依據是 `settle-charge.ts:68` 那一行 —— **它是 `===` 不是 `!==`**,
   所以 `partiallyPaid`/`refunded`/`partiallyRefunded` **確實不被短路**(這點我逐字讀過)。

## §7 給 RF7-fix 的三個「先回答再動手」

1. **`flagNonUnpaidActive` 算不算已經處理了「非 unpaid + active attempt」那一類?** 若算,RF7 的範圍再縮。
   ⚠️ **這題我沒有答案**:我只確認它存在(`PgChargeAttemptAdapter.ts:210`)與它的意圖(方法名 + 該檔註解),
   **沒查它的掃描條件、觸發頻率、以及被標人工之後誰會處理** ⇒ 標**未查**,不得當成「已經有解」。
2. **inbox 那條路(路 1)要不要也濾訂單狀態?** 它是唯一「訂單已退款仍會重試到人工」的路 ——
   而那可能是 **inbox 的 bug、不是 RF7 的範圍**。
3. **證據的粒度**:v3 用 `orders.payment_status`(訂單層累積狀態)當「這一次 Record 事件」的證據被打穿。
   RF7-fix 若要用帳本,鍵必須是 `recTradeId`(v2 的結論);若不用帳本,就得先回答「什麼東西是**這一次**的證據」。
