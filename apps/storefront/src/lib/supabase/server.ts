// lib/supabase/server.ts — storefront server 端 Supabase client factory(M-1-14e-f1-pre)
//
// 對齊 PRD docs/specs/m-1-14-customer-schema.md §8.4 + plan v4 §2(GAP-1/finding-5):
// - @supabase/ssr createServerClient + Next 16 async cookies()(getAll/setAll cookie adapter)
//   → 讓 server action / route handler 的登入 session 落地到 cookie(裸 supabase-js createClient
//   無 session 持久化、會令 signInWithPassword 後 RLS authenticated 查詢拿不到 auth.uid())。
// - request-scoped:每次呼叫 await cookies() + 新建 client、**不抽 module-level singleton**
//   (對齊 packages/adapters/src/supabase/client.ts「singleton 由 runtime 決定、本檔不抽」紀律)。
// - 讀既有 env NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY(不改 env 命名、不碰 .env*)。
//
// 用途:register/login server action(@pcm/adapters/server SupabaseAuthAdapter 經 lib/auth/composition.ts
// 注入此 client)+ /auth/callback route(exchangeCodeForSession)。client 端 OAuth 發起改用 lib/supabase/browser.ts。

import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} not set`);
  }
  return value;
}

/**
 * 建 request-scoped、cookie-aware 的 Supabase server client。
 *
 * setAll 在 Server Component(唯讀 cookies)會 throw、try/catch 吞掉(對齊 @supabase/ssr 官方 pattern;
 * f1 的寫入路徑〔server action / route handler〕cookies 可寫、setAll 正常生效)。
 *
 * @throws 若 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 未 set
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
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
    },
  );
}
