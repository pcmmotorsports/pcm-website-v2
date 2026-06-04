import { describe, it, expect } from 'vitest';
import { toMoneyAmount } from '../shared/types';
import {
  canPaymentTransition,
  canFulfillmentTransition,
  assertPaymentTransition,
  assertFulfillmentTransition,
  withPaymentStatus,
  withFulfillmentStatus,
} from './state-machine';
import { createOrder, createOrderItem } from './order';
import { OrderError } from './errors';
import type { Order, PaymentStatus, FulfillmentStatus } from './types';

/** 建最小合法 Order(本檔測狀態轉移用、金額隨意但滿足 invariant)。 */
function createFakeOrder(overrides: Partial<Order> = {}): Order {
  const item = createOrderItem({
    productId: 'p-1',
    quantity: 1,
    unitPrice: { amount: toMoneyAmount(1000), currency: 'TWD' },
    variantSku: 'SKU-1',
    productSnapshot: { title: '碳纖維護蓋', sku: 'DCC01', spec: {} },
  });
  return {
    ...createOrder({
      id: 'ord-1',
      displayId: 'PCM-2026-0001',
      customerId: 'cust-1',
      tierAtCheckout: 'general',
      items: [item],
      shippingFee: { amount: toMoneyAmount(0), currency: 'TWD' },
      discountTotal: { amount: toMoneyAmount(0), currency: 'TWD' },
    }),
    ...overrides,
  };
}

describe('付款軸狀態機', () => {
  describe('canPaymentTransition', () => {
    it('主路徑 unpaid → paid 合法', () => {
      expect(canPaymentTransition('unpaid', 'paid')).toBe(true);
    });

    it('保留前向邊合法(partial capture / 退款)', () => {
      expect(canPaymentTransition('unpaid', 'partiallyPaid')).toBe(true);
      expect(canPaymentTransition('partiallyPaid', 'paid')).toBe(true);
      expect(canPaymentTransition('partiallyPaid', 'refunded')).toBe(true);
      expect(canPaymentTransition('paid', 'partiallyPaid')).toBe(true);
      expect(canPaymentTransition('paid', 'refunded')).toBe(true);
    });

    it('未付不可退、倒退、terminal 後、自我轉移 全非法', () => {
      expect(canPaymentTransition('unpaid', 'refunded')).toBe(false); // 未付不可退
      expect(canPaymentTransition('paid', 'unpaid')).toBe(false); // 倒退
      expect(canPaymentTransition('refunded', 'paid')).toBe(false); // terminal 後
      expect(canPaymentTransition('paid', 'paid')).toBe(false); // 自我轉移
      expect(canPaymentTransition('unpaid', 'unpaid')).toBe(false);
    });
  });

  it('assertPaymentTransition 非法 throw OrderError illegal_payment_transition', () => {
    expect(() => assertPaymentTransition('unpaid', 'paid')).not.toThrow();
    expect(() => assertPaymentTransition('unpaid', 'refunded')).toThrow(OrderError);
    try {
      assertPaymentTransition('unpaid', 'refunded');
    } catch (e) {
      expect((e as OrderError).code).toBe('illegal_payment_transition');
    }
  });

  it('withPaymentStatus 合法回新 Order、不改原物件', () => {
    const order = createFakeOrder();
    const next = withPaymentStatus(order, 'paid');
    expect(next.paymentStatus).toBe('paid');
    expect(order.paymentStatus).toBe('unpaid'); // 原物件不變(immutable)
    expect(next).not.toBe(order);
  });

  it('withPaymentStatus 非法跳級 throw', () => {
    const order = createFakeOrder();
    expect(() => withPaymentStatus(order, 'refunded')).toThrow(OrderError);
  });
});

describe('出貨軸狀態機', () => {
  describe('canFulfillmentTransition', () => {
    it('逐級線性合法', () => {
      expect(canFulfillmentTransition('notOrdered', 'ordered')).toBe(true);
      expect(canFulfillmentTransition('ordered', 'inStock')).toBe(true);
      expect(canFulfillmentTransition('inStock', 'shipped')).toBe(true);
    });

    it('跳級 / 倒退 / terminal 後 / 自我轉移 全非法', () => {
      expect(canFulfillmentTransition('notOrdered', 'inStock')).toBe(false); // 跳級
      expect(canFulfillmentTransition('notOrdered', 'shipped')).toBe(false); // 跳級
      expect(canFulfillmentTransition('shipped', 'inStock')).toBe(false); // 倒退
      expect(canFulfillmentTransition('inStock', 'ordered')).toBe(false); // 倒退
      expect(canFulfillmentTransition('shipped', 'shipped')).toBe(false); // 自我轉移
    });
  });

  it('assertFulfillmentTransition 非法 throw OrderError illegal_fulfillment_transition', () => {
    expect(() =>
      assertFulfillmentTransition('notOrdered', 'ordered'),
    ).not.toThrow();
    expect(() =>
      assertFulfillmentTransition('notOrdered', 'shipped'),
    ).toThrow(OrderError);
    try {
      assertFulfillmentTransition('notOrdered', 'shipped');
    } catch (e) {
      expect((e as OrderError).code).toBe('illegal_fulfillment_transition');
    }
  });

  it('withFulfillmentStatus 逐級走完整鏈、每步回新 Order', () => {
    const order = createFakeOrder();
    const steps: FulfillmentStatus[] = ['ordered', 'inStock', 'shipped'];
    let cur = order;
    for (const to of steps) {
      const prev = cur;
      cur = withFulfillmentStatus(cur, to);
      expect(cur.fulfillmentStatus).toBe(to);
      expect(cur).not.toBe(prev);
    }
    expect(order.fulfillmentStatus).toBe('notOrdered'); // 原物件不變
  });

  it('withFulfillmentStatus 非法跳級 throw', () => {
    const order = createFakeOrder();
    expect(() => withFulfillmentStatus(order, 'shipped')).toThrow(OrderError);
  });
});

describe('雙軸獨立', () => {
  it('付款軸轉移不動出貨軸、反之亦然', () => {
    const order = createFakeOrder();
    const paid = withPaymentStatus(order, 'paid');
    expect(paid.fulfillmentStatus).toBe('notOrdered'); // 出貨軸不受影響
    const ordered = withFulfillmentStatus(paid, 'ordered');
    expect(ordered.paymentStatus).toBe('paid'); // 付款軸保留
    expect(ordered.fulfillmentStatus).toBe('ordered');
  });

  // 型別層雙軸完整性:確保兩 enum 互不污染(編譯期已擋、此處 runtime 抽樣)
  const allPayment: PaymentStatus[] = ['unpaid', 'paid', 'partiallyPaid', 'refunded'];
  const allFulfillment: FulfillmentStatus[] = [
    'notOrdered',
    'ordered',
    'inStock',
    'shipped',
  ];
  it('付款狀態值不可當出貨轉移目標(交叉非法)', () => {
    for (const p of allPayment) {
      expect(canFulfillmentTransition('notOrdered', p as unknown as FulfillmentStatus)).toBe(
        false,
      );
    }
    for (const f of allFulfillment) {
      expect(canPaymentTransition('unpaid', f as unknown as PaymentStatus)).toBe(false);
    }
  });
});
