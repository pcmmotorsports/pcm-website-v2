// @vitest-environment node
// three-ds-urls.test.ts — 3DS result_url 組裝 + URL 守門(M-3 3DS-6a)。
// 🔴 N1 釘死:base = origin-only(嚴);isHttpsUrl = 允許 path/query(鬆、給 TapPay payment_url)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { resolveThreeDSConfig, buildResultUrls, isHttpsUrl } from './three-ds-urls';

const SECRET = 'a'.repeat(48); // ≥32 URL-safe
const ORIG_BASE = process.env.NEXT_PUBLIC_SITE_URL;
const ORIG_SECRET = process.env.TAPPAY_NOTIFY_PATH_SECRET;

beforeEach(() => {
  process.env.TAPPAY_NOTIFY_PATH_SECRET = SECRET; // 多數 base 測需有效 secret(隔離成 base-only 失敗)
});
afterEach(() => {
  if (ORIG_BASE === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = ORIG_BASE;
  if (ORIG_SECRET === undefined) delete process.env.TAPPAY_NOTIFY_PATH_SECRET;
  else process.env.TAPPAY_NOTIFY_PATH_SECRET = ORIG_SECRET;
});

describe('resolveThreeDSConfig — base(origin-only、嚴)', () => {
  it.each([
    ['https://host', 'https://host'],
    ['https://host/', 'https://host'], // 尾斜線 → origin 去掉
    ['https://host:8443', 'https://host:8443'],
    ['  https://host  ', 'https://host'], // trim
  ])('合法 https origin %s → base=%s', (input, expected) => {
    process.env.NEXT_PUBLIC_SITE_URL = input;
    expect(resolveThreeDSConfig().base).toBe(expected);
  });

  it.each([
    ['http://host', 'http 非 https'],
    ['http://localhost:3000', 'localhost http(dev fallback 不可用於 3DS)'],
    ['https://user@host', '含 username credential'],
    ['https://user:pw@host', '含 user:pw credential'],
    ['https://host/path', '含 path(非 origin)'],
    ['https://host?x=1', '含 query'],
    ['https://host#h', '含 hash'],
    ['not-a-url', '非 URL'],
    ['ftp://host', '非 http(s)'],
    ['', '空'],
  ])('非法 base %s(%s)→ throw', (input) => {
    process.env.NEXT_PUBLIC_SITE_URL = input;
    expect(() => resolveThreeDSConfig()).toThrow();
  });

  it('NEXT_PUBLIC_SITE_URL 未設 → throw', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(() => resolveThreeDSConfig()).toThrow();
  });
});

describe('resolveThreeDSConfig — secret(≥32 URL-safe、同 notify-secret)', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://pcm.example'; // 隔離成 secret-only 失敗
  });

  it('合法 base + secret → { base, secret }', () => {
    expect(resolveThreeDSConfig()).toEqual({ base: 'https://pcm.example', secret: SECRET });
  });

  it.each([
    ['短 secret(<32)', 'a'.repeat(31)],
    ['含 /', `${'a'.repeat(40)}/${'b'.repeat(8)}`],
    ['空', ''],
  ])('非法 secret %s → throw', (_label, s) => {
    process.env.TAPPAY_NOTIFY_PATH_SECRET = s;
    expect(() => resolveThreeDSConfig()).toThrow();
  });

  it('secret 未設 → throw', () => {
    delete process.env.TAPPAY_NOTIFY_PATH_SECRET;
    expect(() => resolveThreeDSConfig()).toThrow();
  });
});

describe('isHttpsUrl — payment_url 守門(較鬆、🔴 允許 path/query/hash)', () => {
  it.each([
    'https://sandbox.tappaysdk.com/tpc/payment/3ds?token=abc123', // 🔴 帶 token query(payment_url 本質)
    'https://prod.tappaysdk.com/x/y/z',
    'https://host',
    'https://host:8443/p?a=1#frag',
  ])('合法 https payment_url %s → true', (url) => {
    expect(isHttpsUrl(url)).toBe(true);
  });

  it.each([
    ['http://host/pay', 'http'],
    ['https://user@host/pay', '含 username credential'],
    ['https://user:pw@host', '含 user:pw credential'],
    ['ftp://host', '非 http(s)'],
    ['not a url', '壞值'],
    ['', '空'],
    ['//host/pay', '無 protocol'],
  ])('非法 payment_url %s(%s)→ false', (url) => {
    expect(isHttpsUrl(url)).toBe(false);
  });
});

describe('buildResultUrls — 純 interpolate(對齊 3DS-3 callback / 3DS-2 webhook)', () => {
  it('frontend=<base>/checkout/callback?order=<orderId>、backend=<base>/api/checkout/tappay-notify/<secret>', () => {
    const cfg = { base: 'https://pcm.example', secret: SECRET };
    expect(buildResultUrls(cfg, 'order-abc')).toEqual({
      frontendRedirectUrl: 'https://pcm.example/checkout/callback?order=order-abc',
      backendNotifyUrl: `https://pcm.example/api/checkout/tappay-notify/${SECRET}`,
    });
  });
});
