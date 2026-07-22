// @vitest-environment jsdom
//
// TapPayCardFields 守門測試(M-3 兩步結帳 Slice U4a)。
//
// 🔴 本檔守的四件事(擋不住就是假綠):
//   ① 逐欄紅字 + aria-invalid + **條件式** aria-describedby(沒錯時不掛,避免 dangling idref)
//   ② **版面**:紅字必須在 `.auth-field` 內部;`.co-card-row` 是 1fr 1fr grid,
//      做成它的直接子元素會多一個格子把兩欄擠歪 —— 三綠與一般單元測試都看不見這種回歸
//   ③ `ready==='error'` 那顆 <p> **不得再有 role="alert"**(U4a 移除;assertive 通知統一由
//      CheckoutPaymentFeedback 發,design §7.2「避免多個 assertive alert 一起朗讀」)
//   ④ `card.module` **真的被本元件消費**(不是只丟給共用摘要就算數)

import { describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TapPayCardFields } from '@/components/TapPayCardFields';
import {
  CARD_MODULE_ERROR_MESSAGE,
  CARD_MODULE_LOADING_MESSAGE,
  type CheckoutPaymentErrors,
} from '@/lib/checkout/validate-checkout-payment';

const CLEAN = { number: 0, expiry: 0, ccv: 0 } as const;

function renderFields(over: {
  ready?: 'loading' | 'ready' | 'error';
  fieldStatus?: { number: 0 | 1 | 2 | 3; expiry: 0 | 1 | 2 | 3; ccv: 0 | 1 | 2 | 3 };
  errors?: CheckoutPaymentErrors;
} = {}) {
  return render(
    <TapPayCardFields
      ready={over.ready ?? 'ready'}
      fieldStatus={over.fieldStatus ?? CLEAN}
      errors={over.errors ?? {}}
    />,
  );
}

describe('TapPayCardFields — 逐欄錯誤與 ARIA', () => {
  it('errors 為空 → 零紅字、零 aria-invalid、零 aria-describedby', () => {
    const { container } = renderFields();
    expect(container.querySelectorAll('.auth-field-err')).toHaveLength(0);
    expect(container.querySelectorAll('[aria-invalid]')).toHaveLength(0);
    expect(container.querySelectorAll('[aria-describedby]')).toHaveLength(0);
    cleanup();
  });

  it('三欄各自的錯誤 → 紅字 + aria-invalid=true + describedby 指到自己那條紅字的 id', () => {
    const { container } = renderFields({
      errors: {
        'card.number': '請輸入完整卡號',
        'card.expiry': '有效期不正確,請重新確認',
        'card.ccv': '請輸入完整安全碼',
      },
    });
    const cases = [
      ['tappay-card-number', 'checkout-card-number-error', '請輸入完整卡號'],
      ['tappay-card-expiration-date', 'checkout-card-expiry-error', '有效期不正確,請重新確認'],
      ['tappay-card-ccv', 'checkout-card-ccv-error', '請輸入完整安全碼'],
    ] as const;
    for (const [fieldId, errorId, msg] of cases) {
      const field = container.querySelector(`#${fieldId}`)!;
      expect(field.getAttribute('aria-invalid')).toBe('true');
      expect(field.getAttribute('aria-describedby')).toBe(errorId);
      const err = container.querySelector(`#${errorId}`)!;
      expect(err.textContent).toBe(msg);
      expect(err.classList.contains('auth-field-err')).toBe(true); // 不得用裸 span(會被灰色 label 樣式蓋掉)
    }
    cleanup();
  });

  it('🔴 只有一欄有錯 → 另外兩欄不得留下 aria-invalid / aria-describedby(條件式、非恆掛)', () => {
    const { container } = renderFields({ errors: { 'card.number': '請輸入完整卡號' } });
    for (const id of ['tappay-card-expiration-date', 'tappay-card-ccv']) {
      const field = container.querySelector(`#${id}`)!;
      expect(field.hasAttribute('aria-invalid')).toBe(false);
      expect(field.hasAttribute('aria-describedby')).toBe(false);
    }
    expect(container.querySelectorAll('.auth-field-err')).toHaveLength(1);
    cleanup();
  });

  it('🔴 版面守門:紅字必在 .auth-field 內,且 .co-card-row 不得有直接子元素紅字(grid 會被擠歪)', () => {
    const { container } = renderFields({
      errors: {
        'card.number': 'a',
        'card.expiry': 'b',
        'card.ccv': 'c',
      },
    });
    const errs = Array.from(container.querySelectorAll('.auth-field-err'));
    expect(errs).toHaveLength(3);
    for (const el of errs) {
      expect(el.parentElement?.classList.contains('auth-field')).toBe(true);
    }
    // .co-card-row 是 grid-template-columns: 1fr 1fr(checkout.css:324)→ 直接子元素只能是兩個 .auth-field
    const row = container.querySelector('.co-card-row')!;
    expect(row.querySelectorAll(':scope > .auth-field-err')).toHaveLength(0);
    expect(row.querySelectorAll(':scope > *')).toHaveLength(2);
    cleanup();
  });

  it('status 2 仍然標紅框(.tpfield-error),與紅字是兩條獨立通道', () => {
    const { container } = renderFields({ fieldStatus: { number: 2, expiry: 0, ccv: 0 } });
    expect(container.querySelector('#tappay-card-number')!.classList.contains('tpfield-error')).toBe(true);
    expect(container.querySelector('#tappay-card-ccv')!.classList.contains('tpfield-error')).toBe(false);
    cleanup();
  });
});

describe('TapPayCardFields — card.module 與 alert 收斂', () => {
  it('🔴 ready=error → 顯示 card.module 文字,且該節點**不得**有 role 屬性(U4a 移除內層 alert)', () => {
    const { container } = renderFields({
      ready: 'error',
      errors: { 'card.module': CARD_MODULE_ERROR_MESSAGE },
    });
    const p = container.querySelector('.co-card-error')!;
    expect(p.textContent).toBe(CARD_MODULE_ERROR_MESSAGE);
    expect(p.hasAttribute('role')).toBe(false);
    // 全元件不得有任何 alert(assertive 通知統一由 CheckoutPaymentFeedback 發)
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    cleanup();
  });

  it('🔴 ready=loading + card.module(載入中)→ 本元件真的把它顯示出來(不是只丟給共用摘要)', () => {
    const { container } = renderFields({
      ready: 'loading',
      fieldStatus: { number: 1, expiry: 1, ccv: 1 },
      errors: { 'card.module': CARD_MODULE_LOADING_MESSAGE },
    });
    expect(container.querySelector('.co-card-error')!.textContent).toBe(CARD_MODULE_LOADING_MESSAGE);
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    cleanup();
  });

  it('無 card.module → 不渲染 .co-card-error 空殼', () => {
    const { container } = renderFields({ ready: 'loading' });
    expect(container.querySelector('.co-card-error')).toBeNull();
    cleanup();
  });

  it('卡資料零進我方 DOM:全元件無任何 <input>(PAN/有效期/CVV 只在 TapPay iframe 內)', () => {
    const { container } = renderFields({ errors: { 'card.number': 'a' } });
    expect(container.querySelectorAll('input')).toHaveLength(0);
    cleanup();
  });
});
