'use client';

// CheckoutCartNotice.tsx — 結帳頁的「載入中 / 空車」兩個過場畫面(M-3 兩步結帳 Slice U4a-0)
//
// 🔴 抽出理由 = 鐵則 6(同 CheckoutTerminalScreen):替 U4a(卡片欄錯誤)與 U4b(focus registry)
//   騰出 CheckoutView.tsx 的行數跑道。**行為零變更**:JSX 逐字搬移,
//   `data-screen-label` / class 名 / 文案 / Header / HomeFooter 全部不變。
//
// 🔴 空車的「繼續購物」導航**不寫死在本檔**:抽元件不得順手偷換導航方式,
//   由 CheckoutView 傳 `onContinueShopping`(2026-08-09 起改走 `navigateToCatalog`、不再裸 push
//   —— 落地必須在頁面頂端,否則首排商品會被黏頂篩選列蓋住;見 `lib/catalog-navigation.ts`)。
//   variant='loading' 沒有這個 prop = 型別層擋掉「載入畫面也塞一顆按鈕」的誤用。

import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';

export type CheckoutCartNoticeProps =
  | { variant: 'loading' }
  | { variant: 'empty'; onContinueShopping: () => void }
  /** A2:問不到 server(≠ 空車)。與 'loading' 同樣沒有 `onContinueShopping` ——
   *  讀不到的下一步是**重試**,不是去逛街。 */
  | { variant: 'error' };

export function CheckoutCartNotice(props: CheckoutCartNoticeProps) {
  return (
    <div data-screen-label="Checkout" className="co-page">
      <Header currentPage="checkout" />
      {props.variant === 'loading' ? (
        <div className="cart-loading">載入結帳資料…</div>
      ) : props.variant === 'error' ? (
        // A2:🔴 **不得**沿用「購物車是空的」那段字 —— 客人的品項還在,那樣寫是說謊,
        //   而在結帳這一步說謊更貴:他可能回頭再加一次、或以為已經下單了。
        <div className="cart-empty" role="alert">
          <h2>暫時讀不到你的購物車</h2>
          <p>你的商品沒有不見,是我們這邊一時讀不到。請重新整理頁面再試一次。</p>
        </div>
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
