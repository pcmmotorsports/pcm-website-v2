// /indexnow-key.txt —— IndexNow 的金鑰檔(2026-09-29 計畫 ~/pcm-mailbox/計畫-IndexNow-20260929.md, Fable R2 PASS)。
//
// 每日同步後 `scripts/indexnow-submit.ts` 把變動的商品網址送給 api.indexnow.org, 並用 keyLocation 指到這裡;
// 搜尋引擎來讀這個檔、內容等於送出時的 key ⇒ 證明網址是這個網域的主人送的。
// · 金鑰放 env `INDEXNOW_KEY`(Vercel 前台 production + GitHub Secrets 同一個值), 不寫進 repo。
//   IndexNow 的金鑰本來就是公開驗證用的, 拿到它只能替這個網域送網址。
// · force-dynamic:不讓 build 把值寫死在部署裡(換金鑰不必重新部署)。
// · 沒設、格式不合、或經銷站(不收錄)⇒ 404。
// · 不放 /api 底下:robots 擋了 /api(lib/seo.ts)。

import { resolveSiteMode } from '@/lib/site-mode';

export const dynamic = 'force-dynamic';

/** IndexNow 規範:8–128 字元, 只能是英數與連字號。 */
const KEY_RE = /^[a-zA-Z0-9-]{8,128}$/;

export function GET(): Response {
  const key = process.env.INDEXNOW_KEY?.trim() ?? '';
  if (resolveSiteMode() === 'b2b' || !KEY_RE.test(key)) return new Response('Not Found', { status: 404 });
  return new Response(key, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}
