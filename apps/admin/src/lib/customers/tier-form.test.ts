// tier-form.test.ts — 會員等級變更純函式核心(M-4a tier 編輯片;表單→RPC 參數解析)。

import { describe, it, expect } from 'vitest';
import type { FormLike } from '../orders/workflow-form';
import {
  parseTierEditForm,
  TIER_CUSTOMER_ID_FIELD,
  TIER_VALUE_FIELD,
  TIER_NOTE_FIELD,
  TIER_RETURN_TO_FIELD,
  TIER_NOTE_MAX,
} from './tier-form';
import { TIER_VALUES } from './customer-list-view';

const UUID = '11111111-2222-3333-4444-555555555555';

function form(entries: Record<string, string>): FormLike {
  const m = new Map(Object.entries(entries));
  return { get: (k) => m.get(k) ?? null, has: (k) => m.has(k) };
}

function valid(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    [TIER_CUSTOMER_ID_FIELD]: UUID,
    [TIER_VALUE_FIELD]: 'store',
    [TIER_NOTE_FIELD]: '經銷申請審核通過',
    [TIER_RETURN_TO_FIELD]: `/customers/${UUID}`,
    ...overrides,
  };
}

describe('parseTierEditForm — 合法輸入', () => {
  it('三檔白名單全收(=domain MemberTier=DB enum 全集)', () => {
    for (const tier of TIER_VALUES) {
      const r = parseTierEditForm(form(valid({ [TIER_VALUE_FIELD]: tier })));
      expect(r.ok && r.tier).toBe(tier);
    }
  });

  it('完整結果形狀(note trim、returnTo 保留)', () => {
    const r = parseTierEditForm(form(valid({ [TIER_NOTE_FIELD]: '  經銷申請審核通過  ' })));
    expect(r).toEqual({
      ok: true,
      customerId: UUID,
      tier: 'store',
      note: '經銷申請審核通過',
      returnTo: `/customers/${UUID}`,
    });
  });
});

describe('parseTierEditForm — 拒收矩陣(ok:false)', () => {
  it('customer_id 非 UUID → 拒', () => {
    expect(parseTierEditForm(form(valid({ [TIER_CUSTOMER_ID_FIELD]: 'abc' }))).ok).toBe(false);
  });

  it('tier 非白名單(大小寫/空白變體/snake_case/空/亂值)→ 拒', () => {
    for (const bad of ['Store', 'STORE', ' store', 'store ', 'premium_store', 'PremiumStore', '', 'vip']) {
      expect(parseTierEditForm(form(valid({ [TIER_VALUE_FIELD]: bad }))).ok).toBe(false);
    }
  });

  it('原因空白(必填=Sean Q2=A)或超長 → 拒;Unicode 看似空白(NBSP/全形/冷門空白/零寬/格式字)→ 拒', () => {
    expect(parseTierEditForm(form(valid({ [TIER_NOTE_FIELD]: '   ' }))).ok).toBe(false);
    for (const bad of [
      '\u00A0\u00A0', '\u3000\u3000', '\u200B\u200B', '\uFEFF', '\u200B \u3000',
      '\u1680\u1680', '\u2000\u2000', '\u205F', // codex F2: ogham / en quad / MMSP (JS trim 吃)
      '\u200C\u200D', '\u2060', '\u180E', '\u0085', // 零寬 joiner / word joiner / mongolian / NEL (trim 不吃、regex 擋)
    ]) {
      expect(parseTierEditForm(form(valid({ [TIER_NOTE_FIELD]: bad }))).ok).toBe(false);
    }
    expect(
      parseTierEditForm(form(valid({ [TIER_NOTE_FIELD]: 'x'.repeat(TIER_NOTE_MAX + 1) }))).ok,
    ).toBe(false);
  });

  it('缺任一必要欄 → 拒', () => {
    for (const field of [TIER_CUSTOMER_ID_FIELD, TIER_VALUE_FIELD, TIER_NOTE_FIELD]) {
      const entries = valid();
      delete entries[field];
      expect(parseTierEditForm(form(entries)).ok).toBe(false);
    }
  });
});

describe('parseTierEditForm — return_to 站內守門(parseCustomersReturnTo 共用)', () => {
  it('站內 /customers 路徑照收;離站/../非 customers → 退 /customers', () => {
    const ok = parseTierEditForm(form(valid()));
    expect(ok.ok && ok.returnTo).toBe(`/customers/${UUID}`);
    for (const bad of ['https://evil.com/customers', '/customers/../api/sso/start', '/orders/123', '//evil.com']) {
      const r = parseTierEditForm(form(valid({ [TIER_RETURN_TO_FIELD]: bad })));
      expect(r.ok && r.returnTo).toBe('/customers');
    }
  });
});
