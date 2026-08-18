// lib/payment/cardholder.ts — cardholder server 組裝(M-3 ②-③d、MUST-FIX 3 + Q3=B 級聯)
//
// 🔴 client 零信任(指令禁止清單「cardholder 不收 client 值」):三欄全由 server 端資料組裝 ——
// - email ← **收件地址的 email 優先、session user.email 回落**(M-4b LINE 3DS 修復;2026-08-09 起)。
//   兩者都拿不出 TapPay 收得下的值(空 / 合成網域 / >40 字元 / 格式不合)→ fail-closed 拒。
//   🔴 舊字面是「email ← user.email(LINE 合成 email 已保底)」—— 那個「保底」正是本次事故:
//   合成信箱 64 字元,TapPay 對 cardholder.email 有 <=40 上限(sandbox 實測 41 即回 521),
//   於是 LINE 客人的 3DS 啟動一律被拒。詳見 pickUsableEmail 與 docs/specs/2026-08-09-*.md。
// - name  ← customers.name(profile);空(OAuth 可空)→ 級聯收件人 address.name(Q3=B);仍空 → 拒。
// - phone ← 結帳地址 address.phone(zod default('') 可空);空 → 級聯 customers.phone;仍空 → 拒
//   (TapPay 官方 phone_number 必填、不送空)。
// - 全欄 trim 後 min(1)(codex 關卡1 round1 F4:「   」不得送 TapPay)。
// - profile 查無 row → 拒(round6 NIT:不視為「name/phone 皆空」靜默級聯)。
// - 地址以 listByCustomer(user.id) 過濾 addressId(RLS own-only):查無 = 非本人/不存在 → 拒。
// - 🔴 呼叫時序:組裝**先於** placeOrder(PII 缺失不產垃圾 unpaid 單、plan v6 §5)。
// - PII #16:本檔零 log;結果只回呼叫端(action → use-case → adapter,皆不入 log)。
//
// 失敗 reason 供 action 映 fieldErrors/formError 引導文案(不洩內部結構;repo throw 原樣上拋、
// action 吞通用字面)。

import 'server-only';

import type { Cardholder } from '@pcm/domain';
import type { IAddressRepository, ICustomerRepository } from '@pcm/ports';
import { AddressEmailInput } from '@pcm/schemas';

/**
 * 從候選值裡挑出**第一個送得進 TapPay 的 email**;全都不行則回 null。
 *
 * 驗證直接用 `AddressEmailInput` —— 就是收件地址 Email 欄的**同一支 schema**,
 * 不在本檔自己拼條件。它涵蓋:非空 / canonicalize(網域轉小寫)/ printable ASCII /
 * <=254 octets / 基本 email 形狀 / **拒 LINE 合成網域** / **總長 <=40**。
 *
 * 🔴 為什麼用整支 schema,而不是只檢查「網域 + 長度」(codex 關卡2 must-fix):
 *   只檢查那兩項的話,`abc`、`a@b`、含空白或非 ASCII 的值會**通過**並送進 TapPay ——
 *   它們短、也不是合成網域,但一樣不是合法 email。共用同一支才等於
 *   「表單收得下的,金流才送得出去」,兩邊不會各長出一套標準。
 *
 * 🔴 為什麼是「逐個候選試」而不是「第一個非空的就定生死」(同上 must-fix):
 *   地址存著髒 email(繞過表單寫進 DB)而 session email 完全合格時,
 *   前者會**誤擋一個本來付得成功的客人**。逐個試 ⇒ 只有全部候選都不可用才擋。
 *
 * 回傳 **parse 後的正規化值**(非原字面),送進 TapPay 的與入庫的形狀一致。
 */
function pickUsableEmail(candidates: readonly (string | null | undefined)[]): string | null {
  for (const candidate of candidates) {
    // 🔴 **不要**在這裡先 `.trim()`(codex 關卡2 round2 must-fix):schema 自己的
    //   canonicalize 只剝除半形空白 U+0020,外層再 trim 一次等於長出第二套正規化 ——
    //   tab / 全形空白包起來的髒值會被本層放行、卻是表單會拒的值,兩邊標準就分岔了。
    const parsed = AddressEmailInput.safeParse(candidate ?? '');
    if (parsed.success) return parsed.data;
  }
  return null;
}

export type BuildCardholderFailReason =
  | 'email_unusable' // 地址與 session 都拿不出 TapPay 收得下的 email(M-4b;取代舊的 email_missing)
  | 'profile_not_found' // customers 查無 row(fail-closed)
  | 'address_not_found' // addressId 非本人/不存在(RLS own-only 濾掉)
  | 'name_missing' // profile + 收件人雙空(理論不達:address.name zod min(1);防 DB 腐壞)
  | 'phone_missing'; // 地址 + profile 雙空 → 引導補手機

export type BuildCardholderResult =
  | {
      ok: true;
      cardholder: Cardholder;
      /**
       * 🔴 M-4a B-4:收件地址上那個 email 的**原值(未驗)**,給通知信的收件人解析當第三候選。
       * 驗證由呼叫端的 `resolveNotificationRecipient` 用 `NotificationEmailInput` 做 ——
       * **本檔不替它驗**:先驗會讓那道閘變成恆真守門(同 `pickUsableEmail` 上方那段的理由)。
       * ⚠️ 這個值與 `cardholder.email` **可能不同**,而那是預期的(兩者候選順位刻意相反)。
       */
      addressEmail: string | null;
    }
  | { ok: false; reason: BuildCardholderFailReason };

export type BuildCardholderDeps = {
  customers: ICustomerRepository;
  addresses: IAddressRepository;
};

/**
 * 組裝 cardholder(全 server 端來源、Q3=B 級聯、fail-closed)。
 *
 * @param input.user    server session getUser() 的 user(只取 id/email;CustomerId = user.id 既有慣例)
 * @param input.addressId 結帳地址 id(zod 已驗形狀;歸屬由 RLS own-only 重查)
 */
export async function buildCardholder(
  deps: BuildCardholderDeps,
  input: { user: { id: string; email?: string | null }; addressId: string },
): Promise<BuildCardholderResult> {
  const customer = await deps.customers.findById(input.user.id);
  if (!customer) {
    return { ok: false, reason: 'profile_not_found' };
  }

  const addresses = await deps.addresses.listByCustomer(input.user.id);
  const address = addresses.find((a) => a.id === input.addressId);
  if (!address) {
    return { ok: false, reason: 'address_not_found' };
  }

  // Q3=B 級聯 + trim min(1):name = profile → 收件人;phone = 地址 → profile。
  const name = customer.name.trim() || address.name.trim();
  if (!name) {
    return { ok: false, reason: 'name_missing' };
  }
  const phoneNumber = address.phone.trim() || customer.phone.trim();
  if (!phoneNumber) {
    return { ok: false, reason: 'phone_missing' };
  }

  // === email(M-4b LINE 3DS 修復)===
  // 候選順位:**選中收件地址的 email 優先**,不可用才試 session email。
  //   地址 email 是客人為這次收件親手填的、語意最準;session email 對 LINE 身分
  //   是合成值(`line_<sub>@…local`、64 字元),對 email 身分才是真值。
  //   舊地址(email 欄為 NULL)自然落到後者 ⇒ email 登入的客人不受影響。
  //
  // 🔴 驗證**只有 `pickUsableEmail` 這一道**,取值階段不另外先驗一次:
  //   先驗會讓這道閘變成恆真守門,而恆真守門的症狀正是「拿掉它之後沒有任何測試會紅」。
  //   現在把它拿掉,毒地址那條負測(地址存著合成域字面 + session 也不可用)
  //   就會把髒值漏給 TapPay ⇒ 紅。
  const email = pickUsableEmail([address.email, input.user.email]);
  if (email === null) {
    return { ok: false, reason: 'email_unusable' };
  }

  return {
    ok: true,
    cardholder: { name, email, phoneNumber },
    addressEmail: address.email ?? null, // B-4:原值直傳,驗證留給呼叫端
  };
}
