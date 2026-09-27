import { describe, expect, it } from 'vitest';
import { isPairVariant, pairNoteText, resolvePairSplit } from './pair-split';

// Ilmberger「左右一對」(2026-09-27;報價單 14 be23d433)。plan:docs/plans/2026-09-27-ilmberger-pair-shipping-note-plan.md

const L = { sku: 'CG.VFL.007.M125S', spec: { material: '碳纖', finish: '亮面', position: '左' } };
const R = { sku: 'CM.VFR.008.M125S', spec: { material: '碳纖', finish: '亮面', position: '右' } };
const P = { sku: 'ILM-VF.007.M125S-PAIR-G', spec: { material: '碳纖', finish: '亮面', position: '左右一對' } };

describe('isPairVariant', () => {
  it('position 是「左右一對」⇒ 是', () => {
    expect(isPairVariant('X', { position: '左右一對' })).toBe(true);
  });
  it('sku 以 -PAIR / -PAIR-G / -PAIR-M 結尾 ⇒ 是(spec 讀不到也算)', () => {
    expect(isPairVariant('A-PAIR', null)).toBe(true);
    expect(isPairVariant('A-PAIR-G', null)).toBe(true);
    expect(isPairVariant('A-PAIR-M', {})).toBe(true);
  });
  it('一般款、單邊款、sku 中間出現 PAIR ⇒ 不是', () => {
    expect(isPairVariant('A', { color: '黑' })).toBe(false);
    expect(isPairVariant(L.sku, L.spec)).toBe(false);
    expect(isPairVariant('PAIR-KIT-01', null)).toBe(false);
  });
});

describe('resolvePairSplit', () => {
  it('左右各恰好一個、其他規格相同 ⇒ 兩個料號', () => {
    expect(resolvePairSplit(P, [L, R, P])).toEqual({ left: L.sku, right: R.sku });
  });
  it('🔴 表面不同的兄弟不算(亮面的一對不可以拆成消光的左右)', () => {
    const Lm = { sku: 'L-M', spec: { material: '碳纖', finish: '消光', position: '左' } };
    const Rm = { sku: 'R-M', spec: { material: '碳纖', finish: '消光', position: '右' } };
    expect(resolvePairSplit(P, [Lm, Rm, L, R, P])).toEqual({ left: L.sku, right: R.sku });
  });
  it('🔴 缺一邊 ⇒ 那一邊 null(不猜)', () => {
    expect(resolvePairSplit(P, [L, P])).toEqual({ left: L.sku, right: null });
  });
  it('🔴 同一邊有兩個 ⇒ 那一邊 null(不猜)', () => {
    const L2 = { sku: 'CG.VFL.009', spec: L.spec };
    expect(resolvePairSplit(P, [L, L2, R])).toEqual({ left: null, right: R.sku });
  });
  it('兄弟款讀不到(空陣列)⇒ 兩邊都 null', () => {
    expect(resolvePairSplit(P, [])).toEqual({ left: null, right: null });
  });
});

describe('pairNoteText', () => {
  it('兩邊都有 ⇒ 印兩個料號', () => {
    expect(pairNoteText({ left: 'A', right: 'B' })).toBe('一對：出貨時請拆成左、右各一件（左 A、右 B）');
  });
  it('任一邊沒有 ⇒ 請到報價單確認, 不印半套', () => {
    expect(pairNoteText({ left: 'A', right: null })).toBe('一對：出貨時請拆成左、右各一件（料號請到報價單確認）');
    expect(pairNoteText({ left: null, right: null })).toBe('一對：出貨時請拆成左、右各一件（料號請到報價單確認）');
  });
});
