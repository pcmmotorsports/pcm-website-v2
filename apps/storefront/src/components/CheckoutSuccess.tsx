'use client';

// CheckoutSuccess.tsx — 結帳頁內最小成功狀態(M-3-S2-b2-e3b、Q-e3=A;Q1=A 最小)
//
// 建單成功後在結帳頁內就地顯示(不導頁;design OrderCompletePage 完整完成頁是後續 slice)。
// 字面借 design-reference/components/OrderCompletePage.jsx:eyebrow「N°ORDER · CONFIRMED」(L33)、
//   主標「訂單已成立」(L34)、訂單編號標籤「N°ORDER」(L41)、CTA「繼續購物」(L109)。
// Q1=A 最小範圍偏離:不顯金額 / email、無複製訂單編號鈕、不放「查看訂單詳情」(讀路徑 stage③ 未做、會是死連結)。
// displayId 為真單號(PlaceOrderResult.displayId、create_order RPC 產;非 design 的 random mock)。

import Link from 'next/link';
import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';

export type CheckoutSuccessProps = {
  /** 建單回傳的人類可讀單號(PCM-YYYY-NNNN;零價結構,成功頁不讀回明細) */
  displayId: string;
};

export function CheckoutSuccess({ displayId }: CheckoutSuccessProps) {
  return (
    <div data-screen-label="Checkout" className="co-page">
      <Header currentPage="checkout" />
      <main className="co-main co-success">
        <div className="co-success-card">
          <div className="ap-mono co-success-eyebrow">N°ORDER · CONFIRMED</div>
          <h1 className="co-success-title">訂單已成立</h1>
          <p className="co-success-note">我們會盡快為您出貨。</p>
          <div className="co-success-order">
            <div className="ap-mono co-success-order-label">N°ORDER</div>
            <div className="co-success-order-no">{displayId}</div>
          </div>
          <Link href="/products" className="btn-primary co-success-cta">
            繼續購物 <span>→</span>
          </Link>
        </div>
      </main>
      <HomeFooter />
    </div>
  );
}
