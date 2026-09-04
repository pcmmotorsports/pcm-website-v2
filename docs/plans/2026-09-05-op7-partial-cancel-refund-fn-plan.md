# OP7 · 部分取消的待退款函式 —— plan(不寫 SQL)

> 錨 `⟦b4-PARTCANCEL1⟧` · 線 `-account` 2026-09-05 · 主視窗派
> 🔴 **本檔不含任何 SQL**,也不動任何一行碼。它要回答的是「該不該多一支函式、接在哪」。
> ⚠️ **每個事實都帶 `檔:行`。本檔所有座標讀的是 `origin/dev`(我的工作樹落後 60 顆時量的)。**

---

## §0 先答主視窗點名的那一題:**是不是就該接在 `pcm_pending_refund_amounts` 上?**

### ✅ 答案:**是。而且不只是「接在上面」—— 那支函式【本來就是 Q13,只是把一個項寫死成 0】。**

Sean 的 Q13(逐字原話抄在 `supabase/migrations/20260810100000_m4b_e10_op1_order_payments_m.sql:25-26`):

> 退款額 = `max(0, 已收未退總額 − 取消後訂單剩餘應收總額)`

而 `pcm_pending_refund_amounts(uuid)`(`supabase/migrations/20260902030000_m4b_crossrail_pending_refund_net.sql:64`,
`RETURNS TABLE (rail text, amount bigint)`)今天算的是(同檔 `:76-92`):

- 逐軌 `SUM(order_payments.amount) − SUM(order_manual_refunds.refund_amount WHERE voided_at IS NULL)`
- 只留 `net > 0` 的軌(`:89`),再用前綴和差分把 `total` 分配下去

⇒ 🎯 **`total` = Σ 逐軌淨額 = 「已收未退總額」。**
⇒ ⇒ 🔴 **它就是 Q13 在「剩餘應收 = 0」時的樣子。** 而**整單取消時剩餘應收確實是 0**,所以它一直是對的。

### 📌 ⇒ 結論:**不要寫第二支算金額的函式。**

寫第二支的代價不是多花時間,是**兩份金額算法會分岔而沒有東西會叫** ——
而那正是這一族已經記過的病:同一支檔 `20260902030000:87` 逐字承認
`('bank_transfer'),('cash')` 是 `order_payments.rail` 值域的**手抄副本**,且**已經有兩份**要同步。

⇒ **OP7 = 把 `pcm_pending_refund_amounts` 裡那個隱含的 0 換成一個算得出來的值**,不是新開一支。

---

## §1 而在寫簽名之前,我要**收回我自己昨天寫上板的一句話**

我在 `⟦b4-PARTCANCEL1⟧` 上寫了:

> 「Q13 那個公式讓三個攤提問題(按品項攤?按實收比例?運費算不算?)整個消失 —— 那三問是問錯了層。」

🔴 **那句話【只對了三分之二】。**

- ✅ **「按品項攤」「按實收比例」確實消失了** —— Q13 不問錢該算在哪一件商品上,它只問兩個總額。
- ⛔ **而「運費算不算」【沒有消失】,它換了位置** —— 它不再是「怎麼分退款」,
  它變成 **「什麼叫【取消後訂單剩餘應收總額】」** 的一部分。

⚠️ **⇒ 這一格要端 Sean,而我上一則說「不用問」是錯的。** 理由在 §2。

📌 **而這個錯的形狀值得記**:我拿一個**正確的公式**,推翻了一組**問錯層的問題**,
然後**連帶把那組問題裡唯一一個問對層的也一起丟掉了**。
⇒ 🛑 **推翻一個清單時,要逐條問「這一條也一起倒了嗎」,不是整包倒。**

---

## §2 `剩餘應收` 算不出來 —— 而**成因是量到的**

🔴 **部分取消【不會改 `orders.total`】。** 實查 `20260805100000_m4b_e10_a8a2_partial_cancel.sql`:
全檔只有一處 `UPDATE public.orders`(`:463`),而它只在**全部品項都被取消**時
(`v_closed`,判定式在 `:456-462`)寫 `cancelled_at` / `cancelled_reason` / `updated_at` —— **一個金額欄都沒碰**。

🟢 **正對照**:`20260905060000_m4b_stuck_bank_orders_health.sql:68` 逐字「有退款的單 `total` 不會變」⇒ 同一個事實,另一個作者。

⇒ **所以 `剩餘應收` 沒有欄位可讀,必須算。** 而算它會撞到 `orders` 的金額不變式
(`20260604120000_m3_s2a_orders_order_items.sql:26` 的 DDL CHECK 逐字):

```
total = subtotal + shipping_fee - discount_total
```

取消掉幾件之後:
- `subtotal` 那一項**算得出來** —— `order_items` 減掉 `order_cancellation_items.cancelled_quantity`
  (表在 `20260730130000_m4b_e10_a7_order_cancellations.sql:206-224`,欄位 `order_item_id` + `cancelled_quantity`)
- 🔴 **`shipping_fee` 與 `discount_total` 算不出來** —— 它們**不是品項的屬性**,沒有任何規則說取消之後它們變多少。

### 🛑 而這裡有一個**具體而且會發生**的情境,不是理論

運費規則(`20260604120000:16` 逐字):**滿 NT$5,000 免運,未滿 flat NT$100**。
⇒ 客人買 5,200 免運;取消掉 300 那件之後剩 4,900 ⇒ **本來就該收 100 運費了**。
⇒ 🔴 **「剩餘應收」到底是 4,900(照舊免運)還是 5,000(補收運費)?**
⇒ ⇒ **這兩個數會讓退款差 100 元,而沒有任何一份文件答得出來。**

### 📮 ⇒ 要端 Sean 的一字題(草稿,交主視窗進佇列)

```
Q-部分取消運費:客人買了 5,200 免運, 後來取消一件 300 元的, 剩 4,900。
   我們退錢的時候, 運費怎麼算?
A: 甲 | 乙
甲 = 當作還是免運(退 300, 客人拿回整整那件的錢)
乙 = 照規則補收運費(退 200, 因為剩下的金額已經不到免運門檻)
```
**推薦 甲。** 代價一句:甲 我們少收 100 運費,而**乙 要跟一個正在被退錢的客人多要 100 元** ——
那通電話的成本遠高於 100。

⚠️ **這題答完之前,OP7 的函式簽名可以定,而它的【本體算不出來】。**

---

## §3 簽名(等 §2 答完才落地)

```
public.pcm_order_remaining_due(p_order_id uuid) RETURNS bigint       -- 新, §2 的答案住這裡
public.pcm_pending_refund_amounts(p_order_id uuid)                    -- 既有, 改它不新開
    RETURNS TABLE (rail text, amount bigint)
```

- 🔴 **`pcm_pending_refund_amounts` 用 `CREATE OR REPLACE` 改**(不新開一支):
  它今天有三個呼叫端要繼續動 —— `pcm_pending_refund_open_for` 兩處
  (`20260905070000_m4b_pending_refund_on_late_payment.sql:204-205` 的 WARNING 判定 與 `:211` 的 INSERT ... SELECT)、
  以及本線 2026-09-05 新建的 TS 讀端 `apps/admin/src/lib/payment/pending-refund-repository.ts:56`。
- 🛑 **而 `CREATE OR REPLACE` 會靜靜蓋掉撞名**,`20260902030000:60-63` 逐字警告過這一格 ⇒
  改它的那支 migration 要**自己帶一道「改之前的定義長這樣」的斷言**,不能只靠 REVOKE 後置檢查。
- ⚠️ **ACL**:`CREATE OR REPLACE` 保留既有 ACL(三道 REVOKE + 只 GRANT `service_role`,`20260902030000:197-200`)
  ⇒ **不要重打一份 GRANT**,重打會讓下一個人以為那是新授權。

---

## §4 讀哪些表(全部,不省)

| 表 | 用來算什麼 | 座標 |
|---|---|---|
| `order_payments` | 已收(逐軌) | `20260810100000:189` 的 `CHECK (rail IN ('card','bank_transfer','cash'))` |
| `order_manual_refunds` | 已退(逐軌,`voided_at IS NULL`) | `20260820010000_m4b_manual_refunds.sql:163` `rail` 欄 |
| `order_items` | 原始應收的品項面 | `20260604120000:146` `quantity > 0` |
| `order_cancellation_items` | 取消掉多少 | `20260730130000:206-224` |
| `orders` | `shipping_fee` / `discount_total` / `total` | `20260604120000:26` 不變式 |

🔴 **`order_pending_refunds` 不在這張表裡** —— 它是**產物**不是輸入。
把它讀進來算金額會造出一個自我餵食的迴圈(這一輪的輸出變成下一輪的輸入)。

---

## §5 接線:呼叫端在哪、以及**為什麼不能只加一個 trigger**

### 今天的接線
- 部分取消的 UI:`apps/admin/src/components/orders/cancel-order-forms.tsx:228` `PartialCancelForm`
  (勾選框值 = `<order_item_id>:<數量>`,`maxCancellable > 1` 時旁邊有數量覆寫欄)
- 走的 RPC:`admin_cancel_order(p_order_id, p_idempotency_key, p_actor, p_reason_code, p_reason_detail, p_items jsonb DEFAULT NULL)`
  —— `20260805100000:80-87`。**`p_items` 為 NULL = 整單取消,非 NULL = 部分取消。**
- 🔴 **實查:A8a2 全檔 `pending_refund` 命中 = 0**(`git show origin/dev:<該檔> | grep -c pending_refund`)
  ⇒ **部分取消今天完全沒有碰待退款,那是板列說的那個洞。**

### 🛑 而**不能只加一個 trigger** —— 理由是既有碼寫著的
既有那支 `pcm_pending_refund_on_cancel()`(`20260901080000:367`)掛的是
`OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL`(同檔 `:377-378`)。
⇒ **部分取消不寫 `cancelled_at`(§2 實查)⇒ 那個 trigger 永遠不會醒。**

而 `pcm_pending_refund_open_for`(`20260905070000:121`)第一件事就是
`IF v_cancelled_at IS NULL THEN RETURN`(同檔 `:174-175`)
⇒ 🔴 **直接叫它也沒有用,它會安靜地什麼都不做、回 void、沒有錯誤。**

📌 **⇒ 那正是最危險的形狀:接上了與沒接上印同一個東西。**
⇒ ✅ **接法**:在 A8a2 寫完 `order_cancellation_items` 之後**明呼**一次,
   並把 `open_for` 的那道 `cancelled_at` 閘**改成「整單取消 或 有取消品項」**,
   而**不是拿掉它**(拿掉 = 任何一張沒事的單都會被開待退款)。

---

## §6 測試:雙向,而且要有一格「這個突變落在目標上」

| # | 世界 | 期望 | 🔴 它防的是什麼 |
|---|---|---|---|
| 1 | 整單取消、匯款收 1000 | 待退 1000 | **回歸**:改完之後既有行為一個字都不能變 |
| 2 | 部分取消、收 1000、剩餘應收 700 | 待退 300 | 缺陷本體 |
| 3 | 部分取消、收 1000、剩餘應收 1200 | **待退 0 列**(不是一列 0 元) | Q13 的 `max(0, …)`,「不足不用退」 |
| 4 | 部分取消、**一件都沒取消** | 待退 0 列 | 🔴 **負對照**:閘放太寬時這一格會紅 |
| 5 | 匯款收 1000 + 現金退 500、部分取消 | 逐軌不分岔 | 跨軌那條路(`20260902030000` 修的那個) |
| 6 | 剩餘應收剛好等於已收 | 0 列 | 邊界 |

🔴 **期望值一律從【Q13 公式】推,不從我要寫的那行碼推。**
`3` 那一格特別寫成「0 列」而不是「一列 0 元」——
因為 `pcm_pending_refund_amounts` 今天就是**濾掉非正數**的(`20260902030000:90`),
而「一列 0 元」會讓 `order_pending_refunds` 長出一列**沒有人要付的待辦**。

🔬 **突變要先證明它落在目標上**:把 `剩餘應收` 那一項改成常數 0 ⇒ **第 2、3、6 格必須紅、第 1 格必須綠**。
🛑 **若第 1 格也紅了 ⇒ 那不是好消息,那代表我改壞了整單那條路。**

---

## §7 rollback

- 🔴 **`CREATE OR REPLACE` 沒有自動回頭路** —— 回滾 = **把改之前那份定義原樣再貼一次**。
  ⇒ 那份定義的取得方式寫進 migration 檔頭:`bash scripts/latest-definition-of.sh pcm_pending_refund_amounts`。
- ⚠️ **而回滾函式**不會**回滾它已經寫進 `order_pending_refunds` 的列**。
  ⇒ migration 要附一段「哪幾列是本次開的」的查法(用 `created_at` 區間 + `cancellation_id` 非 NULL),
  **不要**寫成一段 DELETE —— 刪錯的代價是一筆該退的錢消失。
- ✅ 新函式 `pcm_order_remaining_due` 是**裸 `CREATE`**(不是 OR REPLACE)⇒ 撞名當場紅
  (理由逐字在 `20260902030000:60-63`);回滾 = `DROP FUNCTION`。

---

## §8 誰審 · 要誰批

- **鐵則 12①(錢)+ ③(DB 結構)⇒ codex 對抗審查,不降級。** 先跑 `code-reviewer`,再叫 codex 審 diff。
- **鐵則 8**:動 schema ⇒ **Sean 批准才執行**。
- 📮 **而在那之前,§2 那個一字題要先有答案** —— 沒有它,函式本體算不出來。

---

## §9 我**沒有**做的(不要讀成已查)

1. **沒有**驗證 `剩餘應收` 在現行 schema 下逐筆算得準(那要真資料,而我只有唯讀查詢那條路)。
2. **沒有**去正式庫看今天有幾張單處於「部分取消 + 收過非卡的錢」——
   ⇒ 🔴 **所以我答不出這件事今天漏了多少錢。** 板列原本也沒查。
3. **沒有**看 `discount_total` 在部分取消之後該怎麼變 —— §2 只把運費那一半端出來,
   **折扣那一半我連問題都還沒寫得出來**(它取決於折扣是怎麼來的,而我沒查)。
   ⚠️ **這一格是已知缺口,不是我判斷它不重要。**
