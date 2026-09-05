'use client';

// CheckoutSuccess.tsx — 結帳頁內最小終態(M-3-S2-b2-e3b 建、②-④b 擴 processing、②-④fix 擴 unknown)
//
// paid:字面借 design-reference/components/OrderCompletePage.jsx:eyebrow「N°ORDER · CONFIRMED」(L33)、
//   主標「訂單已成立」(L34)、訂單編號標籤「N°ORDER」(L41)、CTA「繼續購物」(L109)。
//   Q1=A 最小範圍偏離:不顯金額 / email、無複製訂單編號鈕、不放「查看訂單詳情」(讀路徑 stage③);
//   🔵 **2026-08-30 Sean 拍【加】⇒ 上面那條「不放查看訂單詳情」已作廢**(原字面留著不刪,
//      讓拿舊字面來搜的人同一發撞到這裡)。他的原話逐字:「Q: 加那顆「查看我的訂單」按鈕嗎? A: 加」。
//      理由(當天實況):那一頁**今晚第一次遇到真的付了錢的人**,而本機實走量到的畫面是
//      「付款處理中」+ 單號 + **整頁唯一一顆鈕是「繼續購物」→ /products**
//      ⇒ **客人連「我到底有沒有買到」都查不了**。
//      🔴 而它不只是少一個方便:`processing` 態的成因之一是反查不到成交結果 ——
//         **錢可能已經扣了**,那正是最需要去看一眼訂單的時刻,而那時畫面把人送去逛商品。
//   design OrderCompletePage 完整完成頁 = ②-⑤。
// processing(②-④b 新增、design 無此狀態):付款已收或處理中(orphan/charge_unknown/locked)——
//   勿重複付款終態畫面(文案由 chargePaymentAction 常數單一真相、message prop 傳入)、單號供客服查;
//   cart 已清(useChargePayment 政策、防殘留 cart 誘導重刷)。
// unknown(②-④ fix、審查側 BLOCKER):action 呼叫 throw = 回應遺失層,付款狀態未知、可能已扣款
//   → 終態勿重複付款;client 無單號(訂單可能已建但回應沒回來)→ 不渲染 N°ORDER 區塊。
//   🔴 S1b-2:傳 onReconcile → 額外渲染「查詢付款結果」即時反查按鈕(黑洞死路出口;reconcileDisabled 時鎖)。
// failed(3DS-3 新增、design 無此狀態):settleCharge 裁決明確未成功(markFailed 已釋鎖)——
//   CTA 預設「返回購物車」`/cart`(3DS-3 失敗不清車、車保留可立即重結帳;Sean D4);單號仍顯供客服。
//   🔴 S1b-2:CTA 參數化(ctaTo/ctaLabel)—— reconcile 場景車已被 S1a 清空 → 傳「重新選購」`/products`。
// displayId 為真單號(create_order RPC 產;非 design 的 random mock)。

import Link from 'next/link';
import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';

export type CheckoutSuccessProps = {
  /** 建單回傳的人類可讀單號(E10 N3b 起為 6 碼亂碼;舊單仍是 PCM-YYYY-NNNN、兩者並存。零價結構,終態頁不讀回明細);unknown 無單號不傳。 */
  displayId?: string;
  /** paid(預設)= 付款完成;processing = 已收或處理中;unknown = 狀態未知(回應遺失);failed = 明確未成功;awaiting_remittance = 單已成立、等客人匯款(零扣款)。 */
  variant?: 'paid' | 'processing' | 'unknown' | 'failed' | 'awaiting_remittance';
  /** processing / unknown / failed / awaiting_remittance 顯示文案(常數單一真相);paid 不用。 */
  message?: string;
  /** 🔴 S1b-2:unknown 態「查詢付款結果」即時反查 handler;傳入才渲染按鈕。 */
  onReconcile?: () => void;
  /** 反查請求中或冷卻中 → 按鈕 disabled(unknown 態用)。 */
  reconcileDisabled?: boolean;
  /** 🔴 S1b-2:failed 態 CTA 目的地(預設 /cart);reconcile 場景傳 /products。 */
  ctaTo?: string;
  /** failed 態 CTA 文字(預設「返回購物車」);reconcile 場景傳「重新選購」。 */
  ctaLabel?: string;
};

const COPY = {
  paid: { eyebrow: 'N°ORDER · CONFIRMED', title: '訂單已成立' },
  processing: { eyebrow: 'N°ORDER · PROCESSING', title: '付款處理中' },
  unknown: { eyebrow: 'N°ORDER · UNKNOWN', title: '付款狀態確認中' },
  failed: { eyebrow: 'N°ORDER · FAILED', title: '付款未完成' },
  awaiting_remittance: { eyebrow: 'N°ORDER · AWAITING REMITTANCE', title: '訂單已成立,等待匯款' },
} as const;

export function CheckoutSuccess({
  displayId,
  variant = 'paid',
  message,
  onReconcile,
  reconcileDisabled,
  ctaTo,
  ctaLabel,
}: CheckoutSuccessProps) {
  const copy = COPY[variant];
  return (
    <div data-screen-label="Checkout" className="co-page">
      <Header currentPage="checkout" />
      <main className="co-main co-success">
        <div className="co-success-card">
          <div className="ap-mono co-success-eyebrow">{copy.eyebrow}</div>
          <h1 className="co-success-title">{copy.title}</h1>
          <p className="co-success-note">{variant === 'paid' ? '我們會盡快為您出貨。' : message}</p>
          {displayId && (
            <div className="co-success-order">
              <div className="ap-mono co-success-order-label">N°ORDER</div>
              <div className="co-success-order-no">{displayId}</div>
            </div>
          )}
          {/* 🔴 ⟦b4-BANKCHARGESCARD⟧ 片 2 · ④:匯款終態的出口。**排在整條鏈的最前面**,
              因為下面那個 `displayId ?` 分支會把它吃掉 —— 吃掉之後客人被送去
              `/account?tab=orders`(訂單【列表】), 而他要的東西不在列表上。
              🔵 **他要的是【匯款帳號】, 而那個東西住在明細頁**
              (`OrderDetailView.tsx:647-700`:`balanceDue !== null && amount > 0` 那一支印銀行 / 帳號 /
               應付餘額 / 備註 / 匯款期限)
              ⛔ ~~`OrderDetailView.tsx:611-633`~~ —— 我從片 1 plan §6 抄了這個座標而**沒有開檔核**,
                 而 `:625` 那一支是**相反行為**(`balanceDue === null || amount <= 0` ⇒ 不印帳號、
                 改印「請聯絡我們」)。座標是**漂的**:我自己這幾天才在那支檔中間插進 balanceDue 那一塊。
                 📌 **一個指到相反分支的行號比全錯的難發現** —— 檔名對、附近也真的在講匯款。
                 (reviewer R1 must-fix;舊字面留刪除線, 讓拿舊座標來搜的人同一發撞到訂正。)
              ⇒ 所以這裡連的是 `/account/orders/<displayId>`, 不是列表。
              🔴 `encodeURIComponent` 不可省 —— displayId 兩種格式並存(6 碼亂碼 / `PCM-YYYY-NNNN`),
                 它是**使用者可見的識別碼、不保證只有 URL-safe 字元**(同 `OrdersTab.tsx:190` 的理由)。
              🛑 **而這【不是】「持久化終態」, 兩件事不要混**:
                · 這一頁 reload 之後照樣消失 —— 它活在 React state 裡。
                · 而**客人的資料沒有消失** —— 單在庫裡, 明細頁是那份資料的 canonical 落點。
                ⇒ 📌 所以缺的那一格是「**reload 之後還看得到這一頁**」, 不是「資料救不回來」。
                   要不要補那一格(sessionStorage 復原)是**另一片**, 而它要動 `useChargePayment.tsx`
                   ⇒ 今天與 mail 那條線同檔會撞, 已回報主視窗。
              ⚠️ 沒有 displayId 時**不連明細** —— 那會是一顆按下去落空的鈕(既有慣例, 見下面 `displayId ?`)。 */}
          {variant === 'awaiting_remittance' ? (
            <div className="co-success-actions">
              <Link
                href={displayId ? `/account/orders/${encodeURIComponent(displayId)}` : '/account?tab=orders'}
                className="btn-primary co-success-cta"
              >
                查看匯款帳號 <span>→</span>
              </Link>
              <Link href="/products" className="btn-outline co-success-cta">
                繼續購物 <span>→</span>
              </Link>
            </div>
          ) : variant === 'unknown' && onReconcile ? (
            // 🔴 S1b-2:黑洞 unknown 死路出口 —— 主動作「查詢付款結果」即時反查(反查中/冷卻鎖)+ 次動作繼續購物。
            <div className="co-success-actions">
              <button
                type="button"
                className="btn-primary co-success-cta"
                onClick={onReconcile}
                disabled={reconcileDisabled}
              >
                查詢付款結果 <span>→</span>
              </button>
              <Link href="/products" className="btn-outline co-success-cta">
                繼續購物 <span>→</span>
              </Link>
            </div>
          ) : variant === 'failed' ? (
            <Link href={ctaTo ?? '/cart'} className="btn-primary co-success-cta">
              {ctaLabel ?? '返回購物車'} <span>→</span>
            </Link>
          ) : displayId ? (
            // 🔴 2026-08-30 Sean 拍【加】:**有單號**時給一條通到訂單的路。
            //    ⚠️ 條件的精確形狀是 `!(unknown && onReconcile) && !failed && displayId`,
            //       **不是「paid / processing 兩態」**(我第一版這樣寫,比實際窄;code-reviewer 抓)——
            //       `unknown` + 有 displayId + 無 onReconcile 也會落到這裡。
            //       今天無呼叫端這樣做(`CheckoutTerminalScreen.tsx:86-92` 的 unknown 完全不傳 displayId),
            //       所以行為是對的;**而註解不該說得比條件滿**,否則下一個人改呼叫端時不會知道這裡也會亮。
            //    給一條通到訂單的路。形狀抄上面 unknown 那支(主 btn-primary + 次 btn-outline),
            //    不自己發明版型;「繼續購物」保留、只是退成次動作。
            //    ⚠️ `displayId` 是「這張單真的存在」的訊號 —— 沒有它就沒有東西可以看,
            //       那時退回單鈕(下面那支),**不給一顆按下去會落空的鈕**。
            //    🔴 連 `/account?tab=orders` 而不是 `/account/orders/<displayId>`:
            //       前者與 `OrderDetailView.tsx:165` 的返回鈕同一個字面(單一慣例);
            //       ⚠️ 我第一版寫 `:160` —— 而差的那 5 行正是本 commit 的**父 commit** 加的
            //          ⇒ **寫下的當下就已經漂了**(code-reviewer 2026-08-30 抓)。
            //       而 `?tab=` 那個參數**現在真的會被讀**(`app/account/page.tsx:110` 與 `:137`,
            //       Sean 2026-08-27 拍 B「只修回不來」時修的)⇒ 2026-08-30 本機真瀏覽器點過,
            //       確實落在訂單那一區,不是「連過去但參數被忽略」。
            <div className="co-success-actions">
              <Link href="/account?tab=orders" className="btn-primary co-success-cta">
                查看我的訂單 <span>→</span>
              </Link>
              <Link href="/products" className="btn-outline co-success-cta">
                繼續購物 <span>→</span>
              </Link>
            </div>
          ) : (
            <Link href="/products" className="btn-primary co-success-cta">
              繼續購物 <span>→</span>
            </Link>
          )}
        </div>
      </main>
      <HomeFooter />
    </div>
  );
}
