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

export default function ForgotPasswordRoute() {
  return <ForgotPasswordPage />;
}
