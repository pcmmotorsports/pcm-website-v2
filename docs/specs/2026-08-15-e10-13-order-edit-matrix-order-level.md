# `#13` 改單「可改矩陣」— **片 0a:訂單層**(這張單能不能進編輯)

> **片型**:輕量片(純 docs、零 code、零 DB、不命中鐵則 8/12)。主視窗 2026-08-15 授權。
> **上游**:`docs/specs/2026-08-14-e10-13-order-edit-plan.md` §3 片 0 / §5 驗收條件。
> **作者**:A 窗 `void-readers`。**本檔每個 `檔案:行號` 都是我開檔查的,不是轉抄。**
> **下游**:片 0b(品項層四條地板)—— **本檔不回答「哪個欄位能不能改」,那是 0b。**

---

## §0 🔴 本檔什麼時候會過期(交件自帶,不等別人來問)

**這是一份盤點,而盤點的壽命等於它引用的那些東西不變的時間。** 逐條列出觸發重驗的事件:

| 觸發事件 | 為什麼會讓本檔變假 | 怎麼發現 |
|---|---|---|
| **收款軸長出第三值** | `order-status-axes.ts:22` 逐字「**不得寫死成兩值 —— Sean Q22=A:貨到付款(`cod`)是預留的第三值**」⇒ **2×4 會變 3×4**,本檔的 10 格變 14 格 | `grep -n "OrderPayAxis =" apps/admin/src/lib/orders/order-status-axes.ts` 值數變了 |
| **`orderPayAxis` 的收斂規則改** | 現行 `:145` 是 `paymentStatus === 'paid' ? 'paid' : 'unpaid'` ⇒ **五個 `payment_status` 被壓成兩邊**。規則一改,每一格的母體就變 | 同上檔 `:144-146` |
| **矩陣外狀態增減** | 現有兩個(已取消 `:50` / 已退款 `:60`)。`#494` 是 08-14 才加的第二個 ⇒ **這類會再長** | `grep -n "ORDER_STATUS_.*_LABEL" ` 數量變了 |
| **任何一格長出真正的系統保證** | 🔴 **本檔最重要的結論是「現在一格都沒有」**(§3)。一旦有人加了守門,那格的第 ③ 欄就必須改寫 | 見 §5 的複驗命令 |

⚠️ **本檔不會自己變紅。** 上面每一條都是「世界的狀態」,**改了不會有任何 diff 提醒你**
(判別句見 memory `feedback_status-file-fixed-fields-hide-stale-claims`)。
⇒ **引用本檔前先跑 §5 那三條命令。**

---

## §1 軸的定義(**現行**,不是舊 plan 那兩個)

🔴 **舊 plan §5-1 寫「`payment_status` × `fulfillment_status`」= 5×4 = 20 格 —— 那兩個軸已經不是決策軸。**
它寫於 2026-08-14,而 **08-13 就換過了**(`order-status-axes.ts:3` 逐字「**M-4b OD 訂單列表改版 L1(2026-08-13):狀態八值 = 收款軸 × 貨品軸**」)。
⚠️ **`fulfillment_status` 仍然存在、仍在兩處顯示**(`order-detail.tsx:368`、`customer-detail-sections.tsx:82`),
但 `order-filter-controls.tsx:46` 逐字「**原本叫 `ful`、篩的是 `fulfillment_status`**」⇒ **篩選已換軸。**
🔴 **「東西還在」是最會騙人的訊號** —— 它讓一份引用舊軸的文件讀起來完全正常。
(**未查**:`fulfillment_status` 還有沒有在寫入。**不宣稱它是死欄位。**)

### 1-1 收款軸(2 值,**設計上會長出第三值**)

`order-status-axes.ts:144-146` 實作逐字:
```ts
export function orderPayAxis(order: AdminOrderSummary): OrderPayAxis {
  return order.paymentStatus === 'paid' ? 'paid' : 'unpaid';
}
```
⇒ **五個 `payment_status` 的實際落點**(`database.types.ts` Enums 逐字):
| `payment_status` | 落在收款軸 | 備註 |
|---|---|---|
| `paid` | **paid** | |
| `unpaid` | unpaid | |
| `partiallyPaid` | **unpaid** | 🔴 見 §1-3 |
| `partiallyRefunded` | **unpaid** | `:181-182` 逐字「**刻意不走這條**…它是『退了一部分』= **還有錢沒結、還有事要做**…維持落在收款軸的 `unpaid` 那半」 |
| `refunded` | **矩陣外** | `orderStatusView` 第二判攔截,顯示「已退款」 |

### 1-2 貨品軸(4 階段,由**品項層彙總**到訂單層)

`order-status-axes.ts:161-168`:**該單所有品項都到齊才進下一階**(`every`),判序 `shipped ⊆ instock ⊆ ordered`
(`:151` 逐字「Sean 2026-08-05 拍板『出貨必先到貨、無直送』…**先問最遠的那個**才會答對」)。
⚠️ `:158` 空 `lines` 回 `none` 不是 `shipped`(`[].every()` 恆真)。

### 1-3 🔴 一個我要標出來、但**不在本片自行決定**的事

**收款軸把 `partiallyPaid` 壓進 `unpaid`。**
那對**顯示膠囊**是合理的(Sean 拍的八值就是這樣),
🔴 **但對「能不能改金額」不一定合理** —— 「**一毛都沒收**」與「**收了一部分、錢已經動過**」
在改金額這件事上是**兩種不同的風險**:後者改動會讓已收金額與訂單總額對不起來。

⇒ **本檔照授權用現行 2 值,但把這格標成待決**:
> **`Q-13-1`:改金額的可改矩陣,收款軸要用現行 2 值(跟畫面一致),還是要把 `partiallyPaid` 拆成第三種?**
> **這是 Sean 的對帳口徑題,不是技術選擇。片 1(改金額)開工前必須有答案。**

### ✅ 那句「正式庫零筆」——**2026-08-15 已實測,不再是繼承來的宣稱**

`order-status-axes.ts:183` 原本逐字寫著「正式庫目前零筆 `partiallyRefunded` / `partiallyPaid`」,
而該處同時自陳「**只讀 code 推得,沒有實例驗過**」⇒ 本檔第一版把它標成「未確認」。

**現在有實測了**(**2026-08-15 13:1x · 主視窗跑 · 正式庫唯讀 · 施工端無此授權**):
```sql
select payment_status, count(*) from public.orders group by 1;
⇒ unpaid 6 / paid 4 / refunded 3 / partiallyPaid 0 / partiallyRefunded 0   （總計 13 筆）
```
⇒ **零筆屬實。`Q-13-1` 維持「片 1 開工前要答」,不升級成「現在就要答」。**

🔴 **但這是快照,不是保證。** 那兩個 enum 值**存在且合法**,只是目前沒有資料落在上面 ——
**第一筆部分付款出現的那天,收款軸會把它壓進 `unpaid`,而本檔 §1-3 的疑慮當場成真,不會有任何東西紅。**
⚠️ 且**總數 13 筆**與 Sean 自述「訂單都是假的」一致 ⇒ **這是測試資料的分布,不是營運分布。**
**不得拿它推論「正式營運後也會是 0」。**

---

## §2 矩陣(10 格)· 現行**可改欄位**只有四個

**本檔的「可改欄位」母體 = 現行表單那四欄**(`order-edit-form.tsx`,全檔 102 行):
`出貨方式 :59` / `開票狀態 :69` / `發票號碼 :82` / `發票金額 :94`。
🔴 **`品項 / 數量 / 金額` 目前一個都不可編**(spec `2026-07-25-admin-backend-rebuild-spec.md:153` 逐字
「改訂單內容(品項/數量/金額)❌ 只能改出貨方式+發票」)⇒ **它們在本表一律標「尚未存在」,不是「鎖死」。**
**兩者差別很大**:鎖死 = 有東西擋;尚未存在 = 根本沒有那個入口。

| # | 收款軸 | 貨品軸 | ①可改 | ②鎖死 | ③鎖死時員工看到什麼 |
|---|---|---|---|---|---|
| 1 | unpaid | none | 四欄全可改 | **無** | — |
| 2 | unpaid | ordered | 四欄全可改 | **無** | — |
| 3 | unpaid | instock | 四欄全可改 | **無** | — |
| 4 | unpaid | **shipped** | 四欄全可改 | **無** | — 🔴 見 §3-2 |
| 5 | paid | none | 四欄全可改 | **無** | — |
| 6 | paid | ordered | 四欄全可改 | **無** | — |
| 7 | paid | instock | 四欄全可改 | **無** | — |
| 8 | paid | **shipped** | 四欄全可改 | **無** | — 🔴 見 §3-2 |
| 9 | **已取消**(矩陣外) | — | 四欄全可改 | **無** | — 🔴 見 §3-1 |
| 10 | **已退款**(矩陣外) | — | 四欄全可改 | **無** | — 🔴 見 §3-1 |

**⇒ 十格的第 ②③ 欄全部相同。這不是我偷懶,是實查的結果 —— 見 §3。**

---

## §3 🔴🔴 本檔最重要的結論:**訂單層目前一格系統保證都沒有**

### 3-1 已取消 / 已退款的單,改單表單照樣出現、照樣存得下去

| 層 | 有沒有擋 | 證據 |
|---|---|---|
| **UI** | ❌ **沒有** | `order-detail.tsx:448` 逐字 `<OrderEditForm detail={detail} returnTo={returnTo} />` —— **無任何條件包裹**(同檔其他區塊如退款是有旗標閘的,這個沒有) |
| **RPC** | ❌ **沒有** | `20260714130000_m4a_admin_update_order_workflow_rpc.sql` 全檔 `grep -n cancelled_at` = **0 命中**;它擋的 16 條 `RAISE EXCEPTION` 全是**欄位格式與白名單**(`:87`-`:192`)+ 樂觀鎖(`:96`),**沒有一條問「這張單還活著嗎」** |

⇒ **員工現在可以在一張已取消的單上改出貨方式、改發票號碼,而且會成功、會寫進稽核。**

⚠️ **這不一定是 bug** —— 已取消的單要作廢發票,**可能正需要改開票狀態**。
🔴 **但它現在是「沒有人決定過」,不是「決定了要開放」。** 兩者在畫面上長得一模一樣。
⇒ **`Q-13-2`:已取消 / 已退款的單,四欄各自該不該鎖?(發票欄可能要留、出貨方式可能該鎖)**

### 3-2 已出貨的單改「出貨方式」同樣無擋

`shipped` 那兩格(#4/#8)沒有任何東西阻止改 `shipping_method`,
而該單的包裹已經用舊的出貨方式送出去了 ⇒ **改完之後畫面與事實不符,且無訊號。**
⇒ **`Q-13-3`:已出貨之後,出貨方式該鎖、還是該保留可改(補登真實走的方式)?**

### 3-3 所以照舊 plan §5-3 的規定,這三格全部要明寫成「靠人守」

舊 plan §5-3 逐字要求:
> **每一條「鎖死」都要附它是被哪個具名 CHECK / 哪個業務規則擋的;找不到擋它的東西 ⇒ 那格其實是業務約定而非系統保證,必須明寫成「靠人守」。**

✅ **本檔照辦,而且結論比預期廣**:
🔴 **不是某幾格靠人守,是訂單層十格全部靠人守。目前沒有任何一條系統保證。**

---

## §4 🔴 稽核覆蓋(本片查到、與 0b 共用的硬約束)

現行改單 RPC **有**寫稽核(`20260714130000:223`,`action='order.workflow.update'`),
🔴 **但同檔 `:222` 註解逐字「before/after 僅本片 5 欄」** ——
`before`/`after` 是**手寫 `jsonb_build_object` 逐欄列舉**(`:228-237`):
`workflow_status` / `shipping_method` / `invoice_number` / `invoice_amount` / `invoice_status`。

⇒ **稽核覆蓋是「欄位級白名單」,不是「這一列改了什麼」。**
**片 1/2/3 每新增一個可編欄位,若沒同時改那兩個 `jsonb_build_object`,
它就不會進操作紀錄 —— 而且不會有任何東西紅。**

### 🔴 must(主視窗 2026-08-15 升級為 must,原提案來自本線)
> **每加一個可編欄位,必須有一格測試證明它出現在稽核的 `after` 裡。**
> **突變:把該欄從 `jsonb_build_object` 拿掉 ⇒ 該格紅。**

⚠️ **限度**:**我只查了這支 RPC。不宣稱全站稽核都是這個形狀**(可能另有 trigger 級的通用寫法,未查)。

---

## §5 複驗本檔的三條命令(**引用前先跑**)

🔴 **每條分開跑,不要用 `&&` 串** —— `grep -c` 命中 **0 時 exit 1**,串起來會把後面的命令一起吃掉。
**我自己第一版就是這樣寫的,跑下去只印出第一條就停了**(memory `reference_measure-tool-dialect-and-silence-traps`)。

```bash
cd /Users/sean_1/pcm-void-readers

# ① 收款軸還是 2 值嗎（長出 cod ⇒ 本檔 10 格作廢、變 14 格）
grep -nE "OrderPayAxis = " apps/admin/src/lib/orders/order-status-axes.ts

# ①b 貨品軸還是 4 值嗎 —— 🔴 它在 order-status-axes.ts 裡是 re-export（`export type { OrderGoodsAxis }`），
#     真權威在 domain。對著 admin 那支 grep 會零命中，而零命中會被讀成「軸不見了」。
grep -n "ORDER_GOODS_AXIS_VALUES" packages/domain/src/order/types.ts

# ② §3 的「零系統保證」還成立嗎（命中 > 0 ⇒ 有人加了守門，第 ②③ 欄要重寫）
grep -c "cancelled_at" supabase/migrations/20260714130000_m4a_admin_update_order_workflow_rpc.sql || true
grep -n "OrderEditForm" apps/admin/src/components/orders/order-detail.tsx

# ③ 可編欄位還是四個嗎（多一個 ⇒ §2 母體變，且要檢查 §4 的稽核白名單有沒有跟著加）
grep -cE "name=\{[A-Z_]+_FIELD\}" apps/admin/src/components/orders/order-edit-form.tsx || true
```

**2026-08-15 14:1x 實跑值(逐條分開跑,不是串的)**:
① `:22` `export type OrderPayAxis = 'unpaid' | 'paid'` = **2 值**
①b `packages/domain/src/order/types.ts:240` = **4 值**
② `cancelled_at` **0 命中**;`OrderEditForm` = `:18` import + **`:448` 無條件渲染**
③ **4**

---

## §6 待決項(**全部要 Sean,不是技術選擇**)

| 編號 | 題目 | 擋住哪一片 |
|---|---|---|
| `Q-13-1` | 改金額的收款軸要 2 值(同畫面)還是把 `partiallyPaid` 拆出來? | **片 1(改金額)** |
| `Q-13-2` | 已取消 / 已退款的單,四欄各自該不該鎖?(發票欄可能要留) | 片 0b 之後任一片 |
| `Q-13-3` | 已出貨之後,出貨方式該鎖還是該可改(補登真實走的方式)? | 同上 |

---

## §7 誠實缺口

1. 🔴 **§3「零系統保證」我只查了兩層(UI 條件 + RPC 內文)。**
   **沒查**:`orders` 表上有沒有 trigger / RLS 在擋。⇒ 結論的正確措辭是
   **「這兩層都沒擋」**,不是「全站沒擋」。
2. **`order-status-axes.ts:183` 那句「正式庫目前零筆 `partiallyPaid` / `partiallyRefunded`」是繼承來的,我複驗不了**(無正式庫連線)。
   ⇒ `Q-13-1` 的急迫度取決於它,而**我不知道它現在真不真**。
3. **§2 的「四欄全可改」是從「沒有東西擋」推的,不是實際送出一次改單看到成功。**
   ⇒ 若某層有我沒找到的擋法,表會變。**這是本檔最可能出錯的一格。**
4. **本檔不含品項層。** 舊 plan §2 那四條地板(`oiqs_*`)是**片 0b**,
   🔴 **而真正決定「哪個欄位能不能改」的是它們,不是本檔。**
   **只讀本檔會以為「反正都能改」—— 那是錯的。**
5. **`fulfillment_status` 是否仍在寫入,未查**(§1)。
