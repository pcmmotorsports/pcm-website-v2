# plan · 後台訂單「換商品」（品項還沒向廠商訂貨時，把 A 換成同價的 B）

> 開立：2026-09-22 · 窗 shop-6（分支 agent/shop-6）· 本檔只提案，不改程式、不寫 migration。
> 新增一支 RPC，碰訂單內容 ⇒ 鐵則 8 要 Sean 批准；碰訂單與成本 ⇒ 鐵則 12，先給 Codex 唯讀審。
> Sean 的決定：選甲「只有還沒向廠商訂貨的品項才能換」；2026-09-22 回答 Q1–Q5 全部選甲（主視窗轉述）。
> 第一版（就地改品項）R1、R2 都未通過，Sean 選 Q5 甲改成「刪掉 A 那一列、新增 B 一列」。本版是改寫後的第二版，重新從 R1 審。舊版審查紀錄在第 11 節。

## 1. 給 Sean 看的摘要

**現在**：客人下錯單（例如選錯規格），員工只能取消那個品項再重建。

**改完**：訂單詳細頁的品項旁邊多一個「換商品」。員工搜尋料號、選到 B，確認後 A 那一列被移除，換上一列 B。
- **收款資料不受影響**：收款、退款上限、優惠券都記在整張訂單上，不在品項列上，換商品不會動到。
- 只有這個品項**完全還沒處理**才能換：還沒向廠商訂貨、沒有到貨、沒有取消、沒有出貨、沒有申請過改價，而且整張單沒有任何退款。
- A 和 B 的**目錄價必須相同**，不同就擋下。這一列的單價、數量和訂單總額都照舊。
- 所有在職員工都可以換，只能整列換。
- 不寄信給客人。訂單操作紀錄記一筆：誰、什麼時間、把哪個料號和品名換成哪個料號和品名。

## 2. 已查到的事實（每一條都附出處）

| 事實 | 出處 |
|---|---|
| `order_items` 的欄位：`order_id`、`variant_id`、`variant_sku`（料號快照）、`product_snapshot`（只准 title / sku / spec 三個鍵）、`quantity`、`unit_price`、`line_total`、`vehicle_snapshot`、`availability_at_checkout`（下單當時的庫存狀態）、`workflow_status`、`version`、`updated_at`；**沒有 `created_at`** | `20260604120000_m3_s2a_orders_order_items.sql:140-168`；`20260716180000_m4a_v3a_order_items_vehicle_snapshot.sql:26`；`20260614130000_m3_create_order_stock_snapshot.sql:14`；`20260716120000_m4a_d2_order_items_workflow_status.sql:47-52` |
| `order_items` 刻意沒有成本和經銷價欄，資料庫檢查會擋 | `20260604120000:157-165,169` |
| 網站單的單價依會員等級取目錄價：只有 `store`（後台顯示為「車行」）用 `coalesce(price_store, price_general)`，`general` 和 `premiumStore`（後台顯示為「經銷」）都用 `price_general`；取不到價格就拒絕建單 | `20260915100000_m4b_couponfield_p_d_create_order_redeem_dryrun.sql:372-387`；等級中文名稱 `apps/admin/src/lib/orders/order-list-view.ts:303` |
| 手動單的單價是員工輸入的，而且依 `price_tax_mode` 可能存含稅或未稅 ⇒ 不能拿目錄價直接和 `unit_price` 比 | `20260915233000_m4b_p02a_bank_due_at_helper_and_manual_order_customer_lock.sql:140,439,548,670-678` |
| 這張單用哪個會員等級計價記在 `orders.tier_at_checkout` | `20260914030000_m4b_manual_order_tier_override.sql:7,12` |
| 刪品項時會**跟著刪**的：數量摘要 `order_item_quantity_summary`（`ON DELETE CASCADE`）、成本 `order_item_costs`（CASCADE） | `20260730150000_m4b_e10_a1_order_item_summary_columns.sql:91-94`；`20260914010000_m4b_order_item_costs.sql:78` |
| 刪品項時會**擋下**的（有列就刪不掉）：採購、出貨明細、取消明細、退款帳、退款工作（都是 RESTRICT）；改價申請（沒寫刪除規則 = 預設擋，**已結案的申請也擋**） | `20260729020000_m4b_e10_a2_order_item_procurement.sql:43`；`20260805170200_m4b_e10_b2_s1b_shipment_items.sql:73`；`20260730130000_m4b_e10_a7_order_cancellations.sql:238`；`20260725130100_m3_rf2a2_order_refunds_ledger.sql:165`；`20260731120000_m4b_e10_a7b_m_refund_jobs.sql:484`；`20260915050000_m4b_03_order_amount_requests.sql:49` |
| 「訂單小計 = 各品項金額加總」的檢查是 `DEFERRABLE INITIALLY DEFERRED`，交易結束才檢查 ⇒ 同一交易裡先刪 A 再加 B 不會誤報 | `20260815040000_m4b_e10_13_slice1_admin_update_order_item_amount.sql:312-317` |
| 建單不會預先建立數量摘要列 ⇒ 新增的 B 沒有摘要列，跟剛建好的品項一樣 | `create_order`（`20260915100000`）與手動建單（`20260915233000`）都不寫 `order_item_quantity_summary`（grep 命中 0） |
| 刪 `order_items` 的任何一列，都會由刪除稽核 trigger `pcm_order_items_delete_audit_ad` 把整列快照寫進 `orders_deleted_log`；這筆寫入失敗，整個交易會回滾 | `20260907070000_m4b_orders_delete_audit_trail.sql:183,229` |
| `order_items` 上還有一個「部分取消重算」trigger，只在 UPDATE 時觸發 ⇒ 刪與加都不會叫它 | `20260914070000_m4b_op7_partial_cancel_pending_refund.sql:390-393` |
| 既有「申請改價」RPC 的防重送寫法：先用 advisory lock 鎖住同一個 request id，再查這個 request id 是否已處理過，查到就回上次的結果；之後才查訂單和品項。稽核表的 `request_id` 索引**不是唯一索引**，不能靠它防重送 | `20260915160000_m4b_03_zero_price_reason_fullwidth_rule.sql:131-137`；`20260712210000_m4a_admin_audit_log.sql:78` |
| 成本寫入 RPC：先取 advisory lock `order_item_costs:<品項 id>`，再用一般 SELECT 確認品項存在，已有成本就 `ON CONFLICT` 更新 | `20260914010000_m4b_order_item_costs.sql:174,189,239` |
| 整單取消送出時不帶品項清單（`items: null`）也不帶訂單版本，由 RPC 當下選取全部品項 | `apps/admin/src/lib/orders/cancel-form.ts:300`；`20260914050000_m4b_partpaid_cancel_gate_v2.sql:731` |
| 修改單價 RPC 的慣例：管理者限定（`:1684-1690`）、鎖訂單 `FOR NO KEY UPDATE`（`:1694`）、比對訂單 `version`（`:1698`）、確認品項屬於這張單（`:1729`）、訂單 version +1（`:1806`）、寫稽核（`:1835`） | `20260915060000_m4b_953_p2_rpcs_call_pcm_order_total.sql` |
| 稽核表有 `actor_label`、`actor_is_manager` 快照欄，時間由資料庫 `now()` 填 | `20260914110000_m4b_audit_actor_snapshot.sql:49-51`；`20260712210000_m4a_admin_audit_log.sql:43-58` |
| 稽核頁只對 `orders.item.costs.set` 遮蔽成本給非管理者 | `apps/admin/src/app/settings/audit/page.tsx:113` |
| 優惠券有金額、最低消費、會員等級、期限、使用次數等條件，**目前沒有商品限定** | `20260829150000_m4b_coupon_p1_tables.sql:88,131-134` |
| 手動建單的商品搜尋 `searchManualOrderCatalog`：用料號查規格，回傳規格 id、料號、品名、一般價、經銷價 | `apps/admin/src/lib/orders/manual-order-catalog.ts:135,151-165,186-215` |
| 付款成功信排隊時把內容凍結（`paidSnapshot`），新格式寄送用凍結內容，舊格式才在寄送時重查 | `packages/use-cases/src/enqueue-order-created-emails.ts:190`；`packages/use-cases/src/sweep-email-outbox.ts:2185` |

## 3. 做法：刪 A、新增 B

同一個交易裡：
1. 讀出 A 的完整內容（給稽核用）。
2. `DELETE` A 那一列。數量摘要、成本跟著刪；刪除稽核 trigger 會另外把 A 的整列快照寫進 `orders_deleted_log`，所以一次換商品會留下兩筆紀錄（這一筆和第 5 節的操作紀錄），任一筆寫不進去就整筆不換；任何會擋的關聯資料如果存在，資料庫會直接拒絕（第 4 節已先檢查，這是最後一道保險）。
3. `INSERT` 一列 B（新的品項 id），欄位如下：

| 欄位 | B 的值 | 理由 |
|---|---|---|
| `order_id` | 同 A | |
| `variant_id` / `variant_sku` | B 的 | |
| `product_snapshot` | 用建單同一套寫法組 B 的 title / sku / spec | 資料庫只准這三個鍵 |
| `quantity` / `unit_price` / `line_total` | **照抄 A** | 同價才准換；整列換 |
| `vehicle_snapshot` | 照抄 A | 客人選的車款不變 |
| `availability_at_checkout` | B **現在**的庫存狀態 | 用來追交期，A 的值對 B 沒意義 |
| `workflow_status` | 照抄 A | 品項還沒處理 |
| `version` / `updated_at` | 1 / 現在 | 新的一列 |

4. 訂單 `version` +1、`updated_at` 更新。訂單的小計、總額、付款、優惠券**不動**（各品項金額加總沒變，交易結束時那道小計檢查會確認）。
5. 寫稽核（第 5 節）。

**為什麼這樣比就地改安全**：員工如果開著舊畫面（還顯示 A）去訂貨、填成本、部分取消或建出貨，送出時指向的是已經不存在的 A 品項 id，會被「找不到品項」或外鍵擋下，**不必修改任何既有功能**。

## 4. 什麼情況才准換（全部在資料庫函式裡判斷，不信前端）

**處理順序（R1 修正後）**
1. 檢查參數與操作者（在職員工）。
2. **防重送**：advisory lock `order_item_swap:<request id>`，再查稽核表有沒有 `action = 'order.item.swap'` 且同一個 request id 的紀錄。
   - 有，而且請求內容（訂單 id、A 品項 id、B 規格 id、訂單版本）跟當時記下的一樣 ⇒ 回上次的結果（含新品項 id），不再做任何事。
   - 有，但內容不同 ⇒ 拒絕「這個請求編號已經用過，請重新整理再操作」。
   - 這一步必須在「確認 A 存在」**之前**：第一次成功後 A 已經被刪掉，放在後面的話重送一定會被當成錯誤。
3. `orders` 那一列 `FOR NO KEY UPDATE`（同修改單價）。
4. advisory lock `order_item_costs:<A 品項 id>`（跟成本寫入 RPC 同一把，而且同樣先拿這把、再碰品項）。這樣「讀成本 → 刪除 → 記稽核」期間，管理者不可能同時改成本，稽核記下的成本就是被刪掉的那一筆。
5. `order_items` A 那一列 `FOR UPDATE`，條件寫成 `id = p_item_id AND order_id = p_order_id`，查不到就拒絕。
   - 這裡用 `FOR UPDATE` 是因為接著要刪它（刪除本來就要這個強度的鎖），提前拿可以讓後面的檢查看到的就是最終狀態。
   - 如果另一個交易正在替 A 新增採購（子表外鍵會對 A 取 `KEY SHARE`），換商品會等它結束，再看到那筆採購而拒絕。這個交錯順序和死結可能性要在片 1 用兩個 session 實測。
   - 成本寫入 RPC 不鎖訂單，所以「訂單 → 成本鎖 → 品項」和它的「成本鎖 → 品項」同方向，不會互等。

**全部鎖到之後才檢查（任何一條不過，整筆不動，回一句員工看得懂的原因）**
1. 訂單沒有被整單取消。
2. 畫面送來的**訂單** `version` 等於現在的值，不等就回「資料已被別人改過，請重新整理」。舊的改價畫面也會因為訂單 version 變了而被擋。
3. 採購、出貨明細、取消明細、退款帳、退款工作、改價申請（**任何狀態**）都沒有 A 的列；數量摘要沒有列或全部是 0。
4. **整張單沒有任何退款**：`orders.payment_status` 不是已退款或部分退款，而且退款帳、退款工作、人工退款（未作廢的）都沒有這張單的列。
5. **同價**：A 和 B **現在的目錄價**依 `orders.tier_at_checkout` 用建單同一套規則算（`store` 用 `coalesce(price_store, price_general)`；`general`、`premiumStore` 用 `price_general`），兩者必須相等。任一邊取不到價格就拒絕。
   - 注意：`store` 在後台顯示為「車行」、`premiumStore` 顯示為「經銷」，實作要照等級代碼，不能照中文名稱判斷。片 1 三個等級分別測。
   - 比的是目錄價，不是 A 的 `unit_price`：手動輸入的價格、未稅單、人工改過價的單都不會被誤判，B 照抄 A 的單價。
   - A 的規格已被刪除（`variant_id` 是空的）就拒絕。
   - 價格由資料庫自己讀，前端送來的價格一律不用。
   - 價格不同時的提示：「兩個商品的目錄價不同（A：X 元，B：Y 元），不能直接換。請取消這個品項後重新建立。」
6. B 存在、商品目前上架；B 和 A 是同一個規格 ⇒ 回「沒有變更」，不寫任何東西。

## 5. 操作紀錄怎麼寫

- 寫進 `admin_audit_log`，跟換商品同一個交易，失敗就一起不寫。
- action：`order.item.swap`；target：`order:<訂單 id>`，這樣用訂單去查，找得到這一筆。
- 誰、什麼時間：沿用稽核表既有的 `actor`、`actor_label`（當下的員工名稱快照）、`created_at`（資料庫時間）。
- before（A）：品項 id、規格 id、**料號**、**品名**、規格、數量、單價、庫存狀態、成本（有填才記）。
- after（B）：新品項 id、規格 id、**料號**、**品名**、規格。
- 操作紀錄畫面的顯示文字：「王小明 2026-09-22 14:03 換商品：A 料號 A 品名 → B 料號 B 品名」。
- 成本只有管理者看得到：稽核頁的遮蔽規則加上 `order.item.swap`，在伺服器端把 before 裡的成本拿掉，並加一個測試確認非管理者拿到的資料不含成本值。

## 6. 會動到什麼

**資料庫（1 支 migration）**
- 新 RPC `admin_swap_order_item(p_actor, p_request_id, p_order_id, p_item_id, p_expected_order_version, p_new_variant_id)`：`SECURITY DEFINER`、`SET search_path = ''`、物件全部寫完整名稱；撤銷 `PUBLIC`、`anon`、`authenticated`，只授權 `service_role`。
- 防重送：照第 4 節步驟 2。稽核的 after 同時記下請求內容指紋（訂單 id、A 品項 id、B 規格 id、訂單版本）和新品項 id，重送時拿來比對和回傳。
- **不加欄位、不改既有函式、不改既有資料表。**

**程式**
- `apps/admin/src/lib/orders/`：換商品的伺服器動作與 repository 方法；結果分成「已換」「資料已變更」「沒有變更」「不能換（附原因）」。
- 商品搜尋直接用 `searchManualOrderCatalog`。Sean 2026-08-31 對建單畫面的裁定是「搜尋結果只顯示、不自動帶入欄位」（`manual-order-catalog.ts:11-44`）；換商品是讓員工從結果裡明確點選一筆再按確認，不會自動帶入其他欄位。
- 訂單詳細頁品項列加入口，對話框並排顯示 A 與 B 的料號、品名、目錄價，按「確認換成這個商品」才送出。後台訂單 UI 正式設計稿（OD `pcm-524f` 的 `HANDOFF-orders-ui.md`）沒畫這個入口，實作前先在稿上確認位置。
- 稽核頁：成本遮蔽加上新動作；顯示文字。

## 7. 對已付款的單與客人的影響

- 收款、付款紀錄、退款上限、優惠券條件、訂單小計與總額都不動 ⇒ 已付款的單也可以換。
- 客人看得到的變化：
  - 會員中心的訂單紀錄：顯示 B。品項的排列順序可能改變（`order_items` 沒有建立時間欄，片 3 確認後台和會員中心用什麼排序，必要時照料號排）。
  - 付款成功信：已寄出的仍寫 A；還在排隊的新格式信已凍結 A，寄出來也是 A；只有舊格式排隊信會寫 B。
  - 出貨信：出貨時才組內容，會寫 B。
- Sean 選了 Q4 甲（不寄信），以上情況都在這個前提下接受。

## 8. 出事怎麼退回

- **程式有問題**：revert 程式那一顆 commit，入口消失；新 RPC 沒人呼叫，不影響其他功能。
- **新 RPC 要拿掉**：rollback 檔 `DROP FUNCTION public.admin_swap_order_item(...)`，不影響任何既有功能。
- **某一筆換錯了**：如果 B 仍然沒被處理、A 仍然上架且目錄價沒變，用同一個功能換回 A（會是另一個新的品項 id）；成本若原本有填，從稽核的 before 找回再填。任一條不成立，就照現有流程取消後重建。
- **整單取消不受這個保護**：整單取消不帶品項清單，送出時取消的是「當下」所有品項。員工開著顯示 A 的舊頁面按整單取消，會取消到 B。這是接受的例外：整單取消的意思本來就是整張單都不要了，而且 B 的單價、數量和 A 完全一樣，退款金額不會不同。不為此修改整單取消。
- **舊畫面送出被擋時的提示**：訂貨、填成本、部分取消遇到「找不到品項」時，錯誤可能不夠白話。片 4 走一遍時逐一確認，不清楚的補上「這個品項已被更換，請重新整理」。

## 9. 切片與時間估計

| 片 | 內容 | 估計 |
|---|---|---|
| 1 | migration：新 RPC + 前置 / 事後檢查 + rollback；拋棄式 PG 逐條測第 4 節（每條先確認會擋、再確認正常會過），含三個會員等級的取價、`orders_deleted_log` 與操作紀錄同時寫入（任一失敗整筆回滾）、跨單參數、舊 version、同一個 request id 重送（同內容回原結果、不同內容被拒）、兩個 session 同時「換商品 vs 新增採購」與「換商品 vs 新增 / 更新成本」 | 45 分鐘 |
| 2 | repository + 伺服器動作 + 結果對應 + 單元測試 | 30 分鐘 |
| 3 | 訂單詳細頁入口 + 對話框 + 擋下的提示文字；確認品項排序 | 45 分鐘 |
| 4 | 稽核頁成本遮蔽 + 顯示文字 + 測試；本機走一遍：換成功、價格不同被擋、已訂貨被擋、舊畫面送出訂貨被擋 | 30 分鐘 |

**共 4 片，約 2.5 小時。** 片 1 的 migration 要等 Sean 貼上正式庫；程式要用到還沒套用的 DB 變更 ⇒ 板先貼、程式後推。

## 10. Sean 已經回答的題目（2026-09-22，主視窗轉述）

| 題 | 答案 |
|---|---|
| Q1 目錄價不同 | 甲：擋下 |
| Q2 誰能換 | 甲：所有在職員工 |
| Q3 數量大於 1 | 甲：只能整列換 |
| Q4 通知客人 | 甲：不寄信，只記操作紀錄 |
| Q5 做法 | 甲：刪 A、新增 B |

目前沒有其他要 Sean 決定的題目。

## 11. 第一版（就地改品項）的審查紀錄

- R1：FAIL，7 個必須修正（鎖、訂單 version、成本鎖、成本外洩、手動單含稅判斷、品項歸屬、採購與成本的舊畫面）。本版保留的修正：鎖訂單與品項、比對訂單 version、比目錄價而不是單價、綁定品項屬於這張單、稽核成本遮蔽、庫存快照。
- R2：FAIL，4 個必須修正。其中 3 個（採購、成本、部分取消的舊畫面會寫到 B）都因為品項 id 不變；本版改成刪 A、新增 B 後不再成立。第 4 個（訂單層退款）已寫進第 4 節條件 5。
- 第一版要改的兩支既有 RPC（採購、成本加參數）本版不再需要，連帶那條「重建時會蓋掉 search_path 修正」的風險也消失。

## 12. 第二版 R1 審查修正對照

| R1 | 等級 | 本版怎麼改 |
|---|---|---|
| 1 成本可能在換商品讀完之後被改，稽核記錯 | must-fix | 第 4 節步驟 4：先拿成本寫入同一把 advisory lock |
| 2 先確認 A 存在，會讓成功後的重送變成錯誤；稽核表不能當防重送 | must-fix | 第 4 節步驟 2：先鎖 request id、查重送、比對內容指紋 |
| 3 整單取消的舊畫面仍會取消 B | should-fix | 第 8 節明列為接受的例外並說明理由 |
| 4 優惠券條件寫得太簡化 | nit | 第 2 節改寫 |

## 13. 第二版 R2 審查（PASS）與修正

R2 結論：沒有新的必須修正；R1 兩條必須修正已確認修好。

| R2 | 等級 | 本版怎麼改 |
|---|---|---|
| 1 漏列刪除稽核 trigger | should-fix | 第 2 節、第 3 節步驟 2 補上；片 1 驗證兩種紀錄同時寫入 |
| 2 「經銷」用語和取價分支對不上 | nit | 第 2 節、第 4 節條件 5 改用等級代碼，並提醒中文名稱的差異 |
| 3 行號沒涵蓋實作 | nit | 第 2 節改成 `372-387`、`670-678` |
