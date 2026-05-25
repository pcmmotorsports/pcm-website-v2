// line.test.ts — LINE OAuth 共用模組單元測試(M-1-14e-f2-a1)
//
// node env;mock 'server-only'(本檔讀 env/secret、import 'server-only' 在 node test 會 throw、mock 成空)。
// 驗:env config 缺則 throw、合成 email 決定性、sub 格式驗證、state/nonce 隨機、authorize URL 參數正確。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  buildAuthorizeUrl,
  generateNonce,
  generateState,
  getLineConfig,
  isValidLineUserId,
  LINE_SYNTHETIC_EMAIL_DOMAIN,
  lineSyntheticEmail,
} from './line';

const ENV_KEYS = ['LINE_CHANNEL_ID', 'LINE_CHANNEL_SECRET', 'LINE_REDIRECT_URI'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.LINE_CHANNEL_ID = '1234567890';
  process.env.LINE_CHANNEL_SECRET = 'secret-xyz';
  process.env.LINE_REDIRECT_URI = 'http://localhost:3000/api/auth/line/callback';
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('getLineConfig', () => {
  it('三 env 齊全 → 回 config', () => {
    expect(getLineConfig()).toEqual({
      channelId: '1234567890',
      channelSecret: 'secret-xyz',
      redirectUri: 'http://localhost:3000/api/auth/line/callback',
    });
  });

  it.each(ENV_KEYS)('缺 %s → throw', (key) => {
    delete process.env[key];
    expect(() => getLineConfig()).toThrow(`${key} not set`);
  });
});

describe('lineSyntheticEmail / isValidLineUserId', () => {
  const validSub = 'U' + 'a'.repeat(32);

  it('合成 email 決定性、含固定網域', () => {
    expect(lineSyntheticEmail(validSub)).toBe(`line_${validSub}@${LINE_SYNTHETIC_EMAIL_DOMAIN}`);
    expect(lineSyntheticEmail(validSub)).toBe(lineSyntheticEmail(validSub)); // 同 sub → 同 email
  });

  it('合法 LINE userId(U + 32 hex)→ true', () => {
    expect(isValidLineUserId(validSub)).toBe(true);
  });

  it.each([
    ['空字串', ''],
    ['無 U 前綴', 'a'.repeat(33)],
    ['長度不足', 'U' + 'a'.repeat(31)],
    ['含非 hex', 'U' + 'g'.repeat(32)],
    ['含 @ 注入', `U${'a'.repeat(30)}@x`],
  ])('非法 sub(%s)→ false', (_label, sub) => {
    expect(isValidLineUserId(sub)).toBe(false);
  });
});

describe('generateState / generateNonce', () => {
  it('回 64 hex 字元、兩次不同', () => {
    const s1 = generateState();
    const s2 = generateState();
    expect(s1).toMatch(/^[0-9a-f]{64}$/);
    expect(s1).not.toBe(s2);
    expect(generateNonce()).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('buildAuthorizeUrl', () => {
  it('組正確 LINE authorize URL + 參數', () => {
    const url = new URL(buildAuthorizeUrl({ state: 'st8', nonce: 'nc9' }));
    expect(url.origin + url.pathname).toBe('https://access.line.me/oauth2/v2.1/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('1234567890');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/api/auth/line/callback',
    );
    expect(url.searchParams.get('state')).toBe('st8');
    expect(url.searchParams.get('nonce')).toBe('nc9');
    expect(url.searchParams.get('scope')).toBe('openid profile');
  });
});
