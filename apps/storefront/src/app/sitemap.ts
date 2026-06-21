// app/sitemap.ts — /sitemap.xml(Next App Router metadata route)。GEO P0「地圖」。
//
// 商品來源 = fetchCatalogProducts()(匿名 client、tier 釘 general、走 products_public view →
// 經銷價零外洩、已分頁繞 1000 列上限)。現階段全站公開商品恰在單一品類、涵蓋 100%。
// 🔴 多品牌(#212)上架後 category-scoped 撈法會漏其他品類商品 → backlog #247(治本補全品類 public 列舉)。
//
// 快取:每日 revalidate,避免每個爬蟲請求都全量打 DB。
// 休眠:base undefined(prod 未設 NEXT_PUBLIC_SITE_URL)→ 回空、省一次 DB 撈(見 lib/seo.ts 檔頭 🔴)。

import type { MetadataRoute } from 'next';
import { resolveSiteUrl } from '@/lib/site-url';
import { fetchCatalogProducts } from '@/lib/products';
import { buildSitemapEntries } from '@/lib/seo';

export const revalidate = 86400; // 1 天

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = resolveSiteUrl();
  if (!base) return []; // 休眠:未設正式網域不產 sitemap(與 buildSitemapEntries 一致、且省 DB 撈)。
  const { products } = await fetchCatalogProducts();
  const handles = products.map((p) => p.slug);
  return buildSitemapEntries(handles, base);
}
