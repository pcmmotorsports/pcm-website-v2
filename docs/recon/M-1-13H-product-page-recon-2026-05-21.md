# M-1-13H 商品頁全改版 — 真權威偵察報告

> **作者:** Claude Code (M-1-13H slice-0)
> **日期:** 2026-05-21
> **範圍:** read-only 偵察、純供 Cowork 寫實作 plan、不算正式 slice、不更新 STATUS、不 commit、不 push
> **真權威字面源:**
> - `design-reference/components/explorations/VariantCFull.jsx` @ submodule 637dafc
> - `design-reference/design-handoff/PRODUCT-PAGE-HANDOFF.md` @ submodule 637dafc
> - `design-reference/styles/explorations.css` @ submodule 637dafc
> - 既有 `apps/storefront/src/components/ProductPage.tsx` (HEAD `0cf711c`)
> - 既有 `apps/storefront/src/styles/product-page.css` (HEAD `0cf711c`)

---

## 1. 檔案大小 / 行數總表

| 角色 | 路徑 | 行數 |
|---|---|---|
| 新目標 JSX | `design-reference/components/explorations/VariantCFull.jsx` | 259 |
| 新目標 HANDOFF | `design-reference/design-handoff/PRODUCT-PAGE-HANDOFF.md` | 429 |
| 新目標 CSS | `design-reference/styles/explorations.css` | 1355 |
| 既有主元件 | `apps/storefront/src/components/ProductPage.tsx` | 260 |
| 既有 CSS | `apps/storefront/src/styles/product-page.css` | 738 |

`explorations.css` 內 `.vc-*` rule-block 行區段 = L335–L893(含 lightbox 與 hero / gallery / info / services 字面)
`explorations.css` 內 `.vcf-*` rule-block 行區段 = L1060–L1355(含 hero grid / section head / highlights / spotlight / tabs / related)

`grep -nE "^\.(vcf-|vc-)" design-reference/styles/explorations.css` 命中 **101 條規則開頭**(實際輸出見 §6)。

---

## 2. VariantCFull JSX 結構樹(附行號)

```
<div className="pe-art vcf" ref={rootRef}>                                  L48
├── <div className="vcf-crumbs">                                            L51-53
│   └── 文字: "商品目錄 › 操控部品 › Lightech 鋁合金腳踏組"(hardcoded)
│
├── <section className="vcf-hero">                                          L55-103
│   ├── <div className="vc-gallery">                                        L56-79
│   │   ├── <div className="vc-img-card" onClick={() => setLightbox(true)}> L57-69
│   │   │   ├── <img />                                                     L58
│   │   │   ├── <div className="vc-badge">NEW</div>                         L59
│   │   │   ├── <button className="vc-arrow vc-arrow-left">                 L60-62
│   │   │   ├── <button className="vc-arrow vc-arrow-right">                L63-65
│   │   │   └── <div className="vc-counter">{NN / NN}</div>                 L66-68
│   │   └── <div className="vc-thumbs">                                     L70-78
│   │       └── 4× <button className="vc-thumb-img"> map                    L71-77
│   │
│   └── <div className="vc-info">                                           L80-102
│       ├── <div className="vc-sku">LIGHTECH · PCM-00001</div>              L81
│       ├── <h1 className="vc-title">Lightech 鋁合金腳踏組</h1>             L82
│       ├── <div className="vc-sub">適用 Honda CBR600RR · 義大利原裝進口</div> L83
│       ├── <div className="vc-price">NT$ 12,800</div>                      L84
│       ├── <div className="vc-price-sub">含稅 · 滿 NT$ 4,000 免運</div>   L85
│       ├── <div className="vc-opt">                                        L86-93
│       │   ├── <div className="vc-opt-left">顏色 <em>銀色</em></div>       L87
│       │   └── <div className="vc-swatches"> 3× span                       L88-92
│       ├── <button className="vc-add">加入購物車</button>                  L94
│       ├── <button className="vc-buynow">立即購買</button>                 L95
│       └── <div className="vc-services">                                   L96-101
│           └── 4× <div className="vc-service"> hardcoded(滿額免運 NT$ 3,000 / 專業安裝 / 原廠保固 24 個月 / LINE 諮詢)
│
├── <section className="vcf-section vcf-highlights">                        L106-129  【新增】
│   ├── <div className="vcf-section-head">                                  L107-111
│   │   ├── eyebrow "N°01 — Highlights"                                     L108
│   │   ├── h2 "為什麼是 Lightech"                                          L109
│   │   └── lead "義大利賽道工藝 28 年沉澱..."                              L110
│   └── <div className="vcf-feature-grid">                                  L112-128
│       └── 3× <div className="vcf-feature-card"> hardcoded                 L113-127
│
├── <section className="vcf-spotlight">                                     L132-152  【新增】
│   ├── <div className="vcf-spot-media"> <img />                            L133-135
│   └── <div className="vcf-spot-text">                                     L136-151
│       ├── eyebrow "N°02 — Engineering"                                    L137
│       ├── h2 "為賽道設計,適合每日通勤。"                                 L138
│       ├── body × 2 hardcoded                                              L139-145
│       └── <div className="vcf-spot-stats"> 3× div hardcoded (−38% / ±0.02mm / 24m) L146-150
│
├── <section className="vcf-section"> Tabs                                  L155-211
│   ├── <div className="vcf-tabs">                                          L156-162
│   │   └── 4× <button className="vcf-tab"> map [description/specs/install/warranty]
│   └── <div className="vcf-tab-body">                                      L163-210
│       ├── description: vcf-desc + vcf-body + vcf-list (5 items)           L164-175
│       ├── specs: vcf-specs + 8× vcf-spec-row                              L176-185
│       ├── install: vcf-install + vcf-install-meta + vcf-steps (4 steps)   L186-202
│       └── warranty: vcf-desc + 3× vcf-body                                L203-209
│
├── <section className="vcf-section vcf-related">                           L214-231
│   ├── <div className="vcf-section-head">                                  L215-218
│   │   ├── eyebrow "N°03 — You may also like"                              L216
│   │   └── h2 "相同分類"                                                   L217
│   └── <div className="vcf-related-grid">                                  L219-230
│       └── 4× <div className="vcf-related-card"> map (hardcoded brand/name/price)
│
└── {lightbox && <div className="vc-lightbox">}                             L234-253
    ├── <div className="vc-lb-stage"> <img />                               L236-238
    ├── 2× <button className="vc-lb-arrow">                                 L239-244
    ├── <button className="vc-lb-close">                                    L245-247
    └── <div className="vc-lb-counter"> "NN / NN · ESC / 點任意處關閉"      L248-251
```

**State / Effect:**
- `active` useState (L12) — 主圖 index
- `lightbox` useState (L13)
- `activeTab` useState (L14) — 預設 `'description'`
- `rootRef` useRef (L15) — 用於 hover-only keyboard nav
- `prev` / `next` (L17-18) — circular index
- `useEffect` (L20-45) — keydown: hover-only 時聽 ←/→;lightbox 時聽 ESC / ←/→

**模組型態:** L259 `window.VariantCFull = VariantCFull;` 是 design submodule runtime 註冊、非 ESM export。

---

## 3. HANDOFF 改版項目逐條摘錄(附 HANDOFF 行號)

HANDOFF §「Phase 1:商品頁視覺改版」列「11 個小變更 + 2 個新增區塊」(實際編號從 #1 排到 #17),逐條:

| # | 標題 | 動作 | HANDOFF 行 | 重點字面 |
|---|---|---|---|---|
| 1 | 麵包屑 | 改樣式、**保留邏輯** | L32-40 | 12px Inter sans / `#86868b` / 分隔符 `/`→`›` / 不再 uppercase;vehiclePill 8px radius、`#f5f5f7` 底 `#1d1d1f` 字 |
| 2 | 商品圖 Gallery | **大改** | L42-66 | 4:5→1:1、`border-radius: 18px`、`linear-gradient(180deg, #f5f5f7, #ededef)`;箭頭 72×72px / radius 14px / 玻璃毛玻璃 |
| 3 | 縮圖列 | **改位置** | L68-89 | 浮 overlay 改放圖**下方**、`flex / gap 10px / margin-top 16px`、64×64px、`border-radius 10px`、active border `#1d1d1f` |
| 4 | SKU 條 | **取代品牌列** | L91-107 | `LIGHTECH · PCM-00001` 單行 mono 灰、取代右上 brand-link + sku 兩元素 |
| 5 | 商品標題 | 改字 | L109-120 | 38px Cormorant serif → 28px Inter sans 600 / -0.015em |
| 6 | 副標題 | **新增** | L122-137 | 「適用 Honda CBR600RR · 義大利原裝進口」、14px Inter `#86868b` |
| 7 | 適用車款 banner | **移除** | L139-142 | 整段 `.pd-fits-banner` 拿掉、資訊併進副標 |
| 8 | 價格 | 改字 | L144-164 | 36px Cormorant serif 紅 → 22px Inter sans 600 黑 `#1d1d1f`;移除「省 NT$ X」紅 tag 改 mono 灰 `−15%`;保留 `tweaks.showRedPrice` + `tweaks.memberTier` 邏輯預設黑色 |
| 9 | 色票 Swatches | 改形 | L166-181 | 40×40 方 → 24×24 圓、outline 取代 border 指示 active |
| 10 | 主 CTA | 改形 | L183-210 | 56px → 48px、**圓 pill `border-radius: 100px`**;Quantity 計數器保留功能、qty 放 swatches 同行右側、CTA 各佔滿行 |
| 11 | 服務承諾條 | 簡化 | L212-234 | 2×2 grid **移除圖示**、黑標題 + 灰副文 |
| 12 | Highlights | **新增區塊** | L236-265 | 3 卡橫排、`.pd-feature-*`;Phase 2 接 `product_highlights` 表 |
| 13 | Engineering Spotlight | **新增區塊**(條件) | L267-291 | 圖左文右下方 3 數據;`product.hasSpotlight` Phase 1 用 `product.id % 3 === 0` 模擬;Phase 2 接 `product_spotlights` 表 |
| 14 | Tabs 樣式 | 改形 | L293-321 | 底線 2px → **圓 pill 群組**、`#f5f5f7` 底、active 白 pill |
| 15 | Tabs 內容 | 微調 | L323-333 | desc:lead 改 Inter 19px;specs:移 border、2 欄 grid、key mono 灰;install:meta 合併淺灰卡、步驟 4 欄獨立卡片;warranty:`em` 改 600 加粗 |
| 16 | 相關商品 grid | **保留 `<ProductCard>`** | L335-339 | 只改容器標題:serif → Inter 22px semibold |
| 17 | 行動版 Sticky Buybar | **保留不動** | L341-343 | 完全保留 |

HANDOFF §「互動行為 — 全部保留」(L347-360)= **§4 保留清單 7 項**(下節對應)。
HANDOFF §「Responsive 規格」(L362-369):≥1100px 圖 1.2fr:資訊 1fr / 900-1100px 1fr:1fr padding 32px / <900px 單欄 + buybar。
HANDOFF §「驗收條件」(L373-389)13 項 checkbox(含末條「探索檔案已刪除」— 屬 design submodule 內、storefront 端不動,本報告 §7 揭示)。

---

## 4. 保留清單 7 項在 VariantCFull 字面上的處置

HANDOFF §「互動行為 — 全部保留」L347-360 列 7 項。逐條對應:

| # | 行為 | HANDOFF 引 design jsx 行 | VariantCFull 字面 | 既有 storefront 對應位置 | plan 結論 |
|---|---|---|---|---|---|
| 1 | Breadcrumb 路徑記憶(source / sourceId / sourceLabel) | design L36-91 | **缺** — VariantCFull L51-53 是 hardcoded 字串「商品目錄 › 操控部品 › Lightech 鋁合金腳踏組」、無 8-source 邏輯 | `ProductPage.tsx` L73-131 useMemo crumbs(from / sourceId / sourceLabel / brand / category / vehicle 6 URL params) | **不可拆**、保留 storefront 既有 useMemo 邏輯、改樣式不改邏輯 |
| 2 | Vehicle pill 篩選顯示與清除 | design L93-103, 168-187 | **缺** — VariantCFull grep `vehicle/pill/VehiclePill` 0 hit | `ProductPage.tsx` L135-151 vehiclePill useMemo + L146-151 handleClearVehicle + L171-193 JSX | **不可拆**、保留 storefront 既有邏輯、改樣式 |
| 3 | Lightbox 開啟、ESC 關閉、← → 切圖、手機滑動 | design L14-28, 542-585 | **部分** — VariantCFull L20-45 keydown handler(ESC/Arrow)+ L234-253 lightbox 結構 ✅;**手機滑動字面缺** | `ProductGallery.tsx`(13c 拆、未在本偵察讀全) | **不可拆**、手機滑動字面從 storefront 既有 ProductGallery 保留 |
| 4 | 主圖滑動(hero swipe) | design L196-225 | **缺** — VariantCFull 無 swipe 字面(僅 arrow + 鍵盤 ← →) | `ProductGallery.tsx`(13c 拆、未在本偵察讀全;`product-page.css` L99 `.pd-hero-img { touch-action: pan-y }` + L109 `.pd-hero-track` 滑軌結構暗示已落地) | **不可拆**、保留 storefront 既有 swipe 邏輯 |
| 5 | 加入購物車 toast | design L142-145 | **缺** — VariantCFull L94 `<button className="vc-add">加入購物車</button>` 無 onClick / 無 toast 字面 | `ProductPage.tsx` L63 useCart + L64-68 addToCart 函式;**無 toast 渲染字面**(L198 註解 TODO M-1-13g pd-toast 預埋) | **需 plan 處理**:13g toast 尚未落地;新版改完後 13g toast 是否仍需、Cowork 評估(STATUS 字面「Toast 時機定」對齊) |
| 6 | 會員等級價格(memberTier) | design `window.getPriceForTier()` | **缺** — VariantCFull L84 hardcoded "NT$ 12,800"、無 tier 條件渲染 | `ProductPage.tsx` props `tier: MemberTier`(L51)+ L201 `<ProductInfo product={product} tier={tier} />` 傳遞 + L233-239 Mobile sticky bar tier === 'store'/'premiumStore' 條件渲染 | **不可拆**、tier 傳遞鏈不動、ProductInfo 內 buy block 重寫時保留 tier 條件邏輯;backlog #161 同類:mock 路徑 product.price 仍 retail、M-1-16 接 Supabase findBySlug + toUIProduct(p, tier) 才真區分 |
| 7 | 行動版返回邏輯(依 source 決定返回哪頁) | design L506-524 | **缺** — VariantCFull 無 mobile-buybar 段落 | `ProductPage.tsx` L222-228 `pd-mbb-back onClick={() => router.back()}`(字面偏離 design 8-source、行為對等、backlog #161 已記、M-1-13e-a commit body 已揭示) | **不可拆**、保留現狀(router.back());backlog #161 追、待 Sean 補對齊 |

**總結:** 7 項中 **6 項在 VariantCFull 字面缺**(VariantCFull 是平面 demo、不涵蓋業務邏輯)、保留邏輯全部從 storefront 既有實作取出、改樣式不改邏輯。第 5 項 toast 與第 7 項 mobile-back 為**需 plan 處理**項。

---

## 5. 新增 sections 字面(Highlights / Engineering Spotlight / pill tabs)

### 5.1 Highlights(VariantCFull L106-129)

**JSX 結構:**
```jsx
<section className="vcf-section vcf-highlights">           L106
  <div className="vcf-section-head">                        L107
    <div className="vcf-eyebrow">N°01 — Highlights</div>    L108
    <h2 className="vcf-h2">為什麼是 Lightech</h2>           L109
    <p className="vcf-lead">義大利賽道工藝 28 年沉澱,每件配件都為極限操駕而生。</p>  L110
  </div>
  <div className="vcf-feature-grid">                        L112
    {/* 3 卡片 hardcoded */}
    <div className="vcf-feature-card">
      <div className="vcf-feature-num">01</div>
      <div className="vcf-feature-title">航太級材質</div>
      <p className="vcf-feature-desc">7075-T6 鋁合金,相較原廠減輕 38%,剛性提升 2 倍。</p>
    </div>
    <div className="vcf-feature-card">02 / CNC 一體成型 / 五軸 CNC 精密切削,公差 ±0.02mm,無焊接點。</div>
    <div className="vcf-feature-card">03 / 原廠保固 / 義大利原廠授權 24 個月,全台 9 家合作店家可安裝。</div>
  </div>
</section>
```

**對應 CSS class(explorations.css):**
- `.vcf-section` L1078
- `.vcf-section-head` L1081
- `.vcf-eyebrow` L1085
- `.vcf-h2` L1092
- `.vcf-lead` L1099
- `.vcf-feature-grid` L1114
- `.vcf-feature-card` L1119
- `.vcf-feature-num` L1127
- `.vcf-feature-title` L1133
- `.vcf-feature-desc` L1139

**HANDOFF 註記(L265):** 📝 資料來源 Phase 1 寫死、Phase 2 Supabase 從 `product_highlights` 表讀(STATUS 字面「Phase 2 supabase product_spotlights 後台先 LOG 不動」)。

### 5.2 Engineering Spotlight(VariantCFull L132-152、HANDOFF #13 條件渲染)

**JSX 結構:**
```jsx
<section className="vcf-spotlight">                         L132
  <div className="vcf-spot-media">                          L133
    <img src=".../{VCF_IMAGES[1]}?w=900..." />              L134
  </div>
  <div className="vcf-spot-text">                           L136
    <div className="vcf-eyebrow">N°02 — Engineering</div>   L137
    <h2 className="vcf-h2">為賽道設計,<br/>適合每日通勤。</h2>  L138
    <p className="vcf-body">從 SBK 賽事工程衍生的設計語言,使用航太級 7075-T6 鋁合金,經 5 軸 CNC 一體成型後,以 Hard Anodized 硬陽極處理表面,耐腐蝕、耐磨、抗刮傷。</p>  L139-142
    <p className="vcf-body">對應原廠螺絲孔位,Plug & Play,不需修改車身結構。包含安裝螺絲、扭力建議值與專屬保固卡。</p>  L143-145
    <div className="vcf-spot-stats">                        L146
      <div><strong>−38%</strong><span>較原廠輕量化</span></div>
      <div><strong>±0.02mm</strong><span>CNC 加工公差</span></div>
      <div><strong>24m</strong><span>原廠保固期</span></div>
    </div>
  </div>
</section>
```

**對應 CSS class(explorations.css):**
- `.vcf-spotlight` L1146
- `.vcf-spot-media` L1155 / `.vcf-spot-media img` L1160
- `.vcf-spot-text` L1164
- `.vcf-spot-text .vcf-h2` L1170
- `.vcf-spot-stats` L1174 / `> div` L1182 / `strong` L1187 / `span` L1193
- 共用:`.vcf-eyebrow` L1085 / `.vcf-h2` L1092 / `.vcf-body` L1105

**HANDOFF 註記(L291):** 📝 Phase 1 用 `product.id % 3 === 0` 條件渲染(前 3 件商品可見);Phase 2 改 `product_spotlights` 表。

### 5.3 pill tabs(VariantCFull L155-211、HANDOFF #14)

**JSX 結構:**
```jsx
<section className="vcf-section">                           L155
  <div className="vcf-tabs">                                L156
    {[['description','商品介紹'],['specs','規格表'],['install','安裝須知'],['warranty','保固政策']].map(([k, l]) => (
      <button className={`vcf-tab ${activeTab === k ? 'is-active' : ''}`} onClick={() => setActiveTab(k)}>{l}</button>
    ))}
  </div>
  <div className="vcf-tab-body">  L163
    {/* 4 個 conditional pane:vcf-desc / vcf-specs / vcf-install / vcf-desc(warranty) */}
  </div>
</section>
```

**對應 CSS class:**
- `.vcf-tabs` L1200 — `gap: 4px / padding 6px / background #f5f5f7 / border-radius 100px / width fit-content`(HANDOFF L298-307 字面)
- `.vcf-tab` L1209 — pill 樣式
- `.vcf-tab.is-active` L1220 — 白底 active
- `.vcf-tab-body` L1226
- `.vcf-list` L1227 / `.vcf-list li::before` L1239
- `.vcf-specs` L1248 / `.vcf-spec-row` L1254 / `.vcf-spec-k` L1261 / `.vcf-spec-v` L1267
- `.vcf-install-meta` L1273 / `.vcf-steps` L1295 / `.vcf-step` L1300 / `.vcf-step-n` L1307 / `.vcf-step p` L1313

**4 個 tab key 字面:** `description` / `specs` / `install` / `warranty`(與既有 M-1-13f-2 落地 ProductTabs 4 key 一致)。

---

## 6. .vcf-* / .vc- class 完整清單(行號 + 一句話功能)

來源:`grep -nE "^\.(vcf-|vc-)" design-reference/styles/explorations.css` 命中 101 條規則開頭。

### 6.1 `.vc-*` 區段(hero / gallery / lightbox 共用、L335-L893)

| 行號 | class | 功能 |
|---|---|---|
| 335 | `.vc-crumbs` | 麵包屑容器(舊版本、被 `.vcf-crumbs` 取代) |
| 341 | `.vc-crumbs span` | 分隔符樣式 |
| 342 | `.vc-crumbs strong` | 當前頁文字 |
| 343 | `.vc-gallery` | gallery 包裹、`user-select: none` |
| 344 | `.vc-img-card` | 主圖卡片(1:1 比例容器) |
| 355 | `.vc-img-track` / 362 `.vc-img-slide` / 366 `.vc-img-slide img` | swipe track 結構(VariantCFull jsx 未渲染、CSS 預留) |
| 372 | `.vc-img-card > img` | 主圖 img |
| 376 | `.vc-badge` | NEW 角標 |
| 388 | `.vc-arrow` | 圓角 72×72 玻璃毛玻璃左右箭頭 |
| 405-411 | `.vc-arrow:hover / :active / -left / -right` | 箭頭互動與位置 |
| 412 | `.vc-counter` | 主圖右下計數器 `01 / 04` |
| 424 | `.vc-thumbs` | 縮圖列容器(圖下方) |
| 430 | `.vc-thumb-img` | 縮圖按鈕 64×64 |
| 441 | `.vc-thumb-img img` | 縮圖內圖 |
| 447-449 | `.vc-thumb-img:hover / .is-active / .is-active img` | 縮圖互動 |
| 452-504 | `.vc-lb / .vc-lb-stage / .vc-lb-close / .vc-lb-nav* / .vc-lb-counter` | 早期 lightbox 結構(L833-893 為新版 `.vc-lightbox`) |
| 749 | `.vc-info` | info column 容器 |
| 750 | `.vc-sku` | SKU mono 字、`LIGHTECH · PCM-00001` |
| 756 | `.vc-title` | 商品標題 28px Inter sans 600 |
| 762 | `.vc-sub` | 副標 14px `#86868b` |
| 767 | `.vc-price` | 價格 22px Inter sans 600 黑 |
| 773 | `.vc-price-sub` | 「含稅 · 滿 NT$ 4,000 免運」 |
| 778-789 | `.vc-opt / -left / -left em / .vc-swatches` | 顏色選項 + swatches 容器 |
| 790 | `.vc-swatch` | 圓色票 24×24 |
| 797 | `.vc-swatch.is-active` | active outline 1.5px |
| 798 | `.vc-add` | 加入購物車黑 pill 48px |
| 809 | `.vc-buynow` | 立即購買白 pill 48px |
| 819 | `.vc-services` | 服務承諾 2×2 grid |
| 826 | `.vc-service` | 單一服務 |
| 830 | `.vc-service em` | 副文 11px `#86868b` |
| 833 | `.vc-lightbox` | 新版 lightbox 容器 |
| 845-893 | `.vc-lb-stage / -close / -arrow* / -counter` | lightbox 內元素 |

### 6.2 `.vcf-*` 區段(layout-only、L1060-L1355)

| 行號 | class | 功能 |
|---|---|---|
| 1060 | `.vcf-crumbs` | 新版 crumbs 容器(取代 `.vc-crumbs`) |
| 1065-1066 | `.vcf-crumbs span / strong` | 分隔符 + 當前頁 |
| 1069 | `.vcf-hero` | hero grid(gallery + info 雙欄) |
| 1078 | `.vcf-section` | 通用 section 包裹 |
| 1081 | `.vcf-section-head` | section 頭(eyebrow + h2 + lead) |
| 1085 | `.vcf-eyebrow` | mono 灰小標 `N°01 — Highlights` |
| 1092 | `.vcf-h2` | section h2 標題 |
| 1099 | `.vcf-lead` | section 介紹文 |
| 1105 | `.vcf-body` / 1111 `.vcf-body strong` | 段落 body 文字 |
| 1114 | `.vcf-feature-grid` | Highlights 3 卡片 grid |
| 1119 | `.vcf-feature-card` | 單卡 |
| 1127 | `.vcf-feature-num` | 卡序號 01 / 02 / 03 |
| 1133 | `.vcf-feature-title` | 卡標題 |
| 1139 | `.vcf-feature-desc` | 卡描述 |
| 1146 | `.vcf-spotlight` | Spotlight 容器(圖左文右 grid) |
| 1155 | `.vcf-spot-media` / 1160 `img` | 媒體區 |
| 1164 | `.vcf-spot-text` | 文字區 |
| 1170 | `.vcf-spot-text .vcf-h2` | Spotlight h2 |
| 1174 | `.vcf-spot-stats` / 1182 `> div` / 1187 `strong` / 1193 `span` | 3 數據條 |
| 1200 | `.vcf-tabs` | pill tabs 容器 |
| 1209 | `.vcf-tab` | 單一 pill tab |
| 1219-1220 | `.vcf-tab:hover / .is-active` | tab 互動與 active 白 pill |
| 1226 | `.vcf-tab-body` | tab 內容區 |
| 1227 | `.vcf-list` / 1232 `li` / 1239 `li::before` | desc 條列 `—` 灰 |
| 1248 | `.vcf-specs` / 1254 `.vcf-spec-row` / 1261 `-k` / 1267 `-v` | specs 2 欄 grid |
| 1273 | `.vcf-install-meta` / 1282 `> div` / 1285 `span` / 1291 `strong` | install meta 三欄合併卡 |
| 1295 | `.vcf-steps` / 1300 `.vcf-step` / 1307 `-step-n` / 1313 `.vcf-step p` | install 4 步驟卡片 |
| 1320 | `.vcf-related-grid` | related 4 卡 grid |
| 1325 | `.vcf-related-card` / 1336 `:hover .vcf-related-img` | 卡片與 hover |
| 1328 | `.vcf-related-img` / 1337 `img` | 卡內圖 |
| 1341 | `.vcf-related-brand` | 卡內品牌 |
| 1347 | `.vcf-related-name` | 卡內品名 |
| 1352 | `.vcf-related-price` | 卡內價格 |

**class 命名規律:**
- `.vc-*` = hero / gallery / info / services / lightbox(VariantA / B / C 共用、跨變體 reuse)
- `.vcf-*` = VariantCFull 專屬 layout(crumbs / section / highlights / spotlight / tabs / related)
- HANDOFF L24 字面要求遷入 `product-page.css` 時兩類 prefix **改名為 `.pd-*`**(對齊 storefront 命名空間)

---

## 7. 既有 ProductPage.tsx vs VariantCFull.jsx 差距摘要

### 7.1 行數對照

| 項目 | 既有 storefront | 目標 VariantCFull | 差距 |
|---|---|---|---|
| 主元件行數 | `ProductPage.tsx` 260 行 | `VariantCFull.jsx` 259 行 | 接近 |
| 主元件結構 | 拆成 5 個子元件 + Mobile sticky bar 內嵌 | 平面單檔(無拆) | **不對等** |
| CSS 行數 | `product-page.css` 738 行 | `explorations.css` `.vcf/.vc` 區段約 410 行 | storefront 含 lightbox + mobile + tabs 完整;explorations 僅 layout |

### 7.2 子元件保留 / 重寫範圍

| 子元件 | 既有狀態 | 預期動作 | 重點變更(對應 HANDOFF #) |
|---|---|---|---|
| `ProductPage.tsx`(主) | 13b 骨架 + breadcrumb 8-source + vehicle pill + Mobile sticky bar | **改 crumbs 樣式 + 新增 Highlights / Spotlight section 串接 + 保留 mobile sticky bar 不動** | #1 / #12 / #13 / #17 |
| `ProductGallery.tsx`(13c 拆) | 4:5 直立、thumb overlay、arrow 40px | **大改:1:1 / 18px radius / 漸層底 / arrow 72px 玻璃毛玻璃 / thumb 移到圖下方 64×64** | #2 / #3 |
| `ProductInfo.tsx`(13d 拆) | brand-row + sku + title (serif 38px) + fits-banner + options + buy block + price (serif 36px 紅) | **大改:取代 brand-row → SKU line / title 28px Inter sans / 新增副標 / 移除 fits-banner / 價格 22px 黑 / swatches 圓 24×24 / CTA 48px 圓 pill** | #4 / #5 / #6 / #7 / #8 / #9 / #10 |
| `ProductServices.tsx`(13f-1 拆) | 2×2 grid + 圖示 | **中改:移除圖示、純文字** | #11 |
| `ProductTabs.tsx`(13f-2 落地) | 底線 2px tab + 4 panel(description / specs / install / warranty) | **大改:底線改 pill 群組 / specs 移 border 2 欄 grid / install meta 合併卡 + 4 步驟卡片 / warranty `em` 加粗** | #14 / #15 |
| **Mobile sticky bar**(內嵌 ProductPage L220-257、未拆) | router.back() + tier 條件渲染(13e-a + 13e-b 落地) | **保留不動** | #17 |
| **`ProductHighlights.tsx`(新)** | 不存在 | **新增** — 3 卡片 hardcoded、傳 `product.brand` h2 變數 | #12 |
| **`ProductSpotlight.tsx`(新)** | 不存在 | **新增** — 條件渲染 `product.id % 3 === 0`、4 段 hardcoded | #13 |
| **`ProductRelated.tsx`** | 未實作(STATUS 字面 13g 推延) | **接續或推延**(STATUS 字面「卡片改完後 Related 自動繼承新設計」、Cowork 評估 13g 殘餘) | #16 |

### 7.3 子元件刪除清單

- **無 storefront 子元件刪除**(現有 5 個子元件全部保留、內部重寫)
- **新增** 2 個子元件:`ProductHighlights` / `ProductSpotlight`(子元件拆法 Cowork 拍板;若行數小於拆檔閾值可直接內嵌 ProductPage)
- **design submodule 內**:HANDOFF L13 / L389 / L426-429 要求刪除 `design-reference/components/explorations/`、`design-reference/styles/explorations.css`、`design-reference/Product Page Explorations.html` — 屬 design submodule 內、storefront 端不可動;需 Sean 在 Claude Design 端動、Sean push pcm-website-design 後 submodule update 同步(對齊 lessons §12-21 Claude Design 對 GitHub 唯讀、Sean 唯一寫手)

### 7.4 字面偏離 / 衝突發現

| # | 字面 | VariantCFull 來源行 | 衝突點 |
|---|---|---|---|
| α | 免運門檻 | L85 `滿 NT$ 4,000 免運` + L97 `滿額免運 NT$ 3,000 以上`(同檔內 4000 vs 3000) | design submodule 內部不一致;storefront 目前統一 NT$ 5,000;對應 STATUS 字面 backlog #161「免運門檻 design L302 NT$ 4,000 + L358 NT$ 3,000 storefront 統一 NT$ 5,000」、本檔再次顯化 |
| β | 服務承諾「LINE 30 分鐘內回覆」 | L100 | hardcoded、屬站台級設定、HANDOFF L401 標 Phase 2 接 `site_services` 表 |
| γ | 副標固定字面「義大利原裝進口」 | L83 `適用 Honda CBR600RR · 義大利原裝進口` | HANDOFF L128 字面 `${product.fits} · ${brandCountry}原裝進口`、Phase 1 brandCountry 從哪拿未明確、Cowork 評估硬寫「義大利」or 接 brand mock |
| δ | Demo runtime 註冊 | L259 `window.VariantCFull = VariantCFull;` | 純 demo、storefront 端不複製此行(ESM export 取代) |
| ε | 圖片源 | L4-9 hardcoded unsplash photo ID array、L58 / L75 / L134 / L223 直接拼接 unsplash URL | storefront 用 `productGallery()` helper + mock products;改版時保留 storefront mock 路徑 |

---

## 8. 內容分級 L1 / L2 / L3 標記建議(**推測 / 待 Cowork 拍板**)

> 本節為**初步推測**、依鐵則 9 內容分級表(L1:年 0-1 次 / L2:季 1-3 次 / L3:週多次 + 必須後台 CRUD);最終分級由 Cowork plan 拍板。
> STATUS 字面 Sean 2026-05-21 拍板「Phase 2 supabase product_spotlights 後台先 LOG 不動」、即 Phase 1 允許 hardcoded、不停 slice 寫 L3 PRD(此為 Sean 業務拍板對沖鐵則 9「L3 發現立即停」、本報告需揭示)。

| 項目 | 字面源(VariantCFull / HANDOFF 行) | 推測級別 | 推測理由 |
|---|---|---|---|
| **Highlights 3 卡片內容**(航太級材質 / CNC 一體成型 / 原廠保固) | VariantCFull L113-127、HANDOFF L249-251 | **L3 但 Phase 1 允許 hardcoded** | 每件商品材質 / 製程 / 保固細節不同、需頻繁更新 = L3 本質;HANDOFF L265 標 Phase 2 `product_highlights` 表;Sean 拍板 Phase 2 先 LOG、Phase 1 預設 3 卡(可單一商品共用)、不立即停 PRD |
| **Highlights h2 "為什麼是 Lightech"** | VariantCFull L109、HANDOFF L244 `為什麼是 {product.brand}` | L1(template) | 用 `product.brand` 變數注入、模板字面年改 0-1 次 |
| **Engineering Spotlight 2 段 body + 3 stats** | VariantCFull L139-150 | **L3 但 Phase 1 允許 hardcoded** | 工程說明 / 數據(−38% / ±0.02mm / 24m)每件商品不同、L3 本質;HANDOFF L291 標 Phase 2 `product_spotlights`;Phase 1 用 `product.id % 3 === 0` 條件渲染(前 3 件商品可見)、Sean 拍板 Phase 2 先 LOG |
| **副標 "適用 X · 義大利原裝進口"** | VariantCFull L83、HANDOFF L128 | L2 | `product.fits` 已是 mock 變數(L1/L2)、「義大利」應從 `product.brand` 對應的國別表查;Phase 1 可 hardcoded「義大利」(對齊 design 字面)+ TODO + backlog;Phase 2 brand 表加 `country` 欄位 |
| **服務承諾 4 條**(滿額免運 NT$ 3,000 / 專業安裝全台合作店家 / 原廠保固 24m / LINE 30 分鐘內回覆) | VariantCFull L97-100 | L2 | 站台級政策、季度可能調(免運門檻、客服時段);HANDOFF Phase 2 接 `site_services` 表;Phase 1 hardcoded + backlog 追(對應 backlog #161 免運門檻不一致) |
| **specs 8 欄**(品牌 / 型號 / 分類 / 材質 / 表面處理 / 重量 / 產地 / 適用車款) | VariantCFull L178 | **L3 但 Phase 1 允許 hardcoded** | 每件商品規格不同 = L3 本質;對應 STATUS 字面「13f-2 tabs L3 內容問題:specs 4 hardcoded 欄位」(本檔揭示實際為 8 欄、非 4 欄、Cowork 校正);M-1-16 接 Supabase findBySlug 才真接 product_specs 表 |
| **install 4 steps + meta** | VariantCFull L188-200 | **L3 但 Phase 1 允許 hardcoded** | 每件商品安裝流程不同 = L3 本質;對應 STATUS 「install steps L3」;Phase 2 接 `product_installs` 表 |
| **warranty 3 段文字** | VariantCFull L205-207 | L2 | 站台級保固政策、季度級;Phase 1 hardcoded;Phase 2 接 `site_services` 或單獨 warranty 表(HANDOFF schema 未明列) |
| **breadcrumb 字面**「商品目錄 › 操控部品 › Lightech 鋁合金腳踏組」 | VariantCFull L52(hardcoded demo) | L1 + 動態 | storefront 既有 ProductPage.tsx 8-source crumbs useMemo 已從 product / URL params 動態組、不 hardcoded |
| **價格 NT$ 12,800** | VariantCFull L84(hardcoded demo) | 動態 | storefront 從 product.price + tier 拿、非分級內容 |

**建議 Cowork plan 處理方向:**
1. L3 內容 hardcoded(Highlights / Spotlight / specs / install)Phase 1 允許落地、但 commit body **必揭示「Sean 業務拍板對沖鐵則 9」+ backlog 追**、避免「不停 slice」變慣例
2. L2 內容(副標 brandCountry / 服務承諾 / warranty)Phase 1 hardcoded + TODO + backlog;免運門檻借 backlog #161 順手對齊
3. Phase 2 Supabase schema 11 張表(HANDOFF L398-401)在 STATUS 已標「先 LOG 不動」、本 slice 群結束後 STATUS 字面追加「Phase 2 schema LOG 條目」確認落地

---

## 9. Code 觀察 — slice 拆法初步輪廓(**僅供 Cowork 參考、不拍板**)

> 本節為**初步觀察 + 建議**、實際拆法 / 估時 / 合併與否由 Cowork plan 拍板(STATUS 字面預估 4-6 slice、3-5 小時、跨多 session)。

### 9.1 拆法觀察 8 個候選 slice(粗顆粒、可合可拆)

| 候選 | 範圍 | 預估時長(觀察) | 主要動的子元件 | 對應 HANDOFF # |
|---|---|---|---|---|
| **A** | crumbs 樣式 + Gallery 1:1 / 18px radius / arrow 72px / counter / thumb 移下方 | 30-40 分 | ProductGallery + product-page.css crumbs / hero / thumb 段 | #1 / #2 / #3 |
| **B** | Info column 上半:SKU line / title 28px / 副標 / 移除 fits banner | 25-35 分 | ProductInfo 上半 | #4 / #5 / #6 / #7 |
| **C** | Buy block + 色票:swatches 圓 24×24 / 價格 22px 黑 / 圓 pill CTA 48px / services 移圖示 | 30-40 分 | ProductInfo 下半(buy block)+ ProductServices | #8 / #9 / #10 / #11 |
| **D** | 新增 ProductHighlights 子元件 + 3 卡 hardcoded + CSS `.pd-feature-*` | 25-35 分 | 新檔 ProductHighlights.tsx + product-page.css 新增段 | #12 |
| **E** | 新增 ProductSpotlight 子元件 + 條件渲染 + 4 段 hardcoded + 3 stats + CSS `.pd-spotlight*` | 25-35 分 | 新檔 ProductSpotlight.tsx + product-page.css 新增段 | #13 |
| **F** | Tabs pill 改造 + 內容微調(desc lead / specs 2 欄 / install meta 合併 + 4 步驟卡 / warranty `em` 加粗) | 30-45 分 | ProductTabs + product-page.css L460-577 重寫 | #14 / #15 |
| **G** | Related grid 容器 + 標題(Inter 22px semibold);`<ProductCard>` 保留 | 15-25 分 | ProductPage 新增 related section + product-page.css | #16 |
| **H** | 收尾:13g 殘餘評估(Toast 是否仍需 + Responsive 收口 design L662-667)+ STATUS 字面「Phase 2 supabase 先 LOG」記錄 | 20-30 分 | ProductPage + product-page.css L724-738 responsive | STATUS 殘餘 |

**總觀察估時:** 8 候選 × 25-40 分 ≈ 3.5-5 小時(對齊 STATUS 字面 3-5 小時)。

### 9.2 合併 / 拆分建議(觀察)

- **A + B + C**(Hero gallery + Info column 全套):若視為「商品頁上半 Apple/Aritzia 化」單一視覺單元、可合為 1-2 slice;但 A(Gallery 結構改動)+ B/C(Info column 重寫)動的子元件不同、不建議單一 slice(對齊鐵則 5 雙檔聯動 vs 跨檔聯動界線)
- **D + E**(Highlights + Spotlight):同為新增 section、可合可拆;若 ProductSpotlight 條件渲染邏輯需 spike(`product.id % 3 === 0` 從哪判定),拆 1 slice spike + 1 slice 落地;否則合一 slice ≈ 45 分(剛達鐵則 4 上限)
- **F**(Tabs)單獨成 slice — 範圍大、CSS 重寫 100+ 行、不建議與其他合併
- **G + H**(Related + 收尾)可合 1 slice ≈ 35-50 分(若超 45 拆)

### 9.3 鐵則對應檢查(觀察、Cowork 確認)

- **鐵則 4(15-45 分可中斷):** A / B / C / D / E / F / G / H 個別觀察都在 15-45 分內 ✅
- **鐵則 5(CSS + TSX 雙檔同 slice):** 每個 slice 都同時動 .tsx + .css ✅
- **鐵則 6(>400 行必拆):** ProductPage.tsx 目前 260 行 + 新增 Highlights / Spotlight 預估 +60-80 行 ≈ 320-340 行(>300 警戒、未到 400 必拆);若 Highlights / Spotlight 內嵌 ProductPage.tsx 而非拆檔、需後續監控
- **鐵則 8(重大改動先提 plan):** 本次改版**跨 6+ 子元件 + 動 product-page.css 738 行重寫過半**、明確命中鐵則 8、必先 plan + multi-select 拍板再動工 ✅(現在正是 plan 階段)
- **鐵則 9(L3 立即停寫 PRD):** Highlights / Spotlight / specs / install 字面 L3 命中、Sean 業務拍板對沖「Phase 2 先 LOG 不動」、Phase 1 hardcoded 允許但 commit body 必揭示 ✅
- **鐵則 11(三綠 + 字面 vs 事實):** 每 slice 收工跑 typecheck + lint + build、字面偏離 commit body 揭示 ✅
- **鐵則 12(Codex Review Packet):** 本 slice 群為「進度單元結束」+「動共用元件 ProductGallery / ProductInfo / ProductServices / ProductTabs」、命中觸發、收尾 slice commit 前產 Packet ✅

### 9.4 風險點觀察(供 Cowork plan 風險章節參考)

1. **HANDOFF 字面有 design 對 design jsx 行號錯位**:HANDOFF L34 / L353-360 引「ProductPage.jsx line 36-91」等 — 那是 **design submodule 原 ProductPage.jsx 行號**、不是 storefront 既有 ProductPage.tsx 行號;Cowork plan 寫指令時須校正行號對應(對齊 lessons §12-14、§12-16 字面真權威確認)
2. **`product.hasSpotlight` 從哪判定**:HANDOFF L291 字面用 `product.id % 3 === 0`、storefront MockProduct 是否有 `id: number` 欄位 / 還是用 `slug` — 需 Cowork 確認(對齊 lessons §12-33 grep callsite)
3. **免運門檻三方衝突**:VariantCFull 內 NT$ 4,000 / NT$ 3,000 vs storefront 既有 NT$ 5,000 三方不一致(backlog #161 已追)、本次改版借機在 storefront 統一還是維持 NT$ 5,000、需 Sean 拍板;預估 Cowork 列為 multi-select 題目
4. **explorations 檔刪除動作**:HANDOFF L389 / L426-429 要求刪 design submodule 內 explorations 資料夾 — Sean 唯一寫手、需 Sean 在 Claude Design 端動;storefront 端 slice 不涉此動作、僅在 STATUS / commit body 記錄「待 Sean push pcm-website-design 後 submodule update」(對齊 lessons §12-21)
5. **mobile sticky bar 與 Apple/Aritzia 風格的視覺不一致**:HANDOFF #17 標「保留不動」、但 product-page.css L670-704 mobile bar 用 `#c41e3a` 紅色字 + 紅 buynow 按鈕 — 與新版商品頁全黑 / 灰系不協調;需 Cowork 評估是否本次改版借機改 mobile bar 色系(超出 HANDOFF 範圍、需 Sean 拍板)
6. **`<ProductCard>` 保留不改**:HANDOFF L338 字面「不要改它」— Related 容器標題改新樣式時、卡片內字仍用既有 ProductCard 樣式、可能視覺不協調;需 Cowork 評估是否本次借機改 ProductCard、或維持 STATUS 字面「卡片改完後 Related 自動繼承新設計」推延 13g

---

## 偵察結論

- ✅ VariantCFull.jsx 259 行、結構樹 5 段(crumbs / hero / highlights / spotlight / tabs / related)+ lightbox(conditional)、無業務邏輯
- ✅ HANDOFF 17 項(11 改 + 2 新增 + 4 雜)+ 7 保留清單 + 13 驗收條件齊備
- ✅ explorations.css `.vc-*`(L335-893)+ `.vcf-*`(L1060-1355)class 共 101 條規則開頭
- ✅ 既有 storefront 子元件結構(ProductPage / Gallery / Info / Services / Tabs + Mobile sticky 內嵌)清楚、改版範圍對應明確
- ✅ 保留清單 7 項中 6 項業務邏輯在 VariantCFull 字面缺、保留鏈從 storefront 既有實作取出
- ⚠️ Toast(#5)+ mobile-back(#7)為 plan 階段需處理項
- ⚠️ 風險點 6 條(行號錯位 / Spotlight 條件 / 免運門檻 / explorations 刪除 / mobile bar 色系 / ProductCard 保留)供 Cowork plan multi-select

**等 Cowork 寫實作 plan、再寫獨立 slice 把報告納入(或視拍板而定)。**

— END —
