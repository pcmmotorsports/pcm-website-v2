// staff-form.ts — E8-A2 員工管理 server action 的純表單解析器(無 IO / Next 依賴)。
// id 只用來指定新增列或既有列,update payload 永遠不含 id。

export const STAFF_ID_FIELD = 'id';
export const STAFF_LABEL_FIELD = 'label';
export const IS_MANAGER_FIELD = 'is_manager';
export const IS_ACTIVE_FIELD = 'is_active';

const STAFF_ID_RE = /^[a-z0-9_]{1,64}$/;
const STAFF_LABEL_MAX = 32;

export interface FormLike {
  get(name: string): FormDataEntryValue | null;
  has(name: string): boolean;
}

function asString(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' ? value : null;
}

function parseStaffId(form: FormLike): string | null {
  const id = asString(form.get(STAFF_ID_FIELD));
  return id && STAFF_ID_RE.test(id) ? id : null;
}

function parseIdentityAndLabel(
  form: FormLike,
): { id: string; label: string } | null {
  const id = parseStaffId(form);
  if (!id) return null;

  const label = (asString(form.get(STAFF_LABEL_FIELD)) ?? '').trim();
  if (label === '' || label.length > STAFF_LABEL_MAX) return null;

  return { id, label };
}

export type StaffCreateParse =
  | {
      ok: true;
      input: { id: string; label: string; isManager: boolean };
    }
  | { ok: false };

export function parseStaffCreateForm(form: FormLike): StaffCreateParse {
  const identity = parseIdentityAndLabel(form);
  if (!identity) return { ok: false };

  return {
    ok: true,
    input: {
      ...identity,
      isManager: form.has(IS_MANAGER_FIELD),
    },
  };
}

export type StaffProfileParse =
  | {
      ok: true;
      id: string;
      profile: {
        label: string;
        isManager: boolean;
      };
    }
  | { ok: false };

export function parseStaffProfileForm(form: FormLike): StaffProfileParse {
  const identity = parseIdentityAndLabel(form);
  if (!identity) return { ok: false };

  return {
    ok: true,
    id: identity.id,
    profile: {
      label: identity.label,
      isManager: form.has(IS_MANAGER_FIELD),
    },
  };
}

export type StaffActiveParse =
  | { ok: true; id: string; isActive: boolean }
  | { ok: false };

export function parseStaffActiveForm(form: FormLike): StaffActiveParse {
  const id = parseStaffId(form);
  const active = asString(form.get(IS_ACTIVE_FIELD));
  if (!id || (active !== 'true' && active !== 'false')) {
    return { ok: false };
  }
  return { ok: true, id, isActive: active === 'true' };
}
