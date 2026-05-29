'use client';

// AccountView.tsx — 會員中心 client 殼(g-1a 建、g-2 接 overview/orders 真資料、g-4a 加 profile prop)
//
// 直接搬 design-reference/components/AccountPages.jsx AccountPage 殼(acc-head L432-442 + acc-nav 7-tab
// L445-464)。薄 router(codex 關卡1 finding-6):依 tab state 渲染對應 tab component(g-1a = stub、
// g-2~g-7 各填真內容、各自獨立檔不撐爆鐵則 6)。
//
// - tab 切換純 client setState(對齊 design setTab、Sean 決策2=A;deep-link ?tab= 留 M-3+)。
// - 登出走 app/account/actions.ts logoutAction server action(非 client 直接 signOut;finding-4)。
// - user.displayEmail 由 server page.tsx 過濾 LINE 合成 email 後傳入(line.ts 為 server-only、
//   不可在 client 端 import,故過濾在 server 完成、本檔只渲染 displayEmail;codex k1 round2 M-r2-1)。
//   - displayName / avatar fallback 也用 displayEmail、不用 raw email(codex round2 M-r2-2:防 name 空時洩 raw)。
//   - displayEmail 空字串 → acc-email 整段不 render(LINE 用戶常見)、UI 不留空白行。
// - route adaptation:Header / HomeFooter(對齊 storefront 慣例、非 design 的 onNav prop)。
//
// g-2(plan v2):
// - 新 stats prop:tier / walletBalance / orderCount(server 傳入、forward 給 OverviewTab)
// - 新 featured prop:fetchFeaturedProducts(tier) 結果(server 傳入、forward 給 OverviewTab)
// - OrdersTab 暫不接 prop(真用戶 0 筆訂單 = 空狀態、純 view、M-3 真接訂單時再加 prop)
// - g-3~g-7 各 tab 仍 stub(本 slice 不動其他 5 tab、.acc-stub class 保留)
//
// g-4a(Sean Q4=A、2026-05-28):
// - 新 profile prop:{ name, phone, birthday }(page.tsx 從 customers SoT 算好傳入)
// - displayName / avatarChar 改用 profile.name 為主(原 user.name)、表達 Q4=A SoT 意圖
//   (page.tsx 已把 user.name 與 profile.name 設成同值;改用 profile.name 是語義清楚、非行為變更)
// - profile prop forward 給 ProfileTab(g-4a stub 接 prop 但暫不渲染、g-4b form 真用)

import { useState } from 'react';
import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';
import { logoutAction } from '@/app/account/actions';
import { OverviewTab } from '@/components/account/tabs/OverviewTab';
import { OrdersTab } from '@/components/account/tabs/OrdersTab';
import { WalletTab } from '@/components/account/tabs/WalletTab';
import { FavoritesTab } from '@/components/account/tabs/FavoritesTab';
import { VehiclesTab } from '@/components/account/tabs/VehiclesTab';
import { AddressTab } from '@/components/account/tabs/AddressTab';
import { ProfileTab } from '@/components/account/tabs/ProfileTab';
import type { MemberTier } from '@pcm/domain';
import type { FeaturedResult } from '@/lib/products';

export type AccountUser = { name: string; displayEmail: string };
export type AccountStats = { tier: MemberTier; walletBalance: number; orderCount: number };
// g-4a:profile 三欄(form 用 string、空值 ''、不用 null;page.tsx 已 null→'' 還原)
export type AccountProfile = { name: string; phone: string; birthday: string };

// 7 tab 字面對齊 design AccountPages.jsx L447-453(id / label / icon)。
const NAV = [
  { id: 'overview', label: '總覽', icon: '◉' },
  { id: 'orders', label: '訂單記錄', icon: '□' },
  { id: 'wallet', label: '儲值金', icon: '◈' },
  { id: 'favorites', label: '收藏清單', icon: '♡' },
  { id: 'vehicles', label: '我的愛車', icon: '◎' },
  { id: 'address', label: '收件地址', icon: '▸' },
  { id: 'profile', label: '個人資料', icon: '✎' },
] as const;

type TabId = (typeof NAV)[number]['id'];

export type AccountViewProps = {
  user: AccountUser;
  stats: AccountStats;
  featured: FeaturedResult;
  profile: AccountProfile;
};

export function AccountView({ user, stats, featured, profile }: AccountViewProps) {
  const [tab, setTab] = useState<TabId>('overview');

  // g-4a Q4=A:displayName / avatarChar 用 profile.name(customers.name SoT)為主、displayEmail 退化、
  // 'PCM 會員' 最終 fallback(防 LINE 合成 email 洩 H1 / avatar;page.tsx 已把 user.name 設為同值)
  const displayName = profile.name || user.displayEmail || 'PCM 會員';
  const avatarChar = (profile.name || user.displayEmail || 'P').charAt(0).toUpperCase();

  // overview 內「最近訂單」「儲值金」CTA 跳 tab(對齊 design L488/L501 setTab 行為)
  const jumpToOrders = () => setTab('orders');
  const jumpToWallet = () => setTab('wallet');

  return (
    <div data-screen-label="Account" className="ap-page">
      <Header currentPage="account" />
      <main className="acc-main">
        <div className="acc-head">
          <div className="acc-avatar">{avatarChar}</div>
          <div>
            <div className="ap-mono">會員中心</div>
            <h1>Hi, {displayName}</h1>
            {user.displayEmail && <div className="acc-email">{user.displayEmail}</div>}
          </div>
          <div className="acc-head-actions">
            <form action={logoutAction}>
              <button type="submit" className="acc-logout">登出</button>
            </form>
          </div>
        </div>

        <div className="acc-layout">
          <aside className="acc-nav">
            {NAV.map((t) => (
              <button
                key={t.id}
                className={tab === t.id ? 'is-active' : ''}
                onClick={() => setTab(t.id)}
              >
                <span className="acc-nav-icon">{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </aside>

          <div className="acc-body">
            {tab === 'overview' && (
              <OverviewTab
                stats={stats}
                featured={featured}
                onJumpToOrders={jumpToOrders}
                onJumpToWallet={jumpToWallet}
              />
            )}
            {tab === 'orders' && <OrdersTab />}
            {tab === 'wallet' && <WalletTab />}
            {tab === 'favorites' && <FavoritesTab />}
            {tab === 'vehicles' && <VehiclesTab />}
            {tab === 'address' && <AddressTab />}
            {tab === 'profile' && <ProfileTab profile={profile} />}
          </div>
        </div>
      </main>
      <HomeFooter />
    </div>
  );
}
