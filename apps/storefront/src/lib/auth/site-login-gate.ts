// lib/auth/site-login-gate.ts —— 剛登入的那一刻確認「這個帳號能不能用這個站」(B2B 計畫第四版 C 節 L2)。
//
// 四個會建立登入狀態的入口都在「登入成功、導頁之前」呼叫 checkSiteAfterLogin():
// 帳密登入、註冊直登、/auth/callback(Google 與信件連結)、LINE callback。
// 放行 ⇒ 回 null,入口照原本導頁;不放行 ⇒ 這裡已登出,入口改導到 siteLoginErrorPath()。
//
// 🔴 登入當下查不到等級 ⇒ 兩站都不給登入(Codex R3 必修 1):一般站若照「查不到給一般價」放行,
//    經銷帳號就登得進一般站。
// 🔴 登出只清本機(計畫 C1):不撤銷這個人在另一站的登入。
// 🔴 signOut 失敗時不會清 cookie(@supabase/auth-js 2.105.3 `_signOut`:API 回 5xx 或網路錯就直接回 error、
//    不走 _removeSession)⇒ 那樣錯站帳號會繼續登著。所以之後一律再把登入 cookie 直接刪掉。
import 'server-only';
import { cookies } from 'next/headers';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { resolveSiteMode } from '@/lib/site-mode';
import { authCookieBase, decideSiteAccess, isAuthCookieName, resolveRawTier, tierReaderFrom } from '@/lib/site-access';
import { sanitizeNextParam } from '@/lib/auth/safe-redirect';
import type { SiteLoginError } from '@/lib/auth/site-login-copy';

/** 放行回 null;不放行 ⇒ 已登出,回登入頁要顯示的錯誤碼。 */
export async function checkSiteAfterLogin(): Promise<SiteLoginError | null> {
  // 🔴 登入狀態在呼叫前就寫好了 ⇒ 這裡任何沒料到的例外都要當成「不放行」,不能讓它往外丟而把登入留著
  //    (Fable L2a R2 consider 1:結構上 fail-closed)。
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>> | undefined;
  let code: SiteLoginError;
  try {
    supabase = await createServerSupabaseClient();
    const access = decideSiteAccess(resolveSiteMode(), await resolveRawTier(tierReaderFrom(supabase)));
    if (access.kind === 'allowed') return null;
    code =
      access.kind === 'disabled'
        ? 'site-disabled'
        : access.kind === 'wrong-site'
          ? access.reason === 'member-on-b2b'
            ? 'site-member-on-b2b'
            : 'site-dealer-on-retail'
          : 'site-unknown'; // unknown,或剛登入卻讀不到使用者(guest)——都是「無法確認」
  } catch (err) {
    console.error('[site-login-gate] 站別檢查丟例外,當成無法確認並登出:', err);
    code = 'site-unknown';
  }

  try {
    await supabase?.auth.signOut({ scope: 'local' });
  } catch (err) {
    console.error('[site-login-gate] signOut 丟例外,改直接刪登入 cookie:', err);
  }
  await deleteAuthCookies();
  return code;
}

/** 登入 cookie:`sb-<ref>-auth-token` 與分段 `.0`、`.1`…;不含 `-code-verifier`(計畫 L3 細節 3)。 */
async function deleteAuthCookies(): Promise<void> {
  const base = authCookieBase();
  if (!base) return;
  const store = await cookies();
  for (const c of store.getAll()) {
    // 登入 cookie 都寫在 path=/;Next 的 cookies().delete 預設也是 '/',這裡寫明。
    if (isAuthCookieName(c.name, base)) store.delete({ name: c.name, path: '/' });
  }
}

/** 不放行時的導頁目的地。next 照 sanitizeNextParam 白名單帶回去,重試成功後仍能回原頁。 */
export function siteLoginErrorPath(code: SiteLoginError, next?: string | null): string {
  return next ? `/login?error=${code}&next=${encodeURIComponent(sanitizeNextParam(next))}` : `/login?error=${code}`;
}
