'use server';

// app/account/actions.ts — 會員中心 server actions(g-1a)
//
// logout:getAuthService() → logoutCustomer(IAuthService.signOut 清 session cookie)→ redirect('/login')。
// 不在 client AccountView 直接 supabase.signOut(auth 真邊界在 server;codex 關卡1 finding-4)。
// 鏡像 app/login/actions.ts 範式('use server' + getAuthService + next/navigation redirect)。

import { redirect } from 'next/navigation';
import { logoutCustomer } from '@pcm/use-cases';
import { getAuthService } from '@/lib/auth/composition';

/**
 * 登出:清 session cookie 後導回 /login。
 * 以 <form action={logoutAction}> 觸發(FormData 不需、故無參數);logoutCustomer 失敗(罕見)向上拋。
 */
export async function logoutAction(): Promise<void> {
  await logoutCustomer(await getAuthService());
  redirect('/login');
}
