import 'server-only';
import { SupabaseCustomerAdapter } from '@pcm/adapters';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

/**
 * 後台客戶 repo 建構(M-4a 客戶管理第一片;server-only、絕不入 client bundle)。
 *
 * admin 走 **service_role**(`createSupabaseServiceClient`、sb_secret_ 從 env)讀 customers —— service_role
 * BYPASSRLS 看全客人(admin 本來就要看所有客戶=預期);customers 表無經銷成本欄(§經銷隔離天生守)、
 * 且本片投影白名單排除 wallet/儲值欄。
 *
 * 🔴 server-only:本檔頂層 `import 'server-only'` + createSupabaseServiceClient 亦 server-only,client component
 * import 即編譯期報錯;service_role 金鑰只在 server runtime 讀、不進 client bundle / git。
 * 🔴 呼叫端(server component)只用 `listCustomerSummariesForAdmin`(具名白名單、排除 wallet/成本欄)。
 *
 * (未在 vitest 覆蓋:本檔 import server-only〔node/測試環境會 throw〕;純 wiring、行為由 adapter 單測 + 頁面實測驗。)
 */
export function getAdminCustomerRepository(): SupabaseCustomerAdapter {
  return new SupabaseCustomerAdapter(createSupabaseServiceClient());
}
