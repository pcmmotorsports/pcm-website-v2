import 'server-only';
import { SupabaseOrderAdapter, SupabaseOrderStatusOptionsAdapter } from '@pcm/adapters';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { SupabaseAuditLogRepository } from '../audit/supabase-repository';
import type { AuditLogInserter } from '../audit/repository';

/**
 * 後台訂單 repo 建構(M-4a 訂單線第一片;server-only、絕不入 client bundle)。
 *
 * admin 走 **service_role**(`createSupabaseServiceClient`、sb_secret_ 從 env)讀 orders —— orders 表對
 * service_role 已於 migration 20260611120000「admin 唯讀」保留 SELECT、且表本身無經銷成本欄(§經銷隔離天生守);
 * BYPASSRLS 繞 own-policy 屬預期(admin 看全客人單)。
 *
 * 🔴 server-only:本檔頂層 `import 'server-only'` + createSupabaseServiceClient 亦 server-only,client component
 * import 即編譯期報錯;service_role 金鑰只在 server runtime 讀、不進 client bundle / git。
 * 🔴 只暴露唯讀摘要:回傳 SupabaseOrderAdapter 實例,呼叫端(server component)用 `listOrderSummariesForAdmin`
 * (訂單列表)、`findAdminOrderDetail`(明細)、`listSummariesByCustomer`(客戶明細-b 訂單歷史;
 * ⚠️ 沿用 #249 隱含濾 unpaid、揭示見 backlog #278)——皆具名白名單投影、零成本欄。
 * 建單 / 付款相關方法不在後台路徑使用。
 *
 * (未在 vitest 覆蓋:本檔 import server-only〔node/測試環境會 throw〕;純 wiring、行為由 adapter 單測 + 頁面實測驗。)
 */
export function getAdminOrderRepository(): SupabaseOrderAdapter {
  return new SupabaseOrderAdapter(createSupabaseServiceClient());
}

/**
 * 訂單處理狀態詞彙 repo(M-4a Slice A;order_status_options 對 client 全鎖 → 必走 service_role)。
 * 呼叫端(/orders server component)僅用 `listOrderStatusOptions`(具名白名單投影)。
 */
export function getAdminOrderStatusOptionsRepository(): SupabaseOrderStatusOptionsAdapter {
  return new SupabaseOrderStatusOptionsAdapter(createSupabaseServiceClient());
}

/**
 * 稽核 log repo(M-4a M0-S2 → D-3b 首個真呼叫端;admin 寫入動作寫 admin_audit_log)。
 *
 * 🔴 REQUIRED-2:service_role 對 admin_audit_log 無 SELECT → insert **禁鏈 `.select()`**(return=minimal、
 *   不回讀 id/created_at,否則 RETURNING 需 SELECT → 42501)。本 inserter 只取 { error } 形狀、天然符合。
 * 🔴 server-only:createSupabaseServiceClient 亦 server-only,client component import 即編譯期報錯。
 */
export function getAdminAuditLogRepository(): SupabaseAuditLogRepository {
  const client = createSupabaseServiceClient();
  const inserter: AuditLogInserter = {
    insert: async (row) => {
      // AdminAuditLogInsert.before/after=unknown ↔ 生成 Database Json:runtime 皆 Json 相容(null 或可序列化快照);
      // before/after 是唯一型別落差,於 supabase-js 邊界從 client 推導 insert 參數型別 cast
      // (admin app 無 Database 在手、不為此擴 @pcm/adapters barrel public API)。
      const q = client.from('admin_audit_log');
      const { error } = await q.insert(row as Parameters<typeof q.insert>[0]);
      return { error: error ? { message: error.message } : null };
    },
  };
  return new SupabaseAuditLogRepository(inserter);
}
