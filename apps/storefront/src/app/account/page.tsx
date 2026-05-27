// app/account/page.tsx — 會員中心(server 守門 + 取 user → client AccountView)
//
// 對齊 design-reference/components/AccountPages.jsx AccountPage(L310-681);g-1a = 殼 + 7-tab nav
// (各 tab 真內容 g-2~g-7)。
//
// server 守門(codex 關卡1 finding-2/5):用 getUser()(向 auth server 驗 JWT、非可偽造的
// getSession)→ 無 user 就 redirect('/login')。直打網址也擋;Header 條件路由(g-1b)僅 cosmetic。
//
// dynamic:本頁經 createServerSupabaseClient 讀 cookies()、本就走動態 render;force-dynamic 為
// 顯式標記、非安全必需(安全靠 getUser 守門本身)。

import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { AccountView } from '@/components/account/AccountView';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // name 來源 = user_metadata.name(email 註冊 + LINE 皆寫此欄;codex 關卡1 finding-5)、空則退化。
  const name = (user.user_metadata?.name as string | undefined) ?? '';
  const email = user.email ?? '';

  return <AccountView user={{ name, email }} />;
}
