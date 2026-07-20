import { describe, it, expect } from 'vitest';
import { CheckoutInput, TapPayPrimeInput } from './index';
import * as schemaExports from './index';

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

  it('功能開啟時會收 Email，並只移除頭尾半形空白、把網域轉小寫', () => {
    const createCheckoutInputSchema = Reflect.get(schemaExports, 'createCheckoutInputSchema');
    expect(createCheckoutInputSchema).toBeTypeOf('function');

    const result = createCheckoutInputSchema(true).safeParse({
      ...validBase,
      notificationEmail: ' User.Name+tag@EXAMPLE.COM ',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notificationEmail).toBe('User.Name+tag@example.com');
    }
  });

  it('功能關閉時維持舊契約，忽略 client 偷塞的 Email 欄', () => {
    const createCheckoutInputSchema = Reflect.get(schemaExports, 'createCheckoutInputSchema');
    const result = createCheckoutInputSchema(false).safeParse({
      ...validBase,
      notificationEmail: 'attacker@example.com',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('notificationEmail');
    }
  });

  it.each([
    ['未提供', undefined, '請填寫 Email'],
    ['空字串', '', '請填寫 Email'],
    ['只有半形空白', '   ', '請填寫 Email'],
    ['含全形空白', '　user@example.com', 'Email 格式不正確'],
    ['含全形 @', 'user＠example.com', 'Email 格式不正確'],
    ['含換行', 'user@example.com\n', 'Email 格式不正確'],
    ['沒有 @', 'user.example.com', 'Email 格式不正確'],
    ['兩個 @', 'user@@example.com', 'Email 格式不正確'],
    ['網域沒有點', 'user@example', 'Email 格式不正確'],
  ])('功能開啟時拒絕%s', (_label, notificationEmail, expectedMessage) => {
    const createCheckoutInputSchema = Reflect.get(schemaExports, 'createCheckoutInputSchema');
    const input = { ...validBase, ...(notificationEmail === undefined ? {} : { notificationEmail }) };
    const result = createCheckoutInputSchema(true).safeParse(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(expectedMessage);
    }
  });

  it('以 UTF-8 bytes 驗 254 上限，不用字元數混充', () => {
    const createCheckoutInputSchema = Reflect.get(schemaExports, 'createCheckoutInputSchema');
    const exactly254 = `${'a'.repeat(242)}@example.com`;
    const over254 = `${'a'.repeat(243)}@example.com`;

    expect(new TextEncoder().encode(exactly254)).toHaveLength(254);
    expect(createCheckoutInputSchema(true).safeParse({ ...validBase, notificationEmail: exactly254 }).success).toBe(
      true,
    );
    expect(createCheckoutInputSchema(true).safeParse({ ...validBase, notificationEmail: over254 }).success).toBe(
      false,
    );
  });

  it.each([
    'x@line.pcmmotorsports.local',
    'x@LINE.PCMMOTORSPORTS.LOCAL',
    'x@line.pcmmotorsports.local.',
    'x@sub.line.pcmmotorsports.local',
  ])('拒絕 LINE 合成信箱與其繞過形式：%s', (notificationEmail) => {
    const createCheckoutInputSchema = Reflect.get(schemaExports, 'createCheckoutInputSchema');
    expect(createCheckoutInputSchema(true).safeParse({ ...validBase, notificationEmail }).success).toBe(false);
  });

  it.each(['x@notline.pcmmotorsports.local2.com', 'x@line.pcmmotorsports.local.example.com'])(
    '不誤擋相似但合法的網域：%s',
    (notificationEmail) => {
      const createCheckoutInputSchema = Reflect.get(schemaExports, 'createCheckoutInputSchema');
      expect(createCheckoutInputSchema(true).safeParse({ ...validBase, notificationEmail }).success).toBe(true);
    },
  );
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
