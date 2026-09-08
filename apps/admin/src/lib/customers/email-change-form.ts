// email-change-form.ts — 後台「改客人信箱」的表單解析(純函式、可單測、零 server 依賴)。
//
// 🔴 **兩層防線各管各的**(鏡像 `profile-form.ts`,理由那支檔頭寫得最完整):
//   ① **形狀層走 admin 房規**:`anyMalformed` + `readSingleString`(同名欄位送兩份 = 形狀錯,不採第一筆);
//   ② **語意層走共用的 `NotificationEmailInput`**(`@pcm/schemas`)—— **刻意不自己寫一條 email regex**。
//
// 🔴🔴 **為什麼是 `NotificationEmailInput` 而不是 `z.email()`** —— 它多做了一件本片非要不可的事:
// ```
// packages/schemas/src/notification-email.ts:87  逐字 `!isSyntheticEmailDomain(value)`
// ⇒ 它【擋掉合成網域】(*.pcmmotorsports.local)
// ```
// ⇒ 📌 少了那一格,員工可以手打一個 `xxx@line.pcmmotorsports.local` 進去
//    ⇒ 那個帳號會變成 `email-verification.ts` 說的「**孤兒**」(合成信箱而沒有 `pcm_provider`)
//    ⇒ 而**下一次**再有人想改它的信箱時, 資格閘會判成 `synthetic` ⇒ **他自己把自己鎖死了**。
// 🔵 它另外附送 canonicalize(去頭尾空白、網域轉小寫)⇒ 員工複製貼上帶到空白不會變成一個怪帳號。

import { NotificationEmailInput } from '@pcm/schemas';
import { anyMalformed, readSingleString as readString } from '../forms/single-value';
import type { FormLike } from '../orders/workflow-form';
import { parseCustomersReturnTo } from './wallet-form';

// ── 表單欄名 ──
export const EMAIL_CHANGE_CUSTOMER_ID_FIELD = 'customer_id';
export const EMAIL_CHANGE_EMAIL_FIELD = 'new_email';
export const EMAIL_CHANGE_RETURN_TO_FIELD = 'return_to';

/**
 * 🔴 本解析器讀的**全部**單值欄位 —— 入口擋門(`anyMalformed`)吃這份清單。
 * ⚠️ `return_to` 刻意**不**列入:它只影響導頁目的地、不影響寫入決策
 *    (責任範圍逐字見 `lib/forms/single-value.ts:28-30`:「負責『**值會影響寫入決策**』的欄位」),
 *    走自己的 fallback。
 */
export const EMAIL_CHANGE_SINGLE_FIELDS = [
  EMAIL_CHANGE_CUSTOMER_ID_FIELD,
  EMAIL_CHANGE_EMAIL_FIELD,
] as const;

/**
 * 🔴 `customer_id` 走 hidden 表單欄(形狀與 `profile-form.ts` / `tier-form.ts` 同構)。
 * ⚠️ 與那兩支一樣:admin 注 service_role = BYPASSRLS ⇒ RLS 那層在這條路徑**不存在**,
 *    真正決定「改到誰」的就是這個欄位。
 * 🛑 **而本片與那兩支【不同】的地方要講明**:改信箱是**改身分**,打錯客人的後果比
 *    打錯電話重 —— 那個人的登入帳號會被換掉。⇒ 這也是本片走**管理者閘**而不是一般員工閘的理由
 *    (`email-change-action.ts` 的 `authorizeManagerMutation`)。
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EmailChangeParseResult =
  | { ok: true; customerId: string; email: string; returnTo: string }
  | { ok: false; fieldError?: string };

export function parseEmailChangeForm(form: FormLike): EmailChangeParseResult {
  // ① 形狀層:重複欄位在語意層之前擋掉。
  if (anyMalformed(form, EMAIL_CHANGE_SINGLE_FIELDS)) return { ok: false };

  const customerId = readString(form, EMAIL_CHANGE_CUSTOMER_ID_FIELD);
  if (!customerId || !UUID_RE.test(customerId)) return { ok: false };

  // ② 語意層:交給共用 schema(含合成網域擋門與 canonicalize)。
  //    🔴 `?? ''` 而非 `|| ''`:兩者在這裡等價,但沿用姊妹檔的寫法 —— 空字串是「員工把它清空了」,
  //       而 schema 對空字串有自己的一句話(「請填寫 Email」),不該在這裡先被吃掉。
  const parsed = NotificationEmailInput.safeParse(
    readString(form, EMAIL_CHANGE_EMAIL_FIELD) ?? '',
  );
  if (!parsed.success) {
    return { ok: false, fieldError: parsed.error.issues[0]?.message };
  }

  return {
    ok: true,
    customerId,
    // 🔵 用 schema 吐出來的那一份(已 canonicalize),**不是**表單原字面。
    email: parsed.data,
    returnTo: parseCustomersReturnTo(readString(form, EMAIL_CHANGE_RETURN_TO_FIELD)),
  };
}
