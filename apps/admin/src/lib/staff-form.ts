// staff-form.ts — E8-A2 員工管理 server action 的純表單解析器(無 IO / Next 依賴)。
// id 只用來指定新增列或既有列,update payload 永遠不含 id。

// #365 片③:單值欄位的唯一讀法(見 `lib/forms/single-value.ts` 檔頭)。
import {
  type SingleValueFormLike,
  anyMalformed,
  readSingle,
  readSingleString,
} from './forms/single-value';

export const STAFF_ID_FIELD = 'id';
export const STAFF_LABEL_FIELD = 'label';
export const IS_MANAGER_FIELD = 'is_manager';
export const IS_ACTIVE_FIELD = 'is_active';

const STAFF_ID_RE = /^[a-z0-9_]{1,64}$/;
const STAFF_LABEL_MAX = 32;

/**
 * 表單讀取的最小介面 = **共用讀法自己的型別**(`lib/forms/single-value.ts`)。
 * 🔴 #365 片③:原本是 `{ get(), has() }`,兩支都分不出「送一份」與「送兩份」
 *    (`get()` 取第一筆、`has()` 兩者都回 `true`)⇒ 收窄成只有 `getAll()`。
 */
export type FormLike = SingleValueFormLike;

// #365 片③:本地 `asString` 已刪,改用共用的「`getAll()` 恰一筆」讀法。
//
// 🔴 **本檔的受害形狀**(與片②的 fail-open 不同型):每個欄位都是 `null → ok:false` 明擋,
//    沒有「這欄空的 ⇒ 跳過某個檢查」那族守門 ⇒ **沒有 fail-open**。真正的傷害是
//    **對錯的對象動手**:`id` 送兩份時舊碼採第一筆 ⇒ **改到 / 停用到另一位員工**,
//    而且回 `ok:true`、畫面顯示成功。
//
// 🔴 **`is_manager` 是 checkbox,語意是「有沒有出現」不是「值是什麼」**,所以它不能只換讀法:
//    · 沒送(未勾)⇒ `false`;送恰一筆(勾了,原生 checkbox 送 `'on'`)⇒ `true`;
//    · **送兩份 / 送非字串 ⇒ 整份表單拒收**(舊碼的 `has()` 對這兩種都回 `true` = 靜默當成勾了)。
//    ⚠️ **這一欄不是權限旗標**,別因為名字像就當成鐵則 12② —— 建表 migration
//    `20260726120000:28-29` 的 COMMENT 逐字(中間略一句,以 `…` 標出):
//    「本欄目前無任何程式讀取、不強制任何權限;…看到此欄不代表權限已生效。」
//    我另外 grep 過 `session/` 與 `sso/` 兩個授權面、零命中。

/**
 * 🔴🔴 **只有新增/編輯這條路需要入口擋門,而且只為了 `is_manager` 一欄。**
 *
 * `id` / `label` / `is_active` 每一顆 `null` 都直接 `ok:false`(`STAFF_ID_RE`、空值與長度、
 * 只認 `'true'`/`'false'`)⇒ 光靠 `readSingleString` 就 fail-closed,**擋門對它們零判別力**
 * (突變實測:拿掉 `parseStaffActiveForm` 的擋門,全套照綠 ⇒ 那道已刪)。
 *
 * `is_manager` 不一樣:它是 presence 語意的 checkbox,`readSingle` 的 `invalid`
 * 在布林轉換後**讀不出「不合法」、只讀得出「沒勾」** ⇒ 送兩份 / 送 File 會被靜默當成
 * 「沒勾管理者」而**照樣寫入成功**。那是這一份清單唯一在擋的東西,突變 T1 只紅這一族。
 * ⚠️ 漏列 `is_manager` = 那個洞照舊 ⇒ 測試拿手寫清單比對這顆常數。
 */
export const STAFF_PROFILE_SINGLE_FIELDS = [
  STAFF_ID_FIELD,
  STAFF_LABEL_FIELD,
  IS_MANAGER_FIELD,
] as const;

function parseStaffId(form: FormLike): string | null {
  const id = readSingleString(form, STAFF_ID_FIELD);
  return id && STAFF_ID_RE.test(id) ? id : null;
}

/**
 * checkbox 專用讀法:**勾了沒**,不是「值是什麼」(原生 checkbox 勾選時送 `'on'`)。
 * 🔴 `invalid`(送兩份 / 非字串)在呼叫端的入口擋門就被擋掉了 ⇒ 走到這裡只剩
 *    `value`(勾了)與 `missing`(沒勾)兩種。這裡回 `false` 是「沒勾」,不是「讀不出來」。
 */
function readIsManager(form: FormLike): boolean {
  return readSingle(form, IS_MANAGER_FIELD).kind === 'value';
}

function parseIdentityAndLabel(
  form: FormLike,
): { id: string; label: string } | null {
  const id = parseStaffId(form);
  if (!id) return null;

  const label = (readSingleString(form, STAFF_LABEL_FIELD) ?? '').trim();
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
  if (anyMalformed(form, STAFF_PROFILE_SINGLE_FIELDS)) return { ok: false };
  const identity = parseIdentityAndLabel(form);
  if (!identity) return { ok: false };

  return {
    ok: true,
    input: {
      ...identity,
      isManager: readIsManager(form),
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
  if (anyMalformed(form, STAFF_PROFILE_SINGLE_FIELDS)) return { ok: false };
  const identity = parseIdentityAndLabel(form);
  if (!identity) return { ok: false };

  return {
    ok: true,
    id: identity.id,
    profile: {
      label: identity.label,
      isManager: readIsManager(form),
    },
  };
}

export type StaffActiveParse =
  | { ok: true; id: string; isActive: boolean }
  | { ok: false };

export function parseStaffActiveForm(form: FormLike): StaffActiveParse {
  const id = parseStaffId(form);
  const active = readSingleString(form, IS_ACTIVE_FIELD);
  if (!id || (active !== 'true' && active !== 'false')) {
    return { ok: false };
  }
  return { ok: true, id, isActive: active === 'true' };
}
