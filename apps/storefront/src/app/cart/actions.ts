'use server';

// app/cart/actions.ts — 購物車 line 解析 server action(M-3-S2-b2-d)
//
// 為何需要 server 解析:
//   cart 線契約(M-3-S2-b2-c)只存 { productId, variantId?, qty } —— **不存價、不存標題/圖**
//   (鐵則 12 + memory project_security-audit H-1:價由 server 依 tier 取、client 永不存價)。
//   購物車頁要顯示 標題 / 品牌 / 圖 / 適用車款 / 單價,故 client 把 line key 丟回 server,
//   server 依 productId(= handle/slug)查真資料、回 UI 顯示所需欄位 + 「general 公開單價」。
//
// 🔴 釘 general(階段① general-only、階段⓪ 經銷價 tier-aware 硬 gate 未解):
//   走既有 fetchProductByHandle(@/lib/products)—— 該路徑已釘 'general'、且 server-side strip
//   priceByTier/store(public view 物理排除 price_store、UIVariant 型別無 priceByTier)。
//   本 action 回傳僅 `unitPrice: number`(= general)、**逐欄白名單、絕不夾帶 priceByTier/store/cost**。
//   tier-aware 購物車價待階段⓪ 解 gate + M-2-08 server-side pricing endpoint(同詳情頁 g-2 釘法)。
//
// 安全 / 信任邊界:
//   - 本 action 只解析「公開 general 價」(與 /products/[slug] 公開頁同一資料面)、無權限升級風險;
//     不需 auth gate(任何人本就能在詳情頁看到 general 價)。階段⓪ tier-aware 時才接 auth→customers.tier。
//   - 仍對 client 輸入 fail-closed:非陣列 / 非 {productId:string} / 超量 → 跳過或截斷
//     (品項上限 MAX_LINES 對齊 create_order RPC「品項≤200」、防濫用打爆 Supabase)。
//   - 找不到商品 / 變體已不存在(舊 cart stale)→ found:false,client 不顯示該行、不計入小計。

import { fetchProductByHandle } from '@/lib/products';

/** client 傳入的 line key(僅 productId + 選用 variantId;qty 由 client 自管、不影響單價解析)。 */
export type CartLineInput = {
  productId: string;
  variantId?: string;
};

/**
 * server 解析後回 client 的單行顯示資料。
 * 🔴 經銷防護:價格欄只有 `unitPrice`(general、整數元位 number)、無任何 tier/經銷結構。
 */
export type ResolvedCartLine = {
  /** 回 echo line key(client 用來對應回自己的 cart item;= handle/slug) */
  productId: string;
  /** 回 echo line key(無變體商品為 undefined) */
  variantId?: string;
  /** 商品 / 變體是否解析成功(false = stale cart entry,client 不顯示) */
  found: boolean;
  /** 商品連結用 slug(= productId,顯式回傳避免 client 重組) */
  slug: string;
  brand: string;
  name: string;
  /** 代表圖 URL(無圖 null,client fallback) */
  image: string | null;
  /** 適用車款衍生字串(design cart-item-vehicle「適用 X」) */
  fits: string;
  /** 變體識別字串(spec 值合併 / fallback sku;無變體商品為 null) */
  variantLabel: string | null;
  /** 🔴 general 公開單價(整數元位 NT$);**唯一價格欄、無 priceByTier/store/cost** */
  unitPrice: number;
};

// 品項上限:對齊 create_order RPC「品項≤200」fail-closed(防 client 送超量 line 打爆查詢)。
const MAX_LINES = 200;
// 單欄長度上限(public server action input、防超長字串濫用打 DB;productId=slug 約 ≤128、
// variantId=uuid 36)。超出 → 視為竄改、fail-closed 跳該行。
const MAX_PRODUCT_ID_LEN = 256;
const MAX_VARIANT_ID_LEN = 64;

/** 把變體 spec 物件壓成顯示字串(值合併、去空);無有效值回 null。 */
function variantLabelFromSpec(spec: Record<string, string>, fallbackSku: string): string | null {
  const values = Object.values(spec)
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v) => v.length > 0);
  if (values.length > 0) return values.join(' · ');
  // spec 全空(理論罕見)→ fallback 顯料號(至少能辨識變體);料號也空 → null。
  return fallbackSku.trim().length > 0 ? fallbackSku.trim() : null;
}

/**
 * 解析購物車 line keys → 顯示資料 + general 單價(server-only、釘 general)。
 *
 * @param lines client cart items 的 line key 陣列(只 productId + variantId);非法 / 超量 fail-closed。
 * @returns 每行解析結果(found:false = 已下架 / 變體不存在,client 略過顯示)。
 */
export async function resolveCartLines(lines: unknown): Promise<ResolvedCartLine[]> {
  // fail-closed 輸入守門:非陣列 → 空;截斷至 MAX_LINES。
  if (!Array.isArray(lines)) return [];
  const safeLines = lines.slice(0, MAX_LINES);

  const out: ResolvedCartLine[] = [];
  for (const raw of safeLines) {
    if (!raw || typeof raw !== 'object') continue;
    const productIdRaw = (raw as { productId?: unknown }).productId;
    if (typeof productIdRaw !== 'string') continue;
    const productId = productIdRaw.trim();
    // 空 / 超長 productId → fail-closed 跳(防超長字串濫用)。
    if (productId.length === 0 || productId.length > MAX_PRODUCT_ID_LEN) continue;
    const variantIdRaw = (raw as { variantId?: unknown }).variantId;
    let variantId: string | undefined;
    if (typeof variantIdRaw === 'string') {
      const trimmed = variantIdRaw.trim();
      // 超長 variantId = 竄改 → 整行跳(不退化成無變體群價、避免錯價);空 → 無變體。
      if (trimmed.length > MAX_VARIANT_ID_LEN) continue;
      variantId = trimmed.length > 0 ? trimmed : undefined;
    }

    // fetchProductByHandle:server-only、cache() per-request(同 handle 多變體只查一次)、釘 general。
    const product = await fetchProductByHandle(productId);
    if (!product) {
      out.push({
        productId,
        variantId,
        found: false,
        slug: productId,
        brand: '',
        name: '',
        image: null,
        fits: '',
        variantLabel: null,
        unitPrice: 0,
      });
      continue;
    }

    let unitPrice: number;
    let variantLabel: string | null = null;
    if (variantId) {
      const variant = (product.variants ?? []).find((v) => v.id === variantId);
      if (!variant) {
        // 變體已不存在(舊 cart stale / 商品改版)→ found:false。
        out.push({
          productId,
          variantId,
          found: false,
          slug: product.slug,
          brand: product.brand,
          name: product.name,
          image: product.image ?? null,
          fits: product.fits,
          variantLabel: null,
          unitPrice: 0,
        });
        continue;
      }
      // 🔴 變體單價取 UIVariant.price(= priceByTier.general、唯一真值;toUIProduct 已 strip)。
      unitPrice = variant.price;
      variantLabel = variantLabelFromSpec(variant.spec, variant.sku);
    } else {
      // 無變體商品:取群代表價(= general、toUIProduct product.price)。
      unitPrice = product.price;
    }

    out.push({
      productId,
      variantId,
      found: true,
      slug: product.slug,
      brand: product.brand,
      name: product.name,
      image: product.image ?? null,
      fits: product.fits,
      variantLabel,
      unitPrice,
    });
  }
  return out;
}
