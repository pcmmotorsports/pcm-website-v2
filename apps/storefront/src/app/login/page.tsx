// app/login/page.tsx — 登入頁 route(M-1-14e-f1-a;f1-c 加 OAuth error query)
//
// /login 對齊 design AccountPages.jsx LoginPage;版面 / 表單 / 社交鈕由 client 元件 LoginPage 負責、
// 登入信任邊界由 app/login/actions.ts loginAction(server action)負責。
// f1-c:server 端讀 searchParams.error(/auth/callback 失敗導回 ?error=oauth)傳入 LoginPage oauthError prop
// (Next 16 searchParams 為 async;改 server prop 而非 client useSearchParams、免 Suspense boundary)。

import type { Metadata } from 'next';
import { LoginPage } from '@/components/LoginPage';

export const metadata: Metadata = {
  title: '登入 — PCM重機零件販售',
  // 🔴 **這一句與 `components/LoginPage.tsx` 的 `AUTH_SUB_DEFAULT` 字面相同 —— 而那是【巧合】。**
  //    本行是給【搜尋引擎與分享卡片】看的;那一行是給【站在頁面上的人】看的。
  //    ⇒ 受眾不同、生命週期不同 ⇒ **它們會分開演化, 而那是對的。**
  // 🛑 **不要把兩者收斂成一個來源**(2026-08-29 線A;主視窗 `-06` 原本要求收斂, 開檔後收回):
  //    畫面上那一句 2026-08-29 起會【依 `?next=` 換句】(Sean 拍「依情況換一句」),
  //    而 metadata **必須不隨 `next` 變** —— 同一個 `/login` 對爬蟲得是同一頁,
  //    `next` 卻是每個人不同的暫時值。
  //    ⇒ **收斂會讓一個【本來正確】的東西, 開始跟著一個不該影響它的參數變。**
  // 📌 判別句:重複的是【字面】還是【事實】—— 只有後者該收斂;
  //    而分辨法是問【它們的讀者是誰】。
  description: '登入您的 PCM 帳號，查看訂單與收藏。',
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
