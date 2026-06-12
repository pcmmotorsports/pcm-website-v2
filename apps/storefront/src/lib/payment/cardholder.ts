// lib/payment/cardholder.ts — cardholder server 組裝(M-3 ②-③d、MUST-FIX 3 + Q3=B 級聯)
//
// 🔴 client 零信任(指令禁止清單「cardholder 不收 client 值」):三欄全由 server 端資料組裝 ——
// - email ← user.email(Supabase session 權威;LINE 合成 email *@line.pcmmotorsports.local 已保底、
//   production 真 email follow-up 見 ②-② plan §5);空 → fail-closed 拒。
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

export type BuildCardholderFailReason =
  | 'email_missing' // user.email 空(理論不該、合成 email 已保底)
  | 'profile_not_found' // customers 查無 row(fail-closed)
  | 'address_not_found' // addressId 非本人/不存在(RLS own-only 濾掉)
  | 'name_missing' // profile + 收件人雙空(理論不達:address.name zod min(1);防 DB 腐壞)
  | 'phone_missing'; // 地址 + profile 雙空 → 引導補手機

export type BuildCardholderResult =
  | { ok: true; cardholder: Cardholder }
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
  const email = (input.user.email ?? '').trim();
  if (!email) {
    return { ok: false, reason: 'email_missing' };
  }

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

  return { ok: true, cardholder: { name, email, phoneNumber } };
}
