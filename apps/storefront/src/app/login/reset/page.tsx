// app/login/reset/page.tsx — 設定新密碼頁 route(忘記密碼接線片,🔴 安全重點)
//
// 對齊 plan(docs/specs/2026-08-07-forgot-password-wire-plan-draft.md)§3-3:
// OD 逐字「不能讓人填完兩次新密碼才說過期,那是把人耍一輪」——recovery session 有效性必須在
// **渲染前**驗完,狀態 B(連結失效)是 server 端直接決定要不要渲染表單,不是 client 端事後才判。
//
// 🔴 本頁不做 code 交換(plan §3-4 A 案已批准):交換已在既有、已審過的 /auth/callback 完成
// (forgot actions.ts 的 redirectTo 指向 `${base}/auth/callback?next=/login/reset`),本頁只讀 session。
//
// 無 user → 直接渲染稿的狀態 B(連結失效),不渲染表單(這段是純靜態 markup、無互動邏輯,
// 不需要 client 元件,直接寫在本 server component 裡)。
// 有 user → 渲染 <ResetPasswordPage email={user.email} />(稿狀態 A 要顯示帳號 email)。

import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';
import { ResetPasswordPage } from '@/components/ResetPasswordPage';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: '設定新密碼 — PCM重機零件販售',
  description: '為您的 PCM 帳號設定一組新密碼。',
};

export default async function ResetPasswordRoute() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="ap-page">
        <Header currentPage="login" />
        <main className="auth-main">
          <div className="auth-card">
            <div className="auth-icon-warn" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16.5h.01"/></svg>
            </div>
            <div className="ap-mono">Link expired</div>
            <h1>這個連結不能用了</h1>
            <p className="auth-sub">重設密碼的連結有時效，也只能用一次。以下三種情況最常見：</p>

            <ul className="auth-steps">
              <li>信寄出<b>超過 1 小時</b>了。</li>
              <li>這個連結<b>已經用過一次</b>。</li>
              <li>後來又要了<b>新的一封信</b>，舊連結就自動失效。</li>
            </ul>

            <Link className="auth-submit auth-submit-link" href="/login/forgot">重新要一封信</Link>

            <div className="auth-foot">
              想起密碼了？<Link href="/login">回去登入</Link>
            </div>
          </div>
        </main>
        <HomeFooter />
      </div>
    );
  }

  return <ResetPasswordPage email={user.email ?? ''} />;
}
