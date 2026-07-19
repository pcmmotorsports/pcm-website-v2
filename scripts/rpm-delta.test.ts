// rpm-delta.test.ts — V1 simulateSpecCollisions(pv_spec_unique 模擬 + 孤兒排除 F3)回歸鎖
//
// 背景(2026-07-05 雙跨模型審查 F3):spec 模擬原把 target 孤兒(source 無、upsert 不刪)併入 →
//   「變體改名、spec 不變」情境新 sku 恆撞已死孤兒 → 該供應商每日同步永久 abort、無工具可解。
//   V1:變體級對賬排定硬刪的孤兒 sku(deletedSkus)不參與模擬(upsert 前已刪)。

import { describe, it, expect } from 'vitest';
import {
  simulateSpecCollisions,
  checkNewItemPrices,
  independentPrice,
  independentGroupPrice,
  NEW_ITEM_PRICE_FLOOR,
  NEW_ITEM_PRICE_CEILING,
} from './rpm-delta';

describe('M1 新品驗價(Codex R1 must-fix:首灌全是新品 → delta gate 零檢查)', () => {
  const item = (key: string, price: number | null, sourcePrice: number | null) =>
    ({ level: 'product' as const, key, price, sourcePrice });

  it('🔴 價格錯 100 倍 → source-mismatch(這就是 Codex 點名的首灌情境)', () => {
    const issues = checkNewItemPrices([item('AK-001', 1_260_000, 12_600)], { enforceBand: true });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.reason).toBe('source-mismatch');
  });

  it('對源相符 + 在區間內 → 零 issue', () => {
    const issues = checkNewItemPrices([item('AK-001', 12_600, 12_600)], { enforceBand: true });
    expect(issues).toEqual([]);
  });

  it('🔴 首灌:低於下限硬擋(疑小數點錯位)', () => {
    const issues = checkNewItemPrices([item('X', 50, 50)], { enforceBand: true });
    expect(issues[0]!.reason).toBe('below-floor');
  });

  it('日常(enforceBand=false):同一筆低價放行(實查 gbracing 45 筆 <100 元是真實便宜小件、不可天天誤殺)', () => {
    const issues = checkNewItemPrices([item('X', 50, 50)], { enforceBand: false });
    expect(issues).toEqual([]);
  });

  it('🔴 首灌:超過上限硬擋', () => {
    const issues = checkNewItemPrices([item('X', NEW_ITEM_PRICE_CEILING + 1, NEW_ITEM_PRICE_CEILING + 1)], { enforceBand: true });
    expect(issues[0]!.reason).toBe('above-ceiling');
  });

  it('對源不符時不重複報區間(接線已不可信、先修接線)', () => {
    const issues = checkNewItemPrices([item('X', 5, 500)], { enforceBand: true });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.reason).toBe('source-mismatch');
  });

  it('🔴 來源查無對應列(sourcePrice=null 而要寫有值)→ 仍算不符(fail-closed、不靜默放行)', () => {
    const issues = checkNewItemPrices([item('GHOST', 12_600, null)], { enforceBand: false });
    expect(issues[0]!.reason).toBe('source-mismatch');
  });

  it('下限剛好等於 floor → 放行(邊界用 < 非 <=)', () => {
    expect(checkNewItemPrices([item('X', NEW_ITEM_PRICE_FLOOR, NEW_ITEM_PRICE_FLOOR)], { enforceBand: true })).toEqual([]);
  });

  it('independentPrice:字串 numeric 取整、null/空/非法 → null', () => {
    expect(independentPrice('12600.00')).toBe(12_600);
    expect(independentPrice('12600.60')).toBe(12_601);
    expect(independentPrice(null)).toBeNull();
    expect(independentPrice('')).toBeNull();
    expect(independentPrice('abc')).toBeNull();
  });

  it('independentGroupPrice:取群內最低價;任一列非法 → null(交給異常列硬 abort 接手)', () => {
    expect(independentGroupPrice([{ price_retail: '3000' }, { price_retail: '1700.00' }, { price_retail: 2500 }])).toBe(1700);
    expect(independentGroupPrice([{ price_retail: '3000' }, { price_retail: null }])).toBeNull();
    expect(independentGroupPrice([])).toBeNull();
  });
});

const spec = (color: string): Record<string, string> => ({ color });

describe('V1 simulateSpecCollisions(spec 撞鍵模擬 + 孤兒排除)', () => {
  it('source 群內同 spec 兩 sku → 撞(C3 型、與孤兒無關)', () => {
    const src = new Map([['G1', [{ sku: 'S1', spec: spec('red') }, { sku: 'S2', spec: spec('red') }]]]);
    const collisions = simulateSpecCollisions(src, new Map(), new Map(), new Set());
    expect(collisions).toHaveLength(1);
    expect(collisions[0]!.skus.sort()).toEqual(['S1', 'S2']);
  });

  it('🔴 F3 情境:變體改名同 spec、孤兒未排刪 → 撞(舊行為、供應商卡死源)', () => {
    const src = new Map([['G1', [{ sku: 'NEW-RED', spec: spec('red') }]]]); // 改名後的新 sku
    const idByExt = new Map([['G1', 'pid-1']]);
    const existing = new Map([['pid-1', [{ sku: 'OLD-RED', spec: spec('red') }]]]); // 同 spec 舊 sku(孤兒)
    const collisions = simulateSpecCollisions(src, idByExt, existing, new Set());
    expect(collisions).toHaveLength(1); // 未排刪 → 模擬撞 → 寫入 abort(保守正確:孤兒真的還在 DB)
  });

  it('🔴 F3 修法:孤兒已排定硬刪(deletedSkus)→ 不併入模擬 → 不撞、同步不卡死', () => {
    const src = new Map([['G1', [{ sku: 'NEW-RED', spec: spec('red') }]]]);
    const idByExt = new Map([['G1', 'pid-1']]);
    const existing = new Map([['pid-1', [{ sku: 'OLD-RED', spec: spec('red') }]]]);
    const collisions = simulateSpecCollisions(src, idByExt, existing, new Set(['OLD-RED']));
    expect(collisions).toEqual([]); // upsert 前 OLD-RED 已刪 → NEW-RED 落位無撞
  });

  it('target 既有變體 source 也有(將被覆寫)→ 不重複併入模擬(既有行為回歸)', () => {
    const src = new Map([['G1', [{ sku: 'S1', spec: spec('red') }]]]);
    const idByExt = new Map([['G1', 'pid-1']]);
    const existing = new Map([['pid-1', [{ sku: 'S1', spec: spec('red') }]]]); // 同 sku re-upsert
    const collisions = simulateSpecCollisions(src, idByExt, existing, new Set());
    expect(collisions).toEqual([]);
  });

  it('新 product(target 查無 id)→ 只查 source 群內(既有行為回歸)', () => {
    const src = new Map([['G-NEW', [{ sku: 'N1', spec: spec('red') }, { sku: 'N2', spec: spec('blue') }]]]);
    const collisions = simulateSpecCollisions(src, new Map(), new Map(), new Set());
    expect(collisions).toEqual([]);
  });
});
