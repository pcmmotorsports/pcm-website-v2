import type { CustomerAddress } from '@pcm/domain';
import type { Database } from '../database.types';

/**
 * Supabase customer_addresses row schema —— **derive 自生成 Database 型別**(backlog #106)。
 *
 * 由 database.types.ts 生成的 customer_addresses 表 Row 取用;schema 改 → 重新 gen → 此型別自動跟著變。
 * domain `invoice` 巢狀物件 ↔ DB 攤平 5 欄(invoice_type / invoice_carrier / invoice_title /
 * invoice_tax_id / invoice_donate_code)、由本 mapper 巢狀化 / 攤平。Nullable / enum 由生成型別保證對齊 DB
 * (phone / invoice_carrier nullable `?? ''` 還原;invoice_type invoice_type enum == domain InvoiceType)。
 */
export type SupabaseAddressRow = Database['public']['Tables']['customer_addresses']['Row'];

/** INSERT row(id / created_at / updated_at 走 DB default、不送)。 */
export type SupabaseAddressInsertRow = Omit<
  SupabaseAddressRow,
  'id' | 'created_at' | 'updated_at'
>;

/** UPDATE row partial(id / created_at / updated_at / customer_user_id 不可改 → 排除)。 */
export type SupabaseAddressUpdateRow = Partial<
  Omit<SupabaseAddressRow, 'id' | 'created_at' | 'updated_at' | 'customer_user_id'>
>;

/**
 * wire customer_addresses row → domain CustomerAddress(攤平 invoice 5 欄巢狀化回 invoice 物件)。
 *
 * customer_user_id → customerUserId / is_default → isDefault;phone / invoice_carrier nullable → `?? ''`。
 */
export function mapSupabaseAddressToDomain(row: SupabaseAddressRow): CustomerAddress {
  return {
    id: row.id,
    customerUserId: row.customer_user_id,
    isDefault: row.is_default,
    name: row.name,
    phone: row.phone ?? '',
    line: row.line,
    // 🔴 email **不套 `?? ''`**(與上面 phone 刻意不同):null 要原樣傳到 domain,
    //    因為「從沒填過(null)」與「填了又清空('')」在結帳時的處理不同(見 domain 註解)。
    email: row.email,
    invoice: {
      type: row.invoice_type,
      carrier: row.invoice_carrier ?? '',
      title: row.invoice_title,
      taxId: row.invoice_tax_id,
      donateCode: row.invoice_donate_code,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * domain create input → wire INSERT row(攤平 invoice 巢狀物件為 5 欄)。
 */
export function mapAddressToInsertRow(
  addr: Omit<CustomerAddress, 'id' | 'createdAt' | 'updatedAt'>,
): SupabaseAddressInsertRow {
  return {
    customer_user_id: addr.customerUserId,
    is_default: addr.isDefault,
    name: addr.name,
    phone: addr.phone,
    line: addr.line,
    email: addr.email,
    invoice_type: addr.invoice.type,
    invoice_carrier: addr.invoice.carrier,
    invoice_title: addr.invoice.title,
    invoice_tax_id: addr.invoice.taxId,
    invoice_donate_code: addr.invoice.donateCode,
  };
}

/**
 * domain patch → wire UPDATE row(只含 present top-level key;invoice present 則攤平全 5 欄)。
 *
 * customerUserId / id / createdAt / updatedAt 不可改、即使 patch 帶到也忽略(reassign 無意義 + RLS WITH CHECK 守)。
 */
export function mapAddressPatchToRow(patch: Partial<CustomerAddress>): SupabaseAddressUpdateRow {
  const row: SupabaseAddressUpdateRow = {};
  if (patch.isDefault !== undefined) row.is_default = patch.isDefault;
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.phone !== undefined) row.phone = patch.phone;
  if (patch.line !== undefined) row.line = patch.line;
  if (patch.email !== undefined) row.email = patch.email;
  if (patch.invoice !== undefined) {
    row.invoice_type = patch.invoice.type;
    row.invoice_carrier = patch.invoice.carrier;
    row.invoice_title = patch.invoice.title;
    row.invoice_tax_id = patch.invoice.taxId;
    row.invoice_donate_code = patch.invoice.donateCode;
  }
  return row;
}
