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
  // 🔴 打錯字要往「經銷站」那邊錯:經銷站打錯字變成一般站 ⇒ 整站被 Google 收錄、顯示牌價,而且不會有人發現;
  //   一般站打錯字變成經銷站 ⇒ 全站被擋,當天就會被發現。
  it('認不得的值 ⇒ 當成經銷站(寧可擋錯,不可放錯)', () => {
    expect(resolveSiteMode('b2')).toBe('b2b');
    expect(resolveSiteMode('dealer')).toBe('b2b');
  });
});
