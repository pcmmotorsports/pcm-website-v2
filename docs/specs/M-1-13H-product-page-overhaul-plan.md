# M-1-13H 商品頁全面改版 PRD(Apple/Aritzia 現代派)

> **作者:** Cowork(規劃層、Sean 2026-05-21 拍板 Q-mode A mode (ii))
> **日期:** 2026-05-21
> **範圍:** Phase 1 / M-1-13H、商品頁全面改版、跨多 session、4-6 slice、總時長 3.5-5 小時
> **真權威字面源:**
> - `design-reference/components/explorations/VariantCFull.jsx` @ submodule `637dafc`(13KB / 259 行)
> - `design-reference/design-handoff/PRODUCT-PAGE-HANDOFF.md` @ submodule `637dafc`(14KB / 429 行)
> - `design-reference/styles/explorations.css` @ submodule `637dafc`(32KB / 1355 行;`.vc-*` L335-893 + `.vcf-*` L1060-1355、共 101 條規則開頭)
> - `design-reference/components/ProductCard.jsx`(6397 bytes、editorial · hover-swap、已搬至 storefront)
> - `design-reference/styles/product-card.css`(213 行)
> - 偵察報告 `docs/recon/M-1-13H-product-page-recon-2026-05-21.md`(475 行、9 章節齊)
>
> **衝突仲裁:**
> - 視覺/結構/路由/元件命名:Claude Design > storefront(鐵則 1)
> - 業務邏輯(免運門檻 / mobile bar 色系等):Sean 業務拍板優先、屬鐵則 1 例外(走 docs/decisions/)
> - 設計檔內部衝突優先級:`.jsx + .css` 字面 > HANDOFF docs(NORTHSTAR §2.4)
> - **demo 變體(VariantCFull 等 explorations)字面 = demo 寫法、不取代正式元件 import**(本 PRD 新立、對齊 lessons §12-37)

---

## 0. 工作流聲明(Q-mode A mode (ii))

Sean 2026-05-21 Q5 = A 拍板:本 PRD 一次拍完、Code 拿 PRD 連跑 6 slice 不需中間 raise(除非 PRD 字面內部矛盾)。

Sean 中途疲勞訊號(「累」「複雜」「想 automode」)可即時切回 B mode 逐刀。

---

## 1. 業務脈絡(對齊 handoff 2026-05-21 §4.2)

| 訴求 | 對應改版項 |
|---|---|
| 客人反映滑頁累、視覺重點散 | 圖縮小、字緊、配色克制(#1-#11) |
| 缺少賣點突顯區 | 新增 Highlights section(#12) |
| 旗艦商品需要故事感 | 新增 Engineering Spotlight(#13、條件渲染) |
| 適用車款資訊太佔版面 | 移除厚 banner、併進副標(#6 / #7) |
| Tabs 底線單調 | 改 pill tabs(#14) |

---

## 2. 拍板結果(7 題鎖定)

### Q1:免運門檻 — NT$ 5,000 永久(業務拍板)

- **鎖定字面:** storefront 統一 NT$ 5,000、Sean 2026-05-21 業務拍板永久化
- **真權威衝突解析:** design VariantCFull L85「滿 NT$ 4,000 免運」+ L97「滿額免運 NT$ 3,000 以上」(同檔內已不一致);Sean 業務拍板 5,000、屬鐵則 1 衝突仲裁例外(業務邏輯 = 價格、走 docs/decisions/)
- **commit body 揭示字面範本:** 「Sean 2026-05-21 業務拍板 NT$ 5,000 免運門檻永久化;design demo 字面 4,000/3,000 為 placeholder;backlog #161 方向反轉(design 端待 Sean 在 Claude Design 補對齊 storefront 5,000)」
- **影響 slice:** slice-3(buy block + services 段、`.vc-price-sub` 與 `.vc-services` 字面)

### Q2:Spotlight 條件渲染 — B `hasSpotlight` 欄位

- **鎖定:** MockProduct schema 加 `hasSpotlight: boolean`、Phase 1 業務指定 3 件 hardcoded `true`、Phase 2 接 supabase 同欄名
- **真權威衝突解析:** HANDOFF L291 字面 `product.id % 3 === 0` 不採(MockProduct 用 slug 為主鍵、無 numeric id 確認需 Code grep)
- **commit body 揭示字面範本:** 「Sean Q2 = B 拍板 hasSpotlight 欄位、Phase 1 hardcoded 3 件、Phase 2 supabase `product_spotlights` 欄位名一致對應」
- **影響 slice:** slice-4(Highlights + Spotlight 新子元件)

### Q3:Mobile sticky bar 紅色 — 保留不動(業務拍板)

- **鎖定:** product-page.css L670-704 既有 `#c41e3a` 紅色字 + 紅 buynow 按鈕全部保留
- **commit body 揭示字面範本:** 「Sean Q3 = B 業務拍板 mobile bar 紅色加入購物車保留(轉換率考量);HANDOFF #17『保留不動』解讀:行為 + 色系全面保留、不擴張改色系;視覺斷層(全黑/灰商品頁 vs 紅色 mobile bar)屬業務拍板對沖視覺一致性」
- **影響 slice:** 全 slice 禁止動 product-page.css L670-704 mobile bar 段

### Q4:Related grid — 既有 ProductCard + 容器標題改(無拍板必要、糾正自我錯誤)

- **實況查證(Cowork bash 已驗、對應 lessons §12-37):**
  - design-reference/components/ProductCard.jsx 存在、L1「editorial · hover-swap images」、是 design 已產出的**新版設計**
  - design-reference/styles/product-card.css 存在、213 行
  - apps/storefront/src/components/ProductCard.tsx L4「字面從 design-reference/components/ProductCard.jsx @ 25d3a2a 直接搬」(M-1-04 mini-slice 落地)
  - HANDOFF #16「保留 ProductCard」真意 = Related grid 用既有 design ProductCard 元件、不另寫 hardcoded
  - VariantCFull L219-230 `.vcf-related-card` hardcoded = demo 平面 jsx 寫法(demo 自包含不 import 真元件)、**不取代正式 `<ProductCard>` 元件**
- **鎖定:** Related grid 用既有 `<ProductCard>` 元件、不複製 demo 的 `.vcf-related-card` hardcoded;容器標題改 Inter 22px semibold(HANDOFF L335-339)
- **commit body 揭示字面範本:** 「Q4 糾正自我錯誤:design ProductCard.jsx 本就是新版設計、storefront 端 M-1-04 已搬完成;VariantCFull `.vcf-related-card` 為 demo 寫法、實作端用既有 `<ProductCard>` 元件;對應 lessons §12-37 新立『demo 變體字面不取代正式元件』」
- **影響 slice:** slice-6(Related + 收尾)

### Q5:Slice 拆法 + Q-mode — A mode (ii)、6 slice(Cowork 拍)

- **鎖定:** 8 候選 sub-slice 合 6 slice(見 §4)、A mode (ii) PRD 前置、Sean 中途疲勞訊號可即時切 B mode

### Q6:explorations 檔刪除 — A(Cowork 拍)

- **鎖定:** M-1-13H slice-6 收尾後、Sean 推 dev → Sean 在 Claude Design 端動 → push pcm-website-design → 本地 submodule update + commit
- **commit body 揭示字面範本:** 「Q6 = A 拍板;對齊 HANDOFF L389/L426-429 驗收條件 #13『探索檔案已刪除』;design submodule 內、storefront 端不可動(對齊 lessons §12-21 Claude Design 對 GitHub 唯讀、Sean 唯一寫手)」

### Q7:Highlights / Spotlight 子元件拆檔 — A 全拆(Cowork 拍)

- **鎖定:** 新建 `apps/storefront/src/components/ProductHighlights.tsx` + `apps/storefront/src/components/ProductSpotlight.tsx` 兩個獨立子元件;各自配 smoke test `.test.tsx`(對齊 docs/architecture/testing-strategy.md)

---

## 3. 影響面總表

### 3.1 子元件動作

| 子元件 | 路徑 | 既有狀態 | 動作 | 對應 HANDOFF # |
|---|---|---|---|---|
| ProductPage | `apps/storefront/src/components/ProductPage.tsx` | 260 行(13b 骨架 + breadcrumb 8-source + vehicle pill + Mobile sticky bar 內嵌)| 改 crumbs 樣式 + 串接新子元件 Highlights/Spotlight + 保留 mobile sticky bar 不動 | #1 / #12 / #13 / #17 |
| ProductGallery | `apps/storefront/src/components/ProductGallery.tsx` | 13c 拆 4:5 直立 thumb overlay arrow 40px | **大改** 1:1 / radius 18 / 漸層底 / arrow 72px 玻璃毛玻璃 / thumb 移下方 64×64 | #2 / #3 |
| ProductInfo | `apps/storefront/src/components/ProductInfo.tsx` | 13d 拆 brand-row + sku + title (serif 38px) + fits-banner + options + buy block + price (serif 36px 紅) | **大改** SKU line 取代 brand-row / title 28px Inter sans / 新增副標 / 移除 fits-banner / 價格 22px 黑 / swatches 圓 24×24 / CTA 48px 圓 pill | #4 / #5 / #6 / #7 / #8 / #9 / #10 |
| ProductServices | `apps/storefront/src/components/ProductServices.tsx` | 13f-1 拆 2×2 grid + 圖示 | 移除圖示、純文字 | #11 |
| ProductTabs | `apps/storefront/src/components/ProductTabs.tsx` | 13f-2 落地 底線 2px tab + 4 panel | **大改** 底線改 pill 群組 / specs 移 border 2 欄 grid / install meta 合併淺灰卡 + 4 步驟卡片 / warranty `em` 加粗 | #14 / #15 |
| **新 ProductHighlights** | `apps/storefront/src/components/ProductHighlights.tsx` | 不存在 | **新增** 3 卡 hardcoded + `product.brand` 模板注入 h2 + smoke test | #12 |
| **新 ProductSpotlight** | `apps/storefront/src/components/ProductSpotlight.tsx` | 不存在 | **新增** 條件渲染 `product.hasSpotlight` + 4 段 + 3 stats + smoke test | #13 |
| Mobile sticky bar(內嵌 ProductPage L220-257)| ProductPage.tsx 內 | router.back() + tier 條件渲染(13e-a/b 落地)| **保留不動**(行為 + 色系) | #17 |

### 3.2 CSS 動作

| 檔案 | 既有 | 動作 |
|---|---|---|
| `apps/storefront/src/styles/product-page.css` | 738 行 | 重寫過半:crumbs / hero / gallery / thumb / info(sku/title/sub/price/opt/swatches/cta)/ services 段重寫 + 新增 `.pd-feature-*`(Highlights)+ `.pd-spotlight-*`(Spotlight)+ pill `.pd-tabs-*` 段;**L670-704 mobile bar 段全保留(對應 Q3)** |
| 既有 product-card.css | — | 不動(對應 Q4) |

### 3.3 schema / mock 動作

| 對象 | 動作 |
|---|---|
| `MockProduct` type(packages/schemas 或 storefront 內定義、Code 跑前 grep)| 加 `hasSpotlight?: boolean` 欄位(可選、預設 false) |
| mock products data(storefront 內 mock 路徑、Code 跑前 grep)| Phase 1 業務指定 3 件 hardcoded `hasSpotlight: true`(具體哪 3 件留 slice-4 Code raise 給 Sean 拍板) |

### 3.4 STATUS / docs 動作

| 對象 | 動作 |
|---|---|
| STATUS.md L20 「下一步」 | 每 slice 結束 busboy-end 自動更新 |
| STATUS.md L23 「Sean 待決策」 | slice-6 收尾追加「Phase 2 supabase product_highlights + product_spotlights + product_specs + product_installs + site_services 等共 ≥5 張表 LOG 條目」(對應 HANDOFF L398-401 + STATUS 字面「Phase 2 supabase 先 LOG 不動」)|
| docs/phase-1-backlog.md #161 | M-1-13H 內首 slice 涉動者 Code 同 slice 改寫方向(「storefront 對齊 design」→「design 端待 Sean 在 Claude Design 補對齊 storefront 5,000」) |

---

## 4. 6 slice 詳述

> 每 slice 含:範圍 / 動哪些檔 / grep 真權威源點 / 預期 commit 訊息字面 / 字面 vs 事實預期 / 禁止清單延伸。
> Code 跑 slice 前 Read 本 PRD 對應章節、自己 grep design-reference 字面、寫 .tsx / .css 落地字面、commit + 三綠 + 不 push。

### Slice-1:crumbs + Gallery(30-40 分)

**對應 HANDOFF:** #1 麵包屑樣式 + #2 商品圖 Gallery + #3 縮圖列下移

**範圍:**
- `apps/storefront/src/components/ProductPage.tsx`:crumbs 樣式類名改、邏輯不動(保留 8-source useMemo)
- `apps/storefront/src/components/ProductGallery.tsx`:1:1 比例、radius 18、漸層底、arrow 72×72 玻璃毛玻璃、thumb 移下方 64×64
- `apps/storefront/src/styles/product-page.css`:crumbs 段 + hero gallery 段 + thumb 段重寫

**grep 真權威源點(Code 跑前必跑):**
```
# Gallery 字面
grep -n "vc-gallery\|vc-img-card\|vc-arrow\|vc-counter\|vc-thumbs\|vc-thumb-img\|vc-badge" design-reference/components/explorations/VariantCFull.jsx
grep -n "^\.vc-gallery\|^\.vc-img-card\|^\.vc-arrow\|^\.vc-counter\|^\.vc-thumbs\|^\.vc-thumb-img\|^\.vc-badge" design-reference/styles/explorations.css

# Crumbs 字面
grep -n "vcf-crumbs" design-reference/components/explorations/VariantCFull.jsx
grep -n "^\.vcf-crumbs" design-reference/styles/explorations.css

# HANDOFF 對應段
grep -n "^### #1 \|^### #2 \|^### #3 " design-reference/design-handoff/PRODUCT-PAGE-HANDOFF.md
```

**class prefix 約定:** explorations 的 `.vc-` / `.vcf-` 字面遷入 storefront 時改 `.pd-`(對齊 HANDOFF L24 命名空間規矩、storefront 現行 `.pd-` prefix 慣例)

**預期 commit 訊息字面:**
```
feat(storefront): Gallery + crumbs Apple/Aritzia 改版 [M-1-13H-1]

slice-1 對應 HANDOFF #1 #2 #3:
- crumbs 12px Inter sans #86868b / 分隔符 › / 不 uppercase / 邏輯保留 8-source useMemo
- Gallery 1:1 / radius 18 / linear-gradient 漸層底 / arrow 72px 玻璃毛玻璃
- thumb 移下方 flex/gap 10/margin-top 16 / 64×64 radius 10 / active border #1d1d1f
- class prefix .vc- → .pd-(storefront 命名空間)

對應 PRD docs/specs/M-1-13H-product-page-overhaul-plan.md slice-1
保留清單:Lightbox(ESC/Arrow)、hero swipe touch-action: pan-y、vehiclePill 邏輯
```

**字面 vs 事實預期:** 無偏離預期;若 storefront ProductGallery 既有實作含「未在 design 字面對應的細節」(例:既有 thumb 容器 className 命名)、Code 自然書寫對齊既有慣例不算偏離(對齊「事實 > 字面」守則)

**禁止清單延伸(基線之外):**
- 不可動 ProductInfo.tsx / ProductServices.tsx / ProductTabs.tsx(留後續 slice)
- 不可動 product-page.css L670-704 mobile bar 段(對應 Q3)
- 不可動 ProductCard.tsx(對應 Q4)

---

### Slice-2:Info column 上半(25-35 分)

**對應 HANDOFF:** #4 SKU 條取代品牌列 + #5 標題改字 + #6 副標新增 + #7 適用車款 banner 移除

**範圍:**
- `apps/storefront/src/components/ProductInfo.tsx` 上半:brand-row 段拆出、改 SKU line / title 28px Inter / 新增副標、移除 fits-banner
- `apps/storefront/src/styles/product-page.css`:`.pd-sku` / `.pd-title` / `.pd-sub` 段新增、`.pd-fits-banner` 段移除

**grep 真權威源點:**
```
grep -n "vc-sku\|vc-title\|vc-sub" design-reference/components/explorations/VariantCFull.jsx
grep -n "^\.vc-sku\|^\.vc-title\|^\.vc-sub" design-reference/styles/explorations.css
grep -n "^### #4 \|^### #5 \|^### #6 \|^### #7 " design-reference/design-handoff/PRODUCT-PAGE-HANDOFF.md
```

**副標字面內容(L2 hardcoded、TODO + backlog):**
- design VariantCFull L83 字面 `適用 Honda CBR600RR · 義大利原裝進口`
- 變數注入:`${product.fits} · ${brandCountry}原裝進口`
- Phase 1 brandCountry:hardcoded「義大利」(對齊 design 字面)+ TODO + backlog 新增「brand 表 country 欄位 Phase 2 接 supabase」
- Code grep 確認 MockProduct 是否已有 `brand.country` 欄位、若無暫接「義大利」字串

**預期 commit 訊息字面:**
```
feat(storefront): ProductInfo 上半 SKU/title/副標 Apple/Aritzia 改版 [M-1-13H-2]

slice-2 對應 HANDOFF #4 #5 #6 #7:
- SKU line LIGHTECH · PCM-00001 mono 取代 brand-row + sku 兩元素
- title 28px Inter sans 600 / -0.015em(serif 38px → sans 28px)
- 副標 14px Inter #86868b、字面 `${product.fits} · ${brandCountry}原裝進口`、brandCountry L2 hardcoded「義大利」+ backlog 追 brand.country
- 移除 .pd-fits-banner 整段、資訊併進副標

對應 PRD slice-2
字面 vs 事實:brandCountry L2 hardcoded 屬 Phase 1 對齊 design 字面、Phase 2 接 brand 表 country 欄位
```

**禁止清單延伸:**
- 不可動 ProductInfo.tsx 下半(buy block / services 等、留 slice-3)
- 同基線禁止

---

### Slice-3:Buy block + Services(35-45 分)

**對應 HANDOFF:** #8 價格 + #9 swatches + #10 主 CTA + #11 服務承諾條 + Q1 免運門檻 5,000

**範圍:**
- `apps/storefront/src/components/ProductInfo.tsx` 下半:buy block(價格 / swatches / CTA / qty)重寫
- `apps/storefront/src/components/ProductServices.tsx`:移除圖示、純文字
- `apps/storefront/src/styles/product-page.css`:`.pd-price` / `.pd-swatch` / `.pd-add` / `.pd-buynow` / `.pd-services` / `.pd-service` 段重寫

**grep 真權威源點:**
```
grep -n "vc-price\|vc-price-sub\|vc-swatch\|vc-add\|vc-buynow\|vc-opt\|vc-services\|vc-service" design-reference/components/explorations/VariantCFull.jsx
grep -n "^\.vc-price\|^\.vc-swatch\|^\.vc-add\|^\.vc-buynow\|^\.vc-services\|^\.vc-service" design-reference/styles/explorations.css
grep -n "^### #8 \|^### #9 \|^### #10 \|^### #11 " design-reference/design-handoff/PRODUCT-PAGE-HANDOFF.md
```

**保留邏輯字面(必對:**
- `getPriceForTier` / `tier` prop 條件渲染保留(M-1-13e-a/b 既有)
- showRedPrice tweaks 預設 false(對應 HANDOFF L150-153「保留邏輯預設黑色」)
- Quantity 計數器保留功能、qty 放 swatches 同行右側、CTA 各佔滿行(HANDOFF L190-209)

**Q1 免運門檻字面(必修 NT$ 5,000):**
- `.pd-price-sub` 字面 `含稅 · 滿 NT$ 5,000 免運`(不採 design L85 字面 4,000)
- `.pd-services` 內服務承諾字面「滿額免運 NT$ 5,000 以上」(不採 design L97 字面 3,000)
- backlog #161 同 slice 改寫(從「storefront 對齊 design」→「design 待補對齊 storefront 業務拍板 5,000」)

**預期 commit 訊息字面:**
```
feat(storefront): buy block + services Apple/Aritzia 改版 + 免運門檻業務拍板 [M-1-13H-3]

slice-3 對應 HANDOFF #8 #9 #10 #11:
- 價格 36px serif 紅 → 22px Inter sans 600 黑 #1d1d1f
- swatches 40 方 → 24 圓、outline 取代 border 指示 active
- 主 CTA 56 → 48 圓 pill border-radius 100px
- services 移除圖示、純文字 2×2 grid

字面 vs 事實:
- Q1 Sean 業務拍板 NT$ 5,000 免運門檻永久化(屬鐵則 1 例外:價格 = 業務邏輯)
- design demo 字面 4,000/3,000 為 placeholder、不採
- backlog #161 方向反轉(本 slice 同 commit 改寫)

對應 PRD slice-3
保留:getPriceForTier / showRedPrice 預設 false / qty 計數器
```

**禁止清單延伸:**
- 不可動 product-page.css L670-704 mobile bar 段(對應 Q3)
- 不可動 design-reference(對應 Q1 反向 sync 留 Sean 在 Claude Design 端動)

---

### Slice-4:新增 Highlights + Spotlight 子元件(35-45 分)

**對應 HANDOFF:** #12 Highlights + #13 Engineering Spotlight + Q2 hasSpotlight 欄位

**範圍:**
- 新建 `apps/storefront/src/components/ProductHighlights.tsx`(3 卡 hardcoded、`product.brand` 模板 h2)
- 新建 `apps/storefront/src/components/ProductSpotlight.tsx`(條件渲染 `product.hasSpotlight` + 4 段 + 3 stats)
- 新建對應 `*.test.tsx` smoke test 各一(對齊 testing-strategy.md)
- `apps/storefront/src/components/ProductPage.tsx`:串接兩新子元件
- `apps/storefront/src/styles/product-page.css`:新增 `.pd-feature-*`(Highlights)+ `.pd-spotlight-*`(Spotlight)段
- MockProduct type 加 `hasSpotlight?: boolean` 欄位
- mock products data:Phase 1 業務指定 3 件 hardcoded `hasSpotlight: true`(具體哪 3 件 slice 內 Code raise 給 Sean 拍板;預設 Code 給 multi-select 推薦 Lightech / 另 2 件按 mock 順序前 3)

**grep 真權威源點:**
```
# JSX 結構
grep -n "vcf-section\|vcf-highlights\|vcf-feature\|vcf-spotlight\|vcf-spot\|vcf-eyebrow\|vcf-h2\|vcf-lead\|vcf-body" design-reference/components/explorations/VariantCFull.jsx
# CSS class
grep -n "^\.vcf-section\|^\.vcf-feature\|^\.vcf-spotlight\|^\.vcf-spot\|^\.vcf-eyebrow\|^\.vcf-h2\|^\.vcf-lead\|^\.vcf-body" design-reference/styles/explorations.css
# HANDOFF
grep -n "^### #12 \|^### #13 " design-reference/design-handoff/PRODUCT-PAGE-HANDOFF.md
# MockProduct type 既有定義
grep -rn "type MockProduct\|interface MockProduct\|hasSpotlight" apps/storefront/src/ packages/schemas/
```

**Highlights 3 卡字面(L3 hardcoded、commit body 揭示):**
- design VariantCFull L113-127、各卡含 num(01-03)/ title / desc
- Phase 1 hardcoded 3 卡通用(可單一商品共用)、Phase 2 接 supabase `product_highlights` 表(L3 級、業務拍板對沖鐵則 9)

**Spotlight 條件渲染(Q2 = B):**
- 渲染條件:`product.hasSpotlight === true`(不採 HANDOFF L291 字面 `product.id % 3 === 0`)
- 內容:design VariantCFull L137-150、含 eyebrow / h2 / body × 2 / 3 stats
- Phase 1 hardcoded、Phase 2 接 supabase `product_spotlights` 表

**預期 commit 訊息字面:**
```
feat(storefront): 新增 ProductHighlights + ProductSpotlight 子元件 [M-1-13H-4]

slice-4 對應 HANDOFF #12 #13 + Q2 hasSpotlight 欄位:
- ProductHighlights.tsx 新檔:3 卡 hardcoded、h2 用 product.brand 變數注入
- ProductSpotlight.tsx 新檔:條件渲染 product.hasSpotlight === true、4 段 + 3 stats hardcoded
- MockProduct type 加 hasSpotlight?: boolean 欄位
- mock data 3 件業務指定 hasSpotlight: true(slice 內 Sean 拍板選定)
- 對應 *.test.tsx smoke test 各一

字面 vs 事實:
- Q2 Sean 拍 B、不採 HANDOFF L291 product.id % 3 字面(MockProduct 無 numeric id)
- 內容 L3 hardcoded、業務拍板對沖鐵則 9(STATUS 字面「Phase 2 先 LOG 不動」)
- Phase 2 接 supabase product_highlights + product_spotlights 表

對應 PRD slice-4
```

**禁止清單延伸:**
- 不可動 ProductTabs.tsx(留 slice-5)
- Highlights / Spotlight 子元件預估各 ≤120 行、若超 200 行 Code raise(對應鐵則 6)

---

### Slice-5:Tabs pill + 內容微調(30-45 分)

**對應 HANDOFF:** #14 Tabs 樣式 pill + #15 Tabs 內容微調

**範圍:**
- `apps/storefront/src/components/ProductTabs.tsx`:tab 結構從底線 2px 改 pill 群組;4 panel 內容微調
- `apps/storefront/src/styles/product-page.css` L460-577 既有 tabs 段重寫:`.pd-tabs` pill 容器 + `.pd-tab` pill + `.pd-tab.is-active` 白底 + `.pd-tab-body` + `.pd-list`/`.pd-specs`/`.pd-spec-row`/`.pd-install-meta`/`.pd-steps` 段

**grep 真權威源點:**
```
# pill tabs 結構
grep -n "vcf-tabs\|vcf-tab\|vcf-tab-body" design-reference/components/explorations/VariantCFull.jsx
grep -n "^\.vcf-tabs\|^\.vcf-tab\|^\.vcf-tab-body" design-reference/styles/explorations.css
# 4 panel 內容
grep -n "vcf-desc\|vcf-body\|vcf-list\|vcf-specs\|vcf-spec\|vcf-install\|vcf-steps\|vcf-step" design-reference/components/explorations/VariantCFull.jsx
grep -n "^\.vcf-desc\|^\.vcf-body\|^\.vcf-list\|^\.vcf-specs\|^\.vcf-spec\|^\.vcf-install\|^\.vcf-steps\|^\.vcf-step" design-reference/styles/explorations.css
# HANDOFF
grep -n "^### #14 \|^### #15 " design-reference/design-handoff/PRODUCT-PAGE-HANDOFF.md
# 既有 tabs CSS 行範圍
grep -n "\.pd-tabs\|\.pd-tab-" apps/storefront/src/styles/product-page.css
```

**4 panel 內容字面(L3 hardcoded、commit body 揭示):**
- description:vcf-body(lead 19px Inter)+ vcf-list 5 items
- specs:vcf-specs 2 欄 grid + 8 個 vcf-spec-row(對齊 Code 偵察報告校正:8 欄、非 STATUS 字面 4 欄)
- install:vcf-install-meta 三欄合併淺灰卡 + vcf-steps 4 步驟卡片
- warranty:vcf-body 3 段、`em` 改 600 加粗

**4 panel key 字面對齊:** `description` / `specs` / `install` / `warranty`(與既有 M-1-13f-2 落地 ProductTabs 4 key 完全一致、不改 key)

**預期 commit 訊息字面:**
```
refactor(storefront): ProductTabs pill 改造 + 4 panel 內容微調 [M-1-13H-5]

slice-5 對應 HANDOFF #14 #15:
- tabs 底線 2px → pill 群組(.pd-tabs gap 4 padding 6 background #f5f5f7 border-radius 100 width fit-content)
- .pd-tab pill + .pd-tab.is-active 白底
- description:lead 19px Inter / vcf-list 5 items 改 .pd-list `—` 灰 marker
- specs:移 border / 2 欄 grid / key mono 灰 / 8 欄 hardcoded
- install:meta 合併淺灰卡 / 4 步驟獨立卡片
- warranty:em 改 600 加粗

字面 vs 事實:
- 4 panel key 字面 description/specs/install/warranty 保留 M-1-13f-2 既有、不改
- specs 8 欄 hardcoded 校正 STATUS 字面「4 欄」(實況 8 欄)、commit body 揭示
- L3 hardcoded(specs/install/warranty/description)業務拍板對沖鐵則 9

對應 PRD slice-5
```

**禁止清單延伸:**
- 不可改 4 panel key 字面(description/specs/install/warranty、對齊 M-1-13f-2)
- 不可動 product-page.css L670-704 mobile bar 段

---

### Slice-6:Related + 收尾(35-50 分)

**對應 HANDOFF:** #16 Related grid 容器 + Q4 既有 ProductCard 保留 + 收尾 13g 殘餘評估 + STATUS Phase 2 LOG + 鐵則 12 Codex Review Packet

**範圍:**
- `apps/storefront/src/components/ProductPage.tsx`:新增 Related section、用 `<ProductCard>` 元件 map、容器標題改 Inter 22px semibold
- `apps/storefront/src/styles/product-page.css`:新增 `.pd-related` 容器 + `.pd-related-grid` + `.pd-section-head` 段(若 slice-4 已加 `.pd-section-head` 共用則本 slice 不重複加)
- 不動 ProductCard.tsx / product-card.css(對應 Q4)
- 13g 殘餘評估:Toast(addToCart toast)+ Responsive 收口、決定推延或本 slice 收掉(Code 跑時 raise multi-select 給 Sean 拍)
- STATUS.md L23「Sean 待決策」追加「Phase 2 supabase ≥5 張表 LOG 條目」(product_highlights / product_spotlights / product_specs / product_installs / site_services、對應 HANDOFF L398-401)
- 鐵則 12 Codex Review Packet:本 slice commit **前**產 Packet、提醒 Sean 貼 Codex 唯讀審查、findings 回來再決定(修正 / 補 backlog / 才 commit)

**grep 真權威源點:**
```
# Related grid
grep -n "vcf-related\|vcf-section-head" design-reference/components/explorations/VariantCFull.jsx
grep -n "^\.vcf-related\|^\.vcf-section-head" design-reference/styles/explorations.css
# HANDOFF
grep -n "^### #16 \|^### #17 " design-reference/design-handoff/PRODUCT-PAGE-HANDOFF.md
# 既有 ProductCard 串接點
grep -n "ProductCard" apps/storefront/src/components/ProductPage.tsx
# 13g 殘餘
grep -n "TODO M-1-13g\|pd-toast\|toast" apps/storefront/src/components/ProductPage.tsx apps/storefront/src/styles/product-page.css
```

**Related 字面內容(Code 跑時實況確認):**
- 相同分類 query:storefront 既有 mock products filter by category(Code grep 既有 helper)
- 卡片 4 個 ProductCard 元件、不複製 demo `.vcf-related-card` hardcoded
- 容器 eyebrow「N°03 — You may also like」+ h2「相同分類」(對齊 design VariantCFull L216-217)

**STATUS L23 追加字面範本:**
```
+ M-1-13H 完成、Phase 2 supabase 待 LOG 表(對應 HANDOFF L398-401):
  - product_highlights(M-1-13H slice-4 hardcoded、Phase 2 接表)
  - product_spotlights(M-1-13H slice-4 hardcoded + hasSpotlight 欄位、Phase 2 接表)
  - product_specs(M-1-13H slice-5 specs 8 欄 hardcoded、Phase 2 接表)
  - product_installs(M-1-13H slice-5 install 4 steps + meta hardcoded、Phase 2 接表)
  - site_services(M-1-13H slice-3 服務承諾 4 條 + warranty 3 段 hardcoded、Phase 2 接表)
```

**鐵則 12 Codex Review Packet 觸發判定:**
- 本 M-1-13H 為「進度單元結束(slice 群完整收尾)」+「動共用元件 ProductGallery / ProductInfo / ProductServices / ProductTabs / ProductPage + 新增 2 子元件」+「動會員 tier 條件渲染 buy block」+「業務拍板影響營運(Q1 免運門檻)」、命中觸發
- Packet 內容:本 PRD + 6 slice commit body + 字面 vs 事實揭示彙整 + 風險點殘餘 + rollback 方式(git revert 6 個 slice commit 順序)+ 相關規則摘錄(NORTHSTAR §2.4 / lessons §12-37 / 鐵則 8 / 鐵則 11 / 鐵則 12)

**預期 commit 訊息字面:**
```
feat(storefront): Related grid + M-1-13H 收尾 + STATUS Phase 2 LOG [M-1-13H-6]

slice-6 對應 HANDOFF #16 + Q4 + Q6 + 鐵則 12:
- Related section 用既有 ProductCard 元件、不複製 demo .vcf-related-card hardcoded
- 容器標題 Inter 22px semibold + eyebrow「N°03 — You may also like」
- STATUS L23 追加 Phase 2 supabase ≥5 張表 LOG 條目
- 13g 殘餘評估:[Toast 推延 / 本 slice 收](Sean 拍板填)/ Responsive 收口

字面 vs 事實:
- Q4 糾正(對應 lessons §12-37):design ProductCard.jsx 已搬完、Related 用既有元件、demo .vcf-related-card 不採
- 鐵則 12 Codex Review Packet:commit 前產 Packet、Sean 貼 Codex 唯讀審查、findings 回來再決定

對應 PRD slice-6
M-1-13H 完成、待 Sean 在 Claude Design 端動 explorations 刪除(對應 Q6)
```

**禁止清單延伸:**
- 不可改 ProductCard.tsx / product-card.css(對應 Q4)
- commit **前**必產 Codex Review Packet、未產不可 commit(對應鐵則 12)

---

## 5. 字面 vs 事實揭示彙整

| Slice | 揭示點 |
|---|---|
| 1 | class prefix `.vc-` / `.vcf-` → `.pd-`(storefront 命名空間慣例) |
| 2 | brandCountry L2 hardcoded「義大利」對齊 design 字面、Phase 2 接 brand.country 欄位 |
| 3 | Q1 Sean 業務拍板 NT$ 5,000、不採 design demo 4,000/3,000、backlog #161 方向反轉 |
| 4 | Q2 不採 HANDOFF L291 `product.id % 3`、改 hasSpotlight 欄位;L3 hardcoded 對沖鐵則 9 |
| 5 | specs 8 欄校正 STATUS 字面「4 欄」實況;L3 hardcoded 對沖鐵則 9 |
| 6 | Q4 糾正 demo `.vcf-related-card` 不採、用既有 ProductCard;鐵則 12 Codex Review Packet 觸發 |

---

## 6. 風險點 + Code raise 預期

| # | 風險點 | 對應 slice | Code raise 預期 |
|---|---|---|---|
| α | HANDOFF 行號錯位(design jsx 行號 ≠ storefront tsx 行號)| 全 slice | Code 自然校正、不算 raise |
| β | `hasSpotlight` 欄位放哪(MockProduct type 位置 + 哪 3 件 hardcoded true)| slice-4 | Code raise multi-select 給 Sean 拍板選哪 3 件 |
| γ | 免運門檻三方衝突 | slice-3 | Q1 已拍板、不 raise |
| δ | explorations 檔刪除 | slice-6 後 | Q6 已拍板、Sean 在 Claude Design 端動 |
| ε | mobile bar 色系 | 全 slice | Q3 已拍板、保留不動 |
| ζ | ProductCard 視覺斷層 | slice-6 | Q4 已糾正、無斷層 |
| η | 13g 殘餘(Toast + Responsive)| slice-6 | Code raise multi-select 給 Sean 拍「推延 / 本 slice 收」 |

---

## 7. 內容分級 L1/L2/L3 對應

| 項目 | 級別 | 處置 |
|---|---|---|
| Highlights 3 卡內容 | **L3 對沖**(業務拍板 Phase 2 先 LOG)| Phase 1 hardcoded + commit body 揭示 |
| Highlights h2 模板 | L1 | `product.brand` 變數注入、模板年改 0-1 次 |
| Spotlight 4 段 + 3 stats | **L3 對沖** | Phase 1 hardcoded + commit body 揭示 |
| 副標 brandCountry | L2 | Phase 1 hardcoded「義大利」+ backlog 追 brand.country |
| 服務承諾 4 條 | L2 | Phase 1 hardcoded + 免運門檻 NT$ 5,000 對齊 Q1 |
| specs 8 欄 | **L3 對沖** | Phase 1 hardcoded + commit body 揭示 + STATUS「4 欄」字面校正為「8 欄」|
| install 4 steps + meta | **L3 對沖** | Phase 1 hardcoded + commit body 揭示 |
| warranty 3 段 | L2 | Phase 1 hardcoded |
| breadcrumb 字面 | L1 + 動態 | storefront 既有 8-source useMemo |
| 價格 | 動態 | product.price + tier(M-1-13e-a/b 既有) |

---

## 8. 預期總時長 + session 排程

| Session | 範圍 | 估時 |
|---|---|---|
| Session A | slice-1 + slice-2 | 55-75 分 |
| Session B | slice-3 + slice-4 | 70-90 分 |
| Session C | slice-5 + slice-6(含 Codex Review Packet 產出 + Sean 貼 Codex)| 65-95 分 + Codex review wait time |

**總體:** 3.5-5 小時實作 + Codex review wait;對齊 STATUS 字面「跨 2-3 session」。

---

## 9. 鐵則對應檢查

| 鐵則 | 對應 |
|---|---|
| 鐵則 1(design 真權威、直接搬不翻譯)| 全 slice 字面從 design-reference grep、不憑記憶 |
| 鐵則 2(後台對應 design)| schema 動作:MockProduct 加 hasSpotlight(Phase 2 supabase 同欄名)|
| 鐵則 3(前後台同步)| Phase 2 supabase 先 LOG(Sean 業務拍板)、Phase 1 hardcoded 對沖、commit body 揭示 |
| 鐵則 4(15-45 分可中斷)| 每 slice 25-50 分(slice-3 / 4 / 6 接近上限、Code 注意中斷點)|
| 鐵則 5(CSS + TSX 雙檔同 slice)| 每 slice 同時動 .tsx + .css ✅ |
| 鐵則 6(>400 行硬拆)| ProductPage 預估升 320-340 行(>300 警戒、未到 400);Highlights / Spotlight 各 ≤120 行;超過 200 行 Code raise |
| 鐵則 7(Orchestrator 禁用)| 不適用(本 PRD 是 Cowork 規劃、不用 Orchestrator)|
| 鐵則 8(重大改動先 plan)| 本 PRD 即 plan、Sean 7 題已拍板 ✅ |
| 鐵則 9(L3 立即停)| Sean 業務拍板 Phase 2 先 LOG、Phase 1 hardcoded 對沖、commit body 揭示(對齊本 PRD §7)|
| 鐵則 10(三視角)| 每拍板題已附三視角(Cowork 對話內) |
| 鐵則 11(三綠 + 字面 vs 事實)| 每 slice 收工 typecheck + lint(動 .ts/.tsx 加 build);commit body 字面 vs 事實揭示(本 PRD §5)|
| 鐵則 12(Codex Review Packet)| slice-6 commit 前產 Packet、Sean 貼 Codex 審查 ✅ |

---

## 10. PRD 範圍外(M-1-13H 不做)

- ProductCard 樣式改動(Q4 = 既有保留;若 Sean 之後在 Claude Design 端產新版、開新 milestone M-1-13I)
- mobile sticky bar 色系統一(Q3 = 紅色保留)
- backlog #161 免運門檻方向反轉(slice-3 內 backlog md 改寫即可、不另開 slice)
- explorations 檔刪除(Q6 = M-1-13H 結束後 Sean 在 Claude Design 端動)
- Phase 2 supabase ≥5 張表(STATUS LOG、Phase 1 不接表)

---

— END —
