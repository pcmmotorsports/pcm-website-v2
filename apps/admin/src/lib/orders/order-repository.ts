import 'server-only';
import { SupabaseOrderAdapter } from '@pcm/adapters';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

/**
 * 後台訂單 repo 建構(M-4a 訂單線第一片;server-only、絕不入 client bundle)。
 *
 * admin 走 **service_role**(`createSupabaseServiceClient`、sb_secret_ 從 env)讀 orders —— orders 表對
 * service_role 已於 migration 20260611120000「admin 唯讀」保留 SELECT、且表本身無經銷成本欄(§經銷隔離天生守);
 * BYPASSRLS 繞 own-policy 屬預期(admin 看全客人單)。
 *
 * 🔴 server-only:本檔頂層 `import 'server-only'` + createSupabaseServiceClient 亦 server-only,client component
 * import 即編譯期報錯;service_role 金鑰只在 server runtime 讀、不進 client bundle / git。
 * 🔴 只暴露列表所需:回傳 SupabaseOrderAdapter 實例,呼叫端(server component)僅用 `listOrderSummariesForAdmin`
 * (具名白名單投影、零成本欄)。建單 / 付款相關方法不在後台列表路徑使用。
 *
 * (未在 vitest 覆蓋:本檔 import server-only〔node/測試環境會 throw〕;純 wiring、行為由 adapter 單測 + 頁面實測驗。)
 */
export function getAdminOrderRepository(): SupabaseOrderAdapter {
  return new SupabaseOrderAdapter(createSupabaseServiceClient());
}
