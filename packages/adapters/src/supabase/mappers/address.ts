import type { CustomerAddress, InvoiceType } from '@pcm/domain';

/**
 * Supabase customer_addresses row schema(對齊 migration 20260523034911 customer_addresses 表
 * + 20260523052537 patch:invoice_title / invoice_tax_id / invoice_donate_code 加 NOT NULL)。
 *
 * domain `invoice` 巢狀物件 ↔ DB 攤平 5 欄(invoice_type / invoice_carrier / invoice_title /
 * invoice_tax_id / invoice_donate_code)、由本 mapper 巢狀化 / 攤平。
 *
 * Nullable 紀律(codex 關卡1 must-fix #2):
 * - `phone` migration L45 / `invoice_carrier` L48 僅 `DEFAULT ''`、無 NOT NULL → `string | null`、`?? ''` 還原。
 * - `name` L44 / `line` L46 NOT NULL → `string`。
 * - `invoice_title` / `invoice_tax_id` / `invoice_donate_code` patch 後 NOT NULL → `string`。
 */
export type SupabaseAddressRow = {
  id: string;
  customer_user_id: string;
  is_default: boolean;
  name: string;
  phone: string | null;
  line: string;
  invoice_type: InvoiceType;
  invoice_carrier: string | null;
  invoice_title: string;
  invoice_tax_id: string;
  invoice_donate_code: string;
  created_at: string;
  updated_at: string;
};

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
  if (patch.invoice !== undefined) {
    row.invoice_type = patch.invoice.type;
    row.invoice_carrier = patch.invoice.carrier;
    row.invoice_title = patch.invoice.title;
    row.invoice_tax_id = patch.invoice.taxId;
    row.invoice_donate_code = patch.invoice.donateCode;
  }
  return row;
}
