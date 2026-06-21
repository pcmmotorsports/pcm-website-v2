// seo.test.ts — robots / sitemap builder 回歸測(GEO P0)。
//
// 鎖死:① 休眠降級(base undefined → robots 全擋 + sitemap 空);② 開放時 robots 擋私頁 + 指
// sitemap + host;③ sitemap 含靜態頁 + 每商品 handle、URL 正確絕對網址。

import { describe, it, expect } from 'vitest';
import {
  buildRobots,
  buildSitemapEntries,
  CRAWLER_DISALLOW_PATHS,
  STATIC_SITEMAP_PATHS,
} from './seo';

const BASE = 'https://pcmmotorsports.com';

describe('buildRobots', () => {
  it('base undefined → 全擋(休眠)、無 sitemap / host', () => {
    const r = buildRobots(undefined);
    expect(r.rules).toEqual([{ userAgent: '*', disallow: '/' }]);
    expect(r.sitemap).toBeUndefined();
    expect(r.host).toBeUndefined();
  });

  it('base 有值 → 開放 / 擋私頁 / 指 sitemap / 設 host', () => {
    const r = buildRobots(BASE);
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rule?.userAgent).toBe('*');
    expect(rule?.allow).toBe('/');
    expect(rule?.disallow).toEqual([...CRAWLER_DISALLOW_PATHS]);
    expect(r.sitemap).toBe(`${BASE}/sitemap.xml`);
    expect(r.host).toBe(BASE);
  });

  it('私頁清單涵蓋 account / cart / checkout / login / register / auth / api / dev-preview', () => {
    expect([...CRAWLER_DISALLOW_PATHS]).toEqual([
      '/account',
      '/cart',
      '/checkout',
      '/login',
      '/register',
      '/auth',
      '/api',
      '/dev-preview',
    ]);
  });
});

describe('buildSitemapEntries', () => {
  it('base undefined → 空陣列(休眠)', () => {
    expect(buildSitemapEntries(['a-1', 'b-2'], undefined)).toEqual([]);
  });

  it('base 有值 → 靜態頁 + 每商品 handle、URL 為絕對網址', () => {
    const entries = buildSitemapEntries(['lightech-1', 'brembo-7'], BASE);
    const urls = entries.map((e) => e.url);
    // 靜態頁(首頁 '' + /products)
    expect(urls).toContain(`${BASE}`);
    expect(urls).toContain(`${BASE}/products`);
    // 商品頁
    expect(urls).toContain(`${BASE}/products/lightech-1`);
    expect(urls).toContain(`${BASE}/products/brembo-7`);
    // 數量 = 靜態頁 + 商品數
    expect(entries).toHaveLength(STATIC_SITEMAP_PATHS.length + 2);
  });

  it('首頁 priority=1 changeFrequency=daily', () => {
    const entries = buildSitemapEntries([], BASE);
    const home = entries.find((e) => e.url === BASE);
    expect(home?.priority).toBe(1);
    expect(home?.changeFrequency).toBe('daily');
  });

  it('無商品時只剩靜態頁', () => {
    expect(buildSitemapEntries([], BASE)).toHaveLength(STATIC_SITEMAP_PATHS.length);
  });
});
