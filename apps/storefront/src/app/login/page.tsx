// app/login/page.tsx — 登入頁 route(M-1-14e-f1-a)
//
// /login 對齊 design AccountPages.jsx LoginPage;版面 / 表單 / 社交鈕由 client 元件 LoginPage 負責、
// 登入信任邊界由 app/login/actions.ts loginAction(server action)負責。

import type { Metadata } from 'next';
import { LoginPage } from '@/components/LoginPage';

export const metadata: Metadata = {
  title: '登入 — PCM Motorsports',
  description: '登入你的 PCM 帳號，查看訂單與收藏。',
};

export default function LoginRoute() {
  return <LoginPage />;
}
