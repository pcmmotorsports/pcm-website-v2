// rpm-swatches.ts — RPM Carbon 碳纖維「紋路 × 表面」樣品資料(固定 10 張、全 RPM 商品共用)
//
// 來源:OD 模板 product-detail-rpm-template.html N°02 紋路樣式牆(open-design "Website V2")。
// 字面 + 圖片 URL **直接搬 OD 模板**(鐵則 1):圖在模板裡是 Shopee 圖床遠端 URL、非本地資產,
// 故 storefront 直接引用同 URL、不需新增圖檔(plain <img>、無 next/image domain whitelist 需求)。
//
// 共用對象:
//   - OD-7b ProductSwatchWall(N°02 紋路樣式牆、靜態圖片牆、依 surface 分亮光/消光兩組)
//   - OD-7c ProductInfo picker 預覽卡(選紋路×表面 → 對應樣品圖、含 fallback)
//
// ⚠️ 這 10 張是 **RPM 品牌通用碳纖維紋路樣品**(全商品同一份、非 per-product 變體實拍);
//    OD 模板 N°02 即為品牌級固定展示(HANDOFF §2 RPM 共用區塊)。Phase 1 catalog RPM-only。
//
// weave/special/surface 欄供 OD-7c picker→樣品圖對應用(picker 維度見 ProductInfo:
//   紋路 pattern = weave+special、表面 finish);Shopee 圖床若失效屬 Phase 2 自架資產議題(backlog)。

export type SwatchSurface = 'glossy' | 'matte';
export type SwatchWeave = 'Twill' | 'Plain' | 'Forged' | 'Honeycomb';

export type RpmSwatch = {
  weave: SwatchWeave;
  special?: '12K'; // 12K 加強款(亮光 only);消光蜂巢屬特別訂製(rare、無 special)
  surface: SwatchSurface;
  name: string; // 斜紋 / 12K 斜紋 / 消光蜂巢(顯示名)
  meta: string; // Twill · Glossy(mono 副標)
  img: string; // 完整 Shopee 圖床 URL
  alt: string;
  tag?: string; // 12K / 特別訂製(卡片左上角徽章)
  rare?: boolean; // 金色徽章樣式(is-rare)
};

const CDN = 'https://down-sg.img.susercontent.com/';

export const RPM_SWATCHES: RpmSwatch[] = [
  // —— 亮光款 Glossy(6 種:4 標準紋路 + 2 款 12K 加強)——
  { weave: 'Twill', surface: 'glossy', name: '斜紋', meta: 'Twill · Glossy', img: `${CDN}tw-11134211-81zto-mhhaeyw97bpc01`, alt: '亮光 斜紋碳纖維 樣品' },
  { weave: 'Plain', surface: 'glossy', name: '平織', meta: 'Plain · Glossy', img: `${CDN}tw-11134211-81ztp-mhhaeyw2ap6q08`, alt: '亮光 平織碳纖維 樣品' },
  { weave: 'Forged', surface: 'glossy', name: '鍛造', meta: 'Forged · Glossy', img: `${CDN}tw-11134211-81ztg-mhhaeyw5rpqb88`, alt: '亮光 鍛造碳纖維 樣品' },
  { weave: 'Honeycomb', surface: 'glossy', name: '蜂巢', meta: 'Honeycomb · Glossy', img: `${CDN}tw-11134211-81zth-mhhaeywebc3l79`, alt: '亮光 蜂巢碳纖維 樣品' },
  { weave: 'Twill', special: '12K', surface: 'glossy', name: '12K 斜紋', meta: '12K Twill · 加強', img: `${CDN}tw-11134211-81ztj-mhhaeyvzre9y7c`, alt: '亮光 12K 斜紋碳纖維 樣品', tag: '12K', rare: true },
  { weave: 'Plain', special: '12K', surface: 'glossy', name: '12K 平織', meta: '12K Plain · 加強', img: `${CDN}tw-11134211-81zti-mhhaeyvzssuea4`, alt: '亮光 12K 平織碳纖維 樣品', tag: '12K', rare: true },
  // —— 消光款 Matte(4 種:3 標準紋路 + 1 款消光蜂巢特別訂製)——
  { weave: 'Twill', surface: 'matte', name: '斜紋', meta: 'Twill · Matte', img: `${CDN}tw-11134211-81ztm-mhhaeyw17dac4d`, alt: '消光 斜紋碳纖維 樣品' },
  { weave: 'Plain', surface: 'matte', name: '平織', meta: 'Plain · Matte', img: `${CDN}tw-11134211-81ztc-mhhaeyvxgirp7b`, alt: '消光 平織碳纖維 樣品' },
  { weave: 'Forged', surface: 'matte', name: '鍛造', meta: 'Forged · Matte', img: `${CDN}tw-11134211-81ztl-mhhaeywaj30mbf`, alt: '消光 鍛造碳纖維 樣品' },
  { weave: 'Honeycomb', surface: 'matte', name: '消光蜂巢', meta: 'Matte Honeycomb · 特別', img: `${CDN}tw-11134211-820l7-mowc55dcubyj1d`, alt: '消光 蜂巢碳纖維 樣品', tag: '特別訂製', rare: true },
];

export const RPM_SWATCHES_GLOSSY: RpmSwatch[] = RPM_SWATCHES.filter((s) => s.surface === 'glossy');
export const RPM_SWATCHES_MATTE: RpmSwatch[] = RPM_SWATCHES.filter((s) => s.surface === 'matte');
