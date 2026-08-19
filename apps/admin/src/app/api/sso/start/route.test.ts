import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
// #606 之後 admin 測試可用 @/ 直讀原模組;本檔測【原檔】route.ts,不建複本。
import { SSO_STATE_COOKIE, decodeStateCookie } from '@/lib/sso/state';
import { GET } from './route';

// 🔴 量具警告(突變實測抓到的恆綠):decodeStateCookie 讀取時會【再跑一次 safeReturnTo】
//    (state.ts decode 層縱深防禦)⇒ 用它斷言 returnTo 永遠看不到 cookie 裡實際存的髒值,
//    route 層+encode 層的消毒全拆掉它照樣回 '/'。⇒ 凡斷言「cookie 存了什麼」一律用本函式
//    讀【原始】值;decodeStateCookie 只用來斷言 state 綁定(s 欄)。
function rawCookieReturnTo(value: string | undefined): unknown {
  if (!value) return undefined;
  return (JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { r?: unknown }).r;
}

const QUOTE_BASE = 'http://quote.test.local';
const EXCHANGE_SECRET = 'x'.repeat(40); // ≥ MIN_SECRET_LEN(32)

const ENV_KEYS = ['PCM_QUOTE_SSO_BASE', 'PCM_SSO_EXCHANGE_SECRET'] as const;

describe('sso/start route', () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env.PCM_QUOTE_SSO_BASE = QUOTE_BASE;
    process.env.PCM_SSO_EXCHANGE_SECRET = EXCHANGE_SECRET;
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  // 前置:cookie 名與 http 允許與否都掛在 IS_PROD(module 載入時定案)。
  it('前置:測試跑在 non-prod(否則 http quoteBase 與 _dev cookie 名整族不成立)', () => {
    expect(process.env.NODE_ENV).not.toBe('production');
  });

  it('config 齊 ⇒ 302 導向報價單 authorize,帶 state;state cookie 同值', () => {
    const res = GET(new NextRequest('http://localhost:3001/api/sso/start'));
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location') ?? '');
    expect(loc.origin).toBe(QUOTE_BASE);
    const urlState = loc.searchParams.get('state');
    expect(urlState).toMatch(/^[0-9a-f]{32}$/);
    const cookie = res.cookies.get(SSO_STATE_COOKIE);
    expect(cookie).toBeTruthy();
    const decoded = decodeStateCookie(cookie?.value);
    expect(decoded?.s).toBe(urlState);
    // codex MF3:state cookie 安全屬性(httpOnly/Lax——Strict 會在跨站回跳丟 cookie,state.ts 檔頭)。
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
    expect(cookie?.path).toBe('/');
    expect(cookie?.maxAge).toBe(60 * 10); // reviewer F1:字面釘死,不拿被測物常數當期望值
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  // Δ1 · 🔴 route 【每一次】都要重新產 state —— 這是 login CSRF 綁定的那一根。
  //   既有兩格看的是「函式產得出隨機值」(state.test.ts)與「形狀是 32 hex」(:47),
  //   而【route 有沒有再叫它一次】沒有人在看:把 route.ts 的 `const state = newState()`
  //   提到 module scope,那兩格【全綠】,而全站共用同一個 state。
  //   (實測:提到 module scope ⇒ 本格紅;還原 ⇒ 全綠。不是紙上突變。)
  it('🔴 兩次 GET 的 state 不得相同(state 每次現產,不得提到 module scope)', () => {
    const stateOf = (res: ReturnType<typeof GET>): string | null =>
      new URL(res.headers.get('location') ?? '').searchParams.get('state');
    const a = GET(new NextRequest('http://localhost:3001/api/sso/start'));
    const b = GET(new NextRequest('http://localhost:3001/api/sso/start'));
    const sa = stateOf(a);
    const sb = stateOf(b);
    expect(sa).toBeTruthy();
    expect(sb).not.toBe(sa);
    // cookie 那一側也要跟著換 —— 只驗 URL 的話,「cookie 寫死而 URL 每次新」也會綠。
    const ca = decodeStateCookie(a.cookies.get(SSO_STATE_COOKIE)?.value)?.s;
    const cb = decodeStateCookie(b.cookies.get(SSO_STATE_COOKIE)?.value)?.s;
    expect(ca).toBe(sa);
    expect(cb).toBe(sb);
  });

  // Δ2 · 302 的目的地要驗到 pathname。既有 :45 只驗 origin ⇒ route 改組 URL 而 origin 不變
  //   (例如打到 /api/sso/exchange 或別的路徑)照樣綠。config.test.ts 驗的是 builder,不是 route。
  it('🔴 302 目的地的 pathname = /api/sso/authorize(只驗 origin 擋不住改錯路徑)', () => {
    const res = GET(new NextRequest('http://localhost:3001/api/sso/start'));
    expect(new URL(res.headers.get('location') ?? '').pathname).toBe('/api/sso/authorize');
  });

  it('?next=合法相對路徑 ⇒ 進 state cookie 的 returnTo(讀原始值)', () => {
    const res = GET(new NextRequest('http://localhost:3001/api/sso/start?next=/orders'));
    expect(rawCookieReturnTo(res.cookies.get(SSO_STATE_COOKIE)?.value)).toBe('/orders');
  });

  it('?next=絕對網址 / 協定相對 / SSO 自身 ⇒ cookie【實際存的值】= "/"(open-redirect 白名單)', () => {
    for (const evil of ['https://evil.test', '//evil.test', '/api/sso/start', '/a?b=1']) {
      const res = GET(
        new NextRequest(`http://localhost:3001/api/sso/start?next=${encodeURIComponent(evil)}`),
      );
      expect(rawCookieReturnTo(res.cookies.get(SSO_STATE_COOKIE)?.value), evil).toBe('/');
    }
  });

  it('config 缺(無 base)⇒ 500,不設 state cookie', () => {
    delete process.env.PCM_QUOTE_SSO_BASE;
    const res = GET(new NextRequest('http://localhost:3001/api/sso/start'));
    expect(res.status).toBe(500);
    expect(res.cookies.get(SSO_STATE_COOKIE)).toBeUndefined();
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer'); // codex MF4
  });

  it('secret 短於下限 ⇒ 同樣 500(config fail-closed)', () => {
    process.env.PCM_SSO_EXCHANGE_SECRET = 'short';
    const res = GET(new NextRequest('http://localhost:3001/api/sso/start'));
    expect(res.status).toBe(500);
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer'); // codex MF4
  });
});
