// vehicle-tree-payload.test.ts — `/products` 車款樹瘦身投影的契約(plan 2026-09-14 P2)。
//
// 三格必須釘死:① 名字全在(跨層打字要用)② 年份只留 keep 那幾個牌子 ③ 車庫相關的牌子
// 由**同一支** resolveGarageChip 決定(自由文字 ⇒ 建議清單那幾個牌子也要留年份)。

import { describe, it, expect } from 'vitest';

import type { MockMotoBrand } from '@/data/mock-moto-brands';
import {
  slimVehicleTree,
  garageRelatedBrandIds,
  vehicleTreeForProductsPage,
} from './vehicle-tree-payload';

const TREE: MockMotoBrand[] = [
  { id: 'yamaha', name: 'YAMAHA', models: [{ id: 'r6', name: 'YZF-R6', years: [2018, 2019] }] },
  { id: 'honda', name: 'HONDA', models: [{ id: 'cbr1000rr', name: 'CBR1000RR-R', years: [2021] }] },
  { id: 'kawasaki', name: 'KAWASAKI', models: [{ id: 'zx6r', name: 'ZX-6R', years: [2020] }] },
];

describe('slimVehicleTree', () => {
  it('名字全在、年份只留 keep 的牌子、旗標分得開', () => {
    const out = slimVehicleTree(TREE, new Set(['honda']));
    expect(out.map((b) => b.id)).toEqual(['yamaha', 'honda', 'kawasaki']);
    expect(out.map((b) => b.models.map((m) => m.name))).toEqual([
      ['YZF-R6'],
      ['CBR1000RR-R'],
      ['ZX-6R'],
    ]);
    expect(out[0]).toMatchObject({ yearsLoaded: false, models: [{ id: 'r6', years: [] }] });
    expect(out[1]).toMatchObject({ yearsLoaded: true, models: [{ id: 'cbr1000rr', years: [2021] }] });
    expect(out[2]?.yearsLoaded).toBe(false);
  });

  it('不改輸入(純函式)', () => {
    const before = JSON.stringify(TREE);
    slimVehicleTree(TREE, new Set());
    expect(JSON.stringify(TREE)).toBe(before);
  });
});

describe('garageRelatedBrandIds', () => {
  it('字典綁定的車 ⇒ 那個牌子', () => {
    const ids = garageRelatedBrandIds(TREE, [
      { name: 'my r6', year: '2019', dictBrandName: 'YAMAHA', dictModelName: 'YZF-R6' },
    ]);
    expect([...ids]).toEqual(['yamaha']);
  });

  it('自由文字唯一命中 ⇒ 那個牌子;多命中 ⇒ 建議清單裡每個牌子都留', () => {
    expect([...garageRelatedBrandIds(TREE, [{ name: 'ZX-6R', year: '', dictBrandName: null, dictModelName: null }])]).toEqual(['kawasaki']);
    const many = garageRelatedBrandIds(TREE, [{ name: 'r', year: '', dictBrandName: null, dictModelName: null }]);
    // 「r」子字串命中 YZF-R6 與 CBR1000RR-R 與 ZX-6R 都可能;至少要含兩個牌子(建議清單不是單一)
    expect(many.size).toBeGreaterThanOrEqual(2);
  });

  it('沒車庫 ⇒ 空集合', () => {
    expect(garageRelatedBrandIds(TREE, []).size).toBe(0);
  });
});

describe('vehicleTreeForProductsPage', () => {
  it('URL 已選的牌子 + 車庫的牌子留年份,其餘瘦', () => {
    const out = vehicleTreeForProductsPage(TREE, {
      selectedBrandName: 'HONDA',
      garage: [{ name: 'x', year: '2019', dictBrandName: 'YAMAHA', dictModelName: 'YZF-R6' }],
    });
    expect(out.map((b) => [b.id, b.yearsLoaded])).toEqual([
      ['yamaha', true],
      ['honda', true],
      ['kawasaki', false],
    ]);
  });

  it('什麼都沒選 ⇒ 全部瘦(年份一個都不帶)', () => {
    const out = vehicleTreeForProductsPage(TREE, { selectedBrandName: null, garage: [] });
    expect(out.every((b) => b.yearsLoaded === false && b.models.every((m) => m.years.length === 0))).toBe(true);
  });
});
