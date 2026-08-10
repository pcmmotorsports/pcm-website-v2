import { describe, expect, it } from 'vitest';
import {
  IS_ACTIVE_FIELD,
  IS_MANAGER_FIELD,
  STAFF_ID_FIELD,
  STAFF_LABEL_FIELD,
  parseStaffActiveForm,
  parseStaffCreateForm,
  parseStaffProfileForm,
  STAFF_PROFILE_SINGLE_FIELDS,
} from './staff-form';

// #365 片③:假表單整個拿掉,改用**真 FormData** —— `FormLike` 已收窄成只有 `getAll()`
// (`get()` 取第一筆、`has()` 對一份兩份都回 true,型別上就不再提供),而 Map 支撐的假表單
// 單值情境永遠只回一筆 ⇒ 「送兩份」那一整族負測在它上面根本造不出來。
function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) data.set(name, value);
  return data;
}

const VALID_CREATE: Record<string, string> = {
  [STAFF_ID_FIELD]: 'staff_3',
  [STAFF_LABEL_FIELD]: '員工 3',
  [IS_MANAGER_FIELD]: 'on',
};

describe('parseStaffCreateForm', () => {
  it('should parse and trim a valid create form', () => {
    expect(
      parseStaffCreateForm(
        form({ ...VALID_CREATE, [STAFF_LABEL_FIELD]: '  員工 3  ' }),
      ),
    ).toEqual({
      ok: true,
      input: { id: 'staff_3', label: '員工 3', isManager: true },
    });
  });

  it('should treat a missing manager checkbox as false', () => {
    const entries = { ...VALID_CREATE };
    delete entries[IS_MANAGER_FIELD];
    const parsed = parseStaffCreateForm(form(entries));
    expect(parsed.ok && parsed.input.isManager).toBe(false);
  });

  it('should reject ids outside the database check format', () => {
    for (const id of [
      '',
      'Staff_3',
      'staff-3',
      'staff 3',
      '_staff.',
      'a'.repeat(65),
    ]) {
      expect(
        parseStaffCreateForm(form({ ...VALID_CREATE, [STAFF_ID_FIELD]: id })).ok,
      ).toBe(false);
    }
  });

  it('should reject a blank or overlong label', () => {
    for (const label of ['', '   ', 'x'.repeat(33)]) {
      expect(
        parseStaffCreateForm(
          form({ ...VALID_CREATE, [STAFF_LABEL_FIELD]: label }),
        ).ok,
      ).toBe(false);
    }
  });
});

describe('parseStaffProfileForm', () => {
  it('should parse only profile fields and never include active state', () => {
    expect(
      parseStaffProfileForm(
        form({ ...VALID_CREATE, [IS_ACTIVE_FIELD]: 'false' }),
      ),
    ).toEqual({
      ok: true,
      id: 'staff_3',
      profile: {
        label: '員工 3',
        isManager: true,
      },
    });
  });

  it('should map a missing manager checkbox to false', () => {
    const parsed = parseStaffProfileForm(
      form({
        [STAFF_ID_FIELD]: 'staff_3',
        [STAFF_LABEL_FIELD]: '員工 3',
      }),
    );
    expect(parsed).toEqual({
      ok: true,
      id: 'staff_3',
      profile: {
        label: '員工 3',
        isManager: false,
      },
    });
  });

  it('should apply the same authoritative id and label validation as create', () => {
    expect(
      parseStaffProfileForm(
        form({ ...VALID_CREATE, [STAFF_ID_FIELD]: 'STAFF_3' }),
      ).ok,
    ).toBe(false);
    expect(
      parseStaffProfileForm(
        form({ ...VALID_CREATE, [STAFF_LABEL_FIELD]: '   ' }),
      ).ok,
    ).toBe(false);
  });
});

describe('parseStaffActiveForm', () => {
  it.each([
    ['true', true],
    ['false', false],
  ])('should parse the exact active direction %s', (raw, expected) => {
    expect(
      parseStaffActiveForm(
        form({
          [STAFF_ID_FIELD]: 'staff_3',
          [IS_ACTIVE_FIELD]: raw,
          [STAFF_LABEL_FIELD]: '不得進入 payload',
          [IS_MANAGER_FIELD]: 'on',
        }),
      ),
    ).toEqual({
      ok: true,
      id: 'staff_3',
      isActive: expected,
    });
  });

  it('should reject a missing or non-canonical active direction', () => {
    for (const raw of ['', 'on', 'TRUE', '0']) {
      expect(
        parseStaffActiveForm(
          form({
            [STAFF_ID_FIELD]: 'staff_3',
            [IS_ACTIVE_FIELD]: raw,
          }),
        ).ok,
      ).toBe(false);
    }
  });
});

// ── #365 片③:單值欄位「getAll 恰一筆」 ────────────────────────────────────────────────
//
// 🔴 **本檔的受害形狀不是 fail-open**(別照抄片② 的句子):每欄都有 `null → ok:false` 明擋,
//    所以「送兩份」不會讓檢查被跳過 —— 它會讓**動作打在錯的那一列上**(`id` 採第一筆
//    ⇒ 改到 / 停用到另一位員工),而且回 `ok:true`、畫面顯示成功。
describe('staff-form — #365 單值欄位恰一筆', () => {
  // 🔴 手寫清單、不走訪受測常數(循環論證:清單少一欄,測項也跟著少一條 ⇒ 全綠)。
  const EXPECTED_PROFILE_FIELDS = ['id', 'label', 'is_manager'];
  const EXPECTED_ACTIVE_FIELDS = ['id', 'is_active'];

  // 🔴 只剩**一份**清單:`parseStaffActiveForm` 的入口擋門突變實測零判別力(它兩欄的
  //    `null` 本來就直接 `ok:false`)⇒ 那道與它的常數已刪。這裡守的是唯一真的在擋東西的那份。
  it('入口清單 = 手寫的三顆 wire 欄名(唯一在擋的是 is_manager,見常數 docstring)', () => {
    expect([...STAFF_PROFILE_SINGLE_FIELDS]).toEqual(EXPECTED_PROFILE_FIELDS);
  });

  it.each(EXPECTED_PROFILE_FIELDS)('新增/編輯:%s 送兩份 → ok:false(不採第一筆)', (field) => {
    const d = form(VALID_CREATE);
    d.append(field, d.get(field) as string);
    expect(parseStaffCreateForm(d).ok).toBe(false);
    expect(parseStaffProfileForm(d).ok).toBe(false);
    // 正向對照:同樣的值只送一份 ⇒ 過(證明紅的是「兩份」而不是那個值)。
    expect(parseStaffCreateForm(form(VALID_CREATE)).ok).toBe(true);
  });

  it('🔴 id 送兩份不同的員工代碼 → 拒(舊行為:採第一筆 ⇒ 改到另一位員工)', () => {
    const d = form(VALID_CREATE);
    d.append(STAFF_ID_FIELD, 'staff_9');
    expect(parseStaffProfileForm(d).ok).toBe(false);
  });

  it.each(EXPECTED_ACTIVE_FIELDS)('停用/啟用:%s 送兩份 → ok:false', (field) => {
    const base: Record<string, string> = { [STAFF_ID_FIELD]: 'staff_3', [IS_ACTIVE_FIELD]: 'false' };
    const d = form(base);
    d.append(field, base[field] as string);
    expect(parseStaffActiveForm(d).ok).toBe(false);
    expect(parseStaffActiveForm(form(base)).ok).toBe(true);
  });

  // ── is_manager 是 checkbox:語意是「有沒有出現」,四種形狀各自釘住 ──
  it('🔴 is_manager 沒送(未勾)→ false;送恰一筆(勾了)→ true', () => {
    const unchecked = { [STAFF_ID_FIELD]: 'staff_3', [STAFF_LABEL_FIELD]: '員工 3' };
    const a = parseStaffCreateForm(form(unchecked));
    expect(a.ok && a.input.isManager).toBe(false);
    const b = parseStaffCreateForm(form({ ...unchecked, [IS_MANAGER_FIELD]: 'on' }));
    expect(b.ok && b.input.isManager).toBe(true);
  });

  it('🔴 is_manager 送兩份 → 整份拒(舊行為:has() 對一份兩份都回 true = 靜默當成勾了)', () => {
    const d = form(VALID_CREATE);
    d.append(IS_MANAGER_FIELD, 'on');
    expect(parseStaffCreateForm(d).ok).toBe(false);
  });

  it('🔴 is_manager 送單一 File → 整份拒(數量是 1,只數 length 的擋門會放行)', () => {
    const d = form({ [STAFF_ID_FIELD]: 'staff_3', [STAFF_LABEL_FIELD]: '員工 3' });
    d.set(IS_MANAGER_FIELD, new File(['on'], 'on.txt'));
    expect(parseStaffCreateForm(d).ok).toBe(false);
  });
});
