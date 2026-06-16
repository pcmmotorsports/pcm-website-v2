// app/login/page.tsx — 登入頁 route(M-1-14e-f1-a;f1-c 加 OAuth error query)
//
// /login 對齊 design AccountPages.jsx LoginPage;版面 / 表單 / 社交鈕由 client 元件 LoginPage 負責、
// 登入信任邊界由 app/login/actions.ts loginAction(server action)負責。
// f1-c:server 端讀 searchParams.error(/auth/callback 失敗導回 ?error=oauth)傳入 LoginPage oauthError prop
// (Next 16 searchParams 為 async;改 server prop 而非 client useSearchParams、免 Suspense boundary)。

import type { Metadata } from 'next';
import { LoginPage } from '@/components/LoginPage';

export const metadata: Metadata = {
  title: '登入 — PCM Motorsports',
  description: '登入你的 PCM 帳號，查看訂單與收藏。',
};

export default async function LoginRoute({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  // #190:next 原樣傳給 client(同源白名單在 sink 端〔login action / OAuth callback〕套用、非此處)。
  const { error, next } = await searchParams;
  return <LoginPage oauthError={error} next={next} />;
}
