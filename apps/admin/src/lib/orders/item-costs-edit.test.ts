import { describe, expect, it } from 'vitest';
import { amountEquals, buildCostSubmit, dirtyCellCount, dirtyFields, type CostDraft } from './item-costs-edit';

const draft = (current: Partial<CostDraft['current']>, baseline: Partial<CostDraft['baseline']> = {}): CostDraft => ({
  orderItemId: '11111111-2222-4333-8444-555555555555',
  orderDisplayId: 'ABC123',
  itemTitle: '油杯蓋',
  baseline: { costPrice: '10', costShipping: '0', costTax: '1.5', currency: 'EUR', ...baseline },
  current: { costPrice: '10', costShipping: '0', costTax: '1.5', currency: 'EUR', ...baseline, ...current },
});

describe('amountEquals:字面正規化後比', () => {
  it.each([['', '0'], ['0', '0.0'], ['12.50', '12.5'], [' 3 ', '3']])('%s ≡ %s', (a, b) => expect(amountEquals(a, b)).toBe(true));
  it.each([['1', '2'], ['', '1'], ['abc', 'abd']])('%s ≠ %s', (a, b) => expect(amountEquals(a, b)).toBe(false));
});

describe('dirtyFields / dirtyCellCount', () => {
  it('沒改 ⇒ 0;改三格 ⇒ 3', () => {
    expect(dirtyFields(draft({}))).toEqual([]);
    const d = draft({ costPrice: '11', costTax: '2', currency: 'USD' });
    expect(dirtyFields(d)).toEqual(['costPrice', 'costTax', 'currency']);
    expect(dirtyCellCount([d, draft({})])).toBe(3);
  });
  it('還沒設過的列(baseline 空)只填一格 ⇒ 1 格', () => {
    expect(dirtyFields(draft({ costPrice: '5' }, { costPrice: '', costShipping: '', costTax: '', currency: '' }))).toEqual(['costPrice']);
  });
});

describe('buildCostSubmit:只送改過的列,整列四值,空金額當 0', () => {
  it('沒改 ⇒ nothing', () => expect(buildCostSubmit([draft({})])).toEqual({ ok: false, reason: 'nothing' }));
  it('改一列 ⇒ 一列、四值、changed 算格數', () => {
    const r = buildCostSubmit([draft({ costPrice: '11', costShipping: '' }), draft({})]);
    expect(r).toEqual({
      ok: true,
      changed: 1,
      rows: [{ orderItemId: '11111111-2222-4333-8444-555555555555', costPrice: '11', costShipping: '0', costTax: '1.5', currency: 'EUR' }],
    });
  });
  it('🔴 幣別沒選 ⇒ no_currency,不送', () => {
    expect(buildCostSubmit([draft({ costPrice: '5' }, { costPrice: '', costShipping: '', costTax: '', currency: '' })])).toMatchObject({ ok: false, reason: 'no_currency' });
  });
  it('🔴 金額打壞 ⇒ bad_amount,不送', () => {
    expect(buildCostSubmit([draft({ costPrice: '1,000' })])).toMatchObject({ ok: false, reason: 'bad_amount' });
    expect(buildCostSubmit([draft({ costPrice: '-1' })])).toMatchObject({ ok: false, reason: 'bad_amount' });
  });
});
