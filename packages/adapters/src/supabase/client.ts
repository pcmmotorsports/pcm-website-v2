import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

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
  // eslint-disable-next-line no-restricted-syntax -- 受控例外:本檔 server-only(L1 import 'server-only')、動態 requireEnv 不進 client bundle、無 env inlining 風險(backlog #182 規則 + #179 item 4 requireEnv dedup 追蹤)
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
export function createSupabaseAnonClient(opts?: {
  /**
   * 每一發 HTTP 的上限(毫秒)。**opt-in、預設不設**(主視窗 2026-09-14 批「只給讀路」):
   * 顧客站目錄那幾條讀路傳 15 秒;wallet / auth 不傳 —— 寫路逾時是「送出去了但沒收到回應」,
   * 客人看到失敗而錢已扣, 那是另一種錯, 不在這個參數裡一起解。
   *
   * 🔬 為什麼要有:正式站近 7 天 14 次「Task timed out after 300 seconds」全在頁已回 200 之後,
   *   同一發印 `rpcMs=21747`(anon statement_timeout 3 秒 ⇒ 那 21 秒是在等連線, 不是 SQL 在跑),
   *   而 supabase-js 的 fetch 預設【沒有】上限 ⇒ 掛住的連線撐到 Vercel 300 秒才放, 爬蟲一掃就疊到 OOM。
   *   到期丟的是 `TimeoutError`(DOMException), 呼叫端既有的 catch 接得到, 走 `failed` 提示 + 重試。
   */
  fetchTimeoutMs?: number;
}): SupabaseClient<Database> {
  const ms = opts?.fetchTimeoutMs;
  return createClient<Database>(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    ms == null
      ? undefined
      : {
          global: {
            fetch: (input, init) =>
              fetch(input, {
                ...init,
                // supabase-js 自己的 abortSignal(呼叫端 `.abortSignal()`)照樣有效, 兩個誰先到誰算。
                signal: init?.signal
                  ? AbortSignal.any([init.signal, AbortSignal.timeout(ms)])
                  : AbortSignal.timeout(ms),
              }),
          },
        },
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
export function createSupabaseServiceClient(): SupabaseClient<Database> {
  return createClient<Database>(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  );
}
