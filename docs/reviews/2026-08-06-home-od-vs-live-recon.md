# 首頁:OD 設計稿 vs 真站現況 — 逐區塊差異清單(唯讀偵察)

> 2026-08-06 開立。真權威 = OD `pcm-home-redesign` 專案根目錄 `direction-b-layout-01-graphite-ember.html`
> + `README.md`(依 `docs/specs/2026-08-03-storefront-home-brand-page-wire-plan.md` 檔頭指定)。
> 真站 = `apps/storefront/src/app/page.tsx` 與其 import 的元件 + `src/styles/home.css`。
> `design-reference/components/HomePage.jsx` 全程未引用(鐵則 1 例外、已知過期假稿)。

## 逐區塊表(依 OD 定案順序)

| OD 區塊 | OD 稿怎樣 | 真站現況 | 判定 | 施工量級 |
|---|---|---|---|---|
| N°01 Hero | `direction-b-layout-01-graphite-ember.html:771-836` `<section class="b-hero">`:四張輪播照片(`hero-0N.jpg`)、`.b-hero-tick` 切換條、眉標「PCM MOTOR PARTS ‧ 重機零件與改裝精品」、標題「改裝不只是升級配件，更是展現風格與態度的延伸」;README.md:180-242 全套換圖/壓暗/安全區規格 | `HomeHero.tsx:9-46`:單張 Unsplash 庫存圖(`images.unsplash.com/photo-1558981806…`)、無輪播、無切換條;文案「Made for those who ride differently.」/「2026 SPRING EDITORIAL」(對齊舊 `design-reference` 字面);CSS class 全是 `.ed-hero-*`,`home.css` 內 `.b-hero`/`.b-dock` 命中數 = 0 | **未搬** | 一批(D6,含資產產線) |
| N°01 選車器 dock | 同一節 HTML,`b-dock` **巢狀在 `.b-hero` 內**(`:816-836`),疊在 hero 圖片下緣、視覺上是「插在照片裡的白卡」 | `VehicleFinder.tsx:52` 是**獨立 `<section id="vehicle-finder" className="ed-finder">`**,接在 `<HomeHero />` 之後(`page.tsx:149-150`),不是疊在 hero 圖片上、是 hero 結束後的下一段白底區塊 | **未搬**(位置差,Sean 指名項) | 標準片(牽動 hero 重寫,建議與 N°01 併批) |
| N°02 最新商品 | `direction-b…:217-271` 描述為「橫捲 carousel,5 格,像 WRS」;README.md:173 拍板「標題依愛車狀態換字,條件=已登入且已設定愛車」 | `HomeSelect.tsx:81` 是**靜態 grid**(`.ed-select-grid`,桌機 4 欄/平板 2 欄/手機 1 欄,`home.css:665-674`),4 張 `ProductCard`、無橫捲;標題**恆為**「New Arrivals · 最新商品」(`HomeSelect.tsx:47`,M-4a 業務 override 註記為「授權覆蓋、勿調回」),未依愛車狀態換字 | **部分搬**(資料真實化已做;版面/條件換字未搬,且已被業務拍板凍結) | 輕量片(換字條件已被 Sean 拍板取消,若要照抄稿需重新拍板) |
| N°03 部品分類 | `direction-b…:924-991` `.b-cats`:**11 格 icon chip**(SVG 線圖示,無照片)+ 第 12 格「全部分類」,`.b-cat-list` | `CategoryGrid.tsx:38-68`:**8 格圖卡**(`.ed-cat-grid`,Unsplash 裝飾圖 `DECOR_IMAGES`,無「全部分類」第 12 格、以標題旁 `ed-link` 取代) | **未搬**(這正是已知殘片 D5c,Sean 已拍板 Q1=A/Q2=A 照抄稿) | 標準片(已有拍板、待排片) |
| N°04 服務宣言 | `direction-b…:995-1029` `.b-statement` 石墨底,三欄事實含「17 家品牌正式代理」字樣 | `HomeStatement.tsx:19-71`:結構(石墨底、三欄、CTA)已對齊,**位置已對(D5a 上移到 N°04)**;文案依 Sean 08-05 拍板刻意**不報數**(business_override,見 `docs/design-storefront-manifest.yaml`) | **已對齊**(結構+位置;文案是刻意偏離、非未搬) | — |
| N°05 本月聚焦 | `direction-b…:1030-1057` `.b-feature`,20 家資料驅動、每 3 天輪播、三則事實三欄位皆用 | `FeatureEditorial.tsx:49-123`:已改資料驅動(`BRAND_CONTENT`+`BRAND_FOCUS`)、位置已對(D5a 下移到 N°05)、CTA 已指向 `/brands/<slug>`(D5e-2b) | **已對齊** | — |
| N°06 授權代理/品牌牆 | `direction-b…:1059-1069` `.b-brands`:**20 家 logo 磚牆**(grid,由 `brand-content-data.js` 產生,`id="brand-wall"`),純視覺 logo+編號+國別+CTA,連結走品牌介紹頁 | `BrandIndex.tsx:47-104`:**純文字清單**(`.ed-brand-list`),吃 **`MOCK_BRANDS`(17 家靜態)**、非 `BRAND_CONTENT`(20 家);連結走 legacy `?brand=` 非 `?pbrand=`;CSS 是 `.ed-brands`,`home.css` 內 `.b-brands` 命中數 = 0 | **未搬**(已知殘片 D5f,`FeatureEditorial.tsx:13-16` 自己註記「不是本片漏掉、是 D5f 磚牆片的範圍」) | 標準片以上(20 家 logo 資產+grid+availableSlugs 灰階邏輯已在 BrandIndex 現行版做了一半) |
| 頁尾 | `direction-b…:1072-1098` 石墨底、`pcm-stacked-*-on-dark` logo、版權年份動態 | `HomeFooter.tsx` — commit 記錄標「✅ 已完成 2026-08-05(0b)」(wire-plan §4 D7 列) | **已對齊** | — |
| 品牌總覽 `/brands`、品牌介紹 `/brands/[slug]` | `brand-directory.html` 20 家磚牆+深色 logo 牆 hero;`brand-page.html` 20 家共用版型 | `apps/storefront/src/app/brands/page.tsx`、`/brands/[slug]/page.tsx` 已存在(route 落地,D3a/D3c-3) | **已落地**(本次未逐欄核對版型保真度,超出本輪偵察範圍) | — |
| 15 支 `*Showcase.tsx`(D8 退場) | 明確排除項(D5 計畫 D8:退場) | `find …/components -iname "*Showcase*"` 實測 **28 個檔案**(14 支 `.tsx` + 14 支 `.test.tsx`:Akrapovic/CncRacing/EaziGrip/EbcBrakes/Evotech/ExtremeComponents/Front3d/GbRacing/Kspeed/Lightech/Materya/Motogadget/Samco/Bonamici)全部仍在、未刪 | **未搬**(D8 未執行) | 一批(需先確認 dev-preview 引用已改完才能刪) |

## Sean 點名四項逐一回答

1. **Hero 大圖**:稿=四張 PCM 實拍照輪播(`hero-0N.jpg`/`hero-0N-m.jpg`,`README.md:212-217`)、眉標「PCM MOTOR PARTS ‧ 重機零件與改裝精品」、標題「改裝不只是升級配件…」。現況=`HomeHero.tsx:14` 單張 Unsplash 庫存圖網址、標題「Made for those who ride differently.」——**兩邊圖與文案完全不同**,現況是舊版 stock photo hero,稿的四張輪播從未搬上線。判定=**未搬**。
2. **選車列位置與形態**:稿=選車 dock **疊在 hero 照片下緣**、白卡覆蓋在圖片上(`b-dock` 巢狀於 `b-hero` 內)。現況=選車器是 hero **結束後的獨立區塊**(`VehicleFinder.tsx` 自己一個 `<section>`,`page.tsx:150` 排在 `<HomeHero />` 之後),兩者是上下相接不是重疊。**形態上也不同**:稿是三欄下拉 select bar + 右側大按鈕(`ed-finder-bar` grid 三欄+GO);現況雖然 class 名也叫 `ed-finder-bar` 但內部走的是自製 `VehicleSelect` combobox + `GarageChips`(V-1c 之後的功能升級,稿沒有這層)。判定=**位置未搬(稿在圖裡、站在圖外)**;內部互動邏輯站上更進階、非退步。
3. **分類區**:稿=11 格 SVG icon chip(無照片)+ 第 12 格「全部分類」。現況=8 格 Unsplash 裝飾圖卡、無第 12 格(改用標題列旁的文字連結)。判定=**未搬**,且此項已是 Sean 08-06 已拍板的已知殘片(D5c)。
4. **品牌區**:稿=20 家 logo 磚牆(視覺化、grid)。現況=17 家純文字清單(`MOCK_BRANDS`,舊資料源),未讀 `BRAND_CONTENT` 20 家。判定=**未搬**,已知殘片(D5f)。

## 未搬總清單(依依賴關係排序)

1. **N°06 品牌磚牆重寫**(D5f)—— 換資料源 `MOCK_BRANDS`→`BRAND_CONTENT`、文字清單→20 家 logo grid、`?brand=`→`?pbrand=`。無上游依賴,可獨立開工。
2. **N°03 分類 icon chip 化**(D5c)—— 8 圖卡→11 icon chip+第 12 格,已有 Sean 拍板(Q1=A/Q2=A 照抄稿、分類數字全動態現算)。無上游依賴。
3. **N°01 Hero 重寫**(D6)—— 需要先跑 `build-hero-wall.py` 產出 8 張合成圖資產,再接 `next/image`+輪播+切換條;規格最厚(README.md:180-242 三個「非改不可」細節)。
4. **選車器 dock 化**(依附於 #3)—— 把 `VehicleFinder` 從獨立 section 改成疊在 hero 內的 dock,建議與 Hero 重寫同批(牽動同一塊 DOM/CSS layout),否則會拆成「先搬 hero 圖、選車器位置還沒動」的半套狀態。
5. **N°02 商品區橫捲化 + 條件換標題**(低優先)—— 版面差異(grid vs carousel)缺明確拍板依據(wire-plan §4 對這格只寫「改字面+條件標題」,未提版面);換標題功能已被 M-4a 業務拍板凍結為「New Arrivals」恆定,若要照抄稿需先問 Sean 是否推翻該拍板。
6. **D8 · 15(實測 14)支 `*Showcase.tsx` 退場** —— 與上述四項無直接依賴,但屬同一計畫項目、可另開一批清掉。

## 站與稿一致、但 Sean 覺得舊的區塊

**沒有找到這類項目。** 本輪四個被點名的區塊(hero、選車列、分類、品牌)逐一核對後,**全部是「稿有、站沒搬」**,不是「站已對齊稿、Sean 要的東西超出稿」。也就是說目前沒有需要退回 OD 重新出稿的訊號——OD 稿本身已經涵蓋 Sean 想要的樣子,缺的是接線工程,不是缺設計。

## 查不到 / 不確定的項目

- `/brands`、`/brands/[slug]` 兩個 route 的**版型保真度**(是否逐欄對齊 `brand-directory.html`/`brand-page.html`)本輪未核對,只確認 route 存在(`find` 命中 4 個檔案)。若 Sean 的「品牌都是舊的」也包含品牌介紹頁本身,需要另開一輪偵察。
- N°02 商品區「橫捲 5 格」是否為 Sean 要求的範圍、或只是 OD 稿的探索期產物未經拍板——wire-plan `2026-08-03-storefront-home-brand-page-wire-plan.md` §4 對這格的動作描述只寫「改字面+條件標題」,沒提版面,無法從既有文件判斷是否算「未搬」,已在上表標記低優先、需 Sean 確認。
- Hero 四張圖對應的實際圖檔資產(`assets/hero/slides/hero-0N.jpg` 等)是否已用 `build-hero-wall.py` 產出、放進 `apps/storefront/public/`——本輪未查 storefront 的 `public/` 或 `assets/` 目錄,只確認 `HomeHero.tsx` 程式碼裡完全沒有引用這批檔名。

---

**報告檔**:`/Users/sean_1/pcm-website-v2/docs/reviews/2026-08-06-home-od-vs-live-recon.md`
