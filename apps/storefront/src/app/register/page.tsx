// app/register/page.tsx — 註冊頁 route(M-1-14e-f1-b)
//
// /register 對齊 design AccountPages.jsx RegisterPage;版面 / 表單由 client 元件 RegisterPage 負責、
// 註冊信任邊界由 app/register/actions.ts registerAction(server action)負責。

import type { Metadata } from 'next';
import { RegisterPage } from '@/components/RegisterPage';

export const metadata: Metadata = {
  title: '註冊 — PCM Motorsports',
  description: '建立帳號，享會員價與專屬優惠。',
};

export default function RegisterRoute() {
  return <RegisterPage />;
}
