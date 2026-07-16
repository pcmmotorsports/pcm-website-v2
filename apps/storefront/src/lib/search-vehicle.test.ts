// @vitest-environment jsdom
//
// search-vehicle.test.ts — V-2h/MF-4 讀選車 context → 購物車車款(ProductInfo + mobile buybar 共用來源)。

import { afterEach, describe, expect, it } from 'vitest';
import { readSearchVehicle } from './search-vehicle';

const CTX_KEY = 'pcm.vehicle.v1';
afterEach(() => window.sessionStorage.clear());

describe('readSearchVehicle（V-2a 路徑1、零猜)', () => {
  it('context 名稱字面齊全 → kind:dict source:search', () => {
    window.sessionStorage.setItem(
      CTX_KEY,
      JSON.stringify({ brandId: 'yamaha', modelId: 'mt-09-sp', year: 2021, label: 'x', brandName: 'Yamaha', modelName: 'MT-09 SP', savedAt: 1 }),
    );
    expect(readSearchVehicle()).toEqual({ kind: 'dict', brand: 'Yamaha', model: 'MT-09 SP', year: 2021, source: 'search' });
  });

  it('缺 modelName(brand-only)→ undefined(零猜)', () => {
    window.sessionStorage.setItem(
      CTX_KEY,
      JSON.stringify({ brandId: 'yamaha', label: 'x', brandName: 'Yamaha', savedAt: 1 }),
    );
    expect(readSearchVehicle()).toBeUndefined();
  });

  it('舊 context 缺名稱欄 → undefined(不 label 反解析)', () => {
    window.sessionStorage.setItem(
      CTX_KEY,
      JSON.stringify({ brandId: 'yamaha', modelId: 'mt-09-sp', label: 'x', savedAt: 1 }),
    );
    expect(readSearchVehicle()).toBeUndefined();
  });

  it('無 context → undefined', () => {
    expect(readSearchVehicle()).toBeUndefined();
  });
});
