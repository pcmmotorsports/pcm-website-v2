// site-url 單測 — resolveSiteUrl prod-safe + isAbsoluteHttpUrl(M-1-16c-4c SEO)
//
// 守 🔴 prod 未設 / 格式不合的環境變數絕不吐 localhost / 壞值 canonical(codex 關卡1 MUST-FIX 2 + 關卡2 CONSIDER 1)。

import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveSiteUrl, isAbsoluteHttpUrl, canonicalAlternates } from './site-url';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isAbsoluteHttpUrl', () => {
  it('絕對 http(s) → true', () => {
    expect(isAbsoluteHttpUrl('https://www.pcmmotorsports.com')).toBe(true);
    expect(isAbsoluteHttpUrl('http://localhost:3000')).toBe(true);
  });
  it('相對 / bare / 非 http → false', () => {
    expect(isAbsoluteHttpUrl('/placeholder-product.png')).toBe(false);
    expect(isAbsoluteHttpUrl('bare-key')).toBe(false);
    expect(isAbsoluteHttpUrl('ftp://x')).toBe(false);
    expect(isAbsoluteHttpUrl('www.pcmmotorsports.com')).toBe(false);
  });
});

describe('resolveSiteUrl', () => {
  it('設有效絕對 URL → 回該值(去尾斜線)', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://www.pcmmotorsports.com/');
    expect(resolveSiteUrl()).toBe('https://www.pcmmotorsports.com');
  });

  it('設有效 URL(無尾斜線)→ 原樣回', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://shop.pcm.tw');
    expect(resolveSiteUrl()).toBe('https://shop.pcm.tw');
  });

  it('🔴 production 未設 → undefined(不 fallback localhost)', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(resolveSiteUrl()).toBeUndefined();
  });

  it('🔴 production 設了非 http(s)(typo / 相對)→ undefined(不吐壞值)', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'www.pcmmotorsports.com');
    vi.stubEnv('NODE_ENV', 'production');
    expect(resolveSiteUrl()).toBeUndefined();
  });

  it('非 production 未設 → localhost(本機可驗)', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('NODE_ENV', 'development');
    expect(resolveSiteUrl()).toBe('http://localhost:3000');
  });

  it('非 production 設了非 http(s) → fallback localhost(不吐壞值)', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '/relative');
    vi.stubEnv('NODE_ENV', 'development');
    expect(resolveSiteUrl()).toBe('http://localhost:3000');
  });
});


// ── canonicalAlternates(M-6-01,2026-09-14)──────────────────────────────
// 守的是「寧缺勿錯」那一條:base 拿不到時**不能**吐相對 canonical(會落到框架預設基底、
// 可能讓 Google 索引到 localhost)⇒ 回空物件,整個 `alternates` 不出現。
describe('canonicalAlternates', () => {
  it('設了正式網域 ⇒ 吐絕對 canonical', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://www.pcmmotorsports.com/');
    expect(canonicalAlternates('/privacy')).toEqual({
      alternates: { canonical: 'https://www.pcmmotorsports.com/privacy' },
    });
  });

  it('🔴 production 未設網域 ⇒ 回空物件、不發 canonical', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(canonicalAlternates('/privacy')).toEqual({});
  });
});
