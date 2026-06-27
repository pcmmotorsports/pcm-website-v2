'use client';

// CheckoutRedirecting.tsx — 3DS 啟動成功 → 整頁導向 TapPay 付款頁(M-3 3DS-6b;pivot A 整頁唯一路徑)
//
// 為什麼獨立元件:① CheckoutView 已近 400 行、加 effect + interstitial 會破鐵則 6 的 400 行硬上限;
//   ② render 期不可副作用 → 把 window.location 導向封裝進本元件的 useEffect(可單元測 mock)。
//
// 🔴 redirectUrl = TapPay payment_url(含 token query):只用於導向(useEffect auto + 手動鈕 href)、
//   **絕不 log、絕不於畫面顯示原值**(可見文字只「正在前往…」+「點此繼續付款」、payment_url 僅進 <a href>)。
// 🔴 視覺零新 CSS:沿用 CheckoutSuccess 的 co-page / co-main co-success / co-success-card + btn-primary
//   co-success-cta(同「返回購物車」鈕)pattern(已驗)。
// 🟢 #239 手動跳轉鈕(P2、2026-06-27 Sean 拍 A):auto window.location.assign 若被瀏覽器擋(部分行動 /
//   隱私瀏覽器擋程式化導航)→ 客人卡此頁。加手動 <a href={payment_url}>「未自動跳轉?點此繼續付款」讓客人
//   點了整頁跳 TapPay(同頁導向、非 target=_blank → 無 reverse tabnabbing;與 auto 同一目的地)。
//   business override:design-reference 無付款 redirect / 等待畫面(grep 0 命中)→ 沿用既有 co-success-cta
//   樣式 + 文案 L2 hardcode、Sean 批;= open drift(同 CheckoutRedirecting / CheckoutSuccess processing 既有 override)。

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
          {/* 🟢 #239 手動 fallback(P2):auto 導向被擋時客人點此整頁跳 TapPay。payment_url 僅進 href
              (導向、非可見文字、不 log);同頁導向不開新分頁 → 無 tabnabbing。沿用 CheckoutSuccess CTA 樣式。 */}
          <a href={redirectUrl} className="btn-primary co-success-cta">
            未自動跳轉?點此繼續付款 <span>→</span>
          </a>
        </div>
      </main>
      <HomeFooter />
    </div>
  );
}
