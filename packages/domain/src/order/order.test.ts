import { describe, it, expect } from 'vitest';
import { toMoneyAmount, type Money } from '../shared/types';
import {
  createProductSnapshot,
  createOrderItem,
  createOrder,
  assertOrderInvariant,
} from './order';
import { OrderError } from './errors';
import type { Order, OrderItem, ProductSnapshot } from './types';

const TWD = (n: number): Money => ({ amount: toMoneyAmount(n), currency: 'TWD' });

function snap(overrides: Partial<ProductSnapshot> = {}): ProductSnapshot {
  return { title: '碳纖維護蓋', sku: 'DCC01', spec: { weave: '3K' }, ...overrides };
}

function makeItem(overrides: Partial<Parameters<typeof createOrderItem>[0]> = {}): OrderItem {
  return createOrderItem({
    productId: 'p-1',
    quantity: 2,
    unitPrice: TWD(1000),
    variantSku: 'DCC01-G-F',
    productSnapshot: snap(),
    ...overrides,
  });
}

describe('createProductSnapshot(逐欄白名單)', () => {
  it('只複製 title / sku / spec 三欄', () => {
    const result = createProductSnapshot(snap());
    expect(Object.keys(result).sort()).toEqual(['sku', 'spec', 'title']);
    expect(result).toEqual({ title: '碳纖維護蓋', sku: 'DCC01', spec: { weave: '3K' } });
  });

  it('🔴 經銷價 / cost 等敏感欄即使傳入也被丟棄(編譯期+執行期雙擋)', () => {
    // 偽造「整個 Product 塞進快照」、繞過型別驗執行期白名單
    const malicious = {
      title: 'X',
      sku: 'Y',
      spec: {},
      price_store: 999,
      price_by_tier: { store: 999 },
      cost: 500,
    } as unknown as ProductSnapshot;
    const result = createProductSnapshot(malicious);
    expect(Object.keys(result).sort()).toEqual(['sku', 'spec', 'title']);
    expect((result as Record<string, unknown>).price_store).toBeUndefined();
    expect((result as Record<string, unknown>).price_by_tier).toBeUndefined();
    expect((result as Record<string, unknown>).cost).toBeUndefined();
  });

  it('title 空字串 throw invalid_snapshot', () => {
    expect(() => createProductSnapshot(snap({ title: '' }))).toThrow(OrderError);
    try {
      createProductSnapshot(snap({ title: '' }));
    } catch (e) {
      expect((e as OrderError).code).toBe('invalid_snapshot');
    }
  });

  it('sku 空字串 throw invalid_snapshot', () => {
    expect(() => createProductSnapshot(snap({ sku: '' }))).toThrow(OrderError);
  });

  it('spec 值非字串 throw invalid_snapshot', () => {
    const bad = { title: 'X', sku: 'Y', spec: { weave: 12 } } as unknown as ProductSnapshot;
    expect(() => createProductSnapshot(bad)).toThrow(OrderError);
  });

  it('無變體商品 spec = {} 合法', () => {
    expect(createProductSnapshot(snap({ spec: {} })).spec).toEqual({});
  });
});

describe('createOrderItem(guard)', () => {
  it('lineTotal = unitPrice × quantity(整數)', () => {
    const item = makeItem({ quantity: 3, unitPrice: TWD(1500) });
    expect(item.lineTotal).toEqual(TWD(4500));
    expect(item.unitPrice).toEqual(TWD(1500));
    expect(item.quantity).toBe(3);
  });

  it('productSnapshot 走白名單、variantSku 接上', () => {
    const item = makeItem();
    expect(item.variantSku).toBe('DCC01-G-F');
    expect(Object.keys(item.productSnapshot).sort()).toEqual(['sku', 'spec', 'title']);
  });

  it('quantity 非整數 throw invalid_quantity', () => {
    expect(() => makeItem({ quantity: 1.5 })).toThrow(OrderError);
    try {
      makeItem({ quantity: 1.5 });
    } catch (e) {
      expect((e as OrderError).code).toBe('invalid_quantity');
    }
  });

  it('quantity < 1 throw invalid_quantity', () => {
    expect(() => makeItem({ quantity: 0 })).toThrow(OrderError);
    expect(() => makeItem({ quantity: -1 })).toThrow(OrderError);
  });

  it('unitPrice 負數(as 繞過)throw invalid_amount', () => {
    const badPrice = { amount: -100 as unknown, currency: 'TWD' } as unknown as Money;
    expect(() => makeItem({ unitPrice: badPrice })).toThrow(OrderError);
    try {
      makeItem({ unitPrice: badPrice });
    } catch (e) {
      expect((e as OrderError).code).toBe('invalid_amount');
    }
  });

  it('unitPrice 非整數(as 繞過)throw invalid_amount', () => {
    const badPrice = { amount: 100.5 as unknown, currency: 'TWD' } as unknown as Money;
    expect(() => makeItem({ unitPrice: badPrice })).toThrow(OrderError);
  });

  it('variantSku 空字串 throw invalid_snapshot', () => {
    expect(() => makeItem({ variantSku: '' })).toThrow(OrderError);
  });
});

describe('createOrder(build invariant)', () => {
  it('subtotal = Σ lineTotal、total = subtotal + shipping − discount', () => {
    const order = createOrder({
      id: 'ord-1',
      displayId: 'PCM-2026-0001',
      customerId: 'cust-1',
      tierAtCheckout: 'store',
      items: [
        makeItem({ quantity: 2, unitPrice: TWD(1000) }), // 2000
        makeItem({ quantity: 1, unitPrice: TWD(500) }), // 500
      ],
      shippingFee: TWD(160),
      discountTotal: TWD(100),
    });
    expect(order.subtotal).toEqual(TWD(2500));
    expect(order.total).toEqual(TWD(2560)); // 2500 + 160 − 100
    expect(order.tierAtCheckout).toBe('store');
  });

  it('預設 paymentStatus=unpaid / fulfillmentStatus=notOrdered(雙軸起點)', () => {
    const order = createOrder({
      id: 'ord-1',
      displayId: 'PCM-2026-0001',
      customerId: 'cust-1',
      tierAtCheckout: 'general',
      items: [makeItem()],
      shippingFee: TWD(0),
      discountTotal: TWD(0),
    });
    expect(order.paymentStatus).toBe('unpaid');
    expect(order.fulfillmentStatus).toBe('notOrdered');
  });

  it('items 空 throw empty_items', () => {
    expect(() =>
      createOrder({
        id: 'ord-1',
        displayId: 'PCM-2026-0001',
        customerId: 'cust-1',
        tierAtCheckout: 'general',
        items: [],
        shippingFee: TWD(0),
        discountTotal: TWD(0),
      }),
    ).toThrow(OrderError);
    try {
      createOrder({
        id: 'ord-1',
        displayId: 'PCM-2026-0001',
        customerId: 'cust-1',
        tierAtCheckout: 'general',
        items: [],
        shippingFee: TWD(0),
        discountTotal: TWD(0),
      });
    } catch (e) {
      expect((e as OrderError).code).toBe('empty_items');
    }
  });

  it('discount > subtotal + shipping(total < 0)throw invalid_amount', () => {
    expect(() =>
      createOrder({
        id: 'ord-1',
        displayId: 'PCM-2026-0001',
        customerId: 'cust-1',
        tierAtCheckout: 'general',
        items: [makeItem({ quantity: 1, unitPrice: TWD(1000) })],
        shippingFee: TWD(0),
        discountTotal: TWD(2000), // > subtotal 1000
      }),
    ).toThrow(OrderError);
  });

  it('displayId 非法 throw invalid_display_id', () => {
    expect(() =>
      createOrder({
        id: 'ord-1',
        displayId: 'BAD-ID',
        customerId: 'cust-1',
        tierAtCheckout: 'general',
        items: [makeItem()],
        shippingFee: TWD(0),
        discountTotal: TWD(0),
      }),
    ).toThrow(OrderError);
  });

  it('shippingFee 負數(as 繞過)throw invalid_amount', () => {
    const badFee = { amount: -50 as unknown, currency: 'TWD' } as unknown as Money;
    expect(() =>
      createOrder({
        id: 'ord-1',
        displayId: 'PCM-2026-0001',
        customerId: 'cust-1',
        tierAtCheckout: 'general',
        items: [makeItem()],
        shippingFee: badFee,
        discountTotal: TWD(0),
      }),
    ).toThrow(OrderError);
  });
});

describe('assertOrderInvariant(重建後 / 腐壞偵測)', () => {
  function goodOrder(): Order {
    return createOrder({
      id: 'ord-1',
      displayId: 'PCM-2026-0001',
      customerId: 'cust-1',
      tierAtCheckout: 'general',
      items: [makeItem({ quantity: 2, unitPrice: TWD(1000) })], // line 2000
      shippingFee: TWD(160),
      discountTotal: TWD(0),
    });
  }

  it('createOrder 產出必通過 assertOrderInvariant', () => {
    expect(() => assertOrderInvariant(goodOrder())).not.toThrow();
  });

  it('subtotal 被竄改 throw subtotal_mismatch', () => {
    const corrupt: Order = { ...goodOrder(), subtotal: TWD(9999) };
    expect(() => assertOrderInvariant(corrupt)).toThrow(OrderError);
    try {
      assertOrderInvariant(corrupt);
    } catch (e) {
      expect((e as OrderError).code).toBe('subtotal_mismatch');
    }
  });

  it('total 算錯被竄改 throw total_mismatch', () => {
    const corrupt: Order = { ...goodOrder(), total: TWD(1) };
    expect(() => assertOrderInvariant(corrupt)).toThrow(OrderError);
    try {
      assertOrderInvariant(corrupt);
    } catch (e) {
      expect((e as OrderError).code).toBe('total_mismatch');
    }
  });

  it('lineTotal ≠ unitPrice × qty(腐壞 item)throw subtotal_mismatch', () => {
    const base = goodOrder();
    const firstItem = base.items[0];
    if (firstItem === undefined) throw new Error('test setup: expected 1 item');
    const corruptItem: OrderItem = { ...firstItem, lineTotal: TWD(1) };
    const corrupt: Order = { ...base, items: [corruptItem] };
    expect(() => assertOrderInvariant(corrupt)).toThrow(OrderError);
  });

  it('currency 不一致 throw currency_mismatch', () => {
    const base = goodOrder();
    // 偽造跨幣別 shippingFee(domain 只支援 TWD、用 as 繞過驗跨邊界守則)
    const badFee = { amount: toMoneyAmount(160), currency: 'USD' } as unknown as Money;
    const corrupt: Order = { ...base, shippingFee: badFee };
    expect(() => assertOrderInvariant(corrupt)).toThrow(OrderError);
    try {
      assertOrderInvariant(corrupt);
    } catch (e) {
      expect((e as OrderError).code).toBe('currency_mismatch');
    }
  });
});
