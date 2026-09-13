# Plan:「下一步」鈕可點 + 寫入(P-e)—— 鐵則 8,等 Sean 批
> 2026-09-13 晚 設計窗。**零實作。** 現況讀 `origin/dev`(`c97d77a50`);⚠️ 「下一步欄只印字」那片在 `agent/adminui-1` 的 `34c9fb612`,**未推** ⇒ 本 plan 引它的四個字面時標出處。
> 形狀(七條、`?next=` 同族、出貨彈窗只留三樣)已在 `~/pcm-mailbox/0912-後台UX/規格-側欄與訂單明細容器-v1.md` §3-f;**本 plan 只補【寫入那一半】。**

## 🔴 0 頂端硬線(照規格 §3-f-4,逐字搬)
**`?next=<單號>&do=<動作>` 打開的是【表單】,不是動作。** 貼一個網址**不會**寫進任何東西;**寫入只發生在他按下「確認」那一刻。**
理由用他的話:**一條網址會被轉貼、被預覽、被瀏覽器預抓 —— 而「按網址就到貨了」是收不回來的。**

## 1 改什麼:四顆鈕各自按下「確認」之後寫什麼
| 鈕(字面來自 `34c9fb612` 的 `ORDER_NEXT_STEP_LABEL`) | 寫哪張表 | 走哪支**既有** action → repository → RPC | 新開 RPC? |
|---|---|---|---|
| **跟供應商下訂** | `order_item_procurement` | `lib/orders/procurement-actions.ts:95 upsertItemProcurementAction` → `procurement-repository.ts:144 upsertItemProcurement` → **`admin_upsert_item_procurement`** | ❌ 沿用 |
| **到貨登記** | `order_item_procurement_receipts` | `lib/orders/receipt-actions.ts:56 recordItemReceiptAction` → `receipt-repository.ts:117 recordItemReceipt` → **`admin_record_item_receipt`** | ❌ 沿用 |
| **出貨**(快遞商 + 單號 + 確認) | `shipments` + `shipment_items` | `lib/shipping/shipment-actions.ts:103 submitShipment` → `shipment-repository.ts:102 createShipment` → **`admin_create_shipment`** → `:127 addShipmentItems` → **`admin_add_shipment_items`** → `:146 markShipmentShipped` → **`admin_mark_shipment_shipped`**(三支串在同一支 action 裡,**今天就是這樣串的**) | ❌ 沿用 |
| 完成 | — | **不是鈕**(灰字) | — |
⇒ 📌 **四個動作明細頁今天都做得到 ⇒ 寫入路徑全部存在,本 plan 零新 RPC、零 migration。** 重量落在「把既有 action 從明細頁的表單接到列表的彈窗」,不在資料庫。

## 🔴 2 「確認」之後有沒有回頭路(每一顆都答)
| 鈕 | 回頭路 | 誰提供 |
|---|---|---|
| 跟供應商下訂 | ✅ **有**:同一支 `upsert` 再送一次就改掉(供應商 / 數量 / 單號都可改) | `admin_upsert_item_procurement` 的 upsert 語意 |
| 到貨登記 | ✅ **有**:`receipt-actions.ts:248 undoItemReceiptAction` → `admin_delete_item_receipt` | 既有 |
| **出貨** | ⚠️ **半條**:箱可作廢(`shipment-actions.ts:305 voidShipmentAction` → `admin_void_shipment`);**而通知客人的信是 cron 掃 `pcm_shipped_email_pending` 寄的,「最多 5 分鐘」**(稿上那句)⇒ **5 分鐘內作廢 = 信不會寄;超過 = 信已經到客人手上,收不回來。** | 既有 + `docs/runbooks/email-sweep-kill-switch.md` |
⇒ 🔴 **所以「出貨」那顆是四顆裡唯一「按了會對外」的**,它的確認鈕文案要說出這件事(照文案四條原則:那是**擋一個會造成損害的動作 ⇒ 三段**)。其餘三顆兩段。
⇒ 📌 `order-status-axes.ts` 檔頭逐字「**一顆在列表上就能按的寫入鈕,誤按的成本比在明細裡高**」—— 本 plan 的答法**不是加確認框**(彈窗本身就是確認框),是 **(a) 出貨那顆的文案講清楚 5 分鐘 (b) 彈窗預設焦點在「取消」不在「確認」**(七條的 ⑤)。

## 🔴 3 樂觀鎖:**這三支 RPC 今天【沒有】`p_expected_version`** —— 實查,不是推的
```
admin_upsert_item_procurement  參數:p_actor p_allocated_quantity p_contact_channel p_exception_reason p_expected_arrival_date
                                    p_order_item_id p_preserve_optional_fields p_reply_status p_request_id p_submitted_at p_supplier_id p_supplier_order_no
admin_record_item_receipt      參數:p_actor p_note p_procurement_id p_quantity p_received_at p_request_id p_surplus_quantity
admin_create_shipment          參數:p_carrier_code p_carrier_note p_customer_user_id p_idempotency_key p_recipient_snapshot
admin_mark_shipment_shipped    參數:p_idempotency_key p_shipment_id p_tracking_number p_void_reason
```
⇒ **零 `version`**。它們用的是 **`p_request_id` / `p_idempotency_key`(冪等,擋重送)**,不是版本(擋「別人剛改過」)。
- 主視窗要我「抄 `key={detail.version}` 那個做法」—— **那個做法住在** `order-detail-items-table.tsx:409 expectedVersion={detail.version}` 與 `order-edit-form.tsx:51`,**而它們接的是另外兩支 RPC**(改金額 / 改個資),那兩支才吃 `p_expected_version`。
- 🛑 **要讓這三支也吃版本 = 三支 RPC 各改簽章 = 三份 migration** ⇒ **那是鐵則 8 的重量級,而本片是「沿用既有」的輕量級。不混在一片。**
- ✅ **本片的答法**:① 彈窗**由網址驅動、server 端渲染** ⇒ 打開那一刻讀的是**當下**的狀態,不是列表載入時的快照(這是 §3-f-2 ① 那條「網址是真相」的直接紅利);② RPC 自己的狀態檢查照舊擋(例:到貨數量超過已訂 ⇒ RPC 拒);③ 冪等鍵照舊擋重送。
- 🔴 **殘餘風險寫出來**:A 在列表開了「到貨登記」彈窗、B 在明細把那筆採購作廢、A 按確認 ⇒ **RPC 會不會拒,取決於它自己查不查 `voided`** —— `20260814100000` 檔名就叫 `adjacent_writers_voided_split`,**它查**;而**我沒有逐支重讀那三支的本體來證這件事** ⇒ 驗收第 6 條要真的做一次。
- ⏰ 若 Sean 要「別人剛改過就擋」的硬保證 ⇒ 另開一片:三支加 `p_expected_version`,照 `item-amount-form.tsx:23` 引的 `20260815040000:382` 那個形狀。**本 plan 不含。**

## 4 影響
- **只影響訂單列表那一頁的「下一步」欄**(`orders-table.tsx` 那一格從灰字變連結)+ 新的彈窗元件。
- **明細頁一個字不動**(四個動作在那邊照舊做得到)。
- 🔴 **`orders-table.tsx` 那道「全檔零 `use client`」守門不破**:彈窗的 client 殼掛列表外層(規格 §3-f-3)。
- 資料庫:**零 migration、零新 RPC、零 GRANT**。

## 5 切片(每片 15-45 分;鐵則 12 只在 P-e-3)
| 片 | 內容 | 審 |
|---|---|---|
| P-e-1 | 「下一步」灰字變連結 `?next=<id>&do=<動作>`;列表外層一顆 `use client` 殼,`showModal()` 開一個**空**彈窗;Esc / 取消 = 網址改回去 | 否 |
| P-e-2 | 三個彈窗的內容(欄位照稿 v22;**復用明細頁那三份表單元件,不重寫**:`item-procurement-form.tsx` / 到貨那支 / 出貨那支)⇒ 仍零寫入(action 先不接) | 否 |
| 🔴 **P-e-3** | **接上三支既有 action** + 出貨那顆的三段文案 + 焦點預設在取消 | **codex 一輪**,切入角:「從彈窗送出,與從明細頁送出,進同一支 RPC 的參數有沒有任何一格不同」 |

## 6 Rollback
- P-e-1 / P-e-2:`git revert` 該顆 commit,列表回到灰字。零資料影響。
- P-e-3:同上;**已經寫進去的採購 / 到貨 / 箱不需要回滾** —— 它們是走既有 RPC 寫的,與從明細頁寫的一模一樣。

## 7 驗收(yes/no)
1. 🔴 貼 `?next=<id>&do=receipt` 進瀏覽器 ⇒ **只開彈窗,資料庫零寫入**(唯讀查 `order_item_procurement_receipts` 前後筆數相同)。
2. 從彈窗按確認 vs 從明細頁按確認 ⇒ **同一支 RPC、同一組參數**(codex 那格 + 一支測試比對兩邊組出來的 payload)。
3. 三個彈窗打開時 **Tab 第一站是「取消」**。
4. 出貨那顆的確認鈕文案**三段**、講到「5 分鐘內作廢信不會寄」。
5. Esc 關得掉、遮罩點得掉、關了**列表篩選 / 頁次 / 展開狀態不變**。
6. 🔴 **並發那一格真的做一次**:A 開到貨彈窗 → B 在明細作廢那筆採購 → A 按確認 ⇒ **RPC 要拒,畫面要說一句**,不可以寫成一筆掛在已作廢採購上的到貨。
7. `orders-table.tsx` 仍零 `use client` / 零 hook(既有守門 `orders-table.test.tsx:1865` 綠)。
8. 三個寬(1440 / 1920 / 3434)彈窗開著時列表**不橫捲**。

## 8 我沒查的
- 那三支 RPC 本體有沒有查 `voided`(§3 殘餘風險)—— 只從檔名與參數推,**沒逐支重讀本體**。
- 明細頁那三份表單元件能不能**原樣**塞進彈窗(它們可能綁著明細頁的 `return_to` / `inPanel`)⇒ P-e-2 開工第一件事就是這個。
- 「完成」灰字與「已取消 / 已退款」空白在**列表外層殼**看到的 DOM 是否仍照 `34c9fb612` 的三態(`action` / `done` / `none`)—— 那顆未推,推了才量得到。
