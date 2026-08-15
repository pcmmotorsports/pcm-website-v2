import { describe, expect, it } from 'vitest';
import type { FormLike } from '../orders/workflow-form';
import {
  PROFILE_BIRTHDAY_FIELD,
  PROFILE_CUSTOMER_ID_FIELD,
  PROFILE_NAME_FIELD,
  PROFILE_PHONE_FIELD,
  PROFILE_RETURN_TO_FIELD,
  PROFILE_SINGLE_FIELDS,
  parseProfileEditForm,
} from './profile-form';

const UUID = '11111111-2222-4333-8444-555555555555';
const OTHER_UUID = '99999999-8888-4777-8666-555555555555';

// 真 FormData(不是自製假物件):自製物件的 getAll 常被寫成「單值情境永遠只回一筆」,
// 那正是讓重複欄位測不出來的形狀(理由逐字見 tier-form.test.ts 檔頭)。
function form(entries: Record<string, string>): FormLike {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) data.set(name, value);
  return data;
}

function valid(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    [PROFILE_CUSTOMER_ID_FIELD]: UUID,
    [PROFILE_NAME_FIELD]: '王小明',
    [PROFILE_PHONE_FIELD]: '0912-345-678',
    [PROFILE_BIRTHDAY_FIELD]: '1990-03-15',
    [PROFILE_RETURN_TO_FIELD]: `/customers/${UUID}`,
    ...overrides,
  };
}

describe('parseProfileEditForm — 合法輸入', () => {
  it('三欄齊全 → patch 恰三鍵', () => {
    const r = parseProfileEditForm(form(valid()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.customerId).toBe(UUID);
    expect(r.patch).toEqual({ name: '王小明', phone: '0912-345-678', birthday: '1990-03-15' });
    expect(Object.keys(r.patch).sort()).toEqual(['birthday', 'name', 'phone']);
  });

  it('電話留空 → 合法,patch.phone = 空字串(選填)', () => {
    const r = parseProfileEditForm(form(valid({ [PROFILE_PHONE_FIELD]: '' })));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.patch.phone).toBe('');
  });
});

/**
 * 🔴 驗收第 6 條(A 窗 N1:「知道 ≠ 有東西擋」)。
 * `customers.birthday` 是 DB `date` 欄,空字串會讓 Postgres 回
 * `invalid input syntax for type date` ⇒ 必須在這一層 normalize 成 `null`。
 * 第一版只把這件事寫進誠實缺口、沒有任何一條驗收擋它 —— 這格就是那條擋門。
 */
describe('生日留空 → null(不是空字串)', () => {
  it('birthday="" ⇒ patch.birthday === null', () => {
    const r = parseProfileEditForm(form(valid({ [PROFILE_BIRTHDAY_FIELD]: '' })));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.patch.birthday).toBeNull();
    // 🔴 釘死「不是空字串」:只斷言 falsy 會讓 '' 也通過,那正是會炸 DB 的值。
    expect(r.patch.birthday).not.toBe('');
  });

  it('birthday 欄整個沒送 ⇒ 同樣是 null', () => {
    const { [PROFILE_BIRTHDAY_FIELD]: _omit, ...rest } = valid();
    const r = parseProfileEditForm(form(rest));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.patch.birthday).toBeNull();
  });
});

describe('parseProfileEditForm — 拒收矩陣(ok:false)', () => {
  it.each([
    ['customer_id 非 UUID', { [PROFILE_CUSTOMER_ID_FIELD]: 'not-a-uuid' }],
    ['customer_id 空', { [PROFILE_CUSTOMER_ID_FIELD]: '' }],
    ['姓名空', { [PROFILE_NAME_FIELD]: '' }],
    ['電話格式錯(太短)', { [PROFILE_PHONE_FIELD]: '0912' }],
    ['電話格式錯(含字母)', { [PROFILE_PHONE_FIELD]: '0912abc345' }],
    ['生日格式錯(斜線)', { [PROFILE_BIRTHDAY_FIELD]: '1990/03/15' }],
    ['生日格式錯(非日期)', { [PROFILE_BIRTHDAY_FIELD]: 'abc' }],
  ])('%s → ok:false', (_label, override) => {
    expect(parseProfileEditForm(form(valid(override))).ok).toBe(false);
  });

  it('逐欄錯誤有 fieldErrors(姓名)', () => {
    const r = parseProfileEditForm(form(valid({ [PROFILE_NAME_FIELD]: '' })));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fieldErrors?.name).toBeTruthy();
  });
});

/**
 * 🔴🔴 這一族是本檔的承重格 —— 判準逐字在 `lib/forms/single-value.ts:21-25`:
 * 「先問這個欄位的 `null` 在下游代表放行還是代表拒」。
 * `phone` / `birthday` 的 null 代表「沒送 ⇒ 用 schema 預設空字串」= **放行**
 * ⇒ 沒有 `anyMalformed` 入口擋門的話,送兩份會被讀成 null、變成「沒填」而**靜默通過**
 *    (與 `refund-form.ts` 2026-08-10 實測到的 fail-open 同一形狀)。
 */
describe('#365 同名欄位送兩份 → 被拒(不採第一筆、也不靜默當沒填)', () => {
  function dup(field: string, a: string, b: string): FormLike {
    const data = new FormData();
    for (const [name, value] of Object.entries(valid())) data.set(name, value);
    data.delete(field);
    data.append(field, a);
    data.append(field, b);
    return data;
  }

  it.each([...PROFILE_SINGLE_FIELDS])('%s 送兩份 → ok:false', (field) => {
    expect(parseProfileEditForm(dup(field, 'x', 'y')).ok).toBe(false);
  });

  it('🔴 phone 送兩份**不會**被當成「沒填」而通過(fail-open 回歸)', () => {
    // 兩份都是合法電話 ⇒ 若擋門失效,readSingleString 回 null → schema 預設 '' → ok:true。
    const r = parseProfileEditForm(dup(PROFILE_PHONE_FIELD, '0912-345-678', '0987-654-321'));
    expect(r.ok).toBe(false);
  });

  it('🔴 birthday 送兩份同理', () => {
    expect(parseProfileEditForm(dup(PROFILE_BIRTHDAY_FIELD, '1990-03-15', '1991-04-16')).ok).toBe(
      false,
    );
  });

  // 🔴 **完整性守門:手寫對照**(`tier-form.test.ts:157` 同款)。
  //    只用上面的 `it.each` 走訪同一顆常數是**循環論證** —— 來源檔漏一欄,測項也跟著少一條、照樣全綠
  //    (理由逐字在 `lib/forms/single-value.ts:79-81`)。這一條拿測試檔自己手寫的清單去比。
  it('🔴 PROFILE_SINGLE_FIELDS 逐字等於四欄(手寫對照)', () => {
    expect([...PROFILE_SINGLE_FIELDS].sort()).toEqual(
      ['birthday', 'customer_id', 'name', 'phone'].sort(),
    );
  });

  // 🔴 `return_to` **刻意不在**擋門清單裡(它只影響導頁、不影響寫入決策)。
  //    這一條釘住那個刻意,免得未來有人「順手補齊」而不知道那是決定。
  it('🔴 return_to 送兩份**不**被擋,但走 fallback(刻意:它不影響寫入決策)', () => {
    const r = parseProfileEditForm(dup(PROFILE_RETURN_TO_FIELD, '/customers/a', '/customers/b'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 🔴 只斷言 ok:true 會讓「fallback 改成採第一筆」這種回歸照樣綠 ⇒ 把 fallback 值也釘住。
    expect(r.returnTo).toBe('/customers');
  });
});

describe('return_to 站內守門(parseCustomersReturnTo 共用)', () => {
  it.each([
    ['站外絕對網址', 'https://evil.example.com/customers'],
    ['路徑穿越', '/customers/../admin'],
    ['非 /customers 前綴', '/orders/123'],
  ])('%s → 退回 /customers', (_label, raw) => {
    const r = parseProfileEditForm(form(valid({ [PROFILE_RETURN_TO_FIELD]: raw })));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.returnTo).toBe('/customers');
  });

  it('合法站內路徑原樣保留', () => {
    const r = parseProfileEditForm(form(valid({ [PROFILE_RETURN_TO_FIELD]: `/customers/${OTHER_UUID}` })));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.returnTo).toBe(`/customers/${OTHER_UUID}`);
  });
});

/**
 * 🔴 patch 只含三欄 —— 越權/越欄的第一道。
 * `tier` / `wallet_balance` / `email` 即使被塞進表單也不得出現在 patch
 * (DB 端另有欄級 GRANT 擋:`20260717010000:175` 只開 name/phone/birthday/updated_at,
 *  但那是最後一道,不是唯一一道)。
 */
describe('多送的欄不得進 patch', () => {
  it.each(['tier', 'wallet_balance', 'email', 'user_id'])('塞 %s → patch 仍恰三鍵', (extra) => {
    const r = parseProfileEditForm(form(valid({ [extra]: 'x' })));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.patch).sort()).toEqual(['birthday', 'name', 'phone']);
  });
});
