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
// - 新 featured prop:fetchFeaturedProducts() 結果(perf/P3 起函式釘 general 不收 tier;server 傳入、forward 給 OverviewTab)
// - OrdersTab 暫不接 prop(真用戶 0 筆訂單 = 空狀態、純 view、M-3 真接訂單時再加 prop)
// - g-3~g-7 各 tab 仍 stub(本 slice 不動其他 5 tab、.acc-stub class 保留)
//
// g-4a(Sean Q4=A、2026-05-28):
// - 新 profile prop:{ name, phone, birthday }(page.tsx 從 customers SoT 算好傳入)
// - displayName / avatarChar 改用 profile.name 為主(原 user.name)、表達 Q4=A SoT 意圖
//   (page.tsx 已把 user.name 與 profile.name 設成同值;改用 profile.name 是語義清楚、非行為變更)
// - profile prop forward 給 ProfileTab(g-4a stub 接 prop 但暫不渲染、g-4b form 真用)
//
// g-4b(Sean Q2-1=b、2026-05-28):
// - ProfileTab 換真 form(接 updateProfileAction)、額外 forward user.displayEmail 給 ProfileTab Email 欄
//   (LINE 用戶 displayEmail='' → ProfileTab 顯替代字面「LINE 帳號登入,無 Email」、不可編輯)
//
// g-5a(2026-05-29):
// - 新 addresses prop:CustomerAddress[](page.tsx getAddressRepo→listByCustomer 算好傳入)
// - forward 給 AddressTab 渲染地址清單 + g-5b defaultName 預填(g-5b 接新增表單;編輯/刪除/設預設留 g-5c)
//
// g-6a(2026-05-31):
// - 新 vehicles prop:CustomerVehicle[](page.tsx getVehicleRepo→listByCustomer 算好傳入)
// - forward 給 VehiclesTab 唯讀渲染愛車清單(g-6b 接新增表單;編輯/刪除/設主車留 g-6c)

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
import type { MemberTier, CustomerAddress, CustomerVehicle, OrderListItem, FavoriteListItem } from '@pcm/domain';
import type { FeaturedResult } from '@/lib/products';
import type { MockMotoBrand } from '@/data/mock-moto-brands';

export type AccountUser = { name: string; displayEmail: string };
export type AccountStats = { tier: MemberTier; walletBalance: number; orderCount: number };
// g-4a:profile 三欄(form 用 string、空值 ''、不用 null;page.tsx 已 null→'' 還原)
export type AccountProfile = { name: string; phone: string; birthday: string };

// 7 tab 的 id / label 字面對齊 design AccountPages.jsx L447-453,**本批未動**。
// 🔶 第4批 R1 9-2(Sean 2026-08-05「優化整體字體、圖示、比例」):
//    icon 由幾何字元 `◉ □ ◈ ♡ ◎ ▸ ✎` 改 **inline SVG**,規格與殼(header / mobile-tabbar)
//    完全一致:`viewBox="0 0 24 24"` / `fill="none"` / `stroke="currentColor"` /
//    `stroke-width="1.6"` / `stroke-linecap="round"` / 顯示 18×18。
//    🔴 幾何字元的問題不是「不好看」而是**每個字元的字體覆蓋率與基線都不同** ——
//    `◈` `▸` 這種在部分系統字體裡沒有、會 fallback 到別支字體或顯示成豆腐,
//    而且七顆的視覺大小完全不一致(`♡` 明顯比 `□` 大一圈)。
//    path 字面逐字搬自設計稿 `account-page.html` 的 NAV 陣列(grep `const NAV =`;不引行號)
//    —— **`vehicles` 那一筆除外**,見下方 Q2=A 申報。`vehicles` 與 tabbar「找車」
//    是**同一支** path(刻意的,不要各畫各的)。
//    🔴 查證更正(2026-08-07):原註解另外宣稱 `profile` 與 header 會員鈕也是同一支——
//    實查是假的,兩邊 circle cy(7 vs 8)與身體弧線公式(header 用弧線 arc、這裡用三次貝茲)
//    從來就不同,只是視覺上都是「頭圓+肩弧」看起來像。未強制對齊(不在本次 Q2=A 範圍),
//    對應測試已把「同一支」的錯誤宣稱改成純字面鎖定,不再假稱跨檔同支。
//    ⚠️ **R2 補**:這條的病根與 `vehicles` **完全同形** —— OD 交接單 icon 表的同一行,
//    文字同時宣稱「vehicles=機車、與 tabbar 同一支」與「profile=人像、與 header 同一支」,
//    而 OD 自己的落地稿兩處都對不上。⇒ **兩條一起進 OD 回饋包**,不只報 vehicles 那條。
//    ⚠️ 另外:「會員/個人資料」這顆人像 icon 全站有**三種**不同字面(header 會員鈕 / 本檔 profile /
//    MobileTabBar「會員」),要不要統一不在本次射程,已列回饋包供 Sean 裁。
//
// 🔴 2026-08-07 Sean 拍板 Q2=A(**對 OD 稿的偏離,申報如下**):
//    機車零件站的選車/愛車圖示統一用重機;`vehicles` 的 path 改複用 MobileTabBar「找車」那支
//    (不自畫新 icon)。三處同批換:本檔 + `CascadeFilterTop.tsx` + `GarageChips.tsx`。
//    ⚠️ **OD 稿的該顆 SVG 畫的是汽車** ⇒ 這是 Sean 口頭覆蓋設計稿,**已列 OD 回饋包請 OD 同步**。
//    ⚠️ 但 OD 交接單 `account-page-handoff.md` 的 icon 表**文字寫的是「vehicles=機車、與 tabbar
//    『找車』同一支」**(grep `vehicles`)—— 也就是 OD 自己的文字說明與落地 SVG 互相矛盾,
//    Sean 的口頭與那份文字說明其實同向。回饋包一併把這條矛盾回報給 OD。
const NAV = [
  {
    id: 'overview',
    label: '總覽',
    path: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  },
  {
    id: 'orders',
    label: '訂單記錄',
    path: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  },
  {
    id: 'wallet',
    label: '儲值金',
    path: '<rect x="2" y="6" width="20" height="13" rx="1"/><path d="M2 10h20"/><path d="M16 15h3"/>',
  },
  {
    id: 'favorites',
    label: '收藏清單',
    path: '<path d="M12 20.5 4.2 13a4.6 4.6 0 0 1 6.5-6.5l1.3 1.3 1.3-1.3A4.6 4.6 0 0 1 19.8 13z"/>',
  },
  {
    id: 'vehicles',
    label: '我的愛車',
    // 原為汽車 path,2026-08-07 Sean 拍板 Q2=A 換成重機(複用 tabbar「找車」那支)。
    path: '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17h8l-2-6h-3L6 17Z"/><path d="m14 11 1-3h3"/>',
  },
  {
    id: 'address',
    label: '收件地址',
    path: '<path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>',
  },
  {
    id: 'profile',
    label: '個人資料',
    path: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>',
  },
] as const;

type TabId = (typeof NAV)[number]['id'];

export type AccountViewProps = {
  user: AccountUser;
  stats: AccountStats;
  featured: FeaturedResult;
  profile: AccountProfile;
  // g-5a:收件地址清單(page.tsx getAddressRepo→listByCustomer 算好傳入;forward 給 AddressTab 唯讀渲染)
  addresses: CustomerAddress[];
  // g-6a:愛車清單(page.tsx getVehicleRepo→listByCustomer 算好傳入;forward 給 VehiclesTab 唯讀渲染)
  vehicles: CustomerVehicle[];
  /** V-1c++:車型字典(page.tsx fetchVehicleTaxonomy 直傳;forward 給 VehiclesTab 雙下拉) */
  vehicleBrands?: MockMotoBrand[];
  // M-3:訂單摘要清單(page.tsx getOrderRepo→listSummariesByCustomer 算好傳入;forward 給 OrdersTab 全列 +
  // OverviewTab 最近訂單 slice(0,2)。orderCount 與此同源、Q5=A 一致)
  orders: OrderListItem[];
  // M-4b #191:收藏清單(page.tsx getFavoritesRepo→listByCustomer 算好傳入;forward 給 FavoritesTab)
  favorites: FavoriteListItem[];
  /** 🔴 讀取失敗(≠ 沒有收藏)。兩者必須印不同的畫面 —— `MAIN-035 ①-1`。 */
  favoritesFailed?: boolean;
};

export function AccountView({ user, stats, featured, profile, addresses, vehicles, vehicleBrands, orders, favorites, favoritesFailed }: AccountViewProps) {
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
                {/* 🔶 R1 9-2:`dangerouslySetInnerHTML` 用在**本檔內寫死的常數**上,
                    沒有任何使用者輸入路徑(`NAV` 是 `as const`、不從 props / DB 來)。
                    這是為了不用把七顆 icon 各拆成一個元件;`aria-hidden` 因為旁邊
                    `.acc-nav-label` 已經有文字,圖示對讀屏是純裝飾。 */}
                <span className="acc-nav-icon" aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    dangerouslySetInnerHTML={{ __html: t.path }}
                  />
                </span>
                <span>{t.label}</span>
              </button>
            ))}
          </aside>

          <div className="acc-body">
            {tab === 'overview' && (
              <OverviewTab
                stats={stats}
                featured={featured}
                recentOrders={orders.slice(0, 2)}
                onJumpToOrders={jumpToOrders}
                onJumpToWallet={jumpToWallet}
              />
            )}
            {tab === 'orders' && <OrdersTab orders={orders} />}
            {tab === 'wallet' && <WalletTab />}
            {tab === 'favorites' && <FavoritesTab favorites={favorites} loadFailed={favoritesFailed} />}
            {tab === 'vehicles' && <VehiclesTab vehicles={vehicles} vehicleBrands={vehicleBrands} />}
            {tab === 'address' && <AddressTab addresses={addresses} defaultName={profile.name} />}
            {tab === 'profile' && <ProfileTab profile={profile} email={user.displayEmail} />}
          </div>
        </div>
      </main>
      <HomeFooter />
    </div>
  );
}
