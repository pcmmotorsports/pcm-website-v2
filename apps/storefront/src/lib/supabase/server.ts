// lib/supabase/server.ts — storefront server 端 Supabase client factory(M-1-14e-f1-pre;f1-c 順手改靜態 env)
//
// 對齊 PRD docs/specs/m-1-14-customer-schema.md §8.4 + plan v4 §2(GAP-1/finding-5):
// - @supabase/ssr createServerClient + Next 16 async cookies()(getAll/setAll cookie adapter)
//   → 讓 server action / route handler 的登入 session 落地到 cookie(裸 supabase-js createClient
//   無 session 持久化、會令 signInWithPassword 後 RLS authenticated 查詢拿不到 auth.uid())。
// - request-scoped:每次呼叫 await cookies() + 新建 client、**不抽 module-level singleton**
//   (對齊 packages/adapters/src/supabase/client.ts「singleton 由 runtime 決定、本檔不抽」紀律)。
// - env 用「靜態字面」存取 process.env.NEXT_PUBLIC_*:server 端 Node runtime 本有完整 env、動態存取亦可,
//   但 f1-c 與 browser.ts 統一改靜態、防未來誤用此檔於 client/edge runtime 時 env 取不到(對齊 backlog #182)。
//   (不改 env 命名、不碰 .env*。)
//
// 用途:register/login server action(@pcm/adapters/server SupabaseAuthAdapter 經 lib/auth/composition.ts
// 注入此 client)+ /auth/callback route(exchangeCodeForSession)。client 端 OAuth 發起改用 lib/supabase/browser.ts。

import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * 建 request-scoped、cookie-aware 的 Supabase server client。
 *
 * setAll 在 Server Component(唯讀 cookies)會 throw、try/catch 吞掉(對齊 @supabase/ssr 官方 pattern;
 * f1 的寫入路徑〔server action / route handler〕cookies 可寫、setAll 正常生效)。
 *
 * @throws 若 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 未 set
 */
export async function createServerSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL not set');
  if (!anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY not set');
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // 從 Server Component 呼叫時 cookies 唯讀、忽略(session 由 server action / route handler 寫)。
        }
      },
    },
  });
}
