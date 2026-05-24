import type { IWalletRepository } from '@pcm/ports';
import type { WalletLedgerEntry, CustomerId } from '@pcm/domain';

/**
 * depositWallet:會員錢包儲值 use-case(M-1-14e-3、PRD docs/specs/m-1-14-customer-schema.md L72 + §3.5)。
 *
 * **mock 邊界(誠實)**:Phase 1 不接真金流(TapPay 真刷卡留 M-3);e-3 只記一筆 deposit ledger entry,
 * 餘額(customers.wallet_balance / total_deposit)由 DB AFTER INSERT trigger sync_wallet_balance_on_ledger_insert
 * 自動同步、use-case 不自算(對齊 SupabaseWalletAdapter + migration 20260523034911)。付款方式不入帳(ledger 無此欄)。
 *
 * **金額紀律(server 端、D4 Sean 拍)**:
 * - 完整表單驗證(整數 / ≥100 / ≤1,000,000 / paymentMethod)在 delivery 層 @pcm/schemas DepositInput.parse
 *   (server-side、架構決策 A;use-case 不 re-parse、不 import schemas、守 boundary A)。
 * - use-case 自守一道最小 domain 不變量 guard:amount 須為正整數(縱深防禦,即使 delivery 漏驗也擋
 *   負數 / 浮點 / 0;業務界線 ≥100/≤1M 不在此守、留 delivery;DB CHECK wallet_amount_sign 為最後防線)。
 *
 * **信任邊界**:currentUserId 只由 server session 取(caller 傳)、不信表單 body;deposit 只能記自己的
 * (customerUserId 用 currentUserId 填、entryType 固定 'deposit'、caller 無法覆寫);DB FK 守 customer 存在性。
 *
 * **service_role write**:走 walletRepo.addEntry → adapter writeClient(service_role)、use-case 不碰 client;
 * ledger immutable(無 update / delete)、單筆 insert(非 e-2 兩步 unset→set pattern、無 swap、無遞補)。
 *
 * entryDate / note 由 use-case 內部產(D2 Sean 拍):entryDate = 台灣當日(D3、Asia/Taipei、非 UTC);
 * note 對齊 design WalletTab DepositModal「儲值 NT$ X」(server 端鎖 en-US 千分位、值穩定不依賴 server locale)。
 *
 * @returns 新增的 ledger entry(D1b:只回帳;更新後餘額由 delivery 另呼 getBalance 取、trigger 同步後可得)。
 */
export async function depositWallet(
  walletRepo: IWalletRepository,
  currentUserId: CustomerId,
  amount: number,
): Promise<WalletLedgerEntry> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`depositWallet: amount 須為正整數(收到 ${amount})`);
  }
  return walletRepo.addEntry({
    customerUserId: currentUserId,
    entryDate: taipeiToday(),
    entryType: 'deposit',
    amount,
    note: `儲值 NT$ ${amount.toLocaleString('en-US')}`,
    relatedOrderId: null,
  });
}

/**
 * 台灣當日 YYYY-MM-DD(Asia/Taipei、D3 Sean 拍)。
 *
 * 用 formatToParts 抽 year/month/day 自組,不依賴 locale 預設日期格式 / 分隔符(en-CA 僅為保證 ASCII 數字、
 * 排列由自組保證;避免 runtime locale 差異,codex 關卡2 consider)。
 */
function taipeiToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: 'year' | 'month' | 'day') => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
