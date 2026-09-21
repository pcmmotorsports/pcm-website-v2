# plan · 後台訂單「換商品」（品項還沒向廠商訂貨時，把 A 換成同價的 B）

> 開立：2026-09-22 · 窗 shop-6（分支 agent/shop-6）· 本檔只提案，不改程式、不寫 migration。
> 會新增一支 RPC，也要改兩支既有的寫入 RPC ⇒ 鐵則 8 要 Sean 批准；碰訂單金額與成本 ⇒ 鐵則 12，先給 Codex 唯讀審。
> 需求來源：主視窗 2026-09-22 轉述，Sean 選甲「只有還沒向廠商訂貨的品項才能換；已經訂貨、到貨或出貨的，照舊取消後重建」。
> R1 審查（Codex，2026-09-22）：FAIL，7 個必須修正，已逐條修正（第 11 節）。
> **R2 審查：FAIL，還有 4 個必須修正（第 12 節）。照鐵則 12 不跑 R3，停下請 Sean 決定方向。第 3–8 節仍是 R1 修正後的版本，還沒有吸收 R2。**

## 1. 給 Sean 看的摘要

**現在**：客人下錯單（例如選錯規格），員工只能取消那個品項再重建。

**改完**：訂單詳細頁的品項旁邊多一個「換商品」。員工搜尋料號、選到 B，確認後這一列就從 A 變成 B。
- 只有這個品項**完全還沒處理**（還沒向廠商訂貨、沒有到貨、沒有取消、沒有出貨、沒有退款）才能換。
- A 和 B 的**目錄價必須相同**，不同就擋下。
- 這一列的單價、數量和訂單總額都不動，所以已付款的單也可以換。
- 不寄信給客人。訂單操作紀錄記一筆：誰、什麼時間、把哪個料號換成哪個料號。
- 為了避免有人開著舊畫面，把 A 的訂貨或成本記到已經換成 B 的品項上，訂貨和填成本這兩個既有功能也要加一道檢查（第 5 節）。

需要 Sean 決定的題目在第 9 節。

## 2. 已查到的事實（每一條都附出處）

| 事實 | 出處 |
|---|---|
| `order_items` 存的商品資料：`variant_id`、`variant_sku`（料號快照）、`product_snapshot`（只准 title / sku / spec 三個鍵）、`unit_price`、`line_total`、`vehicle_snapshot`、`availability_at_checkout`（下單當時的庫存狀態，用來追交期）、`version`、`updated_at` | `20260604120000_m3_s2a_orders_order_items.sql:140-168`；`20260716180000_m4a_v3a_order_items_vehicle_snapshot.sql:26`；`20260614130000_m3_create_order_stock_snapshot.sql:14`；`20260716120000_m4a_d2_order_items_workflow_status.sql:47-52` |
| `order_items` **刻意沒有**成本和經銷價欄，資料庫檢查會擋 | `20260604120000:157-165,169` |
| 網站單的單價依會員等級取目錄價：經銷用 `coalesce(price_store, price_general)`，其他用 `price_general` | `20260915100000_m4b_couponfield_p_d_create_order_redeem_dryrun.sql:367-372` |
| **手動單的單價是員工輸入的**，而且依 `price_tax_mode` 可能存含稅或未稅 ⇒ 不能拿目錄價直接和它比 | `20260915233000_m4b_p02a_bank_due_at_helper_and_manual_order_customer_lock.sql:140,439,548,660-664` |
| 成本在 `order_item_costs`，一個品項一列；既有寫入 RPC 用 advisory lock `order_item_costs:<品項 id>` 排隊 | `20260914010000_m4b_order_item_costs.sql:77-96,174` |
| 還沒訂貨 = `order_item_procurement` 沒有這個品項的列；採購的檢查會對 `order_items` 那一列取 `FOR NO KEY UPDATE` | `20260729020000_m4b_e10_a2_order_item_procurement.sql:33-110`；`20260813120000_m4b_e10_452_procurement_void_schema.sql:424-428` |
| 已訂 / 到貨 / 取消 / 出貨數量摘要在 `order_item_quantity_summary` | `20260730150000_m4b_e10_a1_order_item_summary_columns.sql:79-149` |
| 指向品項的表：採購、出貨明細 `shipment_items`、成本、改價申請、取消明細、退款帳、退款工作 | `20260729020000:43`；`20260805170200_m4b_e10_b2_s1b_shipment_items.sql:73`；`20260914010000:78`；`20260915050000_m4b_03_order_amount_requests.sql:49`；`20260730130000_m4b_e10_a7_order_cancellations.sql:238`；`20260725130100_m3_rf2a2_order_refunds_ledger.sql:165`；`20260731120000_m4b_e10_a7b_m_refund_jobs.sql:484` |
| 現有改單只有「修改單價」`admin_update_order_item_amount`：管理者限定（`:1684-1690`）、鎖訂單（`:1694`）、比對**訂單** `version`（`:1698`，成功後 +1 在 `:1808`）、有付款就擋（`:1703-1709`）、有折扣就擋（`:1716-1721`）、確認品項屬於這張單（`:1781`）、寫稽核（`:1835`） | `20260915060000_m4b_953_p2_rpcs_call_pcm_order_total.sql` |
| 稽核頁只對 `orders.item.costs.set` 這個動作遮蔽成本給非管理者 | `apps/admin/src/app/settings/audit/page.tsx:113` |
| 優惠券只有「最低消費」和「會員等級」條件，沒有限定商品 | `20260829150000_m4b_coupon_p1_tables.sql:88,134` |
| 手動建單的商品搜尋 `searchManualOrderCatalog`，用料號查規格，回傳規格 id、料號、品名、一般價、經銷價 | `apps/admin/src/lib/orders/manual-order-catalog.ts:135,151-165,186-215` |
| 付款成功信排隊時會把內容凍結（`paidSnapshot`）；新格式寄送時用凍結內容，舊格式才在寄送時重查 | `packages/use-cases/src/enqueue-order-created-emails.ts:190`；`packages/use-cases/src/sweep-email-outbox.ts:2185` |
| 建單後還會讀品項商品欄位：出貨信、出貨作業畫面、客人會員中心的訂單紀錄 | `SupabaseShippedEmailContextAdapter.ts:164`；`apps/admin/src/lib/shipping/shipment-repository.ts:1147-1154`；`apps/storefront/src/components/account/tabs/OrdersTab.tsx:126` |

## 3. 換的時候，每個欄位怎麼處理

| 欄位 | 處理 | 理由 |
|---|---|---|
| `variant_id` | 換成 B | 規格本身 |
| `variant_sku` | 換成 B 的料號 | 出貨員靠料號撿貨 |
| `product_snapshot` | 用建單同一套寫法重建 B 的 title / sku / spec | 資料庫只准這三個鍵 |
| `availability_at_checkout` | 換成 B **現在**的庫存狀態，A 的舊值記進稽核 | 它是用來追調貨 / 預購交期的；留 A 的值會讓員工誤判 B 的交期 |
| `unit_price` / `line_total` / `quantity` | **不變** | 同價才准換；整列換不拆 |
| `vehicle_snapshot` | 不變 | 客人選的車款，換規格不改變 |
| `workflow_status` | 不變 | 品項還沒處理 |
| 品項 `version` / `updated_at` | +1 / 現在 | |
| 訂單 `version` / `updated_at` | +1 / 現在 | 讓開著舊畫面的改價、提案、核准全部被擋（第 4 節 ③） |
| 成本（`order_item_costs`） | **刪掉** | A 的成本不是 B 的成本 |
| 訂單小計、總額、付款、優惠券 | **不變** | |

## 4. 什麼情況才准換（全部在資料庫函式裡判斷，不信前端）

**鎖的順序（跟既有路徑同方向，不用會跟外鍵檢查死結的 `FOR UPDATE`）**
1. `orders` 那一列 `FOR NO KEY UPDATE`（同修改單價）。
2. `order_items` 那一列 `FOR NO KEY UPDATE`，條件寫成 `id = p_item_id AND order_id = p_order_id`，查不到就拒絕（擋「用甲單的權限改乙單的品項」）。採購的檢查鎖的就是這一列，所以取得這把鎖之後，採購不可能同時插進來。
3. advisory lock `order_item_costs:<品項 id>`（同成本寫入 RPC），之後才讀、刪成本。

**全部鎖到之後才檢查（任何一條不過，整筆不動，回一句員工看得懂的原因）**
1. 操作者是在職員工（是否限管理者見 Q2）。
2. 訂單沒有被整單取消。
3. 畫面送來的**訂單** `version` 等於現在的值，不等就回「資料已被別人改過，請重新整理」。
4. 採購表、出貨明細、取消明細、退款帳、退款工作都**沒有**這個品項的列；數量摘要的已訂 / 到貨 / 取消 / 出貨都是 0（沒有摘要列當 0）。
5. 沒有審核中的改價申請（`order_amount_requests`）。
6. **同價**：A 和 B **現在的目錄價**用同一套規則算（依 `orders.tier_at_checkout`：經銷用 `coalesce(price_store, price_general)`，其他用 `price_general`），兩者必須相等。
   - 比的是 A 和 B 的目錄價，**不是**這一列的 `unit_price`。這樣手動輸入的價格、未稅單、人工改過價的單都不會被誤判，而這一列的單價原樣保留。
   - A 的規格已被刪除（`variant_id` 是空的）就拒絕：沒辦法確認同價。
   - 價格由資料庫自己讀，前端送來的價格一律不用。
7. B 存在、商品目前上架；B 和 A 是同一個規格 ⇒ 回「沒有變更」，不寫任何東西。

## 5. 會動到什麼

**資料庫（1 支 migration）**
- 新 RPC `admin_swap_order_item(p_actor, p_request_id, p_order_id, p_item_id, p_expected_order_version, p_new_variant_id)`：`SECURITY DEFINER`、`SET search_path = ''`、物件全部寫完整名稱；撤銷 `PUBLIC`、`anon`、`authenticated`，只授權 `service_role`。
- 同一交易：第 4 節的鎖與檢查 → 更新品項 → 刪成本 → 訂單 version +1 → 寫 `admin_audit_log`（action `order.item.swap`）。
  - before：A 的規格 id、料號、品名、庫存狀態、成本；after：B 的同樣欄位（成本為空）。
- **改兩支既有寫入 RPC**：採購寫入與成本寫入，各加一個參數 `p_expected_variant_id uuid DEFAULT NULL`。有帶值時，在交易裡比對品項現在的 `variant_id`，不同就拒絕「這個品項已經換成別的商品，請重新整理」。
  - 為什麼要改：沒有這一道，員工開著舊畫面（顯示 A）去訂貨或填成本，送出時會合法寫到已經換成 B 的品項上。
  - 形狀：加參數要 DROP 再 CREATE（加參數會變成第二支同名函式）；`DEFAULT NULL` 讓舊程式照常能呼叫，所以**先貼資料庫、再上程式**，中間這段時間兩邊都能用。DROP 會帶走權限和註解，要一起重下。
  - 改之前先用 `scripts/latest-definition-of.sh` 找最新一代逐字照抄，只加這一段。

**程式**
- `apps/admin/src/lib/orders/`：換商品的伺服器動作與 repository 方法；結果分成「已換」「資料已變更」「沒有變更」「不能換（附原因）」。
- 採購與成本的送出程式帶上畫面當時的 `variant_id`（`procurement-repository.ts:147`、`item-costs-repository.ts:109` 一帶）。
- 商品搜尋直接用 `searchManualOrderCatalog`。
  - Sean 2026-08-31 對建單畫面的裁定是「搜尋結果只顯示、不自動帶入欄位」（`manual-order-catalog.ts:11-44`）。換商品是「從結果裡點選一筆」，UI 讓員工明確點選再按確認，不會自動帶入其他欄位。
- 稽核頁的成本遮蔽規則加上 `order.item.swap`：非管理者看不到 before 裡的成本，**在伺服器端遮**，並加一個測試確認非管理者拿到的資料不含成本值。
- 操作紀錄顯示文字：「換商品：A 料號 → B 料號」。
- 訂單詳細頁品項列加入口，對話框並排顯示 A 與 B 的料號、品名、目錄價，按「確認換成這個商品」才送出。後台訂單 UI 正式設計稿（OD `pcm-524f` 的 `HANDOFF-orders-ui.md`）沒畫這個入口，實作前先在稿上確認位置。

## 6. 對已付款的單與客人的影響

- 單價、數量、小計、總額、付款紀錄、退款上限、優惠券條件都不動 ⇒ 不需要像修改單價那樣擋已付款的單。
- 客人看得到的變化：
  - 會員中心的訂單紀錄：品名會變成 B。
  - 付款成功信：**已寄出的**仍寫 A；**還在排隊的**，新格式已經把 A 凍結在信裡，寄出來也是 A；只有舊格式的排隊信會在寄送時重查而寫 B。
  - 出貨信：出貨時才組內容，會寫 B。
- 這些都在「不寄信通知」（Q4 甲）的前提下被接受；如果 Sean 覺得付款成功信寫 A 會造成困擾，改選 Q4 乙。

## 7. 出事怎麼退回

- **程式有問題**：revert 程式那一顆 commit，入口消失；新 RPC 沒人呼叫，不影響其他功能。
- **新 RPC 要拿掉**：rollback 檔 `DROP FUNCTION public.admin_swap_order_item(...)`。
- **採購 / 成本那兩支要退回**：rollback 檔逐字貼回上一代（DROP 新簽章 + CREATE 舊簽章 + 重下權限和註解）。順序是**先 revert 程式、再退資料庫**，否則新程式送出的參數舊函式不認得。
- **某一筆換錯了**：如果品項仍然沒訂貨、A 仍然上架且目錄價沒變，可以用同一個功能換回 A；成本若原本有填，從稽核的 before 找回再填。以上任一條不成立，就照現有流程取消後重建。

## 8. 切片與時間估計

| 片 | 內容 | 估計 |
|---|---|---|
| 1 | migration：新 RPC + 前置 / 事後檢查 + rollback；拋棄式 PG 逐條測第 4 節（每條先確認會擋、再確認正常會過），含跨單參數、舊 version、兩個 session 同時「換商品 vs 新增採購」 | 45 分鐘 |
| 2 | migration：採購寫入、成本寫入各加 `p_expected_variant_id`；拋棄式 PG 測「帶舊規格被擋、不帶照舊、帶對的照舊」 | 45 分鐘 |
| 3 | repository + 伺服器動作 + 採購 / 成本送出帶規格 id + 單元測試 | 30 分鐘 |
| 4 | 訂單詳細頁入口 + 對話框 + 擋下的提示文字 | 45 分鐘 |
| 5 | 稽核頁成本遮蔽 + 顯示文字 + 測試；本機走一遍：換成功、價格不同被擋、已訂貨被擋、舊畫面訂貨被擋 | 30 分鐘 |

**共 5 片，約 3 小時 15 分。** 片 1、2 的 migration 要等 Sean 貼上正式庫；程式要用到還沒套用的 DB 變更 ⇒ 板先貼、程式後推。

## 9. 需要 Sean 決定

**Q1 目錄價不同時怎麼辦**
- 甲（推薦）：擋下，告訴員工兩邊的價格。要換成不同價的商品，照現在的流程取消後重建（或先用「修改單價」，但那個功能對已付款、有折扣、未稅的單本來就會擋）。
- 乙：換的時候順便改單價。等於多一條改金額的路，要重做付款、折扣、退款上限那些檢查，工作量大很多。

**Q2 誰可以換**
- 甲（推薦）：所有在職員工。金額不會變，每次都有紀錄。
- 乙：只有管理者，跟「修改單價」一樣。

**Q3 數量大於 1 時，可不可以只換其中幾個**
- 甲（推薦）：不行，只能整列換。
- 乙：可以拆列。要多寫拆列邏輯，估計多 1–2 片。

**Q4 要不要通知客人**
- 甲（推薦）：不寄信，只記操作紀錄。客人下錯單通常是他自己來講的，員工當下會跟他確認。代價是還在排隊的付款成功信可能仍寫 A（第 6 節）。
- 乙：寄一封「訂單商品已更換」的信。要加新信件種類和文案，估計多 2 片。

## 10. 我沒查的

1. 正式庫目前有多少品項處在「完全還沒處理」的狀態：沒查，不影響做法。
2. 採購、成本以外，還有沒有其他「以品項 id 寫入、而畫面顯示料號」的功能（例如到貨登記在沒有採購列時能不能直接寫）：片 2 開工前要再掃一次寫入 `order_item_id` 的 RPC。
3. 取消明細、退款帳、退款工作三張表目前是否仍有寫入路徑：本版一律當作「有列就擋」，不依賴它們是否還在用。

## 11. R1 審查修正對照

| R1 | 等級 | 本版怎麼改 |
|---|---|---|
| 1 只鎖訂單，擋不住同時新增採購 | must-fix | 第 4 節加鎖品項 `FOR NO KEY UPDATE`，鎖到才檢查 |
| 2 品項版本擋不住舊的改價畫面 | must-fix | 改成比對並 +1 **訂單** version |
| 3 採購、成本寫入沒有商品檢查 | must-fix | 第 5 節兩支既有 RPC 加 `p_expected_variant_id`，新增片 2 |
| 4 刪成本沒用成本專用鎖 | must-fix | 第 4 節加同一把 advisory lock |
| 5 稽核會把成本露給一般員工 | must-fix | 第 5 節擴充伺服器端遮蔽並加測試 |
| 6 手動單含稅 / 未稅會誤判同價 | must-fix | 改成比 A、B 的目錄價，不比 `unit_price` |
| 7 沒綁「品項屬於這張單」 | must-fix | 鎖品項時同時限定 `order_id` |
| 8 漏庫存快照與更新時間 | should-fix | 第 3 節補上 |
| 9 「先改價」「換回」不是每張單都能用 | should-fix | Q1 與第 7 節改寫成有條件的說法 |
| 10 排隊付款信的行為 | should-fix | 第 6 節補上 |
| 11 行號不存在、FK 清單不全 | nit | 第 2 節改引最新一代的行號，補三張表 |

## 12. R2 審查結果（未修，等 Sean 決定方向）

| R2 | 等級 | 問題 | 核對 |
|---|---|---|---|
| 1 | must-fix | 採購 RPC 先用不上鎖的 SELECT 讀品項，INSERT 後 trigger 才上鎖，而且只檢查數量 ⇒ 「交易裡比對規格」擋不住交錯順序 | `20260814100000_m4b_e10_452_2a2a_adjacent_writers_voided_split.sql:380`；`20260813120000:424` |
| 2 | must-fix | 成本 RPC 一次寫多個品項（`p_rows jsonb`），一個 `p_expected_variant_id` 表達不了多列 | `20260914010000:119,177`；`item-costs-repository.ts:111` |
| 3 | must-fix | 部分取消也只送品項 id 和數量，舊畫面會取消到換完後的 B | `cancel-order-forms.tsx:446`；`cancel-repository.ts:301`；`20260914050000_m4b_partpaid_cancel_gate_v2.sql:659` |
| 4 | must-fix | 「沒有退款」只查品項層；人工退款與 TapPay 補登是訂單層，沒有品項明細 | `20260916130000_m4b_manual_refund_settles_pending_refund.sql:303`；`20260907130000_m4b_tappaydirect_c1a_isolation_before_idempotent.sql:319` |
| 5 | should-fix | 重建採購 RPC 若照抄最後一份 CREATE，會把後來 `ALTER ... SET search_path = ''` 的修正蓋回去 | `20260905110000_m4b_definer_searchpath_lock_m1b.sql:48,171` |
| 6 | nit | 品項歸屬檢查在 `:1729`、版本 +1 在 `:1806`；`shipped_quantity` 出自 `20260806100000_m4b_e10_b2_s2a_summary_shipped_quantity.sql:131` | — |

**R2 1–3 是同一個根本問題**：在原品項上直接改成 B，品項 id 不變，所以**每一個用品項 id 寫入的既有功能**（採購、成本、部分取消，可能還有別的）開著舊畫面時都會寫到 B。照 R1 的修法要逐支補檢查，範圍會一直擴大，而且很難確定已經補齊。

**建議改的方向（未經審查）：刪掉 A 那一列、新增一列 B（新的品項 id），而不是就地改。**
- 准換條件本來就要求 A 沒有任何採購、出貨、取消、退款、改價申請的關聯資料，所以刪得掉。
- 開著舊畫面的採購、成本、部分取消送出時，指向的是已經不存在的 A 品項 id ⇒ 找不到品項或外鍵擋下，**不必逐支改既有 RPC**，第 5 節「改兩支既有寫入 RPC」和片 2 可以拿掉。
- 要另外確認：數量摘要表對品項的外鍵刪除行為、B 在訂單內的顯示順序、稽核用舊 id 查得到紀錄。
- R2 4 另外補：訂單付款狀態是已退款或部分退款、或有任何訂單層退款或人工退款時，一律不准換。

**要 Sean 決定（Q5）**
- 甲（推薦）：改成「刪 A、新增 B」再寫一版，重新從 R1 開始審。預估切片會回到 4 片、約 2.5 小時。
- 乙：維持就地改，逐支補採購、成本、部分取消等既有功能的檢查。範圍大，預估 6 片以上，而且還要再盤點其他用品項 id 寫入的功能。
- 丙：先不做，照現在的流程取消後重建。
