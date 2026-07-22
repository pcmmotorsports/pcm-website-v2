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
  CARD_MODULE_ERROR_MESSAGE,
  CARD_MODULE_LOADING_MESSAGE,
  CARD_NOT_READY_MESSAGE,
  clearErrorKeys,
  clearInvoiceErrorsOnChange,
  GENERIC_CHECKOUT_MESSAGE,
  TERMS_REQUIRED_MESSAGE,
  validateNonCardFields,
  validateTapPayFields,
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

  it('逐欄錯誤優先於 primeError / charge 訊息', () => {
    expect(
      buildPaymentAlert({
        errors: { terms: 'a' },
        formError: null,
        primeError: 'P',
        chargeMessage: 'C',
        chargeMessageStale: false,
      }),
    ).toBe('還有 1 個項目需要確認,已在上方標示');
  });

  // 🔴 U4a 刻意改動的排序:formError 提到最前面。
  //   U3b 時代 validateNonCardFields 保證「formError 非 null ⟺ 非卡片 errors 為空」,兩者互斥,
  //   所以誰前誰後等價。但 U4a 把**卡片**錯誤併進同一個 map 後互斥就破了:
  //   可能同時「formError 非 null」+「card errors 有值」。此時若走數量格式,formError 完全沒有
  //   顯示表面(它沒有任何 inline 紅字位置)→ 客人看到卡片紅字、修好、再按、還是被擋,
  //   永遠看不到真正原因 = 死迴圈。
  it('🔴 formError 與卡片錯誤並存 → 念 formError(它沒有 inline 顯示表面,不念就消失)', () => {
    expect(
      buildPaymentAlert({
        errors: { 'card.number': '請輸入完整卡號' },
        formError: GENERIC_CHECKOUT_MESSAGE,
        primeError: null,
        chargeMessage: null,
        chargeMessageStale: false,
      }),
    ).toBe(GENERIC_CHECKOUT_MESSAGE);
  });

  // 🔴 排序改動對 U3b 既有情境是 no-op 的回歸證明:凡是 validateNonCardFields 真的產得出來的
  //   組合(formError 非 null ⟹ map 空;map 非空 ⟹ formError null),新舊排序輸出必須完全相同。
  it('🔴 非卡片單獨情境:排序改動前後輸出完全相同(no-op 回歸)', () => {
    // (a) map 非空、formError null → 數量格式(與 U3b 相同)
    expect(
      buildPaymentAlert({ ...empty, errors: { terms: 'a', 'invoice.title': 'b' } }),
    ).toBe('還有 2 個項目需要確認,已在上方標示');
    // (b) map 空、formError 非 null → formError(與 U3b 相同)
    expect(buildPaymentAlert({ ...empty, formError: 'F' })).toBe('F');
  });

  // Sean 2026-07-22 Q3=B:模組層錯誤不是客人「需要確認」的事(他做什麼都沒用)→ 念全文。
  it('🔴 只有 card.module 一鍵 → 念全文,不念數量格式', () => {
    expect(
      buildPaymentAlert({ ...empty, errors: { 'card.module': CARD_MODULE_ERROR_MESSAGE } }),
    ).toBe(CARD_MODULE_ERROR_MESSAGE);
  });

  it('card.module 與其他錯誤並存 → 回到數量格式(此時客人確實有事要做)', () => {
    expect(
      buildPaymentAlert({
        ...empty,
        errors: { 'card.module': CARD_MODULE_ERROR_MESSAGE, terms: 'a' },
      }),
    ).toBe('還有 2 個項目需要確認,已在上方標示');
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

// ─────────────────────────────────────────────────────────────────────────────
// U4a:TapPay 卡片欄驗證
// ─────────────────────────────────────────────────────────────────────────────
describe('validateTapPayFields', () => {
  const ok = {
    ready: 'ready' as const,
    canGetPrime: true,
    fieldStatus: { number: 0 as const, expiry: 0 as const, ccv: 0 as const },
    submitAttempted: true,
  };

  it('三欄皆 0 + ready + canGetPrime → valid、零錯誤', () => {
    const r = validateTapPayFields(ok);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual({});
  });

  // 🔴 這組必須把 canGetPrime 釘成 **true** 才有意義。
  //   我第一版寫成 canGetPrime:false → valid 是「因為 canGetPrime 才 false」,
  //   斷言通過的理由是錯的;突變實測(把 `=== 0` 改成 `!== 2`、把 ready 判斷改成 `!== 'error'`)
  //   兩個 mutant 都存活 = 我自己的測試假綠。這裡改成「唯一可能讓它 invalid 的就是受測那個條件」。
  it('🔴 status 1/3 絕不視為 valid(canGetPrime 釘 true 以隔離變因,逐欄都驗)', () => {
    for (const status of [1, 3] as const) {
      for (const field of ['number', 'expiry', 'ccv'] as const) {
        const r = validateTapPayFields({
          ...ok,
          canGetPrime: true,
          fieldStatus: { ...ok.fieldStatus, [field]: status },
        });
        expect(r.valid).toBe(false);
      }
    }
  });

  it('🔴 status 2 絕不視為 valid(同樣釘 canGetPrime=true)', () => {
    for (const field of ['number', 'expiry', 'ccv'] as const) {
      const r = validateTapPayFields({
        ...ok,
        canGetPrime: true,
        fieldStatus: { ...ok.fieldStatus, [field]: 2 },
      });
      expect(r.valid).toBe(false);
    }
  });

  it('🔴 ready=loading 絕不視為 valid(三欄全 0 + canGetPrime=true,唯一變因就是 ready)', () => {
    const r = validateTapPayFields({ ...ok, ready: 'loading', canGetPrime: true });
    expect(r.valid).toBe(false);
  });

  it('🔴 ready=error 絕不視為 valid(同上,唯一變因是 ready)', () => {
    const r = validateTapPayFields({ ...ok, ready: 'error', canGetPrime: true });
    expect(r.valid).toBe(false);
  });

  it('status 1(空)與 3(打一半)共用「請輸入完整X」;2(格式錯)用「X不正確」(Sean Q2=B 兩態)', () => {
    for (const status of [1, 3] as const) {
      const r = validateTapPayFields({
        ...ok,
        canGetPrime: false,
        fieldStatus: { number: status, expiry: status, ccv: status },
      });
      expect(r.errors['card.number']).toBe('請輸入完整卡號');
      expect(r.errors['card.expiry']).toBe('請輸入完整有效期');
      expect(r.errors['card.ccv']).toBe('請輸入完整安全碼');
    }
    const bad = validateTapPayFields({
      ...ok,
      canGetPrime: false,
      fieldStatus: { number: 2, expiry: 2, ccv: 2 },
    });
    expect(bad.errors['card.number']).toBe('卡號不正確,請重新確認');
    expect(bad.errors['card.expiry']).toBe('有效期不正確,請重新確認');
    expect(bad.errors['card.ccv']).toBe('安全碼不正確,請重新確認');
  });

  it('只有一欄壞 → 只報那一欄(其他欄不牽連)', () => {
    const r = validateTapPayFields({
      ...ok,
      canGetPrime: false,
      fieldStatus: { number: 2, expiry: 0, ccv: 0 },
    });
    expect(r.errors['card.number']).toBeTruthy();
    expect('card.expiry' in r.errors).toBe(false);
    expect('card.ccv' in r.errors).toBe(false);
  });

  // 🔴 codex 關卡1 R2 must-fix:若把 valid 實作成「errors 是否為空」,這兩個案例會被誤判成通過。
  it('🔴 submitAttempted=false → errors 為空,但 valid 必須是 false(擋 fail-open)', () => {
    const loading = validateTapPayFields({
      ...ok,
      ready: 'loading',
      canGetPrime: false,
      submitAttempted: false,
    });
    expect(loading.errors).toEqual({});
    expect(loading.valid).toBe(false);

    const invalidField = validateTapPayFields({
      ...ok,
      canGetPrime: false,
      fieldStatus: { number: 2, expiry: 0, ccv: 0 },
      submitAttempted: false,
    });
    expect(invalidField.errors).toEqual({});
    expect(invalidField.valid).toBe(false);
  });

  it('🔴 ready=error → 即使沒按過付款也產 card.module(今日就是一進畫面就顯示,不得倒退)', () => {
    const r = validateTapPayFields({ ...ok, ready: 'error', submitAttempted: false });
    expect(r.valid).toBe(false);
    expect(r.errors['card.module']).toBe(CARD_MODULE_ERROR_MESSAGE);
    // 該分支根本不渲染三個欄位 → 不得同時產逐欄錯誤(否則指向不存在的欄位)
    expect('card.number' in r.errors).toBe(false);
    expect('card.expiry' in r.errors).toBe(false);
    expect('card.ccv' in r.errors).toBe(false);
  });

  it('ready=loading + 按過付款 → card.module 走「載入中」,不產逐欄紅字(欄位還沒掛出來)', () => {
    const r = validateTapPayFields({ ...ok, ready: 'loading', canGetPrime: false });
    expect(r.valid).toBe(false);
    expect(r.errors['card.module']).toBe(CARD_MODULE_LOADING_MESSAGE);
    expect('card.number' in r.errors).toBe(false);
  });

  // 🔴 防死路(Sean Q4=B):移除按鈕鎖後,這個矛盾態若沒有訊息 = 按了完全沒反應。
  it('🔴 三欄皆 0 但 canGetPrime=false → invalid 且必須有 card.module 訊息(不得 invalid 卻零訊息)', () => {
    const r = validateTapPayFields({ ...ok, canGetPrime: false });
    expect(r.valid).toBe(false);
    expect(r.errors['card.module']).toBe(CARD_NOT_READY_MESSAGE);
  });

  it('canGetPrime=false 但已有逐欄錯誤 → 不再疊加 card.module(避免重複報同一件事)', () => {
    const r = validateTapPayFields({
      ...ok,
      canGetPrime: false,
      fieldStatus: { number: 1, expiry: 0, ccv: 0 },
    });
    expect(r.errors['card.number']).toBeTruthy();
    expect('card.module' in r.errors).toBe(false);
  });
});
