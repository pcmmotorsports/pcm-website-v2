// lib/brand-jsonld.ts — 品牌介紹頁的 schema.org(M-6-02,2026-09-14)
//
// 🔵 **為什麼補這一格**:2026-09-14 對 www 站實測 `/brands/akrapovic`,整頁的 `ld+json`
//   **只有 layout 那組 `Store`** —— 沒有 `Brand`、沒有 `BreadcrumbList`。而這一頁通篇
//   在講一個品牌,畫面上也有麵包屑(首頁 › 品牌 › 該品牌)⇒ 補的是**如實描述已經存在的東西**,
//   不是造一個站上沒有的事實(判準與 `lib/breadcrumb-jsonld.ts` 檔頭同一條)。
//
// 🛑 **`/products` 那一頁仍然不做 BreadcrumbList** —— 那是 2026-09-09 主視窗判過的
//   (理由逐字在 `breadcrumb-jsonld.ts:13-19`:麵包屑住在別人在動的元件、且投報率差三個
//   數量級)。⇒ 本片抽出 `buildCrumbListJsonLd` **不是**要順手把那一頁一起做掉。
//
// 🔴 **只放資料檔裡真的有的欄位**:`name` / `url` / `description`(品牌自己的 lede)/ `logo`。
//   ⛔ 不塞 `foundingDate` `address` `sameAs`(官網連結)—— `BrandContent` 沒有這些欄位,
//     `origin`(「義大利 · 米蘭 · 自 1990」)是**給人看的眉標字串**,拆它等於從展示字面反推事實。

import type { BrandContent } from '@/data/brand-content-types';
import { buildCrumbListJsonLd } from '@/lib/breadcrumb-jsonld';
import { safeJsonLd } from '@/lib/json-ld';

/**
 * `schema.org/Brand`。
 *
 * @param base `resolveSiteUrl()`;`undefined` ⇒ 回 `null`(與 canonical / OG 同一套休眠:
 *   吐不出絕對網址就整個不發,寧缺勿錯)。
 * @param description 品牌 lede 的純文字版(呼叫端用 `brandRichTextToPlain` 轉好再傳進來 ——
 *   本檔不 import 那支,`BrandRichString` 的渲染規則不該有第二個出處)。
 * @param logoUrl 深色場 logo 的**絕對**網址;拿不到就不放這個欄位(不塞站台預設圖冒充品牌 logo)。
 */
export function buildBrandJsonLd(
  brand: Pick<BrandContent, 'slug' | 'name'>,
  base: string | undefined,
  description: string,
  logoUrl?: string,
): Record<string, unknown> | null {
  if (!base) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'Brand',
    name: brand.name,
    url: `${base}/brands/${brand.slug}`,
    ...(description ? { description } : {}),
    ...(logoUrl ? { logo: logoUrl } : {}),
  };
}

/** 品牌介紹頁的 `BreadcrumbList`:首頁 › 品牌 › 該品牌(最後一階不帶 item)。 */
export function buildBrandBreadcrumbJsonLd(
  brand: Pick<BrandContent, 'slug' | 'name'>,
  base: string | undefined,
): Record<string, unknown> | null {
  if (!base) return null;
  return buildCrumbListJsonLd([
    { name: '首頁', path: `${base}/` },
    { name: '品牌', path: `${base}/brands` },
    { name: brand.name },
  ]);
}

/** 序列化(escape `<` 防 `</script>` breakout,與 Product / Organization 同源)。 */
export function serializeBrandJsonLd(
  brand: Pick<BrandContent, 'slug' | 'name'>,
  base: string | undefined,
  description: string,
  logoUrl?: string,
): string | null {
  const jsonLd = buildBrandJsonLd(brand, base, description, logoUrl);
  return jsonLd ? safeJsonLd(jsonLd) : null;
}

/** 序列化品牌頁麵包屑。 */
export function serializeBrandBreadcrumbJsonLd(
  brand: Pick<BrandContent, 'slug' | 'name'>,
  base: string | undefined,
): string | null {
  const jsonLd = buildBrandBreadcrumbJsonLd(brand, base);
  return jsonLd ? safeJsonLd(jsonLd) : null;
}
