import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase client factories(M-1-03 main-b sub-slice 1)。
 *
 * 對齊:
 * - docs/specs/M-1-03-main-b-PRD.md §7.2 DI pattern + §7.3 service_role 紀律
 * - docs/architecture/supabase-schema-design.md §9.3 service role key 紀律
 * - packages/adapters/src/supabase/README.md env 字面
 *
 * 兩 factory 分流(對齊 PRD §7.1 三 env vars):
 * - {@link createSupabaseAnonClient}:讀 anon key、可進 client bundle、RLS-protected
 * - {@link createSupabaseServiceClient}:讀 service_role key、server-only、繞 RLS、寫操作用
 *
 * **Singleton 紀律:** 兩 factory 每次呼叫都 `createClient()` 新 instance。supabase-js
 * client 維護 fetch + auth state、per-request 建構成本非零。DI container 必須將
 * `SupabaseProductAdapter` instance 綁定到 app lifetime(server runtime singleton)、
 * 不可 per-request 建構 adapter / client。本 sub-slice 不抽 module-level singleton
 * (避免 module side-effect、影響 test 替換);singleton scope 由 DI container 決定。
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} not set`);
  }
  return value;
}

/**
 * 建 anon client(可進 client bundle、RLS-protected)。
 *
 * 讀 `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`、走 RLS、anon role、
 * 適用 storefront client / server-side render 公開 SELECT。
 *
 * @throws 若 env vars 未 set
 */
export function createSupabaseAnonClient(): SupabaseClient {
  return createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  );
}

/**
 * 建 service_role client(server-only、絕不入 client bundle / git)。
 *
 * 讀 `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`、繞 RLS、
 * 適用 `apps/api/` server runtime 寫操作(對齊 supabase-schema-design.md §9.3)。
 * `apps/storefront/` 不可呼叫此 factory(對齊 PRD §7.3)。
 *
 * @throws 若 env vars 未 set
 */
export function createSupabaseServiceClient(): SupabaseClient {
  return createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  );
}
