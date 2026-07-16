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
 * writeClient=service_role)。admin 端讀「任意客戶」流水 = 兩槽皆注 **service_role**
 * (BYPASSRLS 看全客人=後台預期、同 getAdminCustomerRepository 理由);本片唯讀、
 * 呼叫端只用 `listEntries`(儲值金「修改」= 後續高風險寫入片、走 plan 關卡1、不在此)。
 *
 * (未在 vitest 覆蓋:同上檔頭理由——server-only 純 wiring。)
 */
export function getAdminWalletRepository(): SupabaseWalletAdapter {
  const client = createSupabaseServiceClient();
  return new SupabaseWalletAdapter(client, client);
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
