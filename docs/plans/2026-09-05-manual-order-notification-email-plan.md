# 手動建單:通知 email 欄 + 「可以不填 = 不寄」

> **線**【信】`-mail` · 2026-09-05 · 板列 `⟦f3-MAILFALLBACKVSRULING⟧` · 鐵則 8 plan
> **主視窗-94 指定**:語意照 Sean **已拍**的「可以不填 = 不寄」,**不再問他長什麼樣**。

---

## 0. 一句話

後台手動建單**今天沒有 email 欄**,所以 `orders.notification_email` **恆 NULL**,
四支寄信掃描一律 fallback 到 `customers.email` ⇒ **客人一定收到信,而員工沒有任何方法阻止**。
本 plan 把那個欄位做出來,並讓**手動單**的留白**真的等於不寄**。

🛑 **這不是「拿掉 fallback」** —— 顧客站那條路的 NULL 是**合法的**,拿掉會讓**顧客站的單全部不寄**。

---

## 1. 現況(全部是 2026-09-05 讀碼量到的;每格帶正對照)

| 讀數 | 值 | 正對照(同一把尺) |
|---|---|---|
| `manual-order-form-body.tsx` 含 `email` | **0** | `order` ⇒ **39** |
| `manual-order-actions.ts` 含 `email` | **0** | `order` ⇒ **39** |
| `manual-order-repository.ts` 送給 RPC 的參數 | **10 個**,不含 `p_notification_email` | — |
| `admin_create_manual_order` 宣告的參數 | **10 個**,不含 `p_notification_email` | 兩邊 **10 = 10** |
| `create_order`(顧客站那支)第 10 參 | ✅ **`p_notification_email text DEFAULT NULL`** | `p_lines` ⇒ 4 |
| 4 個 pending view 含 `order_source` | **0 / 0 / 0 / 0** | `notification_email` ⇒ **3/3/2/3** |

🔵 **負對照**:`zzz_never_a_column` / `pcm_zzz_never_a_view` ⇒ **0**。

📌 **⇒ 兩支建單 RPC 不是同一支**:顧客站走 `create_order`(**已經收得下**那個參數),
手動走 `admin_create_manual_order`(**收不下**)⇒ **所以手動那半要動 migration,顧客站那半不用。**

---

## 2. 分流欄位:**已經有了,不必發明**

`orders.order_source`(CHECK 在 `20260712203000`),值域逐字:
```
'web' | 'manual_phone' | 'manual_line' | 'manual_other'
```
· 手動建單**已經在送** `p_order_source`(`manual-order-repository.ts:287`),
　值域被 `MANUAL_ORDER_SOURCES`(`manual-order-form.ts:134`)限制在**三個 `manual_*`**。
· 🔴 **而四個 pending view 沒有把它帶出來**(上表)⇒ **這就是本 plan 的 migration 那一片。**

🔵 **交叉訊號(不當主判準,只當回核)**:`manual_request_id` 也是手動專屬。
　⚠️ 主判準用 `order_source` —— **它是【語意欄】,而 `manual_request_id` 是【冪等鍵】**;
　拿冪等鍵當來源判準,下一個改冪等策略的人會不知道他也改了寄信行為。

---

## 3. 語意(Sean 已拍,本 plan 不重問)

```
手動單   notification_email 有值 ⇒ 寄到那個值
         notification_email 留白 ⇒ 🔴 不寄(不 fallback 到 customers.email)
顧客站   維持現狀:firstNonEmpty(notification_email, customers.email)
```
🛑 **「不填」與「不寄」在資料上是同一個 NULL** —— 而**分流靠 `order_source`,不靠再加一個欄位**。
📌 這是刻意的:**多一個 `do_not_send` 布林 = 多一個會與 NULL 不一致的狀態**,而沒有人會去對帳它。

---

## 4. 影響面

```
DB     4 個 pending view 各加一欄 order_source(CREATE OR REPLACE VIEW)
       admin_create_manual_order 加第 11 參 p_notification_email text DEFAULT NULL
碼     packages/ports          4 支 scanner 介面各加 orderSource
       packages/adapters       4 支 scanner adapter 各多撈一欄
       packages/use-cases      4 處 firstNonEmpty 改成分流(order-created / order-shipped /
                               unpaid-cancelled / tracking-corrected,各 1 處)
       apps/admin              表單加欄 + form 解析 + repository 多送一個參數
```
🔴 **不動**:`sweep-email-outbox.ts`(它只認 `job.recipientEmail`,分流在 enqueue 那層做完)。

⚠️ **前置未確認**:那 4 個 view 的最新定義是 `20260904280000` / `20260905020000` /
`20260905030000` / `20260905040000` —— **貼了沒我沒查**。
🛑 **不要用 `APPLIED.tsv` 的 0 當答案**(檔頭逐字「不在本表上什麼都不代表」)⇒
　 開工第一件事跑 `bash scripts/is-migration-applied.sh <版本號>`,四支各一發。

---

## 5. 拆片(每片 15-45 分鐘、可獨立驗、可獨立回退)

| 片 | 內容 | 片型 | 驗收 |
|---|---|---|---|
| **A** | 一支 migration:4 個 view 各加 `order_source` 欄。🔴 **它要先 apply, 片 B 的碼才能上**(碼先上 ⇒ PostgREST 42703 ⇒ 四條通知線整段停) | 高風險(鐵則 12③) | 拋棄式 PG 起 view + 自帶斷言(四個 view 都查得到那一欄);**碼一行不動** ⇒ 貼上去也不改行為 |
| **B** | ports + adapters:4 支 scanner 多撈一欄、型別加 `orderSource` | 標準 | 三綠 + 4 支 scanner 測試各補一格「撈得到 order_source」 |
| **C** | use-cases:4 處分流 + **雙向測試** | 標準 | 見 §6 |
| **D** | migration:`admin_create_manual_order` 加第 11 參(`DEFAULT NULL` ⇒ 舊呼叫端不壞) | 高風險(鐵則 12③) | 自帶斷言:11 參那一代存在、10 參那一代已 drop |
| **E** | admin 表單欄 + form 解析 + repository 送第 11 參 | 標準 | 表單測試:有填 ⇒ 送出去;留白 ⇒ 送 `null`(不是空字串) |

🔵 **A→B→C 之後行為就對了**(那時手動單一律留白 ⇒ 一律不寄);**D→E 才給員工「填」的能力**。
📌 **⇒ 順序是刻意的**:C 落地那一刻,手動單從「一定寄」變成「一定不寄」——
🔴 **而那正是要問 Sean 的那一題(§8)。** 沒有他的答案之前 **C 不落地**,A/B 可以先走(它們不改行為)。

---

## 6. 測試雙向(C 片的驗收,逐條可 yes/no)

```
① 手動單(order_source='manual_phone')+ notification_email 留白  ⇒ 🔴 不 enqueue, 計 noRecipient
② 手動單                              + notification_email 有值  ⇒ ✅ enqueue 到那個值
③ 顧客站(order_source='web')       + notification_email 留白  ⇒ ✅ enqueue 到 customers.email(現狀不變)
④ 顧客站                              + notification_email 有值  ⇒ ✅ enqueue 到那個值
🔵 負對照:manual_line / manual_other 兩個值也要各跑一發 ——
   🛑 只測 manual_phone 的話, 一個寫成 `=== 'manual_phone'` 的實作會全綠。
🧬 突變(每發要紅):把分流條件反過來 / 把三個 manual_* 收成一個 / 把 ① 的 null 改成 ''
```
🔴 **四格 × 4 支 use-case = 16 格**,而**四支各自有自己的測試檔** ⇒ 不共用 fixture。
📌 **理由是量過的**:跨檔假設沒有任何一支測試守得住 —— 每支測試的分母是它自己那支檔。

---

## 7. Rollback

```
E ⇒ git revert(純碼)
D ⇒ 反向 migration:DROP 11 參那一代、CREATE 回 10 參那一代(檔案已在 repo, 逐字可抄)
C ⇒ git revert(純碼)⇒ 行為立刻回到「一律 fallback」
B ⇒ git revert(純碼;view 多一欄不會壞舊 adapter)
A ⇒ 🔴 **DROP VIEW 再 CREATE VIEW**(⛔ ~~CREATE OR REPLACE 回原定義~~ —— **做不到:CREATE OR REPLACE 不能【減少】欄位**;R1-F4 抓到本 plan 與 migration 檔尾互相矛盾)。🛑 而 `DROP` 會一起帶走 **ACL 與 `COMMENT ON VIEW`** ⇒ 回退腳本要把 REVOKE/GRANT 與四段 COMMENT 一起貼回(原文在那四支 migration 裡, 逐字可抄)
```
🔵 **A 與 B 可以留著不回退** —— 它們**不改任何行為**,只是多帶一欄。

---

## 8. ~~要 Sean 拍的~~ ⇒ **已量,零題**

🔬 **2026-09-05 唯讀正式庫實查(主視窗-94 指定「先補那一發」)**:
```
manual_* 未出貨未取消      0 張
manual_* 【總共】          0 張
🟢 正對照 order_source 全部值   只有 web(1 張)
🔵 負對照 zzz_never_a_source    0
訂單活列總數 1(那一張:web / refunded / notOrdered / 通知信箱有值)
```
🎯 **⇒ 原本那題(舊手動單會從「一定寄」變成「一定不寄」)的代價 = 0 人受影響**
⇒ ✅ **直接走甲(照新規則), 不端給 Sean**(主視窗-94 2026-09-05 裁「不端」)。

🔴🔴 **而這一發差一點報錯 —— 記在這裡因為下一個查正式庫的人會撞到同一格**:
`pg_class.reltuples` 說 `orders` ≈ **20**, 而我數到 **1** ⇒ 看起來像我被 RLS 擋住了。
🟢 但 `products` 數到 25,038 = 統計 25,038(**尺是好的**), 且 `pcm_readonly` 的 `rolbypassrls = t`(**繞得過 RLS**)。
✅ **決勝的是 `pg_stat_user_tables`**:`orders` 的 `n_live_tup` = **1**, 而 `last_analyze` 是 **2026-08-12**
⇒ 🎯 **那個 20 是三週前的過期統計, 不是我看不到的 19 張單。**
📌 **⇒ 「被擋住」與「那些單早就被清掉」印同一個形狀** ——
分開它們的不是更仔細地數, 是**去問一個那兩個世界會給不同答案的問題**。

## 9. 本 plan 證不到什麼

```
① 全部是【讀碼】—— 沒有跑正式站, 沒有跑本機 dev server
② 沒量「今天有幾張手動單真的寄出去了」⇒ §8 那題的代價還沒有數字
③ CHECKOUT_NOTIFICATION_EMAIL_ENABLED 在【線上】是什麼值, 只有 Sean 看得到
   ⇒ 它不影響本 plan 的修法(顧客站那半不動), 但它決定顧客站今天走哪一條路
④ 那 4 個 pending view 貼了沒 —— 未查(§4 已寫查法)
```
