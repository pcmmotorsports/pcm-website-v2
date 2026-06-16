// app/auth/callback/route.ts — Google OAuth callback route handler(M-1-14e-f1-c)
//
// 對齊 plan v4 §5 f1-c + PRD §8.4(OAuth client-initiated、刻意繞 IAuthService port):
// - client(LoginPage Google 鈕)signInWithOAuth → Google 同意 → 帶 ?code 重導回本 route。
// - 本 route exchangeCodeForSession(code):換 session + 寫 session cookie
//   (lib/supabase/server.ts setAll 在 route handler 可寫、session 落地)。
// - 成功 → redirect POST_AUTH_REDIRECT('/'、已登入態);無 code / 交換失敗 → redirect /login?error=oauth
//   (LoginPage 讀 ?error 顯示 auth-err;不上洩 Supabase 原始 error)。
// - **redirect 用 next/navigation redirect() + 相對路徑(非 NextResponse.redirect + request origin)**:
//   避免從請求 host 組絕對 URL 的 host-header open-redirect 風險(codex 關卡2 must-fix);
//   相對 Location 由瀏覽器對實際 host 解析、目標路徑固定站內。session cookie 經 cookies() 機制保留
//   (與 loginAction/registerAction 同模式、已驗運作)。
// - OAuth 首登會員由 DB handle_new_auth_user trigger 自動建 customers row、phone=''(DEFAULT;D-g 手機必填
//   只約束 email 註冊表單、OAuth 會員 phone 可空、補 phone 留 stage g / backlog #179)。本 route 不產 migration、
//   不改 schema / trigger(既有 DB 已支援)。
// - OAuth 繞 port:exchangeCodeForSession 走 supabase client 原生方法、不經 IAuthService(PRD §8.4 刻意設計)。

import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { sanitizeNextParam } from '@/lib/auth/safe-redirect';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  // #190:next 來自 redirectTo query(LoginPage 帶);🔴 sanitizeNextParam 同源白名單(此 sink 為權威)。
  const next = url.searchParams.get('next');

  if (code) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // 相對路徑;session cookie 已由 exchangeCodeForSession 經 cookies() 寫入。next 白名單後導回(不安全→ '/')。
      redirect(sanitizeNextParam(next));
    }
  }
  // 無 code 或交換失敗 → 回登入頁顯示錯誤(net-new 技術字面、不上洩 Supabase 原始 error)。
  redirect('/login?error=oauth');
}
