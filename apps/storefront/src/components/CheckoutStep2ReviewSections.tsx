'use client';

// CheckoutStep2ReviewSections.tsx — 第二步複查區塊(M-3 兩步結帳 Slice U2a 建、U2b 收斂)
//
// 🔴 **純 presentational**:兩個 export 的 JSX 逐字搬自 design-reference 已退役的三步版
//   Step3 對應區塊,DOM 語意、class、文案與 handler 契約一律不變。
//   字面真權威 = design-reference/components/CheckoutPage.jsx Step3(L506-594、鐵則 1)。
//   唯一消費端 = `CheckoutStep2.tsx`(U2b 起第二步的唯一內容元件)。
//
// 🔴 U2b 變更紀錄:
//   - 原第三個 export `CheckoutPaymentSection`(付款方式複查區 + TapPay slot)**已刪除**——
//     U2b 依 design §5/§6.3 把真 `TapPayCardFields` 改掛在 `CheckoutStep2` 的 N°04 付款方式
//     選項 `.co-pay-body` 內(design L400-422 原始結構),該複查區塊會與選項列重複、故無消費端。
//   - `CheckoutShippingSummary` 的地址行加上 `.co-shipping-summary-address`:
//     🔴 單行截短**只用 CSS**(overflow/text-overflow/white-space),完整地址字串仍完整留在 DOM,
//     絕不以 JS slice 丟字(測試逐條鎖住)。
//   - 發票 readonly 複查區隨三步版 shell 一起退役(可編輯發票表單就在同頁 `CheckoutStep2`)。
//
// 安全契約:
//   - 本檔零 <input> 收卡資料;唯一卡片輸入表面是 `CheckoutStep2` 掛的 `TapPayCardFields`,
//     PAN / 有效期 / CVV 只存在 TapPay iframe,不進 React state、我方 input、server、log、DB。
//   - 商品行走 useResolvedCart 的 server-resolved 值(釘 general、零經銷價洩漏)。
//   - ✅ 服務條款 / 隱私政策連結已接真 route `/terms`、`/privacy`(#291、2026-07-24 Sean 核准內容後上線);
//     原 no-op placeholder(`href="#"` + preventDefault)已移除。連結細節見下方 `.co-agree` 區塊註解
//     (target=_blank 防結帳中途離開;label activation 由 HTML 規格排除 a[href]、**不需也未掛任何 JS 保護**)。
//
// 🔴 DOM 結構契約:`CheckoutOrderReview` 回傳 fragment(商品區塊與同意條款為同層兄弟)。
//   包 wrapper 會改變 `.co-review-block:last-child { border-bottom: 0 }` 的命中對象 = 視覺變動。

import type { CustomerAddress } from '@pcm/domain';
import type { ResolvedCartLineView } from '@/hooks/useResolvedCart';
import { formatCartVehicle } from '@/lib/cart-vehicle-format';
import { PAYMENT_FOCUS_TARGET_IDS } from '@/lib/checkout/focus-first-error';

export type CheckoutShippingSummaryProps = {
  /** 選中的收件地址(= addresses.find(shippingAddrId));undefined 時 body 只在有錯誤時渲染。 */
  currentAddr: CustomerAddress | undefined;
  /** 配送方式顯示字(Q1=A 僅「貨運宅配」)。 */
  shippingLabel: string;
  /** 編輯收件 → 跳回 step1。 */
  onEdit: () => void;
  /** U3b:收件地址錯誤紅字(Step 2 無地址欄位,導引靠本區既有的「編輯」鈕回 Step1)。 */
  shippingError?: string;
  /** U3b:通知 Email 錯誤紅字(同上,Email 欄在 Step1)。 */
  emailError?: string;
};

/** 精簡收件摘要(U2b:地址單行截短純 CSS、完整字面仍在 DOM;U3b:加非卡片錯誤紅字)。 */
export function CheckoutShippingSummary({
  currentAddr,
  shippingLabel,
  onEdit,
  shippingError,
  emailError,
}: CheckoutShippingSummaryProps) {
  // 🔴 U3b(codex 關卡1 R2 抓到):body 原本只在 `currentAddr` 存在時渲染,
  //   但 `shipping.address` 出錯的情境正是 currentAddr 為 undefined —— 紅字會永遠顯示不出來。
  //   → 改成「有地址 **或** 有任一錯誤」就渲染 body;地址三行仍各自受 currentAddr 守護。
  const hasError = Boolean(shippingError || emailError);
  // 🔴 逐項組合、只列**真的會渲染**的 id:若寫死單一 id,「只有 emailError」時會指向不存在的節點
  //   (dangling idref、a11y 驗證器會抓;code-reviewer nit)。
  const errorIds =
    [
      shippingError ? 'checkout-shipping-error' : null,
      emailError ? 'checkout-notification-email-error' : null,
    ]
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <div className="co-review-block">
      <div className="co-review-block-head">
        <div className="ap-mono">收件資料</div>
        {/* 🔴 U4b:shipping.address / notificationEmail 錯誤的 focus target(兩欄位在 Step1;
            此鈕永遠渲染〔在 currentAddr 條件外〕、可聚焦,聚焦即導引回 Step1 修正)。 */}
        <button
          type="button"
          id={PAYMENT_FOCUS_TARGET_IDS.shippingSummaryEdit}
          className="co-review-edit"
          onClick={onEdit}
          aria-describedby={errorIds}
        >
          編輯
        </button>
      </div>
      {(currentAddr || hasError) && (
        <div className="co-review-body">
          {currentAddr && (
            <>
              <div><strong>{currentAddr.name}</strong> · {currentAddr.phone}</div>
              <div className="co-shipping-summary-address">{currentAddr.line}</div>
              <div className="co-review-sub">{shippingLabel}</div>
            </>
          )}
          {/* 🔴 紅字必須留在 .co-review-body 內:放到 .co-review-block 之後會打斷
              checkout.css `.co-review-block:last-child { border-bottom: 0 }` 的命中對象 = 多一條底線。 */}
          {shippingError && (
            <span id="checkout-shipping-error" className="auth-field-err">{shippingError}</span>
          )}
          {emailError && (
            <span id="checkout-notification-email-error" className="auth-field-err">{emailError}</span>
          )}
        </div>
      )}
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
  /** U3b:未勾同意的錯誤紅字(design §7.3:按鈕仍可按,用錯誤導引取代 disabled)。 */
  termsError?: string;
};

/** 商品清單複查 + 同意條款(fragment:兩者為同層兄弟,見檔頭 DOM 結構契約)。 */
export function CheckoutOrderReview({
  lines,
  agreed,
  onAgreedChange,
  onEditItems,
  termsError,
}: CheckoutOrderReviewProps) {
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

      {/* 同意條款。#291:兩個連結已接上真頁面 /terms、/privacy(2026-07-24,原為 no-op placeholder)。
          🔴 `target="_blank"` 是必要的:結帳進行到一半,同頁導航離開會丟掉結帳狀態(表單 / cart session)。
          ⚠️ **「點連結會不會誤勾同意」= 已實測、結論是不會**(2026-07-24 真 Chromium):
             這兩個 <a> 雖在 <label className="co-agree"> 內,但 HTML 規格把 **interactive content
             後代**(a[href])排除在 label activation 之外 → 點它不會切換勾選框。
             實測含**有效對照組**:同頁點 label 內的純文字 <span> 會勾起來(證明 label activation 是活的、
             非假陰性),點 a[href] 則不會。⇒ 客人「讀條款」不會被誤記為「已同意」。
          🔴 因此**不掛** onClick stopPropagation —— 先前版本掛過,實測證明它**不是**這道保護的來源
             (React 事件委派在根節點、跑得比 label 晚),留著會讓後人誤以為那是守門(對齊
             memory `feedback_control-named-beyond-its-actual-power`:防護不可命名超過實際能力)。
             ⚠️ 但若日後把連結改成**非互動元素**(span + onClick),上述規格保護即失效、會誤勾 —— 別那樣改。 */}
      <label className="co-agree">
        <input
          type="checkbox"
          id="checkout-agree"
          checked={agreed}
          onChange={(e) => onAgreedChange(e.target.checked)}
          aria-invalid={termsError ? 'true' : undefined}
          // 🔴 只在有錯時掛,否則會留下指向不存在節點的 dangling idref(a11y 驗證器會抓)。
          aria-describedby={termsError ? 'checkout-agree-error' : undefined}
        />
        <span>
          我已閱讀並同意 PCM Motorsports 的{' '}
          <a href="/terms" target="_blank" rel="noopener noreferrer">
            服務條款
          </a>{' '}
          與{' '}
          <a href="/privacy" target="_blank" rel="noopener noreferrer">
            隱私政策
          </a>
        </span>
      </label>
      {/* 🔴 紅字為 .co-agree 的同層 sibling(不進 label 內):.co-agree 是 flex 版面,
          塞進去會被當成第三個 flex item 擠掉勾選框與文字的對齊。無 CSS 依賴 .co-agree:last-child。 */}
      {termsError && (
        <span id="checkout-agree-error" className="auth-field-err">{termsError}</span>
      )}
    </>
  );
}
