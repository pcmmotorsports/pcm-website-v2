import { describe, it, expect } from 'vitest';
import { BALANCE_PAYMENT_HANDLE, isBalancePaymentOnlyCart } from './balance-payment';

const B = BALANCE_PAYMENT_HANDLE;

describe('isBalancePaymentOnlyCart', () => {
  it('空車 → false(免運不適用)', () => {
    expect(isBalancePaymentOnlyCart([])).toBe(false);
  });

  it('整車都是補差額商品 → true(自取免運)', () => {
    expect(isBalancePaymentOnlyCart([B])).toBe(true);
    expect(isBalancePaymentOnlyCart([B, B])).toBe(true);
  });

  it('只有一般商品 → false(宅配照常)', () => {
    expect(isBalancePaymentOnlyCart(['rpm-carbon-x'])).toBe(false);
  });

  it('🔴 混入一般商品 → false(混車拿不到免運、天然防偷吃步)', () => {
    expect(isBalancePaymentOnlyCart([B, 'rpm-carbon-x'])).toBe(false);
    expect(isBalancePaymentOnlyCart(['rpm-carbon-x', B])).toBe(false);
  });
});
