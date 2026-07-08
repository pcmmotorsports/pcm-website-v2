# GB Racing / Bonamici 品牌形象大版面(N°01 + N°02)搬進 storefront — 正式 plan(草案 v0.4)

> 產出:2026-07-08 Claude Code session(dev)。**鐵則 8 重大改動(動 ProductPage + 共用元件 + 跨 3+ 檔)→ 先提 plan 等 Sean 批准才動工。**
> v0.2 = 已折入 4-critic 對抗審查(事實面 0 must-fix、完整性 4 must-fix):§1.3 剝草稿撞名 token + 深色規則、D5 logo 來源、D6 品牌色變數名(5 個)、`BrandShowcase` dispatcher、'use client' 邊界。
> **v0.3(Sean 看過 Artifact + 追加拍板)= 範圍擴大**:一致性=B(品牌介紹全搬到規格下方、含 RPM,🔴 RPM byte 鐵律解除)+ 規格區 tabs→長頁全展開(Sean 拍 A、SEO)+ ProductFitments 手機排版修齊。**5 slices(§4)**:Fitments 修 → 規格長頁 → dispatcher+reorder → GB → Bonamici。
> **v0.4 = 關卡1 codex-adversary(gpt-5.5、唯讀零留痕驗)✅ 已跑**:5 must-fix + 1 nit **全折入**——①BrandShowcase 收完整 `product`(非只 slug,ProductSpotlight 雙守門)②ProductTabs 長頁重建 ARIA heading id ③ProductTabs 保留 `'use client'`+安裝 CTA ④ProductPage 補 DOM 順序斷言 ⑤Slice 4/5 L2 數字內容 TODO+backlog ⑥(nit)Fitments 斷點 ≤720 單欄/721-1079 兩欄 align-start。**plan 定案,可動工。**
> 來源草稿:**Claude Artifact v4**(`https://claude.ai/code/artifact/13dc2490-7a87-40d6-a582-a56840ee093b`,Sean 已回饋數輪、本 session 已抓回完整備份)。設計脈絡:`docs/handoff/2026-07-03-multibrand-gb-bonamici-kickoff-handoff.md` §3 + memory `project_gbracing-highlights-sync`(B 項)+ #212 方向3。
> 一句話:**RPM 商品頁已有「為什麼選 RPM Carbon」三卡(N°01)+ 紋路牆(N°02),用 isRpmCarbon 只給 RPM;現在照同一套骨架 + 各自品牌文案,給 GB Racing 和 Bonamici 也做形象區,做成「每品牌一元件 + brand 條件渲染」。文案已在草稿定案(非 AI 自編、無 R6 問題)。**

---

## 1. 現況(偵察查證、附 檔案:行號)

### 1.1 RPM 守門機制(要照抄的模式)
- `isRpmCarbon`(`ProductPage.tsx:92`)= `product.brandSlug === RPM_CARBON_BRAND_SLUG`(`'rpm-carbon'`,`mock-products.ts:31`)。🔴 **守門一律用 `brandSlug`,絕不可用 `product.brand`**(顯示名 'RPM CARBON')。
- 子元件 mount:`ProductServices isRpmCarbon={}`(`:290`,卡級守門)、`ProductFitments`(`:293`)、`{isRpmCarbon && <ProductHighlights/>}`(`:301`)、`{isRpmCarbon && <ProductSwatchWall/>}`(`:302`)、`<ProductSpotlight/>`(`:303`,自帶第二道守門)。
- brandSlug 資料流:`domain product.brand.slug` → `toUIProduct`(`products.ts:129`)→ `MockProduct.brandSlug` → props。
- 非 RPM slug 值(`scripts/supplier-config.ts`):**`gb-racing`**(:93)、**`bonamici`**(:103)。

### 1.2 可照抄的骨架 + 可重用 class
- `ProductHighlights.tsx`(N°01,prop-less):`section.pd-section` → `.pd-section-head`(`.pd-eyebrow` > `.pd-eb-no`「01」+ `.pd-eb-sep` + `.pd-eb-label` + `.pd-h2` + `.pd-lead`)→ `.pd-feature-grid` × 3 `article.pd-feature-card`(`.pd-feature-num`+`.pd-feature-title`+`.pd-feature-desc`)。
- `ProductSwatchWall.tsx`(N°02,`'use client'`)、`ProductServices.tsx`(服務橫條)骨架同源。
- 可重用 class(全在 `styles/product-page.css`):`pd-section`/`pd-section-head`/`pd-eyebrow`/`pd-eb-no`/`pd-eb-sep`/`pd-eb-label`/`pd-h2`/`pd-lead`/`pd-feature-grid`/`pd-feature-card`/`pd-feature-num`/`pd-feature-title`/`pd-feature-desc`。
- 🎁 **`pd-eb-logo`(`:691-695`)已定義但零元件使用 = 預留給品牌 logo 的插槽**。⚠️ 但 GB/Bonamici logo 檔**只在 `design-reference/assets/brand-logos/`(submodule,Next.js 不 serve)**,storefront `public/` 沒有;RPM 的 N°01 正因無 logo 資產才**改用文字 `.pd-eb-label`**(`ProductHighlights.tsx:10-12`)。→ 見決策 D5(用文字 label 或把 logo 複製進 `public/brands/`)。

### 1.3 Token 現況 vs 草稿要新增(⚠️ 對抗審查抓 3 個 must-fix,搬 CSS 前務必看)
- 有:`--c-gold: #a98a4a`(`tokens.css:24`,全站金線章節簽名)、`--f-display`(Antonio,`:31`)、`--f-mono`(`:28`)。
- 🔴 **草稿品牌色全站零定義**,且草稿實際用的是 **5 個變數、不是 3 個**:`--gb-red`/`--gb-red-deep`/`--gb-navy`/`--bona-bronze`/`--bona-bronze-deep`(grep 草稿確認)。→ 決策 D6:**沿用草稿變數名**(含兩個 `-deep`、只收進 tokens.css)**或**全改 `--c-*` 前綴並同步替換所有 `var()` 引用;不可只建 3 個(否則 `-deep` 深色調無 token、品牌色 render 錯)。**不可覆蓋 `--c-gold`**(拍板:品牌色只進各自特色區、金線仍全站簽名)。
- 🔴 **草稿 `:root` 整份重定義核心 token**(`--c-bg/-surface/-surface-2/-surface-3/-border/-border-strong/-text/-text-2/-text-3/-text-inverse`,與 `tokens.css` 完全撞名)。→ 搬 CSS 時**只取品牌區元件級規則 + 品牌色 token**,顯式**剝除草稿 `:root` 內所有既存於 tokens.css 的 `--c-*` 核心 token 重定義**;否則出現第二份全域 token、cascade 打架污染全站中性色。
- 🔴 **草稿有雙軌深色主題**(`@media (prefers-color-scheme: dark)` + `:root[data-theme="dark"]`),但 **storefront 是亮色-only**(tokens.css dark token 是死碼、全站無 theme 切換器)。→ 搬草稿 CSS 時**刪掉品牌區的 `@media (prefers-color-scheme: dark)` 與 `:root[data-theme="dark"]` 兩段**;否則 OS 開夜間模式的 macOS/iOS 客人會看到**單頁半亮半暗撕裂**(品牌區變暗、其餘維持亮)。列成 Slice 1/2 驗收條件。

### 1.4 圖片資產(最大落地卡點)
- RPM 圖走**遠端 CDN 純 `<img>`**(`rpm-swatches.ts:32` susercontent CDN),無 `next/image`、`next.config.ts` 無 `images.remotePatterns` 限制。`public/` 目前只有 `placeholder-product.png`/`pcm-logo.png` 兩檔。
- 🔴 **草稿現用 base64 內嵌圖 + YouTube 縮圖佔位 → 必須落地成真圖檔**(base64 會灌爆 client bundle)。建議 `public/brands/gb-racing/*`、`public/brands/bonamici/*`。
- 🔴 **鐵則 1 + 版權**:GB 兩張圖(車架防倒球=裝車實拍、拉桿護弓=促銷 banner)待 Sean 給乾淨白底棚拍;官網抓的品牌圖版權待 Sean 確認授權;Bonamici 影片封面/選片 Sean 可換。**這是「上線 gate」不是「寫 code gate」**(可先用佔位圖把結構做起來)。

### 1.5 測試鎖(RPM byte 不可變)
- `ProductPage.test.tsx:184-195`:rpm-carbon → N°01/N°02/泰國原廠服務皆須存在。
- `ProductPage.test.tsx:197-209`:**gb-racing → 上述四者皆須 `null`,但 3 張通用服務卡仍顯**。← 本 plan 會改到這條(gb-racing 現在要「顯示 GB 形象區」)。
- `ProductServices.test.tsx` / `ProductSpotlight.test.tsx`(含 gb-racing 不渲染驗證)/ `ProductHighlights.test.tsx` / `ProductSwatchWall.test.tsx`(prop-less、獨立元件、新分支不誤觸)。
- 🔴 **避雷**:新分支不得改 `isRpmCarbon` 判定(`:92`)、不得移動 `:301-302` 既有 mount 行;必須是**純新增的並列條件**(`{brandSlug==='gb-racing' && <GbShowcase/>}`),不與 isRpmCarbon 合併成三態 switch。

---

## 2. 草稿 v4 內容(要搬的東西)
- **GB Racing**:N°01 三卡(FIM 認證/專利複材/…)+ N°02(冠軍認證橫幅 → 信任狀數字列〔海軍藍大數字〕→ 產品線矩陣〔引擎護蓋/車架防倒球/拉桿護弓/輪軸防倒球〕)。
- **Bonamici**:N°01 三卡 + N°02(品牌影片 → 研發段 → 職人手工·精密切削段 → 8 色陽極色牆 → 20 年徽章)。
- 骨架用 RPM 的 pd-* token(金線/Antonio 義體數字/sharp 直角);品牌色只進各自區塊內容。
- **文案已定案**(Sean 回饋數輪、烘進 v4)→ 逐字直搬,不重寫、不自編(R6 無虞)。

---

## 3. 要 Sean 拍板的決策(寫 code 前)

> **Sean 2026-07-08 已拍**:①**兩條線(B 品牌形象區 + A 效能 P4)都要做、順序 Claude 安排**(建議 B 先)。②**D5=B**:logo 放**圖片**(非文字 label)→ logo 檔複製進 `public/brands/*` + 授權=確定上線 gate。③**D2 影片放法 + 整體版面 UX 交 Claude 研究**,硬約束:手機/桌機都**不可攏長**、要能**快速下單**、視覺**好看順滑**、**不可讓客人要看的資訊被太多品牌介紹壓到下面要一直滑**。→ 研究結論見 §8,並先出 Artifact 給 Sean 肉眼驗視覺再落地。
>
> **Sean 2026-07-08 追加拍板(看過壓縮版 Artifact 後,🔴 推翻「RPM byte 不變」)**:
> - ④ **一致性 = B**:三家品牌(RPM/GB/Bonamici)頁面結構**統一**;品牌介紹區**全部搬到規格分頁之下**(讓客人先確認相容/規格)——**含 RPM**。∴ **RPM 的 ProductHighlights/SwatchWall/Spotlight 要從 `@301-302`(規格 tabs 之上)搬到 `ProductTabs @306` 之後**,RPM 的測試鎖(`ProductPage.test.tsx:184-195` 若含 DOM 順序斷言)一併改。**RPM byte 不變的鐵律於此片解除**(Sean 明示授權「要就全部一致」);但 showcase **內容不變**、只是位置搬移 + 三家對齊。
> - ⑤ **上方購買區(圖/標題/價格/加入購物車/選項)不動**(Sean Q2 確認):那是全品牌共用 `ProductInfo`/`pd-main`,本 plan 零觸碰。
> - **🆕 開放待答(recon 已回,附事實)**:
>   - **(a) 規格/安裝/保固 呈現方式**:現用橫向 tabs(`ProductTabs.tsx:85-90`,4 tab)。✅ **SEO 查證:4 個 tab 內容全部常駐 DOM、SSR 出、只用 `hidden` 切換(非條件渲染)→ Google/GEO 抓得到**(但 hidden 內容權重略低)。✅ **相容車型已常駐可見**:獨立 `ProductFitments`(`ProductPage.tsx:293`)在 tabs 上方顯示完整車型明細,規格 tab 內只放摘要 + xref(`ProductTabs.tsx:263-276`)——Sean「快速看到相容」已達成。改法成本:**改「長頁全展開」最省工**(內容已全在 DOM,只拿掉 `.pd-tabs` 列 + 移除 `hidden`,內容邏輯 isRpmCarbon/buildSpecRows 不動);改 accordion 最貴(ARIA/state/測試重寫)。`ProductTabs.tsx` 356 行 + `.test.tsx` 299 行(鎖 tab role/aria/鍵盤/RPM 分支)。→ **待 Sean 選 A 長頁 / B 維持 tabs / C accordion**。
>   - **(b) ProductFitments 手機排版 bug 根因已找到**:`.pd-fit-row` 手機斷點設 `540px`,但全站其他區塊是 `720/1079px`(`product-page.css:628-655`)→ 541-720px 寬(橫拿手機/大 Android)仍用桌機兩欄(132px 固定車型名欄 + 年份),車型名長短不一造成 pill 忽同行忽換行。修=斷點對齊全站 720/1079 + 窄寬 `align-items:baseline`→`start`。全品牌共用、無 isRpmCarbon、低風險小改。`ProductFitments.tsx` + `.test.tsx` 120 行。

- **D1 圖片資產策略**:A(推薦)= **先用佔位圖把結構+文案做起來、標清楚每個圖槽要什麼**,你之後換真授權圖(解鎖工程、不卡在等圖);B = 等你把所有真圖備齊才開工。
- **D2 Bonamici 影片**:A(推薦)= 縮圖 + 點擊外連 YouTube(或 click-to-load facade,免 CSP/免拖慢);B = 站內真嵌 YouTube 播放器(要設 CSP/next 白名單、多一份設定 + 審查)。
- **D3 文案落地方式**:A(推薦)= **每品牌一元件、文案 hardcode**(對齊 RPM `ProductHighlights` prop-less;品牌故事=L1 年 0-1 變、鐵則 9 合規)。⚠️ 但 N°02 的**信任狀數字列 / 20 年徽章 / 冠軍認證**這類**會隨年度更新的數字/年資**較接近 L2——依鐵則 9「頻率拿不準預設更保守」,這幾項 hardcode + 加 `TODO` + backlog 追未來後台化(不是全判 L1);B = 全 data-driven(過度工程、資料源也沒這些欄)。
- **D4 上線節奏**:A = GB + Bonamici **兩家一起上**;B(對齊舊拍板 Q5=B「逐品牌到位才上線」)= 先 GB、再 Bonamici,各自到位各自上。**推薦 B 的拆法做、但可累積到兩家都好再一起請你驗上線**。
- **D5 ✅ 已拍=B**(N°01 eyebrow 放品牌 **logo 圖片**,用 `pd-eb-logo`):logo 檔須複製進 `public/brands/{gb-racing,bonamici}/` + 確認授權=上線 gate(§7)。工程先用佔位 logo 把版型做起來,Sean 提供真檔後替換。
- **D6 🆕 品牌色變數命名**(審查抓:草稿實際用 5 個 `--gb-*`/`--bona-*` 名):A(推薦)= **沿用草稿變數名**(含兩個 `-deep`,原封收進 tokens.css,免改 CSS 引用);B = 全改 `--c-*` 前綴 + 同步替換所有 `var()`(較一致但多改動、易漏)。

---

## 4. Slice 拆分(定案 v0.3;鐵則 4/5:每片可肉眼驗;🔴 RPM byte 不再零變 —— Sean 拍 A+B 授權 RPM 一起改)

> 施工序:先小而低風險(Fitments)→ 規格區改版(全品牌含 RPM)→ dispatcher + 品牌介紹統一搬到規格下方(全品牌含 RPM)→ 兩家形象區。每片獨立三綠 + code-reviewer;動到 RPM 呈現的片都請 Sean 肉眼驗。

- **Slice 1 — ProductFitments 手機車款排版修齊(全品牌、低風險純 CSS)**
  `.pd-fit-row`(`product-page.css:628-655`)斷點策略明確化(codex nit):**`≤720px` 單欄堆疊(車型名 + 年份 pill 上下對齊)/ `721-1079px` 保留兩欄但 `align-items:baseline`→`start`**(避免長車型名折行造成 pill 視覺掉行);不是只把 540→720 一個數字。`ProductFitments.tsx` 不動(純 CSS);`.test.tsx` 若鎖版型微調。**驗收**:三綠 + Sean 手機肉眼驗 **720/768/1024 三寬**(截圖「忽上忽下」消失)。
- **Slice 2 — 規格區 tabs → 長頁全展開 + 跳轉 nav(🔴 全品牌含 RPM、Sean 拍 A、SEO)**
  `ProductTabs`:拿掉 `.pd-tabs` 分頁列 + 四 pane 移除 `hidden={...}` → 四段(商品介紹/規格·相容性/安裝須知/保固退換)全顯示 + sticky「跳到」錨點列(Baymard TOC 7% 漏看)。**內容產生邏輯不動**(`isRpmCarbon`/`buildSpecRows`/`renderPolicyRuns` 照舊)。🔴 **codex must-fix 折入**:
  - **ARIA 重建**:四 pane 從 `role=tabpanel`+`aria-labelledby="pd-tab-*"`(移除 tab 鈕後會變 dangling id)改成語意 `<section>` + **新 heading id**(如 `pd-sec-description-title`),`aria-labelledby` 指向存在 heading;錨點列 `href` 指向 section id;測試斷言每個 anchor target 存在且 labelled。
  - **保留 client + 安裝 CTA**:明列 `ProductTabs` **維持 `'use client'`** + 安裝 CTA `router.push('/install')`(`:95,:322-325`)不得因改長頁弄丟(或改 `<Link href="/install">`);`ProductTabs.test.tsx` 保留「點安裝 → /install」斷言。
  - 重寫 `ProductTabs.test.tsx`:tablist/tab/鍵盤導覽斷言 → section/heading/「四段皆可見」+ 錨點跳轉 + CTA;RPM vs 非 RPM 內容分支斷言保留。**驗收**:三綠 + 完整 vitest + **Sean 肉眼驗(RPM 也變長頁)** + curl 驗四段文字都在 HTML。
- **Slice 3 — 共用地基 + 品牌介紹統一搬到規格下方(🔴 動 RPM 位置、Sean 拍 B)**
  ①`tokens.css` 加 5 品牌色(D6:`--gb-red/-deep/--gb-navy/--bona-bronze/-deep`,不動 `--c-gold`)+ 剝草稿撞名核心 token 與深色規則(§1.3)。②建 `public/brands/{gb-racing,bonamici}/` 佔位圖。③🔴 **建 `BrandShowcase` dispatcher 收完整 `product: MockProduct`(codex must-fix:非只 `brandSlug`)**——因 `ProductSpotlight` 需完整 `product` + `hasSpotlight && brandSlug==='rpm-carbon'` 雙守門(`ProductSpotlight.tsx:28-32`),只傳 slug 會壞/不編譯;registry `slug→元件`:`rpm-carbon`→`<ProductHighlights/>+<ProductSwatchWall/>+<ProductSpotlight product={product}/>`、其餘品牌→各自 Showcase;未知 slug/undefined → render null(避 ProductPage O(n) 破 400)。④🔴 **reorder**:品牌介紹整組**從規格上方(`@301-303`)移到 `ProductTabs`(`@306`)之後**——RPM 三件跟著搬,全品牌統一在規格下方(決策 B)。該處改一行 `<BrandShowcase product={product} />`。⑤🔴 **改 `ProductPage.test.tsx` 補 DOM 順序斷言(codex must-fix,非只存在性)**:`ProductTabs < showcase(N°01/N°02) < .pd-related(N°03) < FAQ(N°04)`;RPM/GB/Bonamici 各至少一條;**related 為空時亦驗 showcase 在 FAQ 之前**;RPM `hasSpotlight=true` reorder 後仍渲染、非 RPM `hasSpotlight=true` 仍不渲染。GB/Bonamici registry 此片先 render null。**驗收**:三綠 + 完整 vitest + **Sean 肉眼驗 RPM 頁(品牌介紹在規格下面、內容一字不變)**。
- **Slice 4 — GbRacingShowcase(壓縮版 §8)+ 註冊**
  逐字搬草稿文案 + `.gb-*` class:N°01 三卡 + N°02(冠軍橫幅 + 信任狀四格 + 產品線矩陣**手機水平捲 peek**);eyebrow 用 `pd-eb-logo` 佔位 logo(D5=B)。註冊 `gb-racing→GbRacingShowcase`。補 `GbRacingShowcase.test.tsx`。🔴 **codex must-fix(鐵則 9 L2)**:信任狀數字(2007/2009/2 專利/450+ 車型)、冠軍認證年份等**年度會變的數字型內容** = L2,hardcode 處加 `// TODO L2` + **記 backlog 編號**(痛點:數字過時要改 code 重發版、無後台可改)、**commit/STATUS 記編號、不只寫 plan**。**驗收**:三綠 + 完整 vitest + Sean 肉眼驗 GB(桌機+手機+長度)。
- **Slice 5 — BonamiciShowcase(壓縮版 §8)+ 註冊**
  N°01 三卡 + N°02(影片 facade `'use client'` + 研發/職人兩段 + 8 色陽極緊湊 + 20 年徽章)+ `.bona-*` class;facade CSP 加 `frame-src www.youtube-nocookie.com`+`img-src i.ytimg.com`(§8.3-4)。註冊 `bonamici→BonamiciShowcase`。補 test。🔴 **codex must-fix(鐵則 9 L2)**:20 年徽章 + 其他數字型內容同 Slice 4 = L2,`// TODO L2` + 記 backlog + commit/STATUS 記編號。**驗收**:三綠 + 完整 vitest + Sean 肉眼驗 Bonamici。
- **(上線前 gate,非 slice)** Sean 換真 logo/棚拍圖/影片 + 確認授權 → 才 merge main 上線。

> 每片動前台補/更新 `*.test.tsx`;動 L1 hardcode 品牌內容(非 DB),零 migration、零 DB 寫入、金流 flag 全 false。Slice 2/3 動 RPM 呈現 → 各自 Sean 肉眼驗把關。

---

## 5. 影響面 / Blast radius(v0.3,範圍因 Sean 拍 A+B 擴大到 3 個共用元件)
- 會動:`ProductPage.tsx`(reorder showcase 到規格下 + 一行 dispatcher)、`ProductTabs.tsx`(tabs→長頁,共用全品牌)、`product-page.css`(fitment 斷點 + tabs→長頁 + showcase 樣式)、新增 `BrandShowcase.tsx`+`GbRacingShowcase.tsx`+`BonamiciShowcase.tsx`、`tokens.css`(品牌色)、`ProductPage.test.tsx`+`ProductTabs.test.tsx`(重寫)+`ProductFitments.test.tsx`(微調)+ 3 新測檔、`public/brands/*`。**跨多檔 + 動 3 個共用元件(ProductTabs/ProductFitments/ProductPage)= 鐵則 8。**
- 🔴 **RPM 會變(Sean 拍 A+B 授權)**:①規格區變長頁(Slice 2)②品牌介紹從規格上方搬到下方(Slice 3)。**但 RPM 品牌介紹「內容」一字不變**(Highlights/SwatchWall/Spotlight render 不改、只搬位置);碳纖/去碳分支不動。RPM 測試改的是「順序 / 呈現型態」非內容。
- 上方購買區(`ProductInfo`/`pd-main`:圖/標題/價格/選項/加入購物車)**零觸碰**(Sean Q2)。
- 不動:金流、經銷價、資料層/DB、首頁、/products 篩選。
- `ProductPage.tsx` 390 行:reorder 為移動非新增(不增行)+ dispatcher 一行 → 仍守 <400(鐵則 6)。

## 6. Rollback
- 每片純加法(新元件 + 並列條件),revert 該 commit 即回;RPM 分支不受影響(物理獨立)。
- 無 schema/migration/資料遷移;flag 全 false。上線前 gate 由 Sean 手動 merge 把關。

## 7. 開放項(承 handoff §7,Sean 領域,不擋寫 code)
- GB 車架防倒球/拉桿護弓 → 乾淨白底棚拍;官網抓圖版權確認;Bonamici 影片封面/選片。
- **品牌 logo 資產**(D5=B 已拍 → 確定 gate):GB/Bonamici logo 複製進 `public/brands/*`(submodule 的 `design-reference/assets/brand-logos/{gb-racing.png,bonamici.webp}` 可當來源候選)+ 確認授權。工程可先用佔位。
- 這些是**上線 gate**;工程可用佔位圖先把結構+文案做好等你換。

---

## 8. 版面 UX 研究結論(2026-07-08,Sean 交辦「不攏長 / 不擋下單 / 影片放法」;3 路平行研究)

研究方法:repo 版面順序 + PDP UX 最佳實務(Baymard / NN·g,實測數據)+ 影片嵌入(Google Lighthouse 官方)。

**8.1 好消息:買的動作不會被擋。** 圖庫/標題/價格/變體選擇器/加入購物車/立即購買全在頁面最上方 `pd-main`(`ProductInfo.tsx:245-363`)、在形象區之上;手機另有 `position:fixed` 貼底購買列(`ProductPage.tsx:347-384`)全程可見。**客人不需滑過形象區就能下單。**

**8.2 真正問題(Sean 直覺對):形象區太長 + 會壓掉規格資訊。** 草稿 N°02 實測估:GB ≈手機 6-7 屏、Bonamici ≈6.5-7.5 屏(遠大於 RPM SwatchWall 的 10 縮圖);而 `ProductTabs`(規格/相容性/安裝/保固=零件購買決策關鍵)排在形象區**之下**(`@306`),手機要多滑 6-8 屏才看到。對「要先確認裝不裝得上」的 GB 引擎護蓋 / Bonamici CNC 件,傷轉換。

**8.3 解法(權威實測背書、落地進 Slice):**
1. 🔴 **形象區搬到規格 Tabs 之下**:非 RPM 的 `BrandShowcase` mount 點放 `ProductTabs`(`@306`)**之後**(RPM 維持原 `@301-302` 不動),讓「規格/安裝/相容」在品牌行銷牆之上。(NN·g:品牌故事非 must-have;Baymard DTC:完整品牌故事最佳做法是獨立頁 + 商品頁只留摘要。)
2. 🔴 **N°02 壓縮到「一屏內掃得完」**:大圖 card 列改**手機水平捲 + 露出下一張邊緣(peek)**(非整頁垂直堆疊、非只放圓點=NN·g carousel);陽極 8 色/信任狀改緊湊 grid;長段文字改 bullet(Baymard highlights)。目標 6-7 屏 → 2-3 屏。
3. 🔴 **不用水平 Tabs 藏購買關鍵內容**(Baymard 實測 27% 漏看→放棄);次要敘述可垂直 accordion(漏看率降 8%),但相容/年份不預設收合。
4. **影片=facade**:縮圖+假 play 鍵、**點了才載真 iframe**(Google Lighthouse 官方標準解、省 500KB+);`aspect-ratio:16/9` 框零 CLS;**不自動播放**;CSP 加 `frame-src www.youtube-nocookie.com` + `img-src i.ytimg.com`;手機 play 熱區 ≥44px。→ **BonamiciShowcase 因 facade onClick 須 `'use client'`**(呼應 Slice 3)。

**8.4 誠實邊界**:無權威來源給「每區塊幾 px」硬數字(只給質化原則:bullet 壓高、accordion 收次要、大圖不推走 CTA);屏數=結構推估非渲染量測。**最終視覺 Sean 肉眼驗——先出壓縮版 Artifact 給 Sean 看順不順再落地。**

來源:Baymard(PDP-UX-2026 / avoid-horizontal-tabs / dtc-storytelling / mobile-subpages)、NN·g(ecommerce-product-pages / mobile-carousels)、Google Lighthouse(third-party-facades)、growthrock(sticky-ATC A/B +5.2% 手機訂單)。
