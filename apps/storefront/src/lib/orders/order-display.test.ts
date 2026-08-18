// order-display.test.ts — 訂單顯示工具測試
//
// - orderStatusLabel:20 組 exhaustive(5 payment × 4 fulfillment 全列)逐一斷言中文(codex N1);
//   🔴 **這張表證的是「付款狀態不受出貨軸影響」,證不了「partiallyPaid 一定是收了訂金」** ——
//   它沒有那個維度(沒有『部分收款 / 付清後沖銷 / 部分退款 / 超收』這幾種來源的案例)。
//   codex 關卡2 2026-08-18 指出這一點;為什麼今天仍可以這樣寫、以及那張欠條,見 order-display.ts 的 JSDoc。
//   明確鎖 partiallyPaid→「已收訂金」(2026-08-18 Sean Q06=甲,原「付款確認中」)、refunded→「已退款」、partiallyRefunded→「已退部分」、
//   paid→(任意 fulfillment)「處理中」(A9f row47:stale 出貨軸下架、第 1 批固定文案)、絕不空字串。
// - formatOrderDate:ISO → YYYY-MM-DD(Asia/Taipei、含跨日 UTC 邊界)。

import { describe, it, expect } from 'vitest';
import type { PaymentStatus, FulfillmentStatus } from '@pcm/domain';
import { orderStatusLabel, formatOrderDate } from './order-display';

// 20 組 = 5 payment × 4 fulfillment(全列、不寫「或等價」弱化、codex N1)
// 🔴 M-3 RF2a 加 partiallyRefunded 後由 16 → 20:本檔的 toHaveLength 是**獨立硬斷言**、
//    不從型別衍生 ⇒ 漏改會轉紅(這正是要的:加 enum 值不該靜默通過)。
const STATUS_CASES: Array<[PaymentStatus, FulfillmentStatus, string]> = [
  ['refunded', 'notOrdered', '已退款'],
  ['refunded', 'ordered', '已退款'],
  ['refunded', 'inStock', '已退款'],
  ['refunded', 'shipped', '已退款'],
  ['unpaid', 'notOrdered', '待付款'],
  ['unpaid', 'ordered', '待付款'],
  ['unpaid', 'inStock', '待付款'],
  ['unpaid', 'shipped', '待付款'],
  ['partiallyPaid', 'notOrdered', '已收訂金'],
  ['partiallyPaid', 'ordered', '已收訂金'],
  ['partiallyPaid', 'inStock', '已收訂金'],
  ['partiallyPaid', 'shipped', '已收訂金'],
  ['partiallyRefunded', 'notOrdered', '已退部分'],
  ['partiallyRefunded', 'ordered', '已退部分'],
  ['partiallyRefunded', 'inStock', '已退部分'],
  ['partiallyRefunded', 'shipped', '已退部分'],
  // 🔴 A9f(E10 master plan v2 §5.1 row47):paid 一律「處理中」、不再細分 stale 出貨軸;
  //    四列仍全列(釘「任意 fulfillment 皆同值」,漏一列 = 出貨軸悄悄回來也抓得到)。
  ['paid', 'notOrdered', '處理中'],
  ['paid', 'ordered', '處理中'],
  ['paid', 'inStock', '處理中'],
  ['paid', 'shipped', '處理中'],
];

describe('orderStatusLabel(20 組 exhaustive 雙軸映射、Q2=A)', () => {
  it.each(STATUS_CASES)('payment=%s fulfillment=%s → %s', (payment, fulfillment, expected) => {
    expect(orderStatusLabel(payment, fulfillment)).toBe(expected);
  });

  it('恰 20 組(5 payment × 4 fulfillment 全覆蓋)', () => {
    expect(STATUS_CASES).toHaveLength(20);
  });

  it('關鍵狀態鎖定 + 絕不回空字串', () => {
    expect(orderStatusLabel('partiallyPaid', 'notOrdered')).toBe('已收訂金');
    expect(orderStatusLabel('refunded', 'shipped')).toBe('已退款');
    expect(orderStatusLabel('paid', 'shipped')).toBe('處理中'); // A9f:paid 不再顯出貨階段
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
