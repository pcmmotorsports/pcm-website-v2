// apps/storefront/src/lib/product-jsonld.ts — schema.org/Product JSON-LD builder(M-1-16c-4c SEO/AI 友善)
//
// 詳情頁 server component 注入 <script type="application/ld+json"> 給 Google 商品結果 / AI 助理讀。
//
// 🔴 經銷價防護(鐵則 12,三層第二道):
//   - builder 只收 MockProduct(UIVariant 型別只帶 price:number = general、**無 priceByTier**;
//     toUIProduct 釘 general、編譯期就擋經銷價)→ 結構上拿不到 store/premiumStore/cost。
//   - **逐欄白名單建構**:絕不 `...product` spread(防 originalPrice / tierLabel / 任何注入髒值
//     混進 JSON-LD)。新增欄位須顯式列入下方,測試以正向白名單(Object.keys ⊆ 允許集)守。
//   - lowPrice/highPrice/price 全取 product.variants[].price / product.price(皆 general)。
//
// 決策(審查 session 2026-06-01 拍):
//   - og:type=website(Q2=A、商品語意交本 JSON-LD @type:Product);本檔不管 OG(page.tsx generateMetadata 管)。
//   - offers 不放 availability(Q3=A、與 #161 不顯庫存一致、零 Merchant 誤導;可後補)。
//   - image 只放絕對 http(s) URL(MUST-FIX 1:目標 DB 34/933 image='/placeholder-product.png' 相對路徑、Google 拒收)。
//
// escape:序列化在 serializeProductJsonLd()(Next 官方 json-ld guide:把每個 < 換成 JS 跳脫序列
//   U+003C〔原始碼第 2 引數雙反斜線、runtime 6 bytes〕→ JSON 解析回 <、但 HTML 不誤判 </script> breakout)。

import type { MockProduct } from '@/data/mock-products';
import { isAbsoluteHttpUrl } from '@/lib/site-url';

const SCHEMA_ORG = 'https://schema.org';
const PRICE_CURRENCY = 'TWD';

export type ProductJsonLd = Record<string, unknown>;

/** schema.org/Product JSON-LD 物件(逐欄白名單;見檔頭 🔴 經銷防護)。 */
export function buildProductJsonLd(
  product: MockProduct,
  opts?: { url?: string },
): ProductJsonLd {
  const jsonLd: ProductJsonLd = {
    '@context': SCHEMA_ORG,
    '@type': 'Product',
    name: product.name,
    // brand:RPM-only 期 = "RPM CARBON"(資料驅動 product.brand、非 hardcode)
    brand: { '@type': 'Brand', name: product.brand },
    // description:真 subtitle(空/空白 → fallback product.name、永遠非空字串)
    description: nonEmptySubtitle(product.subtitle) ?? product.name,
    offers: buildOffers(product),
  };

  // image:只放絕對 http(s) URL(相對路徑 / placeholder / bare-key 過濾;全不合格 → 省略)
  const images = (product.images ?? []).filter(isAbsoluteHttpUrl);
  if (images.length > 0) {
    jsonLd.image = images;
  }

  // sku ← 真主碼 productCode(無 → 省略,不用 slug 冒充 sku)
  if (product.productCode) {
    jsonLd.sku = product.productCode;
  }

  // category(raw 字串如 "碳纖維部品")
  if (product.category) {
    jsonLd.category = product.category;
  }

  // url ← canonical(僅 caller 解析出 base URL 時傳入;prod 未設環境變數則省略、見 site-url.ts)
  if (opts?.url) {
    jsonLd.url = opts.url;
  }

  return jsonLd;
}

/**
 * 序列化為注入 <script> 的精確字串(production 用此、非在 page 重寫)。
 * .replace 把每個 < 換成跳脫序列 U+003C(原始碼第 2 引數寫雙反斜線 → runtime 6 bytes):
 *   JSON 解析回 <、但 HTML 不誤判 </script> breakout(Next 官方寫法)。
 */
export function serializeProductJsonLd(
  product: MockProduct,
  opts?: { url?: string },
): string {
  return JSON.stringify(buildProductJsonLd(product, opts)).replace(/</g, '\\u003c');
}

/** subtitle trim 後非空才回、否則 undefined(讓 caller fallback)。 */
function nonEmptySubtitle(subtitle: string | undefined): string | undefined {
  const trimmed = subtitle?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/**
 * offers:多變體且價有高低 → AggregateOffer(lowPrice/highPrice/offerCount);
 * 變體同價 / 無變體 → 單 Offer。價全取 general(型別層無經銷價)。不放 availability(Q3=A)。
 */
function buildOffers(product: MockProduct): Record<string, unknown> {
  const variantPrices = (product.variants ?? []).map((v) => v.price);

  if (variantPrices.length > 0) {
    const lowPrice = Math.min(...variantPrices);
    const highPrice = Math.max(...variantPrices);
    if (lowPrice !== highPrice) {
      return {
        '@type': 'AggregateOffer',
        priceCurrency: PRICE_CURRENCY,
        lowPrice,
        highPrice,
        offerCount: variantPrices.length, // 精確變體數(CONSIDER 7)
      };
    }
    return {
      '@type': 'Offer',
      priceCurrency: PRICE_CURRENCY,
      price: lowPrice,
    };
  }

  return {
    '@type': 'Offer',
    priceCurrency: PRICE_CURRENCY,
    price: product.price,
  };
}
