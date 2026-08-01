# Mobile Catalog UX Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一個不連正式資料、可在本機手機瀏覽器操作的商品目錄 UX 測試頁，驗證車輛、分類與商品篩選分層後的操作。

**Architecture:** 新增獨立的 `/dev-preview/mobile-catalog-ux` route；route 只負責載入 client 預覽元件，互動狀態與假資料封裝在同資料夾的 client 元件，視覺使用 CSS Module 隔離。不得修改正式 `ProductsPage`、`FilterDrawer`、全域 CSS、資料庫或 URL 同步。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript、CSS Modules、Vitest、Testing Library。

---

### Task 1: 先用測試鎖定操作責任

**Files:**
- Create: `apps/storefront/src/app/dev-preview/mobile-catalog-ux/MobileCatalogUxPreview.test.tsx`
- Create: `apps/storefront/src/app/dev-preview/mobile-catalog-ux/MobileCatalogUxPreview.tsx`

- [x] **Step 1: 寫入失敗測試**

測試必須覆蓋：

1. 尚未選車時顯示「選擇車輛」。
2. 開啟選車面板時，任何輸入欄位都不能自動取得焦點。
3. 套用 `HONDA CBR600RR 2021` 後顯示 161 件適用商品與快速分類。
4. 「分類」與「篩選」分開開啟各自面板。
5. 商品篩選面板只能出現商品品牌與價格，不得出現車輛選擇或現貨商品。

- [x] **Step 2: 執行測試並確認 RED**

Run:

```bash
pnpm test -- apps/storefront/src/app/dev-preview/mobile-catalog-ux/MobileCatalogUxPreview.test.tsx
```

Expected: FAIL，原因是預覽元件尚未提供上述畫面與互動。

- [x] **Step 3: 建立最小元件骨架後再次確認行為測試仍為 RED**

元件僅先輸出測試頁根節點，不加入功能；再次執行相同測試，必須因找不到「選擇車輛」而失敗。

### Task 2: 實作互動預覽

**Files:**
- Modify: `apps/storefront/src/app/dev-preview/mobile-catalog-ux/MobileCatalogUxPreview.tsx`
- Create: `apps/storefront/src/app/dev-preview/mobile-catalog-ux/mobile-catalog-ux.module.css`

- [x] **Step 1: 實作五種可操作狀態**

狀態包含：

- 尚未選車。
- 選車面板。
- 已選車摘要。
- 分類面板。
- 商品篩選面板。

選車欄位提供直接點選與文字輸入兩種方式，搜尋欄位不得使用 `autoFocus`。面板使用 `100dvh`、可捲動內容與固定底部操作區，輸入欄位 focus 時呼叫 `scrollIntoView({ block: 'center' })`，降低手機鍵盤遮擋。

- [x] **Step 2: 實作商品瀏覽狀態**

選車後固定顯示：

- `HONDA CBR600RR`
- `2021`
- `161 件適用商品`
- 快速分類數量 `36 / 26 / 20`
- 「分類／篩選／推薦排序」黏頂工具列
- 兩欄商品卡

商品篩選的啟用數量只計算品牌與價格，不計算車輛與分類。

- [x] **Step 3: 執行單元測試並確認 GREEN**

Run:

```bash
pnpm test -- apps/storefront/src/app/dev-preview/mobile-catalog-ux/MobileCatalogUxPreview.test.tsx
```

Expected: 新增測試全部 PASS。

### Task 3: 接上獨立預覽 route

**Files:**
- Create: `apps/storefront/src/app/dev-preview/mobile-catalog-ux/page.tsx`

- [x] **Step 1: 建立 route**

`page.tsx` 只匯入並輸出 `MobileCatalogUxPreview`，不得取得 Supabase 或正式商品資料。

- [x] **Step 2: 執行型別與 lint 驗證**

Run:

```bash
pnpm --filter @pcm/storefront typecheck
pnpm --filter @pcm/storefront lint
```

Expected: 兩者 exit 0。

- [x] **Step 3: 執行 build**

Run:

```bash
pnpm --filter @pcm/storefront build
```

Expected: build exit 0，route 清單包含 `/dev-preview/mobile-catalog-ux`。

### Task 4: 本機瀏覽器驗證

**Files:** 無新增修改。

- [x] **Step 1: 啟動本機 storefront**

Run:

```bash
pnpm --filter @pcm/storefront dev --hostname 0.0.0.0
```

- [x] **Step 2: 以手機 viewport 驗證**

開啟 `http://localhost:3000/dev-preview/mobile-catalog-ux`，驗證：

- 390px 寬無水平溢出。
- 未選車、選車、分類與商品篩選可依序操作。
- 選車面板開啟時鍵盤不會自動彈出。
- 點輸入欄位後欄位仍留在可視區。
- 往下捲時車輛摘要與工具列保持可操作。

- [x] **Step 3: 停在 Sean 本機驗收點**

不得 commit、push、deploy。回報測試網址、已跑驗證與已知限制，等待 Sean 決定整合或刪除。

### Task 5: 補上略過選車與清除車輛出口

**Files:**
- Modify: `apps/storefront/src/app/dev-preview/mobile-catalog-ux/MobileCatalogUxPreview.test.tsx`
- Modify: `apps/storefront/src/app/dev-preview/mobile-catalog-ux/MobileCatalogUxPreview.tsx`
- Modify: `apps/storefront/src/app/dev-preview/mobile-catalog-ux/mobile-catalog-ux.module.css`

- [x] **Step 1: 寫入失敗測試**

新增兩個行為：

1. 未選車的次要按鈕必須顯示「暫不選車，瀏覽全部商品」。
2. 套用車輛後，車輛摘要必須提供「清除車輛」；點擊後移除車輛與分類，回到「精選商品」。

- [x] **Step 2: 執行測試並確認 RED**

Run:

```bash
pnpm test -- apps/storefront/src/app/dev-preview/mobile-catalog-ux/MobileCatalogUxPreview.test.tsx
```

Expected: FAIL，原因是新文案與清除車輛按鈕尚未實作。

- [x] **Step 3: 實作最小清除路徑**

新增單一 `clearVehicle` handler，統一清除 `vehicle`、`draft`、`category` 與目前面板。車輛摘要顯示「更換／清除」兩個操作；黏頂列保留同一個「清除」快速入口。

- [x] **Step 4: 執行測試並確認 GREEN**

Run:

```bash
pnpm test -- apps/storefront/src/app/dev-preview/mobile-catalog-ux/MobileCatalogUxPreview.test.tsx
```

Expected: 全部測試 PASS。

- [x] **Step 5: 重新驗證手機操作**

Run:

```bash
pnpm --filter @pcm/storefront typecheck
pnpm --filter @pcm/storefront lint
pnpm --filter @pcm/storefront build
```

以 390px viewport 確認摘要與黏頂列皆可清除車輛、清除後無水平溢出。本次仍不得 commit、push 或 deploy。

### Task 6: 在選車提示列清除輸入欄位

**Files:**
- Modify: `apps/storefront/src/app/dev-preview/mobile-catalog-ux/MobileCatalogUxPreview.test.tsx`
- Modify: `apps/storefront/src/app/dev-preview/mobile-catalog-ux/VehiclePickerFields.tsx`
- Modify: `apps/storefront/src/app/dev-preview/mobile-catalog-ux/mobile-catalog-ux.module.css`

- [x] **Step 1: 寫入失敗測試**

套用車輛後重新開啟選車面板，測試「可直接選擇，也可輸入搜尋」右側存在「清除」文字操作。點擊後廠牌、車型與年份草稿皆清空，但已套用在背景的車輛維持不變。

- [x] **Step 2: 執行測試並確認 RED**

Run:

```bash
pnpm test -- apps/storefront/src/app/dev-preview/mobile-catalog-ux/MobileCatalogUxPreview.test.tsx
```

Expected: FAIL，原因是「清除車輛輸入欄位」尚未存在。

- [x] **Step 3: 實作最小清除操作**

在 `VehiclePickerFields` 內將提示文字改為「可直接選擇，也可輸入搜尋」，同列最右側加入文字按鈕「清除」。點擊後呼叫 `setDraft(EMPTY_VEHICLE)` 並關閉選項清單；三個欄位原本就是空值時停用按鈕。

- [x] **Step 4: 執行測試並確認 GREEN**

Run:

```bash
pnpm test -- apps/storefront/src/app/dev-preview/mobile-catalog-ux/MobileCatalogUxPreview.test.tsx
```

Expected: 全部測試 PASS。

- [x] **Step 5: 重新驗證手機操作**

Run:

```bash
pnpm --filter @pcm/storefront typecheck
pnpm --filter @pcm/storefront lint
pnpm --filter @pcm/storefront build
```

以 390px viewport 確認「清除」位於提示列最右側、點擊後面板保持開啟、既有套用車輛不變且無水平溢出。本次仍不得 commit、push 或 deploy。

## Rollback

刪除下列本次新增檔案即可完整還原，不影響正式商品頁：

- `docs/superpowers/plans/2026-07-30-mobile-catalog-ux-preview.md`
- `apps/storefront/src/app/dev-preview/mobile-catalog-ux/page.tsx`
- `apps/storefront/src/app/dev-preview/mobile-catalog-ux/MobileCatalogUxPreview.tsx`
- `apps/storefront/src/app/dev-preview/mobile-catalog-ux/MobileCatalogUxPreview.test.tsx`
- `apps/storefront/src/app/dev-preview/mobile-catalog-ux/mobile-catalog-ux.module.css`
