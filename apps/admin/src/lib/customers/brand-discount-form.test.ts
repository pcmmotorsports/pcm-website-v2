import { describe, expect, it } from 'vitest';
import {
  DEALER_DISCOUNT_SOFT_CAP_PERCENT,
  buildDiscountChanges,
  parsePercentInput,
  priceRatioText,
} from './brand-discount-form';

describe('折扣輸入(B2B 計畫 §10.4 片 E3)', () => {
  it('空白或 0 ⇒ 不打折(null = 刪掉那一列)', () => {
    expect(parsePercentInput('')).toEqual({ ok: true, value: null });
    expect(parsePercentInput(' 0 ')).toEqual({ ok: true, value: null });
  });
  it('一位小數以內 ⇒ 數字', () => {
    expect(parsePercentInput('7.5')).toEqual({ ok: true, value: 7.5 });
    expect(parsePercentInput('5')).toEqual({ ok: true, value: 5 });
  });
  it('🔴 超過一位小數 ⇒ 提示, 不自己進位(資料庫也會拒)', () => {
    expect(parsePercentInput('7.55')).toEqual({ ok: false, error: '折扣最多到小數點後一位。' });
  });
  it('100 以上、負數、非數字 ⇒ 錯誤', () => {
    expect(parsePercentInput('100').ok).toBe(false);
    expect(parsePercentInput('-3').ok).toBe(false);
    expect(parsePercentInput('abc').ok).toBe(false);
    expect(parsePercentInput('1e1').ok).toBe(false);
  });
  it('旁邊顯示「＝經銷價的 Y%」', () => {
    expect(priceRatioText(5)).toBe('＝經銷價的 95%');
    expect(priceRatioText(7.5)).toBe('＝經銷價的 92.5%');
    expect(priceRatioText(null)).toBe('');
  });
  it('軟性上限是 20', () => {
    expect(DEALER_DISCOUNT_SOFT_CAP_PERCENT).toBe(20);
  });
});

describe('變更清單(只送真的有變的品牌)', () => {
  const current = new Map([
    ['b1', { percent: 5, below_cost_reason: '', updated_at: '2026-09-25T01:00:00.123456+00:00' }],
    ['b2', { percent: 10, below_cost_reason: '清庫存', updated_at: '2026-09-25T02:00:00+00:00' }],
  ]);
  it('新增、修改、刪除;沒變的不送;expected 帶畫面上的舊值(沒有設定的是 null)', () => {
    const r = buildDiscountChanges(current, { b1: 5, b2: 12.5, b3: 3, b4: null });
    expect(r.changes).toEqual([
      { brand_id: 'b2', percent: 12.5, below_cost_reason: '清庫存' },
      { brand_id: 'b3', percent: 3, below_cost_reason: '' },
    ]);
    expect(r.expected).toEqual({
      b2: { percent: 10, below_cost_reason: '清庫存', updated_at: '2026-09-25T02:00:00+00:00' },
      b3: null,
    });
  });
  it('清成 null ⇒ 刪除', () => {
    const r = buildDiscountChanges(current, { b1: null });
    expect(r.changes).toEqual([{ brand_id: 'b1', percent: null, below_cost_reason: '' }]);
  });
  it('超過軟性上限的品牌列出來(要多勾一次確認)', () => {
    const r = buildDiscountChanges(current, { b1: 25, b2: 20 });
    expect(r.overCap).toEqual(['b1']);
  });
});
