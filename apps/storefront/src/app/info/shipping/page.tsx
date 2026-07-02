// app/info/shipping/page.tsx — 配送 & 退貨政策 route(A2、2026-07-03)
//
// 對齊 Header/HomeFooter「配送 & 退貨」連結(href: /info/shipping、原 404 死連結)。
// 版面 + 互動由 client 元件 InfoShippingPage 負責(tab useState);本 route 純 metadata + render。

import type { Metadata } from 'next';
import { InfoShippingPage } from '@/components/InfoShippingPage';

export const metadata: Metadata = {
  title: '配送 & 退貨政策 — PCM Motorsports',
  description: '宅配運費與免運門檻、退換貨政策(客製代購商品依消保法 19 條不適用七天鑑賞期)、常見問題。',
};

export default function InfoShippingRoute() {
  return <InfoShippingPage />;
}
