// order-cancel-reason.test.ts — `orderCancelKindOf` 的守門。
//
// 🔴🔴 **這支檔是 codex must-fix(2026-08-24)之後,那條【客人端與伺服器的邊界】唯一的證人。**
//    在此之前這兩格住在 `apps/storefront/.../order-display.test.ts`,而那一層現在拿不到原始欄位了
//    (第三參數收斂成枚舉)⇒ **它們是【搬過來】的,不是新寫的,也不是被刪掉的。**
//    📌 形狀:**收斂一個型別會讓某些測試失去它的對象 —— 那時要搬,不要刪。**

import { describe, it, expect } from 'vitest';
import { orderCancelKindOf, PAYMENT_EXPIRED_CANCEL_REASON } from './order-cancel-reason';

describe('orderCancelKindOf', () => {
  it('字面鎖:自動失效的機器碼逐字 = `payment_expired`', () => {
    // 🔴 三來源律:寫入端 `20260809160000_..._expire_unpaid_orders_fn.sql:174` 逐字。
    //    改這個字面 = 改一個 DB 已經在寫的值 ⇒ 這一格會紅、逼人回去看那支 migration。
    expect(PAYMENT_EXPIRED_CANCEL_REASON).toBe('payment_expired');
  });

  it('`cancelledAt` 為 null ⇒ `none`(reason 是什麼都不算取消)', () => {
    expect(orderCancelKindOf({ cancelledAt: null, cancelledReason: null })).toBe('none');
    // 🔴 這一格擋的是「先看 reason 再看 at」那種倒過來的寫法:
    //    一張沒取消、而 reason 欄剛好有值的單,不得被判成取消。
    expect(orderCancelKindOf({ cancelledAt: null, cancelledReason: 'payment_expired' })).toBe('none');
  });

  it('`cancelledAt` 有值 + reason = 機器碼 ⇒ `expired`', () => {
    expect(
      orderCancelKindOf({ cancelledAt: '2099-04-16T02:00:00Z', cancelledReason: 'payment_expired' }),
    ).toBe('expired');
  });

  it('🔴 `cancelledAt` 有值而 reason 是 null ⇒ `cancelled`,不是 `none` 也不是某種「未知」', () => {
    // 那張單**確實被取消了**,我們只是不知道理由;對客人而言「已取消」就是正確答案。
    expect(orderCancelKindOf({ cancelledAt: '2099-04-16T02:00:00Z', cancelledReason: null })).toBe(
      'cancelled',
    );
  });

  it('🔴🔴 只准【等於】機器碼,不得寫成「包含」/「開頭是」', () => {
    // `cancelled_reason` 平常裝的是**對客中文**(A8a1 依七值映射表產出),
    // 而 `p_reason_code = 'other'` 那條路裝的是**員工當場打的原文**
    // ⇒ 那串英文出現在人寫的字裡的機率**不是零**,而 includes/startsWith 會把一張
    //   **人工取消**的單標成「已逾期」——那是對客人說錯話。
    expect(
      orderCancelKindOf({
        cancelledAt: '2099-04-16T02:00:00Z',
        cancelledReason: '系統標記 payment_expired 之後由客服人工取消',
      }),
    ).toBe('cancelled');
  });

  it('🔴 員工的自由文字進來 ⇒ 一律 `cancelled`,而【回傳值裡不含那串字】', () => {
    // 這一格守的是本函式最重要的性質:**它是一道收斂閘**。
    // 回傳只有三個值,所以原文在型別上就出不去 —— 而這一格把那件事釘成可執行的斷言。
    const internal = '供應商欠款,內部失誤,先取消';
    const kind = orderCancelKindOf({
      cancelledAt: '2099-04-16T02:00:00Z',
      cancelledReason: internal,
    });
    expect(kind).toBe('cancelled');
    expect(JSON.stringify(kind)).not.toContain('供應商');
    expect(JSON.stringify(kind)).not.toContain(internal);
  });
});
