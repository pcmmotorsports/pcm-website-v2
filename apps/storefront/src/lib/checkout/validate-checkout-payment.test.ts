// validate-checkout-payment.test.ts — U3b 非卡片驗證與錯誤仲裁的純函式測試
//
// 🔴 本檔的守門重點(擋得住才算數):
//   ① 逐欄建 map、**不吃 issue 陣列順序**(取 issues[0] 會少報欄位 → 突變②必紅)
//   ② `valid` 是放行唯一依據,**map 為空不等於通過**(改用 map.length===0 → 突變③必紅)
//   ③ 清除只清該欄、且 key 真的被移除(不是設成 undefined)
//   ④ alert 仲裁的優先序與殭屍訊息淘汰

import { describe, expect, it } from 'vitest';
import type { InvoiceDraft } from '@/components/CheckoutStep2';
import {
  buildPaymentAlert,
  clearErrorKeys,
  clearInvoiceErrorsOnChange,
  GENERIC_CHECKOUT_MESSAGE,
  TERMS_REQUIRED_MESSAGE,
  validateNonCardFields,
  type CheckoutPaymentErrors,
} from './validate-checkout-payment';

const ADDRESS_ID = '11111111-1111-4111-8111-111111111111';

function invoice(over: Partial<InvoiceDraft> = {}): InvoiceDraft {
  return { type: 'personal', carrier: '', title: '', taxId: '', donateCode: '', ...over };
}

function baseInput(over: Partial<Parameters<typeof validateNonCardFields>[0]> = {}) {
  return {
    addressId: ADDRESS_ID,
    invoice: invoice(),
    notificationEmailEnabled: false,
    notificationEmail: '',
    agreed: true,
    ...over,
  };
}

describe('validateNonCardFields', () => {
  it('全合法 → valid、零錯誤、零 formError', () => {
    const r = validateNonCardFields(baseInput());
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual({});
    expect(r.formError).toBeNull();
  });

  it('公司發票缺抬頭與統編 → 逐欄建 map,兩個 key 都在(非只取第一個 issue)', () => {
    const r = validateNonCardFields(baseInput({ invoice: invoice({ type: 'company' }) }));
    expect(r.valid).toBe(false);
    expect(r.errors['invoice.title']).toBe('請填寫公司抬頭');
    expect(r.errors['invoice.taxId']).toBe('統編需 8 碼數字');
    expect(Object.keys(r.errors)).toHaveLength(2);
  });

  it('統編格式錯(非 8 碼)→ 只報 taxId、不牽連 title', () => {
    const r = validateNonCardFields(
      baseInput({ invoice: invoice({ type: 'company', title: '賓士機車', taxId: '123' }) }),
    );
    expect(r.errors['invoice.taxId']).toBe('統編需 8 碼數字');
    expect('invoice.title' in r.errors).toBe(false);
  });

  it('捐贈發票缺愛心碼 → donateCode', () => {
    const r = validateNonCardFields(baseInput({ invoice: invoice({ type: 'donate' }) }));
    expect(r.errors['invoice.donateCode']).toBe('請填愛心碼');
  });

  it('🔴 flag-on 且 Email 與發票同時錯 → 兩個 key 都在(issue 順序不保證,取 issues[0] 會漏)', () => {
    const r = validateNonCardFields(
      baseInput({
        notificationEmailEnabled: true,
        notificationEmail: 'not-an-email',
        invoice: invoice({ type: 'company' }),
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.notificationEmail).toBeTruthy();
    expect(r.errors['invoice.title']).toBeTruthy();
    expect(r.errors['invoice.taxId']).toBeTruthy();
  });

  it('flag-off → 即使帶了壞 Email 也不產生 notificationEmail key(該欄不在 schema)', () => {
    const r = validateNonCardFields(
      baseInput({ notificationEmailEnabled: false, notificationEmail: 'not-an-email' }),
    );
    expect(r.valid).toBe(true);
    expect('notificationEmail' in r.errors).toBe(false);
  });

  it('addressId 非 UUID → shipping.address(defense-in-depth,UI 不可達)', () => {
    const r = validateNonCardFields(baseInput({ addressId: 'addr-1' }));
    expect(r.errors['shipping.address']).toBe('請選擇收件地址');
  });

  it('addressId 未選(undefined)→ shipping.address', () => {
    const r = validateNonCardFields(baseInput({ addressId: undefined }));
    expect(r.errors['shipping.address']).toBeTruthy();
  });

  it('未勾同意 → terms,且文案與 server charge-actions 同一句', () => {
    const r = validateNonCardFields(baseInput({ agreed: false }));
    expect(r.valid).toBe(false);
    expect(r.errors.terms).toBe(TERMS_REQUIRED_MESSAGE);
  });

  it('🔴 fail-closed:對不上固定 key 的 issue → valid=false 但 errors 為空,由 formError 承接', () => {
    // invoice.type 被竄改(繞前端直塞)→ path ['invoice','type'] 不在固定 key 集合內。
    // 若以 Object.keys(errors).length===0 當放行條件,這裡會被放行 = fail-open。
    const r = validateNonCardFields(
      baseInput({ invoice: { ...invoice(), type: 'bogus' as InvoiceDraft['type'] } }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors).toEqual({});
    expect(r.formError).toBe(GENERIC_CHECKOUT_MESSAGE);
  });

  it('有逐欄錯誤時 formError 維持 null(雙通道不重複報)', () => {
    const r = validateNonCardFields(baseInput({ agreed: false }));
    expect(r.formError).toBeNull();
  });
});

describe('clearErrorKeys', () => {
  it('🔴 key 真的被移除(不是設成 undefined)', () => {
    const before: CheckoutPaymentErrors = { 'invoice.title': 'x', terms: 'y' };
    const after = clearErrorKeys(before, ['invoice.title']);
    expect('invoice.title' in after).toBe(false);
    expect(after.terms).toBe('y');
  });

  it('不改動原物件(純函式)', () => {
    const before: CheckoutPaymentErrors = { terms: 'y' };
    clearErrorKeys(before, ['terms']);
    expect(before.terms).toBe('y');
  });
});

describe('clearInvoiceErrorsOnChange', () => {
  const errs: CheckoutPaymentErrors = {
    'invoice.title': 'a',
    'invoice.taxId': 'b',
    'invoice.donateCode': 'c',
    terms: 'keep',
    'shipping.address': 'keep2',
  };

  it('切換發票類型 → 三個 invoice key 全清,非 invoice 的錯誤保留', () => {
    const after = clearInvoiceErrorsOnChange(errs, invoice({ type: 'company' }), invoice());
    expect('invoice.title' in after).toBe(false);
    expect('invoice.taxId' in after).toBe(false);
    expect('invoice.donateCode' in after).toBe(false);
    expect(after.terms).toBe('keep');
    expect(after['shipping.address']).toBe('keep2');
  });

  it('🔴 同類型下只改抬頭 → 只清 invoice.title,統編錯誤仍在', () => {
    const after = clearInvoiceErrorsOnChange(
      errs,
      invoice({ type: 'company' }),
      invoice({ type: 'company', title: '賓士機車' }),
    );
    expect('invoice.title' in after).toBe(false);
    expect(after['invoice.taxId']).toBe('b');
    expect(after.terms).toBe('keep');
  });

  it('🔴 值完全沒變 → 原封不動回傳(地址 effect 參照變動時不得誤清)', () => {
    const same = invoice({ type: 'company', title: 'x' });
    const after = clearInvoiceErrorsOnChange(errs, same, { ...same });
    expect(after).toBe(errs);
  });
});

describe('buildPaymentAlert', () => {
  const empty = {
    errors: {} as CheckoutPaymentErrors,
    formError: null,
    primeError: null,
    chargeMessage: null,
    chargeMessageStale: false,
  };

  it('有逐欄錯誤 → 數量 + 指路摘要(Sean 拍 Q1=A)', () => {
    expect(
      buildPaymentAlert({ ...empty, errors: { terms: 'a', 'invoice.title': 'b', 'invoice.taxId': 'c' } }),
    ).toBe('還有 3 個項目需要確認,已在上方標示');
  });

  it('單一錯誤 → N=1', () => {
    expect(buildPaymentAlert({ ...empty, errors: { terms: 'a' } })).toBe(
      '還有 1 個項目需要確認,已在上方標示',
    );
  });

  it('逐欄錯誤優先於 formError / primeError / charge 訊息', () => {
    expect(
      buildPaymentAlert({
        errors: { terms: 'a' },
        formError: 'F',
        primeError: 'P',
        chargeMessage: 'C',
        chargeMessageStale: false,
      }),
    ).toBe('還有 1 個項目需要確認,已在上方標示');
  });

  it('map 空 → formError 承接(fail-closed 訊息不會消失)', () => {
    expect(buildPaymentAlert({ ...empty, formError: 'F', primeError: 'P', chargeMessage: 'C' })).toBe('F');
  });

  it('primeError 優先於 charge 訊息', () => {
    expect(buildPaymentAlert({ ...empty, primeError: 'P', chargeMessage: 'C' })).toBe('P');
  });

  it('🔴 charge 訊息被標記過期 → 不顯示(殭屍訊息不得復活)', () => {
    expect(buildPaymentAlert({ ...empty, chargeMessage: 'C', chargeMessageStale: true })).toBeNull();
  });

  it('charge 訊息未過期 → 照常顯示(既有付款失敗訊息不被吃掉)', () => {
    expect(buildPaymentAlert({ ...empty, chargeMessage: 'C', chargeMessageStale: false })).toBe('C');
  });

  it('全空 → null(不渲染 alert)', () => {
    expect(buildPaymentAlert(empty)).toBeNull();
  });
});
