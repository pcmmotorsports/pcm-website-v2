'use client';

// useFirstErrorFocus.tsx — 「按下付款、有錯 → 聚焦第一個錯誤」的觸發器(M-3 兩步結帳 Slice U4b)
//
// 🔴 .tsx(非 .ts):eslint.config.js 的 react-hooks 規則(rules-of-hooks + exhaustive-deps)
//   只掛 *.tsx(見 useTapPayCard.tsx 檔頭同理)。本 hook 的 effect deps **刻意窄化為 [seq]**、
//   於 render 期同步 ref → 必須有 exhaustive-deps 守門,寫成 .ts 會讓「日後改壞 deps」三綠照過。
//
// 🔴 抽出理由 = 鐵則 6:聚焦邏輯不塞進已達行數上限的 CheckoutView。
//   registry 與 DOM 副作用在 lib/checkout/focus-first-error.ts(純函式、可獨立單測);
//   本 hook 只負責「每次 request() → 於 commit 後對**最新** errors 跑一次 focus」的時序。

import { useCallback, useEffect, useRef, useState } from 'react';
import { focusFirstPaymentError } from '@/lib/checkout/focus-first-error';
import type { CheckoutPaymentErrors } from '@/lib/checkout/validate-checkout-payment';

/**
 * @param errors 當前 render 的完整合併錯誤 map(卡片 + 非卡片);render 期鏡像進 ref。
 * @returns request():呼叫後於下一次 commit 完成(錯誤節點已在 DOM)才對**最新** errors 聚焦第一個。
 *
 * 🔴 時序(codex 關卡1 K1-3 / Fable Q2 已查證):request() 只 bump seq;真正 focus 在 [seq] effect、
 *   讀 errorsRef.current(render 期已同步為最新合併 map)、**不讀 closure**。呼叫端在同一批 setState
 *   (markSubmitAttempted / applyValidation …)之後呼 request → 下一 render 的 ref 已含卡片錯誤 →
 *   effect 於 commit 後讀到完整 map。重複按 → seq 再增 → 可重複聚焦(修好一欄再按會跳到新的第一個錯誤)。
 */
export function useFirstErrorFocus(errors: CheckoutPaymentErrors): () => void {
  const errorsRef = useRef(errors);
  errorsRef.current = errors; // render 期同步:post-commit effect 讀到的必為最新合併 map
  const [seq, setSeq] = useState(0);
  useEffect(() => {
    if (seq === 0) return; // 初次 mount 不聚焦
    focusFirstPaymentError(errorsRef.current);
  }, [seq]);
  return useCallback(() => setSeq((n) => n + 1), []);
}
