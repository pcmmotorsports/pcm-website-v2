# 多品牌商品頁「範本化」設計草案

> **狀態**:🟢 方向已拍板(2026-06-04 Sean:Q1=C 各別客製 / Q2=A 內容報價單側出 / Q3=A 存檔)、**未實作**;N°02 各品牌特色區由 Sean 用 OpenDesign 各別刻製(本 doc 附 OD brief 當開頭)、刻完回來細修搬進 storefront。
> **產出者**:網站 repo 執行 session(2026-06-04、寫審分離 ROLE=A)。
> **用途**:① 給 Sean 過目拍板;② 反向定義「商品頁範本需要品牌提供哪些內容欄位」,交報價單 #209 PRD v2 品牌級內容設計當輸入(避免兩套系統)。
> **範圍**:`apps/storefront` 商品詳細頁(ProductPage 家族);不動報價單 B 庫 schema(那是報價單 session 的鐵則 8)。
> **關聯**:backlog #212(去 RPM 化、本 doc 細化其「品牌敘事」分流)、#209(報價單內容模型 PRD v2)、memory `project_storefront-content-model-design`、`tw-marketplace-copy-conventions`。

---

## 一句話問題

> 現在的商品頁是「RPM 專屬頁」:好幾個區塊把「RPM Carbon」「泰國原廠」「碳纖維紋路牆」**寫死在程式裡**。換 Lightech / Bonamici / Front 3D 上來,這些區塊會原封不動顯示「為什麼選 RPM Carbon」+ RPM 紋路牆,完全張冠李戴。要把商品頁做成「換品牌就換對內容、版面不跑掉」的**範本**。

---

## 現況盤點:商品頁三層(grounded,2026-06-04 讀真元件)

商品頁 `ProductPage.tsx` 由上到下組裝這些區塊。依「換品牌會不會壞」分三層:

### 層 1 — 通用功能(資料驅動、版型已範本化、換品牌不會壞版)

| 區塊 | 元件 | 狀態 |
|---|---|---|
| 麵包屑 / 車輛 pill | ProductPage 本體 | ✅ 吃 URL param + product,通用 |
| 圖片廊 | `ProductGallery` | ✅ 吃 `product` + `selectedVariant`,通用 |
| 變體選擇器 / 價格 / 加購 | `ProductInfo` | ⚠️ 版型通用,但**選項標籤寫死 RPM**(見下「功能性洞」) |
| 適用車款表 | `ProductFitments` | ✅ 吃 `product.fitments`、無資料返 null,通用 |
| 規格 / 安裝 / 保固分頁 | `ProductTabs` | ⚠️ 版型通用,但**規格表字面寫死 RPM**(見下) |
| 相關商品 | `ProductCard` map | ✅ 通用 |
| 手機購買列 / LINE CTA | buybar / `LineCtaButton` | ✅ 通用 |

**層 1 的兩個「功能性 RPM 洞」(屬 #212 去 RPM 化、非本 doc 主題,但要一起記):**
- [ProductInfo.tsx:55](../../apps/storefront/src/components/ProductInfo.tsx#L55) — `DIM_LABEL = { pattern: '紋路', finish: '表面' }`。換 Brembo 卡鉗應是「顏色 / 尺寸」,Lightech 可能是「款式 / 顏色」。維度標籤寫死。
- `ProductTabs.tsx` 規格 pane = 靜態 JSX 字面(「真碳纖維 / 泰國 / 紋路」)。換品牌會掛錯規格。
- → 這兩個是 **#212「功能性去 RPM 化」**:選擇器 key / 規格表改成 data-driven(schema-less key/value + 中文標籤 + 空兜底)。**綁報價單 PRD v2 pipeline 落地**,不在本 doc 解。

### 層 2 — N°01 品牌介紹(同版型、不同內容,範本化「好辦」)

[ProductHighlights.tsx](../../apps/storefront/src/components/ProductHighlights.tsx) =「為什麼選 RPM Carbon」:
- 結構 = eyebrow(編號 01 + 金線 + **品牌標記 .pd-eb-label**)+ h2 標題 + lead 段 + **3 張特色卡**(標題 + 描述)。
- 目前 **prop-less、RPM 內容寫死**(`為什麼選 RPM Carbon` / 來自泰國 / 可直上原廠…)。
- 🔴 Sean 揭示:**每個品牌都有「品牌介紹」、版型一樣、只是內容 + logo 換**。Lightech 換成 Lightech 介紹、Bonamici 換 Bonamici 介紹。
- → **範本化好辦**:版型不動,把「品牌名 / lead / 3 卡 / logo」變成讀品牌資料的欄位。一份版型吃不同品牌的內容。

附帶同類:[ProductServices.tsx:34](../../apps/storefront/src/components/ProductServices.tsx#L34) 服務橫條第 3 卡寫死「泰國原廠 / RPM Carbon 授權代理」。換品牌要換「原廠地 / 代理品牌」。同 N°01 一起資料驅動。

### 層 3 — N°02 品牌特色(不同品牌不同主題 + 不同版型,範本化「難點」)

[ProductSwatchWall.tsx](../../apps/storefront/src/components/ProductSwatchWall.tsx) =「紋路 × 表面」紋路樣式牆:
- 結構 = eyebrow 02 + h2 + lead +「亮光款 6 卡 / 消光款 4 卡」圖牆 + 挑選提醒 + **lightbox 放大**。
- 10 張樣品圖 from `@/data/rpm-swatches`,prop-less RPM-only。
- 🔴 Sean 揭示:**這一區每個品牌主題完全不同、連版型都不同**:
  - **RPM** = 紋路 × 表面樣品牆(圖牆 + lightbox)。
  - **Lightech** = 產線介紹(不同產品線的東西)。
  - **Bonamici** = 同 Lightech、產線介紹。
  - **Front 3D** = 不同產品 / 或單純 3D 列印材質介紹。
- → **這是真正的難點**:不能像 N°01 那樣「同版型換內容」,因為 RPM 是圖牆、Lightech 是產線、Front 3D 是材質——**主題與版型都不一樣**。

---

## 關鍵釐清:有「兩種去 RPM 化」、別混為一談

| | 功能性去 RPM 化 | 品牌敘事去 RPM 化(本 doc) |
|---|---|---|
| 對象 | 變體選擇器 key、DIM_LABEL、規格表 | N°01 品牌介紹、N°02 品牌特色、服務橫條代理欄 |
| 性質 | 商品**資料**的標籤(維度名、規格列) | 品牌**敘事內容**(介紹文、特色圖文) |
| 換品牌壞法 | 標籤張冠李戴(碳纖紋路掛到卡鉗) | 整段內容錯品牌(Lightech 頁顯 RPM 紋路牆) |
| 來源 | 報價單商品級 view 新欄(#212 五斷點) | **品牌級**內容(brand 表 / brand_story) |
| 進度歸屬 | backlog #212,綁報價單 pipeline P1/P5 | 本 doc,綁報價單 #209 PRD v2 **品牌級**內容 |

兩條都最終要報價單側出資料,但**一個是商品級、一個是品牌級**,設計與 schema 不同,分開走。

---

## 層 3 N°02 的三個方向(Sean 2026-06-04 拍 → 方向 3 各別客製)

> ✅ **拍板 = 方向 3**:RPM 紋路牆保留不動,其他品牌(Lightech / Bonamici / Front 3D)由 Sean 用 OpenDesign **各別刻製**特色區,前台 `product.brand` 條件渲染。我們把「基本模板 + 注意事項」給 OD 當開頭(見下「OD 刻製 brief」),刻完回來細修搬進 storefront。方向 3 起步,日後若爆量可再抽象成方向 1。
>
> 共同前提:版型差異大,沒有「一個版型吃所有品牌」的免費午餐。差別在「彈性 vs 工」怎麼取捨。

### 方向 1 — 彈性內容積木(CMS blocks)
品牌特色區改成「可組裝的積木清單」:圖牆積木 / 圖文左右積木 / 三卡積木 / 純圖積木…。每品牌在後台挑積木 + 填內容,前台照清單渲染。
- ✅ 最彈性,RPM 圖牆 / Lightech 產線 / Front 3D 材質都能用積木拼出來,日後新品牌不用改 code。
- ✅ 紋路牆 lightbox 互動可保留(包成「圖牆積木」)。
- ❌ 工最大:要設計積木型別 + 後台編輯器 + 前台 renderer + schema(品牌級內容模型)。是「迷你 CMS」。
- 適合:品牌數會長很多、Sean 想自己後台改不找工程師。

### 方向 2 — 統一品牌特色圖文區(一個版型、犧牲紋路牆互動)
把 N°02 降級成「通用品牌特色圖文區」:固定版型(標題 + lead + N 張圖文卡),所有品牌都套這個。RPM 紋路牆從「互動圖牆 + lightbox」降成「幾張代表圖 + 說明」。
- ✅ 工最小,一個版型吃全部,範本化最快。
- ✅ schema 最簡單(標題 + 圖文卡陣列)。
- ❌ **犧牲 RPM 紋路牆的 lightbox 互動 + 10 款細分**——那是現在 RPM 頁的賣點之一。
- 適合:Sean 覺得紋路牆互動沒那麼重要、要速度優先。

### 方向 3 — RPM 紋路牆保留、其他品牌各別客製
RPM 紋路牆當「RPM 專屬區塊」保留(現況不動);Lightech / Bonamici / Front 3D 各自寫**各別的特色區塊元件**,按品牌條件渲染(`product.brand === 'rpm' ? <SwatchWall/> : <LightechLines/>`…)。
- ✅ 每品牌視覺都能做到最貼合、RPM 互動零損失。
- ✅ 起步工中等(先做 RPM 保留 + 1 個新品牌)。
- ❌ 每加一家就多一個寫死元件 + 一條品牌判斷,長期回到「半寫死」,擴充性差(三視角:擴充性痛點)。
- 適合:品牌數少(<5)、每家都想精雕、近期不會爆量。

> **我的判讀**:若品牌數中期會到 5–8 家、且 Sean 想自己後台改 → **方向 1**;若先求快上線、紋路牆可妥協 → **方向 2**;若就 RPM + 2~3 家精雕、近期不爆 → **方向 3**。方向 1 與 3 可混(先 3 起步、之後抽象成 1),但別一開始就賭最大的 1。

---

## 品牌級內容來源:必須對齊報價單 #209 PRD v2(別做兩套)

N°01 品牌介紹 + N°02 品牌特色 + 服務橫條代理欄,本質都是**品牌級內容**(每品牌一份、跨該品牌所有商品共用)。這跟報價單 PRD v2 的「品牌級 brand_story」是同一份東西,**不該網站自己再 hardcode 一份**。

本 doc 反向列出「商品頁範本需要品牌提供的欄位」,當報價單側品牌級內容設計的輸入:

| 範本欄位 | 用途 | N° 區塊 |
|---|---|---|
| `brand_name_zh` / `brand_logo` | eyebrow 品牌標記 + logo | N°01 |
| `brand_intro_lead` | 品牌介紹 lead 段 | N°01 |
| `brand_feature_cards[]`(標題 + 描述) | 3 張特色卡 | N°01 |
| `brand_origin`(原廠地)/ `agent_label`(代理身分) | 服務橫條第 3 卡 | 服務橫條 |
| `brand_showcase`(型別 + 內容,依方向 1/2/3 形態不同) | 品牌特色區 | N°02 |

> ⚠️ **車種鐵律不受影響**:以上全是品牌級敘事,不碰車款;車款一律走 `fitment_parsed` 直出(memory `project_storefront-content-model-design`)。

---

## OD 刻製 brief — N°02 品牌特色區「基本模板 + 注意事項」

> 給 OpenDesign 當開頭。每個非 RPM 品牌(Lightech / Bonamici / Front 3D…)各刻一份,套同一份基本模板框架、內容區各自發揮。**RPM 紋路牆現況保留不動、不需重刻。**

### 任務
為 **〔品牌名〕** 刻製商品頁 N°02「品牌特色區」(全寬 section)。位置 = 商品頁中段、緊接 N°01 品牌介紹之後、規格分頁之前。

### 基本模板(固定框架、各品牌共用、確保跟整頁同調、勿改)
```
section.pd-section            上下留白 52px、底部 1px 細線(#e4e4e7)
└ div.pd-section-head         max-width 760px、下方留白 28px
  ├ div.pd-eyebrow            章節頭(flex、baseline 對齊)
  │  ├ span.pd-eb-no          大義體斜體數字「02」(Antonio、38–64px、近黑 #0a0a0a)
  │  ├ span.pd-eb-sep         金線小橫槓(#a98a4a、寬 36 × 高 2px)
  │  └ span.pd-eb-label       mono 大寫小標,如「N°  產線總覽」(JetBrains Mono、字距寬)
  ├ h2.pd-h2                  大標(26–36px、粗、字距收緊)
  └ p.pd-lead                 引文(16.5–19px、灰 #52525b)
└ 〔內容區〕                   ← 各品牌自由發揮(RPM=紋路牆 / Lightech=產線 / Front 3D=材質),但沿用下方 token + 風格
```

### 設計系統 token(務必沿用)
- **顏色**:底 `#fafafa`、卡面 `#ffffff`、次面 `#f4f4f5`、細線 `#e4e4e7`、主文 `#0a0a0a`、次文 `#52525b`、弱文 `#a1a1aa`、點綴金 `#a98a4a`。
- **字體**:大數字 / display = Antonio(義體斜體);內文 = Inter + Noto Sans TC;標籤 / 小字 = JetBrains Mono。
- **風格 = sharp**:銳利為主(少圓角)、細線分隔、大量留白、章節頭用「義體大數字 + 金線 + mono 標籤」。半形標點。

### RWD 注意
- 全寬 section、桌機 + 手機都要好看。斷點:720px(小手機,section 留白縮 36px、數字縮小)、1079px(平板以下)。
- 🔴 手機商品頁**底部有固定購買列**(立即購買 / 加入購物車,約 66px 高)+ 右下角 LINE 圓鈕 → 內容底部留空間、別被擋住。

### 互動參考
- RPM 紋路牆有「點圖放大 lightbox」可複用;新品牌若有圖牆同理(輸出標出哪些圖要可放大)。

### 🔴 注意事項(PCM 鐵則,刻之前先讀)
1. **車種鐵律**:這區是品牌敘事,**完全不准出現任何車款 / 年式 / 車型字串**(車款只在「適用車款表」)。
2. **內容來源**:你刻的是**版型 + 視覺**;真實文字 / 圖(品牌介紹、產線名、材質說明)之後接報價單**品牌級內容**(brand_story),先放佔位內容即可、別當最終文案定稿。
3. **真資產交 Sean**:品牌 logo、產品實照等真圖別自己生 / 亂抓,留佔位、交 Sean 補真資產。
4. **每品牌一塊獨立**:前台會 `product.brand` 條件渲染(RPM→紋路牆保留,其他→各自元件),每家特色區互不干擾。
5. **可直接搬**:輸出 HTML/CSS 要能讓 storefront 直接搬(對齊上方 class / token、別套整頁無關的外部框架);這符合鐵則 1「design 是真權威、storefront 對齊」。

---

## 已拍板紀錄(2026-06-04)

| 題 | 拍板 | 含意 |
|---|---|---|
| Q1 N°02 方向 | **C 各別客製** | RPM 紋路牆保留;其他品牌 Sean 用 OD 各別刻、回來細修搬 storefront |
| Q2 品牌內容來源 | **A 報價單側出** | 品牌級內容(brand_story)由報價單側出、網站不自 hardcode;上表欄位需求交報價單 session 併進 #209 PRD v2 |
| Q3 本 doc | **A 存檔** | commit 純 docs、不 push |

**下一步**:① Sean 用 OD brief 各別刻 Lightech / Bonamici / Front 3D 特色區 → ② 刻完回來,我把 OD 輸出對齊 token 搬進 storefront(每品牌一元件 + `product.brand` 條件渲染)→ ③ 報價單側併品牌級欄位後接真內容。**本階段不寫 code**(鐵則 8:跨多元件 + 綁跨庫 schema 重大改動,等 OD 產出 + 報價單 schema 才開 slice)。

---

— END —
