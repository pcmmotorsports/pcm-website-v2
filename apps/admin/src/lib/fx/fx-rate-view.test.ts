import { describe, expect, it } from 'vitest';
import { currentFxRates, isKnownFxCode, parseFxRateInput, type FxRateRow } from './fx-rate-view';

const row = (p: Partial<FxRateRow> & Pick<FxRateRow, 'id' | 'currency_code' | 'rate_to_twd' | 'effective_from'>): FxRateRow => ({
  created_by: 'boss', created_at: p.effective_from, ...p,
});

describe('currentFxRates:每幣別 effective_from <= now 之中最新的', () => {
  const now = new Date('2026-09-13T12:00:00Z');
  it('取最新、未來的不算、沒設過回 null、TWD 固定 1', () => {
    const out = currentFxRates(
      [
        row({ id: 1, currency_code: 'USD', rate_to_twd: '32.5', effective_from: '2026-09-01T00:00:00Z' }),
        row({ id: 2, currency_code: 'USD', rate_to_twd: '31', effective_from: '2026-09-10T00:00:00Z' }),
        row({ id: 3, currency_code: 'USD', rate_to_twd: '99', effective_from: '2026-09-14T00:00:00Z' }),
        row({ id: 4, currency_code: 'TWD', rate_to_twd: '1', effective_from: '2026-09-01T00:00:00Z' }),
      ],
      now,
    );
    const by = Object.fromEntries(out.map((c) => [c.code, c]));
    expect(by.USD?.rate).toBe('31');
    expect(by.USD?.effectiveFrom).toBe('2026-09-10T00:00:00Z');
    expect(by.EUR?.rate).toBeNull();
    expect(by.TWD).toMatchObject({ rate: '1', fixed: true });
    expect(out.map((c) => c.code)).toEqual(['EUR', 'IDR', 'GBP', 'THB', 'AUD', 'USD', 'TWD', 'JPY', 'CNY', 'SGD']);
  });
  it('定向突變:把未來列的時間改成過去 ⇒ 它才會變成現在的', () => {
    const out = currentFxRates([row({ id: 3, currency_code: 'USD', rate_to_twd: '99', effective_from: '2026-09-12T00:00:00Z' })], now);
    expect(out.find((c) => c.code === 'USD')?.rate).toBe('99');
  });
});

describe('parseFxRateInput:字串進、字串出,不做算術', () => {
  it.each([['32.5', '32.5'], [' 0.21 ', '0.21'], ['123456789.123456', '123456789.123456'], ['1', '1']])('%s ⇒ %s', (i, o) => {
    expect(parseFxRateInput(i)).toBe(o);
  });
  it.each(['', '0', '0.0', '-1', 'NaN', 'Infinity', '1e3', '1,000', '.5', '1.1234567', '1234567890', 32.5, null])('拒 %s', (i) => {
    expect(parseFxRateInput(i)).toBeNull();
  });
});

describe('isKnownFxCode', () => {
  it('清單內可改的才算;TWD 不算', () => {
    expect(isKnownFxCode('USD')).toBe(true);
    expect(isKnownFxCode('TWD')).toBe(false);
    expect(isKnownFxCode('usd')).toBe(false);
    expect(isKnownFxCode('XXX')).toBe(false);
  });
});
