'use client';

// CheckoutStep3.tsx — 結帳 Step3 確認複查(M-3-S2-b2-e3a)
//
// 直接搬 design-reference/components/CheckoutPage.jsx Step3(L506-594、鐵則 1 字面)。
// 🔴 M-3 兩步結帳 U1 起由 CheckoutView 在 **step === 2** 渲染(接在 CheckoutStep2 之後、同一頁);
//   檔名與元件名維持 CheckoutStep3 = 尚未退役的 shell,U2b 退役本檔。
// 🔴 U2a(本片):收件摘要 / 付款 body / 商品清單 / 條款四段 JSX **已抽到**
//   `CheckoutStep2ReviewSections.tsx`(CheckoutShippingSummary / CheckoutPaymentSection /
//   CheckoutOrderReview),本檔改為 compose 那三個 export;props、畫面與 handler 契約皆未變。
//   **發票資訊 readonly 複查區刻意留在本檔內聯**——它是 U2b 要刪除的重複節點
//   (可編輯的發票表單已在同頁 CheckoutStep2),抽出來不會有未來消費端。
// presentational 收 props,送出/建單(submitOrder)+
// 送出按鈕在 CheckoutView 的 co-actions(②-④b 接 chargePaymentAction 刷卡)。
//
// 四 readonly 複查區塊(收件 / 付款 / 發票 / 商品)+ 編輯鈕 + 同意條款。
// 🔴 U1:付款 / 發票兩顆「編輯」原本跳回 step2,兩步版下該兩區已在同頁上方 → onEditStep2 未傳時
//   不渲染該兩顆鈕(不留下按了沒反應的死鈕);三步時代的呼叫端傳入即維持原行為。
//
// design 偏離(commit body + manifest override 揭示):
//   - 付款複查只顯「信用卡 · TapPay」、不顯卡末四碼(e2 信用卡欄純 UI、本就零卡資料)。
//   - 商品複查走 useResolvedCart 的 server-resolved 行(brand/name/variantLabel/lineTotal、釘 general、
//     零經銷洩漏),非 design 的 window.PCM_DATA + getEffectivePrice(p, tier)。
//   - 配送只「貨運宅配」home(Q1=A);儲值金折抵 / 優惠券複查行不做(§3.2 + #202)。
//   - 服務條款 / 隱私政策連結為 no-op placeholder(`href="#"` + preventDefault、legal pages 未建)。
//     🔴 2026-07-21 更正:原註解寫「Phase 1 不做」已作廢 —— 正式法律頁=**backlog #291**
//     (route /terms、/privacy + version/hash),狀態 BLOCKED 等正式內容核准
//     (🔴 核准矩陣=Sean 必要、法律顧問選配加簽,非二擇一),
//     且為 production checkout 開放付款的前置**人工** release checkpoint(無機械守門)。
//     改連結時走 #291、不得自撰法律文案。

import type { ReactNode } from 'react';
import type { CustomerAddress } from '@pcm/domain';
import type { InvoiceDraft } from '@/components/CheckoutStep2';
import {
  CheckoutOrderReview,
  CheckoutPaymentSection,
  CheckoutShippingSummary,
} from '@/components/CheckoutStep2ReviewSections';
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
  /** 編輯付款 / 發票 → 跳回發票/付款區;U1 兩步版同頁無處可跳 → 省略即不渲染該兩顆編輯鈕。 */
  onEditStep2?: () => void;
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

      {/* 收件資料 readonly(U2a 抽出) */}
      <CheckoutShippingSummary
        currentAddr={currentAddr}
        shippingLabel={shippingLabel}
        onEdit={onEditAddress}
      />

      {/* 付款方式 readonly(信用卡欄純 UI、不顯卡末四碼;U2a 抽出) */}
      <CheckoutPaymentSection onEdit={onEditStep2} paymentSlot={paymentSlot} />

      {/* 發票資訊 readonly(U2b 退役對象、無未來消費端 → 本片不抽) */}
      <div className="co-review-block">
        <div className="co-review-block-head">
          <div className="ap-mono">發票資訊</div>
          {onEditStep2 && (
            <button type="button" className="co-review-edit" onClick={onEditStep2}>編輯</button>
          )}
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

      {/* 商品清單 readonly + 同意條款(U2a 抽出;fragment 保持兩者同層兄弟) */}
      <CheckoutOrderReview
        lines={lines}
        agreed={agreed}
        onAgreedChange={onAgreedChange}
        onEditItems={onEditItems}
      />
    </section>
  );
}
