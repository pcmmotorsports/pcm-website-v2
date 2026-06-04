import { describe, it, expect } from 'vitest';
import { toMoneyAmount, type Money } from '../shared/types';
import {
  createOrderItem,
  assertOrderItemInvariant,
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

/**
 * hand-built OrderItem：**繞過** createOrderItem 直接組 literal,用於驗 createOrder /
 * assertOrderItemInvariant 對「不走 factory 的 caller」是否 fail-closed（審查 MUST-FIX-1+2）。
 */
function handBuiltItem(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    productId: 'p-1',
    quantity: 2,
    unitPrice: TWD(1000),
    lineTotal: TWD(2000),
    variantSku: 'DCC01-G-F',
    productSnapshot: { title: '碳纖維護蓋', sku: 'DCC01', spec: {} },
    ...overrides,
  };
}

const USD = (n: number): Money =>
  ({ amount: toMoneyAmount(n), currency: 'USD' }) as unknown as Money;

function makeOrderWithItems(items: OrderItem[]): Order {
  return createOrder({
    id: 'ord-1',
    displayId: 'PCM-2026-0001',
    customerId: 'cust-1',
    tierAtCheckout: 'general',
    items,
    shippingFee: TWD(0),
    discountTotal: TWD(0),
  });
}

function createOrderWith(
  overrides: Partial<Parameters<typeof createOrder>[0]> = {},
): Order {
  return createOrder({
    id: 'ord-1',
    displayId: 'PCM-2026-0001',
    customerId: 'cust-1',
    tierAtCheckout: 'general',
    items: [makeItem()],
    shippingFee: TWD(0),
    discountTotal: TWD(0),
    ...overrides,
  });
}

/** 造一個帶隱藏(non-enum)toJSON 的 String wrapper:Object.keys 看不到、JSON.stringify 會呼叫。 */
function wrapperWithToJSON(primitive: string, leak: string): string {
  const w = new String(primitive);
  Object.defineProperty(w, 'toJSON', { enumerable: false, value: () => leak });
  return w as unknown as string;
}

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

  // dim D 補洞:防腐壞分支直接覆蓋(原只走 createOrder/createOrderItem 間接路徑)
  it('items 空 throw empty_items', () => {
    const corrupt = { ...goodOrder(), items: [] } as Order;
    expect(() => assertOrderInvariant(corrupt)).toThrow(OrderError);
    try {
      assertOrderInvariant(corrupt);
    } catch (e) {
      expect((e as OrderError).code).toBe('empty_items');
    }
  });

  it('item qty 腐壞(0)throw invalid_quantity', () => {
    const corrupt = {
      ...goodOrder(),
      items: [handBuiltItem({ quantity: 0, lineTotal: TWD(0) })],
    } as Order;
    expect(() => assertOrderInvariant(corrupt)).toThrow(OrderError);
    try {
      assertOrderInvariant(corrupt);
    } catch (e) {
      expect((e as OrderError).code).toBe('invalid_quantity');
    }
  });
});

describe('assertOrderItemInvariant(createOrder 與 assertOrderInvariant 共用單 item 驗)', () => {
  it('createOrderItem 建出的乾淨 item 通過', () => {
    expect(() => assertOrderItemInvariant(makeItem(), 'TWD')).not.toThrow();
  });

  it('lineTotal ≠ unitPrice × qty throw subtotal_mismatch', () => {
    expect(() =>
      assertOrderItemInvariant(handBuiltItem({ lineTotal: TWD(1) }), 'TWD'),
    ).toThrow(OrderError);
    try {
      assertOrderItemInvariant(handBuiltItem({ lineTotal: TWD(1) }), 'TWD');
    } catch (e) {
      expect((e as OrderError).code).toBe('subtotal_mismatch');
    }
  });

  it('qty 非整數 throw invalid_quantity', () => {
    expect(() =>
      assertOrderItemInvariant(
        handBuiltItem({ quantity: 1.5, lineTotal: TWD(1500) }),
        'TWD',
      ),
    ).toThrow(OrderError);
  });

  it('unitPrice 跨幣 throw currency_mismatch', () => {
    expect(() =>
      assertOrderItemInvariant(handBuiltItem({ unitPrice: USD(1000) }), 'TWD'),
    ).toThrow(OrderError);
  });

  it('帶經銷價 snapshot 的 item throw invalid_snapshot', () => {
    const dirty = handBuiltItem({
      productSnapshot: {
        title: 'X',
        sku: 'Y',
        spec: {},
        price_store: 999,
      } as unknown as ProductSnapshot,
    });
    expect(() => assertOrderItemInvariant(dirty, 'TWD')).toThrow(OrderError);
  });
});

describe('createOrder fail-closed 對 hand-built item(MUST-FIX-1+2)', () => {
  it('lineTotal 低報 → throw subtotal_mismatch(防低報結帳)', () => {
    expect(() =>
      makeOrderWithItems([handBuiltItem({ lineTotal: TWD(1) })]),
    ).toThrow(OrderError);
    try {
      makeOrderWithItems([handBuiltItem({ lineTotal: TWD(1) })]);
    } catch (e) {
      expect((e as OrderError).code).toBe('subtotal_mismatch');
    }
  });

  it('qty=1.5 → throw invalid_quantity', () => {
    expect(() =>
      makeOrderWithItems([handBuiltItem({ quantity: 1.5, lineTotal: TWD(1500) })]),
    ).toThrow(OrderError);
  });

  it('跨幣 unitPrice → throw currency_mismatch', () => {
    expect(() =>
      makeOrderWithItems([handBuiltItem({ unitPrice: USD(1000) })]),
    ).toThrow(OrderError);
  });

  it('🔴 帶經銷價 snapshot 的 item → throw invalid_snapshot(fail-closed、非 strip)', () => {
    const dirty = handBuiltItem({
      productSnapshot: {
        title: 'X',
        sku: 'Y',
        spec: {},
        price_store: 999,
        price_by_tier: { store: 999 },
        cost: 500,
      } as unknown as ProductSnapshot,
    });
    expect(() => makeOrderWithItems([dirty])).toThrow(OrderError);
    try {
      makeOrderWithItems([dirty]);
    } catch (e) {
      expect((e as OrderError).code).toBe('invalid_snapshot');
    }
  });

  it('多品項第二項跨幣別 → throw currency_mismatch', () => {
    // 第一項 makeItem TWD → 整單 currency=TWD;第二項 USD item lineTotal 觸發 mismatch
    const usdItem = handBuiltItem({
      unitPrice: USD(500),
      lineTotal: USD(1000),
    });
    expect(() => makeOrderWithItems([makeItem(), usdItem])).toThrow(OrderError);
  });
});

describe('createOrder canonicalize 收尾(round3:封隱藏 toJSON/getter 序列化漏經銷價殘洞)', () => {
  it('🔴 hand-built 快照藏隱藏 toJSON 回傳經銷價 → 產出 order 序列化零經銷價', () => {
    // 隱藏 toJSON:non-enumerable → Object.keys 看不到(assertProductSnapshot reject 漏)、
    // 但 JSON.stringify 會呼叫並吐其回傳值 → round2 殘洞向量。canonicalize 重抄為純 literal 封閉。
    const sneaky = { title: 'X', sku: 'Y', spec: {} } as ProductSnapshot;
    Object.defineProperty(sneaky, 'toJSON', {
      enumerable: false,
      value: () => ({
        title: 'X',
        sku: 'Y',
        spec: {},
        price_store: 999,
        price_by_tier: { store: 999 },
        cost: 500,
      }),
    });
    const order = makeOrderWithItems([handBuiltItem({ productSnapshot: sneaky })]);
    const json = JSON.stringify(order);
    expect(json).not.toContain('price_store');
    expect(json).not.toContain('price_by_tier');
    expect(json).not.toContain('cost');
    expect(json).not.toContain('999');
    expect(json).not.toContain('500');
  });

  it('hand-built Money(unitPrice)藏隱藏 toJSON → 產出 order 序列化零經銷價', () => {
    const sneakyPrice = { amount: toMoneyAmount(1000), currency: 'TWD' } as Money;
    Object.defineProperty(sneakyPrice, 'toJSON', {
      enumerable: false,
      value: () => ({ amount: 1000, currency: 'TWD', price_store: 777 }),
    });
    const order = makeOrderWithItems([
      handBuiltItem({ unitPrice: sneakyPrice, lineTotal: TWD(2000) }),
    ]);
    const json = JSON.stringify(order);
    expect(json).not.toContain('price_store');
    expect(json).not.toContain('777');
  });

  it('hand-built shippingFee 藏隱藏 toJSON → 產出 order 序列化零經銷價', () => {
    const sneakyFee = { amount: toMoneyAmount(160), currency: 'TWD' } as Money;
    Object.defineProperty(sneakyFee, 'toJSON', {
      enumerable: false,
      value: () => ({ amount: 160, currency: 'TWD', cost: 888 }),
    });
    const order = createOrder({
      id: 'ord-1',
      displayId: 'PCM-2026-0001',
      customerId: 'cust-1',
      tierAtCheckout: 'general',
      items: [makeItem()],
      shippingFee: sneakyFee,
      discountTotal: TWD(0),
    });
    const json = JSON.stringify(order);
    expect(json).not.toContain('cost');
    expect(json).not.toContain('888');
  });

  it('canonicalize:存的 productSnapshot 是全新副本、非 caller 物件參照(spec 亦重建)', () => {
    const snapObj = { title: 'X', sku: 'Y', spec: { weave: '3K' } };
    const order = makeOrderWithItems([handBuiltItem({ productSnapshot: snapObj })]);
    const stored = order.items[0]?.productSnapshot;
    expect(stored).toEqual({ title: 'X', sku: 'Y', spec: { weave: '3K' } });
    expect(stored).not.toBe(snapObj); // 全新物件、非沿用 caller 參照
    expect(stored?.spec).not.toBe(snapObj.spec); // spec 亦重建
  });

  it('canonicalize:存的 unitPrice / lineTotal 是全新 Money literal、非 caller 參照', () => {
    const up = TWD(1000);
    const lt = TWD(2000);
    const order = makeOrderWithItems([handBuiltItem({ unitPrice: up, lineTotal: lt })]);
    expect(order.items[0]?.unitPrice).toEqual(up);
    expect(order.items[0]?.unitPrice).not.toBe(up);
    expect(order.items[0]?.lineTotal).not.toBe(lt);
  });

  // 純值欄(productId / currency)wrapper 類:無法 canonicalize 重抄成安全物件(本就純值),
  // 改 typeof loud-reject 封 `new String()` 帶隱藏 toJSON 偷渡序列化字串(round3 reviewer 補抓向量)
  it('🔴 hand-built productId 用 String wrapper 藏 toJSON → throw invalid_snapshot', () => {
    const evilId = new String('p-1') as unknown as string;
    Object.defineProperty(evilId, 'toJSON', {
      enumerable: false,
      value: () => 'leak_price_store_999',
    });
    expect(() =>
      makeOrderWithItems([handBuiltItem({ productId: evilId })]),
    ).toThrow(OrderError);
    try {
      makeOrderWithItems([handBuiltItem({ productId: evilId })]);
    } catch (e) {
      expect((e as OrderError).code).toBe('invalid_snapshot');
    }
  });

  it('hand-built Money currency 用 String wrapper → throw currency_mismatch', () => {
    const wrapCur = new String('TWD') as unknown as 'TWD';
    const item = handBuiltItem({
      unitPrice: { amount: toMoneyAmount(1000), currency: wrapCur } as unknown as Money,
      lineTotal: TWD(2000),
    });
    expect(() => makeOrderWithItems([item])).toThrow(OrderError);
    try {
      makeOrderWithItems([item]);
    } catch (e) {
      expect((e as OrderError).code).toBe('currency_mismatch');
    }
  });

  // order-level 純字串 / enum 欄(id / customerId / tier / status / displayId)wrapper 同向量,
  // 一併封死(否則 docstring「序列化攻擊面全封」字面 vs 事實不符)
  it('🔴 order-level id 用 String wrapper 藏 toJSON → throw invalid_field', () => {
    const evilId = wrapperWithToJSON('ord-1', 'leak_price_store_999');
    expect(() => createOrderWith({ id: evilId })).toThrow(OrderError);
    try {
      createOrderWith({ id: evilId });
    } catch (e) {
      expect((e as OrderError).code).toBe('invalid_field');
    }
  });

  it('order-level customerId / tierAtCheckout 用 String wrapper → throw invalid_field', () => {
    expect(() =>
      createOrderWith({ customerId: wrapperWithToJSON('cust-1', 'leak') }),
    ).toThrow(OrderError);
    expect(() =>
      createOrderWith({
        tierAtCheckout: wrapperWithToJSON('general', 'leak') as unknown as 'general',
      }),
    ).toThrow(OrderError);
  });

  it('order-level displayId 用 String wrapper(regex 會誤判合法)→ throw invalid_display_id', () => {
    const evilDid = wrapperWithToJSON('PCM-2026-0001', 'leak_999');
    expect(() => createOrderWith({ displayId: evilDid })).toThrow(OrderError);
    try {
      createOrderWith({ displayId: evilDid });
    } catch (e) {
      expect((e as OrderError).code).toBe('invalid_display_id');
    }
  });

  it('正常路徑(全 primitive 欄)仍正常建單、不被守門誤殺', () => {
    expect(() => createOrderWith()).not.toThrow();
    const order = createOrderWith();
    expect(order.id).toBe('ord-1');
    expect(order.displayId).toBe('PCM-2026-0001');
    expect(JSON.stringify(order)).not.toContain('price_store');
  });
});
