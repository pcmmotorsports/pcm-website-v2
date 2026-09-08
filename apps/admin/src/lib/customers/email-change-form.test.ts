import { describe, expect, it } from 'vitest';
import type { FormLike } from '../orders/workflow-form';
import {
  EMAIL_CHANGE_CUSTOMER_ID_FIELD,
  EMAIL_CHANGE_EMAIL_FIELD,
  EMAIL_CHANGE_RETURN_TO_FIELD,
  EMAIL_CHANGE_SINGLE_FIELDS,
  parseEmailChangeForm,
} from './email-change-form';

const UUID = '11111111-2222-4333-8444-555555555555';

// 真 FormData(不是自製假物件):自製物件的 getAll 常被寫成「單值情境永遠只回一筆」,
// 那正是讓重複欄位測不出來的形狀(理由逐字見 `tier-form.test.ts` 檔頭)。
function form(entries: Record<string, string>): FormLike {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) data.set(name, value);
  return data;
}

function valid(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    [EMAIL_CHANGE_CUSTOMER_ID_FIELD]: UUID,
    [EMAIL_CHANGE_EMAIL_FIELD]: 'wang@example.com',
    [EMAIL_CHANGE_RETURN_TO_FIELD]: `/customers/${UUID}`,
    ...overrides,
  };
}

describe('parseEmailChangeForm — 合法輸入', () => {
  it('正常一發 → 回 customerId / email / returnTo', () => {
    const r = parseEmailChangeForm(form(valid()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.customerId).toBe(UUID);
    expect(r.email).toBe('wang@example.com');
    expect(r.returnTo).toBe(`/customers/${UUID}`);
  });

  it('🔵 canonicalize:頭尾空白去掉、網域轉小寫(員工複製貼上常帶到空白)', () => {
    const r = parseEmailChangeForm(form(valid({ [EMAIL_CHANGE_EMAIL_FIELD]: '  Wang@Example.COM  ' })));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // local-part 保留原字面、只有網域轉小寫(`canonicalizeNotificationEmail` 的契約)。
    expect(r.email).toBe('Wang@example.com');
  });
});

describe('parseEmailChangeForm — 拒收矩陣', () => {
  it.each([
    ['customer_id 不是 UUID', { [EMAIL_CHANGE_CUSTOMER_ID_FIELD]: 'not-a-uuid' }],
    ['customer_id 空白', { [EMAIL_CHANGE_CUSTOMER_ID_FIELD]: '' }],
    ['email 空白', { [EMAIL_CHANGE_EMAIL_FIELD]: '' }],
    ['email 沒有 @', { [EMAIL_CHANGE_EMAIL_FIELD]: 'wang.example.com' }],
    ['email 有空白', { [EMAIL_CHANGE_EMAIL_FIELD]: 'wa ng@example.com' }],
  ])('%s → 拒收', (_label, override) => {
    expect(parseEmailChangeForm(form(valid(override))).ok).toBe(false);
  });

  // 🔴🔴 **這一格是本片的安全線之一, 不是格式潔癖。**
  //    員工手打一個合成網域進去 ⇒ 那個帳號變成 `email-verification.ts` 說的「孤兒」
  //    (合成信箱而沒有 `pcm_provider`)⇒ **下一次資格閘會判成 `synthetic` 而永遠改不回來**。
  it.each([
    ['LINE 合成網域', 'line_u1@line.pcmmotorsports.local'],
    ['手動建單佔位網域', 'manual_x@manual.pcmmotorsports.local'],
    ['基底網域本身', 'x@pcmmotorsports.local'],
  ])('🔴 %s → 拒收(不得讓員工把帳號打成孤兒)', (_label, email) => {
    expect(parseEmailChangeForm(form(valid({ [EMAIL_CHANGE_EMAIL_FIELD]: email }))).ok).toBe(false);
  });

  // 🟢 正對照:同一把尺對【長得很像但不是我們的】網域必須放行 ——
  //    少了這一格,上面三格在「一律拒收」的實作下也會全綠。
  it('🟢 正對照:evil-pcmmotorsports.local 不是我們的子網域 → 放行', () => {
    const r = parseEmailChangeForm(
      form(valid({ [EMAIL_CHANGE_EMAIL_FIELD]: 'x@evil-pcmmotorsports.local' })),
    );
    expect(r.ok).toBe(true);
  });

  it('return_to 指向站外 → 退回 /customers(不當成拒收)', () => {
    const r = parseEmailChangeForm(
      form(valid({ [EMAIL_CHANGE_RETURN_TO_FIELD]: 'https://evil.example.com/x' })),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.returnTo).toBe('/customers');
  });
});

describe('parseEmailChangeForm — 形狀層(同名欄位送兩份)', () => {
  // 🔴 逐欄跑一遍 **外加一條手寫對照**(下面那一格)當完整性守門 ——
  //    只 `it.each` 走訪 `EMAIL_CHANGE_SINGLE_FIELDS` 是循環論證
  //    (理由逐字在 `lib/forms/single-value.ts:79-81`:「清單少一欄時測項也跟著少一條、全綠」)。
  it.each(EMAIL_CHANGE_SINGLE_FIELDS)('%s 送兩份 → 拒收', (field) => {
    const data = new FormData();
    for (const [name, value] of Object.entries(valid())) data.set(name, value);
    data.append(field, 'second-value');
    expect(parseEmailChangeForm(data).ok).toBe(false);
  });

  it('🔴 手寫對照:擋門清單就是這兩欄(漏列一欄 = 那一欄的「送兩份」洞照舊且無症狀)', () => {
    expect([...EMAIL_CHANGE_SINGLE_FIELDS]).toEqual(['customer_id', 'new_email']);
  });
});
