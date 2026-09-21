import { describe, expect, it } from 'vitest';
import { parseCatalogQuery } from './catalog-query';
import { legacyCategoryLocation } from './legacy-category-redirect';

const CASES = [
  ['/排氣管', '排氣系統'],
  ['/碳纖維', '碳纖維部品'],
  ['/碳纖維/index.html', '碳纖維部品'],
  ['/懸吊系統', '懸吊與車架'],
  ['/懸吊系統/index.html', '懸吊與車架'],
  ['/懸吊系統/懸吊系統/index.html', '懸吊與車架'],
  ['/輪框', '懸吊與車架 · 輪圈'],
  ['/懸吊系統/輪框.html', '懸吊與車架 · 輪圈'],
  ['/改裝精品/輪框.html', '懸吊與車架 · 輪圈'],
] as const;

describe('legacy category path mapping', () => {
  it.each(CASES)('%s maps to one safely encoded category location', (path, category) => {
    const encodedPathname = new URL(path, 'https://www.pcmmotorsports.com').pathname;
    const lowerHexPathname = encodedPathname.replace(/%[0-9A-F]{2}/g, (value) => value.toLowerCase());
    for (const pathname of [encodedPathname, lowerHexPathname]) {
      const location = legacyCategoryLocation(pathname);
      expect(location).toBe(`/products?${new URLSearchParams({ category }).toString()}`);
      expect(parseCatalogQuery(new URL(location!, 'https://www.pcmmotorsports.com').searchParams).category)
        .toBe(category);
    }
  });

  it.each([
    '/hello-world/feed',
    '/改裝精品',
    '/耗材零件工具',
    '/車身改裝精品',
    '/懸吊系統/不存在',
    '/toString',
    '/constructor',
    '/__proto__',
  ])('%s remains unmapped so the catch-all handler returns 404', (path) => {
    expect(legacyCategoryLocation(new URL(path, 'https://www.pcmmotorsports.com').pathname)).toBeUndefined();
  });

  it.each([
    ['碳纖維%2Findex.html'],
    ['碳纖維%2findex.html'],
    ['懸吊系統%2F懸吊系統%2Findex.html'],
    ['碳纖維/index.html'],
  ])('rejects an encoded or decoded slash inside one path segment: %s', (segment) => {
    expect(legacyCategoryLocation(`/${segment}`)).toBeUndefined();
  });

  it('rejects malformed percent encoding instead of widening the match', () => {
    expect(legacyCategoryLocation('/%E6%8E')).toBeUndefined();
  });

  it.each([
    '/_NEXTSEP_碳纖維',
    '/碳纖維/_NEXTSEP_index.html',
    '/%5FNEXTSEP%5F碳纖維',
    '/_NEXTSEP_懸吊系統/_NEXTSEP_輪框.html',
  ])('rejects Next internal-marker lookalikes before route params can be normalized: %s', (path) => {
    expect(legacyCategoryLocation(new URL(path, 'https://www.pcmmotorsports.com').pathname)).toBeUndefined();
  });
});
