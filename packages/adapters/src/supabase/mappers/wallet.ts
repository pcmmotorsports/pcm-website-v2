import type { WalletEntryType, WalletLedgerEntry } from '@pcm/domain';

/**
 * Supabase customer_wallet_ledger row schema(對齊 migration 20260523034911 customer_wallet_ledger 表 L99-113)。
 *
 * Nullable 紀律(逐欄對照 migration、對齊 codex 審查):
 * - `note` L105 `NOT NULL DEFAULT ''` → `string`(**不** nullable、**不** coalesce)。
 * - `related_order_id` L106 `uuid`(無 NOT NULL)→ `string | null`、**直送 domain string | null**(domain relatedOrderId 本就 string | null、不 coalesce)。
 * - `entry_date` L102 / `entry_type` L103 / `amount` L104 / `created_at` L107 皆 NOT NULL。
 * - `amount` L104 integer NOT NULL、signed(deposit + / use - / refund +、CHECK wallet_amount_sign L108-112 守);
 *   mapper **純傳遞、不變號、不浮點、不做算術**。
 */
export type SupabaseWalletLedgerRow = {
  id: string;
  customer_user_id: string;
  entry_date: string;
  entry_type: WalletEntryType;
  amount: number;
  note: string;
  related_order_id: string | null;
  created_at: string;
};

/** INSERT row(id / created_at 走 DB default、不送)。 */
export type SupabaseWalletLedgerInsertRow = Omit<
  SupabaseWalletLedgerRow,
  'id' | 'created_at'
>;

/**
 * wire customer_wallet_ledger row → domain WalletLedgerEntry(snake_case → camelCase)。
 *
 * customer_user_id → customerUserId / entry_date → entryDate / entry_type → entryType /
 * related_order_id → relatedOrderId(string | null 直送、不 coalesce);amount 純傳遞、保留 sign。
 */
export function mapSupabaseWalletEntryToDomain(row: SupabaseWalletLedgerRow): WalletLedgerEntry {
  return {
    id: row.id,
    customerUserId: row.customer_user_id,
    entryDate: row.entry_date,
    entryType: row.entry_type,
    amount: row.amount,
    note: row.note,
    relatedOrderId: row.related_order_id,
    createdAt: row.created_at,
  };
}

/**
 * domain addEntry input → wire INSERT row。
 *
 * amount signed integer 純傳遞(不變號、不浮點);sign 合法性由 DB CHECK wallet_amount_sign(L108-112)守。
 * related_order_id 直送 string | null。
 */
export function mapWalletEntryToInsertRow(
  entry: Omit<WalletLedgerEntry, 'id' | 'createdAt'>,
): SupabaseWalletLedgerInsertRow {
  return {
    customer_user_id: entry.customerUserId,
    entry_date: entry.entryDate,
    entry_type: entry.entryType,
    amount: entry.amount,
    note: entry.note,
    related_order_id: entry.relatedOrderId,
  };
}
