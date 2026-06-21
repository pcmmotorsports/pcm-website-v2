// app/robots.ts — /robots.txt(Next App Router metadata route)。GEO P0「大門」。
// 純邏輯在 lib/seo.ts buildRobots;base 走 lib/site-url.ts resolveSiteUrl()
// (prod 未設 NEXT_PUBLIC_SITE_URL → base undefined → 休眠全擋,見 lib/seo.ts 檔頭 🔴)。

import type { MetadataRoute } from 'next';
import { resolveSiteUrl } from '@/lib/site-url';
import { buildRobots } from '@/lib/seo';

export default function robots(): MetadataRoute.Robots {
  return buildRobots(resolveSiteUrl());
}
