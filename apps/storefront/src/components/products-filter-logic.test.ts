// products-filter-logic 單元測試 — filterProducts / sortProducts 純函式。
//
// M-1-12 Codex finding 3 regression:品牌篩選改 id→name 解析後,hyphen id
// (cnc-racing / gb-racing)不再因 design 原 substring 模糊比對而誤判無結果。

import { describe, expect, it } from 'vitest';
import type { CascadeFilterState } from '@pcm/ui';
import { filterProducts, sortProducts } from './products-filter-logic';
import { makeInitialExtraFilters } from './filter-state';
import { MOCK_PRODUCTS } from '../data/mock-products';
import { MOCK_BRANDS } from '../data/mock-brands';

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
