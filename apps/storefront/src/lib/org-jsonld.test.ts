// org-jsonld.test.ts — Organization(Store)JSON-LD builder 回歸測(GEO P0)。
//
// 鎖死:① 核心商家欄位(name/legalName/taxID/telephone/email/address/openingHours/sameAs)用真值;
// ② 逐欄白名單(Object.keys ⊆ 允許集、無 ...spread 髒值);③ base 有值才放 @id/url/logo/image、
// 無值(prod 未設網域)則省略;④ sameAs 為可點 URL。

import { describe, it, expect, vi, beforeEach } from 'vitest';

// 隔離 base 解析:直接 mock resolveSiteUrl,精準測「有 base / 無 base」兩分支(不靠 NODE_ENV)。
vi.mock('@/lib/site-url', () => ({
  resolveSiteUrl: vi.fn(),
}));

import { resolveSiteUrl } from '@/lib/site-url';
import { buildOrganizationJsonLd, serializeOrganizationJsonLd } from './org-jsonld';

const mockResolve = vi.mocked(resolveSiteUrl);
const BASE = 'https://pcmmotorsports.com';

const BASE_KEYS = [
  '@context',
  '@type',
  'name',
  'legalName',
  'alternateName',
  'taxID',
  'telephone',
  'email',
  'address',
  'openingHoursSpecification',
  'sameAs',
];
const URL_KEYS = ['@id', 'url', 'logo', 'image'];

describe('buildOrganizationJsonLd', () => {
  beforeEach(() => {
    mockResolve.mockReset();
  });

  it('核心商家欄位用 Sean 提供的真值 + @type:Store', () => {
    mockResolve.mockReturnValue(BASE);
    const o = buildOrganizationJsonLd();
    expect(o['@context']).toBe('https://schema.org');
    expect(o['@type']).toBe('Store');
    expect(o.name).toBe('PCM Motorsports');
    expect(o.legalName).toBe('派達有限公司');
    expect(o.alternateName).toBe('PCM MOTOR PARTS LTD');
    expect(o.taxID).toBe('90003020');
    expect(o.telephone).toBe('+886-930-531-867');
    expect(o.email).toBe('sean@pcmmotorsports.com');
  });

  it('address 為 PostalAddress、含化成路門市地址', () => {
    mockResolve.mockReturnValue(BASE);
    const addr = buildOrganizationJsonLd().address as Record<string, unknown>;
    expect(addr['@type']).toBe('PostalAddress');
    expect(addr.addressCountry).toBe('TW');
    expect(addr.addressLocality).toBe('新莊區');
    expect(addr.streetAddress).toBe('化成路736巷18號1樓');
  });

  it('openingHoursSpecification 週一–六 10:00–19:00', () => {
    mockResolve.mockReturnValue(BASE);
    const oh = buildOrganizationJsonLd().openingHoursSpecification as Record<string, unknown>;
    expect(oh['@type']).toBe('OpeningHoursSpecification');
    expect(oh.dayOfWeek).toHaveLength(6);
    expect(oh.opens).toBe('10:00');
    expect(oh.closes).toBe('19:00');
  });

  it('sameAs 為 3 個可點 URL(FB / IG / LINE),不含 @pcmmoto basic id', () => {
    mockResolve.mockReturnValue(BASE);
    const sameAs = buildOrganizationJsonLd().sameAs as string[];
    expect(sameAs).toHaveLength(3);
    sameAs.forEach((u) => expect(u).toMatch(/^https:\/\//));
    expect(sameAs).not.toContain('@pcmmoto');
    // 鎖具體真值(Sean 2026-06-21 提供;防社群帳號被誤改打錯)。
    expect(sameAs).toContain('https://www.facebook.com/partscheaper');
    expect(sameAs).toContain('https://www.instagram.com/pcm_officialtw/');
    expect(sameAs).toContain('https://lin.ee/R6QZUH2');
  });

  it('base 有值 → 放 @id/url/logo/image 絕對網址', () => {
    mockResolve.mockReturnValue(BASE);
    const o = buildOrganizationJsonLd();
    expect(o['@id']).toBe(`${BASE}/#store`);
    expect(o.url).toBe(BASE);
    expect(o.logo).toBe(`${BASE}/pcm-logo.png`);
    expect(o.image).toBe(`${BASE}/pcm-logo.png`);
  });

  it('base undefined(prod 未設網域)→ 省略 @id/url/logo/image', () => {
    mockResolve.mockReturnValue(undefined);
    const o = buildOrganizationJsonLd();
    URL_KEYS.forEach((k) => expect(o[k]).toBeUndefined());
    // 核心欄位仍在(身分證不依賴網域)。
    expect(o.name).toBe('PCM Motorsports');
  });

  it('逐欄白名單:所有 key ⊆ 允許集(無 ...spread 髒值混入)', () => {
    mockResolve.mockReturnValue(BASE);
    const allowed = new Set([...BASE_KEYS, ...URL_KEYS]);
    Object.keys(buildOrganizationJsonLd()).forEach((k) => expect(allowed.has(k)).toBe(true));
  });
});

describe('serializeOrganizationJsonLd', () => {
  it('輸出可 JSON.parse 還原、且 escape < 防 breakout', () => {
    mockResolve.mockReturnValue(BASE);
    const s = serializeOrganizationJsonLd();
    expect(s).not.toContain('</script>');
    expect(() => JSON.parse(s)).not.toThrow();
    expect(JSON.parse(s).name).toBe('PCM Motorsports');
  });
});
