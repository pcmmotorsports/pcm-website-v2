// garage-chip.test.ts — 愛車 chip 決策腦單測(node 純函式;首頁 V-1c + 型錄 V-1e 共用來源)。
// 逐分支對齊原 VehicleFinder.onGarageChip(18877be):dict 快路徑 / 精確命中 / 建議清單 / 年份閘門。

import { describe, expect, it } from 'vitest';
import { resolveGarageChip, resolveSuggestionLabel } from './garage-chip';
import type { MockMotoBrand } from '../data/mock-moto-brands';

const BRANDS: MockMotoBrand[] = [
  {
    id: 'yamaha',
    name: 'Yamaha',
    models: [
      { id: 'mt-09-sp', name: 'MT-09 SP', years: [2021, 2022] },
      { id: 'mt-09', name: 'MT-09', years: [2021] },
    ],
  },
];

describe('resolveGarageChip — dict 快路徑', () => {
  it('dict 欄有值 → 精確 lookup 直套(顯示名隨便都不影響)', () => {
    const r = resolveGarageChip(BRANDS, {
      name: '我的通勤車',
      year: '2021',
      dictBrandName: 'Yamaha',
      dictModelName: 'MT-09 SP',
    });
    expect(r).toEqual({ kind: 'apply', brand: 'Yamaha', model: 'MT-09 SP', year: 2021 });
  });

  it('dict 指向已演化消失的車款 → 降級字面比對流(name 零命中→建議清單空)', () => {
    const r = resolveGarageChip(BRANDS, {
      name: '我的紅色小車',
      year: '',
      dictBrandName: 'Yamaha',
      dictModelName: '已下架車型',
    });
    expect(r).toEqual({ kind: 'suggest', query: '我的紅色小車', entries: [], garageYear: undefined });
  });
});

describe('resolveGarageChip — REQUIRED-2 精確命中/建議清單', () => {
  it('唯一精確命中(車型名、正規化大小寫)→ 直接套用', () => {
    const r = resolveGarageChip(BRANDS, {
      name: 'mt-09 sp',
      year: '2021',
      dictBrandName: null,
      dictModelName: null,
    });
    expect(r).toEqual({ kind: 'apply', brand: 'Yamaha', model: 'MT-09 SP', year: 2021 });
  });

  it('多命中(MT-0 substring 命中兩車型、非精確)→ 建議清單字典字面(不自動套用)', () => {
    const r = resolveGarageChip(BRANDS, {
      name: 'MT-0',
      year: '',
      dictBrandName: null,
      dictModelName: null,
    });
    expect(r).toEqual({
      kind: 'suggest',
      query: 'MT-0',
      entries: ['Yamaha MT-09 SP', 'Yamaha MT-09'],
      garageYear: undefined,
    });
  });

  it('零命中(純自由文字)→ 建議清單空(呼叫端顯「無法對應」)', () => {
    const r = resolveGarageChip(BRANDS, {
      name: '完全不存在的車',
      year: '',
      dictBrandName: null,
      dictModelName: null,
    });
    expect(r).toEqual({ kind: 'suggest', query: '完全不存在的車', entries: [], garageYear: undefined });
  });
});

describe('resolveGarageChip — 年份閘門(值班台 nit-1:回傳 year 恆已通過閘門)', () => {
  it('車庫 year 非四位數字 → year=undefined(零猜)', () => {
    const r = resolveGarageChip(BRANDS, {
      name: 'MT-09 SP',
      year: '二〇二一',
      dictBrandName: null,
      dictModelName: null,
    });
    expect(r).toEqual({ kind: 'apply', brand: 'Yamaha', model: 'MT-09 SP', year: undefined });
  });

  it('車庫 year 四位數字但不在字典 years 內 → year=undefined(不硬帶)', () => {
    const r = resolveGarageChip(BRANDS, {
      name: 'MT-09',
      year: '2099',
      dictBrandName: null,
      dictModelName: null,
    });
    expect(r).toEqual({ kind: 'apply', brand: 'Yamaha', model: 'MT-09', year: undefined });
  });
});

describe('resolveSuggestionLabel — 建議明選 → apply', () => {
  it('label 命中 → apply(garageYear 同閘門帶入)', () => {
    expect(resolveSuggestionLabel(BRANDS, 'Yamaha MT-09', 2021)).toEqual({
      kind: 'apply',
      brand: 'Yamaha',
      model: 'MT-09',
      year: 2021,
    });
  });

  it('label 命中但 garageYear 不在字典 years → year=undefined', () => {
    expect(resolveSuggestionLabel(BRANDS, 'Yamaha MT-09', 2022)).toEqual({
      kind: 'apply',
      brand: 'Yamaha',
      model: 'MT-09',
      year: undefined,
    });
  });

  it('label 查無(理論不達)→ null', () => {
    expect(resolveSuggestionLabel(BRANDS, '不存在 label', 2021)).toBeNull();
  });
});
