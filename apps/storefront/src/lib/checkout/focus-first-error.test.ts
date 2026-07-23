// @vitest-environment jsdom
//
// focus-first-error 單元測試(M-3 兩步結帳 Slice U4b)。
//
// 驗:① 固定順序聚焦第一個 ② 只 focus/scroll 第一個、scrollIntoView({block:'center'}) 恰一次
//     ③ 節點不存在 → 跳下一個 ④ 🔴 節點存在但不可聚焦(activeElement!==el)→ 跳下一個(id 尾綴陷阱第二道防線)
//     ⑤ error 狀態只有 card.module → 聚焦 checkout-payment-module ⑥ 無錯 / formError-only → null 不 focus 不 scroll

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PAYMENT_ERROR_FOCUS_ORDER,
  PAYMENT_FOCUS_TARGET_IDS,
  focusFirstPaymentError,
} from './focus-first-error';
import type { CheckoutPaymentErrors } from './validate-checkout-payment';

const scrollSpy = vi.fn();

/** 建一個可聚焦目標(button/input/div[tabindex=-1] 皆可)。 */
function addTarget(id: string, tag: 'button' | 'input' | 'div' = 'div'): HTMLElement {
  const el = document.createElement(tag);
  el.id = id;
  if (tag === 'div') el.tabIndex = -1; // group 容器靠 tabIndex 才可 programmatic focus
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
  // jsdom 不實作 scrollIntoView → 定義成 spy(否則 el.scrollIntoView?.() 會靜默略過、測不到);
  // defineProperty(value:any)避開 DOM 方法簽名型別衝突。
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: scrollSpy,
  });
  scrollSpy.mockClear();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('PAYMENT_ERROR_FOCUS_ORDER', () => {
  it('順序與 design §7.2 / plan ⑤ 逐字一致', () => {
    expect(PAYMENT_ERROR_FOCUS_ORDER.map(([k]) => k)).toEqual([
      'shipping.address',
      'notificationEmail',
      'invoice.title',
      'invoice.taxId',
      'invoice.donateCode',
      'card.module',
      'card.number',
      'card.expiry',
      'card.ccv',
      'terms',
    ]);
  });
});

describe('focusFirstPaymentError', () => {
  it('🔴 依固定順序聚焦第一個(invoice.title 早於 card.ccv 早於 terms)', () => {
    addTarget('checkout-invoice-title', 'input');
    addTarget(PAYMENT_FOCUS_TARGET_IDS.cardCcv);
    addTarget('checkout-agree', 'input');
    const errors: CheckoutPaymentErrors = {
      'invoice.title': '請填公司抬頭',
      'card.ccv': '請輸入完整安全碼',
      terms: '請先同意',
    };
    const key = focusFirstPaymentError(errors, document);
    expect(key).toBe('invoice.title');
    expect(document.activeElement?.id).toBe('checkout-invoice-title');
  });

  it('🔴 只 focus/scroll 第一個:scrollIntoView 恰呼叫一次、帶 {block:center}', () => {
    addTarget(PAYMENT_FOCUS_TARGET_IDS.cardNumber);
    addTarget(PAYMENT_FOCUS_TARGET_IDS.cardCcv);
    focusFirstPaymentError({ 'card.number': 'x', 'card.ccv': 'y' }, document);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'center' });
    expect(document.activeElement?.id).toBe(PAYMENT_FOCUS_TARGET_IDS.cardNumber);
  });

  it('🔴 該欄有錯但節點不存在(如發票類型未選)→ 跳下一個存在的', () => {
    // invoice.title 不建節點;card.number 建 → 聚焦落在 card.number
    addTarget(PAYMENT_FOCUS_TARGET_IDS.cardNumber);
    const key = focusFirstPaymentError(
      { 'invoice.title': '不存在的欄', 'card.number': '請輸入完整卡號' },
      document,
    );
    expect(key).toBe('card.number');
    expect(document.activeElement?.id).toBe(PAYMENT_FOCUS_TARGET_IDS.cardNumber);
  });

  it('🔴 節點存在但不可聚焦(誤指到 span / disabled)→ 跳下一個(activeElement 檢查)', () => {
    // 把 invoice.title 目標做成不可聚焦的 <span>;invoice.taxId 做成 input
    const span = document.createElement('span');
    span.id = 'checkout-invoice-title';
    document.body.appendChild(span);
    addTarget('checkout-invoice-tax-id', 'input');
    const key = focusFirstPaymentError(
      { 'invoice.title': 'a', 'invoice.taxId': 'b' },
      document,
    );
    expect(key).toBe('invoice.taxId'); // title 的 span 聚焦失敗 → 跳到 taxId
    expect(document.activeElement?.id).toBe('checkout-invoice-tax-id');
    expect(scrollSpy).toHaveBeenCalledTimes(1); // 只對真的聚焦到的那個 scroll
  });

  it('🔴 ready=error(只有 card.module)→ 聚焦 checkout-payment-module', () => {
    addTarget(PAYMENT_FOCUS_TARGET_IDS.paymentModule);
    const key = focusFirstPaymentError({ 'card.module': '付款模組暫時無法使用' }, document);
    expect(key).toBe('card.module');
    expect(document.activeElement?.id).toBe(PAYMENT_FOCUS_TARGET_IDS.paymentModule);
  });

  it('card.module 排在 card.number/terms 之前:三者並存仍聚焦 module', () => {
    addTarget(PAYMENT_FOCUS_TARGET_IDS.paymentModule);
    addTarget(PAYMENT_FOCUS_TARGET_IDS.cardNumber);
    addTarget('checkout-agree', 'input');
    const key = focusFirstPaymentError(
      { 'card.module': 'm', 'card.number': 'n', terms: 't' },
      document,
    );
    expect(key).toBe('card.module');
  });

  it('無錯 → 回 null、不 focus 不 scroll', () => {
    addTarget(PAYMENT_FOCUS_TARGET_IDS.cardNumber);
    expect(focusFirstPaymentError({}, document)).toBeNull();
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it('formError-only(valid=false 但無 keyed 錯誤;今日不可達)→ 回 null、graceful no-op', () => {
    // errors map 為空(formError 不進本函式)→ 無 keyed target → null,不 crash
    expect(focusFirstPaymentError({}, document)).toBeNull();
    expect(scrollSpy).not.toHaveBeenCalled();
  });
});
