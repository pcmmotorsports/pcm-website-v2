// app/cart/page.tsx — 購物車頁 route(M-3-S2-b2-d)
//
// /cart 對齊 design AccountPages.jsx CartPage(L11-178)。
// 版面 / 互動 / cart state 由 client 元件 CartView 負責(購物車內容在 localStorage、client-only);
// 顯示價由 CartView 經 app/cart/actions.ts resolveCartLines(server action)向 server 取
// (鐵則 12:價由 server 依 tier 取、client 不存價;階段① general-only)。
//
// Header NAV_ROUTE_MAP.cart 早已指向 '/cart'(M-1-04)、MobileTabBar 購物車 tab 本片解除 disabled(#194)。

import type { Metadata } from 'next';
import { CartView } from '@/components/CartView';

export const metadata: Metadata = {
  title: '購物車 — PCM Motorsports',
  description: '查看你選購的部品、數量與金額，前往結帳。',
};

export default function CartRoute() {
  return <CartView />;
}
