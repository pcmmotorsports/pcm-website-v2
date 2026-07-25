/**
 * @module @pcm/domain/order/state-machine — 訂單雙軸狀態機(付款 × 出貨)
 *
 * 對齊 plan v6 §3.1 雙軸 + handoff §4 步驟 3:
 * - 付款軸:Phase 1 主路徑 `unpaid → paid`;`partiallyPaid` / `refunded` 留型別(轉移保守、**不亂跳**)。
 * - 出貨軸:`notOrdered → ordered → inStock → shipped` 逐級線性、**禁跳級 / 倒退**。
 *
 * 非法轉移(跳級 / 倒退 / 自我轉移 / terminal 後再動)一律 `throw OrderError`。
 * 自我轉移(同狀態→同狀態)視為非法:domain 守「狀態必前進」、冪等重放由上層 use-case 先查現況處理
 * (plan §3.1 confirm RPC 的 idempotent 在 DB 層、非 domain 層)。
 *
 * @see packages/domain/src/order/types.ts:PaymentStatus / FulfillmentStatus
 */

import type { Order, PaymentStatus, FulfillmentStatus } from './types';
import { OrderError } from './errors';

/**
 * 付款軸合法轉移表(出發狀態 → 允許的目的狀態集)。
 *
 * Phase 1 只實際走 `unpaid → paid`(TapPay 一次性全額 charge 確認);其餘為「留型別」的保守
 * 前向邊(partial capture / 退款),構成一致的付款生命週期 DAG、避免亂跳:
 * - `unpaid` → `paid`(主路徑)/ `partiallyPaid`(部分入帳、保留)
 * - `partiallyPaid` → `paid`(補足)/ `refunded`(退剩餘、保留)
 * - `paid` → `partiallyPaid`(部分入帳更正、保留)/ `refunded`(全額退款)/ `partiallyRefunded`(部分退款,M-3 RF2a)
 * - `partiallyRefunded` → `partiallyRefunded`(🔴 **自我轉移**,見下)/ `refunded`(退到剩餘為 0)
 * - `refunded` → ∅(終態)
 *
 * 隱含非法(throw):任何 `→ unpaid`(不可回退未付)、`unpaid → refunded`(未付不可退)、
 * `refunded → *`(終態)、自我轉移 —— **唯一例外 = `partiallyRefunded → partiallyRefunded`**。
 *
 * 🔴 該例外的理由(Sean 2026-07-25 Q1=A、M-3 RF2a):PRD §0 邊界①拍板支援「多次連續部分退,
 * 每次以退款當下剩餘餘額重算運費」。第二次部分退時 from 與 to 都是 `partiallyRefunded`,
 * 若不開自我轉移則合法業務流程會被 `assertPaymentTransition` 擋掉。
 * 替代案(先回 `paid` 再轉)已被否決:會在稽核留下「退款後客人又付款」的假象。
 * ⚠️ 例外**僅限此值**;其餘 4 值仍不得自我轉移(靠本表不列自己達成,見同檔測試的負向斷言)。
 */
const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  unpaid: ['paid', 'partiallyPaid'],
  partiallyPaid: ['paid', 'refunded'],
  paid: ['partiallyPaid', 'refunded', 'partiallyRefunded'],
  partiallyRefunded: ['partiallyRefunded', 'refunded'],
  refunded: [],
};

/**
 * 出貨軸合法轉移表:逐級線性、禁跳級 / 倒退 / 自我轉移。
 * `notOrdered → ordered → inStock → shipped`,`shipped` 為終態。
 */
const FULFILLMENT_TRANSITIONS: Record<FulfillmentStatus, readonly FulfillmentStatus[]> = {
  notOrdered: ['ordered'],
  ordered: ['inStock'],
  inStock: ['shipped'],
  shipped: [],
};

/** 付款軸:from → to 是否合法(不 throw)。 */
export function canPaymentTransition(
  from: PaymentStatus,
  to: PaymentStatus,
): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}

/** 出貨軸:from → to 是否合法(不 throw)。 */
export function canFulfillmentTransition(
  from: FulfillmentStatus,
  to: FulfillmentStatus,
): boolean {
  return FULFILLMENT_TRANSITIONS[from].includes(to);
}

/**
 * assertPaymentTransition:付款軸非法轉移 throw。
 * @throws OrderError code `illegal_payment_transition`
 */
export function assertPaymentTransition(
  from: PaymentStatus,
  to: PaymentStatus,
): void {
  if (!canPaymentTransition(from, to)) {
    throw new OrderError(
      'illegal_payment_transition',
      `payment transition ${from} → ${to} not allowed`,
    );
  }
}

/**
 * assertFulfillmentTransition:出貨軸非法轉移 throw。
 * @throws OrderError code `illegal_fulfillment_transition`
 */
export function assertFulfillmentTransition(
  from: FulfillmentStatus,
  to: FulfillmentStatus,
): void {
  if (!canFulfillmentTransition(from, to)) {
    throw new OrderError(
      'illegal_fulfillment_transition',
      `fulfillment transition ${from} → ${to} not allowed`,
    );
  }
}

/**
 * withPaymentStatus:驗證付款軸轉移後回**新** Order(immutable、不改原物件)。
 *
 * 對齊 catalog/pricing.ts pure-function 慣例(domain 不在 entity 上掛 mutating method)。
 * @throws OrderError code `illegal_payment_transition`
 */
export function withPaymentStatus(order: Order, to: PaymentStatus): Order {
  assertPaymentTransition(order.paymentStatus, to);
  return { ...order, paymentStatus: to };
}

/**
 * withFulfillmentStatus:驗證出貨軸轉移後回**新** Order(immutable)。
 * @throws OrderError code `illegal_fulfillment_transition`
 */
export function withFulfillmentStatus(
  order: Order,
  to: FulfillmentStatus,
): Order {
  assertFulfillmentTransition(order.fulfillmentStatus, to);
  return { ...order, fulfillmentStatus: to };
}
