// components/MobileTabBar.tsx — 全站底部主導航(僅 mobile 顯示)
//
// 字面從 design-reference/components/App.jsx L166-190 直接搬:
// - 5 tab 字面:首頁 / 商品 / 找車 / 會員 / 購物車
// - SVG icon 字面複製(viewBox/path/strokeWidth 不動)
// - .mobile-tabbar / .mobile-tabbar-btn / .mobile-tabbar-dot className 字面
// - hidden prop 行為(product 頁讓位 sticky buy bar)
//
// 業務 override(鐵則 1 例外類別 2 = 技術實作差異、非視覺偏離):
// - design 用 currentPage prop + onNav callback(in-app state machine)→ storefront 用 Next routing
//   (usePathname() + <Link href>)
// - 「找車」tab → <Link href='/products?pick=vehicle'>(2026-08-03 Sean 拍 B 案「同落地+開燈」;
//   ~~原 '#' + aria-disabled、fold backlog #195 等 /vehicle-search 路由~~ → **不必新路由**、#195 結案)
// - 「購物車」tab → <Link href='/cart'>(M-3-S2-b2-d 建 /cart route、#194 resolved;原 '#' + aria-disabled
//   為 /cart 未建時的暫頂、本片解除)
// - hidden 判定:pathname.startsWith('/products/') 且 segments.length >= 2(對應 /products/[slug]、
//   '/products' 列表頁不藏、走 catalog tab 顯示)

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

type Tab = {
  id: string;
  label: string;
  href: string;
  matches: (pathname: string) => boolean;
  icon: ReactNode;
};

const TABS: Tab[] = [
  {
    id: 'home',
    label: '首頁',
    href: '/',
    matches: (p) => p === '/',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    id: 'catalog',
    label: '商品',
    href: '/products',
    matches: (p) => p === '/products' || p.startsWith('/products') || p.startsWith('/brands'),
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
      </svg>
    ),
  },
  {
    id: 'vehicle-search',
    label: '找車',
    // 2026-08-03 Sean 拍 B 案:接 /products?pick=vehicle 解除停用,**不必新路由**(backlog #195 結案)。
    // 落地開燈語意與 Header「依車輛搜尋」同一條(手機在這裡=自動開 MobileVehicleSheet)。
    href: '/products?pick=vehicle',
    // 🔴 維持恆不 active,不要改成「?pick=vehicle 時亮起」:usePathname() 拿不到 query,
    //    要判斷就得在本元件用 useSearchParams();而本元件掛在 app/layout.tsx 的 root layout、
    //    外層沒有 Suspense 邊界 ⇒ 會讓**全站每一頁**掉進 client-side rendering bailout。
    //    代價遠大於「這顆 tab 會不會反白」。落在 /products?pick=vehicle 時亮的是「商品」tab
    //    (下方 catalog 的 matches 收 p.startsWith('/products')),可接受。
    matches: () => false,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="6" cy="17" r="3" />
        <circle cx="18" cy="17" r="3" />
        <path d="M6 17h8l-2-6h-3L6 17Z" />
        <path d="m14 11 1-3h3" />
      </svg>
    ),
  },
  {
    id: 'account',
    label: '會員',
    href: '/account',
    matches: (p) => p.startsWith('/account') || p === '/login' || p === '/register',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="12" cy="8" r="4" />
        <path d="M20 21v-1a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v1" />
      </svg>
    ),
  },
  {
    id: 'cart',
    label: '購物車',
    href: '/cart',
    matches: (p) => p.startsWith('/cart'),
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
        <path d="M3 6h18" />
        <path d="M16 10a4 4 0 0 1-8 0" />
      </svg>
    ),
  },
];

export function MobileTabBar() {
  const pathname = usePathname() || '/';
  const segments = pathname.split('/').filter(Boolean);
  // 🔶 第2批新增第二個 hidden 情境:`/coming-soon`(整站上線前的唯一一頁)。
  //    Sean 2026-08-05 的天地規則是**分兩種**的:`/stores` `/install` 是站內頁要保留天地,
  //    但整站版**刻意沒有任何站內導航** —— 那時其他頁面都還沒上線,擺連結點了只會 404
  //    (設計端 `coming-soon-handoff.md` 驗收 #14 明列「這是刻意的,不是漏做」)。
  //    🔴 那一頁靠「不 import `<Header>`/`<HomeFooter>`」就沒有殼,但 TabBar 掛在**根 layout**、
  //    頁面 import 不到、擋不掉 ⇒ 唯一能擋的地方就是這裡。
  //    ⚠️ 只認 `/coming-soon` 這一條**精確路徑**,不用 startsWith:`/stores` `/install` 雖然
  //    渲染同一個元件,但它們是站內頁、TabBar 要留著。
  // 🔶 第5批新增第三個 hidden 情境:`/checkout`(Sean 2026-08-06 拍板 Q5=A,同日 Q6=A 覆核維持)。
  //
  // 🔴 **理由是產品選擇,與設計稿脫鉤 —— 不要再寫成「設計稿沒有 TabBar」**:
  //    結帳流程中不給岔出去的入口。
  //    設計稿 `checkout-page.html:123-128` **其實有**完整五顆 tab、購物車那顆 `is-active`,
  //    且與 `:87` 的 `.co-mobile-buybar` 同時存在(= 設計端是「buybar 蓋在 TabBar 上」)。
  //    Q5 當初是在「設計稿沒有 TabBar」這個**假前提**上拍的(我用 camelCase `TabBar` 做
  //    大小寫敏感 grep、漏掉小寫的 `mobile-tabbar`);更正後重問,Sean 仍維持藏起來。
  //    ⇒ 本站在這一點上**知情偏離設計稿**,不是對齊。
  //
  //    次要理由(仍成立):真站 ≤900px 的 `.co-mobile-buybar`(z-index 100、fixed bottom)
  //    壓在 TabBar(z-index 40)上面,兩條列疊在同一個底部。
  //    ⚠️ 這裡用 `startsWith` 是**刻意的**,與上面 `/coming-soon` 用精確路徑的理由相反:
  //    `/checkout/callback`(付款返回)渲染的是 `CheckoutSuccess`、同樣掛 `.co-page`,
  //    而 checkout.css 那條讓位 padding 的歸零規則是**以 `.co-page` 為條件**。
  //    兩邊涵蓋的路徑集合必須一致 —— 不一致的症狀是「TabBar 在、底部 padding 卻沒了」
  //    (最後一條 tab 被自己蓋住)或反過來多一條死空間。
  const hidden =
    (pathname.startsWith('/products/') && segments.length >= 2) ||
    pathname === '/coming-soon' ||
    pathname.startsWith('/checkout');

  return (
    <nav className={`mobile-tabbar ${hidden ? 'is-hidden' : ''}`} aria-label="主導航">
      {TABS.map((t) => {
        const active = t.matches(pathname);
        const cls = `mobile-tabbar-btn ${active ? 'is-active' : ''}`;
        // 2026-08-03:disabled 分支(<span aria-disabled>)整段移除 —— 找車是它最後一個使用者,
        // 解除停用後 5 個 tab 全是真連結。守門 = MobileTabBar.test.tsx「零 aria-disabled」。
        return (
          <Link key={t.id} href={t.href} className={cls}>
            <span className="mobile-tabbar-dot" />
            {t.icon}
            <span className="lbl">{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
