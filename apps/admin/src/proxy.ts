import { NextResponse, type NextRequest } from 'next/server';
import { generateRequestId, REQUEST_ID_HEADER } from '@/lib/request-id';
import { ADMIN_SESS_COOKIE, verifySession } from '@/lib/session/session';

// M-4a M0-S2 correlation id 貫穿(PRD §6.7)+ M0-S3 SSO 登入閘。Next 16 約定:proxy.ts(舊 middleware.ts)。
// 每個 admin 請求 server 端**一律新產** x-request-id,讓 handler→audit→DB→外部服務 log 跨層追蹤。
// 🔴 登入閘:crypto.subtle 驗 admin session(runtime-neutral,不綁 proxy runtime 假設)。
//    prod 未登入 → 導 /api/sso/start;dev(NODE_ENV≠production)放行逃生(本機無報價單發起端,否則鎖死)。
//    SSO 收端 start/callback 未登入必須可達(否則無限迴圈)→ 顯式白名單(精確兩條、不用萬用,防未來 sso 端點被靜默放行)。

// 未登入可達的 SSO 入口(精確列,Fable nit-7)。
const SSO_OPEN_PATHS = new Set(['/api/sso/start', '/api/sso/callback']);

// 🔴 登入閘 fail-closed(Fable/Codex MF3):閘的判斷與 cookie 的 IS_PROD **解耦**。
//    用正向 dev bypass flag、預設擋:NODE_ENV 漏設/拼錯/staging 時不會靜默略過整個 admin 登入驗證。
//    dev 本機(無報價單發起端)須顯式設 ADMIN_DEV_BYPASS=1 才放行;prod(NODE_ENV=production)永遠擋、bypass 無效。
const DEV_AUTH_BYPASS =
  process.env.NODE_ENV !== 'production' && process.env.ADMIN_DEV_BYPASS === '1';

export async function proxy(request: NextRequest): Promise<NextResponse> {
  // 🔴 correlation id **一律 server 新產、絕不沿用 inbound**(Fable diff must-fix 1)。
  //    現拓樸=Vercel 直入、無內部代理會帶合法 x-request-id → 唯一 inbound 來源是 client 自帶;
  //    沿用會讓持 session 者指定/重複 request_id 汙染稽核關聯(actor 已自報,request_id 是稽核鏈
  //    僅剩硬關聯、必須 server 權威)。忽略 request.headers 的同名值。
  const requestId = generateRequestId();

  const { pathname } = request.nextUrl;

  // 登入閘:預設擋(未登入導 /start);只有顯式 dev bypass 才放行。SSO 入口放行、matcher 已排除靜態資源。
  if (!DEV_AUTH_BYPASS && !SSO_OPEN_PATHS.has(pathname)) {
    const session = await verifySession(request.cookies.get(ADMIN_SESS_COOKIE)?.value);
    if (!session) {
      // 帶原 pathname 進 next,登入後回原頁(start 端 safeReturnTo 會再驗)。
      const startUrl = new URL('/api/sso/start', request.url);
      startUrl.searchParams.set('next', pathname);
      const redirect = NextResponse.redirect(startUrl, 303);
      redirect.headers.set(REQUEST_ID_HEADER, requestId);
      redirect.headers.set('Cache-Control', 'no-store');
      return redirect;
    }
  }

  // 戳進轉發給下游(server component / handler)的 request headers → getRequestId() 讀得到。
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  // 也回在 response,方便前端 / 值班回報時對照同一 id。
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  // 排除靜態資源;其餘頁面 / handler 都戳 correlation id。
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
