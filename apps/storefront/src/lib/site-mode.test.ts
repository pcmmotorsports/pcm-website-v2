// lib/site-mode.ts —— 一般站 / 經銷站 由環境變數 NEXT_PUBLIC_SITE_MODE 決定(B2B 計畫 §2.2、片 4)。
import { describe, expect, it } from 'vitest';
import { resolveSiteMode } from './site-mode';

describe('resolveSiteMode', () => {
  it('沒設或設 retail ⇒ 一般站', () => {
    expect(resolveSiteMode(undefined)).toBe('retail');
    expect(resolveSiteMode('')).toBe('retail');
    expect(resolveSiteMode('retail')).toBe('retail');
    expect(resolveSiteMode(' RETAIL ')).toBe('retail');
  });
  it('設 b2b ⇒ 經銷站', () => {
    expect(resolveSiteMode('b2b')).toBe('b2b');
    expect(resolveSiteMode(' B2B ')).toBe('b2b');
  });
  // 🔴 認不得的值直接報錯(第四版片 4,Fable R1 consider 4):經銷站外觀與一般站幾乎相同,
  //   猜錯任何一邊都沒有人看得出來 ⇒ 不猜,讓建置直接失敗。
  it('認不得的值 ⇒ 丟錯(建置時就失敗)', () => {
    expect(() => resolveSiteMode('b2')).toThrow(/NEXT_PUBLIC_SITE_MODE/);
    expect(() => resolveSiteMode('dealer')).toThrow(/NEXT_PUBLIC_SITE_MODE/);
  });
});
