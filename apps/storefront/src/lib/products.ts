// apps/storefront/src/lib/products.ts
//
// server-side data fetcher + UI mapper(domain Product → MockProduct shape)
// 對齊 docs/specs/M-1-03-main-b-PRD.md §6.1 priceByTier 三層責任:
//   - adapter 層回完整 priceByTier(三 tier)
//   - 本檔(use-case + storefront server-side render 合併實作)取 general tier、
//     strip store / premiumStore、回 client 用單一 price 字面
//
// d2 階段 customer.tier 固定 'general'(未登入訪客 / 一般會員)、未來 M-1-XX
// 接 auth 後從 session 拿真 tier。
//
// 字面源(對齊 Sean 2026-05-09 d2 拍板):
//   - Q-empty=b:渲染 section + 「目前沒有商品」(UI 字面在 HomeSelect)
//   - Q-error=b:渲染 section + 「載入失敗、請稍後再試」+ console.error
//   - featured category(M-1-16b 後 Sean 2026-06-01 拍 A、覆蓋 d2 Q-category=a「操控部品」):
//     {raw:'碳纖維部品', segments:['碳纖維部品']}(RPM 上架後真資料在此分類、逐字對齊 DB raw_path)
//
// 真實狀態揭示(commit body 同步):
//   - M-1-16b 全量灌後 Supabase products 表 933 row(全在「碳纖維部品」)、
//     listByCategory('碳纖維部品') 回真 RPM 商品、首頁 happy path 通
//   - d2 舊狀態(0 row / listByCategory('操控部品') 必回 [])已過時(M-1-16b 前的描述)
//
// server-only 紀律:
//   - 本檔含 createSupabaseAnonClient + adapter 構造、絕不該進 client bundle
//   - 第一層(編譯期擋):server-only ^0.0.1 已 dep + @pcm/adapters/src/supabase/client.ts
//     檔頭 `import 'server-only';`(audit B-1 `89a20a8` / 2026-05-10 推翻 d2 `1147fbe` /
//     2026-05-09「不裝」原拍板、原因 = R1 #2 Critical service_role key 從 root export 暴露)
//   - 次層保險(runtime guard、下方 `typeof window` block):server module load throw、捕第一層編譯期未涵蓋邊界

if (typeof window !== 'undefined') {
  throw new Error(
    '@/lib/products is server-only — must not be imported from client component bundle',
  );
}

import {
  SupabaseProductAdapter,
  createSupabaseAnonClient,
  availabilityToBool,
} from '@pcm/adapters';
import { computeEffectivePrice } from '@pcm/domain';
import type { CategoryPath, MemberTier, Product } from '@pcm/domain';
import type { MockProduct } from '@/data/mock-products';

/**
 * domain Product + 指定 tier → UI shape(MockProduct)。
 *
 * priceByTier server-side strip(對齊 main-b PRD §6.1):
 *   - 取 product.priceByTier[tier].amount(單一 number)
 *   - 整個 priceByTier jsonb 不送 client
 *
 * Drift 補洞(domain Product 無、UI 用 hardcode 預設、commit body 揭示):
 *   - origPrice / isNew / isSale:無對應、hardcode null / false / false(promo 概念 Phase 1 未做)
 *   - color / imgTone:hardcode 'silver' / 'neutral'(視覺裝飾 d1 用 imgTone 區分、
 *     未來 ProductPage / variant slice 真實對應)
 *   - image:M-1-16c-1 起 ← product.images[0](群代表圖、真圖);無圖 null、ProductImage
 *     fallback seed placeholder(imgTone 僅 fallback 漸層底色用、不再決定主圖內容)
 *   - id:domain string ProductId → UI number(MockProduct.id 字面 number)、
 *     d2 用 `as unknown as number` cast 對齊 Sean 指令 Step 6 字面;React key 不依賴
 *     number 行為、ProductImage `seed: number` 算術運算(seed * 7 / seed % n)會
 *     runtime NaN、d2 happy path 不 hit(走 Q-empty 分支)、未來擴 ProductCardProps.p.id
 *     接 string + ProductImage seed 改 hash 函式(留 backlog #117 後續 slice trigger)
 *
 * fits 字面:取第一個 fitment、format `{motoBrand} {modelCode}`、無 fitment → '通用款'。
 * (對齊 design mock fits 字面風格如 'CBR600RR' / 'Panigale V4' / '通用款')
 */
/**
 * domain ProductId(string、UUID 格式)→ deterministic number、用於 ProductImage seed 算術
 *
 * 對齊 #117 anchor 預期解法「ProductImage seed 改 hash 函式(string → number 確定性映射、避免 NaN)」+
 * sub 8d findings eng-1 / eng-8 / simp-6 / simp-12 雙 audit 命中 id NaN 故障鏈。
 * djb2-like rolling hash + Math.abs 防負;同 input 永遠回同 output(deterministic gallery 對齊)。
 */
function hashIdToNumber(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function toUIProduct(product: Product, tier: MemberTier): MockProduct {
  const firstFitment = product.fitments[0];
  const fits = firstFitment
    ? `${firstFitment.motoBrand} ${firstFitment.modelCode}`
    : '通用款';

  const effectivePrice = computeEffectivePrice(product, tier);
  const originalPrice =
    tier === 'general'
      ? null
      : computeEffectivePrice(product, 'general').amount;
  const tierLabel: 'P價' | '店價' | null =
    tier === 'premiumStore' ? 'P價' : tier === 'store' ? '店價' : null;

  return {
    id: hashIdToNumber(product.id),
    slug: product.handle,
    // M-1-16c-4b:商品主碼 ← domain product.productCode(真主碼如 RPM-DCC01;ProductTabs 產品型號顯)。
    productCode: product.productCode,
    brand: product.brand.name,
    name: product.name,
    fits,
    price: effectivePrice.amount,
    origPrice: null,
    isNew: false,
    isSale: false,
    inStock: availabilityToBool(product.availability),
    category: product.category.raw,
    color: 'silver',
    imgTone: 'neutral',
    // M-1-16c-1:商品代表圖 ← domain product.images[0](群代表圖、單張);
    //   無圖 → null、ProductImage fallback seed placeholder。修首頁/卡片「通用機車生活照」根因
    //   (原只設 imgTone:'neutral'、ProductImage 用 seed 生成 unsplash 通用照)。
    image: product.images[0] ?? null,
    // M-1-16c-3:商品圖全陣列(ProductGallery 詳情頁用;image 為其第一張)。
    images: product.images,
    // M-1-16c-4a:副標 ← domain product.subtitle(Webike 式真副標、如「Ducati Panigale · 碳纖維」);
    //   domain 已有此欄(mapSupabaseProductToDomain subtitle: row.subtitle ?? '')、本片 plumb 到 UI。
    //   ProductInfo pd-sub 顯此真值、拿掉寫死「義大利原裝進口」(backlog #162 placeholder 退場)。
    subtitle: product.subtitle,
    // M-1-16c-3:變體 server-side strip → UIVariant(只帶 price:number = general、**不帶 priceByTier**;
    //   🔴 經銷結構不進 client bundle;變體無真經銷價〔public view 排除 price_store〕、取 general 防 NT$0,
    //   tier-aware 變體價延 M-2-08;codex 16c-2/16c-3 k1 must-fix)。
    variants: product.variants.map((v) => ({
      sku: v.sku,
      spec: v.spec,
      price: v.priceByTier.general.amount,
      images: v.images,
    })),
    // S6:完整適用車款 ← domain product.fitments(逐欄白名單、為 OD-F1〔Phase B〕適用車款表鋪路;
    //   `fits` 單字串仍為卡片用衍生值、兩者並存。全公開車輛相容資訊、無敏感欄)。
    //   yearEnd 條件帶忠實保留 domain 三態、不壓平:null=開放式("2025+")、number=明確迄年、
    //   undefined(省略)=單年(OD-F1 渲染以 yearEnd===yearStart 或缺值判單年)。
    fitments: product.fitments.map((f) => ({
      motoBrand: f.motoBrand,
      modelCode: f.modelCode,
      ...(f.yearStart != null ? { yearStart: f.yearStart } : {}),
      ...(f.yearEnd !== undefined ? { yearEnd: f.yearEnd } : {}),
      ...(f.unconfirmed ? { unconfirmed: true } : {}),
    })),
    originalPrice,
    tierLabel,
  };
}

/**
 * server-side fetch 結果(empty 與 error 字面不同、需 discriminate):
 *   - 正常 / empty:`{ products: [...], error: false }`
 *   - error:`{ products: [], error: true }`(console.error 已寫 log)
 *
 * HomeSelect 端依 products.length 與 error flag 走三條 UI 分支:
 *   - error → 「載入失敗、請稍後再試」(Q-error=b 字面)
 *   - empty(error=false 且 products.length===0)→ 「目前沒有商品」(Q-empty=b 字面)
 *   - 正常 → render 4 個 ProductCard
 */
export type FeaturedResult = {
  products: MockProduct[];
  error: boolean;
};

/**
 * 撈 featured 4 件商品(對齊 HomeSelect N°04 編輯精選)。
 *
 * 行為:
 *   - listByCategory({raw:'碳纖維部品', segments:['碳纖維部品']})、取前 4 筆 map 為 UI shape
 *   - 找不到 category(adapter 回 [])→ 回 `{ products: [], error: false }`、UI 走 empty 分支
 *   - adapter throw error → console.error + 回 `{ products: [], error: true }`、UI 走 error 分支
 *
 * tier 由 caller 傳入(page.tsx 從 cookie / ?tier= override 取得、sub 4b 接通)。
 */
export async function fetchFeaturedProducts(tier: MemberTier): Promise<FeaturedResult> {
  const client = createSupabaseAnonClient();
  const adapter = new SupabaseProductAdapter(client);

  // featured category:M-1-16b 後 Sean 2026-06-01 拍 A、覆蓋 d2 Q-category=a「操控部品」
  //   (mock 時代 placeholder → RPM 上架後真資料在「碳纖維部品」);逐字對齊 DB categories.raw_path。
  //   未來多分類時改用 featured 旗標 / 跨分類查全站(backlog #205、原 B 正解留此)。
  const category: CategoryPath = {
    raw: '碳纖維部品',
    segments: ['碳纖維部品'],
  };

  try {
    const products = await adapter.listByCategory(category);
    return {
      products: products.slice(0, 4).map((p) => toUIProduct(p, tier)),
      error: false,
    };
  } catch (err) {
    console.error('[fetchFeaturedProducts] adapter.listByCategory failed:', err);
    return { products: [], error: true };
  }
}

/**
 * 依 handle(SEO slug)撈單筆商品 + 真變體(M-1-16c-3:詳情頁接真)。
 *
 * 走 SupabaseProductAdapter.findByHandle(embed product_variants_public、含變體);
 * 找不到 → null(caller page.tsx 走 notFound());adapter 其他 error 往上拋(Next error boundary、非 404)。
 *
 * 🔴 **釘 general**:詳情頁 Phase-1 顯 general 公開價(不收 tier 參數、固定 'general')。
 *   理由:public view 排除 price_store、store/premiumStore 走 dummy 0;若傳真 tier 給 toUIProduct
 *   會對 store/premiumStore 顯「NT$ 0」(codex 16c-3 k1 must-fix 2)。變體 UI 價亦取 general。
 *   tier-aware 詳情價待 M-2-08 server-side pricing endpoint(同 featured g-2 'general' 釘法)。
 */
export async function fetchProductByHandle(handle: string): Promise<MockProduct | null> {
  const client = createSupabaseAnonClient();
  const adapter = new SupabaseProductAdapter(client);
  const product = await adapter.findByHandle(handle);
  if (!product) {
    return null;
  }
  return toUIProduct(product, 'general');
}
