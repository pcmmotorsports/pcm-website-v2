// products-filter-logic 單元測試 — filterProducts / sortProducts 純函式。
//
// M-1-12 Codex finding 3 regression:品牌篩選改 id→name 解析後,hyphen id
// (cnc-racing / gb-racing)不再因 design 原 substring 模糊比對而誤判無結果。

import { describe, expect, it } from 'vitest';
import type { CascadeFilterState } from '@pcm/ui';
import { filterProducts, sortProducts } from './products-filter-logic';
import { makeInitialExtraFilters } from './filter-state';
import { MOCK_PRODUCTS, type MockProduct } from '../data/mock-products';
import { MOCK_BRANDS } from '../data/mock-brands';

type Fitments = NonNullable<MockProduct['fitments']>;
function vp(id: number, brand: string, fitments: Fitments): MockProduct {
  return {
    id, slug: `p-${id}`, brand, name: `P${id}`, fits: 'x', price: 1000, origPrice: null,
    isNew: false, isSale: false, inStock: true, category: '碳纖維部品',
    color: 'silver', imgTone: 'neutral', fitments,
  };
}

const emptyCascade: CascadeFilterState = { vehicle: null, category: null, brands: [] };

describe('filterProducts', () => {
  it('should return all products when no filter is applied', () => {
    const result = filterProducts(MOCK_PRODUCTS, emptyCascade, makeInitialExtraFilters(), MOCK_BRANDS);
    expect(result).toHaveLength(MOCK_PRODUCTS.length);
  });

  it('should match brands by hyphen id (cnc-racing → "CNC RACING")', () => {
    const cascade: CascadeFilterState = { ...emptyCascade, brands: ['cnc-racing'] };
    const result = filterProducts(MOCK_PRODUCTS, cascade, makeInitialExtraFilters(), MOCK_BRANDS);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((p) => p.brand === 'CNC RACING')).toBe(true);
  });

  it('should match brands by hyphen id (gb-racing → "GB RACING")', () => {
    const cascade: CascadeFilterState = { ...emptyCascade, brands: ['gb-racing'] };
    const result = filterProducts(MOCK_PRODUCTS, cascade, makeInitialExtraFilters(), MOCK_BRANDS);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((p) => p.brand === 'GB RACING')).toBe(true);
  });

  it('should keep only in-stock products when inStock is set', () => {
    const result = filterProducts(
      MOCK_PRODUCTS,
      emptyCascade,
      { ...makeInitialExtraFilters(), inStock: true },
      MOCK_BRANDS,
    );
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((p) => p.inStock)).toBe(true);
  });

  it('should filter by price range label', () => {
    const result = filterProducts(
      MOCK_PRODUCTS,
      emptyCascade,
      { ...makeInitialExtraFilters(), price: 'NT$ 0 – 3,000' },
      MOCK_BRANDS,
    );
    expect(result.every((p) => p.price >= 0 && p.price <= 3000)).toBe(true);
  });
});

describe('filterProducts — vehicle (fitment 過濾、#152 修復)', () => {
  const products: MockProduct[] = [
    vp(1, 'RPM CARBON', [{ motoBrand: 'Ducati', modelCode: 'Panigale V4', yearStart: 2020, yearEnd: 2022 }]),
    vp(2, 'RPM CARBON', [{ motoBrand: 'Ducati', modelCode: 'Monster', yearStart: 2021, yearEnd: null }]),
    vp(3, 'RPM CARBON', [{ motoBrand: 'BMW', modelCode: 'S1000RR', yearStart: 2019, yearEnd: 2024 }]),
    vp(4, 'RPM CARBON', [{ motoBrand: 'Honda', modelCode: 'CBR', yearStart: 2024 }]),
  ];
  const extras = makeInitialExtraFilters();
  const ids = (r: MockProduct[]) => r.map((p) => p.id).sort((a, b) => a - b);

  it('brand only → 該品牌全部命中', () => {
    const r = filterProducts(products, { ...emptyCascade, vehicle: { brand: 'Ducati' } }, extras, MOCK_BRANDS);
    expect(ids(r)).toEqual([1, 2]);
  });

  it('brand + model → 收窄到單一車型', () => {
    const r = filterProducts(products, { ...emptyCascade, vehicle: { brand: 'Ducati', model: 'Monster' } }, extras, MOCK_BRANDS);
    expect(ids(r)).toEqual([2]);
  });

  it('brand + model + year(範圍內)命中', () => {
    const r = filterProducts(products, { ...emptyCascade, vehicle: { brand: 'BMW', model: 'S1000RR', year: 2021 } }, extras, MOCK_BRANDS);
    expect(ids(r)).toEqual([3]);
  });

  it('brand + model + year(範圍外)不命中', () => {
    const r = filterProducts(products, { ...emptyCascade, vehicle: { brand: 'BMW', model: 'S1000RR', year: 2018 } }, extras, MOCK_BRANDS);
    expect(r).toHaveLength(0);
  });

  it('開放式年份(2021+)命中上界之後的年', () => {
    const r = filterProducts(products, { ...emptyCascade, vehicle: { brand: 'Ducati', model: 'Monster', year: 2099 } }, extras, MOCK_BRANDS);
    expect(ids(r)).toEqual([2]);
  });

  it('單年 fitment 只命中該年、不命中鄰年', () => {
    const hit = filterProducts(products, { ...emptyCascade, vehicle: { brand: 'Honda', model: 'CBR', year: 2024 } }, extras, MOCK_BRANDS);
    expect(ids(hit)).toEqual([4]);
    const miss = filterProducts(products, { ...emptyCascade, vehicle: { brand: 'Honda', model: 'CBR', year: 2023 } }, extras, MOCK_BRANDS);
    expect(miss).toHaveLength(0);
  });

  it('未選車輛 → 不因 vehicle 過濾(全數保留)', () => {
    const r = filterProducts(products, emptyCascade, extras, MOCK_BRANDS);
    expect(r).toHaveLength(4);
  });
});

describe('sortProducts', () => {
  it('should sort by price ascending', () => {
    const result = sortProducts(MOCK_PRODUCTS, 'price-asc');
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.price).toBeGreaterThanOrEqual(result[i - 1]!.price);
    }
  });

  it('should leave order unchanged for recommend', () => {
    const result = sortProducts(MOCK_PRODUCTS, 'recommend');
    expect(result.map((p) => p.id)).toEqual(MOCK_PRODUCTS.map((p) => p.id));
  });
});
