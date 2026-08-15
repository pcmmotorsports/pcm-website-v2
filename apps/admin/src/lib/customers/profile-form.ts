// profile-form.ts — 客人基本資料(姓名/電話/生日)server action 的純函式核心
// (M-4b `#25` 片 C1;可單測、無 'use server'/next 依賴)。
// authz(session/Origin/actor)在 action 檔;本檔只做「表單 → adapter patch」。
//
// 🔴 **兩層防線各管各的**(主視窗 2026-08-14 裁定 A,理由不是「zod 比較好」):
//   ① **形狀層走 admin 房規**:`anyMalformed` + `readSingleString`(同名欄位送兩份 = 形狀錯,不採第一筆);
//   ② **語意層走共用的 `ProfileInput`**(`@pcm/schemas`)—— phone / birthday 兩條 regex 已被審過,
//      抄第二份 = 這個 repo 已經付過一次學費的形狀(`schemas/src/index.ts:54` 記著 AddressInput 與
//      CheckoutInputBase「各抄一份…靠兩處同步」,後來收斂成共用)。
//
// 🔴 **本片只有這一支用 zod。** 其餘 12 支既有 parser 一律不動 —— 那是另一件事、要另外立案。
//
// 🔴 **`anyMalformed` 擋門在這裡是必要的、不是加強**(判準逐字在 `lib/forms/single-value.ts:21-25`:
//   「先問這個欄位的 `null` 在下游代表放行還是代表拒」):
//   `name` 的 null 直接拒(無妨);但 **`phone` / `birthday` 的 null 代表「沒送 ⇒ 用 schema 預設空字串」= 放行**
//   ⇒ 沒有擋門的話,`phone` 送兩份會被 `readSingleString` 讀成 null、變成「沒填」而**靜默通過**。
//   與 `refund-form.ts` 2026-08-10 實測到的 fail-open **同一形狀**。

import { ProfileInput } from '@pcm/schemas';
import { anyMalformed, readSingleString as readString } from '../forms/single-value';
import type { FormLike } from '../orders/workflow-form';
import { parseCustomersReturnTo } from './wallet-form';

// ── 表單欄名(明細頁基本資料卡的編輯表單用)──
export const PROFILE_CUSTOMER_ID_FIELD = 'customer_id';
export const PROFILE_NAME_FIELD = 'name';
export const PROFILE_PHONE_FIELD = 'phone';
export const PROFILE_BIRTHDAY_FIELD = 'birthday';
export const PROFILE_RETURN_TO_FIELD = 'return_to';

/**
 * 🔴 **`customer_id` 走 hidden 表單欄,不是從 URL 取 —— 而且「越權負測」是刻意不做的。**
 *
 * 形狀與 `tier-edit-form.tsx:31` / `wallet-adjust-form` 同構(hidden 欄 + `return_to`)。
 * ⚠️ **為什麼沒有「A 客的 id 換成 B 客 → 必須被拒」那格**:admin 注 service_role = BYPASSRLS,
 *    RLS 那層在這條路徑不存在;但**員工本來就能編輯任何客人** ⇒ 換一個 `customer_id`
 *    **不是提權,是「打錯客人」**。那條負測擋不住任何攻擊者、也擋不住手滑,**零判別力**。
 * ⇒ 真正有判別力的是**形狀層**:UUID 白名單(下面那條)+ `anyMalformed` 擋門(見檔頭),
 *    兩者都有負測釘死(`profile-form.test.ts` 的拒收矩陣與 #365 那一族)。
 * 🔴 這段理由寫在這裡而不是只留在 commit body —— **commit body 不會被下一個人讀到**。
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 🔴 本解析器讀的**全部**單值欄位 —— 入口擋門(`anyMalformed`)吃這份清單。
 * ⚠️ 漏列一欄 = 那一欄的「送兩份」洞照舊且無症狀 ⇒ 測試逐欄跑一遍 **外加一條手寫對照**當完整性守門
 *    (只 `it.each` 走訪本常數是循環論證,理由逐字在 `lib/forms/single-value.ts:79-81`)。
 * ⚠️ `return_to` 刻意**不**列入:它只影響導頁目的地、不影響寫入決策
 *    (責任範圍逐字見 `single-value.ts:28-30`),走自己的 fallback。
 */
export const PROFILE_SINGLE_FIELDS = [
  PROFILE_CUSTOMER_ID_FIELD,
  PROFILE_NAME_FIELD,
  PROFILE_PHONE_FIELD,
  PROFILE_BIRTHDAY_FIELD,
] as const;

/** 逐欄錯誤鍵(對齊 `ProfileInput` 三欄;`shape` = 形狀層失敗,非逐欄)。 */
export type ProfileFieldErrorKey = 'name' | 'phone' | 'birthday';

export type ProfileEditParseResult =
  | {
      ok: true;
      customerId: string;
      /**
       * 🔴 **patch 恰好三欄,而且 `birthday` 已 normalize 成 `string | null`。**
       * `''` 不能直接進 DB:`customers.birthday` 是 `date` 欄,Postgres 對空字串回
       * `invalid input syntax for type date`(storefront `account/profile/actions.ts:68` 為同一理由
       * 寫 `parsed.data.birthday || null`,那行標的是 codex k1 Critical 1)。
       */
      /**
       * ponytail: 恆三鍵、恆覆蓋 —— **欄位整個沒送 ⇒ 該欄被清空,不是保留原值**
       * (三個 input 今天恆渲染故構造不到;哪天有人把某欄改成條件渲染就會靜默清資料)。
       * 升級路徑 = 改成只帶「表單真有的欄」的白名單 patch(C4 那條的同型)。
       */
      patch: { name: string; phone: string; birthday: string | null };
      returnTo: string;
    }
  | { ok: false; fieldErrors?: Partial<Record<ProfileFieldErrorKey, string>> };

/**
 * 表單 → `{ customerId, patch }`:
 * - 形狀層:重複/非字串欄位一律拒(`anyMalformed`);`customer_id` 須 UUID;
 * - 語意層:`ProfileInput.safeParse`(name 必填、phone/birthday 選填但填了要合格式);
 * - `birthday` `''` → `null`(見上);
 * - `return_to`:只接受站內 `/customers` 路徑(`parseCustomersReturnTo` 共用守門)。
 */
export function parseProfileEditForm(form: FormLike): ProfileEditParseResult {
  // ① 形狀層:重複欄位在語意層之前擋掉(理由見檔頭與 `anyMalformed` docstring)。
  if (anyMalformed(form, PROFILE_SINGLE_FIELDS)) return { ok: false };

  const customerId = readString(form, PROFILE_CUSTOMER_ID_FIELD);
  if (!customerId || !UUID_RE.test(customerId)) return { ok: false };

  // ② 語意層:交給共用 schema。`??` 而非 `||` —— 空字串是合法輸入(選填欄),不可被當成「沒送」。
  const parsed = ProfileInput.safeParse({
    name: readString(form, PROFILE_NAME_FIELD) ?? '',
    phone: readString(form, PROFILE_PHONE_FIELD) ?? '',
    birthday: readString(form, PROFILE_BIRTHDAY_FIELD) ?? '',
  });
  if (!parsed.success) {
    const fieldErrors: Partial<Record<ProfileFieldErrorKey, string>> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0];
      if (path === 'name' || path === 'phone' || path === 'birthday') {
        fieldErrors[path] = issue.message;
      }
    }
    return Object.keys(fieldErrors).length > 0 ? { ok: false, fieldErrors } : { ok: false };
  }

  return {
    ok: true,
    customerId,
    patch: {
      name: parsed.data.name,
      phone: parsed.data.phone,
      birthday: parsed.data.birthday === '' ? null : parsed.data.birthday,
    },
    returnTo: parseCustomersReturnTo(readString(form, PROFILE_RETURN_TO_FIELD)),
  };
}
