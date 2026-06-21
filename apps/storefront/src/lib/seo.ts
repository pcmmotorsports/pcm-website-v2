// lib/seo.ts — robots.txt / sitemap.xml 路由的純邏輯 builder(GEO P0「大門 + 地圖」)
//
// app/robots.ts 與 app/sitemap.ts 是 Next App Router metadata route(自動產 /robots.txt 與
// /sitemap.xml),但它們要 await DB / 讀環境變數、不易單測 → 純邏輯抽到本檔(builder 收「已解析的
// base + handle 陣列」、回 Next 型別物件),app/ 端只負責 fetch + 接線。
//
// 🔴 休眠降級(與 site-url.ts resolveSiteUrl() prod-safe 一致):
//   base = undefined(prod 未設 NEXT_PUBLIC_SITE_URL)→ robots 全擋 + sitemap 空陣列。
//   理由:① sitemap 規範要求**絕對 URL**、無 base 產不出合法 sitemap;② 沒設正式網域的半成品
//   deploy 不該被索引。Sean 上線時在 Vercel 設 NEXT_PUBLIC_SITE_URL=https://正式網域 → 自動切
//   「開放 + 全量」,不需改 code。

import type { MetadataRoute } from 'next';

/** 對爬蟲關閉的私頁 / 非索引路徑(robots disallow;對齊既有 noindex 慣例如 checkout/callback)。 */
export const CRAWLER_DISALLOW_PATHS = [
  '/account',
  '/cart',
  '/checkout',
  '/login',
  '/register',
  '/auth',
  '/api',
  '/dev-preview',
] as const;

/** 進 sitemap 的靜態可索引頁(商品詳情頁另由 DB handle 動態補)。'' = 首頁。 */
export const STATIC_SITEMAP_PATHS = ['', '/products'] as const;

/**
 * robots 規則。base 有值 → 開放(擋私頁 + 指 sitemap + host);無值 → 全擋(休眠、見檔頭 🔴)。
 */
export function buildRobots(base: string | undefined): MetadataRoute.Robots {
  if (!base) {
    // 休眠:未設正式網域時不讓任何爬蟲索引(避免半成品 preview 被抓)。
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [...CRAWLER_DISALLOW_PATHS],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}

/**
 * sitemap 條目。base 無值 → 空陣列(休眠)。有值 → 靜態頁 + 每個商品 handle 一條。
 * handles 應為公開商品的 handle(= MockProduct.slug,對應路由 /products/[slug])。
 */
export function buildSitemapEntries(
  handles: readonly string[],
  base: string | undefined,
): MetadataRoute.Sitemap {
  if (!base) return [];

  const staticEntries: MetadataRoute.Sitemap = STATIC_SITEMAP_PATHS.map((path) => ({
    url: `${base}${path}`,
    changeFrequency: path === '' ? 'daily' : 'weekly',
    priority: path === '' ? 1 : 0.8,
  }));

  const productEntries: MetadataRoute.Sitemap = handles.map((handle) => ({
    url: `${base}/products/${handle}`,
    changeFrequency: 'weekly',
    priority: 0.6,
  }));

  return [...staticEntries, ...productEntries];
}
