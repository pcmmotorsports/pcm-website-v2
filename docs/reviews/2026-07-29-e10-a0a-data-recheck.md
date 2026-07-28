# A0a 資料現況重驗(2026-07-29 production 實查)

> 片型 **docs**(v2 §5.1 第 1 列)。收工證據 = 每條斷言附實查輸出。
> 專案 = `bmpnplmnldofgaohnaok`(v2 §8.3 逐字)。全部為**唯讀** `SELECT`,零寫入。
> 依 v2 §5.1 A0a 驗收:orders 筆數 / 各相依表列數 / 金流狀態分佈 / 六筆 `rec_trade_id` 非 NULL / `payment_method` distinct 對照 canonical mapping。

---

## 1. 結論(先講最重要的)

# 🔴 **A0a 命中規格自己寫的硬停條件 —— D1b1 與 D1c 不得開工。**

`PCM-2026-0101` 的 `payment_charge_attempts.rec_trade_id` = **NULL**。

v2 §5.1 第 19 列(D1b1)逐字:
> 🔴 **硬前置(A0a 實查)**:六筆 attempts 的 `rec_trade_id` **全部非 NULL**(欄位 nullable);任一 NULL = 停下 raise Sean,**不得用寬條件替代**

⇒ 依規格,**停下、raise Sean**。本 session 不自行改判定條件、不改用其他查詢鍵。
其餘 A0a 項目全部通過,且與 v2 §8.3/§8.4 的數字**逐格相符**(見下)。

---

## 2. 六筆 D1 相關訂單 —— 逐筆實查

| 訂單 | 金額 | `payment_status` | `paid_at` | attempt 狀態 | `rec_trade_id` | `bank_transaction_id` | 刷卡日 |
|---|---|---|---|---|---|---|---|
| `PCM-2026-0052` | 6,800 | `paid` | 有 | `charged` | ✅ 有 | 有 | 2026-06-23 |
| `PCM-2026-0102` | 101 | `refunded` | 有 | `charged` | ✅ 有 | 有 | 2026-07-24 |
| `PCM-2026-0104` | 1,180 | `paid` | 有 | `charged` | ✅ 有 | 有 | 2026-07-25 |
| `PCM-2026-0064` | 17,300 | `unpaid` | 無 | **`pending`** | ✅ 有 | 有 | 2026-06-26 |
| `PCM-2026-0090` | 31,400 | `unpaid` | 無 | **`pending`** | ✅ 有 | 有 | 2026-06-27 |
| 🔴 **`PCM-2026-0101`** | 2,400 | `unpaid` | 無 | **`pending`** | 🔴 **NULL** | 有 | 2026-07-21 |

金額欄實名 = `orders.total`(**不是** `total_amount` —— 該欄不存在,v2 未指名、此處補實名)。
`payment_charge_attempts` **無 `amount` 欄**(22 欄實查),授權金額的比對只能來自 TapPay read-back 回傳,不能從本表取。

### 這條為什麼是硬停、不是可繞過的小事

- D1b1 的判定矩陣**以 `rec_trade_id` 為唯一查詢鍵**(v2 §8.4「金流證據前置」逐字:「逐筆以該單 `payment_charge_attempts.rec_trade_id` 為查詢鍵」)。0101 沒有這把鍵 ⇒ **照規格無法產生它的金流證據**。
- 0101 是**待刪 26 張之一**,且是 3 筆 `pending`(刷卡送出、系統從未收到結果)之一 ⇒ 正是既有金流紅線(memory `project_tappay-production-blackhole-settle-line`:「只有明確 failed 才動單、查不到/已扣款絕不移」)最在意的那一類。
- 它**有** `bank_transaction_id`。用它去查 TapPay 在技術上可能可行,但那正是規格禁止的「用寬條件替代」⇒ **屬 Sean 的決策,不屬我可拍的板**(見 §6 待決)。

---

## 3. 表列數 —— 與 v2 §8.4 相依資料實查逐格對照

| 表 | 本次實查 | v2 §8.4 記載 | 一致 |
|---|---|---|---|
| `orders` | **29** | 29 | ✅ |
| `order_items` | **39** | 39 | ✅ |
| `order_legal_consents` | **4** | 4 | ✅ |
| `payment_charge_attempts` | **27** | 27 | ✅ |
| `pending_invoices` | **3** | 3 | ✅ |
| `email_outbox` | **0** | 0 | ✅ |
| `order_refunds` / `order_refund_items` | **0 / 0** | 0 / 0 | ✅ |
| `payment_double_charge_anomalies` / `_events` | **0 / 0** | 0 / 0 | ✅ |
| `order_status_options` | **9** | (未載;P3 九碼的管理表) | 補登 |
| `admin_audit_log` | **27** | (07-27 交接記 27) | ✅ |

### cohort 分佈(`paid_at IS NOT NULL` = 留存)

| | 留存(3 張) | 待刪(26 張) |
|---|---|---|
| `orders` | 3 | 26 |
| `payment_charge_attempts` | **3** | **24** |
| `pending_invoices` | **3** | **0** |
| `order_items` | **3** | **36** |
| `order_legal_consents` | **2** | **2** |

⇒ v2 §8.4 相依表矩陣**四列全中**,含「`pending_invoices` 零刪除、3 筆全屬留存單」與「`order_legal_consents` 是 2+2 不是 4 全走」兩個 v1 曾寫錯的點。

### 待刪 24 筆 attempts 的狀態分佈

`failed` **12** / `released` **9** / `pending` **3** —— 與 v2 §8.4「待刪組裡有 3 筆 pending」**完全相符**。
留存 3 筆全為 `charged`。

🔴 **新增事實(v2 未載)**:待刪組的 `rec_trade_id` 覆蓋率並不完整 ——
`failed` 12 筆中僅 **7** 筆有、`pending` 3 筆中僅 **2** 筆有、`released` 9 筆全有。
⇒ 這解釋了 0101 為何沒有:**這欄本來就會缺**,不是資料損毀。

---

## 4. 金流狀態分佈

| 軸 | 值 | 筆數 |
|---|---|---|
| `payment_status` | `unpaid` 26 / `paid` 2 / `refunded` 1 | 29 |
| `fulfillment_status` | `notOrdered` **29**(單一值) | 29 |
| `payment_method` | NULL **26** / `tappay` **3** | 29 |
| `order_items.workflow_status` | `unpaid_unconfirmed` 32 / NULL 3 / `cancelled` 1 / `received_confirmed` 1 / `received_unconfirmed` 1 / `unpaid_instock` 1 | 39 |

**`fulfillment_status` 全表單一值 `notOrdered`** ⇒ 佐證 §8.1 Q1=B「這欄沒有 writer 在維護」:29 張單走過刷卡、退款、開票,這欄從未動過。

### `payment_method` → canonical rail mapping 驗收(v2 §5.1 A0a 逐字)

- distinct 非 NULL 值 = **`{tappay}`** 一個
- mapping 必含 `tappay → card`(v2 §5.1 A0a 指名,`20260611120000:181` 為來源)
- **未映射值 = 0** ✅ **驗收通過**
- NULL 26 筆 = 無收款 ⇒ 依 v2 §5.3「無收款(none)不建腿」,不屬未映射

---

## 5. D0 片的三個前置字面(順手實查,D0 開工不必再查)

| 項 | 實查值 | D0 要做的事 |
|---|---|---|
| `orders_display_id_format` | `CHECK ((display_id ~ '^PCM-[0-9]{4}-[0-9]{4,}$'::text))` | 放寬成暫收新舊兩種 |
| `orders_display_id_key` | `UNIQUE (display_id)` | ✅ **名稱與 §5.4a 產號合約寫死的 `orders_display_id_key` 相符**,重試只捕捉此約束成立 |
| `pending_invoices_status_check` | `CHECK ((status = ANY (ARRAY['pending'::text, 'issued'::text])))` | 🔴 加 `voided` —— **R5 的實查結論成立**,不加則 D1c 步驟 13 直接被擋 |

`orders` 欄數實查 = **34**,與 v2 §2.1 相符。

---

## 6. 待 Sean 決策(A0a 產生的唯一新決策題)

```
Q(A0a-1):PCM-2026-0101(NT$2,400、unpaid、刷卡 pending)沒有 rec_trade_id,
規格寫死的 D1b1 查詢鍵因此對它不成立。三條路:

A. 用它的 bank_transaction_id 去 TapPay 查(規格明文禁止「用寬條件替代」,
   要走這條等於當場改規格,須你明確授權改哪一條)
B. 把 0101 移出待刪 cohort(26 張 → 25 張),它維持原狀不刪不改;
   其餘 25 張照 D1 走,D1 不因單一筆卡死
C. 整條 D1 暫停,等你先去 TapPay 後台查這筆再決定

A: A|B|C
```

我的推薦 = **B**:D1 的目的是清掉沒有金流的假單,而 0101 恰好是「不確定有沒有扣到錢」的那一類 —— 把它留著的成本只是列表上多一張舊單,把它刪掉的成本是永久失去唯一紀錄。B 也不需要改任何已審過 20 輪的規格字面。

---

## 7. 誠實邊界

- 本片**只做讀取**,零寫入、零 migration、零 apply。
- 六筆的 TapPay 端狀態**本片未查**(那是 D1b1 的工作,且已被上述硬停條件擋住)。
- `orders` 筆數 29 是**本次實查當下**;D1 前若有新結帳會變,所有 D1 斷言依 v2 §8.4 步驟 2 走 **cohort 口徑**、不用全表數字。
- A0b(程式現況)與 A0c(27 項對帳)**不在本片**,另片交付。
