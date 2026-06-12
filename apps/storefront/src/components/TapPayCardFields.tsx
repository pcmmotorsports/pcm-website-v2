'use client';

// TapPayCardFields.tsx — TapPay 安全卡欄(M-3 ②-④a)
//
// 直接搬 design-reference/components/CheckoutPage.jsx L401-423 co-card-form 結構字面(鐵則 1):
// label.auth-field + span 卡號/有效期/CVV + co-card-row 兩欄列。
// 🔴 安全 override(commit body 揭示):design mock 的 <input value={card.*}> 以 TapPay Fields
// iframe 容器(div.tpfield)取代 —— 卡資料零進 React state / 零進我方 DOM input(PCI;kickoff §3 ①);
// placeholder 字面由 useTapPayCard 的 card.setup 傳給 SDK(iframe 內渲染、與 design 同字)。
//
// 狀態 UI:欄位 status 2(error)→ 容器加 .tpfield-error 標紅(鏡像官方 example field-error);
// 容器用 div.auth-field(非 label htmlFor:iframe 非 labelable 元素、HTML 語意無效;aria-label 補語意)。
// SDK 對 focus 容器自動注入 .tappay-field-focus(checkout.css 提供樣式)。
// env 缺/SDK 載入失敗(ready:'error')→ 渲染錯誤態、不掛頁(fail-safe)。

import { TAPPAY_FIELD_IDS, type TapPayCardState } from '@/hooks/useTapPayCard';

export type TapPayCardFieldsProps = {
  ready: TapPayCardState['ready'];
  fieldStatus: TapPayCardState['fieldStatus'];
};

export function TapPayCardFields({ ready, fieldStatus }: TapPayCardFieldsProps) {
  if (ready === 'error') {
    return (
      <div className="co-card-form">
        <p className="co-card-error" role="alert">
          付款模組暫時無法使用,請稍後再試或聯繫客服 LINE
        </p>
      </div>
    );
  }

  return (
    <div className="co-card-form">
      <div className="auth-field">
        <span>卡號</span>
        <div
          id={TAPPAY_FIELD_IDS.number}
          className={`tpfield ${fieldStatus.number === 2 ? 'tpfield-error' : ''}`}
          aria-label="卡號"
        />
      </div>
      <div className="co-card-row">
        <div className="auth-field">
          <span>有效期</span>
          <div
            id={TAPPAY_FIELD_IDS.expirationDate}
            className={`tpfield ${fieldStatus.expiry === 2 ? 'tpfield-error' : ''}`}
            aria-label="有效期"
          />
        </div>
        <div className="auth-field">
          <span>CVV</span>
          <div
            id={TAPPAY_FIELD_IDS.ccv}
            className={`tpfield ${fieldStatus.ccv === 2 ? 'tpfield-error' : ''}`}
            aria-label="CVV"
          />
        </div>
      </div>
      {ready === 'loading' && <div className="co-card-note">安全卡片欄位載入中…</div>}
      <div className="co-card-note">卡片資訊由 TapPay 安全欄位加密處理,PCM 不經手亦不儲存卡號</div>
    </div>
  );
}
