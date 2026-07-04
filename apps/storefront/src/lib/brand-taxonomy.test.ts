// brand-taxonomy.test.ts — buildBrandTaxonomy 動態衍生品牌側欄(#220c、C3 接線)單元測試。
//
// 守門重點:①只列有真商品的品牌(無死品牌)②count 為真商品數(非 MOCK_BRANDS 寫死)
// ③id=brandSlug(≡ 篩選 id、缺則 brandToSlug 兜底)④name=p.brand(filterProducts 比對鍵)
// ⑤curated 品牌 metadata 由 MOCK_BRANDS fallback / uncurated 最小 placeholder ⑥RPM 現況零回歸。

import { describe, it, expect } from 'vitest';
import { buildBrandTaxonomy } from './brand-taxonomy';
import type { MockProduct } from '@/data/mock-products';

type BrandSource = Pick<MockProduct, 'brand' | 'brandSlug'>;
const p = (brand: string, brandSlug?: string): BrandSource => ({ brand, brandSlug });

describe('buildBrandTaxonomy', () => {
  it('由目錄商品衍生 unique 品牌 + 真 count(只列有商品品牌、name 升冪)', () => {
    const result = buildBrandTaxonomy([
      p('RPM CARBON', 'rpm-carbon'),
      p('RPM CARBON', 'rpm-carbon'),
      p('CNC RACING', 'cnc-racing'),
    ]);
    // name 升冪:CNC RACING < RPM CARBON
    expect(result.map((b) => b.id)).toEqual(['cnc-racing', 'rpm-carbon']);
    const rpm = result.find((b) => b.id === 'rpm-carbon')!;
    expect(rpm.name).toBe('RPM CARBON'); // = p.brand(filterProducts 解 id→name 後與 p.brand 比對)
    expect(rpm.count).toBe(2); // 真商品數(非 MOCK_BRANDS 寫死 38)
    expect(result.find((b) => b.id === 'cnc-racing')!.count).toBe(1);
  });

  it('id 用 brandSlug(≡ 篩選 cascade.brands id ≡ MOCK_BRANDS.id);缺 brandSlug → brandToSlug(brand) 兜底', () => {
    const result = buildBrandTaxonomy([p('RPM CARBON')]); // 無 brandSlug
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('rpm-carbon'); // brandToSlug('RPM CARBON')
    expect(result[0]!.name).toBe('RPM CARBON');
    expect(result[0]!.count).toBe(1);
  });

  it('curated 品牌(RPM CARBON 在 MOCK_BRANDS)→ 顯示 metadata 帶 fallback 真值(count 仍覆蓋為真)', () => {
    const result = buildBrandTaxonomy([p('RPM CARBON', 'rpm-carbon')]);
    // MOCK_BRANDS rpm-carbon:country=TH / since=2010(真值 fallback、非 placeholder)
    expect(result[0]!.country).toBe('TH');
    expect(result[0]!.since).toBe(2010);
    expect(result[0]!.count).toBe(1); // 仍覆蓋為真商品數(非 MOCK_BRANDS 的 38)
  });

  it('uncurated 品牌(不在 MOCK_BRANDS)→ 最小 placeholder metadata、id/name/count 仍真', () => {
    const result = buildBrandTaxonomy([p('Nonexistent Brand', 'nonexistent-brand')]);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('nonexistent-brand');
    expect(result[0]!.name).toBe('Nonexistent Brand');
    expect(result[0]!.count).toBe(1);
    expect(result[0]!.country).toBe(''); // placeholder(篩選路徑不渲染)
    expect(result[0]!.logoBg).toBe('transparent');
  });

  it('空目錄 → [];空白/缺 brand 商品跳過(不產空品牌)', () => {
    expect(buildBrandTaxonomy([])).toEqual([]);
    expect(buildBrandTaxonomy([{ brand: '   ', brandSlug: 'x' }])).toEqual([]);
  });

  it('RPM 現況零回歸:全站單一品牌 RPM CARBON → 側欄僅一項、count 為全量', () => {
    const products = Array.from({ length: 5 }, () => p('RPM CARBON', 'rpm-carbon'));
    const result = buildBrandTaxonomy(products);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('rpm-carbon');
    expect(result[0]!.count).toBe(5);
  });
});
