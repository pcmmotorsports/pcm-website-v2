// app/checkout/page.tsx — 結帳頁 route(M-3-S2-b2-e1)
//
// /checkout 對齊 design CheckoutPage.jsx。server 守門 + 取 user/tier/收件地址 → client CheckoutView
// (cart 內容在 localStorage、client-only;顯示價走 CheckoutView 內 useResolvedCart server-resolve)。
//
// server 守門(對齊 app/account/page.tsx):getUser()(向 auth server 驗 JWT、非可偽造 getSession)→
//   無 user redirect('/login')。直打網址也擋。cart 的「前往結帳」鈕導此、未登入由此處攔(非 client 檢查)。
//
// 🔴 **「為什麼不讓訪客結帳」—— 這是拍板,不是還沒做**(2026-08-18 Sean 拍;寫在這裡是因為
//    下一個看到「結帳被轉去登入」的人會在這支檔找答案,而不是去翻信箱)。
//    ```
//    Q: 客人結帳，一定要先註冊登入嗎？
//    A（Sean 逐字）: 對，維持要登入 —— **訂單要綁會員、之後查訂單/退款才有依據**
//    ```
//    ⇒ 理由是**業務的**不是技術的:訪客單沒有會員可綁 ⇒ 客人日後查訂單、要退款時,
//      我們沒有一個「這張單是誰的」的依據。
//    ⚠️ 所以**不要**把它當成「待辦的訪客結帳功能」——它是被拍掉的,不是沒排到。
//      要重開這一格,得先回答「訪客單怎麼綁身分」,那是新題不是把 redirect 拿掉。
//    📎 出處(可考古):`~/pcm-mailbox/MAIN-050-Sean三答-付款其實驗過-20260818.md` 第 ② 題。
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
import { toMemberTier } from '@pcm/domain';
import type { CustomerAddress, MemberTier } from '@pcm/domain';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '結帳 — PCM重機零件販售',
  description: '填寫收件與付款資料,完成您的 PCM 訂單。',
};

export default async function CheckoutRoute() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // #190 登入後導回:未登入被攔在這裡的人,登入完要回到【結帳】而不是首頁(否則整條結帳要重走一次)。
  //   next 進 /login 後由 login/actions.ts:71 的 sanitizeNextParam 同源白名單收斂 —— 本處只負責帶。
  if (!user) redirect(`/login?next=${encodeURIComponent('/checkout')}`);

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
    // 🔴 `#873`:這裡原本是 `customerRow.tier as MemberTier` **裸 cast**。
    //    DB 的 enum 多一個值時,那個 cast **不會報錯,它會安靜地過** ⇒ 一個 TS 不認得的字串
    //    一路流到 `TierBadge` → `schemaTierToDesign` 的 exhaustive `default:` ⇒ **throw TypeError**。
    //    📏 **實測**(`components/CheckoutSummaryAside.test.tsx`,2026-08-24):
    //       餵未知 tier ⇒ `TypeError: schemaTierToDesign: unreachable tier …` **在 render 當下丟出**
    //       ⇒ **那位客人結不了帳。而編譯是綠的。**
    //    ⇒ 退化方向照 `lib/tier.ts` 的既有拍板:**只准往下,任何不確定都回 general,不得回經銷 tier**。
    const parsedTier = toMemberTier(customerRow.tier);
    if (parsedTier === null) {
      // 🔴 **不得靜默** —— 同 `lib/tier.ts` 的 codex R2 nit:enum 漂移會無聲把經銷會員降級,
      //    降級方向是對的,但它不該安靜。這一行是它唯一的可觀測形態。
      console.error('[checkout/page] customers.tier 是本版不認得的值、退化 general:', customerRow.tier);
    }
    memberTier = parsedTier ?? 'general';
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
