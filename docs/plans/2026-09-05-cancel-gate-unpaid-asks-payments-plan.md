# Plan · `admin_cancel_order` 的 `unpaid` 那一支要不要也問 `order_payments`

> `⟦0a-CANCELGATEASKSWRONG⟧`。線【帳號】`-account` 2026-09-05 夜跑寫。**一行碼都沒動。**
> 前身:`~/pcm-mailbox/de-plan-Q1-已收款單取消後的待退款-20260827.md`(248 行, 2026-08-27)。

---

## 🔴🔴 §0 先讀:**這一列的「後果」那一段, 已經被 2026-09-01 接住了**

> 板列 `:873` 逐字寫著後果是:「已收款的單被取消 **而沒有退款紀錄**」。
> **那句話今天不成立。** 而它不成立這件事, 板列上沒有人更新過。

**當場量到的(不是讀來的):**
```
20260901080000_m4b_autorefund_pending_refunds.sql
  :367  CREATE FUNCTION public.pcm_pending_refund_on_cancel()
  :495  CREATE TRIGGER  order_pending_refund_open_au
        AFTER UPDATE OF cancelled_at ON public.orders
  :378  唯一的 early return = 「已經取消過 / 不是由無變有」
        🔴 **沒有任何 payment_status 的守門**
  :432  INSERT INTO public.order_pending_refunds …
        金額 = SUM(order_payments.amount) − SUM(未作廢的 order_manual_refunds)  逐 rail
  :450  WHERE x.amt > 0        ⇒ 有淨額才開列
帳本:20260901080000 與 20260902030000 **都在 APPLIED.tsv 上**
```

⇒ 🎯 **所以一張「`payment_status = 'unpaid'` 而 `order_payments` 有錢」的單被取消時,
   系統【會】自動開一筆待退款, 金額從收款帳本算, 而它不看 `payment_status`。**
⇒ 📌 **錢沒有掉在地上。** Sean 2026-08-27 拍的 `q1 = 甲`(已收款單取消 ⇒ 自動開待退款)
   **已經落地了**, 只是落在 trigger 上而不是落在閘上。

🛑 **而【剩下的缺口是真的, 只是換了一種】** —— 見 §1。

---

## 1. 那剩下什麼(精確形狀)

**閘的現況**(最新一代 `20260903093000_…:418-430`, 用 `latest-definition-of.sh` 定位, 不信舊行號):
```sql
IF (v_order.payment_status <> 'unpaid'
     AND NOT (payment_status = 'paid'
              AND EXISTS (SELECT 1 FROM order_payments WHERE order_id = …)
              AND NOT EXISTS (… AND rail = 'card')))
   OR EXISTS (SELECT 1 FROM payment_charge_attempts WHERE status <> 'failed')
THEN RAISE
```
🔴 **`payment_status = 'unpaid'` 讓第一段整個短路** ⇒ 那一支**從頭到尾沒問過收款帳本**。

⇒ **剩下的缺口不是「錢不見」, 是這三件:**
| # | 缺口 | 誰受傷 |
|---|---|---|
| ① | 員工按下取消時, **畫面不會告訴他「這張單其實收過錢」** | 員工以為在取消一張沒收錢的單 |
| ② | 那張單走的是「未付款取消」的**信件與文案路徑** | 客人可能收到一封語氣不對的信 |
| ③ | 待退款是**事後**自動開的 ⇒ 沒有任何一刻**要求員工確認** | 沒有人為那筆退款負責 |

📌 **⇒ 這三件都不是資料完整性問題, 是【知情】問題。**
   而那正是為什麼**不能照 08-27 那份 plan 直接做** —— 那份寫的是「補上資料」, 而資料已經有了。

---

## 2. 兩個做法, 而它們的差別是【擋人】還是【告訴人】

```
甲(擋)  unpaid 那一支也問 order_payments;有淨額 ⇒ RAISE, 要員工先處理
         ✅ 最強;🛑 而它會擋住一個【今天可以完成】的操作 ⇒ 員工可能卡住而不知道下一步
乙(說)  閘不動;取消畫面在送出前顯示「這張單的收款帳本有 NT$ X, 取消後會開一筆待退款」
         ✅ 不擋人、不動 RPC(前端片);🛑 而它擋不住「看到了還是按下去」
```
🔵 **我的推薦:乙, 而理由是量到的不是偏好** ——
錢已經被 trigger 接住(§0)⇒ 甲擋的是**知情**不是**損失**;
而甲是第 6 代 `admin_cancel_order`(鐵則 12①③ + Sean 手貼), 乙是一個前端片。
**用最貴的手段去解一個已經不流血的傷口, 代價不對稱。**
🛑 **而乙有一個我不會替他決定的代價**:員工看到了還是可以按 ⇒ **那是 Sean 的風險胃口, 不是工程判斷。**

---

## 3. 若拍甲:要改什麼(而**不要複製那支函式**)

- **只動閘那一段**(步 7), 把 `unpaid` 從短路裡拿出來:
  `unpaid` 也要 `NOT EXISTS (SELECT 1 FROM order_payments WHERE order_id = … )` 才放行。
- 🔴 **不得自己再寫一份金額計算** —— `pcm_pending_refund_on_cancel`(`:432`)已經有一份,
  而**兩份會漂**。⇒ 閘只問「**有沒有**」, 不問「**多少**」。
  ⚠️ 那也與現行閘的既有紀律一致:該檔 `:415-417` 逐字「**刻意不看淨額**」——
  理由是並行下 `SUM(amount) > 0` 會翻面(codex 關卡1 R2 的 E-1)。**照抄那個理由, 不要推翻它。**
- ⚠️ **`pcm_pending_refund_open_for` 這個名字:它【存在】, 而它還沒進 dev。**
  🔬 當場量到:`git grep -l pcm_pending_refund_open_for agent/line-mail` ⇒
  **`agent/line-mail:supabase/migrations/20260905070000_m4b_pending_refund_on_late_payment.sql`**。
  ⛔ ~~我第一版寫「全 repo 零命中」~~ —— **那句話的射程只到【我這棵分支】**, 而它讀起來像「不存在」。
  🎯 **⇒ 多分支的 repo 裡, 「查無」是【相對於你站在哪一棵樹】的** ——
     而「這裡沒有」與「哪裡都沒有」在 `grep` 的輸出上長得一模一樣。
  ✅ **⇒ 這一片動手前要先確認 `agent/line-mail` 那支合進來了沒**:
     · 合進來了 ⇒ 用它, **不要自己再寫一支**
     · 還沒合  ⇒ 這一片**不得**依賴它(否則會依賴一個線上不存在的東西)
  🔵 而**今天已經在 dev 上、可以依賴的**是這兩支:`pcm_pending_refund_on_cancel`(trigger,
     `20260901080000`)與 `pcm_pending_refund_amounts`(`20260902030000`)。

## 4. 影響面
`admin_cancel_order` 第 6 代 ⇒ 全站唯一的取消入口(`cancel-repository.ts` 1 個非測試呼叫端)。
🔴 動它會影響:後台取消鈕 · 部分取消 · 冪等重放 · L3 逾期自動失效(它也走 cancelled_at)。
⚠️ **而 L3 那條是最容易被漏掉的**:`expire_unpaid_orders` 把 `unpaid` 的單設成 cancelled ——
若閘變嚴, **那條自動路徑會不會被自己的閘擋住?** ⇒ 動手前必須先確認它走不走這支 RPC。

## 5. Rollback
`CREATE OR REPLACE` 回第 5 代(`20260903093000:90-…` 原樣)。無資料寫入、無 schema 變更 ⇒ 可逆。
⚠️ 不可逆的只有**期間被擋下來的取消**(員工當下做不成)—— 那不是資料損失, 是工時。

## 6. 探針(雙向, 而**現況那一發必須紅**)
```
世界                                                   現況   修後(甲)
unpaid + order_payments 有淨額 ⇒ 取消                   放行   ⇒ 必須 RAISE
unpaid + order_payments 零列   ⇒ 取消                   放行   ⇒ 仍放行(負對照)
paid  + 非卡收款              ⇒ 取消                   放行   ⇒ 仍放行(既有行為不得改)
有 active charge attempt      ⇒ 取消                   RAISE  ⇒ 仍 RAISE
```
🛑 **少了第 2、3 列, 一個「把 unpaid 整支關掉」的實作會全綠** —— 而它會擋住每一張正常的未付款單。
🔵 跑法照 `docs/runbooks/throwaway-postgres-for-migration-verification.md`(完整 schema)。

## 7. 誰審
鐵則 12 **①錢 ③DB 結構與不可逆寫入** ⇒ **codex 唯讀對抗審查, 不降級**;第 3 輪換角度換模型。
鐵則 8 ⇒ **本檔就是那份 plan, 要 Sean 批准才動碼。**

## 8. 給 Sean 的一題(一個字)
```
Q: 員工取消一張「還沒登記收款、但其實已經收到錢」的單時, 系統要怎樣
A: 甲 擋下來, 要他先處理那筆錢
   乙 不擋, 但送出前明白告訴他「這張單收過 NT$ X, 取消後會開一筆待退款」(推薦)
```
🔵 **推薦乙的理由**:錢已經被自動接住了(§0)⇒ 甲擋的是知情不是損失, 而甲要動取消那條路的第 6 代。
🛑 **而乙的代價要一起講**:員工看到了還是可以按下去 —— **那是你的風險胃口, 不是我能替你決定的。**
