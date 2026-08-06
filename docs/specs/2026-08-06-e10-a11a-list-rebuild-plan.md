# A11a 訂單列表重建 plan(13 欄骨架 + rowSpan 分組重算)

> **狀態**:草案 v1(2026-08-06 夜跑,E 窗第二棒起草;**零實作**)。關卡1 審查留白天。
> **派工**:`E-106-A`(「A11a 的 plan 是整條退場鏈的解鎖點」)。
> **基準**:`dev` = `f8ede20`;本檔所有 `檔案:行號` 皆於該基準親查,不引用記憶。
> **欄位清單唯一權威**:母 plan `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md` §5.1a(`:518-549`)。
> **附件證據**:`docs/reviews/2026-08-06-nine-code-final-scan-and-a11-recon.md`(九碼終掃 + 列表側逐行盤點)。

---

## §0 這份 plan 最重要的一句話

**A11a 照母 plan 字面「13 欄骨架」直接開工會做不完,因為 13 欄裡有 3 欄目前沒有資料源** ——
「訂貨」要 A9c(未做)、「發票」的欄位不在列表投影(**查無任何片認領**)、「出貨」的資料表在第 2 批。
⇒ 本 plan 的主要產出不是「怎麼刻表格」,而是**把 A11a 拆成「不吃新資料的骨架」與「吃新資料的三欄」兩段**,
讓前段今天就能動、後段掛在明確的前置上,而不是開工才發現卡住(那正是 A9w4a 這次踩到的形狀)。

---

## §1 現況與不變量

### 1.1 現行列表(13 欄,`apps/admin/src/components/orders/orders-table.tsx:188-200`)

訂單編號 / 日期 / 商品品牌 / 料號 / 物品名稱 / 年份廠牌車種 / 數量 / 單價 / 總金額 / 會員等級 /
客戶名稱 / 商品狀態 / 來源 · 管道

### 1.2 目標(§5.1a `:521` 逐字,13 欄)

訂單編號(含付款軸小字)/ 日期 / 品牌 / 料號 / 品名 / **年份廠牌車種** / 數量 / 金額 /
客戶(含等級小字)/ **訂貨** / **出貨** / **發票** / **操作**

欄數不變(13 → 13):移除 4(單價與總金額合併為 1、會員等級併入客戶格、商品狀態、來源 · 管道)、
新增 4(訂貨、出貨、發票、操作)。

### 1.3 不變量(動了就是 bug,每條都要有守門)

| # | 不變量 | 依據 | 現行實作 |
|---|---|---|---|
| I1 | **分頁單位 = 訂單、不是品項** | 母 plan `:734`(「改成品項分頁會拆散 rowSpan 群組」) | `ORDERS_PAGE_SIZE = 20`,`apps/admin/src/lib/orders/order-list-view.ts:27` |
| I2 | **篩完必須重新分組並重算 rowSpan**;禁止對既有 DOM 用 CSS/JS 隱藏列 | 母 plan `:729` | `orders-table.tsx:66-67`(`rows = order.lines`、`rowSpan = rows.length`) |
| I3 | **彙總的資料來源必須是完整品項集合**(用篩選後投影算彙總 = 錯) | 母 plan `:731-732` | 九碼彙總 badge 隨本片退場;新的三軸彙總同受本條約束 |
| I4 | 空 `lines` 兜一列佔位、不得整單消失 | 現行防禦 | `orders-table.tsx:66` |
| I5 | **不套 `<AdminDataTable>`** | 母 plan §7.3 `:736-739` | 批次選取直接做在 `orders-table`(A12a) |
| I6 | 經銷價紅線:tier + 成交價同列僅 admin server-render 消費 | `packages/domain/src/order/types.ts` `AdminOrderSummary.tierAtCheckout` 註解 | 現行為 server component |

### 1.4 九碼面現況(本片要拆掉的東西)

逐行盤點見附件 `docs/reviews/2026-08-06-nine-code-final-scan-and-a11-recon.md` §②。摘要:
`orders-table.tsx` 的九碼分三群(整單彙總 badge `:10-15,35-48,89-91` / per-item cell `:14,53-61,129-136,199` /
表層 props 與衍生 `:155-168,180-181,207-209`),`app/orders/page.tsx` 四處(`:46,56,65,89-91`)。

🔴 **`itemStatusFiltered` 自 A9w2 起恆為 false**(唯一 producer 九碼篩選已下架;`orders-table.tsx:161-168`
的 JSDoc 已標)⇒ `:89` 的 `!itemStatusFiltered` 恆真。**重建時不得把它當還活著的條件搬過去。**

---

## §2 🔴 資料源盤點:13 欄逐欄來源(全部親查於 `f8ede20`)

投影權威 = `packages/adapters/src/supabase/SupabaseOrderAdapter.ts:70-71`(`ADMIN_ORDER_LIST_SELECT`);
型別權威 = `packages/domain/src/order/types.ts` 的 `AdminOrderSummary` / `AdminOrderLine`。

| # | 欄 | 層 | 資料來源 | 現況 |
|---|---|---|---|---|
| 1 | 訂單編號 | 訂單 | `AdminOrderSummary.displayId`;現行渲染 `orders-table.tsx:78-80` | ✅ 有 |
| 1b | └ 付款軸小字 | 訂單 | `AdminOrderSummary.paymentStatus` + `PAYMENT_STATUS_LABEL`(`order-list-view.ts`) | ✅ 有(需新渲染) |
| 2 | 日期 | 訂單 | `createdAt`;現行 `formatOrderDate`(`order-list-view.ts`)回 `YYYY-MM-DD` | ⚠️ **格式要改**(§5.1a `:539`:`07/25`、跨年才補年份) |
| 3 | 品牌 | 品項 | `AdminOrderLine.brand`;`orders-table.tsx:102` | ✅ 有 |
| 4 | 料號 | 品項 | `variantSku`;`:103` | ✅ 有 |
| 5 | 品名 | 品項 | `title`;`:104` | ✅ 有 |
| 6 | 年份廠牌車種 | 品項 | `vehicle` + `formatOrderItemVehicle`;`:106-107` | ✅ 有(§5.1a `:536` 明文保留) |
| 7 | 數量 | 品項 | `quantity`;`:109` | ✅ 有 |
| 8 | 金額 | 品項/訂單 | `unitPrice` / `lineTotal` / `AdminOrderSummary.total`;`:110-115` | ✅ 有(需合併規則,見 §2.1) |
| 9 | 客戶(含等級小字) | 訂單 | `customerName` + `tierAtCheckout` + `MEMBER_TIER_LABEL`;`:118-123` | ✅ 有(兩欄併一格) |
| 10 | **訂貨** | 品項 | `order_item_quantity_summary` 的 `ordered_quantity`/`quantity` | 🔴 **無** —— 不在列表投影;**前置 = A9c**(母 plan `:411` row 40) |
| 11 | **出貨** | 品項 | `shipments` / `shipment_items` | 🔴 **無** —— 第 2 批才建表(母 plan §5.2);A11b `:431` 定「唯讀灰」 |
| 12 | **發票** | 訂單 | `orders.invoice` / `invoice_status`(明細投影有:`SupabaseOrderAdapter.ts` 的 `ADMIN_ORDER_DETAIL_SELECT`) | 🔴 **無** —— **不在列表投影,且查無任何片認領**(見 §2.2) |
| 13 | **操作** | 訂單 | 取消入口 = A13a/A13b(母 plan `:436-437` rows 65-66);檢視入口 = 現行單號連結 | ⚠️ **半有**(取消動作在 A11a 之後才存在) |

### 2.1 金額合併規則(§5.1a `:532` 逐字,含一條 v1 寫錯已更正的半條)

> 「品項列 >1 **或** 任一列 `quantity` >1 就在合併格顯示整單總額」

🔴 v1 只寫了 `quantity > 1` 那半條,會讓**多品項單看不到總額**。本 plan 依更正後的完整條件施工。

### 2.2 🔴 發票欄沒有主(本 plan 發現的缺口)

§5.1a `:537` 逐字:「新增 | 發票 | 三軸之外的收尾軸(**A11a 前置 = 既有 `pending_invoices` 四欄已在明細頁**);
列表只顯示載具別與開立與否」。

親查結果:那句「前置已滿足」講的是**明細頁**已經有這些欄,但 **`ADMIN_ORDER_LIST_SELECT` 不含任何 invoice 欄**
(`SupabaseOrderAdapter.ts:70-71` 全字面比對)。母 plan 全檔 grep `A9c` 只授權「**三軸**欄位進
`ADMIN_ORDER_LIST_SELECT`」(`:411` row 40),沒有一片寫「invoice 進列表投影」。
⇒ **這是計畫的缺口,不是我看漏**。處置見 §6 決策題 Q2。

### 2.3 A9c 未做的實證(不是推測)

- `ADMIN_ORDER_LIST_SELECT`(`SupabaseOrderAdapter.ts:70-71`)無 `order_item_quantity_summary`。
- 守門測試 `packages/adapters/src/supabase/SupabaseOrderAdapter.test.ts:726` 標題逐字
  「🟡 三軸數量摘要:admin 列表投影目前也零滲入(**A9c 會合法解禁本條**)」,`:727` 註解逐字
  「A9c 開工時把這條改掉是**預期內**的」⇒ 該測試就是 A9c 的落地訊號,現在仍綠 = A9c 未做。
- A9c 的契約約束(母 plan `:314` 計數器摘要列)對 A11a **有直接約束力**:
  「A9c 🔴 必須用 PostgREST nested left embed …缺列會回 `null`,由 **mapper 在 TS 層正規化成三個 0**」、
  「**A11a-c 🔴 只接非 nullable 型別**(正規化在 A9c 的 mapper 完成,UI 片**不做 join、不做 COALESCE**)」。
  ⇒ **A11a 不得自己寫 `?? 0`**;拿到 nullable 就是 A9c 沒做完,退回 A9c。

---

## §2.5 27 項驗收表的連動(E-106-A ③ 指定;含一個**能力退步窗口**)

驗收唯一標準 = `docs/specs/2026-07-25-admin-backend-rebuild-spec.md` §1 的 27 項(母 plan `:5`)。

### 本線的直接貢獻(照母 plan 片表逐格,不灌水)

| 片 | 27 項欄位 | 依據 |
|---|---|---|
| A11a | **—**(無直接綠燈) | 母 plan `:430` row 59 |
| A11b | **—** | `:431` row 60 |
| A11c | **1(部分)**(看今天要處理什麼) | `:432` row 61 |
| A12a | — | `:434` row 63 |
| A12b | **4(部分綠:僅訂貨面)** | `:435` row 64 |
| A13b | **19(部分綠:未付款取消閉環)** | `:437` row 66 |

⇒ **A11a 本身對 27 項是 0 格**;它的價值是**解鎖**:①九碼退場鏈的最後一個消費端(§4)
②A12a/A12b(批次)與 A13a/A13b(取消)都要有新版列表才掛得上入口。
**回報時不得把 A11a 講成「讓第 N 項變綠」** —— 它不會。

### 🔴 能力退步窗口(必須讓 Sean 知道,不是技術細節)

27 項第 4 項「標商品進度」的**現況證據行逐字**是
`docs/specs/2026-07-25-admin-backend-rebuild-spec.md:90`:「⚠️ 逐列下拉、無批次 | `item-workflow-status-cell.tsx`」
—— 也就是說,**第 4 項現在唯一的入口就是列表上那顆九碼下拉**(明細頁那顆已於 A9w1 下架)。

⇒ **A11a-1 一落地,第 4 項就從 ⚠️ 掉到 ❌(完全沒有入口)**,直到 A12b(批次標記訂貨)上線才回到
「4(部分綠)」。中間這段時間員工**沒有任何地方可以標商品進度**。

誠實補充(避免把話講得比事實嚴重):新模型下「商品進度」的實質能力由**訂貨軸**承接,而
A10b(明細頁逐品項採購表單,母 plan `:428` row 57 標 27 項 **5, 6, 7**)**已經上線**
⇒ 員工仍可在**明細頁**逐品項記採購與到貨,只是**列表上的快速標記**與**批次**在 A12b 之前不存在。

**這是產品可見的退步,不屬施工端可拍板範圍** ⇒ 列為決策題 **Q7**(見 §6)。
另:第 4 項的證據行在 A11a-1 後會過期,**需同批更新 27 項表**(否則字面 vs 事實偏離)。

## §3 片拆(每片 15-45 分鐘、可中斷、可肉眼驗)

> 命名沿用 `A11a-N`,不新增母 plan 片號(片號是母 plan 的權威,拆子片屬施工細節)。
> 片型判準見 `CLAUDE.md`「片型分級」;L 級見鐵則 9。

| 子片 | 內容 | 片型 | L 級 | 前置 | 估時 |
|---|---|---|---|---|---|
| **A11a-1** | **九碼三群下架 + 欄骨架收斂**:拆掉整單彙總 badge、per-item cell、表層 props 與衍生;移除「來源 · 管道」欄;單價+總金額 → 「金額」(含 §2.1 合併規則);會員等級併入客戶格小字。**不新增任何吃新資料的欄** | 標準片(動 `app/orders/page.tsx` 與 `orders-table.tsx` 兩檔) | L1 | 無 | 35-45 分 |
| **A11a-2** | **訂單編號付款軸小字 + 日期格式**(`07/25`、跨年補 `2025/06/27`);`formatOrderDate` 改寫或新增 `formatOrderListDate`(**不動明細頁既有用法**,先 grep 消費端) | 輕量片 | L1 | A11a-1 | 15-25 分 |
| **A11a-3** | **操作欄**:檢視入口(既有單號連結搬進操作欄或並存,見 Q4)+ 取消入口**佔位**(A13 未到前顯示停用態或不顯示,見 Q5) | 輕量片 | L1 | A11a-1 | 15-25 分 |
| **A11a-4** | **訂貨欄接線**(消費 A9c 的非 nullable 三軸型別;第 1 批只顯示 `n/m` 文字,膠囊樣式屬 A11b) | 標準片 | L1 | 🔴 **A9c** | 25-35 分 |
| **A11a-5** | **發票欄接線** | 標準片 | L1 | 🔴 **發票欄投影加法(無主,Q2)** | 25-35 分 |
| **A11a-6** | **出貨欄佔位**(第 1 批無資料源:唯讀灰、明示「第 2 批」;**不畫假資料**) | 輕量片 | L1 | 無(但需 Q3 裁定畫法) | 15 分 |

**A11a-1 到 A11a-3 今天就能開工**(零新資料源);**A11a-4/-5 卡前置**;**A11a-6 卡產品裁定**。

### 3.1 A11a-1 會製造哪些孤兒(**同片清掉,不要留給別人**)

拆掉列表九碼三群之後,下列符號**當場零 consumer**。它們是**顯示層**、不屬 A9w4c(那片管 writer 契約)
⇒ **由 A11a-1 同片具名移除**,否則會變成第四批「無主死碼」(#332 已經收過三筆,不要再製造)。

| 孤兒 | 位置 | 備註 |
|---|---|---|
| `workflowStatusBadge` / `WorkflowStatusBadgeView` | `apps/admin/src/lib/orders/order-list-view.ts` | 連同其單元測試 |
| `summarizeOrderItemWorkflow` / `OrderWorkflowSummary` | 同上 | 連同其單元測試 |
| `indexOrderStatusOptions` | 同上 | ⚠️ **先 grep**:若 A11a-4 的訂貨欄或別處仍要用狀態詞彙索引,則保留 |
| `WorkflowStatusBadge` 元件 | `apps/admin/src/components/orders/workflow-status-badge.tsx` | 整檔刪 |
| `statusOptions` / `listOrderStatusOptions` 讀取鏈 | `app/orders/page.tsx:46,56,65,89-91`;port/adapter | ⚠️ **A11a-4 的訂貨欄若不需要狀態詞彙**才可一起收;不確定就留到 A11a-4 收工再判 |

🔴 **`item-workflow-status-cell.tsx` / `workflow-status-select.tsx` / `workflow-select-options.ts` 不在本表** ——
它們是 **writer 鏈**的一部分(cell 內含 `<form action={updateOrderItemWorkflowAction}>`),
歸 A9w4a / A9w4c 後半;A11a-1 只解除引用、不刪那三個檔。

🔴 **不建議把 A11a-1 再拆小**:鐵則 5「CSS + TSX 同元件單一 slice」,而九碼三群與欄骨架在同一個
`orders-table.tsx` 的同一張表裡,拆開會出現「中間態的表格欄數對不上表頭」的不可肉眼驗狀態。
若實作時超過 45 分鐘,正確的切法是**先只做九碼三群下架(表頭同步移除商品狀態欄)**、
再做欄合併,兩者各自都是「表頭與 `<td>` 數一致」的可驗狀態。

---

## §4 九碼退場收尾序(A11a 之後怎麼把鏈接回去)

E 線第一棒已落地 A9w1/A9w2/A9w3/A9w4b/A9w4c 前半(`f8ede20`)。剩餘鏈:

```
A11a-1(九碼三群下架 = 列表最後一個九碼消費端消失)
   ↓  ← 🔴 這一刻起 `updateOrderItemWorkflowAction` 零 UI 呼叫端
A9w4a(item writer 拆除:server action + form parser;高風險、codex 不降級)
   ↓
A9w4c 後半(item 半:`WF_STATUS_FIELD`/`ITEM_ID_FIELD`/`WF_CLEAR_VALUE`/`WF_RECEIVED_UNCONFIRMED`
   與 `workflow-select-options.ts`、三支孤兒元件檔一併清)
   ↓
#332(三筆無主死碼:`WORKFLOW_STATUS_CODE_RE` / banner 死詞彙 / `Object.hasOwn` 兩支走 plan)
   ↓
A9v(REVOKE item RPC + 撤 `order_status_options` service_role 寫權 + ACL 終態斷言;
    前置 = 全 consumer 零引用 grep;`order_items.workflow_status` 欄凍結不 DROP)
```

依據:母 plan `:424` row 53(A9w4a 改序註記)、`:426` row 55(A9w4c 拆半)、`:433` row 62(A9v 排 A11c 之後)、
`docs/phase-1-backlog.md:9049`(#332)。

🔴 **A9v 的前置是「A11 重建後全 consumer 零引用」**(row 62 逐字)⇒ 嚴格說要等 A11a-c **全部**做完,
不是只做 A11a。A11c(手機卡片版)若也渲染九碼,A9v 就還不能跑 —— 開 A11c 時要一併確認。

🔴 **A11a-1 完成後、A9w4a 開工前有一個窗口**:列表已無九碼 UI,但 server action 還在、DB 寫權還在。
那段期間的風險 = 「畫面拿掉了、後門還開著」(這正是母 plan row 62 逐字「UI 下架了、寫權還在」要防的)。
⇒ **A11a-1 與 A9w4a 建議同一批連續做完、不跨夜留窗**。

---

## §5 驗收矩陣(每格配突變靶)

> 工法鐵律(寫進每片收工):**先寫「預期 Δ」再比「實際 Δ」**(測試檔數與條數)。
> 依據 = E 線 A9w2 事故:依索引切段落順手吃掉兩個不相干 describe,三綠**全綠零紅**,
> 只有數量對帳抓得到(memory `feedback_range-delete-silently-eats-neighbors`)。

| # | 驗收條件 | 怎麼測 | 突變靶(把這個改壞,該格必紅) |
|---|---|---|---|
| V1 | 表頭 13 欄、每列 `<td>` 數與表頭一致 | 元件測試數 `<th>` 與各 `<tr>` 的 `<td>`+rowSpan 佔位 | 刪一個 `<th>` 不刪對應 `<td>` |
| V2 | **九碼零殘留**:無 `select[name="workflow_status"]`、無 `input[name="item_id"]`、無「存」鈕、無「商品狀態」表頭 | 頁層渲染測試(照 `app/orders/[id]/nine-code-retire.test.tsx` 的形狀) | 把 `ItemWorkflowStatusCell` 掛回 `orders-table` |
| V3 | **rowSpan 分組正確**:多品項單的訂單層格 `rowSpan = lines.length`,且**只在 `i === 0` 渲染一次** | 假資料 3 品項單,斷言 `rowSpan` 值與該格出現次數 | 把 `rowSpan={rowSpan}` 改成 `rowSpan={1}`;或拿掉 `i === 0` 條件 |
| V4 | **金額合併規則**:單品項且 `quantity=1` → 顯示該列金額;**多品項 或 任一列 `quantity>1`** → 合併格顯示整單總額 | 四格真值表(1×1 / 1×n / m×1 / m×n) | 把條件寫成只有 `quantity > 1`(= v1 的錯)⇒ m×1 那格必紅 |
| V5 | 空 `lines` 仍渲染一列佔位、訂單層格不消失 | 餵 `lines: []` | 拿掉 `rows.length > 0 ? … : [null]` 兜底 |
| V6 | 日期格式:同年 `07/25`、跨年 `2025/06/27` | 兩個 fixture(含跨年邊界) | 一律輸出 `YYYY-MM-DD` |
| V7 | 客戶格含等級小字,且**等級不再單獨成欄** | 斷言同一 `<td>` 內同時有名字與等級文字 + 表頭無「會員等級」 | 保留舊欄 |
| V8 | 付款軸小字出現在訂單編號格 | 斷言該格含 `PAYMENT_STATUS_LABEL` 字面 | 漏渲染 |
| V9 | **(A11a-4)** 訂貨欄接的是 A9c 的**非 nullable** 型別,UI 端零 `?? 0`、零 join | grep 該檔無 `?? 0`;型別層由 tsc 保證 | 在 UI 補 `?? 0`(母 plan `:314` 明文禁止) |
| V10 | **(A11a-6)** 出貨欄不得畫出任何看起來像真值的東西 | 斷言該格為灰色佔位/空 | 拿 `fulfillment_status`(stale 欄)去填 |

🔴 **驗收盲區(母 plan `:546-549` 逐字,必須寫進交棒)**:D1 之後 production **沒有任何多品項單、
也沒有任何 `quantity > 1` 的列** ⇒ **V3 / V4 這兩格在第 1 批無法用真實資料肉眼驗**。
⇒ 必須用假資料 smoke test 覆蓋,且**不得因為畫面看起來正常就宣稱這兩件事已驗**。
Sean 肉眼驗時會看到的是「單品項單一切正常」,合併格效果他這批看不到 —— 這句話要在交棒時明說。

---

## §6 決策題清單(產品判斷,**我不自標**;Sean 白天連 D 線一起拍)

> 格式照 `docs/working-style.md`:每題 2-4 選項、業務白話、有推薦。

```
Q1:A11a 的「訂貨」欄要等 A9c(列表投影加三軸)做完才能做。A9c 現在沒人排。要怎麼接?
A: 先做不吃新資料的骨架(A11a-1~3),A9c 另外排一片、之後再回來補訂貨欄  (推薦)
B: 先做 A9c(純加法片、約 30 分),再一次把 A11a 整片做完
C: 這次列表重建先不做訂貨欄,留 12 欄,等第 2 批出貨線一起補

Q2:「發票」欄的資料現在不在列表的查詢裡,而且整份計畫查不到哪一片要補它。要算誰的?
A: 併進 A9c 那片一起補(同一個「列表投影加法」動作,一次改完)  (推薦)
B: 獨立一片「列表投影補發票欄」,和 A9c 平行
C: 這次不做發票欄,列表維持 12 欄,發票只在明細頁看

Q3:「出貨」欄的資料要到第 2 批才存在。第 1 批這一欄要長什麼樣?
A: 畫一個灰色的空欄位,滑過去顯示「出貨功能第 2 批開通」  (推薦)
B: 這次不放這一欄,等第 2 批再加(欄數先 12)
C: 拿現在的「出貨狀態」舊欄位先頂著

Q4:訂單編號現在本身就是進明細頁的連結。新增「操作」欄之後,「檢視」要怎麼放?
A: 編號維持可點,操作欄只放取消(等 A13),不重複放檢視  (推薦)
B: 操作欄放「檢視」按鈕,編號改成純文字
C: 兩邊都可以點(編號連結 + 操作欄檢視鈕)

Q5:「取消訂單」的功能要到 A13 才做。操作欄現在要不要先放那顆鈕?
A: 先不放,A13 做好再加(避免員工看到按不動的鈕)  (推薦)
B: 放一顆停用狀態的鈕,滑過去說明「取消功能施工中」

Q6:欄位名稱字面(現行 vs 新版)要不要一起改?
   現行:商品品牌 / 物品名稱 / 客戶名稱   新版計畫字面:品牌 / 品名 / 客戶
A: 照計畫改成短字面(欄變多、需要省寬度)  (推薦)
B: 維持現行長字面,只動欄的增減

Q7:🔴 拿掉列表那顆「商品狀態」下拉之後,員工有一段時間完全沒地方「標商品進度」
   (明細頁那顆已經拿掉了;新的批次標記要等 A12b)。這段空窗要怎麼處理?
A: 接受空窗,但把 A12b(批次標記訂貨)排在 A11a 後面優先做,縮短空窗  (推薦)
B: 先做 A12b 再做 A11a(列表先不動,等新入口就位才拆舊的)
C: 接受空窗、不特別排序 —— 這段期間員工改用明細頁的採購表單逐張記
```

⚠️ **這七題都是產品判斷,不在施工端可拍範圍**(母 plan §5.1a 只定了欄位清單,沒定這些)。
Q1/Q2 的答案會**改變片界與前置**、Q7 會**改變施工順序**,這三題建議最先拍。

---

## §7 cut point(哪裡可以停、停了不會留半殘狀態)

| 停點 | 狀態 | 可否肉眼驗 |
|---|---|---|
| A11a-1 後 | 列表 = 10 欄(13 − 商品狀態 − 來源管道 − 單價總金額合併 − 會員等級併入 + 尚未加 4 欄) | ✅ 表頭與內容一致、九碼全消失 |
| A11a-2 後 | + 付款軸小字與新日期格式 | ✅ |
| A11a-3 後 | + 操作欄 | ✅ |
| A11a-4/-5/-6 各自後 | 逐欄補齊到 13 | ✅ 每片都是完整的表 |

🔴 **不可停的點**:A11a-1 做到一半(表頭已改、`<td>` 未改)——欄數錯位的表格無法肉眼驗。
⇒ A11a-1 若時間不夠,照 §3 的建議切法先只做九碼三群下架。

---

## §8 交棒(給施工者的硬提醒)

1. **開工第一件事**:重跑 `docs/reviews/2026-08-06-nine-code-final-scan-and-a11-recon.md` §② 的行號
   —— 那份基準是 `f8ede20`,若中間有別的線動過 `orders-table.tsx`,行號會漂。
2. **A9e 的行號字面已過期**:母 plan `:417` row 46(A9e)點名的
   `order-filter-bar.tsx:36,30`、`order-list-view.ts:31,149,184` 在 A9w2(`58fa83e`)之後**已不成立**
   (那三個檔被大幅收縮)。A9e 開工前必須重查,不得照字面施工。
3. **不做 join、不做 COALESCE**(母 plan `:314`):三軸的 null 正規化是 A9c mapper 的責任。
   UI 拿到 nullable = A9c 沒做完,退回去,不要在這裡補 0。
4. **測試數對帳**:每片先寫預期 Δ、收工比實際 Δ。
5. **不套 `<AdminDataTable>`**(§7.3);批次選取是 A12a 的事,本片不預埋。
6. **A11a-1 與 A9w4a 建議連著做**(§4 的窗口說明)。

---

## §9 本 plan 未做的事(誠實邊界)

- **未跑關卡1 對抗審查**(依 `E-106-A` ④:plan 不是高風險片,起草完即收工,審查留白天)。
- **未估「列高/欄寬不增加」**:母 plan `:544` 逐字「⚠️ = **待實作時實測**,不是已驗事實(#67)」——
  本 plan 沿用該標記,**沒有**新增任何版面量測。
- **未定 A11b/A11c 的片界**:本 plan 只涵蓋 A11a。三軸膠囊樣式(A11b)與手機卡片版(A11c)另計。
- **未查 `graphify` 連動面**:本片是 plan 起草、零實作;實作片開工前照 SOP ② 補。
