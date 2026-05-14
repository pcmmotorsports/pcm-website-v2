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
//   - Q-category=a:{raw:'操控部品', segments:['操控部品']}
//
// 真實狀態揭示(commit body 同步):
//   - d2 驗收時 Supabase products 表 **0 row**(main-c spike cleanup 後、M-1-16 種子前)
//   - listByCategory('操控部品') 必回 []、必走 Q-empty=b 分支
//   - 真資料 happy path 待 M-1-16 驗、d2 不算缺陷
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
    brand: product.brand.name,
    name: product.name,
    fits,
    price: effectivePrice.amount,
    origPrice: null,
    isNew: false,
    isSale: false,
    inStock: product.availability === 'in-stock',
    category: product.category.raw,
    color: 'silver',
    imgTone: 'neutral',
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
 *   - listByCategory({raw:'操控部品', segments:['操控部品']})、取前 4 筆 map 為 UI shape
 *   - 找不到 category(adapter 回 [])→ 回 `{ products: [], error: false }`、UI 走 empty 分支
 *   - adapter throw error → console.error + 回 `{ products: [], error: true }`、UI 走 error 分支
 *
 * tier 由 caller 傳入(page.tsx 從 cookie / ?tier= override 取得、sub 4b 接通)。
 */
export async function fetchFeaturedProducts(tier: MemberTier): Promise<FeaturedResult> {
  const client = createSupabaseAnonClient();
  const adapter = new SupabaseProductAdapter(client);

  // Q-category=a 拍板:對齊 d1 STATUS 字面建議「操控部品」、頂層大類
  const category: CategoryPath = {
    raw: '操控部品',
    segments: ['操控部品'],
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
