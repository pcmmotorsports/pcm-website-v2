# Desktop Catalog UX Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## 2026-07-30 修訂執行片（優先於下方已完成的第一版）

### Task 5: 以正式商品頁提供 query-gated 桌機選車列預覽

**Files:**
- Modify: `apps/storefront/src/components/CascadeFilterTop.test.tsx`
- Modify: `apps/storefront/src/components/CascadeFilterTop.tsx`
- Modify: `apps/storefront/src/styles/filter-cascade.css`

- [x] **Step 1: 先寫預覽參數失敗測試**

測試需證明一般網址仍顯示「確認適用車款」，而 `?vehicle-ui=preview` 才顯示「選擇適用車輛」、三個搜尋式 placeholder，並在完成品牌與車型後將年份由新到舊顯示。

- [x] **Step 2: 執行 targeted test 並確認 RED**

Run:

```bash
pnpm test -- apps/storefront/src/components/CascadeFilterTop.test.tsx
```

Expected: 新增測試因預覽模式尚未實作而 FAIL。

- [x] **Step 3: 在 CascadeFilterTop 加入 preview-only 呈現**

以 `vehicle-ui=preview` 作為本機視覺參考開關；共用 `VehicleCombo`、既有 reducer action、GarageChips 與正式 taxonomy，不改一般網址輸出。

- [x] **Step 4: 補正式色票與同高版面 CSS**

只新增 `.cft-bar--vehicle-preview` 作用域樣式；不可修改 `.pp-layout`、`.fs-side`、商品卡或正式無參數選車列的既有規則。

- [x] **Step 5: 執行 targeted test 與三綠**

Run:

```bash
pnpm test -- apps/storefront/src/components/CascadeFilterTop.test.tsx
pnpm --filter @pcm/storefront typecheck
pnpm --filter @pcm/storefront lint
pnpm --filter @pcm/storefront build
```

Expected: 全部 exit 0。

- [x] **Step 6: 本地瀏覽器驗證**

比較：

- 現況：`http://localhost:3002/products`
- 新版：`http://localhost:3002/products?vehicle-ui=preview`

驗證新版仍為正式完整商品頁、三欄可輸入與捲動、年份最新在前、選車後預覽參數保留，且一般網址零視覺退化。停在本機驗收點，不 commit、不 push、不 deploy。

**Goal:** 在現有本機商品 UX 預覽加入固定內容寬度、可完整操作的桌機版本，同時保留既有手機版。

**Architecture:** 新增獨立 `DesktopCatalogUxPreview` 與 CSS Module，重用 `MobileCatalogUxPrimitives` 的車輛、分類和商品假資料。現有 `MobileCatalogUxPreview` 只負責同一路由組合桌機與手機兩個隔離版本；媒體查詢決定顯示版本，兩者狀態互不干擾。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript、CSS Modules、Vitest、Testing Library。

---

### Task 1: 用測試鎖定桌機資訊架構

**Files:**
- Create: `apps/storefront/src/app/dev-preview/mobile-catalog-ux/DesktopCatalogUxPreview.test.tsx`
- Create: `apps/storefront/src/app/dev-preview/mobile-catalog-ux/DesktopCatalogUxPreview.tsx`

- [x] **Step 1: 寫入桌機版失敗測試**

測試必須覆蓋：

1. 顯示「選擇適用車輛」、我的愛車與廠牌／車型／年份欄位。
2. 不顯示「現貨商品」。
3. 點我的愛車後顯示已套用車輛與清除車輛。
4. 清除輸入不取消已套用車輛；清除車輛會回到全部商品。
5. 分類、品牌、價格與排序可獨立操作。

- [x] **Step 2: 執行測試並確認 RED**

Run:

```bash
pnpm test -- apps/storefront/src/app/dev-preview/mobile-catalog-ux/DesktopCatalogUxPreview.test.tsx
```

Expected: FAIL，原因是桌機預覽元件尚未實作。

- [x] **Step 3: 建立最小桌機元件骨架**

只輸出帶有 `data-testid="desktop-catalog-ux-preview"` 的根節點，再次確認測試仍因缺少選車與篩選介面而失敗。

### Task 2: 實作桌機車輛工作列

**Files:**
- Modify: `apps/storefront/src/app/dev-preview/mobile-catalog-ux/DesktopCatalogUxPreview.tsx`
- Create: `apps/storefront/src/app/dev-preview/mobile-catalog-ux/DesktopVehiclePicker.tsx`
- Create: `apps/storefront/src/app/dev-preview/mobile-catalog-ux/desktop-catalog-ux.module.css`
- Test: `apps/storefront/src/app/dev-preview/mobile-catalog-ux/DesktopCatalogUxPreview.test.tsx`

- [x] **Step 1: 實作我的愛車與三欄 combobox**

沿用 `VEHICLE_OPTIONS`、`CBR600RR`、`MT09`。每欄輸入會過濾限制高度的捲動選項；廠牌改變時清空車型與年份，車型改變時清空年份。

- [x] **Step 2: 實作兩種清除語意**

「清除輸入」只把草稿設為 `EMPTY_VEHICLE`；「清除車輛」取消已套用車輛與分類。任何輸入欄位不得使用 `autoFocus`。

- [x] **Step 3: 執行桌機測試並確認車輛流程 GREEN**

Run:

```bash
pnpm test -- apps/storefront/src/app/dev-preview/mobile-catalog-ux/DesktopCatalogUxPreview.test.tsx
```

Expected: 車輛工作列相關測試 PASS。

### Task 3: 實作左側條件與右側商品區

**Files:**
- Modify: `apps/storefront/src/app/dev-preview/mobile-catalog-ux/DesktopCatalogUxPreview.tsx`
- Modify: `apps/storefront/src/app/dev-preview/mobile-catalog-ux/desktop-catalog-ux.module.css`
- Test: `apps/storefront/src/app/dev-preview/mobile-catalog-ux/DesktopCatalogUxPreview.test.tsx`

- [x] **Step 1: 實作 232px 左側欄**

顯示 13 個分類及數量、商品品牌與價格選項。分類與商品條件分開計算；不得加入「現貨商品」。

- [x] **Step 2: 實作結果列與三欄商品卡**

右上角顯示推薦排序／最新上架／價格低到高／價格高到低；商品卡重用 `PRODUCTS` 假資料。

- [x] **Step 3: 執行桌機測試並確認全部 GREEN**

Run:

```bash
pnpm test -- apps/storefront/src/app/dev-preview/mobile-catalog-ux/DesktopCatalogUxPreview.test.tsx
pnpm test -- apps/storefront/src/app/dev-preview/mobile-catalog-ux/MobileCatalogUxPreview.test.tsx
```

Expected: 桌機與手機測試全部 PASS。

### Task 4: 接入同一路由與 RWD

**Files:**
- Modify: `apps/storefront/src/app/dev-preview/mobile-catalog-ux/MobileCatalogUxPreview.tsx`
- Modify: `apps/storefront/src/app/dev-preview/mobile-catalog-ux/mobile-catalog-ux.module.css`
- Modify: `apps/storefront/src/app/dev-preview/mobile-catalog-ux/DesktopCatalogUxPreview.tsx`
- Modify: `apps/storefront/src/app/dev-preview/mobile-catalog-ux/desktop-catalog-ux.module.css`

- [x] **Step 1: 組合桌機與手機預覽**

`> 1024px` 顯示桌機版，`<= 1024px` 顯示既有手機／平板版，對齊正式網站底部導覽的切換點。正式 `ProductsPage`、`CascadeFilterTop`、`FilterSide` 與全域 CSS 不得修改。

- [x] **Step 2: 執行三綠**

Run:

```bash
pnpm --filter @pcm/storefront typecheck
pnpm --filter @pcm/storefront lint
pnpm --filter @pcm/storefront build
```

Expected: 全部 exit 0，build route 仍包含 `/dev-preview/mobile-catalog-ux`。

- [x] **Step 3: 瀏覽器驗證**

驗證：

- 1365×900：內容最大寬度 1180px、置中、無水平溢出。
- 1025×768：桌機車輛工作列與兩欄內容不重疊。
- 1024×768：正確切換成手機／平板版，不與正式網站底部導覽重疊。
- 390×844：既有手機選車、分類、篩選與排序流程不退化。
- 桌機與手機各跑 axe，自動 violations 必須為 0；既有全域導覽的 manual/incomplete 另行記錄。

- [x] **Step 4: 停在本機驗收點**

重新啟動 port 3002，回報電腦與手機測試網址。不得 commit、push、deploy。

## Rollback

刪除：

- `apps/storefront/src/app/dev-preview/mobile-catalog-ux/DesktopCatalogUxPreview.tsx`
- `apps/storefront/src/app/dev-preview/mobile-catalog-ux/DesktopCatalogUxPreview.test.tsx`
- `apps/storefront/src/app/dev-preview/mobile-catalog-ux/DesktopVehiclePicker.tsx`
- `apps/storefront/src/app/dev-preview/mobile-catalog-ux/desktop-catalog-ux.module.css`
- `docs/superpowers/specs/2026-07-30-desktop-catalog-ux-preview-design.md`
- `docs/superpowers/plans/2026-07-30-desktop-catalog-ux-preview.md`

並還原：

- `apps/storefront/src/app/dev-preview/mobile-catalog-ux/MobileCatalogUxPreview.tsx`
- `apps/storefront/src/app/dev-preview/mobile-catalog-ux/mobile-catalog-ux.module.css`

即可回到目前只有手機互動版的本機預覽。
