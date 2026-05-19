# M-1-12 ProductsPage 偵察報告

> 作者:Claude Code · 日期:2026-05-19 · HEAD `61e87dd`
> 觸發:Sean 指示開工 M-1-12;Claude Code 偵察揭示本 slice 非「45 分鐘直接搬」、
> 命中鐵則 8(重大改動)+ 鐵則 4(需拆 sub-slice)、且有一個阻塞架構岔路 ——
> 停下、寫本報告、回報 Sean,後續規劃 / 拆 slice 屬 Claude.ai 職責(四方分工)。

---

## 1. design 真權威盤點

| 檔案 | 行數 | 內容 |
|---|---|---|
| `design-reference/components/ProductsPage.jsx` | 464 | 7 個區塊:`SortBar` / `PageHeader` / `filterProducts` / `sortProducts` / `ProductsPage` 主體 / `MobileFab` / `Pagination` |
| `design-reference/components/FilterTop.jsx` L413-471 | 58 | `ActiveChips`(已選篩選 chip 列、cascade 模式用;M-1-10 明文不搬、留 M-1-12) |
| `design-reference/styles/products-page.css` | 241 | `.pp-*` 版面 / sortbar / grid / pagination(`.ac-*` ActiveChips / `.pp-mobile-fab` 不在本檔、CSS 待定位) |

PHASE-1-MILESTONES.md L253 排程估時「45 min」—— 與實際內容量(464 + 58 行 JSX +
241 行 CSS + 整合邏輯)嚴重不符。估時為排程作者預估、非實測。

## 2. 既有 storefront 對照

- ✅ 已有可複用:`Header`(M-1-05)、`ProductCard`(M-1-06)、`HomeFooter`(footer)
- ✅ 已有 4 個篩選元件:`FilterSide` / `FilterTop` / `CascadeFilterTop` / `FilterDrawer`
- ❌ 缺:`ProductsPage` / `Pagination` / `MobileFab` / `SortBar` / `PageHeader` / `ActiveChips`
- ❌ 缺:`products-page.css`、商品列表 route(`app/products/page.tsx` 之類)

## 3. 🔴 核心阻塞 —— 篩選狀態提升缺口

design `ProductsPage` 用**單一 lifted `filters` 物件 + `setFilters`**,往下傳給
FilterTop / CascadeFilterTop / FilterSide / FilterDrawer / ActiveChips / PageHeader,
全部共用同一份篩選狀態 → `filterProducts(data.products, filters)` 才能真的過濾。

但 M-1-09 / 10 / 11 把這 4 個元件全部建成**各自自管內部狀態**:

| 元件 | 對外 props | 篩選狀態 |
|---|---|---|
| `FilterSide` | `data` / `hideVehicle` | 內部 `useReducer` + `useState`、**不對外暴露** |
| `FilterTop` | `data` / `resultCount` | 內部 `useReducer` + `useState`、**不對外暴露** |
| `CascadeFilterTop` | `data` / `onOpenDrawer?` | 內部 `useReducer`、**不對外暴露** |
| `FilterDrawer` | `open` / `onClose` / `data` / `resultCount` / `initialTab?` | 內部 `useReducer` + `useState`、**不對外暴露** |

→ **使用者在篩選器點選的條件,被鎖在各元件內部、ProductsPage 讀不到、無法依此過濾商品。**
「整合 4 篩選」在現有元件介面下結構性不可行。

這不是 bug、是 M-1-09 / 10 / 11 的**刻意延後**:三個 slice 的 commit / 檔頭註解都寫
「design 的 filters / setFilters props 來自尚未做的 ProductsPage(M-1-12)→ 移除、元件
自管」。延後的帳在 M-1-12 到期 —— M-1-12 必須回頭重新接線這 4 個共用元件。

→ 動 4 個共用元件 = **鐵則 8 重大改動**,且接線方式有岔路(見 §5)。

## 4. design-harness 殘留(評估不搬 / 待確認)

design `ProductsPage` 含大量「設計稿 iframe 預覽環境」專屬邏輯,非正式網站需要:

- `window.PCM_DATA` —— 改用 storefront mock data import(`@/data/mock-*`)
- `tweaks` prop(`filterStyle` / `memberTier` / `showRedPrice` / `badgeStyle` …)——
  設計稿 live-tweak 面板用;正式網站無此面板
- `localStorage` + `window.parent.postMessage` + `pcm-vehicle-filter-change` CustomEvent
  —— 跨頁車輛同步,屬 harness 機制,Phase 1 是否需要待確認
- `ReactDOM.createPortal` 進 `#mobile-fab-slot` —— 手機模擬器 bezel slot,正式網站直接渲染
- `tweaks.filterStyle` 4-variant 開關(`top` / `side` / `drawer` / `cascade`)——
  設計稿同時保留 4 種版面用開關切換;正式網站須**選定**(見 §5 Q1)

## 5. 待決策

**Q1(產品 / 影響網站顯示 → Sean 拍板):正式商品列表頁用哪種篩選版面?**
design 有 4 種,正式網站不可能 4 種都上。常見組合:

- A. 桌機**側邊**篩選 + 手機**抽屜** —— 電商最主流(`filterStyle='side'`)
- B. 桌機**上方 chip** 篩選 + 手機**抽屜**(`filterStyle='top'`)
- C. **cascade**(車款連動 bar)+ 桌機側邊 + 手機抽屜(`filterStyle='cascade'`)
- D. 4 種全接、保留切換開關(技術債、不建議正式環境)

**Q2(架構 → Claude.ai 規劃):4 個篩選元件如何把選取狀態餵給 ProductsPage?**

- 方案 1:狀態提升到 ProductsPage —— ProductsPage 持 `useReducer` + price/color/flags
  `useState`,把 state + dispatch/setter 當 props 傳回 4 個元件(須回補 props)
- 方案 2:Context Provider —— `FilterStateProvider` 持狀態、4 元件 + ProductsPage 走
  context、減 prop drilling
- 方案 3:onChange callback —— 每個元件加 `onFiltersChange` 回呼往上冒泡

Q2 屬內部 code 架構、由 Claude.ai 規劃時定;Q1 結果會影響要回補 props 的元件數量。

## 6. 鐵則對照

- **鐵則 8:** 命中(動 4 個共用元件 + 新增多檔)→ 須先提 plan 等 Sean 批
- **鐵則 4:** 命中(遠超 15-45 min)→ 須拆 sub-slice
- **鐵則 9 內容分級:** 商品 / 篩選 / 分頁邏輯 = L1-L2(mock data 為合約、M-1-16 補真資料);
  無 L3
- **四方分工:** 規劃 / 拆 slice / 寫 slice 指令 = Claude.ai 職責;Claude Code 本報告止於偵察

## 7. 建議 sub-slice 草拆(供 Claude.ai 規劃參考、非定案)

1. **M-1-12a** 篩選狀態架構 —— 依 Q2 方案回補 4 元件介面 + 共用 hook/provider/型別
   (重大改動核心、動共用元件)
2. **M-1-12b** ProductsPage 骨架 + `products-page.css` + route + `PageHeader` + `SortBar`
3. **M-1-12c** `Pagination` + `MobileFab` + `ActiveChips` + 商品 grid + `filterProducts` /
   `sortProducts` 接線
4. 各 sub-slice 收尾補 smoke test + 肉眼驗 harness

→ 拆法 / 邊界 / 估時由 Claude.ai 定案。

— END —
