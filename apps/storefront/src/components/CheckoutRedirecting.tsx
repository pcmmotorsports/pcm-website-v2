'use client';

// CheckoutRedirecting.tsx — 3DS 啟動成功 → 整頁導向 TapPay 付款頁(M-3 3DS-6b)
//
// 為什麼獨立元件:① CheckoutView 已近 400 行、加 effect + interstitial 會破鐵則 6 的 400 行硬上限;
//   ② render 期不可副作用 → 把 window.location 導向封裝進本元件的 useEffect(可單元測 mock)。
//
// 🔴 redirectUrl = TapPay payment_url(含 token query):只用於 window.location.assign 導向、
//   **絕不 log、絕不於畫面顯示原值**(只顯「正在前往…」文案)。
// 🔴 視覺零新 CSS:沿用 CheckoutSuccess 的 co-page / co-main co-success / co-success-card pattern(已驗)。
// 🟡 N2(審查側 nit + codex 關卡2、本片不做、backlog #239):無 fallback「N 秒後手動點此繼續」連結 →
//   導向被瀏覽器擋時使用者卡此頁。Phase I(0 真流量、sandbox-only)可接受;flag 對外開啟前補(#239)。

import { useEffect } from 'react';
import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';

export function CheckoutRedirecting({ redirectUrl }: { redirectUrl: string }) {
  useEffect(() => {
    // 整頁導向 TapPay 3DS 付款頁(payment_url 含 token、絕不 log)。redirectUrl 入 deps、無 disable。
    window.location.assign(redirectUrl);
  }, [redirectUrl]);

  return (
    <div data-screen-label="Checkout" className="co-page">
      <Header currentPage="checkout" />
      <main className="co-main co-success">
        <div className="co-success-card">
          <div className="ap-mono co-success-eyebrow">N°PAYMENT · 3D SECURE</div>
          <h1 className="co-success-title">正在前往安全付款頁面</h1>
          <p className="co-success-note">
            即將為您導向銀行 3D 驗證頁面完成付款,請稍候片刻、勿關閉或重新整理視窗。
          </p>
        </div>
      </main>
      <HomeFooter />
    </div>
  );
}
