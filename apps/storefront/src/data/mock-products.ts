/**
 * Mock product catalog — 字面從 design-reference/data/products.js @ 25d3a2a 直接搬(M-1-04-mini-slice 修:25d3a2a products 加 priceByTier × 20;mock 不對齊、d2 已走 Supabase、mock d1 era artifact 未來廢)
 * 對齊 main-d-d1 拍板「直接搬、不翻譯」精神
 *
 * d2 接 SupabaseProductAdapter 真資料時、本檔保留作 fallback / Storybook 樣本(待 d2 拍板)
 *
 * M-1-13a 加 slug 欄(Q1=B `/products/[slug]` 路由用、SEO 友善 ASCII slug、unique)
 */

/**
 * 將 brand 字串(可能含 unicode diacritics 如 Č / Ö)轉為 URL-safe ASCII slug。
 * 用法:`brandToSlug('AKRAPOVIČ')` → `'akrapovic'`、`brandToSlug('CNC RACING')` → `'cnc-racing'`
 * 機制:NFD normalize 拆 diacritic → 移 combining marks → 小寫 → 非 ASCII 字元換 hyphen → 收頭尾 hyphen
 */
export function brandToSlug(brand: string): string {
  return brand
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * RPM Carbon 品牌 slug — 前台碳纖維段品牌切換守門判準(P0-C 去碳)。
 * 🔴 字面三來源律核實(2026-07-04):`scripts/supplier-config.ts:64` `brandSlug:'rpm-carbon'` +
 *   `mock-brands.ts:34` `id:'rpm-carbon'` + adapter mapper 測試 fixtures 皆 'rpm-carbon';
 *   = brands 表 seed 的 RPM slug、`toUIProduct` 填入 `MockProduct.brandSlug` 的值。
 * 守門一律用此常數比對(避免 'rpm-carbon' 字面散落各元件、typo 漂移 → F1 恆 false 回歸)。
 */
export const RPM_CARBON_BRAND_SLUG = 'rpm-carbon';

/**
 * UI 變體(M-1-16c-3:詳情頁規格選擇器吃的真變體 shape)。
 *
 * 🔴 經銷價防護:**只帶單一 `price: number`(= priceByTier.general、唯一真值)**、
 *   **不帶 priceByTier**(經銷結構不進 client bundle);toUIProduct server-side strip。
 *   變體無真經銷價(public view 排除 price_store)、tier-aware 變體價延 M-2-08。
 * availability 不帶(Q4=A 沿用 #161 不顯庫存)。
 */
export type UIVariant = {
  /** 變體 uuid(= domain ProductVariant.id;🔴 M-3-S2-b2-c cart 線契約 variant_id 來源 + 建單 RPC variant_id;非敏感 join key、非價) */
  id: string;
  /** 變體料號(全表 UNIQUE;顯示用 + 建單 RPC (supplier_slug,sku) 複合鍵備援) */
  sku: string;
  /** 規格自由 key-value(weave/finish/special;選擇器資料驅動渲染) */
  spec: Record<string, string>;
  /** 對外顯示價(= priceByTier.general.amount、整數元位) */
  price: number;
  /** 變體圖 URL 陣列(16c-4 換圖用;空 → fallback 商品圖) */
  images: string[];
};

/**
 * UI 適用車款(S6:OD-12 適用車款表吃的真 fitment shape;toUIProduct ← domain Product.fitments plumb)。
 *
 * 逐欄白名單對齊 domain FitmentSpec 公開欄、UI 自控形狀解耦 domain(同 UIVariant 慣例)。
 * 全為公開車輛相容資訊、無敏感欄;OD-12 適用車款表(ProductFitments)用 motoBrand/modelCode/年份渲染。
 * unconfirmed 欄仍保留(harmless 公開資料),但前台 OD-12b 起不顯「未確認」標(下單前 LINE 本就會確認車款)。
 */
export type UIFitment = {
  /** 車輛廠牌口語名(例:'Aprilia' / 'Ducati') */
  motoBrand: string;
  /** 車型代號(例:'RSV4' / 'Panigale V4') */
  modelCode: string;
  /** 適用年份起;無年份限制則省略 */
  yearStart?: number;
  /** 適用年份迄;null = 開放式("2025+")、number 同 yearStart 或省略(undefined)= 單年 */
  yearEnd?: number | null;
  /** 來源自動展開、未經人工確認;OD-12b 起前台不顯「未確認」標(欄保留、harmless 公開資料);已確認則省略 */
  unconfirmed?: boolean;
};

/** 會員身份價格標籤(對齊 design-reference/components/Pricing.jsx L63/L102 memberLabel 真權威字面);general tier 為 null。
 *  #132:抽出共用 alias,MockProduct.tierLabel / Price.tsx PriceProps / lib/products.ts toUIProduct 三處共用。
 *  ⚠️ 純 UI badge 字串('P價'/'店價')、非經銷價值(真價走 effectivePrice.amount),抽 type 為純型別層零洩漏路徑。 */
export type TierLabel = 'P價' | '店價' | null;

export type MockProduct = {
  id: number;
  /** URL-safe ASCII slug,格式 `${brandToSlug(brand)}-${id}`、unique(brand+id 天然 unique);M-1-13a 落地、M-1-16 真資料種子時必填 */
  slug: string;
  brand: string;
  /**
   * 品牌 slug(P0-C 去碳品牌切換守門用;toUIProduct ← domain `product.brand.slug`、如 'rpm-carbon' / 'cnc-racing')。
   * 🔴 前台碳纖維段守門一律用**此欄**(≠ `brand` 顯示名如 'RPM CARBON';F1 陷阱:守門若用 `brand`
   *   會恆 false → RPM 碳纖維段全消失=回歸)。mock 省略 → undefined(當非 RPM)、碳纖維段不渲染。
   */
  brandSlug?: string;
  name: string;
  fits: string;
  price: number;
  origPrice: number | null;
  isNew: boolean;
  isSale: boolean;
  inStock: boolean;
  category: string;
  color: string;
  imgTone: string;
  /**
   * 商品代表圖 URL(M-1-16c-1:toUIProduct 從 domain `product.images[0]` 填、修首頁/卡片
   * 「通用機車生活照」根因)。有真圖 → ProductImage 渲染真圖;`null` / 缺 → fallback
   * 既有 seed placeholder gallery。mock 資料省略此欄(走 fallback、不破舊測試)。
   */
  image?: string | null;
  /**
   * 商品圖片陣列(M-1-16c-3:toUIProduct ← domain `product.images`、群代表圖全陣列;
   * ProductGallery 詳情頁用)。`image` 為其第一張、卡片用。mock 省略 → ProductGallery fallback。
   */
  images?: string[];
  /**
   * 商品副標(M-1-16c-4a:toUIProduct ← domain `product.subtitle`、Webike 式副標如
   * 「Ducati Panigale · 碳纖維」)。ProductInfo pd-sub 顯此真值;mock 省略 → fallback「適用 {fits}」。
   */
  subtitle?: string;
  /**
   * 商品主碼 / 產品型號(M-1-16c-4b:toUIProduct ← domain `product.productCode`、vendor 真主碼如
   * 「RPM-DCC01」)。ProductTabs 規格表「產品型號」顯此真值;mock 省略 → fallback slug。
   */
  productCode?: string;
  /**
   * 商品變體(M-1-16c-3:詳情頁規格選擇器吃的真變體;toUIProduct server-side strip 自 domain
   * ProductVariant、只帶 price:number〔general〕不帶 priceByTier)。mock 省略 → 不渲染選擇器、向後相容。
   */
  variants?: UIVariant[];
  /**
   * 完整適用車款陣列(S6:toUIProduct ← domain `product.fitments` 逐筆映射全車款;
   * 聯集去重已於匯入 mergeFitments 上游完成、本層不再去重)。
   * `fits` 為其衍生單字串(卡片用、取第一筆 brand+model);本欄為 OD-12 適用車款表(ProductFitments)的真資料源。
   * mock 省略 → ProductFitments 不渲染表、向後相容。
   */
  fitments?: UIFitment[];
  /** 劃線價:store / premiumStore 顯示時的 general 原價、general tier 為 null;sub 4b toUIProduct 內 server-side dispatch 填值 */
  originalPrice?: number | null;
  /** 會員身份標籤(型別見上方 TierLabel alias、#132);general tier 為 null */
  tierLabel?: TierLabel;
  /** M-1-13H-4:旗艦商品才渲染 Engineering Spotlight 區塊(對應 HANDOFF #13 + PRD §4 slice-4 Q2=B 拍板);
   *  Phase 1 業務指定 3 件(lightech-1 / akrapovic-6 / brembo-7)hardcoded true、其餘 undefined falsy;
   *  Phase 2 接 Supabase product_spotlights 表(M-1-16 後)、欄位名一致對應(對齊 PRD Q2 字面) */
  hasSpotlight?: boolean;
};

export const MOCK_PRODUCTS: MockProduct[] = [
  { id: 1, slug: 'lightech-1', brand: 'LIGHTECH', name: 'Lightech 鋁合金腳踏組', fits: 'CBR600RR', price: 12800, origPrice: null, isNew: true, isSale: false, inStock: true, category: '操控部品 · 腳踏後移', color: 'silver', imgTone: 'cool', originalPrice: null, tierLabel: null, hasSpotlight: true },
  { id: 2, slug: 'lightech-2', brand: 'LIGHTECH', name: 'Lightech 可調式拉桿組', fits: 'YAMAHA R6', price: 5800, origPrice: 7200, isNew: false, isSale: true, inStock: true, category: '操控部品 · 拉桿', color: 'red', imgTone: 'red', originalPrice: null, tierLabel: null },
  { id: 3, slug: 'cnc-racing-3', brand: 'CNC RACING', name: 'CNC Racing 油箱蓋', fits: 'Ducati Panigale V4', price: 6500, origPrice: null, isNew: false, isSale: false, inStock: true, category: '精品配件 · 油箱蓋', color: 'silver', imgTone: 'neutral', originalPrice: null, tierLabel: null },
  { id: 4, slug: 'gb-racing-4', brand: 'GB RACING', name: 'GB Racing 引擎護蓋套組', fits: 'BMW S1000RR', price: 8900, origPrice: null, isNew: false, isSale: false, inStock: true, category: '車身套件 · 引擎護蓋', color: 'black', imgTone: 'dark', originalPrice: null, tierLabel: null },
  { id: 5, slug: 'rizoma-5', brand: 'RIZOMA', name: 'RIZOMA CIRCUIT 959 後視鏡', fits: '通用款', price: 4200, origPrice: null, isNew: true, isSale: false, inStock: true, category: '精品配件 · 後視鏡', color: 'silver', imgTone: 'cool', originalPrice: null, tierLabel: null },
  { id: 6, slug: 'akrapovic-6', brand: 'AKRAPOVIČ', name: 'Akrapovič 鈦合金全段排氣', fits: 'Panigale V4', price: 98000, origPrice: 112000, isNew: false, isSale: true, inStock: false, category: '引擎部品 · 排氣管', color: 'titanium', imgTone: 'warm', originalPrice: null, tierLabel: null, hasSpotlight: true },
  { id: 7, slug: 'brembo-7', brand: 'BREMBO', name: 'Brembo GP4-RX 輻射卡鉗', fits: 'BMW S1000RR', price: 52000, origPrice: null, isNew: true, isSale: false, inStock: true, category: '煞車系統 · 卡鉗', color: 'gold', imgTone: 'warm', originalPrice: null, tierLabel: null, hasSpotlight: true },
  { id: 8, slug: 'ohlins-8', brand: 'ÖHLINS', name: 'Öhlins TTX GP 後避震', fits: 'ZX-10R', price: 68000, origPrice: null, isNew: false, isSale: false, inStock: true, category: '避震 · 後避震', color: 'yellow', imgTone: 'gold', originalPrice: null, tierLabel: null },
  { id: 9, slug: 'rizoma-9', brand: 'RIZOMA', name: 'RIZOMA 鋁合金油箱蓋', fits: 'MT-09', price: 3800, origPrice: null, isNew: false, isSale: false, inStock: true, category: '精品配件 · 油箱蓋', color: 'silver', imgTone: 'cool', originalPrice: null, tierLabel: null },
  { id: 10, slug: 'cnc-racing-10', brand: 'CNC RACING', name: 'CNC 可折式拉桿組', fits: 'Panigale V2', price: 7200, origPrice: null, isNew: false, isSale: false, inStock: true, category: '操控部品 · 拉桿', color: 'red', imgTone: 'red', originalPrice: null, tierLabel: null },
  { id: 11, slug: 'lightech-11', brand: 'LIGHTECH', name: 'Lightech 車架防倒球', fits: 'MT-10', price: 2400, origPrice: 2800, isNew: false, isSale: true, inStock: true, category: '車身套件 · 防倒球', color: 'black', imgTone: 'dark', originalPrice: null, tierLabel: null },
  { id: 12, slug: 'termignoni-12', brand: 'TERMIGNONI', name: 'Termignoni 碳纖維中段', fits: 'Streetfighter V4', price: 42000, origPrice: null, isNew: true, isSale: false, inStock: true, category: '引擎部品 · 排氣管', color: 'black', imgTone: 'dark', originalPrice: null, tierLabel: null },
  { id: 13, slug: 'gb-racing-13', brand: 'GB RACING', name: 'GB Racing 變速箱護蓋', fits: 'ZX-10R', price: 3600, origPrice: null, isNew: false, isSale: false, inStock: true, category: '車身套件 · 引擎護蓋', color: 'black', imgTone: 'dark', originalPrice: null, tierLabel: null },
  { id: 14, slug: 'rizoma-14', brand: 'RIZOMA', name: 'RIZOMA Quantum 方向燈', fits: '通用款', price: 2800, origPrice: null, isNew: false, isSale: false, inStock: true, category: '精品配件 · LED', color: 'silver', imgTone: 'cool', originalPrice: null, tierLabel: null },
  { id: 15, slug: 'brembo-15', brand: 'BREMBO', name: 'Brembo T-Drive 浮動碟盤', fits: 'RSV4', price: 18500, origPrice: null, isNew: false, isSale: false, inStock: true, category: '煞車系統 · 碟盤', color: 'silver', imgTone: 'neutral', originalPrice: null, tierLabel: null },
  { id: 16, slug: 'cnc-racing-16', brand: 'CNC RACING', name: 'CNC 鑰匙蓋防盜組', fits: 'Monster', price: 2100, origPrice: null, isNew: false, isSale: false, inStock: true, category: '精品配件 · 鑰匙蓋', color: 'silver', imgTone: 'cool', originalPrice: null, tierLabel: null },
  { id: 17, slug: 'lightech-17', brand: 'LIGHTECH', name: 'Lightech 碳纖維土除', fits: 'Tuono V4', price: 9200, origPrice: null, isNew: true, isSale: false, inStock: true, category: '車身套件 · 土除', color: 'black', imgTone: 'dark', originalPrice: null, tierLabel: null },
  { id: 18, slug: 'akrapovic-18', brand: 'AKRAPOVIČ', name: 'Akrapovič Slip-On 尾段', fits: 'MT-09', price: 38000, origPrice: 45000, isNew: false, isSale: true, inStock: true, category: '引擎部品 · 排氣管', color: 'titanium', imgTone: 'warm', originalPrice: null, tierLabel: null },
  { id: 19, slug: 'ohlins-19', brand: 'ÖHLINS', name: 'Öhlins FGK 前叉套件', fits: 'Panigale V4', price: 125000, origPrice: null, isNew: false, isSale: false, inStock: false, category: '避震 · 前叉', color: 'gold', imgTone: 'gold', originalPrice: null, tierLabel: null },
  { id: 20, slug: 'rizoma-20', brand: 'RIZOMA', name: 'RIZOMA 腳踏後移', fits: 'MT-10', price: 18500, origPrice: null, isNew: false, isSale: false, inStock: true, category: '操控部品 · 腳踏後移', color: 'silver', imgTone: 'cool', originalPrice: null, tierLabel: null },
];

/**
 * 依 slug 取 product;Q1=B `/products/[slug]` server component 用、404 處理 caller 負責。
 */
export function findProductBySlug(slug: string): MockProduct | undefined {
  return MOCK_PRODUCTS.find((p) => p.slug === slug);
}
