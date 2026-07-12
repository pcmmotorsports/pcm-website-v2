import { NextResponse, type NextRequest } from 'next/server';
import { generateRequestId, isSafeRequestId, REQUEST_ID_HEADER } from '@/lib/request-id';

// M-4a M0-S2 correlation id 貫穿(PRD §6.7)。Next 16 約定:proxy.ts(舊 middleware.ts、runtime=nodejs)。
// 每個 admin 請求戳一個 x-request-id(沿用上游代理帶進來的、否則新產),
// 讓 handler→audit→DB→外部服務 log 用同一 id 跨層追蹤。
// 🔴 本 proxy **只做 correlation**;登入 / session 驗證是 SSO 收端 slice 的事,這裡不擋任何請求。

export function proxy(request: NextRequest): NextResponse {
  // 🔴 邊界只沿用「形狀安全」的上游 x-request-id;不合法(含注入嘗試)一律新產(見 isSafeRequestId)。
  const incoming = request.headers.get(REQUEST_ID_HEADER);
  const requestId = isSafeRequestId(incoming) ? incoming : generateRequestId();

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
