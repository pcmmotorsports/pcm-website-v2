'use client';

// CheckoutStep2.tsx — 結帳第二步的唯一內容元件(M-3 兩步結帳 Slice U2b)
//
// 區塊來源(鐵則 1 字面真權威):
//   - 發票 N°03 / 付款方式 N°04 = design-reference/components/CheckoutPage.jsx Step2(L317-437)。
//   - 精簡收件摘要 / 商品清單 + 同意條款 = design 同檔 Step3(L506-594),U2a 抽成
//     `CheckoutStep2ReviewSections.tsx` 的 CheckoutShippingSummary / CheckoutOrderReview,本檔消費。
//
// 🔴 U2b:退役 `CheckoutStep3.tsx` shell,第二步收斂為單欄五段——
//   精簡收件摘要 → 發票 → 付款方式(唯一真 TapPay 卡欄)→ 商品清單 → 條款。
//   同時刪除:①disabled 假卡欄(3 個 input + 佔位說明)②重複的發票 readonly 複查節點
//   (可編輯發票表單就在本檔上方)③重複的付款複查區塊(U2a 抽出的 CheckoutPaymentSection)。
//
// 🔴 付款區落點(2026-07-22 Sean 拍 A 案):真 `TapPayCardFields` 以 `paymentSlot` 掛在
//   `.co-pay-body` 內、緊接付款方式說明文字下方 = design L400-422 的原始結構
//   (`.co-card-form` 的 margin-top / border-top 本就為此位置而寫)。
//   未來新增 LINE Pay / 虛擬帳號時,各自的細節面板同樣掛在自己那個 `.co-pay` 選項的 body 內。
//
// 🔴 business override checkoutPaymentLabelPlainLanguage(2026-07-22 Sean 拍 Q2=C):付款文案改白話——
//   拿掉金流商品牌與後端技術名詞(講給工程師聽的、對客人無意義),保留卡別與 3D 驗證以增加下單信心。
//   屬授權覆蓋 design、非自行翻譯;被覆蓋的 design 原字面逐字對照見 manifest 該 override 的
//   design_value / storefront_value(唯一權威落點,此處不複製、避免兩地字面漂移)。
//
// 安全契約:PAN / 有效期 / CVV 只存在 TapPay iframe,不進 React state、我方 input、server、log、DB;
//   本檔零 <input> 收卡資料(唯一卡片輸入表面 = paymentSlot 傳入的 TapPayCardFields)。
//
// design 偏離(commit body + manifest 揭示):
//   - ATM 轉帳不做(plan §3.2 隱藏)→ 只渲染信用卡單一付款方式(checked readOnly、鏡像 e1 單一配送)。
//   - 儲值金折抵(design N°05)+ 優惠券(design N°05/06)不做(plan §3.2 + g-7 wallet HOLD #202)。
//   - design --c-accent / --font-mono 在 tokens 漏定義 / typo → CSS 對映 --c-red / --f-mono(見 checkout.css)。
//
// 🔴 殘餘風險(U2b 明示、待手機肉眼驗):`.co-pay` 依 design 為 <label>,點「卡號 / 有效期 / CVV」
//   文字標籤(非 iframe 本身)時,label activation 可能把焦點交給隱藏的 readOnly radio。
//   iframe 為 interactive content、點 iframe 本身不受影響;跨瀏覽器焦點結果未實測。

import type { ReactNode } from 'react';
import type { CustomerAddress, InvoiceType } from '@pcm/domain';
import {
  CheckoutOrderReview,
  CheckoutShippingSummary,
} from '@/components/CheckoutStep2ReviewSections';
import type { ResolvedCartLineView } from '@/hooks/useResolvedCart';
import type { CheckoutPaymentErrors } from '@/lib/checkout/validate-checkout-payment';

/** 發票草稿:對齊 CheckoutInput.invoice zod(b2-a)+ CustomerAddress.invoice 真資料形狀。 */
export type InvoiceDraft = CustomerAddress['invoice'];

const INVOICE_TABS: { id: InvoiceType; label: string }[] = [
  { id: 'personal', label: '個人發票' },
  { id: 'company', label: '公司發票(三聯式)' },
  { id: 'donate', label: '捐贈發票' },
];

export type CheckoutStep2Props = {
  /** 選中的收件地址(= addresses.find(shippingAddrId));undefined 不渲染摘要 body。 */
  currentAddr: CustomerAddress | undefined;
  /** 配送方式顯示字(Q1=A 僅「貨運宅配」)。 */
  shippingLabel: string;
  /** 編輯收件 → 跳回 step1。 */
  onEditAddress: () => void;
  invoice: InvoiceDraft;
  /** 設定發票草稿;呼叫端(本元件)同時 setInvoiceOverride(true) 標記使用者已手動修改。 */
  setInvoice: (inv: InvoiceDraft) => void;
  /** 是否已手動覆寫地址預設發票(true 時隱藏「自動帶入」提示、顯示還原鈕)。 */
  invoiceOverride: boolean;
  setInvoiceOverride: (v: boolean) => void;
  /** 唯一真卡輸入表面(TapPayCardFields);undefined 則付款區只顯選項、不掛卡欄。 */
  paymentSlot?: ReactNode;
  /** server-resolved 購物車行(釘 general、零經銷洩漏)。 */
  lines: ResolvedCartLineView[];
  agreed: boolean;
  onAgreedChange: (v: boolean) => void;
  /** 編輯商品 → 回購物車。 */
  onEditItems: () => void;
  /**
   * U3b:非卡片錯誤 map(由 CheckoutView 在按下確認付款時產生、逐欄清除)。
   * 🔴 本元件只負責**顯示**,不自行驗證、不自行清除 —— 唯一真相在 View 的 state。
   */
  errors: CheckoutPaymentErrors;
};

export function CheckoutStep2({
  currentAddr,
  shippingLabel,
  onEditAddress,
  invoice,
  setInvoice,
  invoiceOverride,
  setInvoiceOverride,
  paymentSlot,
  lines,
  agreed,
  onAgreedChange,
  onEditItems,
  errors,
}: CheckoutStep2Props) {
  // 任一發票欄變更 → 標記 override(停止地址自動帶入)。
  const patch = (p: Partial<InvoiceDraft>) => {
    setInvoiceOverride(true);
    setInvoice({ ...invoice, ...p });
  };

  return (
    <>
      {/* ===== 精簡收件摘要(design §6.1;完整地址仍在 DOM、單行截短純 CSS)===== */}
      <section className="co-section">
        <CheckoutShippingSummary
          currentAddr={currentAddr}
          shippingLabel={shippingLabel}
          onEdit={onEditAddress}
          shippingError={errors['shipping.address']}
          emailError={errors.notificationEmail}
        />
      </section>

      {/* ===== N°03 · INVOICE 發票資訊 ===== */}
      <section className="co-section">
        <div className="co-section-head">
          <div className="ap-mono">N°03 · INVOICE</div>
          <h2>發票資訊</h2>
          {!invoiceOverride && (
            <div className="co-inv-hint ap-mono">已從收件地址自動帶入 · 仍可修改</div>
          )}
        </div>
        <div className="co-inv">
          <div className="co-inv-tabs">
            {INVOICE_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`co-inv-tab ${invoice.type === t.id ? 'is-on' : ''}`}
                onClick={() => patch({ type: t.id })}
              >
                {t.label}
              </button>
            ))}
          </div>

          {invoice.type === 'personal' && (
            <div className="co-inv-grid">
              <label className="auth-field co-inv-full">
                <span>手機載具(選填,以 / 開頭)</span>
                <input
                  value={invoice.carrier}
                  placeholder="/ABCD123"
                  onChange={(e) => patch({ carrier: e.target.value })}
                />
              </label>
              <div className="co-inv-note">未填載具者寄送電子發票至註冊 Email</div>
            </div>
          )}

          {/* 🔴 U3b 紅字一律放在 label.auth-field **內部**:`.co-inv-grid` 是
              `grid-template-columns: 1fr 1fr`(checkout.css:158),任何直接子元素都會變成一個格子、
              把欄位排版擠歪,而三綠與單元測試都看不見這種版面回歸(見測試的 DOM 位置守門)。 */}
          {invoice.type === 'company' && (
            <div className="co-inv-grid">
              <label className="auth-field">
                <span>公司抬頭</span>
                <input
                  id="checkout-invoice-title"
                  value={invoice.title}
                  placeholder="例:賓士機車有限公司"
                  aria-invalid={errors['invoice.title'] ? 'true' : undefined}
                  aria-describedby={errors['invoice.title'] ? 'checkout-invoice-title-error' : undefined}
                  onChange={(e) => patch({ title: e.target.value })}
                />
                {errors['invoice.title'] && (
                  <span id="checkout-invoice-title-error" className="auth-field-err">
                    {errors['invoice.title']}
                  </span>
                )}
              </label>
              <label className="auth-field">
                <span>統一編號</span>
                <input
                  id="checkout-invoice-tax-id"
                  value={invoice.taxId}
                  placeholder="8 碼數字"
                  maxLength={8}
                  aria-invalid={errors['invoice.taxId'] ? 'true' : undefined}
                  aria-describedby={errors['invoice.taxId'] ? 'checkout-invoice-tax-id-error' : undefined}
                  onChange={(e) => patch({ taxId: e.target.value })}
                />
                {errors['invoice.taxId'] && (
                  <span id="checkout-invoice-tax-id-error" className="auth-field-err">
                    {errors['invoice.taxId']}
                  </span>
                )}
              </label>
            </div>
          )}

          {invoice.type === 'donate' && (
            <div className="co-inv-grid">
              <label className="auth-field co-inv-full">
                <span>愛心碼</span>
                <input
                  id="checkout-invoice-donate-code"
                  value={invoice.donateCode}
                  placeholder="例:8585"
                  aria-invalid={errors['invoice.donateCode'] ? 'true' : undefined}
                  aria-describedby={
                    errors['invoice.donateCode'] ? 'checkout-invoice-donate-code-error' : undefined
                  }
                  onChange={(e) => patch({ donateCode: e.target.value })}
                />
                {errors['invoice.donateCode'] && (
                  <span id="checkout-invoice-donate-code-error" className="auth-field-err">
                    {errors['invoice.donateCode']}
                  </span>
                )}
              </label>
              <div className="co-inv-note">常用:925(伊甸)、5995(家扶)、8585(罕病)</div>
            </div>
          )}

          {invoiceOverride && (
            <button
              type="button"
              className="co-inv-reset"
              onClick={() => setInvoiceOverride(false)}
            >
              ↻ 還原為地址預設發票
            </button>
          )}
        </div>
      </section>

      {/* ===== N°04 · PAYMENT METHOD 付款方式(唯一真卡輸入表面)===== */}
      <section className="co-section">
        <div className="co-section-head">
          <div className="ap-mono">N°04 · PAYMENT METHOD</div>
          <h2>付款方式</h2>
        </div>

        <div className="co-pay-list">
          {/* Q1=A 僅信用卡;ATM 隱藏(§3.2)。單一選項 → checked readOnly(鏡像 e1 配送)。 */}
          <label className="co-pay is-on">
            {/* 🔴 aria-label 必要(Fable 對抗審查 F1):外層是 <label>,radio 的可及名稱預設由整個 label
                內容組成。U2a 之前卡欄是 aria-hidden 的假預覽、不入名稱;U2b 換成**真** TapPayCardFields
                後不能 aria-hidden(它是互動元素)→ 螢幕閱讀器念這顆 radio 會把「卡號 / 有效期 / CVV /
                卡片資訊由 TapPay 安全欄位加密處理…」整串一起念出來。顯式 aria-label 蓋掉推導名稱。 */}
            <input type="radio" name="pay" checked readOnly aria-label="信用卡付款" />
            <span className="co-pay-radio" />
            <div className="co-pay-body">
              <div className="co-pay-label">信用卡付款</div>
              <div className="co-pay-desc">VISA · Mastercard · JCB · AE，3D 驗證</div>
              {/* 🔴 唯一真卡輸入表面:TapPayCardFields 自帶 .co-card-form(卡資料只在 iframe 內)。 */}
              {paymentSlot}
            </div>
          </label>
        </div>
      </section>

      {/* ===== N°05 · REVIEW 確認訂單(商品清單 + 同意條款)===== */}
      <section className="co-section">
        <div className="co-section-head">
          <div className="ap-mono">N°05 · REVIEW</div>
          <h2>確認訂單</h2>
        </div>
        <CheckoutOrderReview
          lines={lines}
          agreed={agreed}
          onAgreedChange={onAgreedChange}
          onEditItems={onEditItems}
          termsError={errors.terms}
        />
      </section>
    </>
  );
}
