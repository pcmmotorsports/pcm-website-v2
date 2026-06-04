/**
 * @module @pcm/domain/order/order — Order entity 建構 factory + guard + build invariant
 *
 * 對齊 plan v6 §5.4 快照 + §5 鐵則 12 紅線(金額整數 / 歷史凍結 / 經銷價零滲入)。
 * 純後端、零 DB / UI / 金流 / 報價單依賴(handoff §4)。
 *
 * 設計:
 * - factory(`createOrderItem` / `createOrder`)= **唯一合法建構入口**、建構即驗、產出必滿足 invariant。
 * - `assertOrderInvariant` = 驗一個「已組好的 Order」內部一致性、供 adapter 從 DB 重建後呼叫
 *   (防 DB 腐壞值)+ 測試對 hand-built 腐壞 Order 斷言「total 算錯 throw」。
 * - 金額一律整數 `.amount` 運算後過 `toMoneyAmount()` 再守門(money-handling §1.2)。
 *
 * @see packages/domain/src/order/types.ts
 * @see packages/domain/src/catalog/pricing.ts(pure-function 慣例)
 * @see docs/patterns/money-handling.md §1.2
 */

import type { Currency, MemberTier, Money } from '../shared/types';
import { toMoneyAmount } from '../shared/types';
import type { ProductId } from '../catalog/types';
import type { CustomerId } from '../identity/types';
import type {
  DisplayId,
  Order,
  OrderId,
  OrderItem,
  PaymentStatus,
  FulfillmentStatus,
  ProductSnapshot,
} from './types';
import { OrderError } from './errors';
import { assertDisplayId } from './display-id';

// ── 內部守門 helper ──────────────────────────────────────────────────────

/** 金額整數 + 非負(防 `as MoneyAmount` 繞過 guard 的腐壞值)。 */
function assertAmount(money: Money, label: string): void {
  if (!Number.isInteger(money.amount) || money.amount < 0) {
    throw new OrderError(
      'invalid_amount',
      `${label}.amount must be non-negative integer, got ${money.amount}`,
    );
  }
}

/** 跨 item / order 金額 currency 必一致。 */
function assertCurrency(expected: Currency, money: Money, label: string): void {
  if (money.currency !== expected) {
    throw new OrderError(
      'currency_mismatch',
      `${label} currency ${money.currency} ≠ order currency ${expected}`,
    );
  }
}

// ── 商品快照(逐欄白名單)──────────────────────────────────────────────────

/**
 * createProductSnapshot:逐欄白名單複製商品快照。
 *
 * 🔴 鐵則 12(plan §5 紅線 4):**只**取 `title` / `sku` / `spec` 三欄、
 * 即使輸入物件帶 `price_by_tier` / `price_store` / `cost` 等敏感欄也**不複製**
 * (執行期擋經銷價滲入 Order;配合 `ProductSnapshot` 型別編譯期擋)。
 *
 * @throws OrderError code `invalid_snapshot` 若 title / sku 非非空字串、或 spec 值非字串
 */
export function createProductSnapshot(input: ProductSnapshot): ProductSnapshot {
  const { title, sku } = input;
  if (typeof title !== 'string' || title.length === 0) {
    throw new OrderError(
      'invalid_snapshot',
      'productSnapshot.title must be non-empty string',
    );
  }
  if (typeof sku !== 'string' || sku.length === 0) {
    throw new OrderError(
      'invalid_snapshot',
      'productSnapshot.sku must be non-empty string',
    );
  }
  const spec: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.spec ?? {})) {
    if (typeof value !== 'string') {
      throw new OrderError(
        'invalid_snapshot',
        `productSnapshot.spec.${key} must be string, got ${typeof value}`,
      );
    }
    spec[key] = value;
  }
  // 只回 title / sku / spec 三欄 —— 輸入的任何額外欄(經銷價 / cost)在此被丟棄
  return { title, sku, spec };
}

// ── OrderItem factory(guard)──────────────────────────────────────────────

/**
 * createOrderItem:建 OrderItem value-object,建構即驗。
 *
 * - quantity 整數 ≥ 1(否則 `invalid_quantity`)
 * - unitPrice.amount 整數非負(防 `as` 繞過、否則 `invalid_amount`)
 * - lineTotal = unitPrice × quantity(整數、過 `toMoneyAmount` 守門、currency 沿用 unitPrice)
 * - variantSku 非空字串(否則 `invalid_snapshot`)
 * - productSnapshot 走 `createProductSnapshot` 逐欄白名單
 */
export function createOrderItem(params: {
  productId: ProductId;
  quantity: number;
  unitPrice: Money;
  variantSku: string;
  productSnapshot: ProductSnapshot;
}): OrderItem {
  const { productId, quantity, unitPrice, variantSku } = params;

  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new OrderError(
      'invalid_quantity',
      `quantity must be integer ≥ 1, got ${quantity}`,
    );
  }
  assertAmount(unitPrice, 'unitPrice');
  if (typeof variantSku !== 'string' || variantSku.length === 0) {
    throw new OrderError(
      'invalid_snapshot',
      'variantSku must be non-empty string',
    );
  }

  // 運算後再守門一次(money-handling §1.2);unitPrice 已非負整數 → 結果亦非負整數
  const lineTotal: Money = {
    amount: toMoneyAmount(unitPrice.amount * quantity),
    currency: unitPrice.currency,
  };

  return {
    productId,
    quantity,
    unitPrice,
    lineTotal,
    variantSku,
    productSnapshot: createProductSnapshot(params.productSnapshot),
  };
}

// ── Order factory(build invariant)────────────────────────────────────────

/**
 * createOrder:建 Order entity,建構即滿足 invariant(唯一合法建構入口)。
 *
 * - `subtotal` 由 items 的 lineTotal 加總算出(單一真相、caller 不傳、避免不一致)
 * - `total = subtotal + shippingFee − discountTotal`(過 `toMoneyAmount` 守門)
 * - items 非空、全金額同 currency、全非負整數;違反 throw
 * - paymentStatus / fulfillmentStatus 預設 `unpaid` / `notOrdered`(雙軸起點)
 *
 * @throws OrderError 多 code(invalid_display_id / empty_items / currency_mismatch /
 *   invalid_amount):見各守門
 */
export function createOrder(params: {
  id: OrderId;
  displayId: DisplayId;
  customerId: CustomerId;
  tierAtCheckout: MemberTier;
  items: OrderItem[];
  shippingFee: Money;
  discountTotal: Money;
  paymentStatus?: PaymentStatus;
  fulfillmentStatus?: FulfillmentStatus;
}): Order {
  const {
    id,
    displayId,
    customerId,
    tierAtCheckout,
    items,
    shippingFee,
    discountTotal,
    paymentStatus = 'unpaid',
    fulfillmentStatus = 'notOrdered',
  } = params;

  assertDisplayId(displayId);

  const firstItem = items[0];
  if (firstItem === undefined) {
    throw new OrderError('empty_items', 'order must have at least 1 item');
  }

  const currency = firstItem.lineTotal.currency;
  assertAmount(shippingFee, 'shippingFee');
  assertAmount(discountTotal, 'discountTotal');
  assertCurrency(currency, shippingFee, 'shippingFee');
  assertCurrency(currency, discountTotal, 'discountTotal');

  let subtotalAmount = 0;
  for (const item of items) {
    assertAmount(item.unitPrice, 'item.unitPrice');
    assertAmount(item.lineTotal, 'item.lineTotal');
    assertCurrency(currency, item.lineTotal, 'item.lineTotal');
    subtotalAmount += item.lineTotal.amount;
  }
  const subtotal: Money = { amount: toMoneyAmount(subtotalAmount), currency };

  const totalAmount = subtotalAmount + shippingFee.amount - discountTotal.amount;
  if (totalAmount < 0) {
    throw new OrderError(
      'invalid_amount',
      `total must be non-negative, got ${totalAmount} ` +
        `(subtotal ${subtotalAmount} + shipping ${shippingFee.amount} − discount ${discountTotal.amount})`,
    );
  }
  const total: Money = { amount: toMoneyAmount(totalAmount), currency };

  return {
    id,
    displayId,
    customerId,
    tierAtCheckout,
    items,
    paymentStatus,
    fulfillmentStatus,
    subtotal,
    shippingFee,
    discountTotal,
    total,
  };
}

/**
 * assertOrderInvariant:驗一個已組好的 Order 內部一致性。
 *
 * 用途:adapter 從 DB 重建 Order 後呼叫(防 DB 腐壞值繞過 factory);測試對 hand-built
 * 腐壞 Order 斷言「subtotal / total 算錯 throw」。`createOrder` 產出必通過此驗。
 *
 * 守:items 非空、currency 一致、全金額非負整數、每 lineTotal = unitPrice × qty、
 * subtotal = Σ lineTotal、total = subtotal + shippingFee − discountTotal。
 *
 * @throws OrderError 多 code(empty_items / currency_mismatch / invalid_amount /
 *   subtotal_mismatch / total_mismatch)
 */
export function assertOrderInvariant(order: Order): void {
  if (order.items.length === 0) {
    throw new OrderError('empty_items', 'order must have at least 1 item');
  }

  const currency = order.total.currency;
  let subtotalAmount = 0;
  for (const item of order.items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new OrderError(
        'invalid_quantity',
        `item.quantity must be integer ≥ 1, got ${item.quantity}`,
      );
    }
    assertAmount(item.unitPrice, 'item.unitPrice');
    assertAmount(item.lineTotal, 'item.lineTotal');
    assertCurrency(currency, item.lineTotal, 'item.lineTotal');
    assertCurrency(currency, item.unitPrice, 'item.unitPrice');
    if (item.lineTotal.amount !== item.unitPrice.amount * item.quantity) {
      throw new OrderError(
        'subtotal_mismatch',
        `lineTotal ${item.lineTotal.amount} ≠ unitPrice ${item.unitPrice.amount} × qty ${item.quantity}`,
      );
    }
    subtotalAmount += item.lineTotal.amount;
  }

  assertAmount(order.subtotal, 'subtotal');
  assertAmount(order.shippingFee, 'shippingFee');
  assertAmount(order.discountTotal, 'discountTotal');
  assertAmount(order.total, 'total');
  assertCurrency(currency, order.subtotal, 'subtotal');
  assertCurrency(currency, order.shippingFee, 'shippingFee');
  assertCurrency(currency, order.discountTotal, 'discountTotal');

  if (order.subtotal.amount !== subtotalAmount) {
    throw new OrderError(
      'subtotal_mismatch',
      `subtotal ${order.subtotal.amount} ≠ Σ lineTotal ${subtotalAmount}`,
    );
  }
  const expectedTotal =
    order.subtotal.amount + order.shippingFee.amount - order.discountTotal.amount;
  if (order.total.amount !== expectedTotal) {
    throw new OrderError(
      'total_mismatch',
      `total ${order.total.amount} ≠ subtotal + shippingFee − discountTotal = ${expectedTotal}`,
    );
  }
}
