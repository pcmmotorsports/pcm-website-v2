import type { WalletLedgerEntry, WalletBalance, CustomerId } from '@pcm/domain';

/**
 * IWalletRepository: 儲值金 ledger 讀 + 餘額查 + 新增交易 port(M-1-14 新)。
 *
 * 對齊 PRD docs/specs/m-1-14-customer-schema.md §5(類似結構 + listEntries / addEntry / getBalance)。
 *
 * 邊界(對齊 M-1-14a RLS):
 * - listEntries / getBalance:客人讀自己(DB authenticated SELECT、RLS auth.uid() = customer_user_id)。
 * - addEntry:INSERT 走 service_role-only(deposit mock / M-3 結帳折抵都是 server-side 動作);
 *   ledger immutable、無 update / delete(DB 無 UPDATE / DELETE policy)。
 * - getBalance 來源 = customers.wallet_balance / total_deposit(Q1=B trigger 同步)、非即時 SUM。
 *
 * 實作:M-1-14d SupabaseWalletAdapter。
 */
export interface IWalletRepository {
  listEntries(customerId: CustomerId): Promise<WalletLedgerEntry[]>;
  addEntry(entry: Omit<WalletLedgerEntry, 'id' | 'createdAt'>): Promise<WalletLedgerEntry>;
  getBalance(customerId: CustomerId): Promise<WalletBalance>;
}
