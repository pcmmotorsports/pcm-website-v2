// order-display.test.ts — 訂單顯示工具測試
//
// - orderStatusLabel:16 組 exhaustive(4 payment × 4 fulfillment 全列)逐一斷言中文(codex N1);
//   明確鎖 partiallyPaid→「付款確認中」、refunded→「已退款」、paid+shipped→「商品寄出」、絕不空字串。
// - formatOrderDate:ISO → YYYY-MM-DD(Asia/Taipei、含跨日 UTC 邊界)。

import { describe, it, expect } from 'vitest';
import type { PaymentStatus, FulfillmentStatus } from '@pcm/domain';
import { orderStatusLabel, formatOrderDate } from './order-display';

// 16 組 = 4 payment × 4 fulfillment(全列、不寫「或等價」弱化、codex N1)
const STATUS_CASES: Array<[PaymentStatus, FulfillmentStatus, string]> = [
  ['refunded', 'notOrdered', '已退款'],
  ['refunded', 'ordered', '已退款'],
  ['refunded', 'inStock', '已退款'],
  ['refunded', 'shipped', '已退款'],
  ['unpaid', 'notOrdered', '待付款'],
  ['unpaid', 'ordered', '待付款'],
  ['unpaid', 'inStock', '待付款'],
  ['unpaid', 'shipped', '待付款'],
  ['partiallyPaid', 'notOrdered', '付款確認中'],
  ['partiallyPaid', 'ordered', '付款確認中'],
  ['partiallyPaid', 'inStock', '付款確認中'],
  ['partiallyPaid', 'shipped', '付款確認中'],
  ['paid', 'notOrdered', '已付款 訂單處理中'],
  ['paid', 'ordered', '訂單處理中'],
  ['paid', 'inStock', '備貨完成‧待出貨'],
  ['paid', 'shipped', '商品寄出'],
];

describe('orderStatusLabel(16 組 exhaustive 雙軸映射、Q2=A)', () => {
  it.each(STATUS_CASES)('payment=%s fulfillment=%s → %s', (payment, fulfillment, expected) => {
    expect(orderStatusLabel(payment, fulfillment)).toBe(expected);
  });

  it('恰 16 組(4 payment × 4 fulfillment 全覆蓋)', () => {
    expect(STATUS_CASES).toHaveLength(16);
  });

  it('關鍵狀態鎖定 + 絕不回空字串', () => {
    expect(orderStatusLabel('partiallyPaid', 'notOrdered')).toBe('付款確認中');
    expect(orderStatusLabel('refunded', 'shipped')).toBe('已退款');
    expect(orderStatusLabel('paid', 'shipped')).toBe('商品寄出');
    for (const [payment, fulfillment] of STATUS_CASES) {
      expect(orderStatusLabel(payment, fulfillment)).not.toBe('');
    }
  });
});

describe('formatOrderDate(ISO → YYYY-MM-DD、Asia/Taipei)', () => {
  it('同日:UTC 10:00 + 8h = 同日 18:00 台灣', () => {
    expect(formatOrderDate('2099-04-15T10:00:00Z')).toBe('2099-04-15');
  });

  it('跨日:UTC 16:30 + 8h = 隔日 00:30 台灣 → 進位隔日(非退前一日 off-by-one)', () => {
    expect(formatOrderDate('2099-04-15T16:30:00Z')).toBe('2099-04-16');
  });

  it('午夜邊界:UTC 00:00 + 8h = 同日 08:00 台灣', () => {
    expect(formatOrderDate('2099-04-15T00:00:00Z')).toBe('2099-04-15');
  });
});
