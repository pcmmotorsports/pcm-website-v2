// @vitest-environment jsdom
//
// inflight-marker test(P3 pivot A 另開分頁防呆)。驗:
// ① set → getActive 回未過期 marker;② clear / 無記號 → null;③ 逾 6 分 TTL → null + 順手清;
// ④ TTL 邊界內仍回;⑤ 壞值(非 JSON / 缺欄)→ null + 清;⑥ localStorage throw → set fail-safe 不炸;
// ⑦ confirmProceedIfInflight 軟提醒:無記號 true 不 confirm / confirm true → true+清 / confirm false → false+留。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setPaymentInflight,
  clearPaymentInflight,
  getActivePaymentInflight,
  confirmProceedIfInflight,
} from './inflight-marker';

const KEY = 'pcm-payment-inflight';
const CART = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});
afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('inflight-marker', () => {
  it('set → getActive 回未過期 marker(含 cartSessionId)', () => {
    setPaymentInflight(CART);
    const m = getActivePaymentInflight();
    expect(m?.cartSessionId).toBe(CART);
    expect(typeof m?.ts).toBe('number');
  });

  it('clear → getActive 回 null', () => {
    setPaymentInflight(CART);
    clearPaymentInflight();
    expect(getActivePaymentInflight()).toBeNull();
  });

  it('無記號 → getActive null', () => {
    expect(getActivePaymentInflight()).toBeNull();
  });

  it('逾 6 分 TTL → getActive null 且順手清', () => {
    const stale = { cartSessionId: CART, ts: Date.now() - 7 * 60 * 1000 };
    window.localStorage.setItem(KEY, JSON.stringify(stale));
    expect(getActivePaymentInflight()).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('TTL 邊界內(5 分)→ 仍回 marker', () => {
    const fresh = { cartSessionId: CART, ts: Date.now() - 5 * 60 * 1000 };
    window.localStorage.setItem(KEY, JSON.stringify(fresh));
    expect(getActivePaymentInflight()?.cartSessionId).toBe(CART);
  });

  it('壞值(非 JSON)→ null 且清', () => {
    window.localStorage.setItem(KEY, 'not-json{');
    expect(getActivePaymentInflight()).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('壞值(缺/錯欄型別)→ null 且清', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ cartSessionId: 123 }));
    expect(getActivePaymentInflight()).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('localStorage.setItem throw → set fail-safe 不炸結帳', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    expect(() => setPaymentInflight(CART)).not.toThrow();
  });

  describe('confirmProceedIfInflight(軟提醒)', () => {
    it('無記號 → 回 true、不呼 window.confirm', () => {
      const confirmSpy = vi.spyOn(window, 'confirm');
      expect(confirmProceedIfInflight()).toBe(true);
      expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('有記號 + confirm 回 true → 回 true 且清舊記號(客人要再付)', () => {
      setPaymentInflight(CART);
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      expect(confirmProceedIfInflight()).toBe(true);
      expect(getActivePaymentInflight()).toBeNull();
    });

    it('有記號 + confirm 回 false → 回 false 且保留記號(客人取消)', () => {
      setPaymentInflight(CART);
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      expect(confirmProceedIfInflight()).toBe(false);
      expect(getActivePaymentInflight()?.cartSessionId).toBe(CART);
    });
  });
});
