import 'server-only';
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
 * - {@link createSupabaseAnonClient}:讀 anon key、**server-only**(本檔頂層 import 'server-only')、RLS-protected、伺服器端公開 SELECT
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
 * 建 anon client(**server-only**〔本檔頂層 import 'server-only'〕、RLS-protected)。
 *
 * 讀 `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`、走 RLS、anon role、
 * 適用伺服器端公開 SELECT(storefront SSR / server component 讀目錄)。瀏覽器端公開讀走 storefront
 * lib/supabase/browser.ts(@supabase/ssr、非本 factory)。⚠️ env KEY 本身是公開值(NEXT_PUBLIC_*、可入
 * client bundle),但本 factory 受 server-only 約束、client component import 即 build error(#218 修正
 * 「可進 client bundle」stale 字面:audit 89a20a8 加 import 'server-only' 後註解未同步)。
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
