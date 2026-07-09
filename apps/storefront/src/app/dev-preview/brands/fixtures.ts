// fixtures.ts — /dev-preview/brands 品牌放量 demo 用「報價單 view 真資料 snapshot」(2026-07-10 夜 scout 拉取)
// 產生方式:scratchpad fetch-brand-source.ts 唯讀拉 storefront_catalog_v → 本檔快照(kickoff §2-6)。
// 🔴 dev-preview 專用、非商城資料鏈;正式資料走 rpm-import 同步管線。欄位皆公開安全(view 無經銷價)。

export type FixtureProduct = {
  mainSku: string; nameZh: string; cat: string; img: string;
  vehicle: string | null; price: number | null; pdfs: number; video: string | null;
};
export type BrandFixture = {
  supplierSlug: string; brandSlug: string; groups: number; variants: number;
  pdfGroups: number; videoGroups: number; topCats: { cat: string; groups: number }[];
  products: FixtureProduct[]; videoSamples: string[];
};

export const BRAND_FIXTURES: Record<string, BrandFixture> = {
  'evotech': {
    supplierSlug: 'evotech',
    brandSlug: 'evotech',
    groups: 3460, variants: 3460,
    pdfGroups: 0, videoGroups: 0,
    topCats: [{ cat: "周邊配件", groups: 1527 }, { cat: "操控部品", groups: 1061 }, { cat: "後視鏡", groups: 241 }, { cat: "引擎部品", groups: 213 }, { cat: "車殼外觀", groups: 211 }],
    products: [
      { mainSku: "HDW004551", nameZh: "機車替換式尾燈", cat: "周邊配件", img: "https://cdn.shopify.com/s/files/1/1502/8810/files/Evotech-BMW-Replacement-LED-Rear-Light-63218546523-63218551834-63217711000-Clear-Lens.jpg?v=1733751402", vehicle: "Suzuki GSX-8S", price: 4480, pdfs: 0, video: null },
      { mainSku: "ITM36754", nameZh: "品牌貼紙（白色）", cat: "周邊配件", img: "https://cdn.shopify.com/s/files/1/1502/8810/files/Evotech_Decal_White-removebg-preview.png?v=1724139123", vehicle: null, price: 80, pdfs: 0, video: null },
      { mainSku: "PRN002188-003252-003315", nameZh: "Evo 可折疊離合器拉桿與短版煞車拉桿組", cat: "操控部品", img: "https://cdn.shopify.com/s/files/1/1502/8810/products/Evotech-Performance-EP-Folding-Clutch-Short-Brake-Lever-Set-CC_5694c9ac-a6df-46b0-b9f6-70dea6d43ab7.jpg?v=1707832479", vehicle: "BMW S 1000 RR", price: 7480, pdfs: 0, video: null },
      { mainSku: "PRN002188-003256-003315", nameZh: "Evo 短版煞車離合器拉桿組", cat: "操控部品", img: "https://cdn.shopify.com/s/files/1/1502/8810/files/Evotech-Performance-EP-Short-Brake-Clutch-Lever-Cable-Hydraulic-set_c977ee38-b193-4229-b58f-abad5abf170a.jpg?v=1707488355", vehicle: "BMW S 1000 R", price: 7480, pdfs: 0, video: null },
      { mainSku: "PRN013310", nameZh: "後照鏡外移座", cat: "後視鏡", img: "https://cdn.shopify.com/s/files/1/1502/8810/files/013310-Rev2_4139427b-4101-4325-9b07-4012639f7285.jpg?v=1748854157", vehicle: "Ducati Scrambler Icon", price: 2580, pdfs: 0, video: null },
      { mainSku: "PRN015536-015554-016058-016459-016469-016517-016518", nameZh: "端子後照鏡與煞車離合器拉桿護弓組（復古款）", cat: "後視鏡", img: "https://cdn.shopify.com/s/files/1/1502/8810/files/EVOTEC_2_14cac822-6762-43be-9f6a-70810386f1bd.jpg?v=1693897874", vehicle: "BMW G 310 R", price: 14880, pdfs: 0, video: null },
    ],
    videoSamples: [],
  },
  'lightech': {
    supplierSlug: 'lightech',
    brandSlug: 'lightech',
    groups: 4566, variants: 8788,
    pdfGroups: 2019, videoGroups: 0,
    topCats: [{ cat: "操控部品", groups: 3872 }, { cat: "車殼外觀", groups: 411 }, { cat: "後視鏡", groups: 69 }, { cat: "駐車架", groups: 62 }, { cat: "燈具方向燈", groups: 46 }],
    // ⚠ lightech 來源變體圖大宗為 http://lightechmarketplace.com(#275、https 連線 reset)→ demo 走 https tunnel
    //   會 mixed content 破圖 → https 圖前置(demo 頁取前 4)、http 例留在後(adversarial F7;快照值未改、僅排序)
    //   + 0011M 兩筆換上已驗 200 的 lightech.it https 同檔名鏡像(showcase R1 同法)。
    products: [
      { mainSku: "CAR001", nameZh: "碳纖維鏈條蓋", cat: "車殼外觀", img: "https://lightech.it/images_web/variante/1200x/CAR001.JPG", vehicle: null, price: 2700, pdfs: 0, video: null },
      { mainSku: "KPS011", nameZh: "端子後照鏡轉接座套組", cat: "後視鏡", img: "https://lightech.it/images_web/variante/1200x/KPS011.JPG", vehicle: "KTM 125 Duke", price: 200, pdfs: 0, video: null },
      { mainSku: "KPS033", nameZh: "端子後照鏡轉接座套組", cat: "後視鏡", img: "https://lightech.it/images_web/variante/1200x/KPS033.JPG", vehicle: "Yamaha T Max 560", price: 600, pdfs: 0, video: null },
      { mainSku: "0011M04", nameZh: "M4 自鎖螺帽", cat: "操控部品", img: "https://lightech.it/images_web/variante/1200x/0011M-COB.JPG", vehicle: null, price: 200, pdfs: 0, video: null },
      { mainSku: "0011M05", nameZh: "7075鋁合金M5自鎖螺帽", cat: "操控部品", img: "https://lightech.it/images_web/variante/1200x/0011M-COB.JPG", vehicle: null, price: 200, pdfs: 0, video: null },
      { mainSku: "CAR007", nameZh: "碳纖維卡鉗散熱導風罩", cat: "車殼外觀", img: "http://www.lightechmarketplace.com/Content/Foto/Prodotti/800x800_CROP/CAR007 COPIA.JPG", vehicle: null, price: 8700, pdfs: 0, video: null },
    ],
    videoSamples: [],
  },
  'cnc-racing': {
    supplierSlug: 'cncracing',
    brandSlug: 'cnc-racing',
    groups: 1978, variants: 4376,
    pdfGroups: 1008, videoGroups: 55,
    topCats: [{ cat: "操控部品", groups: 810 }, { cat: "車殼外觀", groups: 397 }, { cat: "車架", groups: 197 }, { cat: "引擎部品", groups: 196 }, { cat: "傳動齒比", groups: 126 }],
    products: [
      { mainSku: "CEA01", nameZh: "換檔連桿 90 mm", cat: "操控部品", img: "https://www.cncracing.com/images_web/prod/1200x/CEA01B.jpg", vehicle: null, price: 1600, pdfs: 0, video: null },
      { mainSku: "CEA02", nameZh: "換檔連桿組", cat: "操控部品", img: "https://www.cncracing.com/images_web/prod/1200x/CEA02B.jpg", vehicle: null, price: 1600, pdfs: 0, video: null },
      { mainSku: "CS805", nameZh: "後照鏡孔蓋", cat: "車殼外觀", img: "https://www.cncracing.com/images_web/variante/1200x/CS805B.jpg", vehicle: "Aprilia RSV4 Factory", price: 4500, pdfs: 3, video: null },
      { mainSku: "PL150", nameZh: "碳纖維煞車拉桿護弓（賽道版・亮光）", cat: "車殼外觀", img: "https://www.cncracing.com/images_web/variante/1200x/PL150KB.jpg", vehicle: "Aprilia Dorsoduro 1200", price: 9600, pdfs: 10, video: null },
      { mainSku: "AP001", nameZh: "鋁合金後避震搖臂連桿套組", cat: "車架", img: "https://www.cncracing.com/images_web/variante/1200x/AP001B.jpg", vehicle: "Ducati Panigale 1199", price: 10500, pdfs: 2, video: null },
      { mainSku: "AP002", nameZh: "後避震連桿", cat: "車架", img: "https://www.cncracing.com/images_web/prod/1200x/AP002B_AP002G_AP002R.jpg", vehicle: "Ducati Panigale 1199", price: 9400, pdfs: 3, video: null },
    ],
    videoSamples: ["https://vimeo.com/249645925", "https://vimeo.com/720181489", "https://vimeo.com/1127863961"],
  },
  'eazi-grip': {
    supplierSlug: 'eazigrip',
    brandSlug: 'eazi-grip',
    groups: 1740, variants: 5273,
    pdfGroups: 0, videoGroups: 0,
    topCats: [{ cat: "周邊配件", groups: 1247 }, { cat: "車殼外觀", groups: 429 }, { cat: "引擎部品", groups: 64 }],
    products: [
      { mainSku: "BADGE", nameZh: "油箱止滑貼", cat: "周邊配件", img: "https://www.eazi-grip.com/wp-content/uploads/BADGEBL.jpg", vehicle: null, price: 80, pdfs: 0, video: null },
      { mainSku: "BUNAPR001", nameZh: "套裝組合", cat: "周邊配件", img: "https://www.eazi-grip.com/wp-content/uploads/BUNAPR001EB-2.jpg", vehicle: "Aprilia RSV4", price: 7130, pdfs: 0, video: null },
      { mainSku: "DASGDUC004", nameZh: "儀表板保護貼", cat: "車殼外觀", img: "https://www.eazi-grip.com/wp-content/uploads/DASHDUC004-5-6.jpg", vehicle: "Ducati Hypermotard 796", price: 1130, pdfs: 0, video: null },
      { mainSku: "DASHAPR001", nameZh: "儀表板保護貼", cat: "車殼外觀", img: "https://www.eazi-grip.com/wp-content/uploads/DASHAPR001-2-3-4-5-10-11.jpg", vehicle: "Aprilia RSV4", price: 830, pdfs: 0, video: null },
      { mainSku: "CLAMPBMW001", nameZh: "矽膠水管組", cat: "引擎部品", img: "https://www.eazi-grip.com/wp-content/uploads/HOSEBMW002-scaled.jpg", vehicle: "BMW S 1000 RR", price: 1320, pdfs: 0, video: null },
      { mainSku: "CLAMPBMW002", nameZh: "矽膠水管組", cat: "引擎部品", img: "https://www.eazi-grip.com/wp-content/uploads/HOSEBMW002-scaled.jpg", vehicle: "BMW S 1000 RR", price: 1320, pdfs: 0, video: null },
    ],
    videoSamples: [],
  },
  'samco': {
    supplierSlug: 'samco',
    brandSlug: 'samco',
    groups: 1403, variants: 14165,
    pdfGroups: 0, videoGroups: 0,
    topCats: [{ cat: "引擎部品", groups: 686 }, { cat: "周邊配件", groups: 671 }, { cat: "四輪 ATV/UTV", groups: 46 }],
    products: [
      { mainSku: "AGU-1", nameZh: "防爆水管 12件組", cat: "引擎部品", img: "https://racebikebitzusa.com/image/cache/catalog/MV%20Agusta/AGU-1-BK-agusta-f4-1000-2001-2009-Samco-silicone-radiator-hose-kit-800x800.jpg", vehicle: "MV Agusta F4 1000", price: 12100, pdfs: 0, video: null },
      { mainSku: "AGU-2", nameZh: "防爆水管 12件組", cat: "引擎部品", img: "https://racebikebitzusa.com/image/cache/catalog/MV%20Agusta/AGU-2-BK-brutale-750-910-989-r-2001-2012-Samco-silicone-radiator-hose-kit-800x800.jpg", vehicle: "MV Agusta Brutale 750", price: 12100, pdfs: 0, video: null },
      { mainSku: "CK APR-19", nameZh: "束環套件", cat: "周邊配件", img: "https://racebikebitzusa.com/image/cache/catalog/Clip%20Kits/CK-Hose-Clamp-Main-Listing-Image-001-800x800.jpg", vehicle: "Aprilia Tuono 1000 R", price: 2000, pdfs: 0, video: null },
      { mainSku: "CK KAW-102", nameZh: "束環套件", cat: "周邊配件", img: "https://racebikebitzusa.com/image/cache/catalog/Clip%20Kits/CK-Hose-Clamp-Main-Listing-Image-001-800x800.jpg", vehicle: "Kawasaki Z H2", price: 3900, pdfs: 0, video: null },
      { mainSku: "ARC-1", nameZh: "防爆水管 2件組", cat: "四輪 ATV/UTV", img: "https://racebikebitzusa.com/image/cache/catalog/Arctic/ARC-1-BU-arctic-fox-arctic-cat-400-2003-2007-Samco-silicone-radiator-hose-kit-800x800.JPG", vehicle: null, price: 4500, pdfs: 0, video: null },
      { mainSku: "CKARC-1", nameZh: "束環套件", cat: "四輪 ATV/UTV", img: "https://racebikebitzusa.com/image/cache/catalog/Clip%20Kits/CK-Hose-Clamp-Main-Listing-Image-001-800x800.jpg", vehicle: null, price: 1100, pdfs: 0, video: null },
    ],
    videoSamples: [],
  },
  'motogadget': {
    supplierSlug: 'motogadget',
    brandSlug: 'motogadget',
    groups: 912, variants: 912,
    pdfGroups: 0, videoGroups: 0,
    topCats: [{ cat: "騎士好物", groups: 519 }, { cat: "電子系統", groups: 169 }, { cat: "操控部品", groups: 94 }, { cat: "後視鏡", groups: 91 }, { cat: "燈具方向燈", groups: 39 }],
    products: [
      { mainSku: "9007054", nameZh: "防霧超細纖維布", cat: "騎士好物", img: "https://cdn.shopify.com/s/files/1/0678/3221/7868/files/mg-tuch_968618f3-26fe-4492-a119-5c726e4a9c64_1024x.png?v=1741168281", vehicle: null, price: 400, pdfs: 0, video: null },
      { mainSku: "9007056", nameZh: "Loctite 243 螺絲固定膠", cat: "騎士好物", img: "https://cdn.shopify.com/s/files/1/0678/3221/7868/files/243_10_1024x.jpg?v=1772694071", vehicle: null, price: 1300, pdfs: 0, video: null },
      { mainSku: "0003084", nameZh: "纖維編織套管 12.7mm", cat: "電子系統", img: "https://cdn.shopify.com/s/files/1/0678/3221/7868/files/Gewebeschlauch_neu_1024x.png?v=1753692592", vehicle: null, price: 300, pdfs: 0, video: null },
      { mainSku: "0003085", nameZh: "纖維編織套管 12.7mm", cat: "電子系統", img: "https://cdn.shopify.com/s/files/1/0678/3221/7868/files/Gewebeschlauch_neu_1024x.png?v=1753692592", vehicle: null, price: 300, pdfs: 0, video: null },
      { mainSku: "4000340", nameZh: "mo.switch mini 把手開關", cat: "操控部品", img: "https://cdn.shopify.com/s/files/1/0678/3221/7868/files/moswitch-mini-1_21ff8661-106a-4ca9-a2bf-306d0b17766e_1024x.png?v=1741167841", vehicle: null, price: 7000, pdfs: 0, video: null },
      { mainSku: "4000341", nameZh: "mo.switch mini 把手開關", cat: "操控部品", img: "https://cdn.shopify.com/s/files/1/0678/3221/7868/files/mo.switch_pol_06_hr_d031d726-e3dc-42bd-8c59-1a82ae67ab1c_1024x.jpg?v=1741167841", vehicle: null, price: 7100, pdfs: 0, video: null },
    ],
    videoSamples: [],
  },
  'front3d': {
    supplierSlug: 'front3d',
    brandSlug: 'front3d',
    groups: 108, variants: 108,
    pdfGroups: 0, videoGroups: 0,
    topCats: [{ cat: "煞車系統", groups: 60 }, { cat: "車殼外觀", groups: 40 }, { cat: "操控部品", groups: 8 }],
    products: [
      { mainSku: "F3D-BC-001", nameZh: "卡鉗散熱導風罩", cat: "煞車系統", img: "https://cdn.shopify.com/s/files/1/0813/4629/8188/files/CameraKeyframeAnimation-OrbitInterpolation.695_1024x.png?v=1769462260", vehicle: "Yamaha YZF-R9", price: 4200, pdfs: 0, video: null },
      { mainSku: "F3D-BC-003", nameZh: "卡鉗散熱導風罩", cat: "煞車系統", img: "https://cdn.shopify.com/s/files/1/0813/4629/8188/files/CameraKeyframeAnimation-OrbitInterpolation.517_1024x.png?v=1753729530", vehicle: "BMW F 900 R", price: 4200, pdfs: 0, video: null },
      { mainSku: "F3D-DSW-001", nameZh: "雙側定風翼 標準亮面", cat: "車殼外觀", img: "https://cdn.shopify.com/s/files/1/0813/4629/8188/files/CameraKeyframeAnimation-OrbitInterpolation.508_1024x.png?v=1744647542", vehicle: "Triumph Street Triple 765 R/RS", price: 9800, pdfs: 0, video: null },
      { mainSku: "F3D-DSW-002", nameZh: "雙側定風翼 待烤漆霧面", cat: "車殼外觀", img: "https://cdn.shopify.com/s/files/1/0813/4629/8188/files/CameraKeyframeAnimation-OrbitInterpolation.508_1024x.png?v=1744647542", vehicle: "Triumph Street Triple 765 R/RS", price: 7000, pdfs: 0, video: null },
      { mainSku: "F3D-OTH-002", nameZh: "齒盤護蓋", cat: "操控部品", img: "https://cdn.shopify.com/s/files/1/0813/4629/8188/files/CameraKeyframeAnimation-OrbitInterpolation.509_1024x.png?v=1744830895", vehicle: "Triumph Street Triple 765 R/RS", price: 2500, pdfs: 0, video: null },
      { mainSku: "F3D-OTH-004", nameZh: "後牌架 2 含牌照燈", cat: "操控部品", img: "https://cdn.shopify.com/s/files/1/0813/4629/8188/files/CameraKeyframeAnimation-OrbitInterpolation.331_1024x.png?v=1723452585", vehicle: "KTM EXC/EXC-F", price: 2900, pdfs: 0, video: null },
    ],
    videoSamples: [],
  },
  'materya': {
    supplierSlug: 'materya',
    brandSlug: 'materya',
    groups: 54, variants: 90,
    pdfGroups: 0, videoGroups: 0,
    topCats: [{ cat: "車殼外觀", groups: 52 }, { cat: "操控部品", groups: 1 }, { cat: "騎士好物", groups: 1 }],
    products: [
      { mainSku: "MTY001", nameZh: "儀表外蓋", cat: "車殼外觀", img: "https://materya.shop/wp-content/uploads/2025/04/amz_001.png", vehicle: "KTM 1290 Super Duke R", price: 3300, pdfs: 0, video: null },
      { mainSku: "MTY002", nameZh: "儀表外蓋", cat: "車殼外觀", img: "https://materya.shop/wp-content/uploads/2020/03/1290R_3.0_5_SHOP_Materya.jpg.jpg", vehicle: "KTM 1290 Super Duke R", price: 3300, pdfs: 0, video: null },
      { mainSku: "MATERYA-3172", nameZh: "風鏡螺絲", cat: "操控部品", img: "https://materya.shop/wp-content/uploads/2021/09/SHOP_Materya_screws_black.png", vehicle: "Ducati Multistrada V4", price: 3400, pdfs: 0, video: null },
      { mainSku: "MTY111", nameZh: "煞車油杯套", cat: "騎士好物", img: "https://materya.shop/wp-content/uploads/2024/12/Cuff2.png", vehicle: null, price: 1400, pdfs: 0, video: null },
    ],
    videoSamples: [],
  },
  'ebc': {
    supplierSlug: 'ebc',
    brandSlug: 'ebc',
    groups: 68, variants: 112,
    pdfGroups: 0, videoGroups: 45,
    topCats: [{ cat: "煞車系統", groups: 68 }],
    products: [
      { mainSku: "EBC-PAD-016", nameZh: "EBC GPFAX016HH 賽道用煞車皮", cat: "煞車系統", img: "https://pub-267d5f9578a344cc92267571caab1743.r2.dev/ebc/FA016.jpg", vehicle: "Triumph Ducati 2 piston Ducati 750 Sport", price: 5500, pdfs: 0, video: "https://www.youtube.com/watch?v=Vp2g_WKppkw" },
      { mainSku: "EBC-PAD-018", nameZh: "EBC FA018HH 前後煞車皮", cat: "煞車系統", img: "https://pub-267d5f9578a344cc92267571caab1743.r2.dev/ebc/FA018.jpg", vehicle: "BMW K 100", price: 2100, pdfs: 0, video: null },
    ],
    videoSamples: ["https://www.youtube.com/watch?v=Vp2g_WKppkw", "https://www.youtube.com/watch?v=IxMUWSTcHlA", "https://www.youtube.com/watch?v=kv65ykvQhhs"],
  },
};
