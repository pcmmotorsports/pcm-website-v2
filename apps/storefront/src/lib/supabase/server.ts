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
import { resolveSiteMode } from '@/lib/site-mode';
import { authCookieBase, isAuthCookieName } from '@/lib/site-access';

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
    // 🔴 B2B D1(20260925050000):告訴資料庫這個請求來自哪個站。create_order 依它擋錯站建單
    //   (關掉「網站 L4 檢查與建單之間等級被改」的空窗);PostgREST 放進 request.headers。
    //   D1 貼上前資料庫不看它,先上碼無害。只在 server client 帶,瀏覽器端不帶。
    global: { headers: { 'x-pcm-site': resolveSiteMode() } },
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

// ══════════════════════════════════════════════════════════════════════════
// 登入用的 client(2026-09-26, 計畫 ~/pcm-mailbox/計畫-共用登入client競態-20260926.md 第 2 版, Sean Q27 甲)
// ══════════════════════════════════════════════════════════════════════════
// 🔴 為什麼要另一個函式:@supabase/ssr 0.10.3 createServerClient 一建立就掛 onAuthStateChange
//    (createServerClient.js:48), auth-js 2.105.3 因此在背景讀目前的登入;登入已過期或 90 秒內會過期
//    (EXPIRY_MARGIN_MS)就用舊的 refresh token 換新並寫回 cookie。登入的呼叫(signInWithPassword /
//    exchangeCodeForSession / verifyOtp)不等它, 換發比登入晚回來, 舊帳號就蓋掉剛登入的新帳號。
//    正式站 2026-09-25 19:33 點確認信發生過一次。重現測試:server-race.test.ts(真的套件, 只假網路)。
// ✅ 修法:登入前, 舊登入已過期或 120 秒內會過期才把它刪掉 ⇒ 背景沒有東西可換發。還有效的登入不動
//    (同一個確認連結開第二次時, 剛建立的新登入要留著)。只刪本體與 .0 .1… 分段(isAuthCookieName),
//    不動 Google 登入用的 -code-verifier。120 秒 = auth-js 的 90 秒再加 30 秒, 蓋過兩邊判斷時間的差距。
// ⛔ 不採用「建完 client 先 await getSession()」:換發舊登入時 auth-js 的 _saveSession 會先刪 code-verifier,
//    Google 登入會直接失敗(重現測試有一支專門證明)。
// 🔴 呼叫端注意:刪 cookie 和登入之間不能先建其他讀 cookie 的 server client(例如登入前呼叫 getVerifiedUser()),
//    否則那個 client 會在背景把舊登入換發回來。
// 🔴 只給 server action / route handler 用。頁面(Server Component)的 cookies 唯讀, 刪不掉;這裡吞掉錯誤不讓整頁壞,
//    但那樣就沒有防到競態(Fable R1 consider 1)。
// 🔵 假設:Supabase 的 access token 有效期 > 12 分鐘(預設 3600 秒;設定在 Supabase 後台, repo 查不到)。
//    /auth/confirm「同一個連結 10 分鐘內開第二次仍顯示成功」靠第一次建立的登入那時還沒進入 120 秒門檻;
//    有效期若設到 12 分鐘以下, 第二次開會把新登入當成快過期而刪掉(Fable R1 consider 2)。

/** auth-js 剩 90 秒就背景換發;多 30 秒蓋過兩邊判斷時間的差距。 */
const STALE_LOGIN_MS = 120_000;

/** 登入、確認信、第三方登入回呼用:先清掉快過期的舊登入, 再建 client。 */
export async function createSignInSupabaseClient() {
  await dropStaleLogin();
  return createServerSupabaseClient();
}

async function dropStaleLogin(): Promise<void> {
  const base = authCookieBase();
  if (!base) return;
  const store = await cookies();
  const mine = store.getAll().filter((c) => isAuthCookieName(c.name, base) && c.value !== '');
  if (mine.length === 0) return;
  // 同 @supabase/ssr 的讀法:有本體就用本體, 否則 .0 .1… 依序接起來
  const whole =
    mine.find((c) => c.name === base)?.value ??
    mine
      .map((c) => ({ c, i: c.name.slice(base.length + 1) }))
      .filter(({ i }) => /^\d+$/.test(i))
      .sort((a, b) => Number(a.i) - Number(b.i))
      .map(({ c }) => c.value)
      .join('');
  let expiresAt = 0;
  try {
    expiresAt = Number(JSON.parse(Buffer.from(whole.replace(/^base64-/, ''), 'base64url').toString('utf8')).expires_at) || 0;
  } catch {
    // 讀不懂 ⇒ 當成過期一起刪(本站寫出的登入 cookie 一律是 base64- 開頭, 讀不懂的只會是壞掉的)
  }
  if (expiresAt * 1000 - Date.now() > STALE_LOGIN_MS) return;
  try {
    for (const c of mine) store.delete({ name: c.name, path: '/' });
  } catch {
    // 頁面(Server Component)cookies 唯讀 ⇒ 刪不掉, 維持原樣(見上方呼叫端注意)
  }
}
