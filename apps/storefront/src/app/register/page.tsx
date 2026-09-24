// app/register/page.tsx — 註冊頁 route(M-1-14e-f1-b)
//
// /register 對齊 design AccountPages.jsx RegisterPage;版面 / 表單由 client 元件 RegisterPage 負責、
// 註冊信任邊界由 app/register/actions.ts registerAction(server action)負責。

import type { Metadata } from 'next';
import { SITE_TITLE_SUFFIX } from '@/lib/site-config';
import { RegisterPage } from '@/components/RegisterPage';
import { B2bRegisterNotice } from '@/components/B2bRegisterNotice';
import { resolveSiteMode } from '@/lib/site-mode';

export const metadata: Metadata = {
  title: `註冊${SITE_TITLE_SUFFIX}`,
  description: '建立帳號，享會員價與專屬優惠。',
};

export default async function RegisterRoute({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // #190:next 原樣傳給 client(同源白名單在 sink 端〔register action〕套用、非此處)。
  // B2B(F 節 Q2 甲):經銷站不開放註冊 —— 新帳號一定是一般會員,註冊完會被登出。伺服器端 registerAction 另外也擋。
  const { next } = await searchParams;
  if (resolveSiteMode() === 'b2b') return <B2bRegisterNotice next={next} />;
  return <RegisterPage next={next} />;
}
