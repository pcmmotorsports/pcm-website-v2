# 九碼殘留引用終掃 + A11 退場預備偵察(E 線第一棒產物)

> **產出**:E 窗(九碼退場線)第一棒,2026-08-06 夜跑,依 `E-102-A` ① 授權項 1 與 3。
> **落 repo 依據**:`E-106-A` ②(「plan 的附件證據,不能只活在 session scratchpad」)。
> **基準**:`dev` = `f8ede20`(E 線五片 A9w1-A9w4c 前半已收割入 dev)。
> 掃描範圍 `apps/` + `packages/`,排除 `.next/` 建置產物與純註解行。
>
> ⚠️ **原稿基準是 `40c9369`(A9w3)+ 未 commit 的 4b/4c**;落 repo 前已對 `f8ede20` **逐項重驗**。
> 唯一漂移:`updateOrderStatusOption` / `createOrderStatusOption` 由各 6 命中變 **0**(A9w4c 前半落地),
> 其餘符號命中數與所有 `檔案:行號` 逐一複核未變。

## ① 逐符號殘留表(命中數 = 非註解的 code/test 行,重驗於 `f8ede20`)

| 符號 | 命中 | 落點 | 歸屬 |
|---|---|---|---|
| `ItemWorkflowStatusCell` | 3 | `orders-table.tsx:14,129`;元件本體 `item-workflow-status-cell.tsx:20` | **A11a**(列表重建) |
| `updateOrderItemWorkflowAction` | 6 | 元件 `item-workflow-status-cell.tsx:2,49`;action `order-actions.ts:89`;3 支測試的 mock | **A9w4a**(已裁定延後至 A11a 之後) |
| `parseItemWorkflowForm` / `WF_STATUS_FIELD` / `ITEM_ID_FIELD` | 12 / 14 / 19 | `workflow-form.ts` + 其測試 + 上面那條鏈 | **A9w4a / A9w4c 後半** |
| `buildWorkflowSelectOptions` / `resolveDefaultWorkflowValue` | 21 / 11 | `workflow-select-options.ts` + 其測試 + cell | **A11a**(cell 的純函式核心) |
| `WorkflowStatusSelect` / `WorkflowStatusBadge` | 8 / 6 | 兩支元件檔 + 其測試 + `orders-table.tsx` | **A11a** |
| `workflowStatusBadge` / `summarizeOrderItemWorkflow` / `indexOrderStatusOptions` | 10 / 12 / 5 | `order-list-view.ts` + 其測試 + `orders-table.tsx` | **A11a**(列表彙總 badge) |
| `WF_CLEAR_VALUE` / `WF_RECEIVED_UNCONFIRMED` | 18 / 7 | `workflow-form.ts` / `workflow-select-options.ts` + 測試 | **A9w4c 後半** |
| `updateOrderStatusOption` / `createOrderStatusOption` | **0** | — (A9w4c 前半 `e27f815` 已移除 port/adapter/型別/測試) | DB 寫權仍在 ⇒ **A9v** |
| `listOrderStatusOptions`(讀) | 7 | 列表頁 `app/orders/page.tsx:56`;port/adapter/測試 | **A11a** 之後才可退 |
| `WORKFLOW_STATUS_CODE_RE` | 2 | 只剩定義 `packages/domain/src/order/types.ts` + re-export `packages/domain/src/index.ts` | **零 consumer**;已立 backlog **#332** |

### 已達成零命中(「不得復活」清單)

`WORKFLOW_STATUS_PARAM`、`WORKFLOW_STATUS_UNSET_VALUE`、`parseWorkflowStatusesParam`、
`workflowStatusFilterOptions`、`workflowStatusSelectedValues`、`ADMIN_ORDER_LIST_SELECT_ITEM_STATUS_FILTERED`、
`AdminOrderFilter.workflowStatuses`、`AdminOrderDetailItem.workflowStatus`、`AdminOrderDetailItem.version`、
`StatusOptionCreateForm`、`StatusOptionEditRow`、`updateStatusOptionAction`、`createStatusOptionAction`、
`parseStatusOptionEditForm`、`parseStatusOptionCreateForm`、`OrderStatusOptionUpdate`、
`updateOrderStatusOption`、`createOrderStatusOption`(共 18 個;後 3 個於 `e27f815` 落地)。

## ② A11 退場預備偵察(唯讀盤點,只列不動;行號重驗於 `f8ede20`)

**`apps/admin/src/components/orders/orders-table.tsx`** —— 九碼面共 3 群:

- **整單彙總 badge**:`:10-12`(import `indexOrderStatusOptions` / `summarizeOrderItemWorkflow` /
  `workflowStatusBadge`)`:15`(`WorkflowStatusBadge`)`:35,38`(`optionsByCode` prop)
  `:40`(`summarizeOrderItemWorkflow(order.lines.map((l) => l.workflowStatus))`)`:48`(渲染)
  `:89-91`(`order.lines.length > 1 && !itemStatusFiltered` 才顯示)
- **per-item 改狀態 cell**:`:14`(import)`:53-61`(`optionsByCode` / `activeOptions` /
  `itemStatusFiltered` props)`:129-136`(渲染 + `line.workflowStatus` / `line.version`)
  `:199`(`<th>商品狀態</th>`)
- **表層 props 與衍生**:`:155,160`(`statusOptions` prop)`:156,168`(`itemStatusFiltered`,
  **A9w2 起恆 false**)`:180-181`(`indexOrderStatusOptions` / `activeOptions` 衍生)`:207-209`(下傳)

**`apps/admin/src/app/orders/page.tsx`** —— `:46`(`statusOptions` 宣告)`:56`(`listOrderStatusOptions()` 讀取)
`:65`(容錯賦值)`:89-91`(傳給 `OrdersTable`)。A11a 重建列表後這四處可一併收。

**連帶會變孤兒的檔(A11a 之後)**:`components/orders/item-workflow-status-cell.tsx`、
`components/orders/workflow-status-select.tsx`、`components/orders/workflow-status-badge.tsx`、
`lib/orders/workflow-select-options.ts`,與 `workflow-status-select.test.tsx`、
`workflow-select-options.test.ts` 兩支測試。

## ③ 給 A11 施工者的三個提醒(第一棒踩過的坑)

1. **`itemStatusFiltered` 已是恆 false**(唯一 producer 九碼篩選在 A9w2 下架)⇒ `:89` 的
   `!itemStatusFiltered` 恆真;重建時別把它當成還活著的條件搬過去。
2. **文字層守門擋不住 runtime 接線**:改列表時 `components/layout/app-sidebar.test.ts` 那一類
   文字層測試(該檔檔頭自己逐條列了擋不住什麼)只證字面在場,不證畫面真的渲染得出來。
3. **測試總數要對帳**:每片先寫「預期 Δ」,收工比「實際 Δ」。A9w2 就是靠這個抓到
   「依索引切段落順手吃掉兩個不相干 describe」(預期 −4、實際 −12)——三綠全綠、零紅,
   只看有沒有紅完全看不出來(教訓已入 memory `feedback_range-delete-silently-eats-neighbors`)。
