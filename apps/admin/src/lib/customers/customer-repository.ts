import 'server-only';
import {
  SupabaseAddressAdapter,
  SupabaseCustomerAdapter,
  SupabaseVehicleAdapter,
} from '@pcm/adapters';
import { createSupabaseServiceClient, SupabaseWalletAdapter } from '@pcm/adapters/server';

/**
 * 後台客戶 repo 建構(M-4a 客戶管理第一片;server-only、絕不入 client bundle)。
 *
 * admin 走 **service_role**(`createSupabaseServiceClient`、sb_secret_ 從 env)讀 customers —— service_role
 * BYPASSRLS 看全客人(admin 本來就要看所有客戶=預期);customers 表無經銷成本欄(§經銷隔離天生守)。
 * 列表走 `listCustomerSummariesForAdmin`(ADMIN_CUSTOMER_LIST_SELECT 具名白名單、不帶 wallet/birthday);
 * 明細-a 起 `findById` 含 wallet_balance/total_deposit/birthday(Sean 2026-07-16 拍板 admin 後台顯示儲值金、
 * override 05-31 前台 hold;PII 只在明細頁、登入閘後)。
 *
 * 🔴 server-only:本檔頂層 `import 'server-only'` + createSupabaseServiceClient 亦 server-only,client component
 * import 即編譯期報錯;service_role 金鑰只在 server runtime 讀、不進 client bundle / git。
 *
 * (未在 vitest 覆蓋:本檔 import server-only〔node/測試環境會 throw〕;純 wiring、行為由 adapter 單測 + 頁面實測驗。)
 */
export function getAdminCustomerRepository(): SupabaseCustomerAdapter {
  return new SupabaseCustomerAdapter(createSupabaseServiceClient());
}

/**
 * 後台儲值金 repo 建構(M-4a 客戶明細-a;server-only)。
 *
 * SupabaseWalletAdapter 雙 client DI 原設計為 storefront(readClient=authenticated RLS own /
 * writeClient=service_role)。admin 端讀「任意客戶」流水 = read 槽注 **service_role**
 * (BYPASSRLS 看全客人=後台預期、同 getAdminCustomerRepository 理由);呼叫端只用 `listEntries`。
 *
 * 🔴 write 槽=毒化 client(儲值金編輯片;明細-a reviewer 記的 poisoned-write-client 選項採用):
 * admin 儲值金寫入唯一路 = `adjustCustomerWallet`(admin_adjust_wallet owner RPC、同交易寫 audit);
 * `addEntry` 直插 ledger 會**繞過稽核** → write 槽注「碰即 throw」client,未來誤接立即爆、不靜默。
 * (apps/admin 內 addEntry 0 呼叫點;全 repo 1 處=packages/use-cases/deposit-wallet.ts 未接線
 * use-case、不經本 getter,不受影響。)
 *
 * (未在 vitest 覆蓋:同上檔頭理由——server-only 純 wiring。)
 */
export function getAdminWalletRepository(): SupabaseWalletAdapter {
  return new SupabaseWalletAdapter(createSupabaseServiceClient(), createPoisonedWalletWriteClient());
}

type WalletWriteClient = ConstructorParameters<typeof SupabaseWalletAdapter>[1];

function createPoisonedWalletWriteClient(): WalletWriteClient {
  return new Proxy({} as object, {
    get(_target, prop) {
      throw new Error(
        `admin wallet write 槽已毒化(存取 ${String(prop)}):儲值金寫入唯一路=adjustCustomerWallet(admin_adjust_wallet RPC、同交易稽核);addEntry 直插=繞過 audit,禁用。`,
      );
    },
  }) as WalletWriteClient;
}

/** RPC 業務結果碼(輸入非法/DB error=throw,由 caller 收斂固定碼)。 */
export type AdminWalletAdjustResult = 'ADJUSTED' | 'NOT_FOUND';

/**
 * 儲值金調整(M-4a 儲值金編輯片;走 admin_adjust_wallet owner RPC〔20260716210000〕)。
 *
 * 🔴 唯一寫入路:RPC 內 ledger INSERT + admin_audit_log INSERT 同交易、餘額只走 DB trigger
 * (函式體零 UPDATE customers=禁裸覆寫);EXECUTE 僅 service_role。
 * signedAmount 已轉號(deposit=+n / use=-n;parseWalletAdjustForm 產出)。
 * 回 'ADJUSTED'/'NOT_FOUND';error(輸入非法/DB)→ 裸 throw(caller server action 收斂固定碼)。
 */
export async function adjustCustomerWallet(args: {
  customerId: string;
  entryType: 'deposit' | 'use';
  signedAmount: number;
  note: string;
  actor: string;
  requestId: string;
}): Promise<AdminWalletAdjustResult> {
  const { data, error } = await createSupabaseServiceClient().rpc('admin_adjust_wallet', {
    p_customer_user_id: args.customerId,
    p_entry_type: args.entryType,
    p_amount: args.signedAmount,
    p_note: args.note,
    p_actor: args.actor,
    p_request_id: args.requestId,
  });
  if (error) {
    throw error;
  }
  // RPC RETURNS text scalar → data 即 'ADJUSTED'/'NOT_FOUND';防腐壞收斂(鏡像 updateAdminOrderWorkflow)。
  if (data === 'ADJUSTED' || data === 'NOT_FOUND') {
    return data;
  }
  throw new Error('admin_adjust_wallet RPC 回傳非預期碼');
}

/**
 * 後台地址/車庫 repo 建構(M-4a 客戶明細-b;server-only、唯讀呼叫)。
 *
 * 兩 adapter 原設計注 authenticated client(RLS own);admin 注 **service_role**
 * (BYPASSRLS 看任意客戶=後台預期),scoping 由 adapter `listByCustomer` 顯式
 * `.eq('customer_user_id', id)` 保證。呼叫端只用 `listByCustomer`(create/update/delete
 * 不在明細-b、後台寫入片另議)。訂單歷史走既有 `getAdminOrderRepository`(lib/orders)。
 */
export function getAdminAddressRepository(): SupabaseAddressAdapter {
  return new SupabaseAddressAdapter(createSupabaseServiceClient());
}

export function getAdminVehicleRepository(): SupabaseVehicleAdapter {
  return new SupabaseVehicleAdapter(createSupabaseServiceClient());
}
