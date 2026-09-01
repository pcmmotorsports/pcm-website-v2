# 0 元訂單 —— 讓它成立(而觸發條件是券片 3b 自己打開的)

> **本片讓「全額券 + 門市取貨」的客人結得了帳。**
> 在 3b 之前券結帳被 3a 封住 ⇒ 0 元單建不出來;3b 解除封鎖 ⇒ **那條路今天通了**,
> 而客人會撞到「付款失敗,請稍後再試」——**而再試一百次都不會成功。**
>
> 🔵 上一代那句錯誤訊息**自己預告過本片**(`20260825130000:374` 逐字):
> 「若這是合法的 0 元單(全額折價券/儲值金),**本閘需重議**」
> ⇒ **前人寫下了觸發條件,而它今天到了。**
>
> · 片型 = **高風險片**(鐵則 12 ①錢)⇒ 全 9 步、codex 不降級、三輪(codex ×2 + Fable 換角度)。
> · 命中鐵則 8(動 RPC + 跨 3 檔)⇒ **plan 交主視窗批准才動手。**
> · 拍板:Sean 2026-09-01 對「0 元單成不成立」答「都可以,看你建議」⇒ 主視窗 `-24` 裁【讓它成立】。
>   ⚠️ **Sean 本人沒有看過本 plan。** 他授權的是方向,不是做法。

---

## 0. 🔴 分母:誰有能力擋下一張 0 元單(先量,不假設只有一道)

> 判別句照 3b 那條:**我的分母由「我要改哪一道」決定,而 bug 的分母由「有幾道會擋」決定。**

| # | 落點 | 它在做什麼 | 本片要不要動 |
|---|---|---|---|
| ① | `20260825130000:373` `create_order` `IF v_total <= 0 THEN RAISE` | **建單就擋** | 🔴 **要放寬** |
| ② | `20260810160000:435` `confirm_order_payment`(card 腿) `IF v_order.total <= 0` | 翻 paid 前擋 | 🛑 **不動**(見下) |
| ③ | `20260810170000:423` 同上,另一代 | 同上 | 🛑 **不動** |
| ④ | `order_payments.amount` `CHECK (amount <> 0)`(`20260810100000`) | **0 元的收款列寫不進去** | 🛑 **不動** |

🔴 **②③④ 是同一個根**。②③ 的註解逐字寫著它們為什麼在:
> 「total=0 且 p_amount=0 時上面的相等檢查**會過**,然後 card 腿撞
> `order_payments.amount CHECK (amount <> 0)` ⇒ 噴 **raw 23514**,PG 的 DETAIL 會把**整列值**帶出來
> (繞過 PF-E 的不洩內部狀態),而 app 層又把非 P0001 標成「可重試」。」

⇒ 📌 **②③ 不是「擋 0 元單」的閘,是「不要讓 0 元撞出一個會洩漏的 raw 錯誤」的閘。**
⇒ **⇒ 所以本片【不碰它們】** —— 0 元單本來就不該走刷卡腿。動它們等於把那個洩漏路徑打開。

⚠️ **TS 層**:我掃了 `apps` + `packages` 的 `total <= 0 / === 0 / zeroTotal`,
命中的都是分頁與 UI 顯示,**沒有一處是結帳的 0 元閘**
(🟢 正對照 同範圍 `total` 任何 ⇒ 1255 命中;🔵 負對照 `zzqtotal901` ⇒ 0)。
⇒ **擋 0 元單的只有 DB 那一層。**

---

## 1. 做法(我推甲)

### 🔴 為什麼不能沿用 `confirm_order_payment`
它會寫一列 `order_payments`,而 `amount` 有 `CHECK (amount <> 0)` ⇒ **0 元的那一列物理上寫不進去。**

### 甲(推薦):新開一支只給 0 元單用的結清 RPC
```
public.settle_zero_total_order(p_order_id uuid) RETURNS jsonb
  · 驗 total = 0(不是 <= 0 —— 負數是別的 bug,要吵)
  · 驗 payment_status = 'unpaid'、cancelled_at IS NULL
  · UPDATE orders SET payment_status='paid', paid_at=now(), payment_method='zero_total'
  · 🔴 **不寫任何 order_payments 列** —— 而不變式仍然成立:
    「已收 = SUM(amount)」⇒ 0 列的 SUM 是 0 ⇒ **等於 total 0** ✅
  · 冪等:已經 paid 且 total=0 ⇒ 回 {confirmed:true, idempotent:true},不重寫
```
✅ 它會觸發 3b 那支 `trg_coupon_redeem_on_paid`(掛在 `unpaid⇒paid` 上)⇒ **券照樣被扣。**
🛑 **而「應該會觸發」不算 —— 驗收要兩個世界各餵一發**(見 §3-④)。

### 乙:放寬 `order_payments.amount` 允許 0,走既有 `confirm_order_payment`
🔴 **不推**:那條 CHECK 撐著「已收 = SUM(amount)」這個不變式,而 `20260810100000` 整支檔在講它。
放寬它 = 動一條全站對帳都依賴的約束,爆炸半徑遠大於本片。

---

## 1b. ✅ 三格已答(2026-09-01)

> 下面 §2 的原文**一字不刪** —— 下一個人要看得出當時在猶豫什麼。

### ✅ Q1 0 元單能不能退款 ⇒ **不能退,只能取消**(主視窗裁,照我推的)
主視窗的理由(逐字):退 0 元沒有金額可退,而**它不是「退款失敗」,是「這個動作對這張單沒有意義」**。
🔴 **而那要在 UI 上說得出來 —— 不是把鈕藏起來,是按了要有一句話。**
   ⇒ 藏起來的話,員工會以為系統壞了,然後去找別的路把它退掉。
🛑 「取消要不要把券還回去」⇒ **獨立一片,不塞進來。**
   `coupon_redemptions.reverted_at` 那一欄**今天全站零寫入** ⇒ **它現在是死的**。已請主視窗開一列。

### ✅ Q2 結帳鈕文案 ⇒ **我決定**(主視窗授權;Sean 逐字「你們先直接幫我決策」)
現況 `apps/storefront/src/components/CheckoutStep2.tsx:329`:
`{submitting ? '處理中…' : <>確認付款 NT$ {total.toLocaleString()} <span>→</span></>}`
⇒ **0 元時它是一顆說謊的鈕** —— 它寫「付款」而它不會付款。

判準:**那顆鈕要說出它會做什麼**,而形狀照現有的 `<動詞> NT$ <金額> →`。

| | 候選 | 好處 | 代價 |
|---|---|---|---|
| **甲(採用)** | `確認訂單 NT$ 0 →` | 形狀不動、只換動詞;`NT$ 0` 是有意義的資訊(客人看得到券生效了) | 有人可能覺得「NT$ 0」像壞掉 |
| 乙 | `完成訂單(免付款)→` | 明說沒有付款這一步 | 拿掉金額,與其餘金額都在畫面上的慣例不一致 |

⇒ **採甲。** 金額本來就在旁邊明細裡(折扣列會寫出券折了多少)⇒ 不會有人以為壞掉。

### ✅ Q3 payment_method ⇒ 碼裡 `'zero_total'`,**顯示層翻中文**
主視窗逐字:「代碼是給機器的、顯示是給人的 —— 把它們合成一個,兩邊都會被將就。」
✅ 而那張對照表**找到了**:`apps/storefront/src/lib/orders/order-display.ts:190`
`const PAYMENT_METHOD_LABEL: Readonly<Record<string, string>> = { tappay: '信用卡' };`
⇒ 加一筆 `zero_total: '全額折抵'`。**未知值原樣印出** ⇒ 不加的話客人會看到 `zero_total`。

🛑 **而後台【沒有】這一軸的對照表** —— `apps/admin` 找 `paymentMethodLabel` ⇒ **0 命中**。
它有的是 `PAYMENT_CHANNEL_LABEL`(`order-list-view.ts:261`),而那是**另一軸**
(`order-display.ts:168-171` 逐字寫著兩軸不能互搬)。
⇒ 📌 **後台員工會看到 `zero_total` 這個代碼。**而那不是本片造成的 —— `tappay` 今天也是這樣。
⇒ **已報主視窗,不順手做。**

---

## 2. 🔴 Sean / 主視窗要答的三格(我不先假設)

```
Q1 0 元單能不能【退款】?
   退 0 元沒有意義,而券已經被扣掉了。
   甲 不能退,只能取消(而取消要不要把券還回去 —— coupon_redemptions.reverted_at 那欄存在但沒人寫)
   乙 能退,而退的是 0 ⇒ 等於只改狀態
   ⇒ 我推甲。而【券還不還】那一格今天全站沒有任何路徑在寫 reverted_at ⇒ 那是另一片。
Q2 0 元的結帳頁,那顆鈕該寫什麼?
   現在是「付款」。0 元時寫「確認訂單」?「完成訂單」?
   ⇒ 這是文案 = Sean 拍板題。而我會先照 OD 稿的字面慣例出兩個候選,不自己定。
Q3 payment_method 寫什麼?
   我提 'zero_total'。而那個值會出現在後台訂單列與報表上 ⇒ 員工看得懂嗎?
   ⇒ 候選:'zero_total' / '全額折抵' / 留 NULL。我推第一個(對齊既有 'tappay' 都是英文代碼)。
```

---

## 3. 驗收(每格都要兩個世界)

```
① total=0 的單【建得出來】(放寬 ①之後)
   🟢 正對照 total<0 仍然要炸(那是別的 bug,不能一起放行)
② 那張單走 settle_zero_total_order ⇒ payment_status='paid'
   🔵 負對照 total>0 的單餵給它 ⇒ 必須被拒(它只給 0 元單用)
③ order_payments 零列,而「已收 = SUM(amount) = 0 = total」成立
④ 🔴 券真的被扣:0 元單(全額券)結清後 coupon_redemptions 多一列
   🔵 負對照 沒帶券的 0 元單 ⇒ 不寫 redemption
   📌 這一格是主視窗點名的 —— **「trigger 應該會觸發」不算,要餵。**
⑤ 冪等:同一張單呼叫兩次 ⇒ 第二次回 idempotent,order_payments 仍零列
⑥ 🔵 刷卡腿那兩道閘【沒有被我動到】:total=0 的單餵給 confirm_order_payment ⇒ 仍然被擋
   ⇒ 證明我開的是新路,不是把舊路的防護拆了
⑦ 三綠 + 我餵幾條 vs 它跑幾支
```

---

## 4. 會動哪些檔(要發給哨兵的那一句)

```
supabase/migrations/2026090103XXXX_m4b_zero_total_settle.sql   (新;放寬①+ 新 RPC + REVOKE/GRANT)
apps/storefront/src/app/checkout/charge-actions.ts             (0 元 ⇒ 走新路,不叫 TapPay)
apps/storefront/src/components/…(結帳鈕文案)                  (等 Q2 答案)
docs/plans/2026-09-01-zero-total-order-plan.md                 (本檔)
```
⚠️ `charge-actions.ts` 657 行、是結帳唯一入口 ⇒ **動它要特別小心**,而它不是共用元件(不命中鐵則 12⑥)。

---

## 5. 不做什麼

```
· 不動 order_payments 的 CHECK(見 §1-乙)
· 不動刷卡腿那兩道 total<=0 閘(它們防的是洩漏,不是 0 元單)
· 不做「券退回去」(reverted_at 今天全站零寫入 ⇒ 那是獨立一片)
· 不做儲值金結清 —— 那句錯誤訊息同時點名「全額折價券/儲值金」,而儲值金那條路今天不存在
  🔵 而本片的 RPC 命名刻意叫 settle_zero_total_order(不叫 settle_coupon_order)
    ⇒ 儲值金那天走同一支,不用再開一支
```
