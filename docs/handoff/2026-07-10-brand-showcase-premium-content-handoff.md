# 品牌版面高階內容重整 Handoff（交 Claude／Claude Code）

> 日期：2026-07-10（Asia/Taipei）
>
> 目的：把 9 個品牌的 N°01 品牌故事與 N°02 商品特色，改成有代表性、內容豐富但不冗長的正式版本。
>
> 本檔狀態：研究與內容規格已完成；尚未修改 storefront 程式、正式素材或部署。
>
> 偵察基線：`dev`，檢查時 HEAD=`7e1952d`，工作樹 clean。原品牌交接 commit=`8c0a3df`。

## 0. 先看結論

目前 9 家 showcase 的共用骨架能用，但內容方向要重做：

- N°01 不是三張產品賣點卡，而是「簡短品牌故事」：`01 + 金線 + Logo`、一張官方情境／工廠圖、短故事、3 個事實標籤。
- N°02 不是另一個故事選項，而是「商品特色」：3 張技術特色卡，加 3–5 張代表產品卡。N°01、N°02 永遠同時存在。
- 商品圖只選品牌的招牌、高階、專利、賽事或相對高單價系列；不得再用螺絲、自鎖螺帽、轉接座、工作墊、油杯套等低辨識小物湊版面。
- 商品卡可用某車款商品當圖片來源，但卡片下方不得顯示車種／年式。可見標題只能寫產品類別或系列，例如「R Version 腳踏後移」。
- 桌機維持橫向一列；手機改水平滑動 `scroll-snap`，不可把 3–5 卡全部垂直堆疊。
- Evotech Logo 已找到不切下緣的安全裁法；正式素材要由官方原圖重新產生，不可沿用目前下緣被切掉的版本。

## 1. Sean 已拍板事項（不得再變成單選題）

1. `No1`＝簡單介紹品牌故事。
2. `No2`＝品牌商品特色。
3. 兩段都要有，並非 A／B／C 三選一。
4. N°01 的 `01` 旁邊要放品牌 Logo。
5. Evotech Logo 使用官方方形來源，去除上下多餘白邊後放大；不能炸開，也不能切到下緣。
6. Evotech 代表產品固定要包含：
   - 最新 RACE 上／下水箱護網組（Yamaha R9 官方商品作圖源）
   - 短牌架
   - 車身防倒球
   - 輪軸防倒球
   - 端子鏡／護弓整合組
7. 圖下文字不得寫車種。
8. LighTech：
   - N°01 公司介紹圖片必須從官方 Company 頁挑選。
   - N°02 可使用官方 Technologies 頁情境圖，並以 R Version 腳踏後移、碳纖維駐車架、快拆油箱蓋、後照鏡蓋等代表產品為主。
9. 其餘品牌比照 Evotech／LighTech：品牌故事用官方工廠、人物、研發或賽事情境；商品用招牌／高階產品，不用報價單中剛好有圖的低價小物。
10. 必須考量桌機與手機總滑動距離、RWD 圖文縮放、中文斷行與圖片比例。

## 2. 共用版型合約

### 2.1 N°01 品牌故事

桌機：

- Eyebrow：`01`、金色短線、Logo；Logo 視覺高度約 32–44px，寬度自動。
- 標題 1 行優先，最多 2 行；lead 約 40–58 個中文字，桌機控制在 2 行左右。
- 故事模組採 55–60% 圖片＋40–45% 文字的左右雙欄。
- 圖片建議 `aspect-ratio: 16 / 9` 或模組固定高度 360–420px；人物／工廠情境圖用 `object-fit: cover`。
- 右側故事內文 110–160 個中文字即可，不要再放 3 張長文卡。
- 3 個 fact chips 放在故事文下方；只放能由官方來源證實的數字／地點／賽事。

手機：

- 圖片在上、故事在下；Logo 高度約 28–34px。
- 故事圖 `aspect-ratio: 4 / 3`，焦點需逐品牌設定 `object-position`。
- 內文最多約 6 行；超過就重寫，不用 CSS 強切重要句。
- fact chips 可橫向滑動或 3 欄緊湊排列，不得因長字串把版面撐破。

### 2.2 N°02 商品特色

- 開頭只留 1 個標題＋1 段 lead。
- 技術特色固定 3 張：每張 `英文 kicker／繁中標題／45–70 字說明`。
- 桌機 3 張同列；手機卡寬 `74–78vw`、水平 `scroll-snap-type: x mandatory`。
- 代表商品 3–5 張：桌機同列；手機卡寬 `72–78vw` 水平滑動。
- 商品圖容器固定比例（建議 4:3）；白底 cutout 一律 `object-fit: contain`，情境圖才用 `cover`。
- 商品卡可見內容只放英文類別＋繁中類別，不顯示車型、年式、SKU、價格。
- 價格只用來判斷是否具代表性，本版面不顯示價格，避免日後價格異動造成內容失真。

### 2.3 長度與 RWD 驗收

- 1440px 桌機：N°01＋N°02 合計目標約 1,050–1,250px 高，不要超過約 1.5 個 900px viewport。
- 390px 手機：兩段合計目標約 1,250–1,500px；主要卡片必須橫滑，不能全部直排變成 2,500px 長頁。
- 驗收寬度至少：1440、1024、768、430、390、360px。
- 360px 下不得出現頁面水平 overflow；只允許卡片 rail 自己水平滑。
- `word-break: normal; overflow-wrap: break-word; line-break: strict;`，避免英文品牌名或 `MotoGP／WorldSBK` 擠破欄位。
- 圖片需有明確 `width`／`height` 或 `aspect-ratio`，避免載入時版面跳動。
- `alt` 可描述實際商品，但可見 caption 不寫車種。

## 3. Logo 與素材規則

### 3.1 Evotech Logo 安全裁切

官方原圖：

`https://evotech-performance.com/cdn/shop/products/EvotechLogohex2000x2000_a8747a9c-c721-4dce-aa4a-15edd1decdce_1000x1000.jpg?v=1701965847`

已驗證的安全裁切：原圖 1000×1000，裁 `x=0, y=235, w=1000, h=530`。此版本在圖樣上下各保留約 10px 安全距離，不會再切到六角框下緣。研究階段預覽檔位於：

`.superpowers/brainstorm/32201-1783665388/assets/evotech-logo-official-safe-trim.png`

Claude 實作時要從官方原圖重建到正式路徑，例如：

`apps/storefront/public/brands/evotech/logo.png`

不要在 production 引用 `.superpowers`。CSS 必須使用 `width:auto; height:clamp(...); object-fit:contain; overflow:visible;`，Logo 外層不得用固定窄寬＋`cover`。

### 3.2 其他 Logo

優先來源：`/Users/sean_1/Desktop/廠牌LOGO 2/`。目前 repo 已有：

- `apps/storefront/public/brands/lightech/logo.png`
- `apps/storefront/public/brands/cnc-racing/logo.png`
- `apps/storefront/public/brands/samco/logo.png`
- `apps/storefront/public/brands/materya/logo.png`
- `apps/storefront/public/brands/ebc/logo.svg`

Eazi-Grip、Motogadget、Front3D 若無本機正式檔，可從以下官方來源下載後本地化，不要長期 hotlink Logo：

- Eazi-Grip：`https://www.eazi-grip.com/wp-content/themes/eazigrip/img/logo.png`
- Motogadget：`https://www.motogadget.com/cdn/shop/files/mg-logo-neu-white_aa71b824-274a-4e1a-b851-61a6b4e964bc.svg?v=1741172059&width=595`
- Front3D：`https://front3d.com/cdn/shop/files/LOGO-FT-07-2.png?v=1710077465`

### 3.3 圖片紀律

- 品牌故事圖與商品圖一律先從品牌官方網站、官方型錄或官方 WordPress／Shopify CDN 取得。
- 不再用報價單 `image_url` 是否存在作為「代表產品」的選品標準。
- Hotlink 僅能做 `/dev-preview`；正式版需下載、本地化、轉 WebP／AVIF，並保留來源 URL 註解或 sidecar 紀錄。
- LighTech／CNC Racing HTML 目前會被 Cloudflare 擋 403，但其 `images_web` HTTPS 圖檔可直接讀。若 Company／Technologies 圖片沒有穩定直連，請用瀏覽器打開官方頁挑圖，再下載到 repo；不得用搜尋結果縮圖代替。

## 4. 九品牌正式內容

### 4.1 Evotech Performance

N°01：

- H2：`從一件自己想裝的部品，走到英國賽道與全球道路。`
- Lead：`2003 年，一位工程師因為找不到滿意的短牌架而自己動手；這個解法，成為 Evotech Performance 的起點。`
- Kicker：`THE FIRST TAIL TIDY`
- 故事標題：`因為買不到夠好的，Chris Vines 決定自己做。`
- 故事內文：`Chris Vines 替 Honda CBR954RR Fireblade 尋找短牌架，卻沒有一件符合期待。身為鈑金工程師，他親手完成第一件作品；車友的回應，讓這個解決自己問題的部品在 2003 年成為 Evotech Performance 的起點。之後品牌把量測、建模、加工與安裝設計整合進英國自有製程，也走入 BSB、WSBK 與曼島 TT。`
- Fact chips：`2003 年成立`、`英國 Lincolnshire`、`BSB／WSBK／TT`
- 故事圖（已符合 Sean 看過的方向）：`https://evotech-performance.com/cdn/shop/files/about-title_2048x_2048x_1acc1811-45f0-4a6a-b2a9-44328935a923_2048x.jpg?v=1614307305`
- 官方依據：
  - `https://evotech-performance.com/pages/about-us`
  - `https://evotech-performance.com/blogs/news/a-design-for-life-3d-scanning-and-modelling`

N°02：

- H2：`量測、材料與安裝，都圍繞特定車型重新設計。`
- Lead：`Evotech 的價值不只在黑色金屬外觀，而是專車量測、耐久材料與不破壞原車結構的完整工程。`
- 特色 1：`3D DEVELOPMENT／專車掃描與建模`—`依品牌、車型與年式開發，掌握曲面、間隙與固定點，降低萬用件常見的干涉與不貼合。`
- 特色 2：`MATERIAL／航太級鋁合金與耐候表面`—`依部位使用 CNC 鋁合金、工程尼龍與不鏽鋼，再以粉體烤漆或陽極處理兼顧強度與耐候。`
- 特色 3：`INSTALLATION／把安裝風險一起設計掉`—`沿用原車固定點，提供完整五金、圖解或影片；買的不只是零件，也是可預期的安裝路徑。`

代表商品（順序固定）：

1. `RACE 水箱／排氣頭段護網組`
   - 官方商品：`https://evotech-performance.com/products/evotech-race-radiator-header-guard-set-yamaha-yzf-r9-2025`
   - 官方圖：`https://cdn.shopify.com/s/files/1/1502/8810/files/Evotech-Yamaha-R9-EP-Radiator-Exhaust-Header-Guard-PRN018420-018422.jpg?v=1752131748`
   - 理由：Sean 指定的最新 RACE 上／下護網；大型 EP 圖樣、航太級鋁合金、粉體烤漆與導流孔最能代表品牌。
2. `短牌架`
   - 官方商品：`https://evotech-performance.com/products/evotech-tail-tidy-ducati-panigale-v4-2025`
   - 官方圖：`https://evotech-performance.com/cdn/shop/files/Evotech-Ducati-Panigale-V4-S-Tail-Tidy-PRN017692_grande.jpg?v=1760074845`
   - 理由：品牌起源產品，也是最具辨識度的核心系列。
3. `車身防倒球`
   - 官方商品：`https://evotech-performance.com/products/ep-ducati-panigale-v4-sp2-30-anniversario-916-frame-crash-protection-2024`
   - 官方圖：`https://evotech-performance.com/cdn/shop/products/Evotech-Ducati-Panigale-V4-Crash-Protection-PRN016103-Thumbnail_2360e80a-5b7c-4ea8-a5af-f1202d8ca171_grande.jpg?v=1699626071`
   - 理由：無鑽孔、專車固定點、英國／歐盟註冊設計，符合「保護但不破壞原車」定位。
4. `前後輪軸防倒球組`
   - 官方商品：`https://evotech-performance.com/products/evotech-spindle-bobbins-kit-ktm-990-duke-2024`
   - 官方圖：`https://evotech-performance.com/cdn/shop/files/Evotech-KTM-990-Duke-Front-Rear-Spindle-Bobbins-PRN012149-016969_grande.jpg?v=1710333029`
   - 理由：尼龍外層＋鋁合金核心＋不鏽鋼軸桿，完整呈現防護工程。
5. `端子鏡／煞車與離合器護弓整合組`
   - 官方商品：`https://evotech-performance.com/products/evotech-bar-end-mirrors-brake-and-clutch-protector-kit-retro-ducati-monster-v2-plus-2026`
   - 官方圖：`https://evotech-performance.com/cdn/shop/files/Evotech-Bar-End-Mirror-Brake-Clutch-Lever-Protector-Kit-PRN015536-015554-016116-016459-016469-016517-016518_e3d84cf1-44fa-4240-9853-7c582101d49e_grande.jpg?v=1752144048`
   - 理由：相對高單價且把視野、防護、CNC 與模組化整合在一組產品中。

### 4.2 LighTech

N°01：

- H2：`把家族製造底子與車手經驗，帶進世界級賽車部品。`
- Lead：`1997 年，Fabrizio Furlan 創立 LighTech；從家族製造專長出發，持續把賽場回饋帶回自有設計與生產。`
- Kicker：`BORN FROM RACING PASSION`
- 故事標題：`一位車手，把自己理解的操控感交給工廠實現。`
- 故事內文：`Fabrizio Furlan 在 1997 年把家族的製造能力與自己的騎乘經驗帶進 LighTech。品牌與 WorldSBK、MotoGP、125GP、Moto2 車隊合作，讓回饋直接進入設計與加工。官方資料顯示廠房共 2,500㎡，其中 1,400㎡用於 CNC 生產，研發端使用 CAD／CAM 完成設計與製造銜接。`
- Fact chips：`1997 年創立`、`2,500㎡ 廠房`、`WorldSBK／MotoGP／Moto2`
- N°01 圖片硬規則：必須從 `https://www.lightech.it/world/company/` 或同內容英文頁 `https://www.lightech.it/en/company/` 挑「工廠／CNC／人員／研發」照片。不要再用產品白底圖當品牌故事圖。
- 官方依據：
  - `https://www.lightech.it/en/company/`
  - `https://www.lightech.it/world/tecnologies/`
  - `https://www.lightech.it/shared/lightech/public/attach/catalogo/14/Catalogo%202024_no%20prices.pdf`

N°02：

- H2：`從 7075-T6、碳纖維到可調機構，做出真正有賽道目的的精品。`
- Lead：`LighTech 的招牌不是彩色小螺絲，而是精密切削、可調操控部品與高階碳纖維結構。`
- 特色 1：`PRECISION／自有 CNC 與 CAD／CAM`—`1,400㎡ 生產區配置數控車床與銑床，設計端與製造端以 CAD／CAM 串接。`
- 特色 2：`CONTROL／Ergal 7075-T6 與多軸承機構`—`R Version 以整塊 7075-T6 切削主支架，配多段調整、碳纖維護跟與鈦螺絲，服務道路高階操駕與賽道。`
- 特色 3：`CARBON／高階複材與輕量結構`—`碳纖維駐車架以 autoclave 碳纖維製作承重結構，2.1kg 重量直接把材料能力做成產品。`

代表商品：

1. `碳纖維後駐車架`
   - 官方商品：`https://www.lightech.it/world/ducati_panigale-v4/carbon-rear-stand-with-forks.html`
   - 替代英文頁：`https://lightech.it/en/bmw/carbon-rear-stand-with-forks.html`
   - 官方圖：`https://www.lightech.it/images_web/variante/1200x/RSC004F.JPG`
   - 研究價格：€1,379.82；autoclave 碳纖維承重結構、可調、2.1kg，是最能建立高階感的第一張。
2. `R Version 腳踏後移`
   - Sean 指定頁：`https://www.lightech.it/world/ducati_panigale-v4/r-version-rear-sets-for-ducati-23059.html#group-6`
   - 官方圖：`https://www.lightech.it/images_web/variante/1200x/FTRDU017R.JPG`
   - 研究價格：約 €870–€1,061；7075-T6、碳纖護跟、鈦螺絲、多軸承與可調位置。
3. `快拆油箱蓋`
   - 官方商品：`https://www.lightech.it/en/kove_adventure/quick-release-fuel-tank-cap-for-kove-ducati-yamaha.html`
   - 官方圖：`https://www.lightech.it/images_web/variante/1200x/TRN229NER.JPG`
   - 理由：整塊切削、PUSH & PULL、100% Made in Italy，是品牌長年高辨識系列。
4. `後照鏡孔蓋`
   - 官方商品：`https://www.lightech.it/en/product/pair-mirror-block-off-plates-for-yamaha.html`
   - 官方圖：`https://www.lightech.it/images_web/variante/1200x/SPE104NER.JPG`
   - 理由：雖非最高單價，但屬賽道拆鏡後常見且辨識度高的 LighTech 系列；排在第 4 張，不可取代前三張。

圖片補充：N°02 若需要一張技術情境大圖，必須從 `https://www.lightech.it/world/tecnologies/` 擷取 CNC／加工／材質照片，不要拿螺帽白底圖放大。

### 4.3 CNC Racing

N°01：

- H2：`從 1995 年的高精度工坊，走進 MotoGP 與頂級義式街車。`
- Lead：`Dario Secondini 與 Franco Fornaini 先把 SEFO 做成精密機械專家，再把賽車熱情變成 CNC Racing。`
- 故事內文：`1995 年，Dario Secondini 與 Franco Fornaini 在 Arezzo 創立 SEFO，從高精度機械小件與技術加工累積能力。兩人的摩托車熱情逐漸主導品牌方向，透過 Superbike、MotoGP 與 Pramac Racing 的合作，讓 billet 切削、輕量、可靠與義式造型成為 CNC Racing 的核心。`
- Fact chips：`1995 年製造根基`、`義大利 Arezzo`、`MotoGP／Superbike`
- 故事圖：從 `https://www.cncracing.com/en/company/` 挑工廠／加工／創辦脈絡照片；不得用單一商品白底圖。
- 官方依據：`https://www.cncracing.com/en/company/`、`https://www.cncracing.com/en/timeline/`

N°02：

- H2：`把整塊材料切成可調、耐用、也一眼可辨識的賽車部品。`
- 特色：`BILLET／實心材料切削`、`RACING／Pramac 與世界賽事回饋`、`MECHANISM／軸承、調整與可維修結構`。
- 代表商品：
  1. `Pramac 限量腳踏後移`—`https://www.cncracing.com/en/news/adjustable-rearsets-ducati-panigale-v4---pramac-racing-limited-edition_pr15607.html`；圖 `https://www.cncracing.com/images_web/prod/1200x/PE414PR.jpg`；研究價格 €1,279.78。
  2. `RPS 腳踏後移`—`https://www.cncracing.com/en/product/adjustable-rear-sets-rps-ducati-panigale-v4-series-for-v4-v4-s-and-v4-speciale.html`；圖 `https://www.cncracing.com/images_web/variante/1200x/PE406B.jpg`；12 段位置、正／逆打檔、軸承與賽道承載設計。
  3. `Pramac 透明離合器外蓋`—`https://www.cncracing.com/en/product/clear-oil-bath-clutch-cover-ducati-panigale-v2--streetfighter-v2--pramac-racing-limited-edition.html`；圖 `https://www.cncracing.com/images_web/variante/1200x/CA202BPR.jpg`；billet 鋁合金＋耐熱 Lexan＋官方賽車塗裝。
  4. 可選 `Pramac 賽車按鍵總成`—`https://www.cncracing.com/en/product/left-handlebar-switch-race--pramac-racing-limited-edition.html`；7075 鋁合金、IP67、按鍵循環測試；若拿不到穩定官方圖就不要硬放。

### 4.4 Eazi-Grip

N°01：

- H2：`把車手夾住油箱的動作，做成三種可選擇的騎乘介面。`
- Lead：`Eazi-Grip 從英國出發，把賽場使用的止滑需求，分成抓附、移動與舒適三種清楚手感。`
- 故事內文：`Eazi-Grip 長期與英國及世界賽事車隊合作。官方資料列出 GasGas MotoGP Team、LCR Honda、Elf Marc VDS、Go Eleven 等隊伍使用其可裁切止滑片。品牌沒有把所有騎士塞進同一種顆粒，而是以 EVO、PRO、Silicone 對應重煞支撐、換位自由與長途舒適。`
- Fact chips：`英國 Lancashire`、`EVO／PRO／Silicone`、`MotoGP／WorldSBK 車隊使用`
- 故事圖：優先從官方 brochure 中 Honda Racing UK／賽車頁，或 Custom Tank Grips 頁的車隊 gallery 擷取。不要使用單片白底止滑貼當故事圖。
- 官方依據：
  - `https://www.eazi-grip.com/custom-motorcycle-tank-grips/`
  - `https://www.eazi-grip.com/wp-content/uploads/Eazi-Grip-Brochure-24.pdf`

N°02：

- H2：`不是越粗越好，而是按騎法選擇抓附、移動與緩衝。`
- 特色 1：`EVO／明顯半球顆粒`—`讓皮衣在重煞時清楚獲得支撐。`
- 特色 2：`PRO／低輪廓聚氨酯`—`兼顧抓附與左右換位，適合需要頻繁移動身體的騎士。`
- 特色 3：`SILICONE／柔軟緩衝`—`帶有緩衝感，服務旅行、通勤與重視舒適的使用情境。`
- 代表商品順序：`Wrap Around Tank Grips`、`EVO 車型專用止滑貼`、`PRO 車型專用止滑貼`、`Silicone 車型專用止滑貼`。圖片從官方 brochure／商品頁抽取；目前可用的官方實圖例：`https://www.eazi-grip.com/wp-content/uploads/BUNAPR001EB-2.jpg`。
- 不要把儀表保護貼或水管組放在前三張；它們不是 Eazi-Grip 最有辨識度的品牌核心。

### 4.5 Samco Sport

N°01：

- H2：`在南威爾斯手工完成，為高溫、高壓與長期熱循環而生。`
- Lead：`Samco Sport 專注把矽膠水管做成能裝上後放心使用的完整系統，而不是只換一個鮮豔顏色。`
- 故事內文：`Samco Sport 的原料在英國製造，水管由 Pontyclun 工廠受訓技師手工完成。品牌用賽車隊測試、高品質歐洲矽膠與終身保固支持「Fit and Forget」承諾；Race Fit 更把多段管路整合成較少接點，降低競賽環境的滲漏風險並加快維修。`
- Fact chips：`英國 Pontyclun 手工製造`、`終身保固`、`Race Fit／OEM Fit`
- 故事圖：`https://samcosport.com/wp-content/uploads/2026/03/Ella-Lloyd-Hose-Build-Feb-2026-3.png` 或官方 factory 圖 `https://samcosport.com/wp-content/uploads/2021/06/Smiths-Manufacturing-1-scaled.jpeg`。
- 官方依據：`https://samcosport.com/frequently-asked-questions/`

N°02：

- H2：`車型專用彎管、多層補強與正確束環，一次重做冷卻系統弱點。`
- 特色：`CONSTRUCTION／多層補強矽膠`、`RACE FIT／減少接點與維修時間`、`SYSTEM／專用不鏽鋼束環與保固條件`。
- 代表內容／圖片：
  1. `Race Fit 全車水管套件`—官方比較圖 `https://samcosport.com/wp-content/uploads/2021/07/Race-Fit-vs-OEM-Fit.jpg`。
  2. `OEM Fit 全車水管套件`—同上，強調保留原車配置、專車彎管。
  3. `賽事技術合作`—官方 WorldSBK 圖 `https://samcosport.com/wp-content/uploads/2025/01/00_Test_Jerez_WorldSBK_2024_Wednesday_Locatelli_Z9B_8913.jpg`。
  4. `專用 Hi-Grip 不鏽鋼束環組`—官方 datasheet `https://samcosport.com/wp-content/uploads/2023/09/Samco-Sport-Hose-Clips.pdf`；若缺乾淨 cutout，可從官方 PDF 擷取。
- 不再放 ATV／UTV generic 圖或第三方經銷商圖；品牌頁聚焦重機完整水管系統。

### 4.6 Motogadget

N°01：

- H2：`一只不滿意的賽車儀表，開啟柏林二輪電子的另一條路。`
- Lead：`1999 年，Garrit Keller 在車庫替自己的 Moto Guzzi 賽車邊車做速度表；隔年，Motogadget 成立。`
- 故事內文：`當時仍在念機械工程的 Garrit Keller，找不到符合需求的儀表，因此自己完成原型。品牌從手工數位儀表一路發展到 mo.unit、motoscope、mo.view，把電子、金屬加工與極簡設計收進更小體積。2021 年遷入柏林約 1,800㎡ 新廠，至今累積逾百件智慧財產。`
- Fact chips：`2000 年成立`、`柏林 1,800㎡ 新廠`、`100+ 智慧財產`
- 故事圖：`https://www.motogadget.com/cdn/shop/files/CIMG0022.jpg?v=1755599068&width=1600`
- 官方依據：`https://www.motogadget.com/en/pages/our-history`

N°02：

- H2：`把儀表、配電、燈具與後視鏡，縮成不破壞車身線條的工程。`
- 特色：`INTEGRATION／電子控制集中`、`MINIMAL／極小體積`、`MATERIAL／無玻璃金屬鏡面與原創製程`。
- 代表商品：
  1. `mo.unit 電控中樞`—圖 `https://cdn.shopify.com/s/files/1/0678/3221/7868/files/mounit-1d_476c5c96-7317-43f2-89f9-13e5917749b7.jpg?v=1745920266`
  2. `motoscope pro 儀表`—圖 `https://cdn.shopify.com/s/files/1/0678/3221/7868/files/motoscope-pro-01_6058b9d0-21bc-4af1-b381-8cb0d71afc93.png?v=1741167313`
  3. `mo.view 無框後視鏡`—圖 `https://cdn.shopify.com/s/files/1/0678/3221/7868/files/MotoGadget_mo.view.spy._082451_d46cd2b7-5240-496b-b5e1-d57db6d63fce.jpg?v=1741168744`
  4. `mo.blaze 極小方向燈`—圖 `https://cdn.shopify.com/s/files/1/0678/3221/7868/files/tens4_91312731-30d1-41c9-8c5e-50ca22b9331f.png?v=1742298585`
- 這四項本來就具品牌代表性，可保留；需要重做的是 N°01 故事呈現與文案長度，不是換成更貴但較不知名的品項。

### 4.7 Front3D

N°01：

- H2：`先替自己的車解題，再把小量空力設計分享給更多騎士。`
- Lead：`Front3D 從工程師自用配件起步，以數位建模與 3D 列印服務傳統量產不容易照顧的車型。`
- 故事內文：`Front3D 的價值不是大型工廠規模，而是概念、建模、試作與安裝距離很短。品牌以 3D 列印快速迭代小量車型專用部品，常沿用原車固定點，並誠實說明列印層紋可再砂磨與噴漆。多數空力部品定位賽道、競技或越野使用，法規界線必須直接告知。`
- Fact chips：`工程師自用起點`、`3D 設計與列印`、`賽道用途定位`
- 故事圖：若 About 頁無人物照，使用能看出建模／原型的官方 3D render，而不是 generic 商品白底圖。可用 `https://cdn.shopify.com/s/files/1/0813/4629/8188/files/CameraKeyframeAnimation-OrbitInterpolation.508_1024x.png?v=1744647542`。
- 官方依據：`https://front3d.com/pages/about`

N°02：

- H2：`用數位製造，把小量、專車專用的空力部品做成可安裝成品。`
- 特色：`DIGITAL／快速迭代複雜曲面`、`FITMENT／原車鎖點與可逆安裝`、`FINISH／列印層紋可後加工`。
- 代表商品：
  1. `專車側翼組`—`https://front3d.com/products/side-wings-ducati-streetfighter-v2-2025`；圖 `https://front3d.com/cdn/shop/files/CameraKeyframeAnimation-OrbitInterpolation.577.png?v=1760465170`；品牌相對高單價、EU 設計保護、原車鎖點。
  2. `GP 煞車散熱導風罩`—`https://front3d.com/products/gp-brake-cooler-aprilia-rsv4-tuono-v4`；圖 `https://front3d.com/cdn/shop/files/CameraKeyframeAnimation-OrbitInterpolation.581.png?v=1762260592`；比一般版本更有代表性的賽道產品。
  3. `前叉定風翼`—`https://front3d.com/products/universal-fork-winglets`；圖 `https://front3d.com/cdn/shop/files/CameraKeyframeAnimation-OrbitInterpolation.514.png?v=1752868371`；品牌知名空力語彙。
- N°02 末尾保留法規 note：`原廠多項部品定位賽道、競技、特技或越野用途；道路安裝前請確認在地法規與個別商品說明。`

### 4.8 Materya

N°01：

- H2：`從草圖、3D 建模到成品，讓新部件真正接續原車設計。`
- Lead：`Mirco Sapio 同時是創辦人、CEO 與設計師；Materya 把每件部品的設計思路直接留在商品頁。`
- 故事內文：`Materya 的產品頁經常保留 Project Idea、Sketch Idea、3D Modelling，讓客人看見部件如何從問題、草圖一路收斂成可安裝幾何。工作室依形狀與強度選擇 3D 列印、CNC 或碳纖維，不讓單一製程限制設計，也重視與原車燈具、儀表與車身線條的整合。`
- Fact chips：`Mirco Sapio 主導`、`3D 列印／CNC／碳纖`、`設計過程公開`
- 故事圖：`https://materya.shop/wp-content/uploads/2025/11/DSC01394.jpg`；若畫面不適合 crop，改從首頁／商品頁挑有草圖或 3D 建模的官方情境圖。
- 官方依據：`https://materya.shop/`

N°02：

- H2：`不是多裝一件東西，而是讓空力、保護與原車線條一起完成。`
- 特色：`DESIGN／從問題與草圖開始`、`PROCESS／依需求選製程`、`INTEGRATION／專車固定點與造型延伸`。
- 代表商品：
  1. `碳纖維定風翼組`—`https://materya.shop/product/winglets-for-ducati-streetfighter-v4/`；圖 `https://materya.shop/wp-content/uploads/2021/04/001_SHOP_Materya.jpg-2.jpg`；與 CNC Racing 合作、碳纖維外蓋、研究價格約 €645。
  2. `Track Days 車頭整流面板`—`https://materya.shop/product/track-days-plate-for-ktm-superduke-1390r-my-24/`；圖 `https://materya.shop/wp-content/uploads/2024/04/SHOP_Materya_001-1.jpg`；替代昂貴頭燈並整合 ActionCam 固定點。
  3. `碳纖維儀表外蓋`—`https://materya.shop/product/dashboard-cover-for-ktm-superduke-1290r-my-20-carbon-fiber/`；圖 `https://materya.shop/wp-content/uploads/2022/09/SHOP_Materya_C-1.jpg`；品牌 bestseller 類型、保留 USB、原車視覺整合。
  4. 可選 `CNC 翼片拆除孔蓋`—`https://materya.shop/product/wings-blanking-caps-for-ducati-streetfighter-v4/`；僅在需要第 4 張時使用。
- 不再使用風鏡螺絲、油杯套等小物當代表商品。

### 4.9 EBC Brakes

N°01：

- H2：`從摩托車煞車需求出發，建立英美雙工廠的摩擦材料專業。`
- Lead：`EBC 在 1980 年代初於歐洲起步，如今仍獨立經營，並在英國與美國自有工廠製造煞車產品。`
- 故事內文：`EBC 從售後摩托車與汽車煞車需求開始，逐步建立英國與美國專業工廠。官方資料列出全球 400+ 團隊與 60,000+ 品號，來令片由自有工廠製造；品牌真正的優勢不是一種「最利」配方，而是依街道、旅行、track day 與純賽道建立不同摩擦特性。`
- Fact chips：`1980 年代初起步`、`英美自有工廠`、`400+ 團隊／60,000+ 品號`
- 故事圖：優先 `https://www.ebcbrakes.com/wp-content/uploads/2021/06/EBC-brakes-factory.jpg`；不要只用紅卡鉗近照說品牌歷史。
- 官方依據：`https://www.ebcbrakes.com/about-ebc-brakes/`

N°02：

- H2：`從旗艦街道配方到純賽道系統，按用途選擇制動特性。`
- 特色：`COMPOUND／用途分級摩擦配方`、`MANUFACTURING／英美自有工廠`、`SYSTEM／來令片與浮動碟盤配套`。
- 代表商品：
  1. `GPFAX 純賽道來令片`—`https://www.ebcbrakes.com/products/gpfax-sintered-race-brake-pads/`；圖 `https://www.ebcbrakes.com/wp-content/uploads/2023/04/Motorcycle_Pad_GPFAX_Generic-copy.jpg`；race only、0.6–0.7 高摩擦、zero fade 訴求。
  2. `X／XC 全浮動碟盤`—`https://www.ebcbrakes.com/products/floating-mc-rotors/`；圖 `https://www.ebcbrakes.com/wp-content/uploads/2021/06/floating-rotor-black-min-1.png`；英國精密製造、專利 Square Drive button、世界暢銷系列。
  3. `EPFA 街道／Track Day 來令片`—`https://www.ebcbrakes.com/products/epfa-sintered-fast-street-and-trackday-pads/`；圖 `https://www.ebcbrakes.com/wp-content/uploads/2022/09/Motorcycle_Pad_EPFA_Generic-copy.jpg`；燒結陶瓷、高性能道路與偶爾賽道。
  4. `Double-H 旗艦街道來令片`—`https://www.ebcbrakes.com/products/double-h-sintered-superbike-brake-pads/`；圖 `https://www.ebcbrakes.com/wp-content/uploads/2022/01/double-h-sintered-selector-min.jpg`；EBC 官方稱 flagship sintered streetsport pad。
- GPFAX 必須明示 `純賽道使用`，不可讓一般道路客人誤以為越高階越適合日常。

## 5. 實作對應檔案

現有 dispatcher：

- `apps/storefront/src/components/BrandShowcase.tsx`

9 家元件：

- `apps/storefront/src/components/EvotechShowcase.tsx`
- `apps/storefront/src/components/LightechShowcase.tsx`
- `apps/storefront/src/components/CncRacingShowcase.tsx`
- `apps/storefront/src/components/EaziGripShowcase.tsx`
- `apps/storefront/src/components/SamcoShowcase.tsx`
- `apps/storefront/src/components/MotogadgetShowcase.tsx`
- `apps/storefront/src/components/Front3dShowcase.tsx`
- `apps/storefront/src/components/MateryaShowcase.tsx`
- `apps/storefront/src/components/EbcShowcase.tsx`

共用 CSS：

- `apps/storefront/src/styles/product-page.css`

預覽：

- `apps/storefront/src/app/dev-preview/brands/page.tsx`
- `apps/storefront/src/app/dev-preview/brands/[slug]/page.tsx`

測試：

- 既有 `*Showcase.test.tsx` 至少保留「N°01、N°02、Logo、品牌根 class」smoke test。
- 補一個共用或逐元件測試，確認產品可見標題不包含車種／年式字樣。
- 若抽共用 `BrandStorySection`／`BrandFeatureSection`，需避免 boolean props 膨脹；資料以 typed content object 傳入。

## 6. 建議實作切片

這次會跨 9 元件＋CSS＋素材，屬 AGENTS.md 鐵則 8 的重大改動。Sean 已明確拍板內容方向並要求交 Claude 繼續；Claude Code 仍應把下列切片與 rollback 寫進 plan 紀錄，不要一次混成不可審的大 commit。

1. Slice A：共用故事／特色骨架＋CSS＋單一 Evotech 落地，先做 1440／390 肉眼驗。
2. Slice B：LighTech 落地；用真 Company／Technologies 圖，驗 Cloudflare 來源已本地化。
3. Slice C：CNC Racing、Eazi-Grip、Samco。
4. Slice D：Motogadget、Front3D、Materya、EBC。
5. Slice E：全 9 家 RWD、圖片焦點、斷行、alt、測試與 manifest／STATUS 收尾。

Rollback：每 slice 獨立 commit；若新共用骨架造成既有 RPM／GB Racing／Bonamici 回歸，只回退該品牌放量 slice，不碰三家既有 showcase。

內容分級：品牌故事、固定信任狀與代表產品屬 L2；沿用 backlog `#271`。不可因本次內容更新擴成後台 CRUD。

## 7. 完成定義（全部 yes 才算完成）

- [ ] N°01 是品牌故事，不是三張產品賣點卡。
- [ ] N°02 是商品特色＋代表產品，與 N°01 同時存在。
- [ ] 9 家 N°01 eyebrow 都是 `01 + 金線 + Logo`。
- [ ] Evotech Logo 下緣完整、上下白邊已去除、尺寸不再過小。
- [ ] Evotech 第一張商品是最新 RACE 上／下護網組。
- [ ] LighTech N°01 使用 Company 官方圖；N°02 至少包含碳纖維駐車架與 R Version 腳踏後移。
- [ ] 其他 7 家不再用低價小物或 generic 報價單圖當主角。
- [ ] 所有商品卡可見文字都沒有車種／年式。
- [ ] 1440／1024／768／430／390／360px 無錯位、破版、異常斷行。
- [ ] 手機 feature cards 與 product cards 都是水平滑動，不是全部垂直堆疊。
- [ ] 360px 頁面本體無水平 overflow。
- [ ] 商品 cutout 沒被 `cover` 裁切；故事圖焦點正確。
- [ ] 所有正式圖片已本地化並保留官方來源紀錄；無 HTTP mixed content。
- [ ] GPFAX、Front3D 等賽道用途有清楚免責／用途說明。
- [ ] Typecheck、lint、build、相關測試全綠，並完成桌機／手機肉眼驗。
- [ ] 不改 schema、API、env、deployment；不 push，由 Sean 做 push checkpoint。

## 8. 研究限制與交接提醒

- LighTech／CNC Racing 官方 HTML 對自動請求回 403，但搜尋索引、官方 PDF 與 `images_web` HTTPS 圖檔可驗證。Company／Technologies 的情境圖必須由 Claude 在真瀏覽器手動挑選並下載。
- 本檔列的「研究價格」只用於證明選品相對高階，不要硬寫到前台。
- 部分官網會更新 Shopify／WordPress 圖片 query；正式落地請下載到 repo，避免日後 hotlink 失效。
- 不要把所有品牌硬塞成一樣字數。共同的是資訊層級與 RWD 行為，故事長度可依官方資料量微調，但手機總高不能失控。
- 這份 handoff supersede `docs/handoff/2026-07-10-brand-rollout-morning-report.md` 中「品牌內容已足夠」的視覺判斷；資料管線、supplier-config、dry-run 與 DB 決策仍以原晨報為準。
