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
// 🔴 **`is_manager` 現在是【顯式值】,不是「有沒有出現」**(⟦b4-MGR0-PARSE⟧ 2026-08-28):
//    · 沒送(未勾)⇒ `false`;送恰一筆 `'on'`(原生 checkbox 勾選送的值)⇒ `true`;
//    · **送兩份 / 送非字串 / 送任何其他字面 ⇒ 整份表單拒收。**
//    ⚠️ ~~原註解「語意是『有沒有出現』不是『值是什麼』」~~ **已作廢**(codex 關卡2 nit 抓到)——
//       那正是本片修掉的病:`is_manager=false` 在舊語意下讀成 `true`。
//       🔴 **照舊註解接新輸入的人, 會重新放行非 `'on'` 的值** ⇒ 病就回來了。
//    🔴 **這一欄【是】權限旗標 —— 動它就是鐵則 12②(權限),要跑 codex 對抗審查。**
//    ⟦b4-MGR0⟧(2026-08-28)起,`is_manager AND is_active` 決定誰能新增 / 修改 / 停用員工;
//    閘 = `session/authorize.ts` 的 `authorizeManagerMutation()`。
//    ⚠️ ~~原註解說本欄與權限無關、不必當鐵則 12②~~ **已作廢** ——
//       它連同建表 migration `20260726120000:28-29` 那句 COMMENT,都是【本片之前】的事實。
//       (刻意不引用舊句原文:貼回來會讓守住這一格的那把 grep 自己失效。)
//    ⚠️ 而本欄同時還背著出生時的語意「成本遮蔽」(該片未做)⇒ backlog ⟦b4-MGR0-SEM⟧。

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
 * checkbox 專用讀法。⟦b4-MGR0-PARSE⟧ 2026-08-28:**三態,不是布林。**
 *
 * ⚠️ ~~原本這裡是 `readSingle(...).kind === 'value'`,也就是「有出現就算勾了」~~ **已作廢**。
 *    那個語意的病(codex 關卡2 抓到):`is_manager=false` / `=off` / `=""` **全都讀成 `true`**
 *    ⇒ 📌 **一個寫著 `false` 的欄位, 會授予管理者權限。**
 *    ⚠️ 爆炸半徑(當時量過, 留著):要走到這裡必須先過 `authorizeManagerMutation`
 *       ⇒ **非管理者送什麼都拿不到權限**;會踩的是管理者自己或日後新增的呼叫端。
 *    ⇒ ⟦b4-MGR0⟧ 那片刻意不改它(超出批准範圍), 本片才改。
 * ```
 * 沒送(未勾)          ⇒ { ok: true, value: false }
 * 送恰一筆 'on'(勾了) ⇒ { ok: true, value: true }
 * 送任何其他值         ⇒ { ok: false }   ← 整份表單拒收, 不是靜默當成勾了
 * ```
 * 🔴 **這裡刻意【不回 false】,理由是回饋路徑,不是嚴格。**
 *    回 false 會讓「送錯值」與「沒勾」變成同一件事,而它們的意思相反。
 *    拒收會讓操作者看到 `?r=invalid` —— **那是一條回饋路徑**;靜默回 false 沒有。
 *    ⚠️ **下一個人最可能怎麼把它弄壞**:覺得「拒收太兇,回 false 比較友善」——
 *       📌 **而那個「友善」正好是把回饋路徑關掉。** 送錯值的人會拿到一個看起來成功的結果,
 *       而他要的那件事沒有發生,且沒有任何訊號。
 *    ⇒ 要放寬請放寬**接受的值**(在 `IS_MANAGER_CHECKED` 旁邊多加一個,看得見),
 *      **不要把拒收改成回 false。**
 * ⚠️ **只認 `'on'` 是量出來的, 不是猜的**(2026-08-28 逐支開檔):
 *    兩個呼叫端都是原生 checkbox 且【沒有 value 屬性】
 *    (`staff-create-form.tsx` / `staff-edit-row.tsx`)⇒ 瀏覽器勾了送 `'on'`、沒勾整個欄位不送。
 *    測試餵的也只有 `'on'`。⇒ **這個收窄不會擋掉任何現行呼叫端。**
 * 🔴 而日後若有客戶端要送別的字面(例如 `'true'`),**在這裡多加一個, 要看得見** ——
 *    不要改回「有出現就算」。那正是本片要修的病。
 */
type ManagerRead = { ok: true; value: boolean } | { ok: false };

const IS_MANAGER_CHECKED = 'on';

function readIsManager(form: FormLike): ManagerRead {
  const read = readSingle(form, IS_MANAGER_FIELD);
  if (read.kind === 'missing') return { ok: true, value: false };
  if (read.kind === 'invalid') return { ok: false };
  return read.value === IS_MANAGER_CHECKED ? { ok: true, value: true } : { ok: false };
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

  const manager = readIsManager(form);
  if (!manager.ok) return { ok: false };

  return {
    ok: true,
    input: {
      ...identity,
      isManager: manager.value,
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

  const manager = readIsManager(form);
  if (!manager.ok) return { ok: false };

  return {
    ok: true,
    id: identity.id,
    profile: {
      label: identity.label,
      isManager: manager.value,
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
