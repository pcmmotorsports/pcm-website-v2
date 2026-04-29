# Design Reference 完整偵察報告

> **日期:** 2026-04-30
> **偵察者:** Claude Code(slice recon-design)
> **submodule HEAD:** d5ea3aa(`pcm-website-design` heads/main)
> **目的:** 為 PRD-rewrite.md 提供完整字面材料、不評論、不推測

---

## 0. 偵察總覽

### 0.1 副檔名數量統計

| 副檔名 | 數量 |
|---|---|
| .css | 15 |
| .md | 14(10 份 HANDOFF + 4 份 README) |
| .jsx | **12**(slice 預期 13、實際 12) |
| .png | 6 |
| .webp | 5 |
| .svg | 3 |
| .avif | 3 |
| .js | 2 |
| .html | 2 |
| .json | 1 |
| .jpg | 1 |

### 0.2 頂層目錄結構

```
design-reference/
├── README.md                     設計 repo 導讀
├── index.html                    SPA 入口(83 行)
├── assets/
│   ├── brand-logos/              16 個品牌 logo(.webp/.avif/.png/.svg/.jpg)
│   └── logos/                    2 個一般 logo(evotech-performance / wrs)
├── components/                   12 個 .jsx 元件
├── data/
│   ├── BRANDS-README.md          品牌資料維護指南
│   ├── PRODUCTS-README.md        商品資料維護指南
│   ├── STORES-README.md          店家資料維護指南
│   ├── products.js               window.PCM_DATA 完整 mock
│   ├── stores-loader.js          fetch stores.json 的 loader
│   └── stores.json               36 家合作店家(獨立 JSON)
├── design-handoff/
│   └── index.html                視覺版設計系統一覽(體積大、本次未細讀)
├── design-reference/             ← 9 份 HANDOFF docs(實際 10 份)
│   ├── HANDOFF-API.md
│   ├── HANDOFF-CHANGELOG.md
│   ├── HANDOFF-COMPONENTS.md
│   ├── HANDOFF-DEPLOY.md
│   ├── HANDOFF-DETAILS.md
│   ├── HANDOFF-OVERVIEW.md
│   ├── HANDOFF-PAGES.md
│   ├── HANDOFF-ROADMAP.md
│   ├── HANDOFF-TOKENS.md
│   └── HANDOFF-TWEAKS.md
└── styles/                       15 個 .css 檔
```

### 0.3 與 slice 預期數量差異

| 項目 | slice 預期 | 實際 | 差異 |
|---|---|---|---|
| .jsx 元件 | 13 | **12** | -1 |
| .css 檔 | 15 | 15 | ✓ |
| HANDOFF docs | 9 | **10** | +1(多了 HANDOFF-TWEAKS.md) |

---

## 1. Components 清單(12 個 .jsx)

### 1.1 App.jsx(528 行)

- **路徑:** `design-reference/components/App.jsx`
- **角色:** 頂層 shell + 路由 switcher + Tweaks 面板 + 多個 sub-component
- **內含 sub-component:** `VehicleDrawer` / `MobileMenu` / `MobileTabBar` / `MobileWrapper` / `PageSwitcher` / `TweaksPanel` / `App`
- **Props(App 元件):** 無 props、自管 state(tweaks / tweaksVisible / mobileMenu / vehicleDrawer / searchOpen / searchSeed / autoNarrow)
- **依賴:** `window.PCM_DATA` / `localStorage('pcm-tweaks' / 'pcm-tweaks-v')` / `window.parent.postMessage` / `pcm-vehicle-filter-change` 自定義事件 / `pcm-open-search` 自定義事件
- **className 用法:** `vf-*`(VehicleDrawer)/ `mm-*`(MobileMenu)/ `mobile-*`(MobileTabBar / MobileWrapper)/ `tweaks-*`(TweaksPanel)/ `viewport-stage`
- **核心邏輯:** `loadTweaks()` 含 TWEAKS_VERSION=3 升級防禦;`onNav(p, ctx)` 統一路由切換、處理 13 種 page id;`effectiveTweaks` 在窄 viewport(<900px)自動把 filterStyle 切為 drawer
- **HANDOFF 引用:** OVERVIEW §6 全域狀態 schema、COMPONENTS Header/MobileTabBar/Tweaks Panel 段、TWEAKS 全份

### 1.2 Header.jsx(108 行)

- **路徑:** `design-reference/components/Header.jsx`
- **角色:** 全站 sticky header(桌機 / 手機雙模)
- **Props:** `cartCount = 4` / `onMenuClick` / `isMobile` / `currentPage = 'products'` / `onNav = () => {}`
- **依賴:** `window.dispatchEvent('pcm-open-search')`、`document.querySelector('[data-mobile="true"]')`
- **className 用法:** `pcm-header` / `pcm-header-inner` / `pcm-logo` / `pcm-nav` / `pcm-nav-item` / `pcm-nav-sale` / `pcm-search` / `pcm-icon-btn` / `pcm-cart` / `pcm-cart-dot`
- **navItems 寫死(7 條):** 商品目錄 / 依車輛搜尋 / 品牌 / 新品 / 特價(sale 旗標)/ 安裝預約 / 合作店家
- **export:** `window.Header = Header`
- **HANDOFF 引用:** COMPONENTS Header 段、PAGES 各頁開頭的 sticky 規格、DETAILS §1.1 字級表

### 1.3 HomePage.jsx(358 行)

- **路徑:** `design-reference/components/HomePage.jsx`
- **角色:** Editorial 風首頁(Apple × Hermès × Uniqlo)
- **內含 sub-component:** `HomeHero` / `VehicleFinder` / `FeatureEditorial` / `CategoryGrid` / `HomeSelect` / `HomeStatement` / `BrandIndex` / `HomeFooter` / `HomePage`(root)
- **Props(HomePage):** `tweaks` / `onNav = () => {}`
- **依賴:** `window.PCM_DATA.motoBrands / products / brands` / Unsplash CDN 圖片(`https://images.unsplash.com/photo-...`)
- **className 用法:** 統一 `ed-*` 前綴(editorial)、區塊用 N°01–N°06 編號
- **頁面 8 段:** Hero / Vehicle Finder / Feature Editorial(RIZOMA)/ Category Grid(8 大分類 hardcode)/ The Selection(4 件 featured)/ Statement(黑底服務承諾)/ Brand Index(品牌列表)/ Footer
- **CategoryGrid 8 個 hardcode 分類:** exhaust / brake / suspension / control / body / electronic / protection / carbon(與 PCM_DATA.categories 不一致)
- **export:** `window.HomePage = HomePage; window.SiteFooter = HomeFooter`
- **HANDOFF 引用:** PAGES 首頁段、DETAILS §1.1 hero clamp(48px, 8.5vw, 120px)

### 1.4 ProductsPage.jsx(463 行)

- **路徑:** `design-reference/components/ProductsPage.jsx`
- **角色:** 商品列表頁、四種 filterStyle(top / side / drawer / cascade)
- **內含 sub-component:** `SortBar` / `PageHeader` / `ProductsPage`(root)/ `MobileFab` / `Pagination`
- **Props(ProductsPage):** `tweaks` / `onNav = () => {}`
- **依賴:** `window.PCM_DATA` / `localStorage('pcm-per-page' / 'pcm-tweaks')` / `window.parent.postMessage` / `pcm-vehicle-filter-change` 事件 / `ReactDOM.createPortal`(MobileFab → mobile-fab-slot)
- **className 用法:** `pp-*`(products page)前綴、`ft-*`(filter top)、`fs-*`(filter side)
- **PageHeader props:** `filters` / `resultCount` / `onNav` — 標題僅 title + breadcrumb(對齊 NORTHSTAR §3)
- **filterProducts() 寫死的 price ranges:** 0-3000 / 3000-10000 / 10000-30000 / 30000-100000 / 100000+
- **inflate 邏輯:** 為 demo 把資料量乘 8 倍(target ≥ 24)、附 `_originalId` 保留真 id
- **MobileFab portal:** 找 `#mobile-fab-slot` 進去、找不到就 inline render
- **export:** `window.ProductsPage`、`window.MobileFab`、`window.Pagination`
- **HANDOFF 引用:** PAGES 商品列表頁段、COMPONENTS FilterTop / FilterSide / FilterDrawer / MobileFab 段

### 1.5 ProductPage.jsx(584 行、最大檔)

- **路徑:** `design-reference/components/ProductPage.jsx`
- **角色:** 商品詳情頁(editorial gallery + buybar + lightbox)
- **Props:** `tweaks` / `onNav` / `productId`
- **依賴:** `window.PCM_DATA.products / categories / brands / motoBrands` / `productGallery(seed)` 由 ProductCard 提供 / Unsplash 圖片
- **className 用法:** `pd-*`(product detail)前綴
- **breadcrumb 邏輯:** 依 `tweaks.productSource.source` 反推路徑(home / catalog / brand / new / sale / search / 缺失 fallback 走 productFilter.brand → category)
- **vehiclePill:** 從 `tweaks.vehicleFilter` 渲染、有 `×` 可清、點 pill 回該車款列表
- **state:** color / size / qty / tab / liked / toast / activeImg / lightbox
- **size options 動態算:** 依 product.category 字串(排氣 / 碳纖 / 避震 / 卡鉗)分支
- **color options:** 主色 + 額外 2 色(從固定 pool slice)
- **tabs:** description / specs / install / warranty(內容 hardcode + 用 product.brand 樣板填字)
- **gallery 觸控:** swipe 距離 > 40px 切圖、< 8px / < 280ms 視為 tap → 開 lightbox
- **mobile buybar 返回邏輯:** 依 ps.source 分支回對應頁
- **export:** `window.ProductPage`
- **HANDOFF 引用:** PAGES 商品詳情頁段(含手機 buybar 邏輯完整 JS 範例)、DETAILS §3 用色

### 1.6 ProductCard.jsx(152 行)

- **路徑:** `design-reference/components/ProductCard.jsx`
- **角色:** 商品卡 + hover-swap 圖片
- **內含 sub-component:** `productGallery(seed)`(deterministic gallery 產生、export 共用)/ `ProductImage` / `ProductCard`
- **PRODUCT_IMG_POOL hardcode:** 15 張 Unsplash photo IDs
- **Props(ProductCard):** `p` / `showRedPrice` / `badgeStyle = 'minimal'` / `compact = false` / `onClick`
- **badgeStyle 4 變體:** `minimal`(直角)/ `pill`(999px)/ `corner`(顯示 -X% 折扣)/ `none`
- **className 用法:** `pcard-*` 前綴、`badge` / `badge-min` / `badge-pill` / `badge-corner` / `badge-dark` / `badge-red`
- **hover 行為:** 圖片 cross-fade index 0 → 1、550ms ease + 1.4s scale 1.04 transform
- **export:** `window.ProductCard`、`window.ProductImage`
- **HANDOFF 引用:** COMPONENTS ProductCard 段、Badge 系統段、DETAILS §1.1 商品卡字級

### 1.7 AccountPages.jsx(741 行)

- **路徑:** `design-reference/components/AccountPages.jsx`
- **角色:** 5 個會員相關頁面合一檔
- **內含 sub-component:** `CartPage` / `LoginPage` / `RegisterPage` / `AccountPage` / `OrdersPage`(等於 AccountPage)/ `InlineAddressForm` / `InlineVehicleForm` / `AddressModal`(legacy null)/ `VehicleModal`(legacy null)
- **Props:** 各頁皆 `onNav` + 部分 `tweaks`
- **依賴:** `window.PCM_DATA` / `localStorage('pcm-cart' / 'pcm-user' / 'pcm-addresses' / 'pcm-vehicles')`
- **className 用法:** `ap-*` 共用 / `cart-*` / `auth-*` / `acc-*`
- **CartPage:** 種子 cart 從 products[0..3] / 寫死 coupon `PCM100` 折 NT$500 / 滿 NT$3,000 免運(其他地方寫滿 NT$4,000)
- **LoginPage:** 寫 localStorage `pcm-user`、不真實驗證
- **RegisterPage:** 同上
- **AccountPage:** 6 個 tab(overview / orders / favorites / vehicles / address / profile)、addresses / vehicles 持久化
- **AccountPage 寫死的 stats:** Member level VIP / Total orders 12 / Reward points 2,450(全 hardcode)
- **AccountPage 寫死的 orders:** 3 筆 PCM-2026-00xx
- **OrdersPage:** 直接 `return <AccountPage onNav={onNav} />` — 共用一個元件
- **export:** `window.CartPage / LoginPage / RegisterPage / AccountPage / OrdersPage`
- **HANDOFF 引用:** PAGES 會員相關段(段落較簡短、本檔內容比 HANDOFF 多)

### 1.8 Pages.jsx(874 行、含多頁)

- **路徑:** `design-reference/components/Pages.jsx`
- **角色:** 9 個輔助頁面合一檔
- **內含 sub-component:** `PageHero` / `CatalogPage` / `BrandsPage` / `BrandTile` / `BrandDetailPage` / `FilteredListPage` / `NewPage` / `SalePage` / `InstallPage` / `StoresPage` / `ShippingPage` / `Footer`(delegate)/ `SubNav`
- **依賴:** `window.PCM_DATA` / `window.SiteFooter`(從 HomePage.jsx export)/ `window.L`(Leaflet 地圖)/ `window.PCM_DATA.stores`
- **className 用法:** 各頁不同前綴、共用 `page-hero-*` / `pp-*`
- **FilteredListPage:** 共用元件、給 BrandDetail / New / Sale 用、含完整篩選 + 排序 + grid + ActiveChips
- **InstallPage:** 4 步驟 wizard(店家選 → 時段 → 車輛 / 服務 → 確認)、寫死 services 7 項與 times 7 個時段
- **StoresPage:** 含 Leaflet 地圖實作、5 個 useEffect 處理 marker / fitBounds / 區域切換 / 'pcm:stores-updated' 事件
- **ShippingPage:** 3 tab(shipping / returns / faq)、寫死 4 種配送方式 + 5 條 FAQ
- **export:** `window.CatalogPage / BrandsPage / BrandDetailPage / NewPage / SalePage / InstallPage / StoresPage / ShippingPage / Footer / PageHero / SubNav`
- **HANDOFF 引用:** PAGES 大部分段落、ROADMAP §技術債(本檔 800+ 行需拆)

### 1.9 FilterSide.jsx(233 行)

- **路徑:** `design-reference/components/FilterSide.jsx`
- **角色:** 桌機左側篩選欄(filterStyle ∈ {side, cascade})
- **內含 sub-component:** `Accordion` / `VehicleTree` / `CategoryTree` / `CheckboxList` / `PriceRangeSlider` / `FilterSide`
- **Props(FilterSide):** `filters` / `setFilters` / `data` / `hideVehicle`(cascade 模式時 true)
- **className 用法:** `fs-*` 前綴
- **PriceRangeSlider:** min=0 max=150000 step=500 + 4 個 preset(<5K / 5K-20K / 20K-50K / 50K+)
- **顏色 7 色 hardcode:** black / silver / red / gold / titanium / blue / white
- **export:** `window.FilterSide`
- **HANDOFF 引用:** COMPONENTS FilterSide 段、DETAILS §3.1 元件用色

### 1.10 FilterTop.jsx(471 行)

- **路徑:** `design-reference/components/FilterTop.jsx`
- **角色:** 頂部篩選列(2 種變體) + ActiveChips
- **內含 sub-component:** `Chevron` / `FilterTop` / `CategoryPanel` / `CascadeFilterTop` / `ActiveChips`
- **Props(FilterTop):** `filters` / `setFilters` / `data` / `onSortChange` / `sort` / `resultCount`
- **Props(CascadeFilterTop):** `filters` / `setFilters` / `data` / `onOpenDrawer`
- **Props(ActiveChips):** `filters` / `setFilters` / `data`
- **className 用法:** `ft-*`(filter top)/ `cft-*`(cascade)/ `ac-*`(active chips)
- **CategoryPanel:** 兩欄 cascade(大分類 → 細項)、寬版「細項」欄
- **CascadeFilterTop:** 桌機三 select bar(品牌 / 車型 / 年份)+ 手機精簡 chip
- **ActiveChips:** 渲染 vehicle / category / brands / price / inStock / isNew / isSale / colors 八類 chip
- **export:** `window.FilterTop`、`window.CategoryPanel`、`window.CascadeFilterTop`、`window.ActiveChips`
- **HANDOFF 引用:** COMPONENTS FilterTop / CascadeFilterTop 段

### 1.11 FilterDrawer.jsx(258 行)

- **路徑:** `design-reference/components/FilterDrawer.jsx`
- **角色:** 全螢幕 / 底部抽屜篩選(手機優先)
- **Props:** `open` / `onClose` / `filters` / `setFilters` / `data` / `resultCount` / `initialTab`
- **className 用法:** `fd-*` 前綴
- **6 個 tab:** vehicle / category / brand / price / color / other(每個 tab 顯示 active count)
- **vehicle tab 是三層 drilldown 介面:** brand → model → year(用 vehBrand / vehModel state)
- **category tab:** 兩層(catMain → 細項 / 全部)
- **顏色 6 色:** black / silver / red / gold / titanium / blue(比 FilterSide 少 1 個 white)
- **footer:** 「清除」+「查看 N 件商品」
- **export:** `window.FilterDrawer`
- **HANDOFF 引用:** COMPONENTS FilterDrawer 段、CHANGELOG「手機篩選改浮動視窗」決策

### 1.12 SearchOverlay.jsx(206 行)

- **路徑:** `design-reference/components/SearchOverlay.jsx`
- **角色:** 全螢幕搜尋(keyboard-first、fuzzy、即時結果)
- **Props:** `open` / `onClose` / `onNav` / `initialQuery = ''`
- **className 用法:** `search-overlay-*` 前綴 / `sop-*`(search overlay product)
- **fuzzy match 4 類:** products(name / brand / category / sku、最多 8)、brands(從 products 抽 distinct、最多 6)、categories(name / id、最多 6)、vehicles(brand / model 名、最多 6)
- **熱門搜尋 6 個 hardcode:** 排氣管 / 碳纖維 / 腳踏 / Öhlins / Akrapovič / CBR600RR
- **submit 行為:** `onNav('products', { search: query.trim() })`
- **export:** `window.SearchOverlay`
- **HANDOFF 引用:** COMPONENTS SearchOverlay 段、DETAILS §2.1 inline SVG 規範

---

## 2. Styles 清單(15 個 .css)

### 2.1 tokens.css(108 行)

- **路徑:** `design-reference/styles/tokens.css`
- **角色:** 🟢 token 檔(所有 token 唯一定義處、依 HANDOFF-TOKENS §1)
- **CSS 變數(28 個):** `--c-bg / --c-surface / --c-surface-2 / --c-surface-3 / --c-border / --c-border-strong / --c-text / --c-text-2 / --c-text-3 / --c-text-inverse / --c-red / --c-red-soft / --c-red-dark / --f-sans / --f-mono / --scale / --r-sm(2px) / --r-md(4px) / --r-lg(8px) / --sh-sm / --sh-md / --sh-lg / --s-1 ... --s-8`
- **`[data-theme="dark"]` selector:** 重新指定中性階 9 個變數、紅色不變
- **基礎 reset:** `* { box-sizing }` / `html, body { margin: 0 }` / `button` 重設 / `:focus-visible` outline
- **placeholder `.ph`:** 條紋斜線 + mono label

### 2.2 header.css(50+ 行)

- **角色:** 🔵 元件檔(Header)
- **CSS 變數:** 無新增、用 tokens
- **selector 命名:** `.pcm-header / .pcm-header-inner / .pcm-logo / .pcm-nav / .pcm-nav-item`
- **重點:** sticky top:0 z-index:40 / `backdrop-filter: blur(12px)` / max-width 1440 / padding 14px 48px(手機 12 16)

### 2.3 home.css(50+ 行)

- **角色:** 🔵 元件檔(HomePage)
- **CSS 變數(scoped):** `--ed-gutter / --ed-max / --ed-c-ink / --ed-c-ink-soft / --ed-c-ink-mute / --ed-c-rule / --ed-c-paper / --ed-c-paper-2 / --ed-c-accent`(在 `.ed-page` scope 內、不全域汙染)
- **selector 命名:** `.ed-*` 前綴(editorial)
- **`.ed-page em` 強制 serif:** 中文 italic 自動套 Noto Serif TC

### 2.4 home.v1.css(30+ 行,**退役**)

- **角色:** ❌ 退役檔(README 提到「保留檔但不引用」)
- **selector 命名:** `.home-hero` / `.home-hero-img` / `.home-hero-content`(舊版 home 結構)
- **注意:** index.html 仍未引用此檔(grep 結果 home.css 引用、無 v1)

### 2.5 product-card.css(50+ 行)

- **角色:** 🔵 元件檔(ProductCard)
- **selector 命名:** `.pcard / .pcard-img-wrap / .pcard-badge / .badge / .badge-min / .badge-pill / .badge-corner / .badge-dark / .badge-red`
- **重點:** aspect-ratio 1/1、`.pcard-img-wrap::after` rgba 0.04 hover overlay

### 2.6 product-page.css(50+ 行)

- **角色:** 🔵 元件檔(ProductPage)
- **CSS 變數(scoped alias):** `--ink / --ink-tert / --ink-mute / --paper / --paper-2 / --line / --font-sans / --font-serif / --font-mono`(brigdge 到全域 token、用不同名)
- **selector 命名:** `.pd-*` 前綴(product detail)
- **breadcrumb 特殊:** mono / uppercase / letter-spacing 0.08em

### 2.7 products-page.css(50+ 行)

- **角色:** 🟣 layout 檔(ProductsPage 大架構)
- **selector 命名:** `.pp-*` 前綴
- **重點:** `.pp-layout.has-side` 用 grid 220px 1fr / `.pp-head` sticky 三層 top 值依 filterStyle attr 切(top:69px / 121px(cascade)/ 127px(top))

### 2.8 filter-top.css(50+ 行)

- **角色:** 🔵 元件檔(FilterTop)
- **selector 命名:** `.ft-*` 前綴
- **重點:** sticky top:69px z-index:30 / chip is-selected 切黑底白字

### 2.9 filter-side.css(50+ 行)

- **角色:** 🔵 元件檔(FilterSide)
- **selector 命名:** `.fs-*` 前綴
- **重點:** width 220px sticky top:69px(cascade 模式 121px)/ 自管 height calc(100vh - 69px)overflow-y auto

### 2.10 filter-drawer.css(50+ 行)

- **角色:** 🔵 元件檔(FilterDrawer)
- **selector 命名:** `.fd-*` 前綴
- **animations:** `fd-fade` / `fd-slide`(transform translateX)/ `fd-float-up`(transform translateY)
- **手機(<640px)變浮動 panel:** bottom:72px、border-radius 12px(此處與「直角」原則衝突、是浮動樣式)

### 2.11 pages.css(50+ 行)

- **角色:** 🟣 layout 檔(共用 page hero / 分類 / 品牌 grid)
- **selector 命名:** `.page-hero-*` / `.page-product-grid` / `.brand-detail-grid` / `.cat-tile` / `.brand-tile`
- **breakpoints:** ≥1200 5col / 900-1200 4col / <900 2col

### 2.12 account.css(50+ 行)

- **角色:** 🔵 元件檔(AccountPages)
- **selector 命名:** `.ap-*` 共用 / `.cart-*` / `.auth-*` / `.acc-*`
- **`.ap-mono` 用 IBM Plex Mono:** 與全域 `--f-mono`(JetBrains Mono)不同 — drift

### 2.13 search-overlay.css(50+ 行)

- **角色:** 🔵 元件檔(SearchOverlay)
- **selector 命名:** `.search-overlay-*` 前綴
- **animations:** `soFade` / `soSlide`
- **z-index:** 1000(全站最高)

### 2.14 vehicle-drawer.css(50+ 行)

- **角色:** 🔵 元件檔(VehicleDrawer in App.jsx)
- **selector 命名:** `.vf-*` 前綴
- **CSS 變數(用 product-page.css 的 alias):** `--paper / --line / --ink / --ink-tert / --font-mono / --font-serif / --font-sans` — 依賴 product-page.css 先載入
- **重點:** width min(520px, 100vw)、transition 340ms cubic-bezier、z-index 901(在 search-overlay 之下)

### 2.15 tweaks.css(80+ 行)

- **角色:** 🟢 token 檔 + override layer(對齊 HANDOFF-TOKENS §10「最後加載」)
- **selector 命名:** `.tweaks-fab` / `.tweaks-panel` / `.tweaks-*`(group / label / hint / seg / toggle 等)
- **唯一例外圓角 999px:** `.tweaks-fab` 用 999px(對齊 HANDOFF-TOKENS §3「Toast / MobileFab / pill 三例外」)
- **生產應整段拿掉:** 對齊 HANDOFF-TWEAKS §1

---

## 3. Data Mock 清單

### 3.1 products mock(`window.PCM_DATA.products`)

- **路徑:** `design-reference/data/products.js`(行 154-175 抽樣讀)
- **筆數:** 20 筆
- **欄位 shape:**

```ts
type Product = {
  id: number;            // 1, 2, 3, ...
  brand: string;         // 字串、必須等於 brands[].name(全大寫)、例 'CNC RACING'
  name: string;          // 完整品名(可含品牌前綴)
  fits: string;          // 自由字串車款描述、例 'CBR600RR' / 'YAMAHA R6' / 'Panigale V4' / '通用款'
  price: number;         // TWD 整數、無千分位逗號
  origPrice: number | null;  // 原價、無特價填 null
  isNew: boolean;
  isSale: boolean;
  inStock: boolean;
  category: string;      // '大類 · 小類' 字串、例 '操控部品 · 腳踏後移'
  color: string;         // silver / black / gold / titanium / red / blue / yellow
  imgTone: string;       // cool / warm / dark / gold / neutral / red(縮圖底色基調)
};
```

- **完整範例(id: 6):**

```js
{
  id: 6,
  brand: 'AKRAPOVIČ',
  name: 'Akrapovič 鈦合金全段排氣',
  fits: 'Panigale V4',
  price: 98000,
  origPrice: 112000,
  isNew: false,
  isSale: true,
  inStock: false,
  category: '引擎部品 · 排氣管',
  color: 'titanium',
  imgTone: 'warm',
}
```

- **PRODUCTS-README 補充:** 真實上線時建議補 `vehicleIds: string[]`(`['ducati:panigale-v4:2020', ...]`)、`images: string[]`、`thumb`、`desc`、`specs`、`stock`、`weight`、`installTime`
- **PRODUCTS-README 注意:** category 中間是「全形空格 + 全形中圓點 + 全形空格」、brand 必須與 brands[].name 完全一致(全大寫)

### 3.2 brands mock(`window.PCM_DATA.brands`)

- **路徑:** 同上(行 10-27)
- **筆數:** 16 個品牌
- **欄位 shape:**

```ts
type Brand = {
  id: string;            // 小寫橫線 slug、例 'cnc-racing'
  name: string;          // 全大寫顯示名、例 'CNC RACING'
  count: number;         // 該品牌商品數(顯示用、不嚴)
  country: string;       // ISO 兩字 code、'IT' / 'UK' / 'TH' / 'DE' / 'ES' / 'LU'
  tagline: string;       // 中文、≤10 字
  since: number;         // 4 位數年份
  hero: string;          // hex 色、例 '#fff5e0'
  logo: string;          // 相對路徑、例 'assets/brand-logos/bonamici.webp'
  logoBg: 'transparent' | string;
  heroText?: 'dark';     // 亮色 hero 加 'dark'、深色 hero 省略
};
```

- **完整範例(id: 'lightech'):**

```js
{
  id: 'lightech',
  name: 'LIGHTECH',
  count: 74,
  country: 'IT',
  tagline: '義式賽道工藝精品',
  since: 1997,
  hero: '#f7eab8',
  logo: 'assets/brand-logos/lightech.png',
  logoBg: 'transparent',
  heroText: 'dark',
}
```

- **16 個品牌列表:** bonamici / cnc-racing / dbk / eazi-grip / evotech / extreme / front3d / gb-racing / gilles / kineo / lightech / materya / motogadget / rpm-carbon / samco / wrs

### 3.3 motoBrands mock(`window.PCM_DATA.motoBrands`)

- **筆數:** 8 個重機品牌
- **欄位 shape:**

```ts
type MotoBrand = {
  id: string;          // 'yamaha' / 'honda' / ...
  name: string;        // 'YAMAHA' / 'HONDA'
  models: Array<{
    id: string;        // 'r1' / 'cbr1000rr'
    name: string;      // 'YZF-R1' / 'CBR1000RR-R'
    years: number[];   // 例 [2020, 2021, 2022, 2023, 2024]
  }>;
};
```

- **8 個品牌:** yamaha / honda / ducati / bmw / kawasaki / aprilia / suzuki / mv-agusta(共約 24 個 model)
- **HANDOFF-API §2 注意:** years 必須是「有商品支援的年份」、不要把全車系年份都列;支援部分選擇即可搜尋

### 3.4 categories mock(`window.PCM_DATA.categories`)

- **筆數:** 12 個大類、各含 children(細類)
- **欄位 shape:**

```ts
type Category = {
  id: string;           // 'agency' / 'body-protection' / 'wheels' / ...
  name: string;         // '代理配件' / '車身防護' / ...
  count: number;        // 該類商品數(顯示用)
  children: Array<{
    id: string;
    name: string;
    count: number;
  }>;
};
```

- **12 個大類:** agency(639)/ body-protection(142)/ wheels(24)/ exhaust(58)/ track(72)/ suspension(38)/ carbon(54)/ oem(220)/ brake(56)/ consumable(94)/ bling(88)
- **與 products 的對齊問題:** products[].category 是「大類 · 小類」字串、不是 categories[].id 引用

### 3.5 stores mock(`window.PCM_DATA.stores` + `data/stores.json`)

- **路徑:** `data/stores.json`(主)+ `data/products.js` 內 fallback(同步同欄位)
- **loader:** `data/stores-loader.js`(64 行)、fetch stores.json、失敗 fallback、派發 `pcm:stores-updated` 事件
- **筆數:** 36 家
- **欄位 shape:**

```ts
type Store = {
  id: number;
  name: string;
  region: '北部' | '中部' | '南部' | '東部';   // enum 4 值
  addr: string;
  phone: string;       // 無填 '—'
  hours: string;       // 無填 '—'
  services: string[];  // 至少 1 項
  lat: number;         // 緯度
  lng: number;         // 經度
  isHQ?: boolean;      // 全站僅 1 家可 true
};
```

- **完整範例(id: 1):**

```json
{
  "id": 1,
  "name": "PCM 新莊總店",
  "region": "北部",
  "addr": "新北市新莊區化成路736巷18號一樓",
  "phone": "02-2998-xxxx",
  "hours": "週一-週六 10:00-20:00",
  "services": ["販售", "安裝", "取貨"],
  "lat": 25.047,
  "lng": 121.45,
  "isHQ": true
}
```

- **services 已用枚舉:** 販售 / 安裝 / 取貨 / 維修 / 改裝 / 輪胎 / 租車 / 托運 / 物流 / 道路救援 / 二手車 / BMW 維修
- **STORES-README §6:** schema 變更要升 _meta.version、`stores.json` 設計 = 未來 Headless / Google Sheet 方案的最終資料格式
- **`_meta` 結構:** `{ version: '1.0', updated: '2026-04-29', source: 'manual', _comment: ... }`

### 3.6 customer / user mock — **不存在**

- design 完全沒有 user / customer mock
- AccountPages 的「會員等級 / 訂單記錄 / 收藏」全部 hardcode 在 jsx 內
- localStorage 只存 `pcm-user`(email / name / phone / loggedIn)— 純前端 mockup

### 3.7 orders mock — **不存在**(部分 hardcode)

- AccountPage 內 hardcode 3 筆訂單(PCM-2026-0042 / 0038 / 0029)
- 無 order schema 定義

---

## 4. HANDOFF Docs 摘要(實際 10 份)

### 4.1 HANDOFF-OVERVIEW.md

- **路徑:** `design-reference/design-reference/HANDOFF-OVERVIEW.md`
- **摘要:** 5 份(實際 10 份)文件索引 + 衝突優先序(DETAILS > TOKENS > COMPONENTS > PAGES > OVERVIEW)+ 本輪修改範圍 + 設計哲學 10 條 + 命名慣例(11 個前綴)+ 路由 / 頁面 ID 速查 + 全域狀態 schema + 檔案結構索引
- **對應檔:** 全域索引、所有檔

### 4.2 HANDOFF-TOKENS.md

- **路徑:** 同上
- **摘要:** Token 使用規則白名單(顏色 / Type / Radius / Shadow / Spacing / Scale)+ 紅色 7 處白名單 + 圓角 999px 三例外 + CSS 加載順序
- **對應檔:** `tokens.css`(全內容定義)、`tweaks.css`(覆寫層)

### 4.3 HANDOFF-COMPONENTS.md

- **路徑:** 同上
- **摘要:** 共用元件視覺規格逐一列出 — Header / MobileTabBar / ProductCard / FilterTop / CascadeFilterTop / FilterSide / FilterDrawer / MobileFab / VehicleDrawer / SearchOverlay / Badge 系統 / Toast / Tweaks Panel + 廢棄項
- **對應檔:** 全部 12 個 .jsx + 對應 .css

### 4.4 HANDOFF-PAGES.md

- **路徑:** 同上
- **摘要:** 12 頁逐頁規格(URL / 麵包屑 / 區塊 / 響應式 / 互動 / 邊界 / trade-offs)— 首頁 / 商品目錄 / 商品列表 / FilteredListPage / 商品詳情 / 安裝預約 / 配送退貨 / 會員相關
- **對應檔:** HomePage.jsx / Pages.jsx(主要)/ ProductsPage.jsx / ProductPage.jsx / AccountPages.jsx

### 4.5 HANDOFF-DETAILS.md

- **路徑:** 同上
- **摘要(僅讀前 200 行):** 精確到 px 細節 — 文字大小完整對照(桌機 / 手機)、字級 Tweak、Icon 使用規則、emoji 政策、用色細節(token 對照表 + 紅色 7 處白名單)、邊框圓角白名單
- **對應檔:** 全部、最權威(對齊現行 CSS + JSX 校對)

### 4.6 HANDOFF-API.md

- **路徑:** 同上
- **摘要:** 真實串接清單 — `GET /api/brands` / `/api/vehicles/brands` / `/api/products` / `/api/products/:id` / `/api/stores` / `POST /api/install/booking` / `POST /api/contact` / `GET /api/search` + 會員系統 endpoint(策略不限定)+ 圖片資源策略 + 升級到真 API 的最小改動
- **對應檔:** 對應商品 / 品牌 / 店家 mock、`stores-loader.js`

### 4.7 HANDOFF-CHANGELOG.md

- **路徑:** 同上
- **摘要(僅讀前 80 行):** 設計決策時序(不是 git log)、標記 🎨/🏗/⚙️/❌/🔄 — 2026-04-29 交接準備(stores 抽 JSON / 5 份文件成形)、2026-04 中下旬手機優化(篩選改浮動視窗)、2026-04 中旬篩選系統大改(3 種 layout 並存)、2026-04 上旬品牌頁定調
- **對應檔:** 跨檔(設計史)

### 4.8 HANDOFF-DEPLOY.md

- **路徑:** 同上
- **摘要:** 部署 / 環境策略 — 現況(React 18 + Babel in-browser)→ 生產建議(Next.js 14 / Vite + 自架 BFF / 純靜態 + Headless CMS 三 tier)+ 部署選項對比(Vercel / Cloudflare Pages / Netlify / 自架 / AWS)+ 圖片策略 + 安全合規 + 監控
- **對應檔:** 全域(策略性)

### 4.9 HANDOFF-ROADMAP.md

- **路徑:** 同上
- **摘要:** 已知 issue / TODO / 技術債 — 🔴 必做(loading / 表單驗證 / 路由 / 會員)、🟡 建議做(響應式 / 互動 / 效能 / a11y / SEO)、🟢 加值、💡 想法 + 已知技術債(products.js 龐大 / Tweaks 散在 App.jsx / Pages.jsx 800+ 行需拆 / CSS @import 鏈深)
- **對應檔:** 全域(策略性 TODO)

### 4.10 HANDOFF-TWEAKS.md

- **路徑:** 同上
- **摘要:** Tweaks 面板系統說明 — 是設計探索工具不是業務邏輯、`?tweaks=1` URL 開啟、page / filterLayout / cardDensity / cardStyle / theme / viewport 開關 + 哪些是「設計決策」(filterLayout / cardDensity / cardStyle 拍板後寫死)、生產整段拿掉的 4 步驟
- **對應檔:** App.jsx 內 TweaksPanel + tweaks.css(整段移除指引)

---

## 5. 路由結構(從 index.html 推測)

### 5.1 入口

- **路徑:** `design-reference/index.html`(83 行)
- **lang:** `zh-Hant`
- **title:** `PCM Motorsports — Redesign`
- **特殊:** 含 `<template id="__bundler_thumbnail">` SVG 縮圖、`data-bg-color="#0a0a0a"`(打包工具用)
- **掛載點:** `<div id="root"></div>`

### 5.2 引用 css(13 個 + Leaflet 1 個 = 14 個)

按順序:
1. tokens.css
2. header.css?v=2
3. product-card.css?v=3
4. filter-top.css?v=10
5. filter-side.css?v=10
6. filter-drawer.css?v=10
7. products-page.css?v=10
8. home.css?v=2
9. pages.css?v=11
10. product-page.css?v=5
11. vehicle-drawer.css
12. account.css
13. search-overlay.css?v=1
14. tweaks.css?v=15
15. (外部)https://unpkg.com/leaflet@1.9.4/dist/leaflet.css

注意:**home.v1.css 未引用**(對齊 README「退役」)

### 5.3 引用 js(15 個)

按順序:
1. unpkg react@18.3.1(development build)
2. unpkg react-dom@18.3.1
3. unpkg @babel/standalone@7.29.0(in-browser JSX 編譯)
4. (外部)leaflet@1.9.4
5. data/products.js?v=11
6. data/stores-loader.js?v=1
7. components/Header.jsx?v=10(text/babel)
8. components/SearchOverlay.jsx?v=2
9. components/ProductCard.jsx?v=8
10. components/FilterTop.jsx?v=10
11. components/FilterSide.jsx?v=10
12. components/FilterDrawer.jsx?v=10
13. components/ProductsPage.jsx?v=21
14. components/HomePage.jsx?v=9
15. components/Pages.jsx?v=23
16. components/ProductPage.jsx?v=11
17. components/AccountPages.jsx?v=5
18. components/App.jsx?v=19(最後載入、含 mount())

### 5.4 可見路由(SPA、無 hash router、用 tweaks.page)

對齊 HANDOFF-OVERVIEW §5、共 13 個 page id:

| `tweaks.page` | URL 對應 | 對應元件 |
|---|---|---|
| `home` | `/` | HomePage |
| `catalog` | `/catalog` | CatalogPage |
| `products` | `/products?...` | ProductsPage |
| `brands` | `/brands` | BrandsPage |
| `brand-detail` | `/brands/:brandId` | BrandDetailPage(走 FilteredListPage) |
| `new` | `/new` | NewPage(走 FilteredListPage) |
| `sale` | `/sale` | SalePage(走 FilteredListPage) |
| `product` | `/products/:productId` | ProductPage |
| `install` | `/install` | InstallPage |
| `stores` | `/stores` | StoresPage |
| `shipping` | `/shipping` | ShippingPage |
| `cart` | `/cart` | CartPage |
| `account` | `/account` | AccountPage |
| `login` | `/login` | LoginPage |
| `register` | `/register` | RegisterPage |
| `orders` | `/orders` | OrdersPage(實作直接 return AccountPage) |

### 5.5 SEO 相關(meta tag)

- `<meta charset="UTF-8">`
- `<meta name="viewport" content="width=device-width, initial-scale=1">`
- **無 OG / Twitter card / structured data / sitemap / robots.txt**(對齊 ROADMAP §🟡 SEO「沒有 meta tag 系統 / OG image / sitemap」)
- 字型 preconnect:`fonts.googleapis.com` / `fonts.gstatic.com`
- 字型加載:Inter / Noto Sans TC / Noto Serif TC / Cormorant Garamond / JetBrains Mono

---

## 6. 頁面覆蓋表

| 頁面類型 | design 是否覆蓋 | 對應元件 |
|---|---|---|
| 首頁 | ✅ 覆蓋 | HomePage.jsx(8 段 editorial 結構) |
| 商品目錄(分類入口)| ✅ 覆蓋 | Pages.jsx → CatalogPage |
| 商品列表(篩選結果)| ✅ 覆蓋 | ProductsPage.jsx(4 種 filterStyle 變體) |
| 商品詳情 | ✅ 覆蓋 | ProductPage.jsx(584 行、最完整) |
| 品牌列表 | ✅ 覆蓋 | Pages.jsx → BrandsPage(logo wall + region 篩) |
| 品牌詳情 | ✅ 覆蓋 | Pages.jsx → BrandDetailPage(走 FilteredListPage) |
| 新品 | ✅ 覆蓋 | Pages.jsx → NewPage(走 FilteredListPage) |
| 特價 | ✅ 覆蓋 | Pages.jsx → SalePage(走 FilteredListPage) |
| 購物車 | ✅ 覆蓋 | AccountPages.jsx → CartPage(空 / 滿狀態 + coupon) |
| 結帳 | ❌ **未覆蓋** | 無(CartPage 「前往結帳」按鈕無實作) |
| 會員中心 | ✅ 覆蓋 | AccountPages.jsx → AccountPage(6 個 tab) |
| 登入 / 註冊 | ✅ 覆蓋 | AccountPages.jsx → LoginPage / RegisterPage |
| 訂單列表 | ✅ 覆蓋(simple) | AccountPages.jsx → AccountPage 內 tab(3 筆 hardcode) |
| 訂單詳情 | ❌ **未覆蓋** | 無 |
| 安裝預約 | ✅ 覆蓋 | Pages.jsx → InstallPage(4 步 wizard) |
| 合作店家 | ✅ 覆蓋 | Pages.jsx → StoresPage(Leaflet 地圖 + 36 家) |
| 配送 / 退貨 | ✅ 覆蓋 | Pages.jsx → ShippingPage(3 tab、靜態頁) |
| 全螢幕搜尋 | ✅ 覆蓋 | SearchOverlay.jsx |
| 關於 / FAQ | ⚠️ 部分(僅 Shipping 頁含 FAQ) | ShippingPage 內 5 條 hardcode FAQ |
| 經銷申請 | ❌ **未覆蓋** | 無(三級會員 store/premium_store 申請流程不在 design) |
| 經銷後台(看經銷價)| ❌ **未覆蓋** | 無(B2B 介面不在 design) |
| 我的車輛(履歷)| ⚠️ 部分(localStorage 暫存)| AccountPages.jsx → vehicles tab(僅基本欄位) |
| 車輛詳情 / 履歷頁 | ❌ **未覆蓋** | 無(Phase 2 PRD 範圍) |
| 詢價單 | ❌ **未覆蓋** | 無(Phase 2 PRD 範圍) |

---

## 7. 給 Claude.ai 寫 PRD 時要 Sean 確認的疑問

### 7.1 三級會員 tier 對應 design 缺位

design 完全沒有 customer / user mock、AccountPages.jsx 的「會員等級 VIP / 累計訂單 / 點數」全部 hardcode。HANDOFF-API §9 也只給 endpoint 範例不指定 schema。**PCM 商業模式三級會員(general / store / premium_store)在 design 真權威字面零提示**。

Phase 1 後台要實作三級價格、但前台 design 不展現「三級會員看到不同價格」的 UI。

問題:
- Phase 1 storefront 是否要先把 design 的單一 price 顯示原樣搬、後台有 tier 但前台先一律顯示零售價?
- 還是要先在 storefront 加 tier 識別 UI(但 design 沒有此 UI)?

### 7.2 products mock 的 fits 字串 vs 結構化 vehicleIds

**design 真權威 mock 用 `fits: 'CBR600RR'` 自由字串、頁面用 `string.includes()` 比對。** 但 HANDOFF-API §3 + PRODUCTS-README §6 都建議真實上線改 `vehicleIds: string[]` 結構化(`['ducati:panigale-v4:2020', ...]`)。

問題:Phase 1 Medusa schema 對齊哪一邊?
- 對齊 design 字面(metadata.fits 字串)→ 篩選不準
- 對齊 HANDOFF 建議(metadata.vehicle_ids 陣列)→ 偏離 design 字面、但可能更合理

### 7.3 車輛履歷 vs design 的 customer.metadata.vehicles

PHASE-2-VISION §5 與 vehicle-service-ecosystem PRD §5.1 規定車輛是**獨立 entity、跟車不跟人**。但 **design 的 AccountPages.jsx「我的愛車」直接用 `localStorage('pcm-vehicles')` 存在 user 下、欄位簡單(name / year / engine / km / mods / service)、無 VIN / 引擎號 / 驗證等防偽欄位**。

問題:Phase 1 schema 是 ——
- (A) 對齊 design 字面、用 customer.metadata.vehicles(Phase 2 才遷移)
- (B) 直接做 vehicles 獨立 entity(對齊 PHASE-2-VISION §5 預留)、但 storefront UI 仍照 design 搬

兩條路都跟「直接搬 design」原則有部分衝突。

### 7.4 brand 字串引用 vs brandId

design products 用 `brand: 'CNC RACING'`(字串、必須等於 brands[].name)。HANDOFF-API §3 建議「真 API 補上 brandId」。**design 字面是字串引用**。

問題:Phase 1 Medusa schema 用哪個 ——
- product.metadata.brand 字串(對齊 design 字面)
- product 關聯到 brand collection(用 ID、對齊 HANDOFF 建議)

### 7.5 categories 巢狀結構與 products.category 字串不對齊

design `PCM_DATA.categories` 是 **巢狀(大類 → children 細類)、用 ID**。但 `products[].category` 是 **「大類 · 小類」字串**(中間是全形空格 + 中圓點 + 全形空格)、不引用 categories[].id。**前後不對齊。**

問題:Phase 1 Medusa schema 用哪個 ——
- (A) 對齊 design products 字面、category 是 metadata 字串
- (B) 對齊 design categories 結構、product 關聯到 category collection
- (C) 兩者都做(雙寫對齊)

### 7.6 stores 是否進 Phase 1 範圍

design `data/stores.json` 含 36 家完整資料、StoresPage 用 Leaflet 地圖渲染。但 PHASE-1-NORTHSTAR §1.2 寫「不做 9 大藍圖」,vehicle-service-ecosystem PRD 把店家視為 Phase 2 範圍(shops + shop_staff entities)。

問題:Phase 1 是 ——
- (A) 對齊 design 字面、把 StoresPage + stores.json 搬上、當靜態頁(無後台 CRUD)
- (B) 暫不上 stores 頁、只搬其他頁面
- (C) 上頁面但 stores.json 跟 design submodule 同步(不進 Medusa)

### 7.7 Tweaks 面板要不要進 storefront

HANDOFF-TWEAKS §1 明確說「**生產不要保留**(無用、增 bundle、混淆使用者)」。但 NORTHSTAR §3.1「直接搬 design」鐵則。**TweaksPanel 在 design 字面就是存在**。

問題:slice 把 design 元件搬進 storefront 時 ——
- (A) 連 TweaksPanel 一起搬(對齊字面)、之後再開 slice 拔掉
- (B) 第一次搬就跳過 TweaksPanel(主動偏離字面)
- (C) 搬進 storefront 但用 NODE_ENV / feature flag 隱藏、生產 build 不顯示

### 7.8 經銷價在 design 完全沒體現

design products mock 只有 `price` + `origPrice`、無 tier_pricing 欄位。HANDOFF-API §3 建議 schema 也沒提多 tier。**design 沒展示三級會員看到不同價格的 UI**(沒有「您是經銷商、看到的是經銷價」標示)。

問題:Phase 1 後台用 Medusa Price List 做多 tier、前台從 API 拉 customer.tier 對應的 price ——
- design 字面只顯示一個 price、Phase 1 storefront 是否要照搬只顯示一個 price(後台多 tier 但前台不展示哪個 tier)?
- 還是要主動加「您看到的是 X 級會員價」標示(但 design 沒這 UI)?

### 7.9 Vehicle Finder 篩選器 vs Phase 2 vehicles entity 的關係

design 的 `VehicleDrawer`(在 App.jsx 內)+ `motoBrands` mock 是「**篩選器資料**」(品牌 / 車型 / 年份)。Phase 2 PRD 的 vehicles 是「**客戶持有的車**」(獨立 entity、跟車不跟人)。**兩個 vehicle 資料結構不同**:篩選用的 motoBrands 是分類樹、客戶持有的車是獨立記錄(含 VIN / 引擎號)。

問題:Phase 1 schema 設計時 ——
- (A) 兩者完全分開兩個 collection(motoBrands 是 catalog 分類、vehicles 是 customer-owned)
- (B) 統一一個 vehicles collection、用 type 區分
- (C) Phase 1 只做 motoBrands、vehicles 留 Phase 2

### 7.10 HANDOFF docs 數量與名單

slice 寫「9 份 HANDOFF docs」、實際是 **10 份**(多了 HANDOFF-TWEAKS.md)。`HANDOFF-OVERVIEW.md` 自己也只列「5 份姊妹文件」,但 design-reference/ 下實際有 10 個 HANDOFF-*.md。

問題:這 10 份是不是真權威?TWEAKS 不在 OVERVIEW 列出 — 是文件遺漏還是 TWEAKS 屬於非主線 docs?

---

## 8. 原始檔交叉引用 index

### 8.1 Components(12 個 .jsx)

| 檔 | 路徑 | 行數 |
|---|---|---|
| App.jsx | `design-reference/components/App.jsx` | 528 |
| Header.jsx | `design-reference/components/Header.jsx` | 108 |
| HomePage.jsx | `design-reference/components/HomePage.jsx` | 358 |
| ProductsPage.jsx | `design-reference/components/ProductsPage.jsx` | 463 |
| ProductPage.jsx | `design-reference/components/ProductPage.jsx` | 584 |
| ProductCard.jsx | `design-reference/components/ProductCard.jsx` | 152 |
| AccountPages.jsx | `design-reference/components/AccountPages.jsx` | 741 |
| Pages.jsx | `design-reference/components/Pages.jsx` | 874 |
| FilterSide.jsx | `design-reference/components/FilterSide.jsx` | 233 |
| FilterTop.jsx | `design-reference/components/FilterTop.jsx` | 471 |
| FilterDrawer.jsx | `design-reference/components/FilterDrawer.jsx` | 258 |
| SearchOverlay.jsx | `design-reference/components/SearchOverlay.jsx` | 206 |

### 8.2 Styles(15 個 .css)

| 檔 | 路徑 |
|---|---|
| tokens.css | `design-reference/styles/tokens.css`(108 行) |
| header.css | `design-reference/styles/header.css` |
| home.css | `design-reference/styles/home.css` |
| home.v1.css | `design-reference/styles/home.v1.css`(❌ 退役) |
| product-card.css | `design-reference/styles/product-card.css` |
| product-page.css | `design-reference/styles/product-page.css` |
| products-page.css | `design-reference/styles/products-page.css` |
| filter-top.css | `design-reference/styles/filter-top.css` |
| filter-side.css | `design-reference/styles/filter-side.css` |
| filter-drawer.css | `design-reference/styles/filter-drawer.css` |
| pages.css | `design-reference/styles/pages.css` |
| account.css | `design-reference/styles/account.css` |
| search-overlay.css | `design-reference/styles/search-overlay.css` |
| vehicle-drawer.css | `design-reference/styles/vehicle-drawer.css` |
| tweaks.css | `design-reference/styles/tweaks.css` |

### 8.3 Data 檔(6 個)

| 檔 | 路徑 |
|---|---|
| products.js | `design-reference/data/products.js`(本次讀前 250 行) |
| stores.json | `design-reference/data/stores.json`(36 stores、本次讀前 120 行) |
| stores-loader.js | `design-reference/data/stores-loader.js`(64 行) |
| BRANDS-README.md | `design-reference/data/BRANDS-README.md` |
| PRODUCTS-README.md | `design-reference/data/PRODUCTS-README.md` |
| STORES-README.md | `design-reference/data/STORES-README.md` |

### 8.4 HANDOFF Docs(10 個)

| 檔 | 路徑 |
|---|---|
| HANDOFF-OVERVIEW.md | `design-reference/design-reference/HANDOFF-OVERVIEW.md` |
| HANDOFF-PAGES.md | `design-reference/design-reference/HANDOFF-PAGES.md` |
| HANDOFF-COMPONENTS.md | `design-reference/design-reference/HANDOFF-COMPONENTS.md` |
| HANDOFF-TOKENS.md | `design-reference/design-reference/HANDOFF-TOKENS.md` |
| HANDOFF-DETAILS.md | `design-reference/design-reference/HANDOFF-DETAILS.md`(本次讀前 200 行) |
| HANDOFF-API.md | `design-reference/design-reference/HANDOFF-API.md` |
| HANDOFF-CHANGELOG.md | `design-reference/design-reference/HANDOFF-CHANGELOG.md`(本次讀前 80 行) |
| HANDOFF-DEPLOY.md | `design-reference/design-reference/HANDOFF-DEPLOY.md` |
| HANDOFF-ROADMAP.md | `design-reference/design-reference/HANDOFF-ROADMAP.md` |
| HANDOFF-TWEAKS.md | `design-reference/design-reference/HANDOFF-TWEAKS.md` |

### 8.5 入口 / 其他

| 檔 | 路徑 |
|---|---|
| index.html | `design-reference/index.html`(83 行、SPA 入口) |
| design-handoff/index.html | `design-reference/design-handoff/index.html`(視覺版設計系統一覽、體積 38000+ tokens、本次未細讀) |
| README.md | `design-reference/README.md`(設計 repo 導讀) |
| .gitignore | `design-reference/.gitignore`(本日 backlog #2 新增) |

---

— 偵察結束 —
