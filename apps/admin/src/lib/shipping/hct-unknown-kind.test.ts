import { describe, expect, it } from 'vitest';

import { classifyHctUnknown } from './hct-unknown-kind';

/**
 * ⟦ship-UNKNOWNTYPEUNREAD⟧ —— 兩型的判別。
 *
 * 🔴 **每一格都要問得出「哪個世界會紅」** ——
 *    這支的證人在下面那個 describe:把判別退回「只看 placeholder 在不在」,
 *    ⇒ **乙型那三格必紅**(因為乙型的 raw 裡 placeholder 照樣在)。
 */
describe('classifyHctUnknown', () => {
  const raw = (flowReason: string) => ({ placeholder: true, unknownReason: { flowReason } });

  // ── 乙型:新竹確定回過話 ⇒ 🛑 不准給重設出口 ──
  it.each(['soap_fault', 'epino_mismatch', 'row_count_3', 'unrecognised_success_X', 'unrecognised_query_'])(
    '🅱 %s ⇒ carrier-replied',
    (r) => {
      expect(classifyHctUnknown(raw(r))).toBe('carrier-replied');
    },
  );

  // ── 甲型(保守側):證不到新竹收到 ⇒ 維持今天的行為 ──
  it.each(['network: TimeoutError', 'http_502', 'body_read: AbortError', 'body_not_soap_json'])(
    '🅰 %s ⇒ placeholder-no-reply(保守側)',
    (r) => {
      expect(classifyHctUnknown(raw(r))).toBe('placeholder-no-reply');
    },
  );

  it('🔴 沒見過的新 reason ⇒ 落甲型 —— 白名單的方向就是為了這一格', () => {
    expect(classifyHctUnknown(raw('zzqBrandNewReasonNobodyHasSeen'))).toBe('placeholder-no-reply');
  });

  it.each([
    ['整包是 null', null],
    ['整包是陣列', ['soap_fault']],
    ['沒有 unknownReason', { placeholder: true }],
    ['unknownReason 是陣列', { unknownReason: ['soap_fault'] }],
    ['flowReason 不是字串', { unknownReason: { flowReason: 42 } }],
    ['flowReason 是空字串', { unknownReason: { flowReason: '' } }],
    ['🔴 攤在頂層(不是窄門寫的兩層)', { flowReason: 'soap_fault' }],
  ])('🛑 挖不到原因(%s)⇒ 落甲型', (_name, v) => {
    expect(classifyHctUnknown(v)).toBe('placeholder-no-reply');
  });
});
