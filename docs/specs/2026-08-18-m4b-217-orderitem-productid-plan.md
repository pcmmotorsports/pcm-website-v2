# `#217` plan · `OrderItem.productId` 重建不出來 —— **而它現在沒有呼叫端**

> **狀態:2026-08-18 19:0x 由 G2 寫,【尚未批准】。** 本檔只涵蓋 **domain / adapter 那半**;
> `#240`(會員訂單詳情頁)的落點在 `apps/storefront` = **G3 的線,本檔不主張、也不動他的檔**。
> 條目正本 `docs/phase-1-backlog.md` 的 `#217`(2026-06-05 立)。

## 1. 前提複驗(條目是 6 月立的,今天逐項開檔量過)

```
packages/domain/src/order/types.ts        OrderItem.productId **仍是必填**（ProductId，非 optional）
supabase/migrations/*.sql                 order_items **仍然沒有 product_id 欄**
   數法 /usr/bin/grep -rn "product_id" supabase/migrations/*.sql | /usr/bin/grep -i order_items ⇒ 零命中
packages/adapters/.../SupabaseOrderAdapter.ts  findById 仍是 deferred-stub（throw，理由字面指向 #217）
```
⇒ **條目描述的病仍然成立,沒有人偷偷解掉。**

## 2. 🔴 而條目沒說的那一件:**這兩支方法沒有活的呼叫端**

```
第一把尺  /usr/bin/grep -rn "findById\|listByCustomer" --include="*.ts" --include="*.tsx" packages apps
          排除 *.test.*、排除 SupabaseOrderAdapter.ts 自己
          ⇒ 命中全部是【別的 repository】（vehicle / address / product / customer）
             與 IOrderRepository.ts 自己的宣告與註解。**訂單那兩支零呼叫端。**
第二把尺  /usr/bin/grep -rn "getOrderRepo\|orderRepo" …
          ⇒ 活路徑用的是 listSummariesByCustomer（會員訂單清單）/ findTotal / placeOrder
第三個來源 SupabaseOrderAdapter.ts 自己的 docstring 逐字:
          「`IOrderRepository` 呼叫的是 `listSummariesByCustomer` / `findTotal` / `placeOrder` 三支」
```
⇒ **三把尺同向。** `#217` 不是一個「擋著誰」的缺陷,是一個**還沒有人需要的重建能力**。

## 3. 選項(條目原有三案 + 一案 **本檔新增**)

```
A  domain OrderItem.productId 改 optional / 移除          （條目「傾向 A」）
B  order_items 加 product_id 欄 + RPC 一併寫             （動 schema ⇒ 鐵則 12 ③）
C  讀路徑 join product_variants 回推                      （variant_id 是 ON DELETE SET NULL ⇒ 不可靠）
D  **不動 domain,詳情頁走自己的唯讀投影**（本檔新增）      ← 推薦
```

### 為什麼推薦 D:**這個 repo 已經用 D 解過同一題兩次**

```
OrderListItem          會員訂單【清單】的唯讀投影 —— docstring 逐字「繞過 #217」
AdminOrderDetailItem   後台訂單【明細】的唯讀投影 —— **它沒有 productId，而後台明細頁一直是好的**
```
⇒ 後台明細頁證明了:**要畫一張訂單明細,不需要 `OrderItem.productId`。**
   缺的東西(品名 / 料號 / 規格 / 數量 / 金額)全部在 `order_items` 的快照欄裡。

### A 的成本比它看起來高

`packages/domain/src/order/order.ts` 的 `createOrderItem` 有一道 **typeof loud-reject**:
`productId` 必須是非空字串,否則 `throw OrderError('invalid_snapshot')`
(封 `new String()` wrapper 那一族;數法 `/usr/bin/grep -n "item.productId" packages/domain/src/order/order.ts`)。
⇒ **A 是為了一條沒有呼叫端的讀路徑,去弱化一道還在用的寫路徑守門。**
   改成 optional 之後,`undefined` 在寫入端會變成合法值,而**寫入端是有真流量的那一條**。

## 4. 若採 D,要動什麼(**很小**)

```
① packages/ports/src/IOrderRepository.ts
   findById / listByCustomer 的 docstring 從「待 #217」改成
   「刻意不提供:訂單明細走唯讀投影（同 OrderListItem / AdminOrderDetail）」
   —— 🔴 兩支 **stub 保留、不刪**（刪 port 方法是介面異動，範圍更大；而留著零成本）
② packages/domain/src/order/types.ts:167 那段「明細頁未來 slice 才需完整 Order + 解 #217」
   ⇒ 那句話在 D 之下是**假的**，要同一顆改掉（它現在正在指揮下一個人去解 #217）
③ #240 真的要做時，由做的人（G3 的線）新增一個會員側明細投影型別 + adapter 讀法
   —— 本檔不設計它，只主張「不必先解 #217」
```
**零 migration、零 schema、零 RPC、零資料寫入。**

## 5. 驗收(若採 D)

```
① typecheck / lint / build / vitest 四綠（本片只動 .ts 註解與型別 docstring ⇒ 預期零行為改變）
② 「解 #217 才能做明細頁」這個說法在 repo 內零殘留
   數法 /usr/bin/grep -rn "#217" --include="*.ts" --include="*.tsx" --include="*.md" packages apps docs
   ⇒ 逐處看，凡是「必須先解」語氣的都要改成 D 的說法（backlog 條目本身保留歷史，改狀態列）
③ 寫路徑那道 typeof 守門【原封不動】—— 這是 D 相對 A 的全部價值，要有一格釘住它沒被鬆掉
```

## 6. 風險

```
· D 的風險是【未來真的需要 domain Order 時要再回來】—— 而那一天若真的來了，B（加欄）才是對的解，
  不是 A。⚠️ 這句話要寫進 port 的 docstring，否則下一個人會重新走一次 A。
· A 的風險已在 §3 說明（弱化寫路徑守門）。
· B 的風險：動已簽核的 S2-a migration + create_order RPC ⇒ 鐵則 12 ③，而**目前沒有需求推動它**。
· C 已被條目自己否掉（ON DELETE SET NULL ⇒ 歷史訂單會指向已刪變體或 NULL）。
```

## 7. 這份 plan **沒有**主張什麼

```
· 沒有主張 #240 該怎麼做 —— 那是 storefront（G3 的線），本檔只說「不必先解 #217」
· 沒有量過「未來會不會有人需要 domain Order」—— 那是預測，不是量測
· §2 的「零呼叫端」是三把尺同向的結果，而三把都是【字面】尺：
  若有人透過完全動態的方式取用（例如字串索引 repo 方法），這三把都看不到 —— **未確認**
```
