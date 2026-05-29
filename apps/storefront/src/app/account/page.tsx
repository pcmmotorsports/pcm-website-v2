// app/account/page.tsx — 會員中心(server 守門 + 取 user/stats/featured/profile/addresses → client AccountView)
//
// 對齊 design-reference/components/AccountPages.jsx AccountPage(L310-681)。
// g-1a 殼 + 7-tab nav;g-2 接 overview/orders tab 真資料(stats + featured)+ Issue 1
// LINE 合成 email 過濾(server-side、line.ts 為 server-only 不可洩到 client);
// g-4a 擴 select 5 欄(+ name/phone/birthday)+ profile prop 傳 AccountView(Q4=A SoT)。
// g-5a 讀收件地址清單(getAddressRepo→listByCustomer、RLS 守自己 row)+ addresses prop 傳 AccountView
// (AddressTab 唯讀列表;寫入新增/編輯/刪除/設預設留 g-5b/g-5c)。
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
// - row missing(PGRST116、極罕、trigger handle_new_auth_user 應已建)或 RLS 失敗 → 退化
//   tier='general' + walletBalance=0、console.error 警示、頁面不 500。
//
// g-2 Issue 1(LINE 合成 email 過濾、codex k1 round2 M-r2-1):
// - LINE_SYNTHETIC_EMAIL_DOMAIN 在 lib/auth/line.ts 為 server-only export;
//   page.tsx(server)端比對、過濾後傳 displayEmail / isSyntheticEmail 給 client AccountView;
//   AccountView 不 import line.ts(避免破 client/server 邊界)。
//
// g-4a profile SoT(Sean 拍 Q4=A、2026-05-28):
// - select 改 5 欄 `name, phone, birthday, tier, wallet_balance`(原 2 欄擴 3 欄)
// - name 來源優先 customers.name(SoT)→ user_metadata.name 退化 fallback(新用戶 trigger
//   handle_new_auth_user 已寫 customers.name from user_metadata、極罕 row missing 才走 fallback)
// - profile prop forward AccountView:{ name, phone, birthday }、用於 g-4b ProfileTab form 初值
// - phone/birthday null → '' 還原成 form-friendly 字串(domain 為 string|null、form 用 string)

import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getAddressRepo } from '@/lib/auth/composition';
import { AccountView } from '@/components/account/AccountView';
import { fetchFeaturedProducts } from '@/lib/products';
import { LINE_SYNTHETIC_EMAIL_DOMAIN } from '@/lib/auth/line';
import type { MemberTier, CustomerAddress } from '@pcm/domain';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const rawEmail = user.email ?? '';

  // Issue 1:LINE 合成 email(line_{sub}@line.pcmmotorsports.local)不可顯 UI、避免後端身分識別洩漏
  const isSyntheticEmail = rawEmail.endsWith(`@${LINE_SYNTHETIC_EMAIL_DOMAIN}`);
  const displayEmail = isSyntheticEmail ? '' : rawEmail;

  // g-4a Q4=A:select 5 欄(+ name/phone/birthday;tier + wallet_balance 沿用 g-2 path)
  const { data: customerRow, error: customerError } = await supabase
    .from('customers')
    .select('name, phone, birthday, tier, wallet_balance')
    .eq('user_id', user.id)
    .single();

  let tier: MemberTier = 'general';
  let walletBalance = 0;
  // name SoT:customers.name 為主、user_metadata.name 退化 fallback(g-4a Q4=A)。
  const metadataName = (user.user_metadata?.name as string | undefined) ?? '';
  let name = metadataName;
  let phone = '';
  let birthday = '';
  if (customerError) {
    // PGRST116(row missing、trigger handle_new_auth_user 應已建、極罕)或 RLS/session 異常 → 退化、不 500
    console.error('[account/page] customers row 讀取失敗、退化 general/0/metadata-name:', customerError);
  } else if (customerRow) {
    // DB enum member_tier ('general'|'store'|'premiumStore') 與 MemberTier TS type 字面一致(migration L8 + L32-33)
    tier = customerRow.tier as MemberTier;
    walletBalance = customerRow.wallet_balance;
    // Q4=A:customers.name 為主、空字串退化 user_metadata.name(極罕、trigger 應已同步)
    name = customerRow.name || metadataName;
    // phone/birthday domain string|null → form 用 string、null/undefined 還原 ''
    phone = customerRow.phone ?? '';
    birthday = customerRow.birthday ?? '';
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

  // g-5a:讀自己的收件地址清單(getAddressRepo→listByCustomer、RLS addresses_*_own 守自己 row)。
  // 鏡像 customers 讀的退化 pattern:adapter error(RLS/連線異常)→ 退化空陣列 + console.error、頁面不 500
  // (AddressTab 走空狀態)。寫入(新增/編輯/刪除/設預設)留 g-5b/g-5c。
  let addresses: CustomerAddress[] = [];
  try {
    addresses = await (await getAddressRepo()).listByCustomer(user.id);
  } catch (addressError) {
    console.error('[account/page] addresses 讀取失敗、退化空陣列:', addressError);
  }

  return (
    <AccountView
      user={{ name, displayEmail }}
      stats={{ tier, walletBalance, orderCount: 0 }}
      featured={featured}
      profile={{ name, phone, birthday }}
      addresses={addresses}
    />
  );
}
