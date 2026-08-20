// app/login/forgot/page.tsx — 忘記密碼頁 route(忘記密碼接線片)
//
// 對齊 plan v2(docs/specs/2026-08-07-forgot-password-wire-plan-draft.md)§2-1、§6 不拆片。
// 形狀照 app/login/page.tsx:metadata + 渲染 client 元件,版面/表單邏輯全在 ForgotPasswordPage。

import type { Metadata } from 'next';
import { ForgotPasswordPage } from '@/components/ForgotPasswordPage';

export const metadata: Metadata = {
  title: '忘記密碼 — PCM重機零件販售',
  description: '輸入註冊時用的 Email，我們寄一封重設密碼的信給您。',
};

export default async function ForgotPasswordRoute({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // 🔴 #190:next 要穿過忘記密碼這條岔路。W3 R2 MF-A 實測的漏法:
  //   結帳被攔 → /login?next=%2Fcheckout → 點「忘記密碼？」→ next 在這一跳掉光
  //   → 「回去登入」回到裸 /login → 登入完落首頁 ⇒ 整條結帳重走(= register 那條的同形兄弟)。
  //   原樣傳給 client(同源白名單在 sink 端套用、非此處;對齊 app/login/page.tsx:21-23)。
  const { next } = await searchParams;
  return <ForgotPasswordPage next={next} />;
}
