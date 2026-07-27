import { describe, expect, it } from 'vitest';
import {
  IS_ACTIVE_FIELD,
  IS_MANAGER_FIELD,
  STAFF_ID_FIELD,
  STAFF_LABEL_FIELD,
  parseStaffActiveForm,
  parseStaffCreateForm,
  parseStaffProfileForm,
  type FormLike,
} from './staff-form';

function form(entries: Record<string, string>): FormLike {
  const values = new Map(Object.entries(entries));
  return {
    get: (name) => values.get(name) ?? null,
    has: (name) => values.has(name),
  };
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
