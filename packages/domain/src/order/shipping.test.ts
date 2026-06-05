import { describe, it, expect } from 'vitest';
import {
  calculateShippingFee,
  FREE_SHIPPING_THRESHOLD,
  HOME_SHIPPING_FEE,
} from './shipping';
import { toMoneyAmount, type Money } from '../shared/types';

function twd(n: number): Money {
  return { amount: toMoneyAmount(n), currency: 'TWD' };
}

describe('calculateShippingFee', () => {
  it('should be free for store pickup regardless of subtotal', () => {
    expect(calculateShippingFee(twd(0), 'store').amount).toBe(0);
    expect(calculateShippingFee(twd(999_999), 'store').amount).toBe(0);
  });

  it('should charge flat fee for home delivery under threshold', () => {
    expect(calculateShippingFee(twd(0), 'home').amount).toBe(HOME_SHIPPING_FEE);
    expect(calculateShippingFee(twd(4_999), 'home').amount).toBe(100);
  });

  it('should be free for home delivery at exactly the threshold', () => {
    expect(calculateShippingFee(twd(FREE_SHIPPING_THRESHOLD), 'home').amount).toBe(0);
    expect(calculateShippingFee(twd(5_000), 'home').amount).toBe(0);
  });

  it('should be free for home delivery over the threshold', () => {
    expect(calculateShippingFee(twd(100_000), 'home').amount).toBe(0);
  });

  it('should return Money with TWD currency and integer amount', () => {
    const fee = calculateShippingFee(twd(4_999), 'home');
    expect(fee.currency).toBe('TWD');
    expect(Number.isInteger(fee.amount)).toBe(true);
  });

  it('should mirror create_order RPC §7 branches (store 0 / home 5000 boundary)', () => {
    // 鏡像 supabase/migrations/20260604130000 §7:store→0、home subtotal>=5000?0:100
    expect(calculateShippingFee(twd(5_000), 'store').amount).toBe(0);
    expect(calculateShippingFee(twd(4_999), 'home').amount).toBe(100);
    expect(calculateShippingFee(twd(5_001), 'home').amount).toBe(0);
  });

  it('should throw on unknown shipping method (runtime fail-closed)', () => {
    // 型別層擋 'cvs';runtime 來自未型別資料時須 fail-closed、不默默當宅配
    expect(() => calculateShippingFee(twd(1_000), 'cvs' as unknown as 'home')).toThrow();
  });
});
