// src/proxy.ts —— 每次請求的站別後備檢查(B2B 計畫第四版 C 節 L3)。
//
// 為什麼放 proxy 不放根 layout(Fable 第四版 R1 must-fix):站內換頁、server action、route handler
// 都不會重跑根 layout;proxy 每個請求都經過,而且能直接寫 cookie。
// 用途:登入當下(L2)放行之後等級才變的人 —— 剛被核准成經銷、被降級、或 L2 沒擋到的舊登入 ——
// 下一個請求就被登出並導到登入頁說明。
//
// 規則(細節見計畫 L3 細節 1–9):
// - 只有帶登入 cookie 的請求才查(訪客零成本)。
// - 另建讀 request cookie 的 client,**不可以 import lib/supabase/server.ts**(細節 1:它走 next/headers,
//   Next 16.3 在 proxy 回傳後會用那一份覆寫 set-cookie,刪 cookie 那幾行會被蓋掉)。
// - 站別不對、或經銷站確定查不到 ⇒ 直接刪本機登入 cookie(不呼叫登入系統,故障時也刪得掉、不會迴圈)再導到 /login。
// - 可重試的錯誤 ⇒ 經銷站的頁面請求回 503、不刪 cookie(細節 5);一般站放行(一般站本來就顯示一般價)。
// - 帶 Next-Action 的請求不導向(細節 4):清掉 request 與 response 的登入 cookie 後放行,讓 action 走「未登入」處理。
//   可重試的錯誤時 action 直接放行(Codex L3 R1 必修 3):action 收到 HTML 503 只會顯示框架錯誤;
//   各 action 自己會驗使用者,建單與購物車另有 L4 依站別擋。
// - 不查的請求:
//   · 頁面(非 action):/login(精確比對,避免迴圈)、/login/reset 與 /auth/confirm(計畫 §9.9:設定密碼到一半不能被登出)、
//     /auth/callback 與 /api/auth/line/*(登入入口,L2 自己會檢查)。
//   · action:只有 /login/reset(重設密碼那顆送出鈕)。其他路徑的 action 一律檢查(Codex L3 R1 必修 2)。
//     ⚠️ 已知上限:action 的身分只看得到網址、看不到是哪一支 ⇒ 有人刻意把別的 action 送到 /login/reset
//     仍會跳過這裡;錢相關的 action 由 L4 在 action 內依站別擋,其餘只影響自己的資料。
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { resolveSiteMode } from '@/lib/site-mode';
import { authCookieBase, decideSiteAccess, isAuthCookieName, resolveRawTier, tierReaderFrom } from '@/lib/site-access';
import { DEALER_APPLY_URL, type SiteLoginError } from '@/lib/auth/site-login-copy';

const EXEMPT_PAGES = new Set(['/login', '/login/reset', '/auth/confirm', '/auth/callback']);
const EXEMPT_ACTIONS = new Set(['/login/reset']);

export async function proxy(request: NextRequest): Promise<NextResponse> {
  // B2B 入口:經銷商申請表只在一般站用(申請中的人是一般會員,在經銷站會被登出;計畫 E 節)。
  //   頁尾的相對連結 /dealer-apply 在經銷站也要走得通 ⇒ 在頁面的「沒登入導去 /login」之前就導回一般站。
  if (resolveSiteMode() === 'b2b' && request.nextUrl.pathname === '/dealer-apply') {
    return NextResponse.redirect(DEALER_APPLY_URL + request.nextUrl.search); // 查詢參數帶著(例如 ?edit=1)
  }
  const base = authCookieBase();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !url || !anonKey) return NextResponse.next();

  const authNames = () => request.cookies.getAll().map((c) => c.name).filter((n) => isAuthCookieName(n, base));
  const incoming = authNames();
  if (incoming.length === 0) return NextResponse.next();

  const isAction = request.headers.has('next-action');
  const { pathname } = request.nextUrl;
  const exempt = isAction
    ? EXEMPT_ACTIONS.has(pathname)
    : EXEMPT_PAGES.has(pathname) || pathname.startsWith('/api/auth/line/');
  if (exempt) return NextResponse.next();

  // Supabase 官方 proxy 的形狀:換新的權杖寫進 request(給後面的頁面)與同一個 response,
  // 連同它要求的防快取標頭(登入 cookie 的回應不能被 CDN 快取給別人)。
  let response = NextResponse.next({ request });
  let refreshHeaders: Record<string, string> = {};
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet, headers) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        refreshHeaders = { ...refreshHeaders, ...headers };
        Object.entries(refreshHeaders).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  const mode = resolveSiteMode();
  const access = decideSiteAccess(mode, await resolveRawTier(tierReaderFrom(supabase)));

  // guest = 帶著 cookie 但登入系統說沒有 session(過期或壞掉的 cookie);後面的頁面也會當訪客,只看得到一般價。
  if (access.kind === 'allowed' || access.kind === 'guest') return response;

  let code: SiteLoginError;
  if (access.kind === 'wrong-site') {
    // 登入當下(L2)站別是對的 ⇒ 走到這裡多半是之後等級變了:一般站的人剛被核准、經銷站的人被降級(計畫 E 節)。
    code = access.reason === 'member-on-b2b' ? 'site-dealer-revoked' : 'site-dealer-approved';
  } else {
    if (mode === 'retail' || (access.retryable && isAction)) return response;
    if (access.retryable) return unavailable(response, refreshHeaders);
    code = 'site-unknown';
  }

  // 🔴 要刪的名單 = 進來時的 + 查詢途中換新權杖後的(Codex L3 R1 必修 1:分段數可能變,例如 .0/.1 縮成不分段)。
  const names = [...new Set([...incoming, ...authNames()])];
  if (isAction) {
    // server action 被導向時,瀏覽器會重送並顯示「An unexpected response was received」(細節 4)。
    names.forEach((n) => request.cookies.delete(n));
    const pass = NextResponse.next({ request });
    expire(pass, names);
    return pass;
  }
  const to = new URL('/login', request.url);
  to.searchParams.set('error', code);
  const redirect = NextResponse.redirect(to);
  expire(redirect, names);
  redirect.headers.set('Cache-Control', 'no-store');
  return redirect;
}

/** 刪本機登入 cookie(登入 cookie 都寫在 path=/;ResponseCookies 預設也是 '/',這裡寫明)。 */
function expire(res: NextResponse, names: string[]): void {
  names.forEach((n) => res.cookies.set(n, '', { path: '/', maxAge: 0 }));
}

/** 經銷站暫時無法確認等級。保留查詢途中換新的權杖(否則瀏覽器只能拿舊的重試)。 */
function unavailable(from: NextResponse, headers: Record<string, string>): NextResponse {
  const res = new NextResponse(
    '<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>請稍後重試</title>' +
      '<body style="font-family:sans-serif;padding:48px 16px;text-align:center">' +
      '<p>目前無法確認經銷資格，請稍後重試。</p><p><a href="">重新整理</a></p></body></html>',
    { status: 503, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '5', 'Cache-Control': 'no-store' } },
  );
  from.cookies.getAll().forEach((c) => res.cookies.set(c));
  return res;
}

export const config = {
  // 靜態檔、圖片與影片不經過(照 apps/admin/src/proxy.ts 的形狀,再排除常見圖檔與影片)。
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|mp4|webm)$).*)'],
};
