import { describe, expect, it } from 'vitest';
import { buildBreadcrumbJsonLd, splitProductCategory } from './breadcrumb-jsonld';
import type { MockProduct } from '@/data/mock-products';

const BASE = 'https://www.pcmmotorsports.com';
const product = (over: Partial<MockProduct> = {}): MockProduct =>
  ({
    id: 1,
    slug: 'x-1',
    brand: 'TEST',
    name: '鈦合金全段排氣',
    fits: '',
    price: 100,
    origPrice: null,
    isNew: false,
    isSale: false,
    inStock: true,
    category: '引擎部品 · 排氣管',
    ...over,
  }) as MockProduct;

describe('splitProductCategory', () => {
  // 🔵 這一支是從 `ProductBreadcrumb.tsx:33-34` 搬出來的,行為要逐字相同。
  it('🔵 拆得開 / 拆不開 / 空值 的行為與原字面相同', () => {
    expect(splitProductCategory('引擎部品 · 排氣管')).toEqual({ main: '引擎部品', sub: '排氣管' });
    expect(splitProductCategory('精品配件')).toEqual({ main: '精品配件', sub: '' });
    expect(splitProductCategory(undefined)).toEqual({ main: '商品', sub: '' });
    expect(splitProductCategory('')).toEqual({ main: '商品', sub: '' });
  });
});

describe('buildBreadcrumbJsonLd', () => {
  it('🔴 base 未設 ⇒ 回 null(不吐相對網址的麵包屑,與 canonical / OG 同一套休眠)', () => {
    expect(buildBreadcrumbJsonLd(product(), undefined)).toBeNull();
  });

  it('🔵 正規路徑:首頁 › 商品目錄 › 分類主 › 分類次 › 商品名,position 從 1 連號', () => {
    const r = buildBreadcrumbJsonLd(product(), BASE)!;
    const items = r.itemListElement as Array<Record<string, unknown>>;
    expect(items.map((i) => i.name)).toEqual(['首頁', '商品目錄', '引擎部品', '排氣管', '鈦合金全段排氣']);
    expect(items.map((i) => i.position)).toEqual([1, 2, 3, 4, 5]);
    expect(items[0]!.item).toBe(`${BASE}/`);
    expect(items[1]!.item).toBe(`${BASE}/products`);
    // 分類階的網址形狀與目錄頁 canonical 同一套(`?categories=`)。
    expect(items[2]!.item).toBe(`${BASE}/products?categories=${encodeURIComponent('引擎部品')}`);
  });

  // 🔴 Google 的 breadcrumb 指南:最後一階是當前頁,不連回自己。
  it('🔴 最後一階(商品本身)不帶 item', () => {
    const items = buildBreadcrumbJsonLd(product(), BASE)!.itemListElement as Array<
      Record<string, unknown>
    >;
    expect(items.at(-1)).not.toHaveProperty('item');
    // 正對照:前面每一階都要有 item —— 少了這格,一個「全部都不帶 item」的實作也會綠。
    for (const i of items.slice(0, -1)) expect(i).toHaveProperty('item');
  });

  // 🔴 硬塞一個「商品」層等於發明一個站上沒有的分類頁。
  it('🔴 沒有分類 ⇒ 不長出假的分類階', () => {
    const items = buildBreadcrumbJsonLd(product({ category: undefined }), BASE)!
      .itemListElement as Array<Record<string, unknown>>;
    expect(items.map((i) => i.name)).toEqual(['首頁', '商品目錄', '鈦合金全段排氣']);
  });

  it('🔵 只有一層分類 ⇒ 只長一階', () => {
    const items = buildBreadcrumbJsonLd(product({ category: '精品配件' }), BASE)!
      .itemListElement as Array<Record<string, unknown>>;
    expect(items.map((i) => i.name)).toEqual(['首頁', '商品目錄', '精品配件', '鈦合金全段排氣']);
  });

  it('🔴 換 base ⇒ 全部網址跟著換(換網域不用改這支)', () => {
    const items = buildBreadcrumbJsonLd(product(), 'https://example.test')!
      .itemListElement as Array<Record<string, unknown>>;
    for (const i of items) {
      if (i.item) expect(String(i.item)).toContain('https://example.test');
    }
  });
});
