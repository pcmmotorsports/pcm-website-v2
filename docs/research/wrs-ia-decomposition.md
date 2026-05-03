# wrs.it 資訊架構(IA)拆解報告

> **撰寫:** Claude Code(Opus 4.7、1M context)
> **日期:** 2026-05-03
> **背景:** Sean 拍板 E1(只 IA 研究、不批量撈)、用 chrome-devtools MCP 真實 Chrome 瀏覽 5 個頁面、像真人逛站、研究 wrs.it 商品 × 車種規劃為何「好找東西」、輸出對 PCM 的啟發。
> **scope:** 不撈批量資料、僅研究結構、不違反 wrs.it robots.txt(robots 明確 Disallow ClaudeBot/GPTBot/CCBot 等 AI bot)。
> **觀察方法:** 用 `chrome-devtools` MCP `evaluate_script` + `take_snapshot`、抽 select element / breadcrumb / JSON-LD / microdata、單頁觀察、不批量。

---

## 0. TL;DR — wrs.it 為什麼好找東西(三條心法)

1. **雙軸分類**:同時用「**車輛軸(Brand → Model)**」與「**零件軸(Category × Manufacturer)**」找。每個用戶來這個站、心裡只想「我這台車」或「我要這個零件」、雙軸都接住、不互相犧牲。
2. **首頁就放 4 軸 selector**:Brand / Model / Manufacturer / Category 四個 select 在首頁 hero 區、進站 5 秒內可以開始篩選。不需要點 nav 進子頁。
3. **商品標題即合約**:每個商品名都是 `{零件廠牌} {變體} {零件名} {車廠} {車型} {年份範圍}` 規範格式、人類掃一眼就懂、Google 也直接索引。fitment 不靠 attribute table、靠標題 SEO。

---

## 1. 觀察的 5 個頁面與證據連結

| # | 頁面類型 | URL | 觀察重點 |
|---|---|---|---|
| 1 | 首頁 | `https://www.wrs.it/en/` | 4 軸 selector / top-nav / trust signals |
| 2 | Brand 頁 | `https://www.wrs.it/en/200-motorcycle-accessories-and-parts-ducati` | Ducati category、~2,328 頁商品、無自動 selector 預設 |
| 3 | Selector 結果頁 | `https://www.wrs.it/en/module/prestaliamakeselector/selection?pms1=Ducati&pms2=all&pms3=all&pms4=all&pmsl=1` | URL params 設定 selector state、Model 動態 ajax 載入 |
| 4 | 商品詳情 | `https://www.wrs.it/en/windscreens/498393-windscreen-sport-glossy-black-wrs-harley-davidson-pan-america-1250-special-st-2021-2026-5056826702524.html` | fitment metadata、JSON-LD、SKU/EAN |
| 5 | (略過 BMW 頁、IA 一致是低風險假設) | — | — |

**未直接驗證但合理推論**:
- Model 動態 ajax 載入(基於 lv2 selectedValue=`all` + URL pms1=Ducati 不變化 lv2 推斷)、未直接看到 ajax payload
- BMW 頁 IA 與 Ducati 一致(基於 selector lv1 在所有頁面 schema 一致 + PrestaShop 同 module 邏輯推斷)

---

## 2. 核心 IA:**雙軸分類**

### 2.1 車輛軸(Vehicle dimension)
找零件的入口 1:**「我的車是什麼?」**

```
Brand (車廠)  →  Model (車型)
   53 個                階梯式 ajax 載入
```

範例 brand:Aprilia / BMW / Ducati / Harley Davidson / Honda / KTM / Kawasaki / MV Agusta / Piaggio / Suzuki / Talaria(電動越野)/ Triumph / Vespa / Yamaha / Zontes …

### 2.2 零件軸(Part dimension)
找零件的入口 2:**「我要什麼類型的零件?哪家做的?」**

```
Category (零件品類) × Manufacturer (零件廠牌)
   26 個                    156 個
```

**Category**(部分):WRS PARTS / EXHAUSTS / SUSPENSIONS / FAIRING / BRAKES / CARBON PARTS / CHASSIS / ELECTRONICS / TRANSMISSION / CLUTCHES / RADIATORS / MIRRORS / ALLOY WHEELS / TITANIUM & ERGAL PARTS / ACCESSORIES FOR TRACK / WORKSHOP EQUIPMENT / VEHICLES / GIFT CARD / WATCHES …

**Manufacturer**(部分):Akrapovic / Brembo / Ohlins / Marchesini / Termignoni / Rizoma / Yoshimura / R&G / Puig / Givi / Spark / DB Holders / Bonamici Racing / CNC Racing / Ducabike-DBK / Ducati Performance / Ilmberger Carbonparts / WRS(自家)…

### 2.3 雙軸交集
4 個 select 同時擺在首頁 hero、用戶可任意組合:
- 「Ducati 的 Brembo 煞車」= Brand=Ducati × Manufacturer=Brembo × Category=BRAKES
- 「所有 Akrapovic 排氣」= Manufacturer=Akrapovic × Category=EXHAUSTS
- 「Harley Davidson 的 WRS 自家擋風玻璃」= Brand=Harley Davidson × Manufacturer=WRS × Category=WRS PARTS

**這是 PCM 後台 schema 設計的最大教科書級啟發**:Vehicle Brand 與 Part Manufacturer **是兩個不同維度**、不能混為一表。

---

## 3. **Year 不是 1st-class 維度**(重大發現)

### 3.1 證據
4 個 selector 全部 dump 過、**沒有 Year select**:

```
prestalia-selector-lv1 = Brand          (53 options)
prestalia-selector-lv2 = Model          (階梯動態載入)
prestalia-selector-lv3 = Manufacturer   (156 options)
prestalia-selector-lv4 = Category       (26 options)
```

### 3.2 wrs.it 怎麼處理 Year
**Year 範圍嵌入商品標題 / Model 字串**:
- `SPARK DE-CAT PIPE DUCATI 999 2002-2005`
- `SPARK FULL TITANIUM RACING HEADERS DUCATI MONSTER 821 2014-2017`
- `WINDSCREEN SPORT GLOSSY BLACK WRS HARLEY DAVIDSON PAN AMERICA 1250 / SPECIAL / ST 2021-2026`

**邏輯**:同零件 + 不同年份範圍 = 不同 SKU(因為螺絲孔位 / 油門線位 / 引擎控制圖譜可能變)、不需要 Year 過濾、靠商品標題自描述 + SKU level 的 fitment metadata。

### 3.3 優劣分析

| 優 | 劣 |
|---|---|
| schema 簡單(少 1 個 attribute) | 用戶找「2018 年 Ducati Panigale V4」要心算「2018 在哪個年份範圍」、體驗弱 |
| 商品名 SEO 強(Google 直接索引「2018-2024 Panigale V4」) | 同零件不同年份 = 不同 SKU、SKU 數量爆增、後台維護成本高 |
| 適合「同零件規格因年份微調」的賽車 / 改裝零件世界 | 不適合「精確 fitment lookup by year」場景 |

**結論**:wrs.it 做「賽車改裝大廠」、客群懂行、可接受字串解析。**PCM 服務範圍含「一般車主」、必須有 Year 1st-class 欄位**(下方 §10 待拍板題)。

---

## 4. URL Pattern(PrestaShop 慣例)

### 4.1 三種 URL 模式

| 類型 | 模式 | 範例 |
|---|---|---|
| 分類頁(category) | `/en/{ID}-{slug}` | `/en/370-wrs-parts`、`/en/200-motorcycle-accessories-and-parts-ducati` |
| 商品頁(product) | `/en/{cat-slug}/{ID}-{product-slug}-{ean}.html` | `/en/windscreens/498393-windscreen-sport-glossy-black-wrs-harley-davidson-pan-america-1250-special-st-2021-2026-5056826702524.html` |
| Selector module | `/en/module/prestaliamakeselector/selection?pms1=&pms2=&pms3=&pms4=&pmsl=1` | `?pms1=Ducati&pms2=all&pms3=all&pms4=all&pmsl=1` |

### 4.2 觀察
- 商品 URL 帶 EAN(13 位條碼)當 slug 後綴 — SEO 與 trace 都好
- Category URL 用內部數字 ID + slug、PrestaShop 標配
- Selector params 名 `pms1/pms2/pms3/pms4`、其中 `pms3=Manufacturer`、`pms4=Category`(從 `?pms3=Ilmberger%20Carbonparts` 推斷出來、不是 Brand→Model 順序)

---

## 5. 商品命名規範(SEO 殺手 / 寫不好就完)

### 5.1 wrs.it 模式
```
{零件廠牌} {變體 / 規格} {零件名} {車廠} {車型} {年份範圍}
```

### 5.2 範例與拆解

| 商品名 | 零件廠牌 | 變體 | 零件名 | 車廠 | 車型 | 年份 |
|---|---|---|---|---|---|---|
| `SPIDER ADJUSTABLE NORMAL / REVERSE SHIFT REAR SETS KAWASAKI ZX-6R 2009-2025` | SPIDER | ADJUSTABLE NORMAL/REVERSE SHIFT | REAR SETS | KAWASAKI | ZX-6R | 2009-2025 |
| `WINDSCREEN SPORT GLOSSY BLACK WRS HARLEY DAVIDSON PAN AMERICA 1250 / SPECIAL / ST 2021-2026` | WRS | SPORT GLOSSY BLACK | WINDSCREEN | HARLEY DAVIDSON | PAN AMERICA 1250 / SPECIAL / ST | 2021-2026 |
| `SPARK TITANIUM 2IN2 UNDER-SEAT PIPE DUCATI PANIGALE V4 / S / R 2018-2024` | SPARK | TITANIUM 2IN2 | UNDER-SEAT PIPE | DUCATI | PANIGALE V4 / S / R | 2018-2024 |

### 5.3 設計細節
- 全大寫(英文世界商品名慣例、SEO 中性)
- 「車型」用「`/`」分隔多 trim 變體(PAN AMERICA 1250 / SPECIAL / ST)
- 年份範圍用「`-`」分隔(2021-2026)
- 零件名 + 變體規格在標題前段、車型在中後段(用戶搜車型也找得到)

---

## 6. 商品詳情頁 fitment metadata(弱)

### 6.1 結構化 fitment 表
`.product-features` 只有兩列:

| Field | Value |
|---|---|
| Type | `Cupolini Touring WRS` |
| Compatible brand | `FOR HARLEY DAVIDSON` |

**沒有 Compatible model、沒有 Compatible year、沒有完整 fitment 表**。

### 6.2 SKU 與 EAN
- SKU `HD006NL` → HD prefix = Harley Davidson、006 序號、NL 規格代碼(可能 N=Black, L=Large?)
- EAN `5056826702524`(GS1 13 位)

**SKU 內含 brand 兩字 prefix** = 倉儲 / 撿貨 / 對帳眼花一秒辨認、是強做法。

### 6.3 Breadcrumb 只走 Category 軸
```
Home → WRS PARTS → WINDSCREENS
```

不反映 Brand / Model — 因為 PrestaShop 一個商品只屬於一個 category、Vehicle Brand 是用 selector module 處理、不在 category tree。

### 6.4 JSON-LD 弱
```json
[{"@type":"Organization","name":"WRS"}]
```

**沒有 Product schema、沒有 Offer schema、沒有 AggregateRating** — Google Rich Results 失分、SEO 弱點。

### 6.5 Description 強
- 提及 Ducati Pramac MotoGP Team、Sic58 Moto3 Team(賽事背書)
- 規格(高 30cm、上寬 25cm、下寬 36.5cm)
- 材質(4mm PMMA Plexiglass DOT626 certified)

**信任訊號**:用 MotoGP 賽事為品牌背書、賽車人才買單。

---

## 7. Selector module 動態 ajax 機制(技術)

### 7.1 觀察
URL `?pms1=Ducati&pms2=all` 中 `pms1` 確實預設 lv1=Ducati(`selected: true`),但 `lv2` Model select 仍只有 1 option(`Select a model`)、`disabled=false`。

### 7.2 推斷
Model options 是 **client-side JS 在 brand `change` event 後 ajax 撈**、SSR 不帶。可能的 endpoint(未直接驗證):
- `/en/module/prestaliamakeselector/getModels?make=Ducati`
- 或同模組 controller 內部 action

### 7.3 對 PCM 的意義
- PCM 也應採 ajax 階梯式(否則 Brand→Model 全集 = 53×幾十 = 上千 options 全塞 SSR)
- 但 PCM 必須讓 selector state 可用 URL params 傳遞(像 `?make=Ducati&model=PanigaleV4`)、SEO + 分享 URL 都需要

---

## 8. Top-level Navigation(5 個入口)

| 入口 | 對應 |
|---|---|
| Accessories | 機車配件總入口 |
| Scooter accessories | 速克達配件(分軌、因車種大不同) |
| Clothing | 騎士服飾 |
| WRS Parts | 自家品牌(主推 windscreen、毛利高) |
| Our brands | 供應商品牌(導 manufacturer browse) |

**速克達分軌**是值得學的設計 — PCM 同時做機車 + 速克達 + 電動,UI 應該分軌。

---

## 9. Trust Signals(信任訊號配置)

| 訊號 | 位置 |
|---|---|
| Google 4.8 / 5,025 reviews | Footer + 顯眼處 |
| Trustpilot 4.8 / 10,352 reviews | Footer + 顯眼處 |
| 「120,000 products ready on stock」 | 首頁 hero 下方 banner |
| 「Easy Return up to 30 days」 | 首頁 hero 下方 banner |
| 義大利公司編號(P.Iva 02590120412) | Footer(義大利法律要求 + 信任) |
| 客服營業時間 | Footer |
| Holiday Notice(May 1st-3rd) | 首頁置頂 banner、即時通知 |
| 物流商 logos(DHL/UPS/FedEx) | 商品頁 |
| 付款方式 logos(PayPal、Visa) | Footer |
| MotoGP 賽事背書 | 商品 description |

**設計邏輯**:任何頁進來、3 秒內看到至少 2 個 trust signals。

---

## 10. 對 PCM 的啟發 — 必抄 / 可抄 / 避踩

### 10.1 必抄(高效益、低成本)
1. **首頁 4 軸 selector**:Brand / Model / Category / Manufacturer 四個 select、進站 5 秒可篩。**轉換率殺手鐧**。
2. **商品命名規範強制**:`{Manufacturer} {變體} {Part} {Brand} {Model} {Year}`、後台寫死、不讓店主自由發揮。
3. **SKU brand prefix**:`HD###` / `DC###` / `BMW###` / `YA###`、倉儲撿貨眼花一秒辨識。
4. **Trust signals 配置**:Google + Trustpilot review、現貨數量、Easy Return、Footer 公司編號、物流 logos。
5. **速克達分軌入口**:機車 / 速克達 / 電動 三個 top-nav 入口、不混在一個雜貨 navigation。

### 10.2 可抄(中效益、需評估)
1. **Selector module 帶 URL params**:state 可分享(SEO + 用戶分享連結都要)。Medusa/Next.js 用 server component 時要設計 search params 同步機制。
2. **MotoGP / 賽事背書**:PCM 可對應「台灣 TTC / 大鵬灣 / 桃園賽道」賽事連結、做信任背書(若 PCM 有相關)。
3. **「Featured products / Best sellers / New products」三段 carousel**:首頁主推位、編輯導購。

### 10.3 避踩(wrs.it 做錯、PCM 不要學)
1. ❌ **Year 嵌入商品名 / Model 字串、不做 1st-class 欄位**:用戶找「2018 年 V4」要心算、體驗弱。**PCM 必須有 `year_start` / `year_end` 整數欄位**。
2. ❌ **JSON-LD 只有 Organization、沒有 Product schema**:Google Rich Results 嚴重缺。**PCM 商品頁必補 `Product` / `Offer` / `AggregateRating` JSON-LD**。
3. ❌ **fitment metadata 表只有 brand 一個欄位**:沒 model、沒 year — 之後做「Search by my bike」精準篩選會撞牆。**PCM 必須在 SKU / Variant level 存完整 fitment table**(brand_id + model_id + year_start + year_end + chassis_code 等)。
4. ❌ **商品 description 內嵌 raw JS(`var deindoshipping_ajax_url=...`)**:污染 description、SEO 跑掉。**PCM 描述必嚴禁 inline JS**。
5. ❌ **Breadcrumb 只走 Category 軸、不走 Vehicle 軸**:用戶從 vehicle 入口進來、想往上跳到 brand 找其他商品、做不到。**PCM 商品頁應同時呈現「Category breadcrumb」與「Vehicle breadcrumb」**(雙 breadcrumb、像 Amazon 的 lefthand 與 tophand)。

---

## 11. 對 PCM Schema 設計的待拍板題

下列題目影響 `M-0-05` / `M-0-06` schema-design milestones、Sean 拍板後我整合進 ADR。

### Q1: Year 怎麼存?
- **A1**:`year_start` / `year_end`(`int`)兩欄、1st-class、可精準範圍查詢。**(我建議)**
- **A2**:`year_text` 字串(像 wrs.it「2021-2026」)、簡單但不能 range query。
- **A3**:`compatible_years` 是 `int[]`(陣列、列出每個適用年份)、最精準但 schema 重。

### Q2: Vehicle Brand 與 Part Manufacturer 是同一表還是分開?
- **A1**:**分開兩表**(`vehicle_brands` 與 `part_manufacturers`)。**(我建議、wrs.it 也是分開)**
- **A2**:同一張 `brands` 表 + `type` enum(`VEHICLE` | `PART`)。schema 簡、但語意混。

### Q3: Selector 預設要 4 軸還是 5 軸?
- **A1**:**4 軸**(Brand / Model / Category / Manufacturer)如 wrs.it、簡單。
- **A2**:**5 軸**(加 Year)、用戶體驗精準但 select UI 多一格、首頁 hero 擠。
- **A3**:4 軸 + Year 在 sidebar filter(進子頁才看到)。**(我建議、平衡)**

### Q4: 商品標題命名規範要不要硬性規範?
- **A1**:**硬規範**、後台表單欄位拆 `manufacturer` / `variant` / `part_name` / `brand` / `model` / `year_range`、商品名由系統 concat 出來。後台 UX 麻煩、但一致性 100%。**(我建議、wrs.it 一致性極佳就因為硬規範)**
- **A2**:不規範、店主自由打、但 SEO 後續會痛。

### Q5: SKU 內含 brand prefix 要不要硬性規範?
- **A1**:**硬規範**(`HD###` / `DC###` 等),建表時依 vehicle_brand 自動生成 prefix。
- **A2**:不規範、用 UUID / 自增 id、簡單但失去倉儲眼花一秒辨識的優點。
- **A3**:選擇性、店主可填可不填。

### Q6: Breadcrumb 走幾條軸?
- **A1**:**雙 breadcrumb**(Category 軸 + Vehicle 軸並列)、學 Amazon。**(我建議、補 wrs.it 缺點)**
- **A2**:單 Category breadcrumb 如 wrs.it、簡單但失去 vehicle 跳躍能力。

---

## 12. 觀察方法注意事項(限制)

1. **未驗證 BMW 頁**:假設 IA 與 Ducati 一致(基於 selector schema 對 brand 中性)、但若 BMW 有特殊 sub-category 可能不一致。
2. **未驗證 Model 階梯式 ajax 實際 endpoint**:可確認的是 lv2 GET 不帶資料、推斷有 client JS、但具體 endpoint 未抓 network log。
3. **未觀察行動版 IA**:wrs.it 行動版可能 selector 摺疊 / 簡化、未驗證。
4. **未觀察登入後 IA**:有「Search by bike」「No motorbike in garage」字樣、暗示登入後可儲存「我的車」、簡化未來購買、但未驗證實際登入流。

這些是 PCM 落地前可補的後續觀察。

---

## 13. References

- [WRS 首頁](https://www.wrs.it/en/)
- [WRS Ducati category](https://www.wrs.it/en/200-motorcycle-accessories-and-parts-ducati)
- [WRS selector module 範例](https://www.wrs.it/en/module/prestaliamakeselector/selection?pms1=Ducati&pms2=all&pms3=all&pms4=all&pmsl=1)
- [WRS 商品詳情範例(WRS Pan America 擋風玻璃)](https://www.wrs.it/en/windscreens/498393-windscreen-sport-glossy-black-wrs-harley-davidson-pan-america-1250-special-st-2021-2026-5056826702524.html)
- [WRS Auto 姊妹站(汽車版)](https://www.wrsauto.it/en/) — 結構應類似、未驗證
- WRS robots.txt:Disallow ClaudeBot/GPTBot/CCBot 等 AI bot;`Content-Signal: search=yes, ai-train=no`(本研究尊重該訊號、僅做 IA 觀察、不批量爬資料)

— END —
