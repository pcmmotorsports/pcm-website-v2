// wallet-form.test.ts — 儲值金調整純函式核心(M-4a 儲值金編輯片;表單→RPC 參數解析)。

import { describe, it, expect } from 'vitest';
import type { FormLike } from '../orders/workflow-form';
import {
  parseWalletAdjustForm,
  WALLET_CUSTOMER_ID_FIELD,
  WALLET_DIRECTION_FIELD,
  WALLET_AMOUNT_FIELD,
  WALLET_NOTE_FIELD,
  WALLET_RETURN_TO_FIELD,
  WALLET_AMOUNT_MAX,
  WALLET_NOTE_MAX,
} from './wallet-form';

const UUID = '11111111-2222-3333-4444-555555555555';

function form(entries: Record<string, string>): FormLike {
  const m = new Map(Object.entries(entries));
  return { get: (k) => m.get(k) ?? null, has: (k) => m.has(k) };
}

function valid(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    [WALLET_CUSTOMER_ID_FIELD]: UUID,
    [WALLET_DIRECTION_FIELD]: 'deposit',
    [WALLET_AMOUNT_FIELD]: '500',
    [WALLET_NOTE_FIELD]: '門市儲值',
    [WALLET_RETURN_TO_FIELD]: `/customers/${UUID}`,
    ...overrides,
  };
}

describe('parseWalletAdjustForm — 合法輸入', () => {
  it('加值:direction=deposit → signedAmount 為正', () => {
    const r = parseWalletAdjustForm(form(valid()));
    expect(r).toEqual({
      ok: true,
      customerId: UUID,
      entryType: 'deposit',
      signedAmount: 500,
      note: '門市儲值',
      returnTo: `/customers/${UUID}`,
    });
  });

  it('扣款:direction=use → signedAmount 轉負(UI 恆收正整數、server 轉號)', () => {
    const r = parseWalletAdjustForm(form(valid({ [WALLET_DIRECTION_FIELD]: 'use' })));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.entryType).toBe('use');
      expect(r.signedAmount).toBe(-500);
    }
  });

  it('金額邊界:1 與上限 10,000,000 皆收', () => {
    expect(parseWalletAdjustForm(form(valid({ [WALLET_AMOUNT_FIELD]: '1' }))).ok).toBe(true);
    const r = parseWalletAdjustForm(
      form(valid({ [WALLET_AMOUNT_FIELD]: String(WALLET_AMOUNT_MAX) })),
    );
    expect(r.ok).toBe(true);
  });

  it('備註 trim 後保留內文', () => {
    const r = parseWalletAdjustForm(form(valid({ [WALLET_NOTE_FIELD]: '  電話訂單折抵  ' })));
    expect(r.ok && r.note).toBe('電話訂單折抵');
  });
});

describe('parseWalletAdjustForm — 拒收矩陣(ok:false)', () => {
  it('customer_id 非 UUID → 拒', () => {
    expect(parseWalletAdjustForm(form(valid({ [WALLET_CUSTOMER_ID_FIELD]: 'abc' }))).ok).toBe(false);
  });

  it('direction 非 deposit/use(refund 無 UI 路徑、手工 POST 拒)→ 拒', () => {
    for (const bad of ['refund', 'DEPOSIT', '', 'withdraw']) {
      expect(parseWalletAdjustForm(form(valid({ [WALLET_DIRECTION_FIELD]: bad }))).ok).toBe(false);
    }
  });

  it('金額非正整數(0/負號/小數/千分位/前導加號/空/超上限)→ 拒', () => {
    for (const bad of ['0', '-500', '5.5', '1,000', '+500', '', '10000001', '99999999']) {
      expect(parseWalletAdjustForm(form(valid({ [WALLET_AMOUNT_FIELD]: bad }))).ok).toBe(false);
    }
  });

  it('備註空白(必填=Sean Q1)或超長 → 拒;Unicode 看似空白(NBSP/全形/零寬)→ 拒', () => {
    expect(parseWalletAdjustForm(form(valid({ [WALLET_NOTE_FIELD]: '   ' }))).ok).toBe(false);
    for (const bad of ['\u00A0\u00A0', '\u3000\u3000', '\u200B\u200B', '\uFEFF', '\u200B \u3000']) {
      expect(parseWalletAdjustForm(form(valid({ [WALLET_NOTE_FIELD]: bad }))).ok).toBe(false);
    }
    expect(
      parseWalletAdjustForm(form(valid({ [WALLET_NOTE_FIELD]: 'x'.repeat(WALLET_NOTE_MAX + 1) })))
        .ok,
    ).toBe(false);
  });

  it('缺任一必要欄 → 拒', () => {
    for (const field of [
      WALLET_CUSTOMER_ID_FIELD,
      WALLET_DIRECTION_FIELD,
      WALLET_AMOUNT_FIELD,
      WALLET_NOTE_FIELD,
    ]) {
      const entries = valid();
      delete entries[field];
      expect(parseWalletAdjustForm(form(entries)).ok).toBe(false);
    }
  });
});

describe('parseWalletAdjustForm — return_to 站內守門', () => {
  it('站內 /customers 路徑照收;離站/../非 customers → 退 /customers', () => {
    const ok = parseWalletAdjustForm(form(valid()));
    expect(ok.ok && ok.returnTo).toBe(`/customers/${UUID}`);
    for (const bad of [
      'https://evil.com/customers',
      `/customers/../api/sso/start`,
      '/orders/123',
      '//evil.com',
    ]) {
      const r = parseWalletAdjustForm(form(valid({ [WALLET_RETURN_TO_FIELD]: bad })));
      expect(r.ok && r.returnTo).toBe('/customers');
    }
  });
});
