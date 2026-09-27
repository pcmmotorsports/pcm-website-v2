'use server';

import { isUuid } from '../orders/note-action-state';
import { authorizeAdminMutation } from '../session/authorize';
import { getAdminAddressRepository } from './customer-repository';
import { recentAddresses, type AddressChoice } from './manual-order-address';

// manual-order-address-actions.ts — 後台手動建單「選客人」時讀他的地址簿(Sean 2026-09-27:再建單就沒有地址)。
// 讀用既有的 SupabaseAddressAdapter.listByCustomer(客人詳情頁同一支;service_role 有 SELECT 政策),最近用過的在前。
// 🔴 只讀:寫入走建單成功後的 RPC admin_save_manual_order_address(manual-order-address.ts)。

export type ManualCustomerAddressesResult = { ok: true; addresses: AddressChoice[] } | { ok: false; message: string };

export async function loadManualCustomerAddressesAction(customerId: string): Promise<ManualCustomerAddressesResult> {
  const auth = await authorizeAdminMutation();
  if (!auth) return { ok: false, message: '登入已過期，請重新登入後再建單。' };
  if (typeof customerId !== 'string' || !isUuid(customerId)) {
    return { ok: false, message: '客人資料不完整，請重新選擇客人。' };
  }
  try {
    const list = await getAdminAddressRepository().listByCustomer(customerId);
    return { ok: true, addresses: recentAddresses(list) };
  } catch (error) {
    console.error('[admin/manual-order] 客人地址簿讀取失敗', error);
    return { ok: false, message: '客人的地址簿載入失敗，請自行填寫收件資料。' };
  }
}
