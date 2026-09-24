// lib/supabase/browser.ts — storefront client(browser)端 Supabase client factory(M-1-14e-f1-pre;f1-c 修 env inlining)
//
// 對齊 PRD §8.4 + plan v4 §2(GAP-1 / flag-G):Google 一鍵登入是 client-initiated
// (signInWithOAuth + redirectTo `${window.location.origin}/auth/callback`、由 client component 發起)、
// 故 f1-pre 必含 browser factory(非只 server factory)。
//
// ⚠️ env 必須「靜態字面」存取 process.env.NEXT_PUBLIC_*:Next.js 只把**靜態字面**的 NEXT_PUBLIC_* inline 進
//    client bundle;**動態存取** process.env[name](name 為變數)不會被 inline → client 端取到 undefined → 執行期 throw。
//    M-1-14e-f1-c 肉眼驗抓到此 bug:原 requireEnv(name) 動態存取令 client bundle 取不到 URL(.next 前端 chunks
//    出現 0 次)、點 Google 登入即 throw「NEXT_PUBLIC_SUPABASE_URL not set」。改靜態存取後 build 期正常 inline。
//    (單元測試在 Node env 動態查仍有值、抓不到此類 → 驗證靠瀏覽器肉眼驗。)
// 不 import 'server-only'(本檔給 client component 用);anon key + RLS、無 service_role。

import { createBrowserClient } from '@supabase/ssr';

/** 建 browser Supabase client(client component 用、anon role、給 Google signInWithOAuth)。 */
export function createBrowserSupabaseClient() {
  // 靜態字面存取(見檔頭 ⚠️):不可改回 process.env[變數]、否則 client bundle 不 inline。
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL not set');
  if (!anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY not set');
  // 🔴 B2B L2c(Codex R3 必修 2):不讓瀏覽器自己把網址上的 `?code=` 換成登入狀態。
  //    預設是開的 ⇒ 帶 `?code=`(且這台瀏覽器存著對應的 PKCE verifier)或 `#access_token=` 的頁面,
  //    會在瀏覽器端直接登入,完全不經過 L2 的四個入口(站別檢查)。
  //    ⚠️ 信件若沒指定回到 /auth/callback(例如第一次註冊的驗證信),關掉後客人驗證完仍是未登入;
  //    今天信箱驗證是關的,不會發生 —— 打開前要先處理,見 docs/launch-todo.md ⟦b4-SIGNUPOPEN1⟧。
  //    所有 code 一律由伺服器 `/auth/callback` 兌換(Google、註冊驗證、忘記密碼都以 redirectTo 進那裡)。
  return createBrowserClient(url, anonKey, { auth: { detectSessionInUrl: false } });
}
