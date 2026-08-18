import { describe, expect, it, vi } from 'vitest';
import type { SsoConfig } from './config';
import { exchangeCode } from './exchange';

const config: SsoConfig = { quoteBase: 'https://quote.example.com', exchangeSecret: 'shh' };
const NOW = 1_700_000_000;

function mockFetch(json: () => Promise<unknown>, ok = true, status = 200): typeof fetch {
  return vi.fn(async () => ({ ok, status, json })) as unknown as typeof fetch;
}

describe('exchangeCode', () => {
  it('success: parses amr + auth_time', async () => {
    const fetch = mockFetch(async () => ({ ok: true, amr: ['pwd', 'totp'], auth_time: NOW - 100 }));
    expect(await exchangeCode('code', 'state', config, { fetch, nowSec: NOW })).toEqual({
      amr: ['pwd', 'totp'],
      auth_time: NOW - 100,
    });
  });

  it('sends Bearer secret + {code,state} to exchange URL', async () => {
    const spy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, amr: ['pwd'], auth_time: NOW }),
    }));
    await exchangeCode('C', 'S', config, { fetch: spy as unknown as typeof fetch, nowSec: NOW });
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://quote.example.com/api/sso/exchange');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer shh');
    expect(JSON.parse(init.body as string)).toEqual({ code: 'C', state: 'S' });
    expect(init.redirect).toBe('error'); // 禁跟隨 3xx(MF2)
  });

  it('401 → null', async () => {
    const fetch = mockFetch(async () => ({ error: 'unauthorized' }), false, 401);
    expect(await exchangeCode('c', 's', config, { fetch, nowSec: NOW })).toBeNull();
  });

  it('ok !== true → null', async () => {
    const fetch = mockFetch(async () => ({ ok: false, amr: ['pwd'], auth_time: NOW }));
    expect(await exchangeCode('c', 's', config, { fetch, nowSec: NOW })).toBeNull();
  });

  it('non-JSON body → null', async () => {
    const fetch = mockFetch(async () => {
      throw new Error('bad json');
    });
    expect(await exchangeCode('c', 's', config, { fetch, nowSec: NOW })).toBeNull();
  });

  it('rejects whole exchange if ANY amr value is unknown (fail-closed, MF1)', async () => {
    const f1 = mockFetch(async () => ({ ok: true, amr: ['pwd', 'evil'], auth_time: NOW }));
    expect(await exchangeCode('c', 's', config, { fetch: f1, nowSec: NOW })).toBeNull();
    const f2 = mockFetch(async () => ({ ok: true, amr: ['pwd', 123], auth_time: NOW }));
    expect(await exchangeCode('c', 's', config, { fetch: f2, nowSec: NOW })).toBeNull();
  });

  it('accepts all-known amr', async () => {
    const fetch = mockFetch(async () => ({ ok: true, amr: ['pwd', 'totp'], auth_time: NOW }));
    expect(await exchangeCode('c', 's', config, { fetch, nowSec: NOW })).toEqual({ amr: ['pwd', 'totp'], auth_time: NOW });
  });

  it('empty amr array → null', async () => {
    const fetch = mockFetch(async () => ({ ok: true, amr: [], auth_time: NOW }));
    expect(await exchangeCode('c', 's', config, { fetch, nowSec: NOW })).toBeNull();
  });

  it('auth_time as numeric string (bigint serialization) → parsed', async () => {
    const fetch = mockFetch(async () => ({ ok: true, amr: ['pwd'], auth_time: String(NOW - 5) }));
    expect(await exchangeCode('c', 's', config, { fetch, nowSec: NOW })).toEqual({ amr: ['pwd'], auth_time: NOW - 5 });
  });

  it('auth_time in future beyond +30s skew → null', async () => {
    const fetch = mockFetch(async () => ({ ok: true, amr: ['pwd'], auth_time: NOW + 31 }));
    expect(await exchangeCode('c', 's', config, { fetch, nowSec: NOW })).toBeNull();
  });

  it('auth_time within +30s skew → ok', async () => {
    const fetch = mockFetch(async () => ({ ok: true, amr: ['pwd'], auth_time: NOW + 20 }));
    expect(await exchangeCode('c', 's', config, { fetch, nowSec: NOW })).toEqual({ amr: ['pwd'], auth_time: NOW + 20 });
  });

  it('auth_time non-integer / non-numeric string → null', async () => {
    const f1 = mockFetch(async () => ({ ok: true, amr: ['pwd'], auth_time: 1.5 }));
    expect(await exchangeCode('c', 's', config, { fetch: f1, nowSec: NOW })).toBeNull();
    const f2 = mockFetch(async () => ({ ok: true, amr: ['pwd'], auth_time: 'abc' }));
    expect(await exchangeCode('c', 's', config, { fetch: f2, nowSec: NOW })).toBeNull();
  });

  it('fetch rejects (network / timeout) → null', async () => {
    const failFetch = vi.fn(async () => {
      throw new Error('aborted');
    }) as unknown as typeof fetch;
    expect(await exchangeCode('c', 's', config, { fetch: failFetch, nowSec: NOW })).toBeNull();
  });
});

// ── M-4b E8-B B5:身分欄 sub 的收取(規格 docs/specs/2026-08-17-m4b-e8b-b5-spec.md §B5-4)──
// 🔴 這一批格子驗的是【三態分得開】:缺席 / 合法 / 壞形狀。壓成兩態就是這一片的病。
describe('exchangeCode:sub(M-4b E8-B B5)', () => {
  const base = { ok: true, amr: ['pwd'], auth_time: 1_700_000_000 };
  const call = (body: unknown) =>
    exchangeCode('c', 's', config, {
      fetch: (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch,
      nowSec: 1_700_000_100,
    });

  it('沒有 sub 欄 ⇒ 照舊成功,而結果【不帶】sub(B3/B4 未上線時的常態)', async () => {
    const r = await call(base);
    expect(r).not.toBeNull();
    expect('sub' in (r as object)).toBe(false);
  });

  it('sub:null ⇒ 🔴 整包拒 —— 不得靜默降級成「沒有」', async () => {
    expect(await call({ ...base, sub: null })).toBeNull();
  });

  it('三個合法變體都收得下,且逐字相同', async () => {
    expect((await call({ ...base, sub: { kind: 'user', staff_id: 'sean' } }))?.sub).toEqual({
      kind: 'user',
      staff_id: 'sean',
    });
    expect((await call({ ...base, sub: { kind: 'fallback' } }))?.sub).toEqual({ kind: 'fallback' });
    expect((await call({ ...base, sub: { kind: 'bootstrap' } }))?.sub).toEqual({ kind: 'bootstrap' });
  });

  it('🔴 exact shape:fallback / bootstrap 多帶一個鍵 ⇒ 拒(下游可能把備援升格成具名身分)', async () => {
    expect(await call({ ...base, sub: { kind: 'fallback', staff_id: 'sean' } })).toBeNull();
    expect(await call({ ...base, sub: { kind: 'fallback', x: 1 } })).toBeNull();
    expect(await call({ ...base, sub: { kind: 'bootstrap', staff_id: 'sean' } })).toBeNull();
  });

  it('🔴 exact shape:user 多帶一個鍵也拒(不是只擋 fallback 那一支)', async () => {
    expect(await call({ ...base, sub: { kind: 'user', staff_id: 'sean', role: 'admin' } })).toBeNull();
  });

  it('user 的 staff_id 缺 / 空 / 只有空白 ⇒ 拒', async () => {
    expect(await call({ ...base, sub: { kind: 'user' } })).toBeNull();
    expect(await call({ ...base, sub: { kind: 'user', staff_id: '' } })).toBeNull();
    expect(await call({ ...base, sub: { kind: 'user', staff_id: '   ' } })).toBeNull();
  });

  it('🔴 未知 kind ⇒ 拒,不放行(加變體要先改 sanitizeSub 才收得下)', async () => {
    expect(await call({ ...base, sub: { kind: 'passkey' } })).toBeNull();
    expect(await call({ ...base, sub: { kind: 'USER', staff_id: 'sean' } })).toBeNull();
  });

  // 🔴 codex 關卡2 must-fix:少了這一格，「空物件被誤判成 undefined」那個壞實作【全綠】
  //   —— 三態防線的縫就在 undefined 與「有欄但沒內容」之間
  it('🔴 sub:{} ⇒ 拒(不得被當成「沒有這個欄」)', async () => {
    expect(await call({ ...base, sub: {} })).toBeNull();
  });

  it('sub 是陣列 / 字串 / 數字 ⇒ 拒', async () => {
    for (const bad of [[], ['user'], 'user', 7, true]) {
      expect(await call({ ...base, sub: bad })).toBeNull();
    }
  });
});
