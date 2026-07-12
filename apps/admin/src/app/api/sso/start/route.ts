import { NextRequest, NextResponse } from 'next/server';
import { buildAuthorizeUrl, getSsoConfig } from '@/lib/sso/config';
import {
  SSO_STATE_COOKIE,
  encodeStateCookie,
  newState,
  safeReturnTo,
  stateCookieOptions,
} from '@/lib/sso/state';

// M-4a M0-S3 SSO 收端 — start:發起 SSO。
//   產隨機 state + returnTo → 寫 state cookie(admin 網域,防 login CSRF)→ 302 導向報價單 authorize。
//   目的地=寫死 env base(getSsoConfig),不接受參數決定 host(防 SSRF/open-redirect)。
//   proxy 登入閘放行本路徑(未登入必須可達)。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function configError(): NextResponse {
  const res = NextResponse.json({ error: '設定缺漏' }, { status: 500 });
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export function GET(req: NextRequest): NextResponse {
  const config = getSsoConfig();
  if (!config) {
    return configError();
  }

  const state = newState();
  // ?next=<相對路徑>:登入後回原頁(proxy 閘會帶原 pathname 進來);嚴格白名單、預設 '/'。
  const returnTo = safeReturnTo(req.nextUrl.searchParams.get('next'));

  const res = NextResponse.redirect(buildAuthorizeUrl(config.quoteBase, state), 302);
  res.cookies.set(SSO_STATE_COOKIE, encodeStateCookie(state, returnTo), stateCookieOptions());
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
