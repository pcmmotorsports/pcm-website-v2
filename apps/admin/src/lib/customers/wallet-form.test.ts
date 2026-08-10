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
  WALLET_SINGLE_FIELDS,
} from './wallet-form';

const UUID = '11111111-2222-3333-4444-555555555555';

// #365 片②:假表單整個拿掉,改用**真 FormData** —— `FormLike` 已收窄成只有 `getAll()`
// (`get()` / `has()` 分不出「送一份」與「送兩份」,型別上就不再提供),而手寫的假表單
// 正是「單值情境永遠只回一筆」那種讓重複欄位測不出來的形狀。
function form(entries: Record<string, string>): FormLike {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) data.set(name, value);
  return data;
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

describe('#365 同名欄位送兩份 → 被拒(不採第一筆)', () => {
  // 🔴 用**真 FormData**:假表單的 getAll 是測試自己寫的,拿它證「重複欄位被擋」等於自己證自己。
  function realForm(pairs: [string, string][]): FormData {
    const f = new FormData();
    for (const [k, v] of pairs) f.append(k, v);
    return f;
  }
  const base: [string, string][] = [
    [WALLET_CUSTOMER_ID_FIELD, UUID],
    [WALLET_DIRECTION_FIELD, 'deposit'],
    [WALLET_NOTE_FIELD, '測試'],
  ];

  it('🔴 金額送兩份 → ok:false(舊寫法會採第一筆 100、真正生效的可能是 999999)', () => {
    const f = realForm([...base, [WALLET_AMOUNT_FIELD, '100'], [WALLET_AMOUNT_FIELD, '999999']]);
    expect(parseWalletAdjustForm(f).ok).toBe(false);
    // 釘住「行為真的變了」:同一份 FormData 上,舊寫法拿到的是第一筆。
    expect(f.get(WALLET_AMOUNT_FIELD)).toBe('100');
  });

  it('🔴 順序互換仍 ok:false(不是只擋住某一種排法)', () => {
    const f = realForm([...base, [WALLET_AMOUNT_FIELD, '999999'], [WALLET_AMOUNT_FIELD, '100']]);
    expect(parseWalletAdjustForm(f).ok).toBe(false);
  });

  it('單筆金額仍照常通過(證明擋的是「兩份」而不是把整條路擋死)', () => {
    expect(parseWalletAdjustForm(realForm([...base, [WALLET_AMOUNT_FIELD, '100']])).ok).toBe(true);
  });

  it('🔴 direction 送兩份 → ok:false(deposit/use 由送出者挑 = 加值變扣款)', () => {
    const f = realForm([
      [WALLET_CUSTOMER_ID_FIELD, UUID],
      [WALLET_DIRECTION_FIELD, 'deposit'],
      [WALLET_DIRECTION_FIELD, 'use'],
      [WALLET_AMOUNT_FIELD, '100'],
      [WALLET_NOTE_FIELD, '測試'],
    ]);
    expect(parseWalletAdjustForm(f).ok).toBe(false);
  });
});

describe('#365 逐欄「送兩份 → 被拒」(同時是 WALLET_SINGLE_FIELDS 完整性的守門)', () => {
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
    [WALLET_CUSTOMER_ID_FIELD, UUID],
    [WALLET_DIRECTION_FIELD, 'deposit'],
    [WALLET_AMOUNT_FIELD, '100'],
    [WALLET_NOTE_FIELD, '測試'],
  ];

  it.each([...WALLET_SINGLE_FIELDS])('%s 送兩份 → ok:false', (field) => {
    expect(parseWalletAdjustForm(dup(BASE, field)).ok).toBe(false);
  });
  // 🔴 codex 關卡2 MF:上面那條走訪的是常數本身 ⇒ 清單少一欄時測項也少一條、全綠(循環論證)。
  //    真正的完整性守門 = 拿**測試檔自己手寫的**清單比對;來源檔漏欄或多欄,這一條就紅。
  it('🔴 WALLET_SINGLE_FIELDS 逐字等於五欄(手寫對照)', () => {
    expect([...WALLET_SINGLE_FIELDS].sort()).toEqual(
      ['customer_id', 'direction', 'amount', 'note', 'return_to'].sort(),
    );
  });

  it('🔴 金額是單一 File → ok:false(型別不是字串也要擋)', () => {
    const f = new FormData();
    for (const [k, v] of BASE) if (k !== WALLET_AMOUNT_FIELD) f.append(k, v);
    f.append(WALLET_AMOUNT_FIELD, new File(['100'], 'a.txt'));
    expect(parseWalletAdjustForm(f).ok).toBe(false);
  });
});
