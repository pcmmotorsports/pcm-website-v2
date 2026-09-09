// app/llms.txt/route.ts — `/llms.txt`(給 AI 讀的站點索引)。純邏輯在 `lib/llms-txt.ts`。
//
// 🔵 形狀抄 `app/robots.ts` / `app/sitemap.ts` 那一套:base 走 `resolveSiteUrl()`,
//   純字串組裝抽到 lib 讓它單測得到,route 只負責接線與回應標頭。
// 🔴 base 未設(prod 未設 `NEXT_PUBLIC_SITE_URL`)⇒ **404**,與 robots 全擋 / sitemap 空
//   是同一個決定:**沒有正式網域的半成品 deploy 不對外宣告任何東西。**

import { resolveSiteUrl } from '@/lib/site-url';
import { buildLlmsTxt } from '@/lib/llms-txt';

// 內容來源是靜態檔(`BRAND_CONTENT`)與常數 ⇒ 零 DB、可以整天快取。
export const revalidate = 86400;

export function GET(): Response {
  const body = buildLlmsTxt(resolveSiteUrl());
  if (!body) return new Response('Not Found', { status: 404 });
  return new Response(body, {
    // 🔴 `text/plain` 而不是 `text/markdown`:llmstxt.org 沒有指定 MIME,而瀏覽器對
    //   `text/markdown` 會下載成檔案。純文字兩邊都讀得到。
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
