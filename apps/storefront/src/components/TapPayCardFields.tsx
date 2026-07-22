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
//
// 🔴 U4a:**內層 role="alert" 已移除**(原本掛在 ready==='error' 那顆 <p> 上)。
//   原因 = design §7.2「付款區同時提供一個 role="alert" 的錯誤摘要,避免多個 assertive alert 一起朗讀」;
//   assertive 通知統一由 CheckoutPaymentFeedback 發出。
//   ⚠️ **拆它與接上 card.module 摘要必須同片完成**(plan U4a §④ 明文):先拆而摘要沒接
//   = SDK 失敗時完全沒有 assertive 通知 = 無障礙退化。本片兩件事一起做。
//
// 🔴 逐欄紅字的版面陷阱(實查 CSS,非推理):
//   - `.co-card-row` 是 `grid-template-columns: 1fr 1fr`(checkout.css:324)→ 紅字**必須放在
//     `.auth-field` 內部**;做成 `.co-card-row` 的直接子元素會多出一個格子、把兩欄擠歪。
//   - `.auth-field` 是 `display:block`(auth.css:65),內部放紅字安全。
//   - `.auth-field > span` 是灰 mono uppercase(auth.css:69,specificity 0,1,1)→ 裸 <span> 會被蓋成灰;
//     **必須用 `.auth-field-err` class**(auth.css:100 提權 0,2,0)。#181 實錘過。
//   三綠與單元測試都看不見這種版面回歸 → 配 DOM 位置守門測試。
//
// 🔴 誠實邊界:aria-invalid / aria-describedby 掛在無顯式 role 的 div.tpfield 上,
//   **螢幕閱讀器是否真的朗讀未經實測**;真正的可及容器(role="group" + tabIndex)是 U4b 的交付項。
//   本檔只宣稱「屬性已掛上且有守門測試」,不宣稱無障礙已合規。

import { TAPPAY_FIELD_IDS, type TapPayCardState } from '@/hooks/useTapPayCard';
import type { CheckoutPaymentErrors } from '@/lib/checkout/validate-checkout-payment';

export type TapPayCardFieldsProps = {
  ready: TapPayCardState['ready'];
  fieldStatus: TapPayCardState['fieldStatus'];
  /**
   * U4a:卡片欄錯誤(只讀 `card.*` 四鍵)。
   * 🔴 本元件只負責**顯示**,不自行驗證、不自行清除 —— 唯一真相是 View 每 render 由 live fieldStatus
   *   衍生的結果(`validateTapPayFields`)。也**不收非卡片錯誤**:那些由 CheckoutStep2 顯示,
   *   兩邊各收各的、唯一合併點在 usePaymentErrors.alertFor(避免第二個合併點漂移)。
   */
  errors: CheckoutPaymentErrors;
};

/** 單欄:紅字必須放在 `.auth-field` **內部**(見檔頭版面陷阱說明)。 */
function CardField({
  id,
  label,
  errorId,
  error,
  isInvalid,
}: {
  id: string;
  label: string;
  errorId: string;
  error: string | undefined;
  isInvalid: boolean;
}) {
  return (
    <div className="auth-field">
      <span>{label}</span>
      <div
        id={id}
        className={`tpfield ${isInvalid ? 'tpfield-error' : ''}`}
        aria-label={label}
        aria-invalid={error ? 'true' : undefined}
        // 🔴 條件式:沒錯時不掛,否則留下指向不存在節點的 dangling idref(對齊 U3b 發票三欄寫法)。
        aria-describedby={error ? errorId : undefined}
      />
      {error && (
        <span id={errorId} className="auth-field-err">
          {error}
        </span>
      )}
    </div>
  );
}

export function TapPayCardFields({ ready, fieldStatus, errors }: TapPayCardFieldsProps) {
  if (ready === 'error') {
    return (
      <div className="co-card-form">
        {/* 🔴 U4a 移除了這裡原本的 role="alert"(見檔頭):assertive 通知改由付款區唯一出口
            CheckoutPaymentFeedback 統一發,避免兩個 alert 同時朗讀(design §7.2)。
            文字改吃 card.module,不再寫死 —— 同一個 key 也承載「載入中」與「尚未通過驗證」兩種狀況。 */}
        <p className="co-card-error">{errors['card.module']}</p>
      </div>
    );
  }

  return (
    <div className="co-card-form">
      <CardField
        id={TAPPAY_FIELD_IDS.number}
        label="卡號"
        errorId="checkout-card-number-error"
        error={errors['card.number']}
        isInvalid={fieldStatus.number === 2}
      />
      <div className="co-card-row">
        <CardField
          id={TAPPAY_FIELD_IDS.expirationDate}
          label="有效期"
          errorId="checkout-card-expiry-error"
          error={errors['card.expiry']}
          isInvalid={fieldStatus.expiry === 2}
        />
        <CardField
          id={TAPPAY_FIELD_IDS.ccv}
          label="CVV"
          errorId="checkout-card-ccv-error"
          error={errors['card.ccv']}
          isInvalid={fieldStatus.ccv === 2}
        />
      </div>
      {/* ready==='loading' 時 card.module 承載「付款欄位載入中,請稍候」(按過付款才產生);
          下面這行是**既有**的靜態載入提示、與錯誤通道無關,維持不變。 */}
      {ready === 'loading' && <div className="co-card-note">安全卡片欄位載入中…</div>}
      {errors['card.module'] && <p className="co-card-error">{errors['card.module']}</p>}
      <div className="co-card-note">卡片資訊由 TapPay 安全欄位加密處理,PCM 不經手亦不儲存卡號</div>
    </div>
  );
}
