# 商品詳情頁現況內容包(給 Open Design)

> 內容來源:第一部分(15 支品牌介紹元件,已被刪、待重建)取自 git `19e4b0ed^`(即刪除該組元件的 commit `19e4b0ed` 的父版本);第二部分(商品規格/介紹區,現行活著)取自工作樹現行程式碼。日期 2026-08-07。
> 讀者=設計師與老闆(非工程師)。文案逐字保留、不改寫、不摘要——這份檔是「線上真的長這樣」的權威字面,拿去畫 OD 詳情頁的品牌介紹區與規格區。

---

## 第一部分:15 支品牌介紹元件(已刪除、待重建)

這組元件原本掛在商品詳情頁最下方(BrandShowcase dispatcher 依品牌分派),2026-08-07 commit `19e4b0ed` 整組刪除,版位空缺、詳情頁批照 OD 詳情頁稿重建。以下逐支列出被刪前的真實內容。

### BrandShowcase(dispatcher,不是視覺區塊,是分派表)

`BrandShowcase.tsx` 依 `product.brandSlug` 決定渲染哪支品牌元件,本身沒有畫面。分派表:

| brandSlug | 對應元件 / 內容 |
|---|---|
| `rpm-carbon`(RPM_CARBON_BRAND_SLUG) | 不是 Showcase 系列,渲染既有 `ProductHighlights` + `ProductSwatchWall` + `ProductSpotlight`(此三支未被本次刪除、仍在) |
| `gb-racing` | GbRacingShowcase |
| `bonamici` | BonamiciShowcase |
| `evotech` | EvotechShowcase |
| `lightech` | LightechShowcase |
| `cnc-racing` | CncRacingShowcase |
| `eazi-grip` | EaziGripShowcase |
| `samco` | SamcoShowcase |
| `motogadget` | MotogadgetShowcase |
| `front3d` | Front3dShowcase |
| `materya` | MateryaShowcase |
| `ebc` | EbcShowcase |
| `akrapovic` | AkrapovicShowcase |
| `k-speed` | KspeedShowcase |
| `extreme` | ExtremeComponentsShowcase |
| 其他未知品牌 | 回傳 `null`,無形象區 |

---

### Akrapovič(AkrapovicShowcase.tsx)

骨架(推斷):N°01 = 標題+導言 + 三張並排卡片(pd-feature-grid,重用三家共用骨架)。N°02 = 標題+導言 → 全寬形象影片帶(autoplay muted loop、進視窗才播) → 兩段左右交錯圖文(第一段圖左文右、第二段圖右文左 flip) → 四格信任狀橫列(pd-bs-stats)。

**N°01 — 為什麼選 Akrapovič**

> 斯洛維尼亞的排氣系統世界霸主——自 1991 年起累計 200 座世界冠軍頭銜，從自有鈦合金鑄造廠到 MotoGP 賽道，聲浪與輕量一次到位。

三卡:
1. **世界冠軍血統** — MotoGP、WorldSBK、MXGP 官方合作夥伴，BMW、Ducati、KTM、Yamaha、HRC 廠隊御用——累計 200 座世界冠軍頭銜，賽道就是它的研發實驗室。
2. **自有鈦合金鑄造廠** — 2009 年起自建鈦合金鑄造廠，專利鈦合金強度是純鈦的 3 倍、比不鏽鋼輕 40%——從冶金源頭到成品，全程留在自家屋簷下。
3. **斯洛維尼亞原廠工藝** — 逾 1,800 名員工在斯洛維尼亞設計與製造、銷往 80 多國，並以 Ducati 專用系統拿下 Red Dot「Best of the Best」設計大獎。

**N°02 — 從鈦合金熔湯，到世界冠軍的聲浪**

> Akrapovič 把冶金、實驗室與賽道驗證全部留在自家——每一支消音器出廠前，材料就已經先贏過一輪。

段落一(01 — Materials & Lab)「材料實驗室」:逾 35 年鈦合金、不鏽鋼、碳纖維與鋁合金加工經驗，自建先進實驗室與耐久測功機——輕量與強度不是官網形容詞，是自家實驗室反覆驗證出來的數字。

段落二(02 — Titanium Foundry)「自有鈦合金鑄造廠」:2009 年起自煉鈦合金，專利合金比純鈦強 3 倍、比不鏽鋼輕 40%，冶金技術甚至延伸到醫療手術器材——這是全球極少數從熔湯做到消音器的排氣品牌。

信任狀四格:
- 1991 · 品牌創立 · 斯洛維尼亞
- 200 · 世界冠軍頭銜 · MotoGP·WorldSBK·MXGP
- 2009 · 自有鈦合金鑄造廠 · 從冶金到成品一貫化
- 80+ · 銷售國家 · 員工逾 1,800 人

圖片清單:`/brands/akrapovic/logo.svg`(alt: Akrapovič)、`/brands/akrapovic/hero.mp4` + 海報 `hero-poster.webp`(hero 影片,aria-hidden)、`/brands/akrapovic/story-materials.webp`(alt: Akrapovič 材料實驗室與碳纖維部件檢測)、`/brands/akrapovic/story-foundry.webp`(alt: Akrapovič 自有鈦合金鑄造廠澆鑄作業)。

---

### Bonamici Racing(BonamiciShowcase.tsx)

骨架(推斷):N°01 = 標題+導言 + 三卡。N°02 = 標題+導言 → 品牌形象影片(facade,點擊才載 YouTube iframe) → 兩段左右交錯圖文 → 8 色陽極色票牆(横列 8 張小圖+色名) → 4 個徽章橫列(pd-bona-badges)。

**N°01 — 為什麼選 Bonamici**

> 義大利薩賓丘陵的家族工坊，二十餘年只做一件事——把賽道經驗鍛造成每一件 CNC 切削部品，100% 義大利設計與製造。

三卡:
1. **義大利家族工坊，三代傳承** — 從金工師傅 Luciano Bonamici 到兩個兒子 Riccardo 與 Enrico，二十餘年只專注一件事：把賽道經驗鍛造成每一件 CNC 部品。
2. **航太級鋁合金 × F1 等級研發** — 採用源自 Formula 1 的 CAM 建模與 3D 列印打樣驗證，交由 3／4／5 軸 CNC 精密切削，搭配陽極處理，在效能與輕量間取得平衡。
3. **WorldSBK 冠軍血統實戰驗證** — Bonamici 是 ROKiT BMW WorldSBK 車隊與兩屆世界冠軍 Toprak Razgatlıoğlu 的官方裝備，並與 GRT Yamaha 長期合作。

**N°02 — 從一塊鋁，到一件賽車部品**

> F1 等級研發 × 多軸 CNC 精密切削 × 職人手工——每一刀都在效能與輕量之間取得平衡。

品牌形象影片(facade,label「品牌形象影片 · Bonamici Racing」,YouTube ID `JBWv0RvSWXY`)。

段落一(01 — Research & Development)「研發與設計」:每件部品先以源自 Formula 1 的 CAM 建模繪製，再 3D 列印快速打樣、實車驗證，確認貼合與強度後才量產——設計不是畫出來就好，是騎出來的。

段落二(02 — Craftsmanship)「職人手工 · 精密切削」:航太級鋁合金經 3／4／5 軸 CNC 一體切削成型，再由職人手工修整、陽極處理提升抗蝕耐磨——從原料到成品，100% 在義大利完成。

陽極色牆(標題 Anodized Finish / 可選陽極色 / 備註「實際可選色以各商品頁為準」):陽極黑、紅、藍、金、綠、橙、古銅、銀(共 8 色,各配一張真部品照)。

20 年徽章列:「20 年 · 精工淬鍊」/「精密機械 · Precision Mechanics」/「義大利製 · 100% Made in Italy」/「持續研發 · R&D Continued」。

圖片清單:`/brands/bonamici/logo.webp`、`video-thumb.webp`、`research.webp`、`craft.webp`、`anod-black.webp`、`anod-red.webp`、`anod-blue.webp`、`anod-gold.webp`、`anod-green.webp`、`anod-orange.webp`、`anod-bronze.webp`、`anod-silver.webp`(共 12 張)。

---

### CNC Racing(CncRacingShowcase.tsx)

骨架(推斷):N°01 = 標題+導言+三卡。N°02 = 標題+導言 → 全寬 hero 大圖 → 兩段交錯圖文 → 四格信任狀 → 產品線水平捲(4 卡)。

**N°01 — 為什麼選 CNC Racing**

> 義大利 Arezzo 的 CNC 切削工坊，1995 年深耕至今——Ducati、MV Agusta 等歐系車主的精品首選，MotoGP 圍場實戰背書。

三卡:
1. **Since 1995、義大利切削工藝** — 整塊 billet 鋁合金一體切削成型，不是鑄造翻模——三十年托斯卡納金工傳統，公差與質感看得出差別。
2. **MotoGP 圍場實戰** — 與 MotoGP 車隊 Prima Pramac Racing 合作，並推出 Pramac 聯名限定部品——賽場用得住，街道更有餘裕。
3. **歐系車款深度覆蓋** — Ducati、Aprilia、MV Agusta、BMW、KTM、Moto Guzzi 六大車廠逐車型對應，光 Ducati 就近 1,800 個品項——冷門年式也找得到。

**N°02 — 整塊鋁，切出來的義大利精品**

> 從換檔連桿到避震連桿，每一件都是 billet 一體切削——安裝影片與原廠說明書齊備，DIY 也有把握。

段落一(Development · 研發)「賽道實測的義式精品」:源自義大利精密機械工坊，產品在 Superbike 與 MotoGP 賽道上反覆實測——曾與 Pramac 車隊並肩，也拿過 WSBK 冠軍。

段落二(Manufacturing · 製造)「billet 一體削切」:鋁合金、鈦合金與碳纖，從整塊 billet 削出，義大利自製，每件都刻上 CNC Racing 盾徽。

信任狀四格:1995 · 品牌傳統 · 義大利 Arezzo / MotoGP · 圍場合作 · Prima Pramac Racing / 1,787 · Ducati 品項 · 六大歐系車廠逐車型對應 / Billet · 一體切削 · 實心鋁材 CNC 成型。

產品線(4 卡):Pramac Limited「Pramac 限量腳踏後移」(MotoGP 車隊官方聯名，紅銀限量配色)/ Carbon Fuel Cap「碳纖維油箱蓋」(碳纖蓋體＋鋁合金法蘭，快拆設計、車頭質感升級)/ Clutch Window「透明離合器外蓋」(billet 鋁合金＋耐熱 Lexan，官方賽車塗裝)/ Race Switch「賽車按鍵總成」(7075 鋁合金、IP67、按鍵循環測試)。捲動提示文字「← 左右滑看產品線 →」。

圖片清單:`/brands/cnc-racing/logo.png`、`hero.jpg`、`story-rd.jpg`、`story-mfg.jpg`、`prod-01.jpg`、`prod-02.jpg`、`prod-03.jpg`、`prod-04.jpg`。

---

### Eazi-Grip(EaziGripShowcase.tsx)

骨架(推斷):同 CNC Racing 家族(N°01 三卡、N°02 hero 圖+兩段交錯+四格信任狀+產品線水平捲),但產品線為 4 卡且每卡多帶「止滑力星等」小標籤。

**N°01 — 為什麼選 Eazi-Grip**

> 英國 Lancashire 的油箱止滑貼專家，車型專屬裁型免自己剪——WSBK 世界冠軍車手同款的夾持感。

三卡:
1. **車型專屬裁型、不用自己剪** — 每組至少兩片、按你的車型開版裁好——貼上就服貼油箱曲面，不像通用片要自己比劃剪裁還怕貼歪。
2. **三系列材質、按騎法選** — Pro 低調圓紋耐磨、Evo 半球顆粒賽道鎖腿、Silicone 織紋緩衝通勤舒適——選對系列，煞車時下半身穩定不靠手腕硬撐。
3. **頂級賽事車隊採用** — BSB、WSBK、MotoAmerica 到 MotoGP 各級車隊都在用，WSBK 世界冠軍 Toprak Razgatlıoğlu 同款背書。

**N°02 — 貼上去，過彎重煞都咬得住**

> 止滑貼是最便宜的操控升級——夾油箱省下的力氣，全部還給手腕與注意力。

段落一(Racing · 賽事驗證)「頂級賽事同款」:BSB、WSBK 到 MotoGP 車隊都在用——止滑貼是最便宜的操控升級，賽場先驗證過，再給你。

段落二(Design · 止滑面設計)「車型專屬裁型」:每組按車型開版、半球顆粒排列針對煞車支撐——貼上就服貼油箱曲面，重煞時下半身穩定、不靠手腕硬撐。

信任狀四格:UK · 英國品牌 · Lancashire 設計製造 / 2011 · Evo 系列問世 · 半球顆粒止滑面 / WSBK · 冠軍同款 · Toprak Razgatlıoğlu 背書 / 3 · 材質系列 · Pro／Evo／Silicone。

產品線(4 卡,各附止滑力星等或用途標籤):
- EVO 大顆粒「半球顆粒止滑貼」止滑力★★★:半球型立體突點，源自 BSB 英國超級摩托車賽場車手回饋——最強膝夾抓力，彎道與激烈騎乘首選。
- PRO 小顆粒「低輪廓止滑貼」止滑力★★☆:圓形平面壓紋，貼合性佳、移動自如，急煞與激烈騎乘時提供穩定抓握——兼顧日常代步與長途旅行。
- Silicone 矽膠「緩衝止滑貼」止滑力★☆☆:超薄矽膠材質，觸感柔軟有彈性，騎乘時腿部滑動流暢、視覺低調——適合通勤與長途旅行。
- Eazi-Guard PPF「犀牛皮保護膜」用途:油箱防刮保護:透明保護膜，防刮、耐污，保護油箱免受膝蓋磨損與細小刮傷。

捲動提示「← 左右滑看四款式 →」。

圖片清單:`/brands/eazi-grip/logo.png`、`hero.jpg`、`story-bsb.jpg`、`story-grip.jpg`、`prod-01.jpg`、`prod-02.jpg`、`prod-03.jpg`、`prod-04.jpg`。

---

### EBC Brakes(EbcShowcase.tsx,精簡版)

骨架(推斷):N°01 三卡(小品牌精簡版)。N°02 = 標題+導言 → 四格信任狀 → 一段交錯圖文 → 品牌影片 facade → 一段交錯圖文(flip) → 產品線水平捲(4 卡)。

**N°01 — 為什麼選 EBC Brakes**

> 1980 年代創立於英國的煞車專家——英美雙自有工廠、逾六萬品號，止得住街道，也止得住賽道。

三卡:
1. **英美自有工廠、非貼牌** — 全系列來令片 100% 在自家英國、美國工廠生產，員工 400 餘人——用的是六十年煞車材料配方經驗，不是代工貼牌。
2. **認證印在產品上** — 來令片系列名直接掛 ECE R90 認證，浮動碟盤打上德國 ABE（TÜV）KBA 編號——對得上車型、查得到認證，不用賭。
3. **按騎法選系列** — Double-H 燒結街跑定番、EPFA 街道賽道兩用、GPFAX 純賽道——依用途分系列不是只看料號，煞車手感自己挑。

**N°02 — 六十年只研究一件事——停下來**

> 從市區通勤到賽道熱身，煞車的手感與抗衰退，EBC 用配方與認證一路顧到底。

信任狀四格:1980s · 英國創立 · 英美雙自有工廠 / 60,000+ · 品號規模 · 全球最大來令片／碟盤品項庫 / R90·TÜV · 雙認證 · ECE R90＋ABE KBA 編號 / 40,000+ · 全球經銷 · 歐美市場長年驗證。

段落一(Development · 研發)「賽道與測功機雙驗證」:英國自有研發中心以動態測功機搭配賽道實測，煞車皮與碟盤都經反覆驗證才量產。

品牌影片 facade(label「品牌影片 · EBC Brakes」,YouTube ID `xDidxn04Ess`「Welcome to EBC Brakes」)。

段落二(Manufacturing · 製造)「花瓣浮動碟工藝」:浮動碟以鋁合金花鼓搭配不鏽鋼浪花外環，浮動鉚接、花瓣散熱——精密沖壓與 CNC 輪廓，質感與制動並重。

產品線(4 卡):Floating Rotor「浮動碟盤」(金色碟座＋不鏽鋼碟面，散熱與制動兼顧)/ Brake Pads「來令片」(GPFAX 純賽道／EPFA 街道賽道／Double-H 街跑／有機街道，依騎法選配方)/ Brake Lines「煞車油管」(不鏽鋼編織油管，煞車力道直接、不隨里程軟化)/ Clutch Kit「離合器片」(SRK 賽事離合器組，摩擦片與彈簧整組更換)。捲動提示「← 左右滑看產品線 →」。

圖片清單:`/brands/ebc/logo.svg`、`story-rd.jpg`、`story-mfg.jpg`、`prod-01.png`、`prod-02.jpg`、`prod-brakeline.jpg`、`prod-04.png`(影片縮圖動態取自 `https://img.youtube.com/vi/xDidxn04Ess/maxresdefault.jpg`)。

---

### Evotech Performance(EvotechShowcase.tsx)

骨架(推斷):N°01 三卡。N°02 = 標題+導言 → 全寬 hero 大圖 → 兩段交錯圖文 → 四格信任狀 → 產品線水平捲(5 卡)。

**N°01 — 為什麼選 Evotech Performance**

> 英國 Lincolnshire 自有工廠的車身防護專家，自 2003 年起為 BSB、WSBK 車隊與曼島 TT 打造航太級鋁合金防護配件。

三卡:
1. **賽事實戰驗證** — 供應英國超級摩托車錦標賽（BSB）與世界超級摩托車錦標賽（WSBK）車隊，並長期支持曼島 TT——防摔配件不是裝飾，是賽道驗證過的保險。
2. **航太級鋁合金、英國自家製** — Lincolnshire 自有工廠 CAD／CAM 一貫化生產，航太級鋁合金 CNC 切削加耐候粉體烤漆，日曬雨淋不怕鏽、不掉漆。
3. **選對車型、精準貼合** — 依車型逐款開發專用套件，原廠明文「選對型號才保證精準貼合」——下單前對好車型年式，不用怕鎖不上。

**N°02 — 從賽道回到日常的防護配件**

> Evotech 不做萬用件——每一組防摔球、水箱護網都對著特定車型開發，裝上去就像原廠多給的配備。

段落一(Development · 研發)「專車量測與 3D 建模」:每件部品先掃描目標車型，建立曲面、間隙與固定點的數位模型，確保專車貼合、降低萬用件常見的干涉與不服貼。

段落二(Manufacturing · 製造)「英國自有製程」:航太級鋁合金 CNC 切削，再以粉體烤漆或陽極處理提升強度與耐候——量測、加工與安裝設計，都留在英國自有製程。

信任狀四格:2003 · 品牌創立 · 英國 Lincolnshire / BSB·WSBK · 賽事供應 · 英國／世界超級摩托車錦標賽車隊 / IOM TT · 曼島 TT · 長期支持車手與車隊 / CNC · 航太級鋁合金 · 自有工廠切削＋粉體烤漆。

產品線(5 卡):Race Protection「RACE 水箱／頭段護網組」(航太級鋁合金、粉體烤漆導流孔，賽道級護網)/ Tail Tidy「短牌架」(品牌起源產品，最具辨識度的核心系列)/ Crash Protection「車身防倒球」(無鑽孔、專車固定點，保護但不破壞原車)/ Spindle Protection「前後輪軸防倒球」(尼龍外層＋鋁合金核心＋不鏽鋼軸桿)/ Mirror & Guard「端子鏡／護弓整合組」(視野、防護、CNC 模組化整合在一組)。捲動提示「← 左右滑看產品線 →」。

圖片清單:`/brands/evotech/logo.png`、`hero.jpg`、`story-rd.jpg`、`story-mfg.jpg`、`prod-01.jpg`、`prod-02.jpg`、`prod-03.jpg`、`prod-04.jpg`、`prod-05.jpg`。

---

### Extreme Components(ExtremeComponentsShowcase.tsx)

骨架(推斷):N°01 三卡。N°02 = 標題+導言 → 全寬賽車形象橫幅 → 三段交錯圖文(材料/賽場/義大利) → 四格信任狀(紅色調 accent)。

**N°01 — 為什麼選 Extreme Components**

> 義大利賽事部品廠，把 Moto3 世界冠軍腳下的規格，做成你買得到的零件。

三卡:
1. **六座冠軍，同一個賽季** — 2025 年拿下 Moto3 車手與車隊雙料世界冠軍，加上 CIV 義大利 Moto3、MotoAmerica SSP600、菲律賓 SBK——一年六座頭銜，官網逐年公布。
2. **三種纖維，三個戰場** — 碳纖維打一般賽事；Black Fiber 專用在禁碳纖的組別；Epotex 用乾式玻纖加特殊環氧，比一般玻纖更輕更韌。
3. **賽場先跑過，才輪到你** — 官方說明：研發只與長年征戰國內與世界錦標賽的頂尖車隊合作，經過特定測試之後才進入量產。

**N°02 — 從一塊 7075，到世界冠軍的腳下**

> 鋁合金整塊實心切削、纖維進高壓釜成型，出廠前都已在賽道上被驗過一輪。

段落一(01 — Billet & Fiber)「整塊實心切削，只進高壓釜」:鋁件是 Alu 7075 T6 整塊實心切削、硬質陽極，車隊標誌以雷射雕刻——引擎護蓋、腳踏後移、引擎蓋成組登場。碳纖維與 Black Fiber 則一律採預浸布、在高壓釜中成型，主用斜紋（Twill），客人也可指定平紋（Plein）。

段落二(02 — Proven on Track)「裝在廠隊車上，不是型錄上」:Extreme 的部品出現在頂級廠隊的維修區與賽車上，和 Öhlins、Akrapovič 這些名字裝在同一台車。2025 年官方合作車隊包含 GYTR GRT Yamaha WorldSBK Team。賽道是他們的研發實驗室，不是行銷背景板。

段落三(03 — Made in Italy)「Solo opere d'arte — 只做藝術品」:這句是他們官網的標語，不是我們的形容詞。品牌由 Stefano Bragagnolo 創立，設計、加工到成品全部留在義大利威尼托的 Piombino Dese。零件上直接帶著義大利國旗——那是產地，也是態度。

信任狀四格:6 · 2025 冠軍頭銜 · 含 Moto3 雙料世界冠軍 / 7075 · 航太級鋁合金 T6 · 整塊實心 · 硬質陽極 / 3 · 纖維工法 · Carbon · Black Fiber · Epotex / 100% · 義大利製造 · Piombino Dese · 威尼托。

圖片清單:`/brands/extreme/logo.png`、`band.webp`(alt:賽車手跨上裝有 Extreme Components 部品的賽車，配 Dunlop 熱熔胎)、`billet.webp`(alt:賽車引擎上同框的 Extreme Components 引擎護蓋、腳踏後移與碳纖引擎蓋)、`track.webp`(alt:Red Bull KTM 維修區內賽車裝著 Extreme Components 拉桿護弓)、`italy.webp`(alt:Yamaha R1M 廠車全碳纖車身，可見 Extreme Components 標誌與 Öhlins 前叉)。

---

### Front3D(Front3dShowcase.tsx,精簡版)

骨架(推斷):N°01 = 標題+導言 + 一張大 hero 圖 + 三卡。N°02(短版) = 標題(無導言) → 兩段交錯圖文 → 三格信任狀 → 產品線水平捲(4 卡) → 免責聲明段落。

**N°01 — 為什麼選 Front3D**

> 工程師出身的 3D 列印空力工作室——側翼、卡鉗導風罩沿用原廠孔位免鑽孔，賽道日外觀一次到位。

三卡(hero 大圖在導言與三卡之間,alt: Front3D Yamaha R1 空力套件實裝):
1. **3D 列印一體成形** — 3D 列印直接成型，MotoGP 風格小翼與導風罩用親民價格入手；表面可再砂磨、噴漆，配色自己作主。
2. **原廠螺絲直上、免鑽孔** — 按車型建模、沿用原廠鎖點與螺絲——不用鑽車殼、不用另買五金，拆回原狀也不留痕跡。
3. **賽道取向、誠實定位** — 原廠明文定位賽道／競技／越野用途，非道路認證部品——定位講在前面，要改什麼、怎麼用，你自己決定。

**N°02 — 給街車的賽道空力語彙**(短版,標題無導言)

段落一(Design · 3D 設計)「從 3D 建模到成品」:工程師以 3D 建模逐車開版，側翼、導風罩沿用原廠孔位——列印成型後可再砂磨、噴漆，配色自己作主。

段落二(Install · 原廠孔位直上)「對位鎖上、免鑽孔」:側翼、導風罩沿用原廠鎖點——不鑽車殼、不另買五金，賽道日的空力外觀自己動手就到位。

信任狀三格:10+ · 適配車廠 · Yamaha／Ducati／Triumph／KTM 等 / 3D · 列印製程 · 可砂磨噴漆客製 / 0 · 鑽孔需求 · 原廠螺絲直上。

產品線(4 卡):Side Wings「側翼定風翼」(MotoGP 風格雙層側翼，下壓穩定)/ Front Spoilers「前擾流下巴」(車頭下方導流，強化空力語彙)/ Brake Coolers「卡鉗導風罩」(導風降溫，賽道反覆重煞抗衰退)/ Tail Fins「尾翼尾鰭」(車尾造型與氣流收尾一次到位)。捲動提示「← 左右滑看產品線 →」。

免責聲明段落:「原廠聲明：Front3D 部品定位為賽道、競技、特技與越野用途，未經道路使用認證——一般道路安裝前，請自行確認在地法規。」

圖片清單:`/brands/front3d/logo.png`、`prod-01.jpg`(N°01 hero)、`install-1.jpg`、`install-2.jpg`、`prod-02.png`、`prod-03.png`、`prod-04.png`、`prod-05.png`。

---

### GB Racing(GbRacingShowcase.tsx)

骨架(推斷):N°01 三卡。N°02 = 標題+導言 → 全寬冠軍認證橫幅圖 → 四格信任狀 → 產品線水平捲(4 卡)。注意:GB Racing 用自己獨立的 CSS 命名空間 `pd-gb-*`(非其他品牌共用的 `pd-bs-*`)。

**N°01 — 為什麼選 GB Racing**

> 英國賽道等級引擎防護，自 2009 年起是全球唯一通過 FIM 認證的引擎護蓋系列，把 MotoGP、WorldSBK 的實戰防護帶回你的日常騎乘。

三卡:
1. **FIM 認證、賽道實證** — 全球唯一通過國際摩托車總會（FIM）認證的引擎防護，長年征戰 MotoGP、WorldSBK、BSB，經頂尖車隊工程師實戰驗證。
2. **專利複合材質、潰縮式防護** — 高強度長玻纖尼龍射出成型，依部位精調厚度 2–12mm，搭配兩項英國專利，摔車瞬間吸收撞擊、避免磨破漏油。
3. **英國製造、全車系覆蓋** — 引擎護蓋、防倒球、拉桿護弓、輪軸保護，支援 Aprilia、BMW、Ducati、Honda、KTM、Yamaha 等 9 大車廠逾 450 款車型。

**N°02 — FIM 唯一認證的引擎防護**

> GB Racing 不是外觀改裝——是有認證、有專利、有世界賽事背書的防護工程。

冠軍認證橫幅(alt: GB Racing 冠軍認證橫幅)。

信任狀四格:2007 · 品牌創立 · 英國 Lewis Banks 精密工程 / 2009 · FIM 認證 · 全球唯一認證引擎防護 / 2 · 英國專利 · 複合材質 · 磨損指示 / 450+ · 支援車型 · 九大主流車廠。

產品線(4 卡):Engine Covers「引擎護蓋」(潰縮式複合材質，摔車不磨破漏油)/ Frame Sliders「車架防倒球」(Race 內置 · Street 外露雙版本)/ Lever Guards「拉桿護弓」(防止短兵相接誤觸)/ Axle Sliders「輪軸防倒球」(前後輪軸心保護)。捲動提示「← 左右滑看四大產品線 →」。

圖片清單:`/brands/gb-racing/logo.webp`、`hero-champion.webp`、`engine-covers.webp`、`frame-sliders.webp`、`lever-guards.webp`、`axle-sliders.webp`。

---

### K-SPEED(KspeedShowcase.tsx)

骨架(推斷):N°01 三卡。N°02 = 標題+導言 → 品牌形象影片 facade → 兩段交錯圖文 → 四格信任狀。

**N°01 — 為什麼選 K-SPEED**

> 2002 年開在曼谷的小零件店，如今是 Honda、BMW、Royal Enfield 指名合作的全黑美學。

三卡:
1. **原廠指名的訂製設計** — Honda、BMW、Royal Enfield 都委託 K-SPEED 打造官方展演車——原廠把自家新車交到他手上改，改完掛原廠的名字展出。
2. **全黑化，不是隨便噴黑** — 以霧黑為基調、低而長的侵略性車身線條，配上 Tanadit 招牌曲面。整套 Diabolus 共用同一種語言，換到哪件都接得起來。
3. **小車改裝的天花板** — Rebel、Super Cub、CT125、Dax 125、Monkey 125——把一台通勤小車變成另一個世界的樣子，而且不犧牲原本的好騎好用。

**N°02 — 從一間小零件店，到全世界的街頭**

> 二十多年來只有一位設計者：創辦人兼 CEO Tanadit Sarawek。

品牌形象影片 facade(label「品牌形象影片 · K-SPEED」,YouTube ID `7y1Tz6vm6u4`「Rock Rod」)。

段落一(01 — Tanadit Design)「一個人的手，一整個品牌的樣子」:官方形容 Tanadit 的設計：大膽改寫既有車款的印象，靠獨有的曲線把整台車收成一體。冷冽、狂放、優美、現代這幾種矛盾的味道，他能同時放進同一台車而不打架。

段落二(02 — House of Custom Design)「不只改一台，是穩定供應全世界」:很多訂製車工房一輩子只做獨一無二的展示車。K-SPEED 走另一條路——把那些設計變成可量產、直上不用改車的 bolt-on 零件，穩定供應到世界各地。你買到的，就是展演車上的那一件。

信任狀四格:2002 · 品牌創立 · 泰國曼谷 / 3 大原廠 · 官方展演車 · Honda · BMW · Royal Enfield / Diabolus · 自有零件品牌 · 全黑化設計語言 / 全車套件 · 客製化改裝服務 · 從單一部品到 21 件全套。

圖片清單:`/brands/kspeed/logo.png`、`video-thumb.webp`、`tanadit.webp`、`supply.webp`。

---

### LighTech(LightechShowcase.tsx)

骨架(推斷):N°01 三卡。N°02 = 標題+導言 → 全寬 hero 大圖 → 兩段交錯圖文 → 四格信任狀 → 產品線水平捲(4 卡)。

**N°01 — 為什麼選 LighTech**

> 1997 年由前 SBK 車手 Fabrizio Furlan 創立，義大利 Treviso 自有 CNC 產線，把世界賽場的合作經驗做進每一顆腳踏與拉桿。

三卡:
1. **車手創辦、賽場出身** — 創辦人 Fabrizio Furlan 是前世界超級摩托車錦標賽車手，把家族製造專長帶進賽車部品——知道車手要什麼，也知道怎麼把它做出來。
2. **義大利自家產線、不外包** — Treviso 廠房 2,500 平方米，其中 1,400 平方米是 CNC 車銑產線——鋁合金、鈦合金到不鏽鋼，從開模到成品都在自己手上。
3. **品牌．車型．年式 三層對照** — 官方型錄按品牌、車型到年式逐層對應，孔位配好才出廠——選對年式直上，不用自己量孔距。

**N°02 — 從世界賽場做回街車的精品**

> 與 WSBK、MotoGP 等級車隊長年合作，2026 賽季仍在 Moto2 圍場裡——賽場驗證的工藝，下放到你的車上。

全寬 hero 圖(alt: LighTech 贊助的 Moto2 賽車與車手)。

段落一(Development · 研發)「賽場需求先行」:1997 年於義大利創立，長年為 WSBK、MotoGP、Moto2 車隊做技術支援——每一件街車部品，都從賽場的真實需求反推設計。

段落二(Manufacturing · 製造)「義大利 CNC 自製」:自有工廠 CNC 產線量產數千款 Ergal 航太鋁合金與鈦合金件，多色陽極處理，削切、上色、組裝一貫化。

信任狀四格:1997 · 品牌創立 · 前 SBK 車手 Fabrizio Furlan / 2,500㎡ · 義大利廠房 · Treviso · 1,400㎡ CNC 產線 / WSBK·GP · 車隊合作 · Superbike／MotoGP／Moto2／125GP / 2026 · 現役贊助 · Moto2 SYNC SPEEDRS TEAM。

產品線(4 卡):Carbon Paddock「碳纖維後駐車架」(Autoclave 碳纖承重結構，僅 2.1kg)/ R Version「R Version 腳踏後移」(整塊 7075-T6 切削，碳纖護跟、多段可調)/ Quick Release「快拆油箱蓋」(整塊切削、PUSH & PULL，義大利製)/ Track Detail「後照鏡孔蓋」(賽道拆鏡後的收尾，鋁合金切削)。捲動提示「← 左右滑看產品線 →」。

圖片清單:`/brands/lightech/logo.png`、`hero.jpg`、`story-rd.jpg`、`story-mfg.jpg`、`prod-01.jpg`、`prod-02.jpg`、`prod-03.jpg`、`prod-04.jpg`。

---

### Materya(MateryaShowcase.tsx,精簡版)

骨架(推斷):N°01 三卡。N°02(短版) = 標題(無導言) → 兩段交錯圖文(第一段用直式人像圖) → 三格信任狀 → 產品線水平捲(3 卡)。

**N°01 — 為什麼選 Materya**

> 米蘭設計師 Mirco Sapio 的工作室品牌——儀表護蓋、風鏡與小翼，3D 列印 × CNC × 碳纖，專車專用的義式細節。

三卡:
1. **設計師直營、不是公版模具** — 每件部品從手繪草圖、3D 建模到成品都出自創辦人之手，商品頁直接展示設計過程——買的是設計，不是開模貨。
2. **三種工藝並用** — 工業級 3D 列印、CNC 切削與碳纖維成型按部位選用——貼合度與質感優先，不遷就單一製程。
3. **專車專用、小廠溫度** — 每款對應特定車型年式開發、不是通用件；連官網評論都是創辦人本人回覆——義大利小廠的職人手感。

**N°02 — 車頭細節的義式收尾**(短版,標題無導言)

段落一(Studio · 米蘭工作室,直式人像圖)「用熱情設計，用精準製造」:源於多年的機車設計經驗，MATERYA 打造兼具風格、精準與性能的精品部品——從工業級 3D 列印、CNC 加工到碳纖工藝，交出貼合度與辨識度兼具的作品。

段落二(Craft · 碳纖工藝)「3D 列印 × CNC × 碳纖」:工業級 3D 列印做結構、CNC 精修細節、碳纖收尾——三種工藝並用，讓每件部品在車頭都對得上、也認得出。

信任狀三格:Milano · 設計製造 · 創辦人 Mirco Sapio 直營 / 3 · 工藝並用 · 3D 列印・CNC・碳纖 / 6 · 適配車廠 · BMW／KTM／Ducati／Triumph 等。

產品線(3 卡):Carbon Winglets「碳纖維定風翼」(與 CNC Racing 合作，碳纖外蓋、專車鎖點)/ Track Days Plate「車頭整流面板」(賽道日替代頭燈，整合 ActionCam 固定點)/ Carbon Dash「碳纖維儀表外蓋」(碳纖編織、保留 USB，與原車視覺整合)。捲動提示「← 左右滑看產品線 →」。

圖片清單:`/brands/materya/logo.png`、`founder.png`(alt: Materya 創辦人 Mirco Sapio,直式人像)、`craft.jpg`、`prod-01.jpg`、`prod-02.jpg`、`prod-03.jpg`。

---

### Motogadget(MotogadgetShowcase.tsx)

骨架(推斷):N°01 三卡。N°02 = 標題+導言 → 四格信任狀 → 一段交錯圖文 → 安裝說明影片 facade → 一段交錯圖文(flip) → 產品線水平捲(5 卡)。

**N°01 — 為什麼選 Motogadget**

> 2000 年創立的柏林電裝精品——mo.view 無框後視鏡、motoscope 儀表到 mo.unit 電控中樞，德國製造、專利逾百件。

三卡:
1. **德國工程、認證齊全** — 柏林 1,800 平方米自有廠房，ISO 9001 品質管理、TÜV 檢測——買德國電裝精品，不用賭來路。
2. **專利逾百件的原創設計** — 全球智慧財產逾百件，拿過 iF 與 Good Design 設計獎——玻璃無框鏡等獨門技術，仿品做不出同樣的光學品質。
3. **mo.unit 電控中樞** — 一顆整合保險絲、繼電器與閃爍器，所有按鍵開關直接接上——咖啡改裝最頭痛的線組，化繁為簡。

**N°02 — 把車頭改乾淨的德國答案**

> 從一支後視鏡到整車線組，Motogadget 的每件產品都在做同一件事——更少的體積，更精緻的機能。

信任狀四格:2000 · 柏林創立 · 機械工程師 Garrit Keller / 100+ · 全球專利 IP · 技術・設計雙重保護 / ISO·TÜV · 品質認證 · ISO 9001＋TÜV 檢測 / iF · 設計獎項 · iF＋Good Design Award。

段落一(Design · 無框工藝)「鏡面即結構」:mo.view 以拋光金屬鏡面取代傳統玻璃與邊框，專利 ULTRACUT 工序切削成型——無框，是把結構做進鏡面本身。

安裝說明影片 facade(label「安裝說明影片 · Motogadget」,YouTube ID `oqdV8WObU1Y`)。

段落二(Manufacturing · 柏林製造)「柏林自有工廠」:從切削、拋光到組裝都在柏林自有廠房完成，ISO 9001 品管、TÜV 檢測——德國製造，不只是一句標籤。

產品線(5 卡):mo.view Mirrors「無框後視鏡」(玻璃無框設計，車頭視覺瞬間輕)/ Lights「極簡方向燈」(圓盤造型 LED，車尾車側乾淨俐落)/ Electrics「電控中樞」(整合保險絲與繼電器，線組化繁為簡)/ Instruments「數位儀表」(半圓 LED 儀表，資訊集中不佔空間)/ Switches「把手開關」(鋁合金切削按鍵，握把區精緻化)。捲動提示「← 左右滑看產品線 →」。

圖片清單:`/brands/motogadget/logo.svg`、`story-design.jpg`、`story-mfg.jpg`、`prod-01.jpg`、`prod-02.jpg`、`prod-03.jpg`、`prod-04.png`、`prod-05.png`(影片縮圖動態取自 `https://img.youtube.com/vi/oqdV8WObU1Y/maxresdefault.jpg`)。

---

### Samco Sport(SamcoShowcase.tsx)

骨架(推斷):N°01 三卡。N°02 = 標題+導言 → 兩段交錯圖文 → 四格信任狀 → 產品線水平捲(3 卡)。

**N°01 — 為什麼選 Samco Sport**

> 英國南威爾斯手工製造的矽膠水管世界品牌，26 年只做一件事——MXGP、WorldSBK 車隊同款，終身保固。

三卡:
1. **英國手工製造 26 年** — 南威爾斯 Pontyclun 自有工廠，從矽膠原料到成品手工成型——原創高性能矽膠水管品牌，不是後起貼牌。
2. **終身保固、裝了就忘** — 原廠橡膠水管會熱老化龜裂爆管，矽膠不會——官方稱「Fit and Forget」，全系列水管終身保固，一次換到底。
3. **車型專用、原廠直上** — 按車型開發整組替換套件，Race Fit 與 OEM Fit 兩種版本——彎角走向照原廠水路，不用自己剪萬用管湊。

**N°02 — 水冷系統的最後一次升級**

> 老車救星也是賽車標配——水管換過一次 Samco，之後只需要挑顏色。

段落一(Development · 研發)「車型專屬直上件」:每組水管都對照原廠管路開發，免裁免改直接替換——WSBK 等級賽事車隊，用的也是同一套規格。

段落二(Manufacturing · 製造)「英國威爾斯手工製」:於英國威爾斯自有工廠，由熟練技師以歐洲高級矽膠一層一層手工疊出，耐高溫、耐老化。

信任狀四格:26 年 · 英國製造 · 原創矽膠水管品牌 / Lifetime · 終身保固 · 全系列性能矽膠水管 / MXGP · 賽事供應 · Monster Energy Kawasaki 等 / Wales · 自有工廠 · Pontyclun 手工製造。

產品線(3 卡):Hose Kits「全車水管套件」(車型專用整組替換，多層補強、多色可選)/ Clamp Kits「不鏽鋼束環」(圓角無穿孔設計，與水管成對的專用束環組)/ Race Development「賽事技術合作」(與世界超級摩托車錦標賽車隊共同開發驗證)。捲動提示「← 左右滑看產品線 →」。

圖片清單:`/brands/samco/logo.png`、`story-rd.jpg`、`story-mfg.jpg`、`prod-hose.jpg`、`prod-clamp.jpg`、`prod-race.jpg`。

---

## 第二部分:現行「商品規格」與「商品介紹」區(工作樹現行、還活著)

主檔:`apps/storefront/src/components/ProductTabs.tsx`。子元件:`InstallResources.tsx`(安裝資源側欄)。共用資料:`apps/storefront/src/data/rpm-policies.ts`(保固/退換文案單一真相)。

### 整體版面骨架(推斷,來自 JSX/className)

商品詳情頁下半部是一組**手風琴收合面板**(原生 `<details>`,非自訂 JS),共 4 段、每段一個 `<details class="pd-sec">`:
1. `#pd-sec-description` 商品介紹(預設展開 `open`)
2. `#pd-sec-specs` 規格 / 相容性(預設收合)
3. `#pd-sec-install` 安裝須知(預設收合)
4. `#pd-sec-warranty` 保固與退換(預設收合)

每段標題列(`<summary class="pd-sec-sum">`)固定三個元素:英文小標(pd-sec-eyebrow,如 "Overview"/"Specs"/"Install"/"Warranty")+ 中文標題(h2)+ 右側收合提示 chip(pd-sec-hint,例如「重點 4 項」「9 項規格」「影片 · 說明書 · 步驟」「客製訂製 · 鑑賞期」)+ 展開箭頭圖示。

版面依內容型態分排(手機一律單欄堆疊):
- 商品介紹/保固 = 單欄文字流(`pd-sec-flow`)+ 左側色條 callout(重點=紅色、退換要點=中性金色)
- 規格 = 桌機兩欄(`pd-specs-2col`)key/value 列表
- 安裝 = 桌機「主文左 + 安裝資源側欄右」(`pd-sec-split pd-sec-split-media`,僅在有安裝資源時才排側欄,否則主文全寬)

---

### 商品介紹區(`#pd-sec-description`)

三種渲染分支,依商品資料狀態擇一:

1. **RPM 碳纖商品**(`product.brandSlug === 'rpm-carbon'`)— 固定兩段文字,字面模板(粗體部分為 `{product.brand} {product.name}` 與 `{product.fits}` 動態代入):
   > **{品牌} {品名}** 採用真碳纖維材質，為 **{適用車款}** 開發；換上碳纖維後比原廠塑件更輕、更有質感，強度也更高。
   >
   > 對應原廠孔位、可直接安裝，**不需要改線組**。下單時請依愛車狀況選好紋路、表面與是否要加強化款 12K。

2. **非 RPM、有 `product.description`** — 依 `\n\n` 分段,逐段渲染成 `<p>`(純文字轉義、不支援 HTML)。

3. **非 RPM、無 description** — 最小事實 fallback:
   > **{品牌} {品名}** · 適用 {product.fits}(若 `fits` 非「通用款」才附此句)

介紹區下方固定接一個**紅色左條「重點」callout**(`pd-callout pd-callout-hl`,標籤文字「重點」),清單內容:
- RPM 碳纖商品固定 4 點:「真碳纖維材質，非塑膠仿碳貼皮」/「對應原廠孔位，Plug & Play」/「四款紋路 × 兩款表面，蜂巢另收特殊紋費」/ 通用 LINE 提醒句
- 非 RPM 商品:`product.highlights[]`(資料庫來的賣點陣列)+ 通用 LINE 提醒句

通用 LINE 提醒句字面(所有品牌重點清單最後一條):
> 零件多為接單後向原廠訂購，供貨與交期依原廠狀況變動，建議下單前先以 LINE 諮詢交期，確保零件準時送達。

收合提示 chip 字面:「重點 {N} 項」(N = highlightItems 陣列長度)。

---

### 規格 / 相容性區(`#pd-sec-specs`)

桌機兩欄 key/value 列表(`pd-specs-2col`),固定欄位 + 條件欄位:

**固定欄位(所有商品都有)**:
| 欄位 label | 值來源 |
|---|---|
| 品牌 | `product.brand` |
| 產品型號 | `product.productCode`(無則 fallback `product.slug`) |
| 商品分類 | `product.category` |
| 適用車款 | `product.fits`(無則顯「通用款」);若 `product.fitments` 陣列非空,額外附一行文字「完整適用車款請見頁面上方「適用車款」對照表」,交叉引用頁面上方另一個獨立表格 `ProductFitments` |

**RPM 碳纖商品專屬欄位**(byte 不變、寫死,非資料驅動):
| 欄位 label | 固定值 |
|---|---|
| 材質 | 真碳纖維（Carbon Fiber） |
| 紋路可選 | 斜紋 / 平織 / 鍛造 / 蜂巢 / 12K — 五款紋路（12K 為加強紋路樣式，部分品項提供） |
| 表面可選 | 亮光 / 消光（蜂巢只有亮光，消光蜂巢為特別訂製） |
| 產地 | 泰國 |
| 特殊樣式 | 彩色碳纖、消光蜂巢等 — 訂購約 1–4 個月 |

**非 RPM 商品的規格欄位是「資料驅動」**——不是寫死清單,而是掃描 `product.variants[].spec`(每個 variant 是一個 key/value 物件)裡實際出現過的 key,每個 distinct key 生一列、多個值用 `/` 併接、空值/空白值不列入。目前已知的 key → 中文 label 對照表(`SPEC_LABEL`,未知 key 會直接顯示原 key 字面):

| spec key | 中文 label |
|---|---|
| color | 顏色 |
| material | 材質 |
| weave | 紋路 |
| finish | 表面 |
| special | 特殊樣式 |
| size | 尺寸 |

收合提示 chip 字面:「{N} 項規格」(RPM 固定 9 項;非 RPM = 4 個固定欄位 + 資料驅動列數)。

---

### 安裝須知區(`#pd-sec-install`)

全品牌通用(不分 RPM/非 RPM)。主文區塊固定內容:

**meta 三欄**:
- 難度:因品而異
- 建議:交給專業技師
- 工具:基本機車手工具

**說明段落**:
> 每件部品的安裝方式略有不同，原則上都是**對應原廠孔位、直接鎖上**，不需要改裝線組。建議由有經驗的技師安裝，鎖緊力道要適中，避免過度鎖付造成部品受損。如果不確定，可以預約 PCM 合作店家協助處理。

**三點清單**:
- 裝前先把原廠零件螺絲位置記清楚或拍照
- 鎖螺絲時對角分段鎖緊，避免單點受力
- 第一次騎乘後再檢查一次螺絲扭力

**右側欄「安裝資源」面板**(僅商品有 `manuals` 或 `videoUrl` 才顯示,否則主文全寬,不排側欄):
- 影片(可選,三種格式擇一自動判斷):YouTube / Vimeo → facade 縮圖+紅播放鈕、點擊才載入 iframe;`.mp4/.webm/.m4v/.mov` 直檔 → 原生 `<video controls>`
- 說明書 PDF(可選,可多筆):小型下載 chip 列,每筆顯示 `m.label`(檔名/標題)+「PDF · {大小}」(有 `sizeKB` 才顯示檔案大小)

**段尾全寬 CTA 深色條**:
- 標題:不想自己裝？
- 副標:全台合作店家可以幫你直接搞定
- 按鈕:預約安裝 →(點擊導向 `/install`)

收合提示 chip 字面:「影片 · 說明書 · 步驟」(依實際有無影片/說明書動態組合,「步驟」固定顯示)。

---

### 保固與退換區(`#pd-sec-warranty`)

全品牌共用同一份政策文字(來源 `rpm-policies.ts`,與商品頁 FAQ 區、`/info/shipping` 頁三處共用、不得各自分歧)。

**正文四段**(粗體為原文加粗片段):
1. 多數商品是**接單後才向原廠訂製的客製商品**，訂單成立後沒辦法取消或改單，麻煩下單前先確認好車款與款式。
2. 收到商品請先檢查，如果有**瑕疵**、或是我們出錯（寄錯、出錯件），請在**收貨 7 天內**用 LINE 告訴我們，我們會負責換貨處理。
3. 退換貨時商品需維持**全新未安裝、原始包裝完整**（含外盒、收據、配件）；一旦安裝過或有使用痕跡，就沒辦法退換了。
4. 關於鑑賞期：本賣場屬於**客製化委任代購**，依《消費者保護法》第 19 條第 1 項，這類客製、代訂商品**不適用 7 天鑑賞期**。鑑賞期是讓你確認商品符不符合需求，不是商品的試用期——這點先跟你說明，下單前確認好就沒問題。

**「退換要點」金色左條 callout,三點**:
1. 瑕疵認定：紋路明顯錯位、表面破損、孔位偏差、超過合理公差範圍
2. 不在範圍：人為碰撞、摔車、不當安裝、自行加工
3. 有問題請加 LINE：**@pcmmoto** · 週一–週六 10:00–19:00

收合提示 chip 字面(固定文字,非動態):「客製訂製 · 鑑賞期」。
