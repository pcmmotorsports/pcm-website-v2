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
    expect(buildSitemapEntries(['a-1', 'b-2'], undefined, ['akrapovic'])).toEqual([]);
  });

  it('base 有值 → 靜態頁 + 每商品 handle、URL 為絕對網址', () => {
    const entries = buildSitemapEntries(['lightech-1', 'brembo-7'], BASE, ['akrapovic', 'kineo']);
    const urls = entries.map((e) => e.url);
    // 靜態頁(首頁 '' + /products + /brands)
    expect(urls).toContain(`${BASE}`);
    expect(urls).toContain(`${BASE}/products`);
    expect(urls).toContain(`${BASE}/brands`);
    // 商品頁
    expect(urls).toContain(`${BASE}/products/lightech-1`);
    expect(urls).toContain(`${BASE}/products/brembo-7`);
    // 🔴 品牌介紹頁(D3c-4):`kineo` 是**目錄零商品**那 5 家之一 —— 泛白的是入口、不是頁面,
    //    它的內容照樣要被索引(理由寫在 `buildSitemapEntries` 的 doc)。
    expect(urls).toContain(`${BASE}/brands/akrapovic`);
    expect(urls).toContain(`${BASE}/brands/kineo`);
    // 數量 = 靜態頁 + 商品數 + 品牌數
    expect(entries).toHaveLength(STATIC_SITEMAP_PATHS.length + 2 + 2);
  });

  it('首頁 priority=1 changeFrequency=daily', () => {
    const entries = buildSitemapEntries([], BASE, []);
    const home = entries.find((e) => e.url === BASE);
    expect(home?.priority).toBe(1);
    expect(home?.changeFrequency).toBe('daily');
  });

  it('無商品、無品牌時只剩靜態頁', () => {
    expect(buildSitemapEntries([], BASE, [])).toHaveLength(STATIC_SITEMAP_PATHS.length);
  });

  // 🔴 D3c-4:靜態頁清單本身要釘住。`/brands` 在 D3c-3 才落地,漏掉的話那一頁與它底下
  //    20 頁的入口都不在地圖上,而 sitemap.xml 照樣是合法的 —— 零症狀。
  it('🔴 靜態頁清單 = 首頁 / 商品目錄 / 品牌總覽', () => {
    expect([...STATIC_SITEMAP_PATHS]).toEqual(['', '/products', '/brands']);
  });

  it('🔴 品牌介紹頁的 changeFrequency 是 monthly、priority 0.7(與商品頁區分開)', () => {
    const entries = buildSitemapEntries([], BASE, ['rizoma']);
    const brand = entries.find((e) => e.url === `${BASE}/brands/rizoma`);
    expect(brand?.changeFrequency).toBe('monthly');
    expect(brand?.priority).toBe(0.7);
  });
});
