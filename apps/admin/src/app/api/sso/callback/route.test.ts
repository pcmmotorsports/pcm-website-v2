import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
// #606 之後 admin 測試可用 @/ 直讀原模組;本檔測【原檔】route.ts,不建複本。
import { ADMIN_SESS_COOKIE, verifySession } from '@/lib/session/session';
import { SSO_STATE_COOKIE, encodeStateCookie } from '@/lib/sso/state';
import { buildExchangeUrl } from '@/lib/sso/config';

// 框架 runtime 邊界:next/headers 的 headers()/cookies() 在無 Next request scope 時會拋、
// server-only 在非 react-server 條件下 import 即拋(既有慣例同 customers/page.test.tsx)。
// 只墊框架 runtime accessor,不 mock 任何本專案模組(exchange 走真 code、stub 全域 fetch)。
// #613:headers 帶固定 x-request-id ⇒ 安全事件 log 的 request_id 可斷【原值貫穿】,
//      不是「有個非空字串就算」(request-id.ts REQUEST_ID_HEADER 的字面)。
const REQ_ID = vi.hoisted(() => 'req_613-fixed-correlation-id');
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-request-id': REQ_ID }),
  cookies: async () => ({ get: () => undefined, getAll: () => [] }),
}));

import { GET } from './route';

const QUOTE_BASE = 'http://quote.test.local';
const EXCHANGE_SECRET = 'x'.repeat(40);
const SESSION_SECRET = 'test-admin-session-secret-0123456789abcdef';
const STATE = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6'; // 32 hex
const AUTH_TIME = Math.floor(Date.now() / 1000) - 5; // 固定值,成功格要驗它被寫進 session

// 安全標頭(codex MF4):每個回應路徑都該帶;抽 helper 讓失敗/500/成功格逐一斷言。
function expectSecurityHeaders(res: Response): void {
  expect(res.headers.get('Cache-Control')).toBe('no-store');
  expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
}

const ENV_KEYS = ['PCM_QUOTE_SSO_BASE', 'PCM_SSO_EXCHANGE_SECRET', 'ADMIN_SESSION_SECRET'] as const;

// #613 前半:五個 logSsoLogin 呼叫點【逐點】斷言。觀察點=console 真輸出(security-log 不 mock,
// 與本檔「不 mock 本專案模組」同律)⇒ 守的是「呼叫點參數 → stdout JSON」整條,值班撈得到的那行。
function secLogs(spy: ReturnType<typeof vi.spyOn>): Array<Record<string, unknown>> {
  return spy.mock.calls.map((c: readonly unknown[]) => JSON.parse(String(c[0])) as Record<string, unknown>);
}

function okExchangeResponse(): Response {
  return new Response(
    JSON.stringify({ ok: true, amr: ['pwd', 'totp'], auth_time: AUTH_TIME }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function callbackReq(opts: { cookie?: string; code?: string; state?: string; extraCookie?: string }): NextRequest {
  const url = new URL('http://localhost:3001/api/sso/callback');
  if (opts.code !== undefined) url.searchParams.set('code', opts.code);
  if (opts.state !== undefined) url.searchParams.set('state', opts.state);
  const cookies: string[] = [];
  if (opts.cookie !== undefined) cookies.push(`${SSO_STATE_COOKIE}=${opts.cookie}`);
  if (opts.extraCookie !== undefined) cookies.push(opts.extraCookie);
  return new NextRequest(url, {
    headers: cookies.length ? { cookie: cookies.join('; ') } : undefined,
  });
}

describe('sso/callback route', () => {
  let saved: Record<string, string | undefined>;
  let info: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env.PCM_QUOTE_SSO_BASE = QUOTE_BASE;
    process.env.PCM_SSO_EXCHANGE_SECRET = EXCHANGE_SECRET;
    process.env.ADMIN_SESSION_SECRET = SESSION_SECRET;
    info = vi.spyOn(console, 'info').mockImplementation(() => {});
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('前置:測試跑在 non-prod(cookie 名/http base 整族掛在 IS_PROD)', () => {
    expect(process.env.NODE_ENV).not.toBe('production');
  });

  it('成功:state 相符+兌換成功 ⇒ 303 到【同源】returnTo、設可驗的 session cookie、清 state cookie', async () => {
    const fetchSpy = vi.fn().mockImplementation(() => okExchangeResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const res = await GET(
      callbackReq({ cookie: encodeStateCookie(STATE, '/orders'), code: 'code-1', state: STATE }),
    );
    expect(res.status).toBe(303);
    // codex MF1:只驗 pathname 會放過導去 https://evil.test/orders ⇒ 驗完整 origin。
    const loc = new URL(res.headers.get('location') ?? '');
    expect(loc.origin).toBe('http://localhost:3001');
    expect(loc.pathname).toBe('/orders');
    // codex MF2:兌換呼叫的 URL 與 body(code/state 對調會綠的洞)。
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(buildExchangeUrl(QUOTE_BASE));
    expect(JSON.parse(String(calledInit.body))).toEqual({ code: 'code-1', state: STATE });
    const sess = res.cookies.get(ADMIN_SESS_COOKIE);
    expect(sess?.value).toBeTruthy();
    // codex MF3:session cookie 安全屬性。
    // 🔴 maxAge 寫死字面(reviewer F1):斷 ADMIN_SESSION_MAX_AGE_SEC 是拿被測物
    //    自己的常數當期望值,session.ts 把 12h 改成 500 天照樣綠 ⇒ 12h 在這裡釘死。
    expect(sess?.httpOnly).toBe(true);
    expect(sess?.sameSite).toBe('lax');
    expect(sess?.path).toBe('/');
    expect(sess?.maxAge).toBe(60 * 60 * 12);
    const payload = await verifySession(sess?.value);
    expect(payload?.amr).toEqual(['pwd', 'totp']);
    // codex MF2:auth_time 原封寫進 session(寫錯欄位/寫 now 會綠的洞)。
    expect(payload?.auth_time).toBe(AUTH_TIME);
    const state = res.cookies.get(SSO_STATE_COOKIE);
    expect(state?.value).toBe('');
    expect(state?.maxAge).toBe(0);
    expectSecurityHeaders(res);
    // #613 呼叫點5(route.ts:81 success):info 一筆、warn 零筆;request_id=header 原值、amr 原封。
    expect(warn).not.toHaveBeenCalled();
    expect(secLogs(info)).toEqual([{
      evt: 'sso.login',
      outcome: 'success',
      request_id: REQ_ID,
      source_app: 'quote',
      amr: 'pwd+totp',
    }]);
  });

  it('#613 amr 貫穿判別格:第二組 amr 的成功登入,log 記的是那一組(reviewer must-fix:單一樣本分不出「貫穿」與「寫死成 pwd+totp」)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ ok: true, amr: ['pwd'], auth_time: AUTH_TIME }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));
    const res = await GET(
      callbackReq({ cookie: encodeStateCookie(STATE, '/'), code: 'c2', state: STATE }),
    );
    expect(res.status).toBe(303);
    // route.ts:81 寫死 ['pwd','totp'] ⇒ 本格紅;寫死 ['pwd'] ⇒ 上面成功格紅。兩格互為對照。
    expect(secLogs(info)).toEqual([{
      evt: 'sso.login',
      outcome: 'success',
      request_id: REQ_ID,
      source_app: 'quote',
      amr: 'pwd',
    }]);
  });

  it('cookie 的 returnTo 被竄成絕對網址 ⇒ 仍導回同源 "/"(decode+route 雙層擋;decode 單層防線由 state.test.ts 守)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => okExchangeResponse()));
    // encodeStateCookie 會先 safeReturnTo ⇒ 這裡直接構造原始 b64url 繞過 encode 端的驗證
    const raw = Buffer.from(JSON.stringify({ s: STATE, r: 'https://evil.test/x' }), 'utf8')
      .toString('base64url');
    const res = await GET(callbackReq({ cookie: raw, code: 'code-1', state: STATE }));
    expect(res.status).toBe(303);
    const loc = new URL(res.headers.get('location') ?? '');
    expect(loc.origin).toBe('http://localhost:3001'); // codex MF1:pathname '/' 在 evil.test/ 上也成立
    expect(loc.pathname).toBe('/');
  });

  it('state 不符 / cookie 缺 / code 缺 ⇒ 303 /?sso=error 且不打 exchange', async () => {
    const fetchSpy = vi.fn().mockImplementation(() => okExchangeResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const cases = [
      callbackReq({ cookie: encodeStateCookie(STATE, '/'), code: 'c', state: 'b'.repeat(32) }),
      callbackReq({ code: 'c', state: STATE }),
      callbackReq({ cookie: encodeStateCookie(STATE, '/'), state: STATE }),
    ];
    for (const req of cases) {
      const res = await GET(req);
      expect(res.status).toBe(303);
      expect(new URL(res.headers.get('location') ?? '').searchParams.get('sso')).toBe('error');
      expectSecurityHeaders(res); // codex MF4
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    // #613 呼叫點2(route.ts:59 state-mismatch):三個變體各記一筆 warn、reason 逐筆釘死。
    expect(info).not.toHaveBeenCalled();
    expect(secLogs(warn)).toEqual(cases.map(() => ({
      evt: 'sso.login',
      outcome: 'fail',
      request_id: REQ_ID,
      source_app: 'quote',
      reason: 'state-mismatch',
    })));
  });

  it('🔴 失敗路徑不清 session cookie(雙擊/並發防護):帶既有 session 的失敗請求,回應只清 state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => okExchangeResponse()));
    const res = await GET(
      callbackReq({
        cookie: encodeStateCookie(STATE, '/'),
        code: 'c',
        state: 'b'.repeat(32), // 不符 ⇒ 失敗路徑
        extraCookie: `${ADMIN_SESS_COOKIE}=some-live-session`,
      }),
    );
    expect(res.status).toBe(303);
    // reviewer N1:res.cookies 只看得到【回應的 Set-Cookie】,request cookie 不可觀測;
    // 本格驗的就是「失敗回應沒有對 session cookie 發任何 Set-Cookie(含清除)」。
    expect(res.cookies.get(ADMIN_SESS_COOKIE)).toBeUndefined(); // 未 set、未清
    expect(res.cookies.get(SSO_STATE_COOKIE)?.maxAge).toBe(0);
  });

  it('兌換失敗(上游 401)⇒ 303 /?sso=error、不設 session cookie', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"x"}', { status: 401 })));
    const res = await GET(
      callbackReq({ cookie: encodeStateCookie(STATE, '/'), code: 'c', state: STATE }),
    );
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get('location') ?? '').searchParams.get('sso')).toBe('error');
    expect(res.cookies.get(ADMIN_SESS_COOKIE)).toBeUndefined();
    expectSecurityHeaders(res); // codex MF4(R2 抓漏:唯一沒掛 helper 的一格)
    // #613 呼叫點3(route.ts:65 exchange-failed)。
    expect(info).not.toHaveBeenCalled();
    expect(secLogs(warn)).toEqual([{
      evt: 'sso.login',
      outcome: 'fail',
      request_id: REQ_ID,
      source_app: 'quote',
      reason: 'exchange-failed',
    }]);
  });

  it('config 缺 ⇒ 500,不動任何 cookie、不打 exchange', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    delete process.env.PCM_QUOTE_SSO_BASE;
    const res = await GET(
      callbackReq({ cookie: encodeStateCookie(STATE, '/'), code: 'c', state: STATE }),
    );
    expect(res.status).toBe(500);
    expect(res.cookies.get(SSO_STATE_COOKIE)).toBeUndefined();
    expect(res.cookies.get(ADMIN_SESS_COOKIE)).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    expectSecurityHeaders(res); // codex MF4
    // #613 呼叫點1(route.ts:49 config-missing)。
    expect(info).not.toHaveBeenCalled();
    expect(secLogs(warn)).toEqual([{
      evt: 'sso.login',
      outcome: 'fail',
      request_id: REQ_ID,
      source_app: 'quote',
      reason: 'config-missing',
    }]);
  });

  it('🔴 兌換成功但簽不出 session(secret 缺)⇒ 500 而非 303(防 /start 無限迴圈)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => okExchangeResponse()));
    delete process.env.ADMIN_SESSION_SECRET;
    const res = await GET(
      callbackReq({ cookie: encodeStateCookie(STATE, '/'), code: 'c', state: STATE }),
    );
    expect(res.status).toBe(500);
    expect(res.cookies.get(ADMIN_SESS_COOKIE)).toBeUndefined();
    expectSecurityHeaders(res); // codex MF4
    // #613 呼叫點4(route.ts:72 sign-failed-config)。
    expect(info).not.toHaveBeenCalled();
    expect(secLogs(warn)).toEqual([{
      evt: 'sso.login',
      outcome: 'fail',
      request_id: REQ_ID,
      source_app: 'quote',
      reason: 'sign-failed-config',
    }]);
  });

  // ────────────────────────────────────────────────────────────────────────
  // 🔴🔴 **本格是【回歸格】。它今天綠,而那是刻意的。**
  //
  // **為什麼它今天綠**:`exchange` 已經收得下 `sub`(身分),而 `callback:72` 呼叫
  // `buildAdminSession(result.amr, result.auth_time)` —— **`result.sub` 整個被丟掉**。
  // 那是**刻意的**:`sub` 要等 `B5` 才進 payload(順序是硬的,見母 plan §4)。
  //
  // 🔴 **它會在【B5 把 `sub` 接進 payload】那一刻轉紅。那時候【不要刪它,去改它】。**
  //    ⇒ 而那正是本格存在的全部理由:今天那句「`sub` 要等 B5」寫在**註解裡**,
  //      而**做 B5 的人不會讀到那句話**。本格把它搬到**他一定會撞到的位置**。
  //
  // 📎 紀律來源(逐字):`docs/specs/2026-08-16-m4b-e8b-b3-spec.md` 格 12 ——
  //    「**一裝就綠的格,要在檔頭寫明它是回歸格、並寫出【它會在什麼改動下轉紅】**
  //      —— 否則下一個人會把它當成沒用的格刪掉。」**那是那份 spec 自己記過的前科。**
  //
  // ⚠️ **而本格【不是】B4-4／B4-15 那三條驗收的替代品**:
  //    那三條要驗的是「admin 最終發出的身分對不對」,而**今天 payload 裡沒有身分這個東西**
  //    ⇒ 它們今天【測不了】,規格寫在 `b5-spec` 的驗收表。**本格只釘住「現在是刻意丟棄」。**
  it('🔴 回歸格:exchange 回了 sub,而 admin 今天【刻意丟棄】它(B5 接上時本格必須轉紅)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            amr: ['pwd', 'totp'],
            auth_time: AUTH_TIME,
            // 🔴 形狀照 exchange.ts 的 sanitizeSub 白名單(合法的具名身分)
            sub: { kind: 'user', staff_id: 'sean' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    const res = await GET(
      callbackReq({ cookie: encodeStateCookie(STATE, '/orders'), code: 'code-1', state: STATE }),
    );

    // 先確認這一發【真的走完成功路徑】—— 否則下面那個 undefined 可能來自「根本沒簽出票」
    expect(res.status, '沒走到成功路徑 ⇒ 下面的斷言什麼都沒證明').toBe(303);
    const sess = res.cookies.get(ADMIN_SESS_COOKIE);
    expect(sess?.value, '沒有簽出 session ⇒ 同上').toBeTruthy();

    const payload = await verifySession(sess?.value);
    expect(payload, '簽出來的票驗不過 ⇒ 同上').not.toBeNull();
    // ✅ 對照組:合法的東西有帶進去(證明這一發不是「什麼都沒帶」)
    expect(payload?.amr).toEqual(['pwd', 'totp']);
    // 🔴 而身分【沒有】被帶進去 —— 這一行就是本格
    expect(
      (payload as unknown as Record<string, unknown>).sub,
      'session 裡出現了 sub ⇒ 🔴 B5 已經把身分接進 payload 了。\n' +
        '⇒ 【不要刪掉本格】,去改它:把它改成驗「sub 被逐字帶進去且形狀正確」,\n' +
        '   並同時補上 b5-spec 驗收表那三條(缺 sub 不得轉 fallback / 最終 session 的身分對不對)。',
    ).toBeUndefined();
  });
});
