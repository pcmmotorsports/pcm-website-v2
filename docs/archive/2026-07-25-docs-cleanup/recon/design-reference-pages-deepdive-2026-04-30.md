# Design Reference 補充偵察 v2:翻轉 v1 假設

> **日期:** 2026-04-30
> **背景:** Sean 04-30 親自進 design-reference 驗證、發現 v1 偵察報告誤判
> **方法:** Sean 截圖 + Claude Code 補充 fetch handoff URL + 解壓比對
> **handoff URL:** https://api.anthropic.com/v1/design/h/JXouieZXGo1w4aZAwP0tDg
> **submodule HEAD:** d5ea3aa(不變、與 handoff 設計成品 100% 一致)

---

## 0. 重大發現

handoff URL 內容 vs 既有 submodule(d5ea3aa)比對:

- 核心檔案(.jsx / .css / data / HANDOFF docs)100% 相同(對 4 個關鍵檔做 diff、零差異:`App.jsx` / `HANDOFF-OVERVIEW.md` / `products.js` / `tokens.css`)
- handoff 多出 171 個 working files(`chats/` 4 個對話 / `screenshots/` ~95 截圖 / `uploads/` ~80 上傳檔 / `scraps/` 1 個 .napkin sketch)、屬設計過程紀錄、不入庫
- d5ea3aa 已是「設計成品最新版」、不需要 sync

**結論:design-full-sync slice 取消 Phase B、本任務改為「補偵察 v2」+「寫教訓」。**

---

## 1. v1 偵察方法論盲點(教訓)

### 1.1 盲點

v1 偵察用「.jsx 檔名 + grep 推測 routes」、結論為「結帳 / 訂單詳情 / 我的車輛 CRUD 未覆蓋」。

實際情況(Sean 截圖確認):
- `AccountPages.jsx` 是會員中心 hub、內含 6 個 tab(總覽 / 訂單記錄 / 收藏清單 / 我的愛車 / 收件地址 / 個人資料)
- 6 個 tab 都已備齊、v1 偵察沒打開看內部 page state
- 購物車獨立 `CartPage`(看截圖 image 7)、v1 偵察可能漏看

### 1.2 教訓

偵察 slice 必含「page state 實際枚舉」、不只檔名推測。具體:
- 對 hub-style 元件(如 `AccountPages` / `Pages`)、必 grep `useState` / `case` 找所有 page state
- 列出每個 state 對應渲染什麼元件
- 不能只說「看到 `AccountPages.jsx` 一個檔」就推「會員相關只有一頁」

---

## 2. v1 偵察修正:design 真實覆蓋盤點(基於 Sean 截圖 + handoff 字面)

### 2.1 ✅ design 已備齊(Sean 截圖確認)

| 頁面 | 截圖編號 | 狀態 |
|---|---|---|
| 會員中心總覽(VIP 徽章 + 訂單 + 點數 + 推薦) | image 1 | ✅ |
| 訂單記錄列表(訂單編號 + 日期 + 件數 + 金額 + 狀態 + 查看詳情連結) | image 2 | ✅ |
| 收藏清單 | image 3 | ✅ |
| 我的愛車(PRIMARY / SECONDARY 標記) | image 4 | ✅ |
| 收件地址(預設地址 + 編輯刪除) | image 5 | ✅ |
| 個人資料(姓名 / Email / 手機 / 生日) | image 6 | ✅ |
| 購物車(商品列表 + 數量調整 + 訂單摘要 + 優惠券 + 前往結帳) | image 7 | ✅ |

### 2.2 ❌ design 確實缺(Sean 04-30 親自驗證)

| 頁面 | Sean 確認 | 處理 |
|---|---|---|
| 結帳流程後段(運送方式 / 付款方式 / 確認下單) | 「結帳目前只有到購物車、沒有接下來的付款、運輸選項」 | Claude Design 補 |
| 訂單詳情頁(從訂單列表點進去) | 「訂單記錄目前也還無法點擊進去看到詳細訂單狀況」 | Claude Design 補 |
| 經銷申請頁 | 原 v1 已標、Sean 確認 | Claude Design 補 |
| 經銷後台 | Phase 2 才做、不該補 | 跳過 |
| 車輛履歷頁 | Phase 2 才做、不該補 | 跳過 |

### 2.3 ⚠️ design 字面與 Sean 拍板衝突、需微調

| 元素 | design 字面 | Sean 拍板 | 處理 |
|---|---|---|---|
| 會員等級「消費滿 NT$ 50,000 升級」文字 | 字面有 | Q26 拍 A 變體 — 拿掉晉級文字、保留 VIP 徽章 + 點數 | 請 Claude Design 微調 |
| Vehicle Finder 加「我的車」按鈕 | 沒有 | Q9=A1 + Q27 — 加按鈕 + Primary 圖示標記 | 請 Claude Design 補 |

---

## 3. 對 Claude Design 工作交辦單的影響

從原 v1 規劃「補 8 類 UI」、修訂為:

A. 結帳流程後段(全新增)
B. 訂單詳情頁(全新增)
C. 經銷申請頁(全新增、含表單 + 狀態頁 + 入口)
D. 微調(拿晉級文字 + Vehicle Finder「我的車」按鈕)

具體交辦單由 Claude.ai 寫、不在本報告範圍。

---

## 4. handoff URL working files 不入庫紀錄

handoff URL fetch 顯示多出 171 個檔(`chats/` + `screenshots/` + `uploads/` + `scraps/`)、屬設計過程紀錄、Sean Q28=A 拍板不入庫。

理由:
- 不影響 storefront 實作(實作只看設計成品)
- 增加 git 體積、價值低
- 設計過程在 Claude Design 環境可隨時回看、不需 mirror 進 git

如未來 Sean 需要、可單獨開 slice 把 `chats/` / `scraps/` 加進(`screenshots/` / `uploads/` 量大、不建議)。

---

— v2 偵察結束 —
