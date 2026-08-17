import type {
  WalletLedgerEntry,
  WalletBalance,
  CustomerId,
  Paginated,
  PaginationParams,
} from '@pcm/domain';

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
  /**
   * 列出某會員儲值金交易紀錄 —— **一頁**,不是全部。
   *
   * 🔴 **2026-08-17 由「回傳全部」改為「回傳一頁」,而這是【目標】的改變不是【實作】的改變。**
   * 舊簽名的語意是「給我全部」,而 PostgREST 對「全部」的回答是**靜默停在 `db-max-rows`(實測 1000)**
   * —— HTTP 仍 200、`content-range` 不反映 ⇒ 呼叫端偵測不到。
   * 前三個版本都在解「**怎麼可靠地拿到全部**」(分頁撈完 / count 對帳 / 超限失敗),
   * 而換角度審設計指出:**那個目標本身錯了** —— 沒有人要一次看完一輩子的流水。
   * ⇒ **改成分頁「顯示」而不是分頁「撈取」**:畫面印「共 N 筆(第 X／Y 頁)」,
   *   而 `total` 由 PostgREST 的 `count:'exact'` 給 —— **它不受 `db-max-rows` 限制**
   *   (實測:19,777 / 50,925 / 87,619 三張大表皆回真值;小表 `categories` 回 107)
   *   ⇒ **「靜默少列」這個狀態不再存在**,不需要任何截斷偵測。
   *
   * `params.limit` = 每頁筆數;`params.offset` = 已跳過筆數(省略 = 0)。
   * 回傳 `total` = 該會員的**總筆數**(不是本頁筆數)。
   *
   * ⚠️ **命名照 `apps/admin` 既有列表慣例**;若 `IOrderRepository.listSummariesByCustomer`
   * 日後也拆成「後台分頁版 / 前台既有版」,此處要跟著對齊。
   */
  listEntries(
    customerId: CustomerId,
    params: PaginationParams,
  ): Promise<Paginated<WalletLedgerEntry>>;
  addEntry(entry: Omit<WalletLedgerEntry, 'id' | 'createdAt'>): Promise<WalletLedgerEntry>;
  getBalance(customerId: CustomerId): Promise<WalletBalance>;
}
