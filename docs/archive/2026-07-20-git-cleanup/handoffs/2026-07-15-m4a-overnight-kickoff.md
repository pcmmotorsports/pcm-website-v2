# 過夜施工 kickoff — 訂單列表改造(D 線)+ 車款全站連動(V 線)(2026-07-15 深夜)

> **給實作視窗**。Sean 已拍板全部方向並授權過夜直接做完(不等批);Fable 值班審查台整夜在線,溝通全走 `pcm-tools/review-inbox/`(你丟單、我寫 verdict,不經 Sean 橋接)。
> **硬護欄(Sean 授權不含這些):不 push、不 apply migration、不 deploy、不動 .env**;migration 檔 commit 標 pending、早上 Sean 統一 db push+push dev。

## Sean 拍板(2026-07-15 深夜,逐字對照)
- **Q-A=A**:訂單狀態改**每商品各自一個**;整單狀態=自動彙總顯示(全同→該色、混合→「多狀態」)、不再手設;`orders.workflow_status` 欄保留停寫不 DROP。
- **Q1=A**:車款=每商品可各標、購物車頂填一次整車套用、單列可覆寫。
- **Q2=A**:由車款搜尋加入購物車 → 自動帶入該車款(顯示可改)。
- **Q3=B**:下單填的車款**不回存車庫**。
- **Q4 擴充**:「選擇我的愛車」出現在**所有**車款選擇點(首頁依車輛搜尋/型錄篩選/商品頁確認適用車款/購物車),全站同一元件同一 context 連動。依建議流程直接做完;審查輪上限放寬:>2 輪可跑第 3/4/5 輪。

## 真權威(先讀)
1. `docs/specs/2026-07-15-m4a-order-list-redesign-slice-d-plan.md` + verdict `pcm-tools/review-inbox/m4a-order-list-redesign-slice-d-plan.verdict.md`(A1/C1/經銷隔離三護欄/切法已裁)。
2. `docs/specs/2026-07-15-order-item-vehicle-capture-design.md` **v0.2**(拍板已折入;§6 全站連動、§7 保守匹配紅線、§8 順序)。

## 施工順序(每片:三綠+code-reviewer+commit 精準 add;高風險片另加硬閘)
1. **D-1** admin 列表改 order_items 主體(每商品一列、同單分組、brand join C1、tier 映射、即時篩選=URL searchParams 驅動 server 重取);列狀態暫顯所屬訂單狀態;車款欄暫隱藏。🔴 新投影白名單 byte-lock;`tier_at_checkout` 由 forbidden 移 allowed=有意識變更、註明依據。
2. **D-3** order_status_options CRUD 設定頁(Slice A ACL 已備;UI 不提供改 code;'unset'/'__clear__' 保留字已 DB 擋)。
3. **D-2** per-item 狀態:migration(order_items +workflow_status +version〔+updated_at 若 RPC set〕+backfill 繼承所屬訂單、5/30 多商品單同值)+ `admin_update_order_item_workflow` owner RPC(鏡像 Slice C 全套;🔴 SET 字面**絕不含 quantity/unit_price/line_total/variant_***;audit target='order_item:<id>')+ UI 切 item 層+整單彙總顯示。**硬閘:交易模擬(BEGIN→ROLLBACK 零留痕)+丟 Fable 對抗審+Codex 盲審。不 apply。**
4. **V-1** VehicleSelect 統一元件(可打字三層 typeahead,資料=product_fitments_effective 字典直出;登入會員愛車快選 chips)落**型錄篩選+首頁**。🔴 鐵則 1:動前台先 grep design-reference;車款 context 用 URL/storage 跨頁帶。
5. **V-2** 購物車車款欄(整車套用+單列覆寫+搜尋自動帶+車庫預填+freetext fallback+「建議填寫」hint)+ 商品頁「是否適用我的車」比對(🔴 §7 保守規則:字典鍵精確比對才判✓;freetext 一律「人工確認」;禁模糊/AI 猜;字典匹配=對抗驗證不降級、實作後附樣本實測)。
6. **V-3** order_items.vehicle_snapshot migration + create_order optional vehicle 參數(🔴 金流 RPC:只加 optional 參數+snapshot 寫入,金額/庫存/冪等邏輯零觸碰)+ admin 列表車款欄點亮。**硬閘同 D-2。**

## 審查協議(過夜版)
- 每片單丟 `pcm-tools/review-inbox/m4a-<slug>.md`;我 15s 內哨兵接手、verdict 寫回同名 `.verdict.md`;你輪詢 verdict。
- 高風險片(D-2/V-3)必過我+Codex;例行 UI 片 code-reviewer 即可、我抽查。輪次:PASS 含 nit 修完即收;FAIL 修完丟下一輪;上限 5(Sean 拍板放寬)。
- 卡方向岔路(拍板未覆蓋)→ 寫 `BLOCKED-<slug>.md` 進 inbox 說明+你的建議,**跳做下一片不空等**;我 triage 能代判就代判(可逆+範圍內),不能代判就整理決策題進晨報。
- 🔴 字面 vs 事實:每個「已修/已測」自報,先磁碟 grep 再寫單(前晚顯示損壞事故教訓);我這邊一律磁碟/DB 實查,不採信自報。

## 🆕 Sean 睡前追加(2026-07-15 深夜第二則;UX 痛點=V-1 需求、Fable 已核根源)
1. **返回瀏覽狀態保留**:選車款→點大分類→進商品→上一頁,分類/車款跳掉。根源=ProductsPage 篩選(vehicle cascade/category/extras)在 useReducer/useState、只有 page/sort/perPage 進 URL(`ProductsPage.tsx:196-198` useBrowseUrlState)。修=**車款+分類(至少)進 URL searchParams**——與 V-1 跨頁車款 context 同一底層、一次解。
2. **膠囊拆三顆、可單刪年份**:現 `ActiveChips.tsx:27-31` 整台車一顆 chip、onRemove=clearVehicle() 全清。修=brand/model/year 各一顆;刪 brand 連動清 model/year、刪 year 保留 brand+model。
3. **篩選欄位鏡像膠囊**:首頁選車進商品頁,膠囊有車款但上方篩選欄沒預設同值(客人選錯年份要全部重選)。修=V-1 單一車款 context,FilterTop/Drawer 的三層選擇器**恆顯示 context 現值**、改任一層=改 context。
4. 搜尋功能未開=Sean 無法測;現況維持、不在本夜範圍(另有 #274/#275 搜尋線)。
→ 1-3 併入 **V-1 驗收條件**(不是 nice-to-have);實作時 grep design-reference 對齊視覺、行為層以本節為準(Sean 口述=授權)。

## 🆕 W 批次:UX quick-win 填縫(選配;D/V 主線全收才碰、或審查等待空檔;完整證據=scratchpad `ux-audit-overnight.md`)
Fable 已 triage 全站 UX 盤查 20 條:以下 **8 條=無爭議功能修補、綠燈直做**(每條 S 級、單獨 commit、code-reviewer 即可):
- W1 手機 hover-only 修補:收藏/快速加購觸控裝置常駐顯示(`product-card.css:92,96`+`ProductCard.tsx:160`,加 `@media (hover:none)`)。
- W2 商品卡假「+加入購物車」鈕:先移除(現 `ProductCard.tsx:186-188` 只 stopPropagation、零邏輯、誤擋跳轉);真接邏輯=另片。
- W3 篩選 0 結果/載入失敗加「清除全部篩選」「重新載入」鈕(`ProductsPage.tsx:318,360`)。
- W4 商品頁加購成功/失敗 toast(`ProductInfo.tsx:240-249`,補 TODO M-1-13g)。
- W5 「搜尋品牌」輸入框接真過濾(`FilterSide.tsx:336`+`FilterDrawer.tsx:301`,client-side filter)。
- W6 換排序/篩選後捲回列表頂端;統編/愛心碼加 `inputMode="numeric"`。
- W7 購物車 +/− 觸控目標 ≥44px(`cart.css:119-120`);手機篩選抽屜補 Esc 關閉+焦點移入(對齊桌機版既有做法)。
- W8 WalletTab 對客顯示的開發註記文字「(本段於 g-7 接入)」移除(`WalletTab.tsx:6`)。
🔴 **不在綠燈內、勿自作主張**(內容/品味/範圍,Fable 整理進晨報給 Sean 拍):404 三入口(品牌/安裝/店家)佔位頁文案、愛心假動作止血方式、忘記密碼 LINE 導流、缺圖示意圖標示、訪客結帳、首購地址 inline 表單、結帳/會員/變體狀態進 URL 系列(M 級)、條款隱私頁。

## 早上交接
- Fable 產晨報(進度/verdict 鏈/待 Sean:push dev + db push 批次清單 + 肉眼驗點 + 決策題若有)。
- 你收工前:STATUS 7 欄同最後 commit 更新(若無平行 session 撞 index 風險)+ busboy-end。
