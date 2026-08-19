import { NextResponse, type NextRequest } from 'next/server';
import { generateRequestId, REQUEST_ID_HEADER } from '@/lib/request-id';
import { ADMIN_SESS_COOKIE, resolveEnvTag, verifySession } from '@/lib/session/session';

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
  //
  // 🔴 **已知例外(M-4b E10 A9d2-1,Sean 2026-08-02 拍板 Q2=C;本檔行為不變)**:
  //    `order_note.append` 這條路寫進 `admin_audit_log.request_id` 的**不是**本行產的 id,
  //    而是表單帶回的一次性 token —— 因為 A6 的冪等鍵就是 `p_request_id`,而本行「每個 HTTP
  //    request 一組新 id」會讓雙擊產生兩筆**刪不掉**的備註(`order_notes` append-only)。
  //    token 由 **server 在渲染表單時**產生(不是瀏覽器自造)⇒ 正常路徑仍是 server 權威;
  //    誠實代價:持 session 者繞過畫面直接 POST 仍可自選/重複那個值,殘餘防線 = A6 的查驗式冪等
  //    (同單 + body_sha256 不符即 RAISE)。該路徑的 log 兩個 id 都記,可對得回來。
  //    詳 `docs/specs/2026-08-02-e10-a9d2-1-note-action-plan.md` §4/§9。
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
      // 🔴🔴 【片 0b · 臨時量測,下一片刪掉】——「票綁環境」要跑在【這個 runtime】,
      //    而【沒有人量過這個 runtime 讀不讀得到 VERCEL_ENV】(session.ts:4 自陳未證實)。
      //    量錯的代價是全員鎖死 + 無限迴圈 ⇒ 先量再接。
      //    ⇒ 放在【未登入就看得到】的 303 上是刻意的:量測的人不必有後台帳號。
      //    ⚠️ 它只吐環境名(production/preview/local/absent),不含任何 secret 或使用者資料。
      redirect.headers.set('x-pcm-env-tag', resolveEnvTag() ?? 'absent');
      return redirect;
    }
  }

  // 戳進轉發給下游(server component / handler)的 request headers → getRequestId() 讀得到。
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  // 也回在 response,方便前端 / 值班回報時對照同一 id。
  response.headers.set(REQUEST_ID_HEADER, requestId);
  // 片 0b 臨時量測(同上,下一片刪掉)。已登入那條路也放,兩條路都要量得到。
  response.headers.set('x-pcm-env-tag', resolveEnvTag() ?? 'absent');
  return response;
}

export const config = {
  // 排除靜態資源;其餘頁面 / handler 都戳 correlation id。
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
