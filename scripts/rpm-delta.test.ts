// rpm-delta.test.ts — V1 simulateSpecCollisions(pv_spec_unique 模擬 + 孤兒排除 F3)回歸鎖
//
// 背景(2026-07-05 雙跨模型審查 F3):spec 模擬原把 target 孤兒(source 無、upsert 不刪)併入 →
//   「變體改名、spec 不變」情境新 sku 恆撞已死孤兒 → 該供應商每日同步永久 abort、無工具可解。
//   V1:變體級對賬排定硬刪的孤兒 sku(deletedSkus)不參與模擬(upsert 前已刪)。

import { describe, it, expect } from 'vitest';
import { simulateSpecCollisions } from './rpm-delta';

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
