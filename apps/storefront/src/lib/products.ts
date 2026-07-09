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
//   - M-1-16b 全量灌後 products_public 全在「碳纖維部品」(初灌 933、後續批次累積、2026-06 約 1406 列)、
//     listByCategory('碳纖維部品') 回真 RPM 商品、首頁 featured + #220 列表頁 happy path 通
//   - d2 舊狀態(0 row / listByCategory('操控部品') 必回 [])已過時(M-1-16b 前的描述)
//
// server-only 紀律:
//   - 本檔含 createSupabaseAnonClient + adapter 構造、絕不該進 client bundle
//   - 第一層(編譯期擋):server-only ^0.0.1 已 dep + @pcm/adapters/src/supabase/client.ts
//     檔頭 `import 'server-only';`(audit B-1 `89a20a8` / 2026-05-10 推翻 d2 `1147fbe` /
//     2026-05-09「不裝」原拍板、原因 = R1 #2 Critical service_role key 從 root export 暴露)
//   - 次層保險(runtime guard、下方 `typeof window` block):server module load throw、捕第一層編譯期未涵蓋邊界
//   - 2026-06-05 安全稽核 M-14:本檔補上**自身直接** `import 'server-only';`(下行),不再只靠
//     createSupabaseAnonClient 的傳遞式依賴守門;未來 refactor import 路徑也不會靜默失去編譯期保護。

import 'server-only';

if (typeof window !== 'undefined') {
  throw new Error(
    '@/lib/products is server-only — must not be imported from client component bundle',
  );
}

import { cache } from 'react';
import { unstable_cache } from 'next/cache';

import {
  SupabaseProductAdapter,
  createSupabaseAnonClient,
  availabilityToBool,
} from '@pcm/adapters';
import { computeEffectivePrice } from '@pcm/domain';
import type { MemberTier, Product } from '@pcm/domain';
import type { MockProduct, TierLabel } from '@/data/mock-products';
import type { MockMotoBrand } from '@/data/mock-moto-brands';
import type { MockCategory } from '@/data/mock-categories';
import { buildVehicleTaxonomy } from '@/lib/vehicle-taxonomy';
import { buildCategoryTree } from '@/lib/category-taxonomy';

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

/**
 * 型錄資料跨請求快取秒數(perf/P3、Sean 2026-07-08 拍 Q2=15 分)。
 *
 * 商品資料每日僅台灣 03:00 由 GitHub Actions rpm-sync.yml 同步一次(vercel.json 兩條 cron
 * 為金流用途、與商品無關)→ 15 分 staleness 零業務風險、保留人工改 DB 後合理生效窗。
 *
 * unstable_cache 紀律(Next 16.2 查證、plan §P3):
 *   - cached 函式只接純參數、內部不呼叫 cookies()/headers()、不閉包 tier/request 狀態
 *   - force-dynamic 頁面內照樣生效(force-dynamic 只管 fetch()/segment config、兩機制獨立)
 *   - 回傳值走 JSON 序列化來回 → 只快取 JSON-safe 的 UI shape(MockProduct 等、無 Date)
 *   - 失敗 throw 傳播、**不進快取**(在快取外 catch 回 fallback;否則一次瞬時 DB 錯誤會把
 *     空目錄快取 15 分鐘)
 *   - 同掛 'catalog' tag:日後同步完可 revalidateTag('catalog') 主動失效(本批未接)
 */
const CATALOG_REVALIDATE_SECONDS = 900;

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
  const tierLabel: TierLabel =
    tier === 'premiumStore' ? 'P價' : tier === 'store' ? '店價' : null;

  return {
    id: hashIdToNumber(product.id),
    slug: product.handle,
    // M-1-16c-4b:商品主碼 ← domain product.productCode(真主碼如 RPM-DCC01;ProductTabs 產品型號顯)。
    productCode: product.productCode,
    brand: product.brand.name,
    // P0-C 去碳:brandSlug ← domain product.brand.slug(如 'rpm-carbon');前台品牌切換守門一律用此欄。
    //   🔴 F1 陷阱:守門若用 brand(顯示名 'RPM CARBON')會恆 false → RPM 碳纖維段全消失=回歸;故 plumb slug。
    brandSlug: product.brand.slug,
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
    // 2026-07-05:商品內文 ← domain product.description(來源繁中內文;mapper row.description ?? '')。
    //   ProductTabs 非 RPM 分支渲染真描述(修「內文寫進 DB 但前台無出口」);RPM 分支 byte 不變不讀此欄。
    description: product.description,
    // A/#270:賣點條列 ← domain product.highlights(ProductTabs 非 RPM 分支 render 重點 callout .pd-hl-list);空陣列不渲染。
    highlights: product.highlights,
    // #270 安裝資源:manuals/videoUrl 透傳 domain → MockProduct(InstallResources 消費、facade 影片 + PDF 下載鈕;無資料整區不渲染)。
    manuals: product.manuals,
    videoUrl: product.videoUrl,
    // M-1-16c-3:變體 server-side strip → UIVariant(只帶 price:number = general、**不帶 priceByTier**;
    //   🔴 經銷結構不進 client bundle;變體無真經銷價〔public view 排除 price_store〕、取 general 防 NT$0,
    //   tier-aware 變體價延 M-2-08;codex 16c-2/16c-3 k1 must-fix)。
    variants: product.variants.map((v) => ({
      // 🔴 M-3-S2-b2-c:多帶 id(uuid join key、cart variant_id 來源)、仍只 price:number(general)、
      //   絕不帶 priceByTier / store / premiumStore(plumb id 不開任何經銷洩漏面)。
      id: v.id,
      sku: v.sku,
      spec: v.spec,
      price: v.priceByTier.general.amount,
      images: v.images,
    })),
    // S6:完整適用車款 ← domain product.fitments(逐欄白名單、供 OD-12 適用車款表(ProductFitments)渲染;
    //   `fits` 單字串仍為卡片用衍生值、兩者並存。全公開車輛相容資訊、無敏感欄)。
    //   yearEnd 條件帶忠實保留 domain 三態、不壓平:null=開放式("2025+")、number=明確迄年、
    //   undefined(省略)=單年(ProductFitments 渲染以 yearEnd===yearStart 或缺值判單年)。
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
 * 行為(C4/#205 解除寫死單一分類「碳纖維部品」→ 全目錄 id 升冪前 4):
 *   - getFeaturedUIProductsCached()(perf/P3:unstable_cache 900s;內層 listAllProducts({limit:4})
 *     perf/P2 limit 下推 DB、免撈全表)
 *   - adapter 回 [](空目錄)→ 回 `{ products: [], error: false }`、UI 走 empty 分支
 *   - adapter throw error → **不進快取**、外層 console.error + 回 `{ products: [], error: true }`
 *
 * 🔴 **釘 general**(perf/P3、plan §P3 明示語意變更;同 fetchCatalogProducts / fetchProductByHandle /
 *   account g-2 既有先例):public view 排除 price_store、store/premiumStore 走 dummy 0,傳真 tier
 *   會顯「NT$ 0」錯價;且 tier 變體若進快取會把 A 訪客 tier 顯價端給 B 訪客。故不收 tier 參數、
 *   固定 'general'、任何 tier 變體不進快取;真 tier 定價待 #215 server 端 tier 查證後另接。
 *   (帶 tier cookie 的訪客首頁精選價由「dummy 資料算出的 tier 價」變 general 價=修正非退化。)
 *
 * featured 本為 Phase-1 placeholder,「featured 旗標」才是正解(#205)。
 */
const getFeaturedUIProductsCached = unstable_cache(
  async (): Promise<MockProduct[]> => {
    const client = createSupabaseAnonClient();
    const adapter = new SupabaseProductAdapter(client);
    const products = await adapter.listAllProducts({ limit: 4 });
    return products.map((p) => toUIProduct(p, 'general'));
  },
  ['featured-ui-products-v1'],
  { revalidate: CATALOG_REVALIDATE_SECONDS, tags: ['catalog'] },
);

export async function fetchFeaturedProducts(): Promise<FeaturedResult> {
  try {
    return { products: await getFeaturedUIProductsCached(), error: false };
  } catch (err) {
    console.error('[fetchFeaturedProducts] cached featured fetch failed:', err);
    return { products: [], error: true };
  }
}

/**
 * 撈整個公開目錄全量供 /products 列表頁 + sitemap(#220 列表頁遷真、C4/#205 解除寫死單一分類)。
 *
 * 行為:
 *   - listAllProducts()〔.order('id') + .range 分頁迴圈、繞 PostgREST/Supabase「Max rows=1000」硬上限、
 *     撈**全目錄**非下架公開商品(不綁分類)〕→ map toUIProduct(p,'general')
 *   - adapter 回 [](空目錄)→ `{ products: [], error: false }`、UI 走 empty 分支「找不到符合條件的商品」
 *   - adapter throw error → console.error + `{ products: [], error: true }`、UI 走 error 分支「載入失敗、請稍後再試」
 *
 * 🔴 RPM 零回歸:現況全站公開商品恰在單一分類「碳纖維部品」→ 撈全目錄 = 撈碳纖維部品 = 同 1117 筆、byte 等價;
 *   多品牌(#212)寫入後才多出其他分類商品(客人屆時可跨分類瀏覽,對齊 C2 filterProducts category 分支)。
 * 🔴 **釘 general**(同 fetchProductByHandle L218-227 理由):public view 排除 price_store、
 *   store/premiumStore 走 dummy 0;若傳真 tier 會對店家會員顯「NT$ 0」(codex 16c-3 k1 must-fix 2)。
 *   故不收 tier 參數、固定 'general';tier-aware 列表價待 M-2-08。經銷價零外洩。
 * 🔴 stopgap:全量撈進 client(client filter/分頁、Phase-1 <5000 件可接受)。多品牌(#212)
 *   目錄長大後須改 server-side 分頁/篩選(#51)、非長久解。
 *
 * 🔴 perf/P3 快取豁免(實測、2026-07-08 本地 production server):本函式**不包 unstable_cache**——
 *   全目錄 general 投影 JSON 為 3,816,327 bytes,超過 Next data cache 單條 2MB 上限,寫入被拒
 *   (server log 逐字:「Failed to set Next.js data cache for unstable_cache /products …
 *   items over 2MB can not be cached (3816327 bytes)」)。包了=每請求白付 cache.get miss +
 *   必敗寫入 + 2 行錯誤 log、永無命中。治本=P4 server 分頁 + 列表輕量投影(#51、Sean 已拍
 *   Q3=P1-P3 上線實測後另提);屆時單頁投影自然低於 2MB 再快取。其餘三函式(featured/
 *   categories/taxonomy)實測皆 <30KB、快取有效(見各函式)。
 */
export async function fetchCatalogProducts(): Promise<FeaturedResult> {
  const client = createSupabaseAnonClient();
  const adapter = new SupabaseProductAdapter(client);

  try {
    const products = await adapter.listAllProducts();
    return {
      products: products.map((p) => toUIProduct(p, 'general')),
      error: false,
    };
  } catch (err) {
    console.error('[fetchCatalogProducts] adapter.listAllProducts failed:', err);
    return { products: [], error: true };
  }
}

/**
 * 撈側欄分類樹(C2 接線;取代 data/mock-categories.ts 假資料)。
 *
 * `adapter.listCategories()`(products_public head:true exact count、經銷價零外洩)→
 * `buildCategoryTree`(選項 A:只留有商品分類、#220c 一致)。/products server 端撈、當 prop 傳 client。
 *
 * 失敗回 `[]`(側欄分類區空、不 crash;**不** fallback MOCK_CATEGORIES —— 假分類配真過濾器
 * 會產生「點了 0 結果」的死分類,比空更糟)。anon RLS 只計上架、零敏感欄。
 *
 * perf/P3:包 unstable_cache 900s(全訪客恆等、JSON-safe 樹;順帶消 1+16 分類 count N+1 的
 *   每請求成本;失敗 throw 不進快取、外層 catch 回 [])。
 */
const getCategoryTreeCached = unstable_cache(
  async (): Promise<MockCategory[]> => {
    const client = createSupabaseAnonClient();
    const adapter = new SupabaseProductAdapter(client);
    const summaries = await adapter.listCategories();
    return buildCategoryTree(summaries);
  },
  ['category-tree-v1'],
  { revalidate: CATALOG_REVALIDATE_SECONDS, tags: ['catalog'] },
);

export async function fetchCategories(): Promise<MockCategory[]> {
  try {
    return await getCategoryTreeCached();
  } catch (err) {
    console.error('[fetchCategories] cached categories fetch failed:', err);
    return [];
  }
}

/**
 * 撈全目錄車輛清單(S2/#220b:首頁 VehicleFinder 接真)。
 *
 * 輕量投影:只 select fitments 欄(不撈完整商品/變體)、.order('id') + .range 分頁迴圈
 * 繞 PostgREST「Max rows=1000」硬上限(仿 adapter listAllByCategory 分頁模式、MAX_PAGES 防呆)
 * → buildVehicleTaxonomy 衍生 品牌→車型→年份(與 /products 列表端同一衍生函式 = id 空間一致、
 * 首頁選車深連結必命中列表過濾)。
 *
 * 失敗回 [](VehicleFinder 顯空品牌下拉、不 crash;console.error 留 log)。
 * anon RLS 已擋 delisted(products_public view)、fitments 為公開車輛相容資訊、零敏感欄。
 *
 * perf/P3:包 unstable_cache 900s(全訪客恆等、JSON-safe;消首頁第二輪全表 fitments 掃描的
 *   每請求成本;失敗 throw 不進快取、外層 catch 回 [])。
 */
const getVehicleTaxonomyCached = unstable_cache(
  async (): Promise<MockMotoBrand[]> => {
    const client = createSupabaseAnonClient();
    const PAGE_SIZE = 1000;
    const MAX_PAGES = 50; // 防呆:與 adapter listAllByCategory 同上限
    const rows: Array<{ fitments: unknown }> = [];

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const from = page * PAGE_SIZE;
      const { data, error } = await client
        .from('products_public')
        .select('id, fitments')
        .order('id')
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE_SIZE) break;
    }
    return buildVehicleTaxonomy(
      rows.map((r) => ({
        fitments: Array.isArray(r.fitments)
          ? (r.fitments as NonNullable<MockProduct['fitments']>)
          : undefined,
      })),
    );
  },
  ['vehicle-taxonomy-v1'],
  { revalidate: CATALOG_REVALIDATE_SECONDS, tags: ['catalog'] },
);

export async function fetchVehicleTaxonomy(): Promise<MockMotoBrand[]> {
  try {
    return await getVehicleTaxonomyCached();
  } catch (err) {
    console.error('[fetchVehicleTaxonomy] cached fitments fetch failed:', err);
    return [];
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
// 2026-06-05 安全稽核 M-9:包 react `cache()` 做「同一請求內」去重。
//   詳情頁 generateMetadata + default export 各呼叫一次 fetchProductByHandle(同 slug)、
//   原本一個請求打兩次 Supabase 查(含 variants embed);cache() 讓同請求第二次直接回快取、零額外往返。
//   (React per-request memoization、跨請求不共享、不影響資料新鮮度。)
export const fetchProductByHandle = cache(
  async (handle: string): Promise<MockProduct | null> => {
    const client = createSupabaseAnonClient();
    const adapter = new SupabaseProductAdapter(client);
    const product = await adapter.findByHandle(handle);
    if (!product) {
      return null;
    }
    return toUIProduct(product, 'general');
  },
);

/**
 * 撈「相同分類」相關商品(C5/#258:商品詳情頁相關商品真資料化、拆舊 MOCK_PRODUCTS 假圖+死連結)。
 *
 * 行為:
 *   - listByCategory({raw: categoryRaw})(同一分類單次查、≤1000 取前 N 足夠、不需全量分頁)→
 *     排除當前商品(excludeHandle)→ 取前 limit(預設 4)→ toUIProduct(p,'general')
 *   - 找不到分類 / 撈空 → []、adapter throw → console.error + [](相關商品區條件隱藏、不 crash)
 *
 * 🔴 現況全站單一分類「碳纖維部品」→ 相關商品 = 其他碳纖維商品;多品牌上架後 = 真同分類商品。
 *   舊 ProductPage 版吃 MOCK_PRODUCTS(寫入當天冒假圖 + 死連結、#258 休眠地雷),本片改真資料消除。
 * 🔴 **釘 general**(同 fetchProductByHandle 理由):public view 排除 price_store、經銷價零外洩。
 * 🔴 **決定性**:listByCategory 未定序 → 以 handle 升冪排序後取前 N,同一商品跨請求 related 穩定不跳
 *   (對齊 fetchFeaturedProducts .order('id') 決定性精神;舊 MOCK_PRODUCTS 版靜態陣列本即決定性、不回歸)。
 * 🔴 **stopgap(#51)**:listByCategory 單次查回 ≤1000 筆 detail 全欄、僅取 4 = 浪費(單一分類 ~1117 更明顯);
 *   詳情頁無 revalidate 快取、爬蟲會放大。治本 = 加 .limit / 專用輕量投影 / cache,併 server-side 分頁 #51。
 * 註:CategoryPath.segments 不影響查詢(SupabaseProductAdapter.listByCategory 只用 `.raw` resolve),
 *   此處以 raw 當單元素、免解析分隔符。
 */
export async function fetchRelatedProducts(
  categoryRaw: string,
  excludeHandle: string,
  limit = 4,
): Promise<MockProduct[]> {
  const client = createSupabaseAnonClient();
  const adapter = new SupabaseProductAdapter(client);

  try {
    const products = await adapter.listByCategory({
      raw: categoryRaw,
      segments: [categoryRaw],
    });
    return products
      .filter((p) => p.handle !== excludeHandle)
      .sort((a, b) => a.handle.localeCompare(b.handle, 'en')) // 決定性:同 4 件、跨請求不跳(見檔頭 🔴)
      .slice(0, limit)
      .map((p) => toUIProduct(p, 'general'));
  } catch (err) {
    console.error('[fetchRelatedProducts] adapter.listByCategory failed:', err);
    return [];
  }
}
