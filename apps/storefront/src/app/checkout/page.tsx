// app/checkout/page.tsx — 結帳頁 route(M-3-S2-b2-e1)
//
// /checkout 對齊 design CheckoutPage.jsx。server 守門 + 取 user/tier/收件地址 → client CheckoutView
// (cart 內容在 localStorage、client-only;顯示價走 CheckoutView 內 useResolvedCart server-resolve)。
//
// server 守門(對齊 app/account/page.tsx):getUser()(向 auth server 驗 JWT、非可偽造 getSession)→
//   無 user redirect('/login')。直打網址也擋。cart 的「前往結帳」鈕導此、未登入由此處攔(非 client 檢查)。
//
// dynamic:經 createServerSupabaseClient 讀 cookies()、本就動態;force-dynamic 顯式標記。
//
// 退化(對齊 account/page.tsx):customers row missing(PGRST116、極罕)/ RLS 異常 → tier='general' +
//   name 退化 user_metadata.name → 'PCM 會員';addresses adapter error → 空陣列 + console.error,頁面不 500。

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getAddressRepo } from '@/lib/auth/composition';
import {
  getCheckoutNotificationEmailPrefill,
  isCheckoutNotificationEmailEnabled,
} from '@/lib/email/notification-email-gate';
import { CheckoutView } from '@/components/CheckoutView';
import type { CustomerAddress, MemberTier } from '@pcm/domain';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '結帳 — PCM Motorsports',
  description: '填寫收件與付款資料,完成你的 PCM 訂單。',
};

export default async function CheckoutRoute() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // 單一 server flag 讀一次後往 UI 傳；session Email 仍須共用 canonical schema 驗過才可預填。
  const notificationEmailEnabled = isCheckoutNotificationEmailEnabled();
  const initialNotificationEmail = getCheckoutNotificationEmailPrefill(
    user.email,
    notificationEmailEnabled,
  );

  const { data: customerRow, error: customerError } = await supabase
    .from('customers')
    .select('name, tier')
    .eq('user_id', user.id)
    .single();

  let memberName = (user.user_metadata?.name as string | undefined) ?? '';
  let memberTier: MemberTier = 'general';
  if (customerError) {
    console.error('[checkout/page] customers row 讀取失敗、退化 general:', customerError);
  } else if (customerRow) {
    // name SoT:customers.name 為主、user_metadata.name 退化(對齊 account/page.tsx)。
    memberName = customerRow.name || memberName;
    // DB enum member_tier 與 MemberTier TS 字面一致(階段① 顯示用、價格仍 general-only)。
    memberTier = customerRow.tier as MemberTier;
  }
  if (!memberName) memberName = 'PCM 會員'; // 防 LINE 合成 email 等空名

  // 收件地址清單(getAddressRepo→listByCustomer、RLS addresses_*_own 守自己 row);退化空陣列。
  let addresses: CustomerAddress[] = [];
  try {
    addresses = await (await getAddressRepo()).listByCustomer(user.id);
  } catch (addressError) {
    console.error('[checkout/page] addresses 讀取失敗、退化空陣列:', addressError);
  }

  return (
    <CheckoutView
      addresses={addresses}
      memberName={memberName}
      memberTier={memberTier}
      notificationEmailEnabled={notificationEmailEnabled}
      initialNotificationEmail={initialNotificationEmail}
    />
  );
}
