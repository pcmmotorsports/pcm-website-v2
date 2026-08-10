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
  TIER_SINGLE_FIELDS,
} from './tier-form';
import { TIER_VALUES } from './customer-list-view';

const UUID = '11111111-2222-3333-4444-555555555555';

function form(entries: Record<string, string>): FormLike {
  const m = new Map(Object.entries(entries));
  // #365:單值讀法改走 getAll 恰一筆 ⇒ 假表單補這一支(單值情境回 0 或 1 筆)。
  return {
    get: (k) => m.get(k) ?? null,
    has: (k) => m.has(k),
    getAll: (k) => (m.has(k) ? [m.get(k) as string] : []),
  };
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

describe('#365 同名欄位送兩份 → 被拒(不採第一筆)', () => {
  // 🔴 用**真 FormData**:假表單的 getAll 是測試自己寫的,拿它證「重複欄位被擋」等於自己證自己。
  function realForm(pairs: [string, string][]): FormData {
    const f = new FormData();
    for (const [k, v] of pairs) f.append(k, v);
    return f;
  }

  const FIRST_TIER = TIER_VALUES[0] as string;
  const LAST_TIER = TIER_VALUES[TIER_VALUES.length - 1] as string;

  it('🔴 tier 送兩份 → ok:false(等級由送出者挑 = 會員等級自選)', () => {
    const f = realForm([
      [TIER_CUSTOMER_ID_FIELD, UUID],
      [TIER_VALUE_FIELD, FIRST_TIER],
      [TIER_VALUE_FIELD, LAST_TIER],
      [TIER_NOTE_FIELD, '測試'],
    ]);
    expect(parseTierEditForm(f).ok).toBe(false);
    // 釘住「行為真的變了」:同一份 FormData 上,舊寫法拿到的是第一筆。
    expect(f.get(TIER_VALUE_FIELD)).toBe(FIRST_TIER);
  });

  it('單筆 tier 仍照常通過(擋的是「兩份」不是整條路)', () => {
    const f = realForm([
      [TIER_CUSTOMER_ID_FIELD, UUID],
      [TIER_VALUE_FIELD, FIRST_TIER],
      [TIER_NOTE_FIELD, '測試'],
    ]);
    expect(parseTierEditForm(f).ok).toBe(true);
  });
});

describe('#365 逐欄「送兩份 → 被拒」(同時是 TIER_SINGLE_FIELDS 完整性的守門)', () => {
  function dup(base: [string, string][], field: string): FormData {
    const f = new FormData();
    for (const [k, v] of base) f.append(k, v);
    // 保證真的兩筆:base 沒有的欄位也補到兩筆(只 append 一次 = 送一份,測不到重複)。
    const existing = f.getAll(field);
    const value = (existing[0] as string | undefined) ?? 'x1';
    if (existing.length === 0) f.append(field, value);
    f.append(field, value);
    return f;
  }
  const BASE: [string, string][] = [
    [TIER_CUSTOMER_ID_FIELD, UUID],
    [TIER_VALUE_FIELD, TIER_VALUES[0] as string],
    [TIER_NOTE_FIELD, '測試'],
  ];

  it.each([...TIER_SINGLE_FIELDS])('%s 送兩份 → ok:false', (field) => {
    expect(parseTierEditForm(dup(BASE, field)).ok).toBe(false);
  });
  // 🔴 codex 關卡2 MF:上面那條走訪的是常數本身 ⇒ 清單少一欄時測項也少一條、全綠(循環論證)。
  //    真正的完整性守門 = 拿**測試檔自己手寫的**清單比對;來源檔漏欄或多欄,這一條就紅。
  it('🔴 TIER_SINGLE_FIELDS 逐字等於四欄(手寫對照)', () => {
    expect([...TIER_SINGLE_FIELDS].sort()).toEqual(
      ['customer_id', 'tier', 'note', 'return_to'].sort(),
    );
  });
});
