# M-1-13 ProductPage 偵察報告

> 作者:Claude Code · 日期:2026-05-20 · HEAD `c1c916c`
> 觸發:Sean 指示「直接看到下一步 = M-1-13」開工;Claude Code 偵察揭示本 slice
> 命中鐵則 8(重大改動)+ 鐵則 4(需拆 sub-slice)+ 鐵則 6(>400 行必拆)——
> 停下、寫本報告、回報 Sean,後續規劃 / 拆 slice 屬 Claude.ai 職責(四方分工)。
> 沿用 M-1-12 recon 結構慣例。

---

## 1. design 真權威盤點

| 檔案 | 行數 | 內容 |
|---|---|---|
| `design-reference/components/ProductPage.jsx` | 592 | 單一 `ProductPage({ tweaks, onNav, productId })` 函式;含 lightbox 鍵盤導覽 / breadcrumb / vehicle pill / gallery + 縮圖 overlay / info + options / buy row / services strip / tabs / related / toast / mobile sticky buy bar / lightbox 全螢幕 |
| `design-reference/styles/product-page.css` | 805 | 13 個大 section、148 個 class、`.pd-*` 命名 |

> STATUS.md 寫「584 行」屬舊估、實測 592 行;CSS 805 行未在 STATUS 出現。
> PHASE-1-MILESTONES.md 估時與實際內容量不符 —— 估時為排程作者預估、非實測。

### 1.1 CSS section 切分(13 個)

```
line 1-78    base + crumbs + vehicle pill          78 行
line 79-86   Main grid                              8 行
line 87-213  Gallery                              127 行
line 214-300 Info column                           87 行
line 301-356 Options                               56 行
line 357-427 Buy row                               71 行
line 428-449 Services strip                        22 行
line 450-565 Tabs                                 116 行
line 566-599 Related                               34 行
line 600-617 Toast                                 18 行
line 618-669 Responsive(媒體查詢)                 52 行
line 670-737 Lightbox                              68 行
line 738-805 Mobile sticky buy bar                 68 行
```

### 1.2 JSX 主結構(line 153 起 `return`)

```
<div className="pcm-root" data-screen-label="Product Detail">
  <Header onNav={onNav} currentPage="product" />          ← M-1-05 已建
  <main className="pd-page">
    <nav className="pd-crumbs">                            ← breadcrumb + vehicle pill
    <section className="pd-main">
      <div className="pd-gallery">                          ← hero img + thumb overlay + arrows + counter + badges
      <div className="pd-info">                             ← brand row / sku / title / fits-banner / options / buy row
    </section>
    <section className="pd-services">                       ← services strip
    <section className="pd-tabs-section">                   ← tabs(規格 / 描述 / FAQ / 評價 4 個 panel)
    <section className="pd-related">                        ← 2 個 ProductCard row(M-1-06 已建)
  </main>
  <div className="pd-toast">                                ← 加入購物車 toast
  <Footer onNav={onNav} />                                  ← M-1-12 已用 HomeFooter、design 字面 Footer
  <div className="pd-mobile-buy-bar">                       ← 手機底部固定購物列
  {lightbox && <div className="pd-lightbox">}              ← 全螢幕放大 + 鍵盤導覽 + 觸控滑動
</div>
```

---

## 2. 既有 storefront 對照

### 2.1 ✅ 已有可複用

| 元件 / 資源 | 來源 slice | 用途 |
|---|---|---|
| `Header` | M-1-05 | 頂部導覽(`currentPage="product"`) |
| `HomeFooter` | M-1-01 系列 | 底部(M-1-12 ProductsPage 已沿用、design `Footer` 對應到 storefront `HomeFooter`) |
| `ProductCard` | M-1-06 | Related 區 2 個 row、`showRedPrice` / `badgeStyle` props 已備 |
| `data/mock-products.ts` | M-1-08 | 商品 mock(取代 design `window.PCM_DATA.products`) |
| `data/mock-brands.ts` | M-1-08 | 品牌 mock(取代 `brandObj` 查詢) |
| `data/mock-categories.ts` | M-1-08 | 類別 mock |

### 2.2 ❌ 缺(需本 milestone 建)

| 項目 | 備註 |
|---|---|
| `app/products/[id]/page.tsx` 或 `app/products/[slug]/page.tsx` route | URL 形式待決策 §4 Q1 |
| `ProductPage.tsx`(或多檔)主體 | 592 行 JSX 必拆、§4 Q2 |
| `product-page.css`(或多檔) | 805 行、可隨 JSX 拆檔對齊 |
| `productGallery(productId)` helper | design 內定義、回傳該 product 的圖陣列 |
| `getPriceForTier(product, brandObj, tier)` 替代方案 | design 用 `window.getPriceForTier`;storefront 尚未移植(M-1-12 沿用 stub 模式、未接 tier 真邏輯) |
| 「加入購物車」`addToCart` 行為 | design 純 toast、無真 cart state;Phase 1 是否接 cart 待確認 §4 Q3 |

---

## 3. design-harness 殘留盤點(必處理)

| 殘留 | 字面位置 | 處置方向(沿用 M-1-12 慣例) |
|---|---|---|
| `window.PCM_DATA` | line 4 `const data = window.PCM_DATA` | 改 import `@/data/mock-products`、`@/data/mock-brands` |
| `window.getPriceForTier(...)` | line 291, 527 | M-1-12 sub:`product.price` / `priceForPremium`、tier 邏輯延後 M-1-14/15;或暫 hardcode general tier |
| `window.__pdSwipeX/Y/T/DidSwipe` | line 194-220 | 改 `useRef<number>()` 持 swipe state |
| `window.__lbSwipeX` | line 554-556 | 改 `useRef<number>()` |
| `window.addEventListener('keydown', onKey)` | line 14-26 | `useEffect` 內掛 + cleanup(此本身合法、保留) |
| `tweaks.memberTier` / `showRedPrice` / `badgeStyle` | 多處 | 沿用 M-1-12 stub:component 內 hardcode default tweaks、待會員系統落地 |
| `tweaks.productFilter` / `productSource` / `lastProductsContext` | line 35-36, 512-518 | 用於 breadcrumb「使用者怎麼來」判斷;Phase 1 是否接跨頁狀態待決策 §4 Q4 |
| `tweaks.vehicleFilter` | line 38, 84-94 | 全站車輛篩選 pill;跨頁同步機制待決策 §4 Q4 |
| `window.ProductPage = ProductPage` | line 592 | design harness IIFE 註冊、storefront 不需、刪 |

---

## 4. 待決策

### Q1(產品 → Sean 拍板)路由 URL 形式

design 用 `productId`(數字 ID);正式網站可選:

- **A.** `/products/[id]` 數字 ID(對齊 mock data `product.id`、最簡、與 design 字面對齊)
- **B.** `/products/[slug]` SEO 友善 slug(需每個 product 加 `slug` 欄、M-1-16 種子資料補)
- **C.** 暫用 `[id]`、M-1-16 補真資料時再切 `[slug]`(分階段)

### Q2(產品 → Sean 拍板)M-1-13 sub-slice 顆粒度

CSS 13 section + JSX 592 行可不同程度合併拆檔:

- **A. 6 個 sub-slice**(細):
  - 13a 路由 + 骨架 + Header + Breadcrumb + Vehicle Pill(CSS sec 1, 2)
  - 13b Gallery + Lightbox(CSS sec 3, 12;含 swipe + keyboard nav)
  - 13c Info column + Options(CSS sec 4, 5)
  - 13d Buy row + Services strip + Mobile sticky buy bar(CSS sec 6, 7, 13)
  - 13e Tabs(CSS sec 8、4 個 panel)
  - 13f Related + Toast + Responsive 收口(CSS sec 9, 10, 11)
  - 估時:每 sub-slice 25-40 分、總 3-4 hr、6 個 Sean 驗收 checkpoint
- **B. 4 個 sub-slice**(中):合併 13d+13e、13e+13f
  - 13a 骨架 + Breadcrumb(同上)
  - 13b Gallery + Lightbox
  - 13c Info + Options + Buy + Services + Mobile bar
  - 13d Tabs + Related + Toast + Responsive
  - 估時:每 sub-slice 40-60 分、4 個 checkpoint
- **C. 3 個 sub-slice**(粗):
  - 13a 骨架 + Breadcrumb + Gallery + Lightbox
  - 13b Info + Options + Buy + Services + Mobile bar
  - 13c Tabs + Related + Toast + Responsive
  - 估時:每 sub-slice 60-80 分、有突破 45 分上限風險、3 個 checkpoint

### Q3(產品 → Sean 拍板)「加入購物車」按鈕行為

design `addToCart` 純 toast、無真 cart state。M-1-13 處置:

- **A.** 沿用 design(toast only、不接 cart state)、cart 完整實作延後 M-2 / 經銷會員里程碑
- **B.** M-1-13 順手建 cart state(Zustand / Context / localStorage)、加入購物車後可在 Header 看到 cart count
- **C.** 純擺出按鈕、`onClick` 暫無動作、Phase 1 不接 cart

### Q4(產品 → Sean 拍板)breadcrumb 跨頁狀態 + vehicleFilter pill

design `tweaks.productFilter` / `productSource` / `lastProductsContext` 是「使用者從哪個 ProductsPage 篩選條件點進來」的記錄、用來組 breadcrumb 與「返回列表」按鈕。`tweaks.vehicleFilter` 則是全站車輛篩選 pill(顯示在 breadcrumb 旁、可一鍵清除)。

- **A.** M-1-13 不接、breadcrumb 寫死「首頁 / 商品目錄 / [類別] / [產品名]」、無 vehicle pill(最簡)
- **B.** breadcrumb + vehicleFilter 用 URL searchParams 傳(`?vehicle=...&from=...`)、無 global state、進站可重現
- **C.** 用 React Context / Zustand 做 global filter store、跨頁可記憶、投資較大(影響範圍超 M-1-13)

### Q5(架構 → Claude.ai 規劃時定、非 Sean 拍板)

- lightbox 渲染:design 字面條件渲染在 ProductPage 內(無 portal);Claude.ai 規劃時決定要否改 Portal
- gallery swipe state:用 `useRef` 取代 `window.__pdSwipe*`
- tabs state(規格/描述/FAQ/評價):`useState<'spec'|'desc'|'faq'|'review'>`

---

## 5. 鐵則對照

- **鐵則 1 直接搬:** ✅ 命中(本 slice 必直接搬 design-reference/components/ProductPage.jsx 字面、不翻譯)
- **鐵則 4 15-45 分鐘:** ✅ 命中(592 行不可能單 slice、必拆)
- **鐵則 5 CSS+TSX 同 slice:** 拆檔後每個 sub-slice 內 CSS+TSX 仍須同 slice
- **鐵則 6 檔案大小:** 元件檔 >400 必拆、>300 警戒;sub-slice 元件目標 ≤300 行
- **鐵則 8 重大改動:** ✅ 命中(跨多檔 + 新 route + 可能動 mock data 結構)→ 須先提 plan 等 Sean 批
- **鐵則 9 內容分級:** L1-L2(商品 mock data 為合約、M-1-16 補真資料);無 L3
- **鐵則 11 三綠 checkpoint:** 每 sub-slice 收尾 typecheck + lint + build(動 .ts/.tsx)
- **鐵則 12 Codex Review Packet:** M-1-13 milestone 結束時觸發(重大改動 + 進度單元結束)
- **四方分工:** 規劃 / 拆 slice / 寫 slice 指令 = Claude.ai 職責;Claude Code 本報告止於偵察

---

## 6. 建議 sub-slice 草拆(供 Claude.ai 規劃參考、非定案)

依 Q2 結果決定;若 Sean 拍 Q2=A 則對應 §4 Q2.A 6 個 sub-slice、Sean 拍 Q2=B 則 4 個。

各 sub-slice 共同收尾要求:
1. typecheck + lint + build 三綠
2. 動到 .tsx 順手補 smoke test(`*.test.tsx`、見 `docs/architecture/testing-strategy.md`)
3. STATUS.md 7 欄位更新(同 slice commit)
4. busboy-end
5. 不 push(等 Sean 手動推)

M-1-13 完整收尾(最後 sub-slice 結束)額外:
6. 鐵則 12 觸發 → 產 Codex Review Packet、提醒 Sean 貼給 Codex 唯讀審查
7. `/pcm-roadmap` 更新進度地圖

— END —
