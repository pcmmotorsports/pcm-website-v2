'use client';

// CheckoutStep3.tsx — 結帳 Step3 確認複查(M-3-S2-b2-e3a)
//
// 直接搬 design-reference/components/CheckoutPage.jsx Step3(L506-594、鐵則 1 字面)。
// 由 CheckoutView 在 step === 3 時渲染;presentational 收 props,送出/建單(submitOrder)+
// 送出按鈕在 CheckoutView 的 co-actions(e3b 接 placeOrderAction)。
//
// 四 readonly 複查區塊(收件 / 付款 / 發票 / 商品)+ 編輯鈕跳回對應步驟 + 同意條款。
//
// design 偏離(commit body + manifest override 揭示):
//   - 付款複查只顯「信用卡 · TapPay」、不顯卡末四碼(e2 信用卡欄純 UI、本就零卡資料)。
//   - 商品複查走 useResolvedCart 的 server-resolved 行(brand/name/variantLabel/lineTotal、釘 general、
//     零經銷洩漏),非 design 的 window.PCM_DATA + getEffectivePrice(p, tier)。
//   - 配送只「貨運宅配」home(Q1=A);儲值金折抵 / 優惠券複查行不做(§3.2 + #202)。
//   - 服務條款 / 隱私政策連結為 no-op placeholder(legal pages 未建、Phase 1 不做、待 backlog)。

import type { ReactNode } from 'react';
import type { CustomerAddress } from '@pcm/domain';
import type { InvoiceDraft } from '@/components/CheckoutStep2';
import type { ResolvedCartLineView } from '@/hooks/useResolvedCart';

export type CheckoutStep3Props = {
  /** 選中的收件地址(= addresses.find(shippingAddrId));undefined 不渲染收件 body。 */
  currentAddr: CustomerAddress | undefined;
  /** 配送方式顯示字(Q1=A 僅「貨運宅配」)。 */
  shippingLabel: string;
  /** 發票草稿(CheckoutView 提升 state)。 */
  invoice: InvoiceDraft;
  /** server-resolved 購物車行(釘 general、零經銷洩漏)。 */
  lines: ResolvedCartLineView[];
  agreed: boolean;
  onAgreedChange: (v: boolean) => void;
  /** 編輯收件 → 跳回 step1。 */
  onEditAddress: () => void;
  /** 編輯付款 / 發票 → 跳回 step2。 */
  onEditStep2: () => void;
  /** 編輯商品 → 回購物車。 */
  onEditItems: () => void;
  /** ②-④b:TapPay 安全卡欄 slot(渲染於付款方式複查 body 內;undefined 維持 readonly 行為)。 */
  paymentSlot?: ReactNode;
};

export function CheckoutStep3({
  currentAddr,
  shippingLabel,
  invoice,
  lines,
  agreed,
  onAgreedChange,
  onEditAddress,
  onEditStep2,
  onEditItems,
  paymentSlot,
}: CheckoutStep3Props) {
  return (
    <section className="co-section">
      <div className="co-section-head">
        <div className="ap-mono">N°05 · REVIEW</div>
        <h2>確認訂單</h2>
      </div>

      {/* 收件資料 readonly */}
      <div className="co-review-block">
        <div className="co-review-block-head">
          <div className="ap-mono">收件資料</div>
          <button type="button" className="co-review-edit" onClick={onEditAddress}>編輯</button>
        </div>
        {currentAddr && (
          <div className="co-review-body">
            <div><strong>{currentAddr.name}</strong> · {currentAddr.phone}</div>
            <div>{currentAddr.line}</div>
            <div className="co-review-sub">{shippingLabel}</div>
          </div>
        )}
      </div>

      {/* 付款方式 readonly(信用卡欄純 UI、不顯卡末四碼) */}
      <div className="co-review-block">
        <div className="co-review-block-head">
          <div className="ap-mono">付款方式</div>
          <button type="button" className="co-review-edit" onClick={onEditStep2}>編輯</button>
        </div>
        <div className="co-review-body">
          <div>信用卡 · TapPay</div>
          {paymentSlot}
        </div>
      </div>

      {/* 發票資訊 readonly */}
      <div className="co-review-block">
        <div className="co-review-block-head">
          <div className="ap-mono">發票資訊</div>
          <button type="button" className="co-review-edit" onClick={onEditStep2}>編輯</button>
        </div>
        <div className="co-review-body">
          {invoice.type === 'personal' && (
            <div>個人電子發票{invoice.carrier ? ` · 載具 ${invoice.carrier}` : ' · 寄至註冊 Email'}</div>
          )}
          {invoice.type === 'company' && (
            <div>公司發票 · {invoice.title || '(未填抬頭)'} · 統編 {invoice.taxId || '(未填)'}</div>
          )}
          {invoice.type === 'donate' && (
            <div>捐贈發票 · 愛心碼 {invoice.donateCode || '(未填)'}</div>
          )}
        </div>
      </div>

      {/* 商品清單 readonly */}
      <div className="co-review-block">
        <div className="co-review-block-head">
          <div className="ap-mono">商品清單 ({lines.length})</div>
          <button type="button" className="co-review-edit" onClick={onEditItems}>編輯</button>
        </div>
        <div className="co-review-items">
          {lines.map(({ item, resolved, lineTotal }) => (
            <div key={`${item.productId}-${item.variantId ?? ''}`} className="co-review-item">
              <div className="co-review-item-img">
                {resolved.image && <img src={resolved.image} alt={resolved.name} />}
              </div>
              <div className="co-review-item-body">
                <div className="co-review-item-brand">{resolved.brand}</div>
                <div className="co-review-item-name">{resolved.name}</div>
                <div className="co-review-item-meta">
                  {resolved.variantLabel && <span>{resolved.variantLabel}</span>}
                  <span>× {item.qty}</span>
                </div>
              </div>
              <div className="co-review-item-price">NT$ {lineTotal.toLocaleString()}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 同意條款(服務條款 / 隱私政策連結為 no-op placeholder、legal pages 未建) */}
      <label className="co-agree">
        <input type="checkbox" checked={agreed} onChange={(e) => onAgreedChange(e.target.checked)} />
        <span>
          我已閱讀並同意 PCM Motorsports 的{' '}
          <a href="#" onClick={(e) => e.preventDefault()}>服務條款</a> 與{' '}
          <a href="#" onClick={(e) => e.preventDefault()}>隱私政策</a>
        </span>
      </label>
    </section>
  );
}
