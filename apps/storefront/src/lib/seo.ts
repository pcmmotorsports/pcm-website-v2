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
// 零依賴的純字串模組(server/client 兩邊都能用)⇒ 不會把任何東西拖進本檔。
import { brandIntroUrl } from '@/lib/brand-url';

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

/**
 * 進 sitemap 的靜態可索引頁(商品詳情頁另由 DB handle 動態補)。'' = 首頁。
 * 🔴 D3c-4 補 `/brands`:那條 route 在 D3c-3 才落地,在此之前不在地圖上。
 *    品牌**介紹頁**(`/brands/<slug>`,20 頁)不放這裡 —— 它們由 `BRAND_CONTENT` 衍生,
 *    見 `buildSitemapEntries` 的 `brandSlugs` 參數。
 */
export const STATIC_SITEMAP_PATHS = ['', '/products', '/brands'] as const;

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
 * sitemap 條目。base 無值 → 空陣列(休眠)。有值 → 靜態頁 + 每個商品 handle + 每個品牌介紹頁。
 * handles 應為公開商品的 handle(= MockProduct.slug,對應路由 /products/[slug])。
 *
 * 🔴 `brandSlugs` **刻意是必填參數、沒有預設值**(D3c-4):給 `= []` 的話,呼叫端漏傳時
 *    20 頁會靜默不進地圖,而 typecheck、既有測試、產出的 XML 都不會有任何症狀 ——
 *    這條 route 的唯一價值就是「有沒有被列出來」。必填 ⇒ 漏傳當場編譯不過。
 * ⚠️ 品牌介紹頁**全部 20 頁都進地圖**,包含目錄零商品那 5 家:那 5 頁的內容(沿革、工藝、
 *    年表)是真的、也渲染得出來,泛白的是**入口**不是頁面本身(Sean 2026-08-04 拍板的範圍)。
 *    把它們排除等於同時對搜尋引擎隱藏 5 篇真內容。
 */
export function buildSitemapEntries(
  handles: readonly string[],
  base: string | undefined,
  brandSlugs: readonly string[],
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

  // 品牌介紹頁的內容是 L1(年 0-1 次改)⇒ `monthly` 比商品的 `weekly` 誠實;
  // priority 0.7 介於分類入口(0.8)與單一商品(0.6)之間。
  // 🔴 路徑走 `brandIntroUrl()`、不自己拼字串(關卡2 R1 nit):品牌介紹頁的網址形狀只有一個
  //    出處,自己拼的話哪天那支改了(例如加前綴),地圖會安靜地指到不存在的網址;
  //    順帶拿到 `encodeURIComponent`(今天 20 個 slug 全 ASCII、但那是資料現況不是保證)。
  const brandEntries: MetadataRoute.Sitemap = brandSlugs.map((slug) => ({
    url: `${base}${brandIntroUrl(slug)}`,
    changeFrequency: 'monthly',
    priority: 0.7,
  }));

  return [...staticEntries, ...productEntries, ...brandEntries];
}
