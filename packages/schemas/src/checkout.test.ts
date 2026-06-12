import { describe, it, expect } from 'vitest';
import { CheckoutInput, TapPayPrimeInput } from './index';

// vitest root config glob `{packages,apps}/**/*.{test,spec}.{ts,tsx}` 收本檔。
// M-1-14c 的 6 組 schema 靠消費端 actions.test.ts 間接驗;本片改為「schema 直接單元測」(更早抓 zod 漂移)。
describe('CheckoutInput', () => {
  const validBase = {
    addressId: '00000000-0000-4000-8000-000000000000',
    shippingMethod: 'home',
    invoice: { type: 'personal' },
  };

  it('should accept a valid personal-invoice checkout (invoice 子欄 default 補齊)', () => {
    expect(CheckoutInput.safeParse(validBase).success).toBe(true);
  });

  it('should reject a non-uuid / empty addressId', () => {
    expect(CheckoutInput.safeParse({ ...validBase, addressId: '' }).success).toBe(false);
    expect(CheckoutInput.safeParse({ ...validBase, addressId: 'not-a-uuid' }).success).toBe(false);
  });

  it('should reject an unknown shipping method (對齊 RPC home/store 白名單)', () => {
    expect(CheckoutInput.safeParse({ ...validBase, shippingMethod: 'cvs' }).success).toBe(false);
  });

  it('should accept store pickup', () => {
    expect(CheckoutInput.safeParse({ ...validBase, shippingMethod: 'store' }).success).toBe(true);
  });

  it('should require title + 8-digit taxId for company invoice', () => {
    expect(
      CheckoutInput.safeParse({
        ...validBase,
        invoice: { type: 'company', title: '', taxId: '123' },
      }).success,
    ).toBe(false);
  });

  it('should accept a valid company invoice', () => {
    expect(
      CheckoutInput.safeParse({
        ...validBase,
        invoice: { type: 'company', title: 'PCM 重機', taxId: '12345678' },
      }).success,
    ).toBe(true);
  });

  it('should require donateCode for donate invoice', () => {
    expect(
      CheckoutInput.safeParse({
        ...validBase,
        invoice: { type: 'donate', donateCode: '' },
      }).success,
    ).toBe(false);
    expect(
      CheckoutInput.safeParse({
        ...validBase,
        invoice: { type: 'donate', donateCode: '520' },
      }).success,
    ).toBe(true);
  });
});

// === TapPayPrimeInput(M-3 ②-③d)===
describe('TapPayPrimeInput', () => {
  it('合法 prime(trim 後非空、≤512)→ 通過且回 trim 後值', () => {
    const res = TapPayPrimeInput.safeParse('  prime_abc123  ');
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toBe('prime_abc123');
    }
  });

  it.each([
    ['空字串', ''],
    ['純空白', '   '],
  ])('%s → 拒(不送空 prime 給 TapPay)', (_label, v) => {
    expect(TapPayPrimeInput.safeParse(v).success).toBe(false);
  });

  it('超長(>512)→ 拒(防呆 cap)', () => {
    expect(TapPayPrimeInput.safeParse('x'.repeat(513)).success).toBe(false);
  });

  it('非字串(數字/物件)→ 拒', () => {
    expect(TapPayPrimeInput.safeParse(123).success).toBe(false);
    expect(TapPayPrimeInput.safeParse({ prime: 'x' }).success).toBe(false);
  });
});
