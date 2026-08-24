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

// 🔴 **B5-a**:攔住登入事件那本帳實際 insert 的物件。
//    ⚠️ 沒有這個 mock 時 `recordSsoLogin` 的 DB 那半會在 `createSupabaseServiceClient()` 就炸掉、
//       被 best-effort 吞掉 ⇒ **route 這層對「身分有沒有進第二本帳」完全沒有偵測力**
//       (消融實測:把 callback 的接線整段拿掉,route 這一檔【全綠】)。
const { loginEventInsertSpy } = vi.hoisted(() => {
  // 參數要寫出來,否則 `mock.calls[0]?.[0]` 會 TS2493(見 lib/sso/login-event.test.ts 的同款註解)。
  const loginEventInsertSpy = vi.fn(
    async (_row: Record<string, unknown>): Promise<{ error: unknown }> => ({ error: null }),
  );
  return { loginEventInsertSpy };
});
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ from: () => ({ insert: loginEventInsertSpy }) }),
}));
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

// 🔴 `ADMIN_REQUIRE_REAL_IDENTITY` 也要進來(2026-08-24):部署時序閘那組會設它,
//    而它沒被存還原的話會**漏到同一個 worker 的其他測試檔**去。
const ENV_KEYS = [
  'PCM_QUOTE_SSO_BASE',
  'PCM_SSO_EXCHANGE_SECRET',
  'ADMIN_SESSION_SECRET',
  'ADMIN_REQUIRE_REAL_IDENTITY',
] as const;

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

function callbackReq(opts: { cookie?: string; code?: string; state?: string; extraCookie?: string; next?: string }): NextRequest {
  const url = new URL('http://localhost:3001/api/sso/callback');
  if (opts.code !== undefined) url.searchParams.set('code', opts.code);
  if (opts.state !== undefined) url.searchParams.set('state', opts.state);
  // 只有【本檔的 ?next 那一格】會用到:route 不該讀它,而不讀就必須構造得出來才驗得到。
  if (opts.next !== undefined) url.searchParams.set('next', opts.next);
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

  // 🔴 從 worktree `pcm-vitest-alias`(commit 88845f35)搬過來的唯一一格 —— dev 上原本沒有。
  //    原本【構造不出】:舊的 callbackReq() 參數裡沒有 next ⇒ 這個行為結構上驗不到。
  //    route 現況(已讀 dev:callback/route.ts:56,79):導向目的地取自 state cookie 的 decoded.r
  //    再過 safeReturnTo();searchParams 只被用來拿 code 與 state。⇒ 本格守的是【它不准變】。
  it('🔴 query 的 ?next 不影響導向(returnTo 只認 cookie)—— open-redirect 防線', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => okExchangeResponse()));
    const res = await GET(
      callbackReq({
        cookie: encodeStateCookie(STATE, '/orders'),
        code: 'code-1',
        state: STATE,
        next: '/evil-page',
      }),
    );
    expect(res.status).toBe(303);
    const loc = new URL(res.headers.get('location') ?? '');
    // 只驗 pathname 不夠(同 codex MF1):跨站的 /evil-page 也會讓 pathname 對不上,但 origin 才擋得住整族。
    expect(loc.origin).toBe('http://localhost:3001');
    expect(loc.pathname).toBe('/orders');
    expect(loc.pathname).not.toBe('/evil-page');
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
    // #613 呼叫點4(route.ts 的 sign-failed-config 那一支 —— **不引行號**:2026-08-23 那顆 commit 自己把它從 :72 推到 :77)。
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
  // ✅ **2026-08-24 `B5-a`:本格如它自己預言的那樣轉紅了,而我照它的指示【改它,沒刪它】。**
  //    原本釘的是「今天刻意丟棄」;現在釘的是「逐字帶進去、形狀正確」。
  //    ⛔ ~~🔴 回歸格:exchange 回了 sub,而 admin 今天【刻意丟棄】它(B5 接上時本格必須轉紅)~~
  it('🔴 B5-a:exchange 回了 sub ⇒ admin 簽出的票是 v:2,而 sub 逐字帶進去', async () => {
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
    // 🔴 **本格**:身分被帶進去了,而且是**逐字**的。
    expect(payload?.v, 'exchange 送了 sub 而票仍是 v:1 ⇒ 身分在 callback 被丟掉了').toBe(2);
    expect(payload?.v === 2 && payload.sub).toEqual({ kind: 'user', staff_id: 'sean' });
  });

  // ── b5-spec 驗收表那三條的其中兩條(第三條「那個人在不在職」在 A 庫,本檔測不了)──
  it('🔴 上游【沒送】sub ⇒ 票是 v:1,而**不得**自己轉成 fallback(那是憑空發明一個身分)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, amr: ['pwd'], auth_time: AUTH_TIME }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const res = await GET(
      callbackReq({ cookie: encodeStateCookie(STATE, '/orders'), code: 'code-1', state: STATE }),
    );
    expect(res.status, '沒走到成功路徑 ⇒ 下面的斷言什麼都沒證明').toBe(303);
    const payload = await verifySession(res.cookies.get(ADMIN_SESS_COOKIE)?.value);
    expect(payload, '簽出來的票驗不過 ⇒ 同上').not.toBeNull();
    // 🔴 為什麼這一格重要:`fallback` 在 §7.1 是**允許讀取**的身分。
    //    「沒送 ⇒ 當成 fallback」會把一顆**不知道是誰**的票,升級成一個**明確的身分**。
    expect(payload?.v).toBe(1);
    expect((payload as unknown as Record<string, unknown>).sub).toBeUndefined();
  });

  it('🔴 上游送 fallback ⇒ 逐字是 fallback(不得被「沒有 staff_id」誤判成沒身分)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ ok: true, amr: ['pwd'], auth_time: AUTH_TIME, sub: { kind: 'fallback' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    const res = await GET(
      callbackReq({ cookie: encodeStateCookie(STATE, '/orders'), code: 'code-1', state: STATE }),
    );
    expect(res.status).toBe(303);
    const payload = await verifySession(res.cookies.get(ADMIN_SESS_COOKIE)?.value);
    expect(payload?.v).toBe(2);
    expect(payload?.v === 2 && payload.sub).toEqual({ kind: 'fallback' });
  });

  // 🔴 兩格共用同一個字串。**分開寫的話:改文案時 ① 會紅、而 ②(正對照)會【靜靜變成恆真】**
  //    —— 一個永遠找不到東西的 filter,長得跟「真的沒印」一模一樣。
  const IDENTITY_DROP_MARK = '上游送了 sub';

  // ────────────────────────────────────────────────────────────────────────
  // 🔴 上面那格釘住「今天刻意丟棄」。**而「刻意」在正式站是看不出來的** ——
  //    丟棄與從來沒收到,在 log 裡長得一模一樣。
  //    ⇒ 本組釘住的是**可觀測性**:丟的時候要出聲,沒東西可丟的時候要安靜。
  //    契約與退場條件見 `lib/sso/identity-drop-trace.ts` 檔頭。
  // ✅ **2026-08-24 `B5-a`:本格從「丟的時候要出聲」翻成【世界③:接好了 ⇒ 安靜】。**
  //    🔴 **這一格就是 `identity-drop-trace.ts` 檔頭指定的退場條件** —— 它逐字寫著:
  //    「退場的判準不是『B5-a 說做完了』,是**世界③ 在真 route 上驗得起來**」。
  //    ⇒ 本格綠 = 那個條件成立。
  // ⚠️ **而本格的天花板要寫清楚**:世界③ 綠之後,真 route 上**兩個世界都安靜了**
  //    (送了有接 ⇒ 靜;沒送 ⇒ 靜)⇒ **這一層再也分不出「trace 還活著」與「trace 死了」。**
  //    ⇒ 「它印得出來」那一半的證據在 `b5a-identity-acceptance.test.ts` 的 `[12]`(單元層對照組)。
  //    ⛔ ~~🔴 上游送了 sub 而我們沒接 ⇒ 留下一行【指名 sub 與兩本帳】的痕~~
  it('🔴 世界③:上游送了 sub 而我們【接好了】⇒ 不得留那一行痕', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            amr: ['pwd'],
            auth_time: AUTH_TIME,
            sub: { kind: 'user', staff_id: 'sean' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await GET(
      callbackReq({ cookie: encodeStateCookie(STATE, '/orders'), code: 'code-1', state: STATE }),
    );
    expect(res.status, '沒走到成功路徑 ⇒ 下面的斷言什麼都沒證明').toBe(303);
    const dropCalls = spy.mock.calls.filter((c) => String(c[0]).includes(IDENTITY_DROP_MARK));
    const lines = spy.mock.calls.map((c) => String(c[0]));
    spy.mockRestore();
    expect(
      dropCalls.length,
      `身分已經接進票裡了,而 trace 仍在印 ⇒ 它變成了它自己要防的那種噪音(每次登入都印、永不退場)。\n` +
        `console.warn 收到的是:\n${lines.join('\n')}`,
    ).toBe(0);
  });

  it('🔴 正對照:上游【沒送】sub ⇒ 不得留那一行(否則上一格對「什麼都印」也會過)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, amr: ['pwd'], auth_time: AUTH_TIME }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await GET(
      callbackReq({ cookie: encodeStateCookie(STATE, '/orders'), code: 'code-1', state: STATE }),
    );
    expect(res.status).toBe(303);
    const lines = spy.mock.calls.map((c) => String(c[0]));
    spy.mockRestore();
    expect(lines.filter((l) => l.includes(IDENTITY_DROP_MARK)).length).toBe(0);
  });
});


// ════════════════════════════════════════════════════════════════════════════
// 🔴 B5-a:身分要進【兩本帳】—— session 票 **與** 登入事件表
// ════════════════════════════════════════════════════════════════════════════
// **這一組是消融補回來的。** 我原本只在 `lib/sso/login-event.test.ts` 驗了「insert 收到什麼就寫什麼」,
// 而**沒有人驗 callback 有沒有把 `sub` 交給它** ⇒ 實測兩發突變**全綠逃掉**:
// ```
// M5 callback 不把 sub 帶進 loginEvent            ⇒ 綠(漏掉)
// M6 fallback 也被塞 staff_id(違反 DB 配對 CHECK)  ⇒ 綠(漏掉)
// ```
// 📌 **母題**:兩層各自驗「我收到什麼就做什麼」,而**沒有人驗那兩層之間真的接著**。
describe('🔴 B5-a:callback 把身分交給登入事件那本帳', () => {
  function exchangeReturns(sub?: Record<string, unknown>) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ ok: true, amr: ['pwd'], auth_time: AUTH_TIME, ...(sub ? { sub } : {}) }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
  }
  const go = () =>
    GET(callbackReq({ cookie: encodeStateCookie(STATE, '/orders'), code: 'code-1', state: STATE }));

  // 🔴 env 與 console spy 要自己設 —— 上面那組 `beforeEach` 住在**另一個 describe 裡**,
  //    不會跑到這裡。少了它 ⇒ 簽不出票 ⇒ 500 ⇒ 下面每一格都紅在「沒走到成功路徑」。
  //    (我第一版就是這樣紅的,而**那個 303 前置斷言把它擋在錯誤的結論之前** —— 它值那一行。)
  let saved2: Record<string, string | undefined>;
  beforeEach(() => {
    saved2 = {};
    for (const k of ENV_KEYS) saved2[k] = process.env[k];
    process.env.PCM_QUOTE_SSO_BASE = QUOTE_BASE;
    process.env.PCM_SSO_EXCHANGE_SECRET = EXCHANGE_SECRET;
    process.env.ADMIN_SESSION_SECRET = SESSION_SECRET;
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    loginEventInsertSpy.mockClear().mockResolvedValue({ error: null });
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved2[k] === undefined) delete process.env[k];
      else process.env[k] = saved2[k];
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('sub.kind=user ⇒ 登入事件那一列帶 actor_kind + actor_staff_id', async () => {
    exchangeReturns({ kind: 'user', staff_id: 'sean' });
    expect((await go()).status, '沒走到成功路徑 ⇒ 下面什麼都沒證明').toBe(303);
    expect(loginEventInsertSpy.mock.calls[0]?.[0]).toMatchObject({
      actor_kind: 'user',
      actor_staff_id: 'sean',
    });
  });

  it('🔴 sub.kind=fallback ⇒ actor_staff_id 必須是 null(塞值會違反 DB 的配對 CHECK ⇒ 整列被拒)', async () => {
    exchangeReturns({ kind: 'fallback' });
    expect((await go()).status).toBe(303);
    expect(loginEventInsertSpy.mock.calls[0]?.[0]).toMatchObject({
      actor_kind: 'fallback',
      actor_staff_id: null,
    });
  });

  it('✅ 對照組:上游沒送 sub(今天)⇒ 兩欄都是 null,而那一列仍然寫得出去', async () => {
    exchangeReturns();
    expect((await go()).status).toBe(303);
    expect(loginEventInsertSpy).toHaveBeenCalledTimes(1);
    expect(loginEventInsertSpy.mock.calls[0]?.[0]).toMatchObject({
      actor_kind: null,
      actor_staff_id: null,
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 🔴🔴 B5-a 部署時序閘(2026-08-24 codex B1-5;主視窗 Q-a 批准)
// ════════════════════════════════════════════════════════════════════════════
// 擋的是【順序顛倒】:旗標先於上游開 ⇒ callback 只簽得出 v:1,而新碼立刻拒 v:1
// ⇒ 登入 → 被自己拒 → 回登入頁 → 再登入…**無限迴圈,而每一次登入在 log 上都是成功的**。
//
// ⚠️ 這三格是**一組**:少了 ②③ 兩個正對照,一道「恆回 500」的閘也會讓 ① 綠。
describe('🔴 B5-a 部署時序閘:旗標開了而上游還沒送 sub', () => {
  function exchangeReturns(sub?: Record<string, unknown>) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ ok: true, amr: ['pwd'], auth_time: AUTH_TIME, ...(sub ? { sub } : {}) }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
  }
  const go = () =>
    GET(callbackReq({ cookie: encodeStateCookie(STATE, '/orders'), code: 'code-1', state: STATE }));

  let saved3: Record<string, string | undefined>;
  beforeEach(() => {
    saved3 = {};
    for (const k of ENV_KEYS) saved3[k] = process.env[k];
    process.env.PCM_QUOTE_SSO_BASE = QUOTE_BASE;
    process.env.PCM_SSO_EXCHANGE_SECRET = EXCHANGE_SECRET;
    process.env.ADMIN_SESSION_SECRET = SESSION_SECRET;
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    loginEventInsertSpy.mockClear().mockResolvedValue({ error: null });
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved3[k] === undefined) delete process.env[k];
      else process.env[k] = saved3[k];
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('① 旗標開 + 上游【沒送】sub ⇒ 500,且 reason 逐字 flag-on-without-upstream-sub', async () => {
    process.env.ADMIN_REQUIRE_REAL_IDENTITY = '1';
    exchangeReturns();
    const res = await go();
    // 🔴 釘住 500 而不是 303 —— 導回 /start 就是那個無限迴圈本身
    expect(res.status, '不是 500 ⇒ 那道閘沒開火, 或它把人導回去了(=迴圈)').toBe(500);
    // 🔴 逐字釘 reason:值班要靠它把「大家登不進去」對回「旗標開早了」
    const rows = loginEventInsertSpy.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(rows.map((r) => r.reason)).toContain('flag-on-without-upstream-sub');
    // 沒有簽出票 —— 簽了就是留下一張自己保證會拒的票
    expect(res.cookies.get(ADMIN_SESS_COOKIE)?.value).toBeFalsy();
  });

  it('② ✅ 正對照:旗標開 + 上游【送了】sub ⇒ 正常簽 v:2(證明 ① 不是恆擋)', async () => {
    process.env.ADMIN_REQUIRE_REAL_IDENTITY = '1';
    exchangeReturns({ kind: 'user', staff_id: 'sean' });
    const res = await go();
    expect(res.status, '旗標開而上游送了 sub 卻被擋 ⇒ 那道閘是恆擋的').toBe(303);
    const payload = await verifySession(res.cookies.get(ADMIN_SESS_COOKIE)?.value);
    expect(payload?.v).toBe(2);
  });

  // 🔴🔴 [R2-1] codex R2 第 1 條說:`result.sub = {}` 為 truthy ⇒ 時序閘放行 ⇒ 簽出無效 v:2。
  //    **本格是去量它到底成不成立的**(不是背書、也不是反駁 —— 讓它自己表演)。
  //    上游餵各種壞形狀的 sub,看它們走到哪裡。
  it.each([
    ['空物件 {}', {}],
    ['未知 kind', { kind: 'admin' }],
    ['user 但缺 staff_id', { kind: 'user' }],
    ['user 多一個鍵', { kind: 'user', staff_id: 'sean', extra: 1 }],
    ['fallback 卻帶 staff_id', { kind: 'fallback', staff_id: 'sean' }],
    ['null', null],
    ['陣列', []],
  ])('[R2-1] 旗標開 + 上游送【壞形狀】sub(%s)⇒ 不得簽出票', async (_l, bad) => {
    process.env.ADMIN_REQUIRE_REAL_IDENTITY = '1';
    exchangeReturns(bad as Record<string, unknown>);
    const res = await go();
    // 🔴 判別點是**有沒有票**,不是狀態碼 —— `failResponse` 與成功路徑【都是 303】,
    //    我第一版拿 303 當判準,那一發紅在我自己的量具上(2026-08-24 實測)。
    expect(res.cookies.get(ADMIN_SESS_COOKIE)?.value, '簽出票了 ⇒ 登入迴圈成立').toBeFalsy();
  });

  // 🔴🔴 [R2-1c] 2026-08-24 R3-1(窗 F):**上面那七格全部是【旗標開】的世界,而那是一個盲區。**
  //    📏 R3 的預測 + 本窗實跑驗證(把 `sanitizeSub` 的壞形狀回傳從 `null` 改成 `undefined`):
  //    ```
  //    route.test.ts   ⇒ 29 格【全綠】     ← 七格恆綠, 因為時序閘把「沒 sub」擋成 500 無票
  //    exchange.test.ts ⇒ 🔴 7 格紅        ← 整包拒【有】守門, 只是不在本檔
  //    ```
  //    ⇒ 七格在「整包拒被改寬成【當沒送】」那個世界裡**沒有判別力**。
  //
  // 🔴 **而危險的是【旗標關】那個世界**(= 今天的正式站):
  //    同一個改寬會讓被竄改的回應**簽出一張 v:1 票**、身分被靜默丟掉
  //    —— 那正是這整條線要修的原病,而 route 層原本**零格**站在那裡。
  // ⇒ 本格是唯一在【兩種改寬】下都會紅的那一格,而且它把
  //   「為什麼旗標關也要整包拒」寫在案發地點。
  it.each([
    ['空物件 {}', {}],
    ['未知 kind', { kind: 'admin' }],
    ['user 缺 staff_id', { kind: 'user' }],
    ['fallback 卻帶 staff_id', { kind: 'fallback', staff_id: 'sean' }],
  ])('[R2-1c] 🔴 旗標【關】+ 上游送壞形狀 sub(%s)⇒ 不得簽出【任何】票(v:1 也不行)', async (_l, bad) => {
    delete process.env.ADMIN_REQUIRE_REAL_IDENTITY; // 關 = 今天的正式站
    exchangeReturns(bad as Record<string, unknown>);
    const res = await go();
    // 🔴 判別點:壞形狀必須讓【整包】被拒,而不是「降級成沒有身分、照舊登入」。
    //    後者看起來完全正常 —— 那就是靜默丟身分。
    expect(
      res.cookies.get(ADMIN_SESS_COOKIE)?.value,
      '簽出票了 ⇒ 壞形狀被降級成「沒送」, 身分被靜默丟掉(本線的原病)',
    ).toBeFalsy();
  });

  // ✅ 正對照:少了它,一個「永遠不簽票」的 callback 也會讓上面七格全綠。
  it('[R2-1b] ✅ 正對照:同樣旗標開,而 sub 是【合法】的 ⇒ 一定要簽出票', async () => {
    process.env.ADMIN_REQUIRE_REAL_IDENTITY = '1';
    exchangeReturns({ kind: 'user', staff_id: 'sean' });
    const res = await go();
    expect(res.cookies.get(ADMIN_SESS_COOKIE)?.value, '合法 sub 也沒簽票 ⇒ 上面七格沒有判別力').toBeTruthy();
  });

  it('③ ✅ 正對照:旗標【關】+ 上游沒送 sub ⇒ 正常簽 v:1(今天的行為,零改變)', async () => {
    delete process.env.ADMIN_REQUIRE_REAL_IDENTITY;
    exchangeReturns();
    const res = await go();
    expect(res.status, '旗標關著卻被擋 ⇒ 這道閘漏到了今天的每一次登入').toBe(303);
    const payload = await verifySession(res.cookies.get(ADMIN_SESS_COOKIE)?.value);
    expect(payload?.v).toBe(1);
  });
});
