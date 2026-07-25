# 後台重建完整規格(提案 v1,待 Sean 拍板)

> **狀態:** 🟡 提案、**尚未拍板、尚未實作**
> **建立:** 2026-07-25
> **北極星(Sean 2026-07-25 定調,逐字):** 「可以完整上線給員工使用,操作,修改網站。而且他們不是工程師,單純可以從後台編輯商品、新增商品、接非網站有的商品訂單、匯款、編輯客人訂單內容、備註、快遞單號輸入、單號追蹤、email 通知之類」
> **範圍演進:** 訂單後台 → 「要做就做全面」全站後台 → 上述北極星。
> **驗收標準不是「功能抄得多齊」,是「員工能不能不找工程師就把一天跑完」。**
> **研究底稿(10 份、2206 行,已入 repo):** `docs/specs/research-2026-07-25/` —— 8 份平台研究(Shopify / Medusa v2 / Odoo+WooCommerce+AutoDS / 真瀏覽器 admin UX / 商品後台 / 後台通用 UX 規範 / 客戶價格設定供應商 / 內容媒體營運)+ 2 份 PCM 現況盤點(訂單域 / 訂單以外全域)。每份末段都有「未確認清單」,實作前逐項回查。
> **訂單域細部對照表**(三平台狀態軸逐值比較)另見 `docs/specs/2026-07-25-order-backend-model-spec.md`。

---

## 0. 🔴 與既有規劃對帳(本檔不另立體系)

**同日稍早已存在** `docs/specs/2026-07-25-site-wide-gap-and-admin-platform-plan.md` **v3**(43KB / 467 行,經 codex 關卡1 兩輪、19 findings 折入),內含 **Sean 已拍板的六題**與 **E0-E9 epic 施工順序**。
🔴 **本檔不推翻它、不重編 epic 編號。** 本檔 = 該 plan 的**訂單域補完 + 員工驗收視角 + 平台研究實證**。

### 0.1 Sean 已拍板、本檔一律沿用(不得重問)

| 題 | 拍板 | 對本檔的約束 |
|---|---|---|
| Q2 圖片存哪 | **A** Supabase Storage(ADR-0004) | §5.2 圖片上傳不再比較 R2 |
| Q4 內容發布模型 | **A** 草稿→預覽→發布→可回上一版;AI 改的一律先當草稿 | §5.5 內容型別沿用此模型 |
| Q5 手動商品邊界 | **B 完整商品**(公開可搜尋/可下單/可管庫存/可下架) | 🔴 北極星第 3 項「接非網站有的商品訂單」**已被此拍板涵蓋且放大**=E6b |
| Q6-1 手動商品價格 | **A** 後台專屬表單 + 每次設價留紀錄 | §5.2 價格走獨立窄路、不進內容 override |
| Q6-2 內容改動頻率 | **B** 一季 1-3 次 = L2 | 內容管理非鐵則 9 強制、可排後 |
| Q1 施工順序 | **A** 先修搜尋(E0) | 本檔新增 epic 一律排在 E0 之後 |

### 0.2 既有 E0-E9 涵蓋範圍(本檔不重做)

E0 搜尋 / E1 客戶累計消費 / E2 內容發布合約 / E3 圖片上傳 / E4 首頁媒體 / E5 權威鎖地基 / E6a 同步商品後台 / E6b 手動商品 / E7 AI 改商品 / E8 後台強化(dashboard+角色分級+搜尋)/ E9 品牌落地頁。

### 0.3 🔴 本檔補的缺口(既有 plan **沒有**的)

| 新 Epic | 內容 | 為何既有 plan 沒涵蓋 |
|---|---|---|
| **E10 訂單後台補完** | 計數器 / 退款退貨 UI / 快遞單號 / 備註 / 手動建單 / 匯款確認 / 改單 | E0-E9 **完全沒有訂單 epic**;Sean 北極星第 4-13、15、17-19 項全落在此 |
| **E11 後台 UI 積木** | DataTable / Form / Modal / toast / 手機轉卡片 | 既有 plan 未提;現況 0 個共用抽象,不做則每個 epic 各手刻一份 |
| **E12 供應商主檔** | suppliers 表 + 供應商商品價目表 | 既有 plan 未提;PCM 代購本質,Shopify/Medusa 皆無範本、只有 Odoo 有 |

**E8「角色分級」的硬前置本檔補明**:`apps/admin/src/lib/staff.ts:3` 逐字「臨時解:M-4b 完整帳號/權限前先 hardcode 名單」——**員工帳號目前是寫死的**,Sean 北極星「給員工使用」= E8 從「強化」升為**上線硬前置**。

---

## 1. 驗收標準:員工的一天

每一片實作都要能回答「這片讓員工多做完哪一件事」。答不出來 → 延後。

| # | 員工要做的事 | 現況 | 證據 |
|---|---|---|---|
| 1 | 看今天要處理什麼 | ❌ 無待辦檢視 | admin 無 saved views |
| 2 | 看訂單明細 | ✅ | `order-detail.tsx` 4 卡 |
| 3 | 訂單寫備註 | ❌ orders 無備註欄 | `pcm-order-inventory.md §1.1` |
| 4 | 標商品進度 | ⚠️ 逐列下拉、無批次 | `item-workflow-status-cell.tsx` |
| 5 | 標「已向供應商下單」 | ⚠️ 整單一個、無法只標一項 | `fulfillment_status` 在 orders 表 |
| 6 | 記供應商單號/預計到貨 | ❌ | 無欄位 |
| 7 | 缺貨要等 | ❌ 無此狀態 | `fulfillment_status` 4 值 |
| 8 | **輸入快遞單號** | ❌ | orders 無 tracking 欄 |
| 9 | **單號追蹤** | ❌ | 同上 |
| 10 | 列印出貨單/揀貨單 | ❌ | 無 |
| 11 | Email 通知客人出貨 | ⚠️ 骨架在、此觸發點未接 | `email_outbox`(M-4a B 線) |
| 12 | **手動建單(非網站商品)** | ❌ | `order_source` 三 manual 值只用於篩選 |
| 13 | 改訂單內容(品項/數量/金額) | ❌ 只能改出貨方式+發票 | `order-edit-form.tsx:90` |
| 14 | 刷卡收款 | ✅ 已上線 | TapPay 3DS,首筆 2026-07-24 |
| 15 | **匯款確認收款** | ❌ 無流程 | `payment_channel` 有 bank_transfer 值 |
| 16 | 今日對帳 | ❌ | 無 |
| 17 | **退款操作** | ❌ 帳本在、UI 全無 | `grep order_refund apps/admin/src` 零命中 |
| 18 | 退貨收回 | ❌ 無「貨的軸」 | 無 return 表 |
| 19 | 取消訂單 | ⚠️ 原因是自由文字 | `cancelled_reason text` |
| 20 | **新增/編輯商品** | ❌ **完全不存在** | admin 無 products route |
| 21 | **上傳商品圖片** | ❌ | 圖片是供應商 CDN URL |
| 22 | 改價格/上下架 | ❌ | 同 20 |
| 23 | 匯入供應商 Excel | ❌ admin 內無 | 只有 repo 根 `scripts/rpm-*.ts` CLI |
| 24 | 匯出訂單/商品 | ❌ | 無 |
| 25 | 改客人資料 | ⚠️ 只能改等級+儲值金 | `customers/[id]` 二表單 |
| 26 | 員工各自帳號與權限 | ❌ **hardcode 名單** | `apps/admin/src/lib/staff.ts:3` |
| 27 | 誰改了什麼 | ⚠️ 有 log 表、無 UI | `admin_audit_log` |

**✅ 3 項 / ⚠️ 6 項 / ❌ 18 項。**

---

## 2. 現況總表

### 2.1 admin app 全貌(2026-07-25 實查)

| 項目 | 數量 | 備註 |
|---|---|---|
| 業務頁面 | **5** | 訂單列表、訂單明細、客戶列表、客戶明細、訂單狀態設定 |
| 側邊選單項目 | **4** | 總覽/訂單/客戶/設定(`app-sidebar.tsx:23-28` 硬列,**不含商品**) |
| 共用列表頁抽象 | **0** | orders-table 210 行 vs customers-table 60 行,各寫各的 |
| 共用表單頁抽象 | **0** | 三個編輯表單各自手刻 `<form action>` + FormData |
| 共用 Modal | **0** | 走整頁表單/sheet,無 dialog |
| `@pcm/ui` 匯出 | **1** | 只有 `cascadeFilterReducer`,**不是元件庫** |
| admin server action | **10** | 訂單 5 + 客戶 2 + 設定 2 + actor 1 |
| 商品寫入路徑 | **0**(admin 內) | 唯一路徑是 repo 根 `scripts/rpm-*.ts` CLI |

### 2.2 資料層(已有,不必重建)

- **訂單域 8 張表**:orders / order_items / payment_charge_attempts / payment_double_charge_anomalies(+events)/ order_status_options / **order_refunds / order_refund_items**(2026-07-25 上線)
- **商品域 5 張表**:products / brands / categories / product_variants / product_fitments(+ product_image_trim)
- **會員域 4 張表**:customers / customer_addresses / customer_vehicles / customer_wallet_ledger
- **狀態軸**:`payment_status` 5 值、`fulfillment_status` 4 值
- **稽核**:`admin_audit_log`(tier/wallet 兩個 RPC 已同交易寫入)

### 2.3 已有的好地基(直接複製,不重新設計)

1. **授權閘**:`authorizeAdminMutation()`(`apps/admin/src/lib/session/authorize.ts:24-35`)三道——session 自驗 + Origin fail-closed + 具名 actor。所有新 server action 一律走它。
2. **RPC + 同交易稽核**:`admin_set_customer_tier` / `admin_adjust_wallet` 模式——窄權 SECURITY DEFINER、EXECUTE 只 GRANT service_role、寫 `admin_audit_log`。所有新後台寫入照抄。
3. **經銷價縱深防護**:`price_store` 三層擋(REVOKE ALL + 逐欄 GRANT / security_invoker view 排除 / RLS)。**新後台頁面不得繞過。**
4. **Email outbox**:比 Medusa 官方範例更進階(outbox pattern),接上即可,不重做。
5. **退款帳本**:`order_refunds` 形狀(冪等鍵、複合 FK、DEFERRED 一致性 trigger)——新表照鏡。

---

## 3. 三個結構性決定

### 3.1 訂單:計數器是真相,狀態是顯示

**三家平台一致(Shopify / Medusa / Odoo),且與 PCM 現行做法相反。**

Medusa `OrderItem` 每列 8 個數量欄(`packages/modules/order/src/models/order-item.ts`);Shopify `ReturnLineItem` 6 個數量欄 + `RefundLineItem.quantity`;Odoo Reverse Transfer 數量可編輯。

> **這解掉「一單三列退兩列」與「一列 3 個退 1 個」**:不發明狀態值,只記數字。也避開「付款 3 × 出貨 4 × 退貨 3 = 36 格」組合爆炸。

**PCM 目標**:`order_items` 加計數器欄
```
quantity(已有) / ordered_quantity / instock_quantity / shipped_quantity
/ return_requested_quantity / return_received_quantity / cancelled_quantity
```
不變式用 CHECK 鎖:各值 ≤ quantity,且 ordered ≥ instock ≥ shipped 逐級遞減。

🔴 **反面教材**:Medusa 把 payment/fulfillment status 做成純衍生值,結果官方 admin **無法用這兩軸篩選排序**(GitHub issue #14095,仍 open)。**PCM 必須維持實體 enum 欄 + 索引**,由 trigger 從計數器同步。

### 3.2 錢與貨分兩條線

Shopify `Return`(貨)/ `Refund`(錢,無自己的 status);Medusa `Return` / `OrderTransaction`;Odoo Reverse Transfer / Credit Note。三家都分離。

**PCM 目標**:新增 `order_returns` / `order_return_items`(鏡射既有退款帳本形狀),`order_refunds` 加 nullable `return_id`——**可以只退錢不收貨**。

「已出貨才退款、貨還沒收回」= 貨的軸上的中間態(Shopify 叫 Return in progress),與錢無關。

### 3.3 先做積木,再做頁面

現況:0 個共用列表/表單抽象,每頁手刻。要新增商品、供應商、庫存等多個域,**沒有積木就是把手刻重複 N 次**。

**先做**:`<AdminDataTable>`(篩選 pill / 分頁 / 選取 / 批次列 / 手機轉卡片)、`<AdminForm>`(主側兩欄 / sticky 儲存列 / 雙層錯誤 / 未存離開警告)、`<AdminModal>`、統一 toast。

這一步不新增任何員工功能,但**後面每個域都省一份**。

---

## 4. 通用 UI 規範(全後台一致)

來源:Polaris 官方規範 + Odoo demo 真瀏覽器實測(截圖 `scratchpad/shots2/`)。

1. **手機版列表一律轉卡片**,不做橫向捲動表格。主要欄位加粗置頂、次要副行、金額/狀態靠右。(Sean 常用手機遠端操作;現行訂單列表 13 欄在手機上不可用)
2. **已套用篩選用可個別移除的 pill** 顯示在列表上方,支援單一移除 + 全部清除,不藏進彈窗。
3. **表單錯誤雙層**:頂部 critical banner 總結 + 移焦點,同時每欄 inline error。只做一種使用者找不到錯在哪。
4. **批次操作**:選取後動作按鈕**內嵌替換列表標題列**(Polaris + Odoo 都這樣),不做浮動 bar。跨頁全選需獨立文案。
5. **分頁**:>50 筆才出現;用「共 N 筆 + 上一頁/下一頁」,不做頁碼輸入框。
6. **破壞性動作**必須二次確認;**未儲存變更離開**必須警告。
7. **Toast** 至少 10 秒(無障礙要求)。

---

## 5. 領域規格

### 5.1 訂單(補完 §1 的 1-19 項)

- `order_items` 加計數器(§3.1)
- 新增 `order_returns` / `order_return_items`(§3.2)
- `orders` 加:`note`(客人備註)、`internal_note`(內部備註)、`tags text[]`、`tracking_number`、`tracking_carrier`、`shipped_at`、`delivered_at`、`cancel_reason`(enum,抄 Shopify 6 值 customer/declined/fraud/inventory/other/staff,取代自由文字)
- `fulfillment_status` 加 `delivered` + `backorder`(⚠️ `ALTER TYPE ADD VALUE` 不可逆、新值同交易不可用,必須獨立 migration——RF2a 已踩過)
- **手動建單**:`order_source` 三個 manual 值已備,補建單表單。🔴 **「非網站有的商品」需先驗證 `create_order` RPC 是否允許自由品項**(`order_items.variant_id` 本身 nullable,但 RPC 是否放行未查證)
- **匯款收款**:`payment_channel='bank_transfer'` 已備,補「確認收款」操作 + 稽核
- **訂單改單**:抄 Medusa `OrderChange` 的「逐動作 event log + 版本號」,不是存改前改後兩份

### 5.2 商品(§1 的 20-24 項,**從零開始**)

抄 Medusa 商品編輯頁版面(原始碼可驗):
- **主欄**:基本資料 → 圖片 → 規格選項 → 變體
- **側欄**:上架狀態 → 運送設定 → 分類歸屬 → 屬性

重點功能(依 PCM 槓桿排序):
1. **變體矩陣批次生成**(設定選項 → 一鍵生成所有組合 → 批次改價格/庫存)—— PCM 規格變體量大,槓桿最高
2. 圖片上傳 + alt text(現在只有供應商 CDN URL,無上傳)
3. 商品狀態(草稿/上架/下架/封存)
4. 供應商 Excel 匯入 UI(把 `scripts/rpm-*.ts` 包成後台功能)
5. 匯出 CSV

決策點:**圖片能否跨商品重用**(Shopify 有媒體庫、Medusa 綁死單一商品)→ Q6。

### 5.3 客戶

補:改姓名/電話/Email/地址/愛車(現在只能改等級+儲值金);客人訂單歷史嵌入明細頁;標籤與備註。
分級經銷價的規則引擎參考 Medusa `PromotionRule`(`customer.group.id` 條件式)而非 Shopify Segment。

### 5.4 供應商 / 採購(PCM 代購本質,兩大平台都沒有)

🔴 **現在沒有 `suppliers` 表**,供應商只是 `products.supplier_slug` 一個字串欄。
抄 Odoo:供應商主檔 + **供應商商品價目表**(Vendor / Product / 量階 Quantity / Unit Price / 有效期 / 折扣%)。
代購狀態鏈參考 AutoDS:待處理 → 已向供應商下單 → 供應商已出貨 → 已送達(+異常)。

### 5.5 內容 / 媒體

- 通用「自訂內容型別」(Metaobject 概念)—— 現在品牌介紹、安裝資源各刻一套,每加一種內容就再刻一次
- 媒體庫(搜尋 / alt text / 重用)
- 🔴 **301 轉址管理表** —— PCM 有改 handle 前科,漏了就是安靜的 SEO 流失

### 5.6 設定 / 權限

🔴 **`apps/admin/src/lib/staff.ts:3` 逐字**:「臨時解:M-4b 完整帳號/權限前先 hardcode 名單」——員工帳號目前是**寫死的名單**。Sean 的北極星要求多員工使用 → **這是硬前置**。
Medusa 官方**沒有 RBAC UI**(要自兜);Shopify 是 19 大類細顆粒度權限。PCM 取中間:角色制。
最關鍵決策:**員工看不看得到成本與經銷價** → Q1。

---

## 6. 待 Sean 拍板

🔴 **已在 §0.1 拍板的六題不重問。** 以下 8 題是既有 plan **未涵蓋**的新決策。

| # | 題目 | 為何重要 | 狀態 |
|---|---|---|---|
| N1 | **員工看不看得到成本/經銷價** | 改架構;經銷價三層防護的邊界要重畫 | ⏳ |
| N2 | **幾個員工、要不要分角色** | 決定 E8 權限模型複雜度;`staff.ts` hardcode 是上線硬前置 | ⏳ |
| N3 | §1 的 27 項驗收清單還漏了什麼 | 北極星完整性;漏的項目上線後才發現最貴 | ⏳ |
| N4 | **E11 積木先做,還是邊做功能邊長** | 先做=慢起步快後續;邊做=快起步但每 epic 重刻一次 | ⏳ |
| N5 | **E10 訂單後台插在 E0-E9 的哪裡** | 既有順序無訂單 epic,但北極星有 12 項落在訂單域 | ⏳ |
| N6 | 圖片能否跨商品重用(媒體庫 vs 綁死單一商品) | Q2 已定存 Supabase Storage,但**重用與否未定**;之後改很痛 | ⏳ |
| N7 | 訂單改單要做到多細(能不能改品項/金額) | 涉及金流一致性與稽核;抄 Medusa 逐動作 log 成本較高 | ⏳ |
| N8 | 現行 9 個商品狀態詞彙何去何從 | 新三軸上線後與它重疊;退場/並存/改語意三選一 | ⏳ |
| N9 | E12 供應商主檔這期做不做 | 代購本質最缺,但會擴張範圍 | ⏳ |

---

## 7. 不做(明確排除)

- ❌ 匯入整套 Shopify / Medusa 程式碼(ADR-0005 廢 Medusa-as-API 的理由仍成立)
- ❌ 多幣別 / 匯率 / 稅額拆分(台灣單一幣別 + 既有發票欄位)
- ❌ 銷售通路 / B2B Company 三層模型 / 詐騙評分
- ❌ 完整庫存管理(預留/盤點/多倉)—— 代購模式庫存概念弱
- ❌ 分析報表(Medusa 核心也沒有,第三方 plugin 才有)

---

## 8. 未確認(禁止當事實實作)

- `create_order` RPC 是否允許自由輸入品項(北極星第 3 項的前置,**動前必驗**)
- Medusa `ReturnStatus` 完整 enum
- Shopify 非 display 版 `fulfillmentStatus` 是否存在
- Shopify 批次操作完整清單、Settings 完整分類
- Odoo PO line ↔ SO line 是否官方保證自動關聯
- 庫存異動歷史 schema(兩平台皆未查到)
- PCM 現有權限模型細節(`staff.ts` hardcode 之外是否另有機制)

完整未確認清單分散在各 research 檔末段,實作前逐項回查。
