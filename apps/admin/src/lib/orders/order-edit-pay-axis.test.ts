// order-edit-pay-axis.test.ts — 改單矩陣的三值收款軸(M-4b E10 #13 片1c-1;母 plan §4)。

import { describe, it, expect } from 'vitest';
import type { AdminOrderSummary, PaymentStatus } from '@pcm/domain';
import { orderEditPayAxis } from './order-edit-pay-axis';
import { orderPayAxis } from './order-status-axes';

const ALL_PAYMENT_STATUSES: PaymentStatus[] = [
  'paid',
  'unpaid',
  'partiallyPaid',
  'refunded',
  'partiallyRefunded',
];

/** `orderPayAxis` 只讀 `paymentStatus` 一欄;其餘欄位與本測無關。 */
function summary(paymentStatus: PaymentStatus): AdminOrderSummary {
  return { paymentStatus } as unknown as AdminOrderSummary;
}

describe('orderEditPayAxis — 五態 ⇒ 三值', () => {
  it('paid / partiallyPaid / unpaid 各自對映', () => {
    expect(orderEditPayAxis('paid')).toBe('paid');
    expect(orderEditPayAxis('partiallyPaid')).toBe('partiallyPaid');
    expect(orderEditPayAxis('unpaid')).toBe('unpaid');
  });

  it('🔴 refunded / partiallyRefunded ⇒ paid(退款只發生在收過錢的單上)', () => {
    // 判成 unpaid 會讓改單矩陣以為「還沒收錢、隨便改」—— 方向剛好是最危險的那邊。
    expect(orderEditPayAxis('refunded')).toBe('paid');
    expect(orderEditPayAxis('partiallyRefunded')).toBe('paid');
  });

  it('五個 payment_status 都有明確答案,且值域恰為三值', () => {
    const got = ALL_PAYMENT_STATUSES.map(orderEditPayAxis);
    expect(got).toHaveLength(5);
    expect(new Set(got)).toEqual(new Set(['paid', 'partiallyPaid', 'unpaid']));
  });
});

describe('🔴 兩支收款軸的關係(母 plan §4 指定的那一格)', () => {
  // 母 plan 逐字:「兩支並存就是下一次漂移的來源,而『並存』本身沒有守門。」
  // ⇒ 這一格守的是**對應關係**,不是兩支各自對(那各有自己的格)。
  it('本函式回 partiallyPaid 時,orderPayAxis 必回 unpaid', () => {
    const partial = ALL_PAYMENT_STATUSES.filter((s) => orderEditPayAxis(s) === 'partiallyPaid');
    // 🔴 先斷言母體非空 —— 空集合下面那個 every 會恆真(空的 every 是 true)。
    expect(partial).toEqual(['partiallyPaid']);
    for (const s of partial) {
      expect(orderPayAxis(summary(s))).toBe('unpaid');
    }
  });

  it('本函式回 paid 的那幾態裡,orderPayAxis 只有 paid 那一態同意', () => {
    // ⚠️ 這一格記錄的是**兩支刻意不同**的地方,不是 bug:
    //    `orderPayAxis` 把 refunded / partiallyRefunded 判成 unpaid(它的註解自己寫著
    //    「refunded 從 orderStatusView 就早退了、根本走不到這裡」⇒ 那個 unpaid 不是一個關於這張單的判斷)。
    //    改單軸不能沿用那個值,所以兩支必然不同 —— 釘住它,免得有人「順手統一」。
    const editPaid = ALL_PAYMENT_STATUSES.filter((s) => orderEditPayAxis(s) === 'paid');
    expect(editPaid.sort()).toEqual(['paid', 'partiallyRefunded', 'refunded'].sort());
    expect(editPaid.filter((s) => orderPayAxis(summary(s)) === 'paid')).toEqual(['paid']);
  });
});
