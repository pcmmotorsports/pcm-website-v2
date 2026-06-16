import type { WalletLedgerEntry } from '@pcm/domain';
import type { Database } from '../database.types';

/**
 * Supabase customer_wallet_ledger row schema —— **derive 自生成 Database 型別**(backlog #106)。
 *
 * 由 database.types.ts 生成的 customer_wallet_ledger 表 Row 取用;schema 改 → 重新 gen → 此型別自動跟著變。
 * 金流紀律(生成型別保證對齊 DB):amount signed integer(CHECK wallet_amount_sign 守、mapper 純傳遞不變號)、
 * note NOT NULL string、related_order_id nullable 直送、entry_type wallet_entry_type enum == domain WalletEntryType。
 */
export type SupabaseWalletLedgerRow = Database['public']['Tables']['customer_wallet_ledger']['Row'];

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
