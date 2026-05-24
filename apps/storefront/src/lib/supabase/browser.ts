// lib/supabase/browser.ts — storefront client(browser)端 Supabase client factory(M-1-14e-f1-pre)
//
// 對齊 PRD §8.4 + plan v4 §2(GAP-1 / flag-G):Google 一鍵登入是 client-initiated
// (signInWithOAuth + redirectTo `${window.location.origin}/auth/callback`、由 client component 發起)、
// 故 f1-pre 必含 browser factory(非只 server factory)。
//
// 讀 NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY(NEXT_PUBLIC_* build 期 inline、可進 client bundle)。
// 不 import 'server-only'(本檔給 client component 用);anon key + RLS、無 service_role。

import { createBrowserClient } from '@supabase/ssr';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} not set`);
  }
  return value;
}

/** 建 browser Supabase client(client component 用、anon role、給 Google signInWithOAuth)。 */
export function createBrowserSupabaseClient() {
  return createBrowserClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  );
}
