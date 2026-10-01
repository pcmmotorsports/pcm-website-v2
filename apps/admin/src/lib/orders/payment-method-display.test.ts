import { describe, expect, it } from 'vitest';
import { paymentMethodDisplayLabel } from './order-list-view';

// 報價單Q1 2026-10-01:店內刷卡與蝦皮都走 cash 那條路, 畫面不能印成「現金」。
describe('paymentMethodDisplayLabel', () => {
  it('有付款標記 ⇒ 用標記(刷卡 / 蝦皮), 不印現金', () => {
    expect(paymentMethodDisplayLabel('cash', 'card_terminal')).toBe('刷卡');
    expect(paymentMethodDisplayLabel('cash', 'shopee')).toBe('蝦皮');
  });
  it('沒有標記(NULL 或沒帶)⇒ 照付款管道', () => {
    expect(paymentMethodDisplayLabel('cash', null)).toBe('現金');
    expect(paymentMethodDisplayLabel('cash')).toBe('現金');
    expect(paymentMethodDisplayLabel('tappay', null)).toBe('線上刷卡');
    expect(paymentMethodDisplayLabel('bank_transfer')).toBe('銀行轉帳');
  });
});
