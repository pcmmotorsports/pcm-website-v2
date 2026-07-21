'use client';

// CheckoutStep2ReviewSections.tsx — 第二步複查區塊(M-3 兩步結帳 Slice U2a)
//
// 🔴 **純 presentational extraction**:三個 export 的 JSX 逐字搬自 `CheckoutStep3.tsx`
//   對應區塊,DOM 語意、class、文案與 handler 契約一律不變(U2a 驗收條件)。
//   字面真權威仍是 design-reference/components/CheckoutPage.jsx Step3(L506-594、鐵則 1);
//   本片只換「這段 JSX 住在哪個檔」,不換它長什麼樣、不改付款行為。
//
// 為什麼抽:U2b 要把第二步組成單欄(精簡收件摘要 → 發票 → 唯一 TapPay slot → 商品 → 條款)
//   並退役 `CheckoutStep3.tsx` shell;先把「未來 Step2 會用到的區塊」抽成獨立 export,
//   U2b 才能只搬掛載點、不必在同一片同時搬 JSX 又改結構。
//
// 🔴 刻意**不含**發票資訊 readonly 複查區:那是 U2b 要刪掉的重複節點
//   (可編輯的發票表單已在同頁 CheckoutStep2),抽出來不會有未來消費端 → 留在 Step3 shell 內隨其退役。
//
// 安全契約(未因抽取而改變):
//   - `paymentSlot` 由 CheckoutView 建立 `<TapPayCardFields>` 後原樣傳入,本檔只負責放位置;
//     PAN / 有效期 / CVV 只存在 TapPay iframe,不進 React state、我方 input、server、log、DB。
//   - 商品行走 useResolvedCart 的 server-resolved 值(釘 general、零經銷價洩漏)。
//   - 服務條款 / 隱私政策連結仍為 no-op placeholder(`href="#"` + preventDefault);
//     正式 route /terms 與 /privacy = backlog #291(BLOCKED 等正式內容核准),改連結時走 #291。
//
// 🔴 DOM 結構契約:`CheckoutOrderReview` 回傳 fragment(商品區塊與同意條款為同層兄弟)。
//   包 wrapper 會改變 `.co-review-block:last-child { border-bottom: 0 }` 的命中對象 = 視覺變動。

import type { ReactNode } from 'react';
import type { CustomerAddress } from '@pcm/domain';
import type { ResolvedCartLineView } from '@/hooks/useResolvedCart';
import { formatCartVehicle } from '@/lib/cart-vehicle-format';

export type CheckoutShippingSummaryProps = {
  /** 選中的收件地址(= addresses.find(shippingAddrId));undefined 不渲染 body。 */
  currentAddr: CustomerAddress | undefined;
  /** 配送方式顯示字(Q1=A 僅「貨運宅配」)。 */
  shippingLabel: string;
  /** 編輯收件 → 跳回 step1。 */
  onEdit: () => void;
};

/** 收件資料複查(U2b 再精簡成單行摘要;本片維持現況完整字面、不截短)。 */
export function CheckoutShippingSummary({ currentAddr, shippingLabel, onEdit }: CheckoutShippingSummaryProps) {
  return (
    <div className="co-review-block">
      <div className="co-review-block-head">
        <div className="ap-mono">收件資料</div>
        <button type="button" className="co-review-edit" onClick={onEdit}>編輯</button>
      </div>
      {currentAddr && (
        <div className="co-review-body">
          <div><strong>{currentAddr.name}</strong> · {currentAddr.phone}</div>
          <div>{currentAddr.line}</div>
          <div className="co-review-sub">{shippingLabel}</div>
        </div>
      )}
    </div>
  );
}

export type CheckoutPaymentSectionProps = {
  /** 編輯付款 → 跳回發票/付款區;兩步版同頁無處可跳 → 省略即不渲染該鈕(不留死鈕)。 */
  onEdit?: () => void;
  /** TapPay 安全卡欄 slot(唯一卡片輸入表面;undefined 維持 readonly 行為)。 */
  paymentSlot?: ReactNode;
};

/** 付款方式複查 + TapPay 卡欄掛載位置(不顯卡末四碼、我方零 input)。 */
export function CheckoutPaymentSection({ onEdit, paymentSlot }: CheckoutPaymentSectionProps) {
  return (
    <div className="co-review-block">
      <div className="co-review-block-head">
        <div className="ap-mono">付款方式</div>
        {onEdit && (
          <button type="button" className="co-review-edit" onClick={onEdit}>編輯</button>
        )}
      </div>
      <div className="co-review-body">
        <div>信用卡 · TapPay</div>
        {paymentSlot}
      </div>
    </div>
  );
}

export type CheckoutOrderReviewProps = {
  /** server-resolved 購物車行(釘 general、零經銷洩漏)。 */
  lines: ResolvedCartLineView[];
  agreed: boolean;
  onAgreedChange: (v: boolean) => void;
  /** 編輯商品 → 回購物車。 */
  onEditItems: () => void;
};

/** 商品清單複查 + 同意條款(fragment:兩者為同層兄弟,見檔頭 DOM 結構契約)。 */
export function CheckoutOrderReview({ lines, agreed, onAgreedChange, onEditItems }: CheckoutOrderReviewProps) {
  return (
    <>
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
                {/* V-2h/MF-6:逐品項顯車款(spec §6;唯讀、重用 formatCartVehicle;free 亦顯=下單後人工確認) */}
                {item.vehicle && (
                  <div className="co-review-item-vehicle">車款：{formatCartVehicle(item.vehicle)}</div>
                )}
              </div>
              <div className="co-review-item-price">NT$ {lineTotal.toLocaleString()}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 同意條款(服務條款 / 隱私政策連結為 no-op placeholder、legal pages 未建=#291) */}
      <label className="co-agree">
        <input type="checkbox" checked={agreed} onChange={(e) => onAgreedChange(e.target.checked)} />
        <span>
          我已閱讀並同意 PCM Motorsports 的{' '}
          <a href="#" onClick={(e) => e.preventDefault()}>服務條款</a> 與{' '}
          <a href="#" onClick={(e) => e.preventDefault()}>隱私政策</a>
        </span>
      </label>
    </>
  );
}
