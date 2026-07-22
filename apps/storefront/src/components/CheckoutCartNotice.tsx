'use client';

// CheckoutCartNotice.tsx — 結帳頁的「載入中 / 空車」兩個過場畫面(M-3 兩步結帳 Slice U4a-0)
//
// 🔴 抽出理由 = 鐵則 6(同 CheckoutTerminalScreen):替 U4a(卡片欄錯誤)與 U4b(focus registry)
//   騰出 CheckoutView.tsx 的行數跑道。**行為零變更**:JSX 逐字搬移,
//   `data-screen-label` / class 名 / 文案 / Header / HomeFooter 全部不變。
//
// 🔴 空車的「繼續購物」導航**不寫死在本檔**:抽元件不得順手偷換導航方式,
//   由 CheckoutView 傳 `onContinueShopping`(維持原本的 `router.push('/products')`)。
//   variant='loading' 沒有這個 prop = 型別層擋掉「載入畫面也塞一顆按鈕」的誤用。

import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';

export type CheckoutCartNoticeProps =
  | { variant: 'loading' }
  | { variant: 'empty'; onContinueShopping: () => void };

export function CheckoutCartNotice(props: CheckoutCartNoticeProps) {
  return (
    <div data-screen-label="Checkout" className="co-page">
      <Header currentPage="checkout" />
      {props.variant === 'loading' ? (
        <div className="cart-loading">載入結帳資料…</div>
      ) : (
        <div className="cart-empty">
          <h2>購物車是空的</h2>
          <p>先挑選部品再來結帳吧。</p>
          <button className="btn-primary" onClick={props.onContinueShopping}>繼續購物</button>
        </div>
      )}
      <HomeFooter />
    </div>
  );
}
