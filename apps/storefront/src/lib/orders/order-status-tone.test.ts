// order-status-tone.test.ts — `orderStatusTone` 的逐組合守門。
//
// 🔴 **這支檔為什麼存在**:`order-display.ts` 的註解一度寫著「而 `order-status-tone.test.ts`
//    逐組合斷言它們配對正確」——**而那支檔當時不存在**(codex 對抗審查 nit,2026-08-29 抓到)。
//    ⇒ 修法不是把那句話刪掉,是**把它變成真的**:一句指向不存在檔案的註解,
//      會讓下一個人以為這裡有守門而不去補。
//
// 守什麼:tone 是 `#249` 的**顏色那一半**。字那半(`orderStatusLabel`)全綠時,
// 顏色那半照樣可以壞 —— 而壞掉的樣子是:一張已取消的單染上熔橘(全站叫人動作的顏色)。

import { describe, it, expect } from 'vitest';
import type { PaymentStatus, FulfillmentStatus, OrderCancelKind } from '@pcm/domain';
import { orderStatusLabel, orderStatusTone } from './order-display';

const PAYMENTS: PaymentStatus[] = [
  'unpaid',
  'partiallyPaid',
  'paid',
  'partiallyRefunded',
  'refunded',
];
const CANCELS: OrderCancelKind[] = ['none', 'cancelled', 'expired'];
const FULFILLMENT: FulfillmentStatus = 'notOrdered';

describe('orderStatusTone 逐組合', () => {
  it('前提:兩個維度都不是空的(空掉的話下面的迴圈跑 0 次而恆綠)', () => {
    expect(PAYMENTS.length, 'PAYMENTS 是空的 ⇒ 下面整段恆綠').toBe(5);
    expect(CANCELS.length, 'CANCELS 是空的 ⇒ 取消軸那半沒有被走過').toBe(3);
  });

  // 🔴🔴 這一片真正在守錢的那一格。
  it('🔴 任何已取消 / 已逾期的組合 ⇒ tone 一律 done,絕不 action', () => {
    for (const p of PAYMENTS) {
      for (const c of ['cancelled', 'expired'] as const) {
        const tone = orderStatusTone(p, FULFILLMENT, c);
        expect(
          tone,
          `payment=${p} cancel=${c} ⇒ tone=${tone}。` +
            `action 是熔橘(全站叫人動作的顏色)⇒ 用顏色叫客人去付一張作廢的單,` +
            `而那正是 #249 要防的那件事。`,
        ).toBe('done');
      }
    }
  });

  // 正對照:沒有這一格的話,一個「永遠回 done」的實作會讓上面那格全綠。
  it('正對照:未取消的 unpaid / partiallyPaid ⇒ action(⇒ 上面那格不是恆真)', () => {
    expect(orderStatusTone('unpaid', FULFILLMENT, 'none')).toBe('action');
    // 🔴 partiallyPaid = 已收訂金 = 他【還欠錢】⇒ 與 unpaid 同一檔。
    //    (codex must-fix:我第一版寫 progress,而明細頁那份寫 action ⇒ 同一張單兩種顏色。
    //     修法是刪掉明細頁那份、共用這一支,不是把兩份對齊。)
    expect(orderStatusTone('partiallyPaid', FULFILLMENT, 'none')).toBe('action');
  });

  it('未取消的 paid ⇒ progress;退款類 ⇒ done', () => {
    expect(orderStatusTone('paid', FULFILLMENT, 'none')).toBe('progress');
    expect(orderStatusTone('refunded', FULFILLMENT, 'none')).toBe('done');
    expect(orderStatusTone('partiallyRefunded', FULFILLMENT, 'none')).toBe('done');
  });

  // 🔴 label 與 tone 吃同一組輸入,而它們是兩個獨立的 switch ⇒ 會漂移。
  //    這一格把「配對」本身釘住:字說已取消/已逾期的,顏色一定是 done。
  it('🔴 label 與 tone 不得漂移:字面是已取消/已逾期 ⇔ tone 是 done', () => {
    let sawCancelledLabel = 0;
    for (const p of PAYMENTS) {
      for (const c of CANCELS) {
        const label = orderStatusLabel(p, FULFILLMENT, c);
        const tone = orderStatusTone(p, FULFILLMENT, c);
        if (label === '已取消' || label === '已逾期') {
          sawCancelledLabel += 1;
          expect(tone, `label=${label} 而 tone=${tone} ⇒ 字與顏色講不同的話`).toBe('done');
        }
      }
    }
    // 分母守門:一個字面都沒撞到 ⇒ 上面那個 if 從沒進去過 ⇒ 這一格恆綠。
    expect(sawCancelledLabel, '沒有任何組合產生已取消/已逾期 ⇒ 本格恆綠').toBe(10);
  });

  // 🔴 tone 的值域是封閉的三檔 —— 多一個值,CSS 那邊就沒有對應規則而徽章會裸奔。
  it('tone 的值域恰好是 action / progress / done 三個', () => {
    const seen = new Set<string>();
    for (const p of PAYMENTS) for (const c of CANCELS) seen.add(orderStatusTone(p, FULFILLMENT, c));
    expect([...seen].sort()).toEqual(['action', 'done', 'progress']);
  });
});
