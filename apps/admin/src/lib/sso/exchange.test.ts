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
