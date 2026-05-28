// app/account/page.tsx — 會員中心(server 守門 + 取 user/stats/featured → client AccountView)
//
// 對齊 design-reference/components/AccountPages.jsx AccountPage(L310-681)。
// g-1a 殼 + 7-tab nav;g-2 接 overview/orders tab 真資料(stats + featured)+ Issue 1
// LINE 合成 email 過濾(server-side、line.ts 為 server-only 不可洩到 client)。
//
// server 守門(codex 關卡1 finding-2/5):用 getUser()(向 auth server 驗 JWT、非可偽造的
// getSession)→ 無 user 就 redirect('/login')。直打網址也擋;Header 條件路由(g-1b)僅 cosmetic。
//
// dynamic:本頁經 createServerSupabaseClient 讀 cookies()、本就走動態 render;force-dynamic 為
// 顯式標記、非安全必需(安全靠 getUser 守門本身)。
//
// g-2 資料路徑(對齊 plan v2 決策 1):
// - tier + wallet_balance 走 createServerSupabaseClient 直查 customers(RLS customers_select_own
//   涵蓋、authenticated role),不繞 SupabaseWalletAdapter(後者強制 service_role writeClient
//   ctor、storefront 不允許注入 service_role)。
// - featured 走既有 fetchFeaturedProducts(tier)(server-only、SupabaseProductAdapter listByCategory
//   「操控部品」.slice(0,4))。
// - row missing(PGRST116、極罕、trigger handle_new_user 應已建)或 RLS 失敗 → 退化
//   tier='general' + walletBalance=0、console.error 警示、頁面不 500。
//
// g-2 Issue 1(LINE 合成 email 過濾、codex k1 round2 M-r2-1):
// - LINE_SYNTHETIC_EMAIL_DOMAIN 在 lib/auth/line.ts 為 server-only export;
//   page.tsx(server)端比對、過濾後傳 displayEmail / isSyntheticEmail 給 client AccountView;
//   AccountView 不 import line.ts(避免破 client/server 邊界)。

import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { AccountView } from '@/components/account/AccountView';
import { fetchFeaturedProducts } from '@/lib/products';
import { LINE_SYNTHETIC_EMAIL_DOMAIN } from '@/lib/auth/line';
import type { MemberTier } from '@pcm/domain';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // name 來源 = user_metadata.name(email 註冊 + LINE 皆寫此欄;codex 關卡1 finding-5)、空則退化(view 端 fallback)。
  const name = (user.user_metadata?.name as string | undefined) ?? '';
  const rawEmail = user.email ?? '';

  // Issue 1:LINE 合成 email(line_{sub}@line.pcmmotorsports.local)不可顯 UI、避免後端身分識別洩漏
  const isSyntheticEmail = rawEmail.endsWith(`@${LINE_SYNTHETIC_EMAIL_DOMAIN}`);
  const displayEmail = isSyntheticEmail ? '' : rawEmail;

  // g-2:直查 customers.tier + wallet_balance(plan v2 決策 1)
  // exact query 對應 codex k1 C1:select 兩欄 / .single() / row missing fallback
  const { data: customerRow, error: customerError } = await supabase
    .from('customers')
    .select('tier, wallet_balance')
    .eq('user_id', user.id)
    .single();

  let tier: MemberTier = 'general';
  let walletBalance = 0;
  if (customerError) {
    // PGRST116(row missing、trigger handle_new_user 應已建、極罕)或 RLS/session 異常 → 退化、不 500
    console.error('[account/page] customers row 讀取失敗、退化 general/0:', customerError);
  } else if (customerRow) {
    // DB enum member_tier ('general'|'store'|'premiumStore') 與 MemberTier TS type 字面一致(migration L8 + L32-33)
    tier = customerRow.tier as MemberTier;
    walletBalance = customerRow.wallet_balance;
  }

  // g-2:推薦走 fetchFeaturedProducts、走 Supabase 真資料(非 mock)
  //
  // ⚠️ tier-aware pricing 暫不接(codex k2 round1 must-fix#1 + 三級會員價格鐵則):
  //   products_public projection 把 store/premiumStore 價設 dummy 0
  //   (packages/adapters/src/supabase/mappers/product.ts L139/L143、避免經銷敏感洩 public view)、
  //   toUIProduct(p, tier) 套 computeEffectivePrice 後對 store/premiumStore 會顯「NT$ 0」。
  //   M-1-16 接 server-side tier-aware price endpoint 後才能真按 tier 顯示。
  //   g-2 階段先固定走 'general' 公開價(視覺對齊 design + 不顯 NT$ 0 + 不洩經銷價),
  //   manifest 已揭示 business override「推薦固定 general、tier-aware 待 M-1-16」。
  const featured = await fetchFeaturedProducts('general');

  return (
    <AccountView
      user={{ name, displayEmail }}
      stats={{ tier, walletBalance, orderCount: 0 }}
      featured={featured}
    />
  );
}
