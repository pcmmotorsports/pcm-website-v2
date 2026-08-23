// utils.test.ts — `toMemberTier` 的邊界解析(`#873`)
//
// 🔴 這支函式與同檔的 `designTierToSchema` / `schemaTierToDesign` **處置相反**(那兩支 throw)。
//    本檔第二個 describe 就是在釘那個差異 —— 少了它,下一個人會覺得三支不一致而「順手統一」。

import { describe, expect, it } from 'vitest';
import { toMemberTier, schemaTierToDesign } from './utils';

describe('toMemberTier · 認得的三個值原樣回來', () => {
  it.each(['general', 'store', 'premiumStore'] as const)('%s ⇒ 原樣', (t) => {
    expect(toMemberTier(t)).toBe(t);
  });
});

describe('toMemberTier · 認不得的一律回 null(不 throw)', () => {
  // 🔴 `platinumDealer` 不是隨便挑的:它模擬「**DB 的 enum 多了一個值**」——
  //    那是 `#873` 的觸發條件,不是「有人亂傳參數」。
  const REJECTED: ReadonlyArray<readonly [unknown, string]> = [
    ['platinumDealer', 'DB enum 多一個值(#873 的真實情境)'],
    ['premium_store', 'design 的 snake_case 字面 —— 看起來很像,但不是 schema 字面'],
    ['GENERAL', '大小寫不同'],
    [' general', '前面多一個空白'],
    ['', '空字串'],
    [null, 'null'],
    [undefined, 'undefined'],
    [0, '數字'],
    [{ tier: 'general' }, '物件'],
    [['general'], '陣列'],
  ];
  // 🔴 前提斷言:清單真的有東西(空陣列 ⇒ 下面一格都不會跑,而它會全綠)
  it('前提:被拒清單非空', () => {
    expect(REJECTED.length).toBeGreaterThan(5);
  });
  for (const [raw, why] of REJECTED) {
    it(`${String(raw)} ⇒ null(${why})`, () => {
      expect(toMemberTier(raw)).toBeNull();
    });
  }
});

describe('🔴 三支的處置【本來就不同】—— 這一格擋的是「順手統一」', () => {
  it('toMemberTier 對未知值【回 null】,而 schemaTierToDesign 對未知值【throw】', () => {
    expect(toMemberTier('platinumDealer')).toBeNull();
    // @ts-expect-error 刻意餵一個型別不允許的值 —— 模擬裸 cast 讓它流進來的那條路
    expect(() => schemaTierToDesign('platinumDealer')).toThrow(TypeError);
  });

  it('🔴 對照組:合法值兩支都不炸(證明上面那格不是「schemaTierToDesign 壞了」)', () => {
    expect(schemaTierToDesign('premiumStore')).toBe('premium_store');
    expect(toMemberTier('premiumStore')).toBe('premiumStore');
  });
});
