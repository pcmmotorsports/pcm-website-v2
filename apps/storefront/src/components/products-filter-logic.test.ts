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

  it('brand 比對兩端 trim → 帶頭尾空白的 p.brand 仍命中(F2:防「側欄 count 說有、選了結果變少」靜默不一致)', () => {
    // 商品 brand 帶頭尾空白(未來髒資料);選取名(MOCK_BRANDS 'RPM CARBON')已乾淨 → 未 trim p.brand 會漏此商品
    const products = [vp(1, '  RPM CARBON  ', []), vp(2, 'GB RACING', [])];
    const cascade: CascadeFilterState = { ...emptyCascade, brands: ['rpm-carbon'] };
    const result = filterProducts(products, cascade, makeInitialExtraFilters(), MOCK_BRANDS);
    expect(result.map((p) => p.id)).toEqual([1]); // trim 後 '  RPM CARBON  ' 仍命中 rpm-carbon
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

  it('缺年 fitment = 該車型全年份適用、選了年份亦命中(Q1=A 2026-07-03)', () => {
    // 真資料型態:車型專用 body work、報價單標車型未標年(如 Panigale 1199);對齊 domain matchFitmentYear
    const noYear = [vp(9, 'RPM CARBON', [{ motoBrand: 'Ducati', modelCode: 'Panigale 1199' }])];
    const withYear = filterProducts(
      noYear,
      { ...emptyCascade, vehicle: { brand: 'Ducati', model: 'Panigale 1199', year: 2013 } },
      extras,
      MOCK_BRANDS,
    );
    expect(ids(withYear)).toEqual([9]);
    // 車型不符仍擋(缺年只放寬年份層、不放寬車型層)
    const wrongModel = filterProducts(
      noYear,
      { ...emptyCascade, vehicle: { brand: 'Ducati', model: 'Monster', year: 2013 } },
      extras,
      MOCK_BRANDS,
    );
    expect(wrongModel).toHaveLength(0);
  });

  it('無 fitments 商品(未標任何車款)選車後仍排除(無車型錨點)', () => {
    const noFitments = [vp(10, 'RPM CARBON', [])];
    const r = filterProducts(
      noFitments,
      { ...emptyCascade, vehicle: { brand: 'Ducati' } },
      extras,
      MOCK_BRANDS,
    );
    expect(r).toHaveLength(0);
  });
});

describe('filterProducts — category(兩層階層 rollup、#212 子類)', () => {
  const cp = (id: number, category: string): MockProduct => ({ ...vp(id, 'RPM CARBON', []), category });
  // 1=別大類直掛;2=操控部品「大類直掛」(舊單層向後相容);3/4=操控部品底下子類(麵包屑);5=別大類子類
  const products = [
    cp(1, '碳纖維部品'),
    cp(2, '操控部品'),
    cp(3, '操控部品 · 腳踏後移'),
    cp(4, '操控部品 · 拉桿'),
    cp(5, '排氣系統 · 全段排氣'),
  ];
  const extras = makeInitialExtraFilters();
  const ids = (r: MockProduct[]) => r.map((p) => p.id).sort((a, b) => a - b);

  it('選大類 → rollup 涵蓋自身直掛 + 底下所有子類(前綴比對)', () => {
    const r = filterProducts(products, { ...emptyCascade, category: { mainId: 'x', main: '操控部品' } }, extras, MOCK_BRANDS);
    expect(ids(r)).toEqual([2, 3, 4]); // 2 直掛 + 3/4 子類;不含 5(別大類、不因「操控部品」子字串誤命中)
  });

  it('選子類 → 精確比對「大類 · 子類」麵包屑(不涵蓋同大類其他子類/直掛)', () => {
    const r = filterProducts(products, { ...emptyCascade, category: { mainId: 'x', main: '操控部品', subId: 's', sub: '腳踏後移' } }, extras, MOCK_BRANDS);
    expect(ids(r)).toEqual([3]);
  });

  it('未選分類 → 不因 category 過濾(全數保留)', () => {
    const r = filterProducts(products, emptyCascade, extras, MOCK_BRANDS);
    expect(ids(r)).toEqual([1, 2, 3, 4, 5]);
  });

  it('單層向後相容:選無子類大類「碳纖維部品」(商品直掛)= 精確比對', () => {
    const rpmAll = [cp(1, '碳纖維部品'), cp(2, '碳纖維部品'), cp(3, '碳纖維部品')];
    const r = filterProducts(rpmAll, { ...emptyCascade, category: { mainId: 'x', main: '碳纖維部品' } }, extras, MOCK_BRANDS);
    expect(ids(r)).toEqual([1, 2, 3]);
  });

  it('category(大類 rollup)+ vehicle 兩軸並存(AND)', () => {
    const mixed: MockProduct[] = [
      { ...vp(1, 'RPM CARBON', [{ motoBrand: 'Ducati', modelCode: 'V4' }]), category: '操控部品 · 腳踏後移' },
      { ...vp(2, 'RPM CARBON', [{ motoBrand: 'BMW', modelCode: 'S1000RR' }]), category: '操控部品 · 拉桿' },
    ];
    const r = filterProducts(mixed, { ...emptyCascade, category: { mainId: 'x', main: '操控部品' }, vehicle: { brand: 'Ducati' } }, extras, MOCK_BRANDS);
    expect(ids(r)).toEqual([1]);
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
