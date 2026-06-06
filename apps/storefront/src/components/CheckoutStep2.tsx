'use client';

// CheckoutStep2.tsx — 結帳 Step2 發票 + 付款方式(M-3-S2-b2-e2)
//
// 直接搬 design-reference/components/CheckoutPage.jsx Step2(L317-437、鐵則 1 字面)。
// 由 CheckoutView 在 step === 2 時渲染;invoice / invoiceOverride state 提升至 CheckoutView
// (跨步驟存活、e3 送出時讀),本元件為 presentational 收 props。
//
// design 偏離(commit body + manifest 揭示):
//   - 🔴 信用卡欄純 UI placeholder、disabled、零 state 捕獲(審查側條件 2:本片不收/不存/不送
//     原始卡號·cvv、不建立「原始卡→server」pattern;真卡處理留階段② TapPay SDK 前端 tokenize、
//     原始 PAN/CVV 永不進 server/state/DB)。
//   - ATM 轉帳不做(plan §3.2 隱藏)→ 只渲染 TapPay 單一付款方式(checked readOnly、鏡像 e1 單一配送)。
//   - 儲值金折抵(design N°05)+ 優惠券(design N°05/06)不做(plan §3.2 + g-7 wallet HOLD #202)。
//   - design --c-accent / --font-mono 在 tokens 漏定義 / typo → CSS 對映 --c-red / --f-mono(見 checkout.css)。

import type { CustomerAddress, InvoiceType } from '@pcm/domain';

/** 發票草稿:對齊 CheckoutInput.invoice zod(b2-a)+ CustomerAddress.invoice 真資料形狀。 */
export type InvoiceDraft = CustomerAddress['invoice'];

const INVOICE_TABS: { id: InvoiceType; label: string }[] = [
  { id: 'personal', label: '個人發票' },
  { id: 'company', label: '公司發票(三聯式)' },
  { id: 'donate', label: '捐贈發票' },
];

export type CheckoutStep2Props = {
  invoice: InvoiceDraft;
  /** 設定發票草稿;呼叫端(本元件)同時 setInvoiceOverride(true) 標記使用者已手動修改。 */
  setInvoice: (inv: InvoiceDraft) => void;
  /** 是否已手動覆寫地址預設發票(true 時隱藏「自動帶入」提示、顯示還原鈕)。 */
  invoiceOverride: boolean;
  setInvoiceOverride: (v: boolean) => void;
};

export function CheckoutStep2({
  invoice,
  setInvoice,
  invoiceOverride,
  setInvoiceOverride,
}: CheckoutStep2Props) {
  // 任一發票欄變更 → 標記 override(停止地址自動帶入)。
  const patch = (p: Partial<InvoiceDraft>) => {
    setInvoiceOverride(true);
    setInvoice({ ...invoice, ...p });
  };

  return (
    <>
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

          {invoice.type === 'company' && (
            <div className="co-inv-grid">
              <label className="auth-field">
                <span>公司抬頭</span>
                <input
                  value={invoice.title}
                  placeholder="例:賓士機車有限公司"
                  onChange={(e) => patch({ title: e.target.value })}
                />
              </label>
              <label className="auth-field">
                <span>統一編號</span>
                <input
                  value={invoice.taxId}
                  placeholder="8 碼數字"
                  maxLength={8}
                  onChange={(e) => patch({ taxId: e.target.value })}
                />
              </label>
            </div>
          )}

          {invoice.type === 'donate' && (
            <div className="co-inv-grid">
              <label className="auth-field co-inv-full">
                <span>愛心碼</span>
                <input
                  value={invoice.donateCode}
                  placeholder="例:8585"
                  onChange={(e) => patch({ donateCode: e.target.value })}
                />
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

      {/* ===== N°04 · PAYMENT METHOD 付款方式 ===== */}
      <section className="co-section">
        <div className="co-section-head">
          <div className="ap-mono">N°04 · PAYMENT METHOD</div>
          <h2>付款方式</h2>
        </div>

        <div className="co-pay-list">
          {/* Q1=A 僅信用卡(TapPay);ATM 隱藏(§3.2)。單一選項 → checked readOnly(鏡像 e1 配送)。 */}
          <label className="co-pay is-on">
            <input type="radio" name="pay" checked readOnly />
            <span className="co-pay-radio" />
            <div className="co-pay-body">
              <div className="co-pay-label">信用卡(TapPay)</div>
              <div className="co-pay-desc">VISA · Mastercard · JCB · AE，3D 驗證 · 後端串接 TapPay SDK</div>

              {/* 🔴 純 UI 預覽:disabled、零 state 捕獲。真卡輸入留階段② TapPay 安全欄位
                  (原始 PAN/CVV 永不進 server/state/DB)。 */}
              <div className="co-card-form" aria-hidden="true">
                <label className="auth-field">
                  <span>卡號</span>
                  <input placeholder="•••• •••• •••• ••••" maxLength={19} disabled readOnly />
                </label>
                <div className="co-card-row">
                  <label className="auth-field">
                    <span>有效期</span>
                    <input placeholder="MM / YY" maxLength={7} disabled readOnly />
                  </label>
                  <label className="auth-field">
                    <span>CVV</span>
                    <input placeholder="•••" maxLength={4} disabled readOnly />
                  </label>
                </div>
                <div className="co-card-note">信用卡資訊將於最後一步以 TapPay 安全欄位輸入(本頁不收集卡號)</div>
              </div>
            </div>
          </label>
        </div>
      </section>
    </>
  );
}
