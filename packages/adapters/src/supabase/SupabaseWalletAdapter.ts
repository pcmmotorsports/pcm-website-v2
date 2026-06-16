import type { SupabaseClient } from '@supabase/supabase-js';
import type { IWalletRepository } from '@pcm/ports';
import type { CustomerId, WalletBalance, WalletLedgerEntry } from '@pcm/domain';
import type { Database } from './database.types';
import { mapSupabaseWalletEntryToDomain, mapWalletEntryToInsertRow } from './mappers/wallet';

/** PostgREST not-found error code(`.single()` 找不到 row)。 */
const PGRST_NOT_FOUND = 'PGRST116';

/** customer_wallet_ledger 表投射(對齊 migration 8 欄 L100-107)。 */
const LEDGER_SELECT =
  'id, customer_user_id, entry_date, entry_type, amount, note, related_order_id, created_at';

/**
 * SupabaseWalletAdapter:Supabase 真實 IWalletRepository 實作(M-1-14d-2、從 M-1-14d 拆出)。
 *
 * 對齊:
 * - `packages/ports/src/IWalletRepository.ts`(listEntries / addEntry / getBalance 合約)
 * - `docs/specs/m-1-14-customer-schema.md` §7 + `docs/handoff/2026-05-23-m-1-14d-2-wallet-handoff.md` §3
 * - `SupabaseCustomerAdapter` pattern(constructor DI、PGRST_NOT_FOUND;#106:client `SupabaseClient<Database>` generic、typed row、無 cast)
 *
 * **⚠️ 雙 client DI(混合 auth、與單 client 的 customer/address/vehicle adapter 不同)**:
 * - `readClient`:**必須帶當前 user session(access token)的 Supabase client(authenticated role)**。
 *   listEntries / getBalance 走此 client、靠 RLS wallet_select_own(L209-211)+ customers_select_own(L146-148)
 *   `auth.uid() = customer_user_id` 守自己 row。**不可注入裸 `createSupabaseAnonClient()`(無 session = anon role、
 *   RLS own 讀不到、回空/PGRST116)**;Supabase 的「authenticated」由是否帶 user JWT 決定、非 type 可保證,
 *   故 client 來源正確性由 e slice wire-up 負責驗收(對齊 client.ts 紀律)。
 * - `writeClient`:**service_role client**。addEntry 走此 client、因 RLS wallet_insert_service_role(L213-215)
 *   只開 service_role INSERT(authenticated 僅 SELECT GRANT L243-244)。
 *
 * **金流紀律**:
 * - amount signed integer 純傳遞、不變號、不浮點;sign 合法性由 DB CHECK wallet_amount_sign(L108-112)守。
 * - addEntry 後 customers.wallet_balance / total_deposit 由 DB on_wallet_ledger_inserted AFTER INSERT trigger
 *   (L300-315)自動同步、**adapter 不自算餘額**。
 * - ledger immutable:無 update / delete(對齊 migration L217 無 UPDATE/DELETE policy + port 無此 method)。
 * - **adapter 不做 authorization**:addEntry 用 service_role 可替任意 customer_user_id 寫 ledger,
 *   故只能由 server-side use-case 在驗證 current user / order / payment authority 後呼叫(對齊三級會員價格鐵則)。
 */
export class SupabaseWalletAdapter implements IWalletRepository {
  constructor(
    private readonly readClient: SupabaseClient<Database>,
    private readonly writeClient: SupabaseClient<Database>,
  ) {}

  /**
   * 列出某會員儲值金交易紀錄(穩定排序:entry_date desc, created_at desc)。
   * readClient(authenticated、RLS own)。error → throw。
   */
  async listEntries(customerId: CustomerId): Promise<WalletLedgerEntry[]> {
    const { data, error } = await this.readClient
      .from('customer_wallet_ledger')
      .select(LEDGER_SELECT)
      .eq('customer_user_id', customerId)
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) {
      throw error;
    }
    return data.map(mapSupabaseWalletEntryToDomain);
  }

  /**
   * 新增一筆儲值金交易(deposit / use / refund)。writeClient(service_role、RLS INSERT only-service_role)。
   *
   * amount signed int(sign 由 DB CHECK 守);DB AFTER INSERT trigger 自動同步 customers 餘額、adapter 不自算。
   * 授權由 caller(server-side use-case)負責、見 class JSDoc。error → throw。
   */
  async addEntry(entry: Omit<WalletLedgerEntry, 'id' | 'createdAt'>): Promise<WalletLedgerEntry> {
    const { data, error } = await this.writeClient
      .from('customer_wallet_ledger')
      .insert(mapWalletEntryToInsertRow(entry))
      .select(LEDGER_SELECT)
      .single();
    if (error) {
      throw error;
    }
    return mapSupabaseWalletEntryToDomain(data);
  }

  /**
   * 查某會員儲值金餘額快照。readClient(authenticated、RLS own)。
   *
   * - balance / totalDeposit 來源 = `customers.wallet_balance` / `total_deposit`(Q1=B trigger 同步、非即時 SUM)。
   *   customers 查無 row → throw(不 silent 回 0);PGRST116 在 RLS 下也可能是 session 不對 / customerId 非當前 user,
   *   故錯誤訊息標「not found or inaccessible」、避免誤判成 trigger 漏建 row。
   * - lastEntryAt = readClient 直查 ledger MAX(created_at)(對齊 domain WalletBalance JSDoc 語意)。
   *   對帳 view customer_wallet_balance_check 不對 authenticated GRANT(migration L246-247、僅 admin service_role),
   *   故 authenticated 端直查 ledger MAX、與 view 的 `last_entry_at = MAX(created_at)`(L131)值等價;access GRANT 強制。
   */
  async getBalance(customerId: CustomerId): Promise<WalletBalance> {
    const { data: customerRow, error: customerError } = await this.readClient
      .from('customers')
      .select('wallet_balance, total_deposit')
      .eq('user_id', customerId)
      .single();
    if (customerError) {
      if (customerError.code === PGRST_NOT_FOUND) {
        throw new Error(
          `Wallet balance not found or inaccessible for customer '${customerId}' (customers row 缺失或 RLS/session 不符)`,
        );
      }
      throw customerError;
    }

    const { data: lastRow, error: lastError } = await this.readClient
      .from('customer_wallet_ledger')
      .select('created_at')
      .eq('customer_user_id', customerId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastError) {
      throw lastError;
    }

    // #106:typed client → customerRow / lastRow 已 typed,消除舊 inline `as unknown as {...}` cast。
    return {
      customerUserId: customerId,
      balance: customerRow.wallet_balance,
      totalDeposit: customerRow.total_deposit,
      lastEntryAt: lastRow?.created_at ?? null,
    };
  }
}
