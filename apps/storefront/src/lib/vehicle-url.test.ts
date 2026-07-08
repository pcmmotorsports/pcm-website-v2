// vehicle-url.test.ts — R3 車輛 URL 解析(vehicleUrlParam + parseVehicleFromUrl 抽出鎖)。
import { describe, it, expect } from 'vitest';
import { vehicleUrlParam, parseVehicleFromUrl } from './vehicle-url';
import type { MockMotoBrand } from '@/data/mock-moto-brands';

const TAXONOMY: MockMotoBrand[] = [
  { id: 'yamaha', name: 'YAMAHA', models: [{ id: 'mt09', name: 'MT-09', years: [2024] }] },
];

// codex R3 r2:CTA href 需的車輛短版 slug(短版 ?vehicle 或長版合成),避免長版書籤退成品牌 filter。
describe('vehicleUrlParam', () => {
  it('短版 ?vehicle 直接回傳', () => {
    expect(vehicleUrlParam(new URLSearchParams('vehicle=yamaha:mt09:2024'))).toBe('yamaha:mt09:2024');
  });
  it('長版 ?brand&model&year → 合成短版 brandId:modelId:year', () => {
    expect(vehicleUrlParam(new URLSearchParams('brand=yamaha&model=mt09&year=2024'))).toBe('yamaha:mt09:2024');
  });
  it('長版無 year → brand:model', () => {
    expect(vehicleUrlParam(new URLSearchParams('brand=yamaha&model=mt09'))).toBe('yamaha:mt09');
  });
  it('?brand 單獨(商品品牌 filter 語意)→ null(不合成車輛)', () => {
    expect(vehicleUrlParam(new URLSearchParams('brand=bonamici'))).toBeNull();
  });
  it('無車輛參數 → null', () => {
    expect(vehicleUrlParam(new URLSearchParams('from=catalog'))).toBeNull();
  });
  it('短版優先於長版', () => {
    expect(
      vehicleUrlParam(new URLSearchParams('vehicle=honda:cbr:2020&brand=yamaha&model=mt09')),
    ).toBe('honda:cbr:2020');
  });
});

// 抽出自 products-url-state 的 byte 等價鎖(/products 列表頁與詳情頁 route 共用同一份)。
describe('parseVehicleFromUrl(抽出後)', () => {
  it('短版解回原始車廠/車型名', () => {
    expect(parseVehicleFromUrl(new URLSearchParams('vehicle=yamaha:mt09:2024'), TAXONOMY)).toEqual({
      brand: 'YAMAHA',
      model: 'MT-09',
      year: 2024,
    });
  });
  it('長版 ?brand&model&year fallback 解回原始名', () => {
    expect(parseVehicleFromUrl(new URLSearchParams('brand=yamaha&model=mt09&year=2024'), TAXONOMY)).toEqual({
      brand: 'YAMAHA',
      model: 'MT-09',
      year: 2024,
    });
  });
  it('brandId 不在 taxonomy → null', () => {
    expect(parseVehicleFromUrl(new URLSearchParams('vehicle=ktm:x'), TAXONOMY)).toBeNull();
  });
  it('只 brand 無 model → model undefined(route 據此退 Case B)', () => {
    expect(parseVehicleFromUrl(new URLSearchParams('vehicle=yamaha'), TAXONOMY)).toEqual({
      brand: 'YAMAHA',
      model: undefined,
      year: undefined,
    });
  });
});
