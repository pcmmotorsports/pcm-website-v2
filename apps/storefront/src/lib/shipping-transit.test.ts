// lib/shipping-transit.ts —— 備貨交期(給 Google 的 handlingTime)要與 /terms 第 7 條同一個週數區間。
// 同 ProductFAQ.test.tsx「交期字面與 /terms 第 7 條同一個週數區間」那格的做法:比數字不比分隔符;
// 改任一邊而沒改另一邊 ⇒ 紅;兩邊一起改 ⇒ 綠。
import { describe, expect, it } from 'vitest';
import { TERMS_SECTIONS } from '../data/legal-content';
import { HANDLING_WEEKS } from './shipping-transit';

describe('HANDLING_WEEKS', () => {
  it('與 /terms 第 7 條的備貨交期週數相同', () => {
    const clause = TERMS_SECTIONS.find((s) => s.heading.includes('第 7 條'))?.items?.find((i) => i.includes('週'));
    const range = clause?.match(/(\d+)\s*[–\-～~]\s*(\d+)\s*週/);
    expect(range, '第 7 條找不到「N–M 週」⇒ 條文改寫了,要重新對').toBeTruthy();
    expect([HANDLING_WEEKS.min, HANDLING_WEEKS.max]).toEqual([Number(range![1]), Number(range![2])]);
  });
});
