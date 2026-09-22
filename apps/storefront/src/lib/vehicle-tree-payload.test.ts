// vehicle-tree-payload.test.ts — `/products` 車款樹瘦身投影的契約(plan 2026-09-14 P2)。
//
// 三格必須釘死:① 名字全在(跨層打字要用)② 年份只留 keep 那幾個牌子 ③ 車庫相關的牌子
// 由**同一支** resolveGarageChip 決定(自由文字 ⇒ 建議清單那幾個牌子也要留年份)。

import { describe, it, expect, vi } from 'vitest';

import type { MockMotoBrand } from '@/data/mock-moto-brands';
import {
  slimVehicleTree,
  garageRelatedBrandIds,
  vehicleTreeForProductsPage,
  vehicleTreeWithYearsForProductsPage,
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

describe('vehicleTreeWithYearsForProductsPage(⟦db-TAXONOMYVIEW⟧ 接線片)', () => {
  // 底盤樹:名字都在, 年份一律空。
  const BASE: MockMotoBrand[] = TREE.map((b) => ({ ...b, models: b.models.map((m) => ({ ...m, years: [] })) }));
  const withYears = (b: MockMotoBrand) =>
    Promise.resolve((TREE.find((t) => t.id === b.id) as MockMotoBrand).models);

  it('只替要保留的牌子補年份(一個牌子一發), 其餘照舊瘦', async () => {
    const calls: string[] = [];
    const out = await vehicleTreeWithYearsForProductsPage(
      BASE,
      { selectedBrandName: 'HONDA', garage: [] },
      (b) => (calls.push(b.id), withYears(b)),
    );
    expect(calls).toEqual(['honda']);
    expect(out.map((b) => [b.id, b.yearsLoaded])).toEqual([
      ['yamaha', false],
      ['honda', true],
      ['kawasaki', false],
    ]);
    expect(out[1]?.models[0]?.years).toEqual([2021]);
  });

  it('🔴 補年份失敗(例如 K<M 對帳不過)⇒ 那個牌子當成沒保留(瀏覽器選到時再補), 頁面不 throw、有記 log', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await vehicleTreeWithYearsForProductsPage(
      BASE,
      { selectedBrandName: 'HONDA', garage: [] },
      () => Promise.reject(new Error('K=1 < M=2')),
    );
    const logged = spy.mock.calls.length;
    spy.mockRestore();
    expect(out.find((b) => b.id === 'honda')).toMatchObject({ yearsLoaded: false, models: [{ years: [] }] });
    expect(logged).toBe(1);
  });
});
