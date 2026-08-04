// @vitest-environment node
//
// sitemap route 接線測(D3c-4;2026-08-05)
//
// 🔴 為什麼補這支:`lib/seo.test.ts` 驗的是 **builder**(給它什麼就產什麼),
//    而本片新增的是**接線** —— `app/sitemap.ts` 要把 `BRAND_CONTENT` 的 **slug**(不是 `name`)
//    傳進去。兩者型別都是 `string` ⇒ **傳錯 typecheck 不會紅、builder 測試也不會紅**,
//    產出的 `sitemap.xml` 仍是合法 XML,只是 21 條網址全指到不存在的頁面。
//    關卡2 R1 nit 點名這個洞:當時是靠「真的跑起來抓 /sitemap.xml」證的,證據只留在對話裡。

import { describe, expect, it, vi } from 'vitest';

// `lib/products` 帶 `server-only`、在 vitest 載入即 throw,而且不 mock 會打真 DB。
vi.mock('@/lib/products', () => ({
  fetchCatalogProducts: () => Promise.resolve({ products: [{ slug: 'demo-1' }] }),
}));
// `resolveSiteUrl()` 依環境變數;釘死才驗得了絕對網址的形狀。
vi.mock('@/lib/site-url', () => ({ resolveSiteUrl: () => 'https://x.test' }));

const { default: sitemap } = await import('./sitemap');
const { BRAND_CONTENT } = await import('@/data/brand-content');

describe('app/sitemap.ts 接線', () => {
  it('🔴 20 個品牌介紹頁都在,而且用的是 **slug** 不是 name', async () => {
    const urls = (await sitemap()).map((e) => e.url);
    for (const brand of BRAND_CONTENT) {
      expect(urls, `${brand.slug} 不在地圖上`).toContain(`https://x.test/brands/${brand.slug}`);
    }
    // 反面:name 的形狀(大寫、含空格)一條都不該出現 —— 傳錯欄位時這裡會紅。
    // 前提先證明兩者真的長得不一樣,否則這條恆真。
    expect(BRAND_CONTENT.every((b) => b.name !== b.slug)).toBe(true);
    for (const brand of BRAND_CONTENT) {
      expect(urls).not.toContain(`https://x.test/brands/${encodeURIComponent(brand.name)}`);
    }
  });

  it('🔴 `/brands` 總覽與商品頁也在(整張地圖 = 靜態 3 + 商品 1 + 品牌 20)', async () => {
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain('https://x.test/brands');
    expect(urls).toContain('https://x.test/products');
    expect(urls).toContain('https://x.test/products/demo-1');
    expect(urls).toHaveLength(3 + 1 + BRAND_CONTENT.length);
    // 重複條目會讓爬蟲看到同一頁兩次;順手釘住。
    expect(new Set(urls).size).toBe(urls.length);
  });
});
