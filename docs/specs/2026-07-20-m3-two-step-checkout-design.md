# M-3 兩步結帳整合設計

日期：2026-07-20

狀態：Sean 已批准互動與資訊架構；本文件只定義設計，不代表已實作、已部署或已開放付款。

## 1. 白話結論

把現在的三步結帳改成兩步：

1. 收件資料、配送方式、通知 Email。
2. 收件摘要、發票、付款方式、真正的 TapPay 安全卡欄、商品清單、條款同意、確認付款。

原本第二步的 disabled 假卡片欄移除，真正的 TapPay 欄直接放進第二步。客人不必再按一次「下一步：確認訂單」，但付款前仍看得到收件摘要、商品、金額與條款。

## 2. Sean 已拍板

| 題目 | 決定 |
|---|---|
| 結帳步數 | 由三步改成兩步。 |
| 第二步版型 | A：單欄連續式，由上到下完成。 |
| 付款方式範圍 | 結構可擴充，但本輪仍只顯示並支援信用卡 TapPay；不新增 ATM、貨到付款或混合付款後端。 |
| 收件資料複查 | 第二步頂端顯示一行精簡摘要與「修改」；不重複完整地址表。 |
| 付款按鈕 | 除處理中外維持可按；按下先做前端完整檢查，通過後才取 prime／送出。 |
| 錯誤呈現 | 所有錯誤一次全部顯示紅字，同時捲動並聚焦第一個錯誤；修正一欄只清該欄錯誤。 |
| 法律連結 | 服務條款與隱私政策開新分頁，避免清掉結帳資料。 |

## 3. 現況與根因

目前 storefront 直接沿用 `design-reference/components/CheckoutPage.jsx` 的三步版型：

- Step 1：收件資料、配送方式、通知 Email。
- Step 2：發票、付款方式、disabled 假卡片預覽。
- Step 3：收件／付款／發票／商品複查、真正的 TapPay Fields、條款、確認付款。

三步不是 TapPay、3DS 或資料庫的硬限制。真 TapPay 後來基於安全理由接在 Step 3，但 Step 2 的舊預覽仍保留，才形成「先看一次假卡欄，再到下一步填真卡」的重複與困惑。

本設計是 Sean 明確批准的 business override。實作時必須同步 `docs/design-storefront-manifest.yaml`，不可把兩步流程誤稱為 design-reference 原樣搬運。

## 4. 範圍

### 4.1 這次設計包含

- 三步指示器改成兩步。
- 合併現有 Step 2 與 Step 3 的有效內容。
- 移除 disabled 假信用卡預覽。
- 真 TapPay Fields 在第二步直接掛載。
- 第二步加入精簡收件摘要、商品清單、條款與付款按鈕。
- 桌機與手機共用同一套驗證與付款 handler。
- 前端一次顯示全部錯誤，server／DB 仍保留既有縱深驗證。
- 法律連結開新分頁；正式連結必須指向可讀且已核准的內容。

### 4.2 明確不包含

- 不新增 ATM、貨到付款、超商代碼、儲值金或優惠券。
- 不改訂單／付款狀態機。
- 不改 TapPay prime、3DS redirect、callback、webhook、Record API、settle 或輪詢架構。
- 不改金額計算、會員價格、運費、RLS、GRANT 或 create_order 業務語意。
- 不把原始卡號、有效期或 CVV 放進 React state、我方 DOM input、server、log 或資料庫。
- 不在本設計中自行撰寫或推測法律文案。

## 5. 目標流程

```text
Step 1 收件資料
  地址 + 宅配 + 通知 Email
            │
            ▼
Step 2 發票與付款
  精簡收件摘要（修改 → Step 1）
  → 發票資訊
  → 付款方式選擇器（目前只有信用卡）
  → TapPay 安全卡片欄
  → 商品清單
  → 條款同意
  → 確認付款
            │
            ▼
  既有 paid / processing / unknown / redirect / error / wait 等結果處理
```

Step 1 的主要按鈕字面改為「下一步：發票與付款」。Step 2 不再有「下一步：確認訂單」，只有「上一步」與「確認付款」。

## 6. 第二步資訊順序

### 6.1 精簡收件摘要

- 顯示姓名與截短地址，不重複完整地址卡片。
- 顯示「修改」按鈕；點擊回 Step 1。
- 修改收件資料後重新進 Step 2 時，TapPay Fields 重新初始化，卡片內容清空。這是 PCI 安全欄位的預期行為，不嘗試自行保存敏感資料。

### 6.2 發票資訊

- 保留個人／公司／捐贈三種現有 UI。
- 保留由收件地址自動帶入與手動覆寫行為。
- 依所選類型驗證對應欄位；隱藏類型的錯誤不可殘留阻擋付款。

### 6.3 付款方式

- 使用可擴充的單選結構，但只渲染已啟用的 TapPay 信用卡。
- 不顯示「即將推出」的 ATM／貨到付款假選項，避免客人誤以為可用。
- 選中信用卡後直接顯示真正的 `TapPayCardFields`。
- 刪除現在 Step 2 的 disabled 原生 `<input>` 假卡欄與「最後一步輸入」提示。

### 6.4 商品清單

- 沿用現有 server-resolved 商品名稱、品牌、規格、數量、車款與行總額。
- 保留「編輯」入口回購物車。
- 右側 `CheckoutSummaryAside` 繼續負責精簡金額摘要；主內容的商品清單負責付款前逐項確認，兩者角色不同。

### 6.5 條款與付款

- 商品清單後顯示同意 checkbox。
- 服務條款與隱私政策以新分頁開啟，使用 `target="_blank"` 並加 `rel="noopener noreferrer"`。
- 桌機付款鈕顯示「確認付款 NT$ X →」。
- 手機固定列顯示總額與「確認付款」；兩個按鈕呼叫同一個 handler。

## 7. 驗證與錯誤規格

### 7.1 點擊確認付款時

先做純前端檢查，不呼叫 TapPay `getPrime`，也不呼叫 server action：

1. 當前發票類型的必要欄位與格式。
2. TapPay 卡號、有效期、CVV 的 field status／可取 prime 狀態。
3. 條款 checkbox。
4. 既有必要的收件地址與通知 Email 狀態。

### 7.2 錯誤顯示

- 同一次 submit 找到的所有錯誤全部顯示，不採逐一阻擋。
- 每個錯誤靠近對應欄位並顯示紅字；付款區同時提供一個 `role="alert"` 的錯誤摘要，避免多個 assertive alert 一起朗讀。
- 錯誤欄位加可辨識的 invalid state，不只靠顏色表達。
- 各欄以 `aria-invalid`、`aria-describedby` 連到自身紅字；所有錯誤都留在畫面上，不只摘要第一項。
- 完成錯誤集合後，捲動並聚焦第一個可聚焦錯誤；其他紅字仍保留。
- 使用者修正某欄時，只清除該欄錯誤。
- TapPay iframe 無法直接聚焦內部 input 時，聚焦該欄的可存取容器並捲至該區。

### 7.3 付款按鈕狀態

- 未填完整時仍可按，用來觸發清楚的錯誤導引。
- 只有 `submitting`／prime 取得中／既有終態鎖生效時 disabled。
- 前端檢查通過後才進既有 `confirmProceedIfInflight → getPrime → charge.submit` 流程。
- 付款失敗或可重試狀態留在 Step 2，非敏感表單資料不消失，錯誤顯示在付款區附近。

## 8. 元件邊界

`CheckoutView` 保留跨步驟狀態與付款 orchestrator，不把所有 UI 合回單檔。實作設計應形成以下責任：

- `CheckoutStep1`：地址、配送、通知 Email。
- `CheckoutStep2`：只負責排列第二步區塊與動作列。
- 發票區：發票 UI、類型切換與發票錯誤。
- 付款區：付款方式單選、TapPay slot 與 TapPay 欄位錯誤。
- 訂單確認區：精簡地址、商品清單、條款。
- `CheckoutView`：`step`、共用狀態、全表 validation、聚焦第一錯誤、既有付款狀態機。

現有 `CheckoutStep3` 的有效內容移入上述小元件後應退役，不保留另一套隱藏的第三步。`CheckoutView.tsx` 現為 383 行，已在 300 行警戒區；實作不得讓它超過 400 行，應透過抽取純 UI 與純 validation 函式降低責任。

## 9. 不可破壞的安全契約

- `TapPayCardFields` 仍是唯一卡片輸入表面。
- `useTapPayCard` 的 active 條件由 `step === 3` 改為 `step === 2`，但 setup／cleanup／timeout／field status 契約不變。
- `confirmProceedIfInflight`、同步 ref 鎖與終態不釋放策略不變。
- `chargePaymentAction` 的 `agreed === true` server guard 仍在所有副作用之前。
- server 權威金額重算、身分、tier、RLS、cart_session_id 與 create_order 契約不因 UI 合併而放寬。
- B-3／B-4 通知 Email gate 與資料邊界按各自真權威 plan 執行；兩步 UI 不得偷偷把 B-4 真值持久化範圍帶進來。

## 10. 法律頁硬閘

### 10.1 現況

- storefront 沒有 `/terms` 或 `/privacy` route；現有 checkout 連結是 no-op `href="#"`。
- `design-reference/components/LegalPage.jsx` 可作視覺結構參考，但內容多處明寫「草稿待法務 review」，且含假電話／Email、未實作服務與「7 天可退」等和 PCM 既有政策衝突的文字。
- `docs/phase-1-backlog.md` 的 #241 說可讀條款依賴 #235，但 live #235 標題實際是「Step3／完成頁退換貨連結＋客服 LINE」，編號引用已漂移；不得把它當成已存在的法律頁工作單。

### 10.2 上線規則

- 不得直接複製 design-reference 的法律草稿上線。
- 法律頁只搬 design 視覺結構；文字必須來自 Sean／法律顧問核准的正式來源，真值聯絡資訊走既有 site config／政策 SSoT。
- 正式內容一旦不同於目前 `legal_terms_versions` 登錄的 content hash，必須建立新 terms version、對應 hash 與 forward-only migration，並同步 `CURRENT_TERMS_VERSION`。
- migration／production apply 由 Sean checkpoint 執行；兩步結帳 UI commit 不得自行 apply DB。
- 可讀法律頁、版本與 hash 未對齊前，兩步結帳不得宣稱具備完整法律效力，也不得開放 production 付款。
- 實作計畫必須先建立一個正確的新 backlog 條目或修正依賴文字，不沿用錯誤的 #235 指涉。

## 11. 響應式與無障礙

- 桌機採 A 方案單欄主流程，右側摘要維持 sticky。
- 手機維持同一 DOM 資訊順序，不另寫一套付款邏輯。
- mobile buybar 不遮住紅字、條款或最後一個欄位；頁面底部保留相稱 padding。
- TapPay iframe input 維持 16px，避免 iOS Safari 聚焦縮放。
- 錯誤訊息與欄位建立 `aria-describedby` 關聯；checkbox、付款方式與按鈕使用真實語意元素。
- 付款處理中使用可被讀出的狀態文字，並防止重複操作。

## 12. 測試設計

至少覆蓋：

1. 步驟指示器只有兩步，Step 1 的下一步字面正確。
2. 進 Step 2 同時看得到收件摘要、發票、真 TapPay slot、商品、條款與付款鈕。
3. 舊 disabled 假卡片 input 與第三步入口不存在。
4. TapPay 只在 Step 2 active；回 Step 1 cleanup，再回 Step 2 可重新 setup。
5. 一次 submit 同時產生發票、卡片、條款全部紅字，且沒有 `getPrime`／server action 呼叫。
6. 第一個錯誤被聚焦／捲入視野，其他錯誤保留；逐欄修正只清自身錯誤。
7. 全部合法才依序走 inflight 確認、`getPrime`、`charge.submit`。
8. 桌機與 mobile buybar 共用同一 validation／submit 行為。
9. paid、processing、unknown、redirect、error、wait、in_flight 既有結果回歸不變。
10. 條款未勾仍被 server action 擋住，所有建單／扣款副作用均未呼叫。
11. `/terms`、`/privacy` 連結開新分頁且具 noopener；route 內容版本與登錄 hash 有守門證據。
12. 390px 無水平溢出、錯誤不被 buybar 遮住、TapPay field computed font size 維持 16px。

驗證強度：targeted tests、完整 Vitest、typecheck、lint、storefront build、design manifest validate、桌機與手機真瀏覽器流程；付款／條款／3DS 屬高風險，實作需獨立唯讀審查。

## 13. Manifest、文件與可追溯性

實作時至少要：

- 在 `CheckoutPage` 新增 Sean 批准的 `checkoutTwoStepFlow` business override。
- 更新既有 `checkoutStepsWipPlaceholder`、`checkoutStep3ReviewAdaptations`、`checkoutCardUiOnlyNoTapPay`，清除「三步／最後一步／Step 3 真卡欄」舊字面。
- 若新增法律頁，建立相稱 manifest component／override，明列視覺來源與內容真權威不同。
- 同步 `STATUS.md`、`docs/handoff/CURRENT.md`、backlog 與測試證據，不讓 plan／manifest／handoff 各說各話。

## 14. 實作切分原則

這是跨共用 checkout 元件、付款互動、法律路由與可能 terms version migration 的重大改動，不能當成單一 15–45 分鐘 slice。後續 implementation plan 至少分開：

1. 法律內容／版本／route 前置片（需要 Sean 核准正式文字；若需 migration，另走高風險審查與 Sean apply）。
2. 兩步結帳結構與元件拆分片（不改付款行為）。
3. 全錯誤顯示、聚焦與 mobile buybar 互動片。
4. TapPay active step 切換與完整付款狀態回歸片。
5. 真瀏覽器／3DS 安全驗收與文件收口片。

精確 slice、檔案與順序由本規格批准後的 implementation plan 決定；每片遵守 repo 的重大改動、三綠、獨立審查、不得自動 push／deploy／開 production flag 規則。

## 15. Rollback

- UI rollback：恢復三步指示器與原 Step 2／Step 3 掛載；不需資料回填。
- 法律內容／版本 rollback：forward-only 新版本處理，不修改或刪除既有 consent 歷史；production migration 不以破壞性 down migration 回退。
- 任何回滾均不得放寬 server consent guard、金額權威、TapPay 安全欄或雙扣防線。

## 16. 完成定義

只有下列全數成立才可稱「兩步結帳完成」：

- 畫面與導覽只剩兩步。
- 第二步可直接完成發票、真卡輸入、商品確認、條款與付款。
- 所有錯誤同時紅字且第一錯誤可被導引。
- 法律連結可讀、內容已核准、version／hash 一致。
- 原始卡資料零進我方系統，付款與 3DS 安全契約回歸全綠。
- 桌機／手機肉眼驗收與高風險獨立審查通過。
- Sean 明確批准後才進 production deploy／flag checkpoint。

— END —
