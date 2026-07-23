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
// 🔴 U4b 起:每卡欄的可及容器 = 外層 `.auth-field`(role="group" + tabIndex={-1} + wrapperId
//   `checkout-card-*`),ARIA(aria-label / aria-invalid / aria-describedby)集中掛此容器;
//   內層 `.tpfield`(SDK mount、TAPPAY_FIELD_IDS)不再掛 ARIA。focusFirstPaymentError 聚焦此容器並
//   捲至該區(design §7.2 末句「iframe 無法直接聚焦內部 input 時,聚焦該欄的可存取容器」)。
//   ⚠️ 誠實邊界:jsdom 測得到「focus 落在此容器」;但「螢幕閱讀器實際朗讀」與「programmatic focus
//   在 <label class=co-pay> 內不彈到隱藏 radio」由 agent-browser 真瀏覽器驗、跨瀏覽器未全測。

import { TAPPAY_FIELD_IDS, type TapPayCardState } from '@/hooks/useTapPayCard';
import { PAYMENT_FOCUS_TARGET_IDS } from '@/lib/checkout/focus-first-error';
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

/**
 * 單欄:紅字必須放在 `.auth-field` **內部**(見檔頭版面陷阱說明)。
 *
 * 🔴 U4b:`.auth-field` 本身就是「可聚焦的可及容器」(role=group + tabIndex=-1 + `wrapperId`)——
 *   iframe 無法直接聚焦內部 input(design §7.2 末句),focusFirstPaymentError 聚焦此外層並捲至該區。
 *   **不另包一層新 div**:零新增節點 → `.co-card-row`(grid 1fr 1fr)子數不變、零版面回歸風險。
 *   ARIA(aria-label / aria-invalid / aria-describedby)集中掛在此可及容器,**內層 SDK mount 不再掛**
 *   (避免雙層對同一紅字重複朗讀;Fable N1)。內層 `mountId`(TAPPAY_FIELD_IDS)= SDK setup selector,
 *   id / class / 位置一律不動。
 */
function CardField({
  wrapperId,
  mountId,
  label,
  errorId,
  error,
  isInvalid,
}: {
  /** 可聚焦容器 id(checkout-card-*;無 `-error` 尾綴,勿與紅字 span id 混淆)。 */
  wrapperId: string;
  /** 內層 SDK mount id(TAPPAY_FIELD_IDS.*);card.setup 引用,不得變。 */
  mountId: string;
  label: string;
  errorId: string;
  error: string | undefined;
  isInvalid: boolean;
}) {
  return (
    <div
      id={wrapperId}
      className="auth-field"
      role="group"
      tabIndex={-1}
      aria-label={label}
      aria-invalid={error ? 'true' : undefined}
      // 🔴 條件式:沒錯時不掛,否則留下指向不存在節點的 dangling idref(對齊 U3b 發票三欄寫法)。
      aria-describedby={error ? errorId : undefined}
    >
      <span>{label}</span>
      <div id={mountId} className={`tpfield ${isInvalid ? 'tpfield-error' : ''}`} />
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
      // 🔴 U4b:.co-card-form = card.module 的可聚焦容器(id=checkout-payment-module、role=group、
      //   tabIndex=-1)。與下方正常態的 .co-card-form 互斥(if/else、同時只有一個在 DOM)→ 非重複 id。
      <div
        id={PAYMENT_FOCUS_TARGET_IDS.paymentModule}
        className="co-card-form"
        role="group"
        tabIndex={-1}
        aria-label="信用卡付款欄位"
      >
        {/* 🔴 U4a 移除了這裡原本的 role="alert"(見檔頭):assertive 通知改由付款區唯一出口
            CheckoutPaymentFeedback 統一發,避免兩個 alert 同時朗讀(design §7.2)。
            文字改吃 card.module,不再寫死 —— 同一個 key 也承載「載入中」與「尚未通過驗證」兩種狀況。 */}
        <p className="co-card-error">{errors['card.module']}</p>
      </div>
    );
  }

  return (
    <div
      id={PAYMENT_FOCUS_TARGET_IDS.paymentModule}
      className="co-card-form"
      role="group"
      tabIndex={-1}
      aria-label="信用卡付款欄位"
    >
      <CardField
        wrapperId={PAYMENT_FOCUS_TARGET_IDS.cardNumber}
        mountId={TAPPAY_FIELD_IDS.number}
        label="卡號"
        errorId="checkout-card-number-error"
        error={errors['card.number']}
        isInvalid={fieldStatus.number === 2}
      />
      <div className="co-card-row">
        <CardField
          wrapperId={PAYMENT_FOCUS_TARGET_IDS.cardExpiry}
          mountId={TAPPAY_FIELD_IDS.expirationDate}
          label="有效期"
          errorId="checkout-card-expiry-error"
          error={errors['card.expiry']}
          isInvalid={fieldStatus.expiry === 2}
        />
        <CardField
          wrapperId={PAYMENT_FOCUS_TARGET_IDS.cardCcv}
          mountId={TAPPAY_FIELD_IDS.ccv}
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
