'use server';

// app/account/actions.ts — 會員中心 server actions(g-1a)
//
// logout:getAuthService() → logoutCustomer(IAuthService.signOut 清 session cookie)→ redirect('/logout')。
// 不在 client AccountView 直接 supabase.signOut(auth 真邊界在 server;codex 關卡1 finding-4)。
// 鏡像 app/login/actions.ts 範式('use server' + getAuthService + next/navigation redirect)。

import { redirect } from 'next/navigation';
import { logoutCustomer } from '@pcm/use-cases';
import { getAuthService } from '@/lib/auth/composition';

/**
 * 登出:清 session cookie 後導回 **`/logout` 道別頁**(不是登入表單)。
 * 以 <form action={logoutAction}> 觸發(FormData 不需、故無參數);logoutCustomer 失敗(罕見)向上拋。
 *
 * 🔴 接線的出處與身分(2026-08-18):
 *   · **要接線 = Sean 拍的**(2026-08-06 `Q2=A`:登出 redirect 由 /login 改 /logout)
 *   · **「現在做」= 主視窗【代裁】,不是 Sean 拍的** —— 原拍板附帶「排白天、夜間不動」,
 *     代裁的理由是**那個條件的【目的】是「有人看著」,而 Sean 今晚明顯在線上**
 *     ⇒ 條件的目的滿足了,**不是條件被廢掉**。
 *   · 🔴 **射程只到「Sean 在線上」為止。他不在線上時,這一格要重新判。**
 *   · Sean 原拍板明寫的 **鐵則 12② 對抗審查不降級** —— 代裁沒有動它,已照跑。
 *   · plan:`docs/specs/2026-08-18-g3-logout-wiring-plan.md`
 */
export async function logoutAction(): Promise<void> {
  await logoutCustomer(await getAuthService());
  redirect('/logout');
}
