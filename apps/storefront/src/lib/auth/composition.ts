// lib/auth/composition.ts — 會員認證 composition root(M-1-14e-f1-pre、D-b=A)
//
// 對齊 plan v4 §2(D-b=A / PRECISION-4 / finding-5):
// - storefront 唯一注入 SupabaseAuthAdapter(IAuthService 實作)的「受控單檔」。register/login server action
//   只 import 本檔的 getAuthService()、不直接碰 @pcm/adapters/server。
// - eslint.config.js L110-126 禁整個 apps/storefront/**/*.{ts,tsx} import @pcm/adapters/server;本檔以
//   inline eslint-disable + 意圖註解開「受控小門」(比 files-override block 更可審、code-reviewer 在 import 點即見例外)。
// - getAuthService 為 async per-request factory(注入 createServerSupabaseClient() 的 cookie-aware client;
//   finding-5:Next 16 cookies() async、不可 module singleton)。

import 'server-only';
import type { IAuthService } from '@pcm/ports';
// eslint-disable-next-line no-restricted-imports -- 受控例外:composition root 注入 IAuthService;SupabaseAuthAdapter 不持 service_role(收注入的 anon-ssr client)、本檔永不 import createSupabaseServiceClient / SupabaseWalletAdapter
import { SupabaseAuthAdapter } from '@pcm/adapters/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * 建本次 request 的 IAuthService(SupabaseAuthAdapter + cookie-aware server client)。
 * server action / route handler 每次 `await getAuthService()`、不快取跨 request。
 */
export async function getAuthService(): Promise<IAuthService> {
  const supabase = await createServerSupabaseClient();
  return new SupabaseAuthAdapter(supabase);
}
