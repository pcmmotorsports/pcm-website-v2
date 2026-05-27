'use client';

// AccountView.tsx — 會員中心 client 殼(g-1a)
//
// 直接搬 design-reference/components/AccountPages.jsx AccountPage 殼(acc-head L432-442 + acc-nav 7-tab
// L445-464)。薄 router(codex 關卡1 finding-6):依 tab state 渲染對應 tab component(g-1a = stub、
// g-2~g-7 各填真內容、各自獨立檔不撐爆鐵則 6)。
//
// - tab 切換純 client setState(對齊 design setTab、Sean 決策2=A;deep-link ?tab= 留 M-3+)。
// - 登出走 app/account/actions.ts logoutAction server action(非 client 直接 signOut;finding-4)。
// - user 由 server page(getUser 守門後)傳入;name=user_metadata.name、空則退化顯示。
// - route adaptation:Header / HomeFooter(對齊 storefront 慣例、非 design 的 onNav prop)。

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

export type AccountUser = { name: string; email: string };

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

export function AccountView({ user }: { user: AccountUser }) {
  const [tab, setTab] = useState<TabId>('overview');

  const displayName = user.name || user.email || 'PCM 會員';
  const avatarChar = (user.name || user.email || 'P').charAt(0).toUpperCase();

  return (
    <div data-screen-label="Account" className="ap-page">
      <Header currentPage="account" />
      <main className="acc-main">
        <div className="acc-head">
          <div className="acc-avatar">{avatarChar}</div>
          <div>
            <div className="ap-mono">會員中心</div>
            <h1>Hi, {displayName}</h1>
            <div className="acc-email">{user.email}</div>
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
            {tab === 'overview' && <OverviewTab />}
            {tab === 'orders' && <OrdersTab />}
            {tab === 'wallet' && <WalletTab />}
            {tab === 'favorites' && <FavoritesTab />}
            {tab === 'vehicles' && <VehiclesTab />}
            {tab === 'address' && <AddressTab />}
            {tab === 'profile' && <ProfileTab />}
          </div>
        </div>
      </main>
      <HomeFooter />
    </div>
  );
}
