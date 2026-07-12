import { NextRequest, NextResponse } from 'next/server';
import { getRequestId } from '@/lib/audit/context';
import {
  ADMIN_SESS_COOKIE,
  adminSessionCookieOptions,
  buildAdminSession,
  signSession,
} from '@/lib/session/session';
import { getSsoConfig } from '@/lib/sso/config';
import { exchangeCode } from '@/lib/sso/exchange';
import { logSsoLogin } from '@/lib/sso/security-log';
import {
  SSO_STATE_COOKIE,
  clearStateCookieOptions,
  decodeStateCookie,
  safeReturnTo,
} from '@/lib/sso/state';

// M-4a M0-S3 SSO 收端 — callback:收 opaque code。
//   驗 state cookie 相符(login CSRF)→ server-to-server 兌換 → 簽 admin session(新 sid=旋轉)
//   → set session cookie + 清 state cookie → 303 導向乾淨相對 returnTo(allowlist)。
//   🔴 失敗路徑只清 state cookie、**絕不清 session cookie**(防並發/prefetch:另一個成功請求剛設好的 session
//      被 401 分支清掉;code 一次性、雙擊必一 200 一 401)。proxy 閘放行本路徑(未登入必須可達,否則無限迴圈)。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 失敗:303 到錯誤頁、清 state cookie、no-referrer;不動 session cookie。 */
function failResponse(req: NextRequest): NextResponse {
  const res = NextResponse.redirect(new URL('/?sso=error', req.url), 303);
  res.cookies.set(SSO_STATE_COOKIE, '', clearStateCookieOptions());
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

/** 設定缺漏 500(帶與其他回應一致的安全標頭;不動任何 cookie)。 */
function configError(): NextResponse {
  const res = NextResponse.json({ error: '設定缺漏' }, { status: 500 });
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const requestId = await getRequestId();

  const config = getSsoConfig();
  if (!config) {
    logSsoLogin('fail', { requestId, reason: 'config-missing' });
    return configError();
  }

  const decoded = decodeStateCookie(req.cookies.get(SSO_STATE_COOKIE)?.value);
  const code = req.nextUrl.searchParams.get('code');
  const queryState = req.nextUrl.searchParams.get('state');

  // state 綁定:cookie 必須存在且 === query.state(cookie 缺 = 拒),code 必填。
  if (!decoded || !code || !queryState || decoded.s !== queryState) {
    logSsoLogin('fail', { requestId, reason: 'state-mismatch' });
    return failResponse(req);
  }

  const result = await exchangeCode(code, decoded.s, config);
  if (!result) {
    logSsoLogin('fail', { requestId, reason: 'exchange-failed' });
    return failResponse(req);
  }

  const token = await signSession(buildAdminSession(result.amr, result.auth_time));
  if (!token) {
    // 🔴 簽不出 = ADMIN_SESSION_SECRET 缺(設定缺漏)→ 顯式 500,不導 /start(否則未登入→/start→…→再簽不出=無限迴圈,Fable REQ4)。
    logSsoLogin('fail', { requestId, reason: 'sign-failed-config' });
    return configError();
  }

  const res = NextResponse.redirect(new URL(safeReturnTo(decoded.r), req.url), 303);
  res.cookies.set(ADMIN_SESS_COOKIE, token, adminSessionCookieOptions());
  res.cookies.set(SSO_STATE_COOKIE, '', clearStateCookieOptions());
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('Cache-Control', 'no-store');
  logSsoLogin('success', { requestId, amr: result.amr });
  return res;
}
