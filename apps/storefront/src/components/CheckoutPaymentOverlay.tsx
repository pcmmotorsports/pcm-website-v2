'use client';

// CheckoutPaymentOverlay.tsx — 付款進行中全頁遮罩(M-3 兩步結帳 U5)
//
// 🔴 business override(Sean 2026-07-23 拍 Q1=A、memory project_m3-u5-payment-overlay-decisions):
//   覆蓋 design §7.3「付款中按鈕 disabled、留原頁」。點確認付款 → getPrime / charge 進行中(submitting)
//   蓋一層 modal 遮罩鎖住整頁所有互動,一次擋掉步驟列 / 編輯鈕 / 麵包屑 / Header / Footer 等
//   所有回頭 / 離開入口(取代逐一鎖按鈕;收斂 drift checkoutStepIndicatorUnlockedDuringPayment)。
//
// 🔴 用原生 <dialog> showModal(codex 關卡1 F1/F2):
//   - top layer:永遠最上層,免與 buybar(z-index:100)/ Header(50) 打 stacking context。
//   - inert 背景:瀏覽器自動鎖住背景所有互動(滑鼠 + 鍵盤 Tab + focus),免手動 focus trap;
//     showModal 自動設 aria-modal=true。
//   - onCancel preventDefault:擋 Esc 關閉(不可中途卸載付款畫面)。
//   - close 後焦點自動恢復到觸發的付款鈕。
//
// 🔴 useLayoutEffect(codex 關卡2 F1 / Fable F3):showModal 放 passive effect(繪製後)會留一幀
//   「遮罩已在 DOM 但未進 top layer」的空窗、背景尚未 inert。改 layout effect(繪製前同步 showModal)封死。
//   SSR 無 layout 階段 → isomorphic 退回 useEffect 避免 server warning(open 初始 false、不呼叫 showModal)。
//
// 🔴 Fable F1(must-fix、HIGH):Chrome 120+/Firefox 132+ 的 close-request 規範下,連按兩次 Esc 的
//   第二次會穿透 onCancel preventDefault 直接 close(cancel 消耗一次 user activation,Esc keydown
//   不產生新 activation)。close 後 el.open=false 但 prop open 仍 true、effect dep [open] 未變 →
//   遮罩永不重開、背景 inert 解除 → 付款中又能點步驟列退回 = 本片要收斂的 drift 原樣復活。
//   → 付款中(open)監聽 close 事件,只要仍付款中就立刻重呼 showModal 蓋回,遮罩不被 Esc×2 關掉。
//   (縱深第二道:CheckoutStepIndicator 亦補 submitting 守門,見該檔;遮罩非唯一鎖。)
//
// 🔴 Q3=A(Sean 拍、保險優先):只顯「付款處理中、請勿關閉」,**不放取消鈕** ——
//   charge 送後端後可能已扣款、前端「取消」叫不回 → 以為取消卻被扣=金流糾紛;安全版(送出前可取消 /
//   送出後鎖死)另議。文案 L2 hardcode(對齊 CheckoutRedirecting 導向文案)、Sean 批。
//
// 🔴 遮罩觸發 = submitting(charge submitting || primeBusy);終態(paid/processing/unknown/redirect)由
//   CheckoutView 的 isTerminalChargeState early return 整頁換,遮罩隨元件卸載自動關(移出 document 即
//   離開 top layer),不殘留。

import { useEffect, useLayoutEffect, useRef } from 'react';

// SSR 無 layout 階段 → 用 useEffect 避 useLayoutEffect 的 server warning;client 走 layout(繪製前 showModal)。
const useIsomorphicLayoutEffect = typeof document !== 'undefined' ? useLayoutEffect : useEffect;

export function CheckoutPaymentOverlay({ open }: { open: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);

  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // showModal/close 在已同狀態時再呼叫會 throw → 先比對 el.open。
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();

    if (!open) return;
    // Fable F1:付款中防 Esc×2(或任何 close-request)穿透 → close 後仍付款中即重新蓋回。
    const onClose = () => {
      if (!el.open) el.showModal();
    };
    el.addEventListener('close', onClose);
    return () => el.removeEventListener('close', onClose);
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="co-pay-overlay"
      aria-busy="true"
      aria-labelledby="checkout-pay-overlay-title"
      aria-describedby="checkout-pay-overlay-note"
      onCancel={(e) => e.preventDefault()}
    >
      <div className="co-pay-overlay-card">
        <div className="co-pay-overlay-spinner" aria-hidden="true" />
        <div id="checkout-pay-overlay-title" className="co-pay-overlay-title">付款處理中…</div>
        <div id="checkout-pay-overlay-note" className="co-pay-overlay-note">
          請稍候,請勿關閉或重新整理視窗
        </div>
      </div>
    </dialog>
  );
}
