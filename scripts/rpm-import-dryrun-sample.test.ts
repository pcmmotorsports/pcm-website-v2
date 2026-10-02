// rpm-import 乾跑抽樣不得把經銷價或成本印進 log(2026-10-02 主視窗 pcm-website-v2-ce 派, 資安)。
// repo 是公開的, GitHub Actions 的執行紀錄任何人都看得到;run 37006117503(evotech 乾跑)紀錄裡已經有經銷價數字。
// 抽樣只印白名單欄位(dryRunSample), 不印整列。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dryRunSample, type ProductRow, type VariantRow } from './rpm-transform';

const product: ProductRow = {
  supplier_slug: 'evotech',
  external_id: 'EV-1',
  handle: 'evotech-ev-1',
  title: '測試商品',
  subtitle: '副標',
  price_general: 2100,
  price_store: 1777,
  price_by_tier: { general: { amount: 2100, currency: 'TWD' }, store: { amount: 1777, currency: 'TWD' } },
  fitments: [],
  images: ['a.jpg', 'b.jpg'],
  availability: 'in_stock',
  brand_id: 'b1',
  category_id: 'c1',
  metadata: { price_cost: 1234, dealer_note: 'x' },
  updated_at: '2026-10-02T00:00:00Z',
};
const variant = (sku: string): VariantRow => ({
  supplier_slug: 'evotech',
  sku,
  spec: { finish: 'black' },
  price_general: 2100,
  price_store: 1777,
  availability: 'in_stock',
  images: ['a.jpg'],
  sort_order: 0,
  metadata: { price_cost: 1234 },
  updated_at: '2026-10-02T00:00:00Z',
});

describe('乾跑抽樣只印白名單欄位', () => {
  const out = JSON.stringify(dryRunSample(product, [variant('A'), variant('B'), variant('C'), variant('D')]));

  it('不含經銷價、成本、price_by_tier、metadata(欄位名與數字都不能出現)', () => {
    // 1777 = fixture 的經銷價(商品層、規格層、price_by_tier.store 三處都是它), 1234 = metadata 裡的成本
    for (const banned of ['price_store', 'price_by_tier', 'price_cost', 'metadata', '1777', '1234']) {
      expect(out).not.toContain(banned);
    }
  });

  it('仍印得出驗 transform 需要的欄位(一般價、料號、規格、件數)', () => {
    const s = dryRunSample(product, [variant('A'), variant('B'), variant('C'), variant('D')]);
    expect(s.product).toEqual({
      supplier_slug: 'evotech',
      external_id: 'EV-1',
      handle: 'evotech-ev-1',
      title: '測試商品',
      subtitle: '副標',
      price_general: 2100,
      availability: 'in_stock',
      brand_id: 'b1',
      category_id: 'c1',
      image_count: 2,
      fitment_count: 0,
    });
    expect(s.variant_count).toBe(4);
    expect(s.sample_variants.map((v) => v.sku)).toEqual(['A', 'B', 'C']);
    expect(s.sample_variants[0]).toEqual({ sku: 'A', spec: { finish: 'black' }, price_general: 2100, availability: 'in_stock', sort_order: 0, image_count: 1 });
  });

  it('rpm-import.ts 乾跑那一段改用 dryRunSample, 不再直接印整列', () => {
    const src = readFileSync(new URL('./rpm-import.ts', import.meta.url), 'utf8');
    expect(src).toContain('JSON.stringify(dryRunSample(');
    expect(src).not.toMatch(/JSON\.stringify\(\{\s*product:\s*sample/);
    expect(src).not.toMatch(/sample_variants:\s*vrs\.slice/);
  });
});
