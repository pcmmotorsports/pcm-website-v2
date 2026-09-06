// @vitest-environment jsdom
// ⟦b4-TAPPAYDIRECT⟧ 片 B · B3a:補登入口的元件。
//
// 🔴🔴 **本檔最重要的不是「畫面長對了」, 是【它沒有接線】這件事被釘住** ——
//    主視窗 B 2026-09-07 04:2x 裁 `B3 = 甲`:片 B 只有畫面, 送出鈕恆關。
//    而「不小心接上去」在畫面上**看不出來**(多一個 action 屬性、按鈕不再 disabled),
//    ⇒ 📌 這幾格就是那個看不見的差別的替身。
//    ⚠️ 而它們**擋不住**「片 C 接線時忘了補回 request_token」——那一格在片 C 自己身上。
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  BACKFILL_AMOUNT_FIELD,
  BACKFILL_ATTESTED_FIELD,
  BACKFILL_DR_CODE_FIELD,
  BACKFILL_OCCURRED_AT_FIELD,
  BACKFILL_ORDER_ID_FIELD,
  BACKFILL_REASON_FIELD,
} from '../../lib/payment/refund-backfill-form';
import { RefundBackfillSection } from './refund-backfill-section';

const ORDER = '11111111-2222-3333-4444-555555555555';

afterEach(cleanup);

function setup() {
  const { container } = render(<RefundBackfillSection orderId={ORDER} />);
  return container;
}

describe('⟦b4-TAPPAYDIRECT⟧ 補登入口(片 B = 不接線)', () => {
  it('🔴🔴 送出鈕【恆 disabled】—— 片 B 沒有後端可以呼叫', () => {
    setup();
    // 🔵 用原生屬性判, 不引 `@testing-library/jest-dom`(本 repo 沒裝那組 matcher,
    //    而為了一格斷言加一個依賴不划算)。
    const btn = screen.getByRole('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('🔴 表單沒有 action —— 接上去了這一格會紅', () => {
    const container = setup();
    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    // jsdom 對沒設 action 的 form 回空字串;有設就會是別的值。
    expect(form?.getAttribute('action')).toBeNull();
  });

  it('🔴 畫面上要明說「還不能用」—— 員工看到一張填得完的表單卻按不下去, 沒有這句就是個 bug', () => {
    setup();
    expect(screen.getByRole('note').textContent).toContain('還沒開放');
  });

  it('🔵 而它明說【不會動錢】—— 這是補登不是退款, 說錯方向會讓人以為按了會退第二次', () => {
    setup();
    expect(document.body.textContent).toContain('不會發起任何退款');
  });

  it.each([
    ['必勾', BACKFILL_ATTESTED_FIELD],
    ['DR 碼', BACKFILL_DR_CODE_FIELD],
    ['金額', BACKFILL_AMOUNT_FIELD],
    ['發生時刻', BACKFILL_OCCURRED_AT_FIELD],
    ['原因', BACKFILL_REASON_FIELD],
    ['訂單 id', BACKFILL_ORDER_ID_FIELD],
  ])('🔵 %s 這一欄在, 而且用的是解析器那份欄位名(兩邊分家 = 送出去解析不到)', (_label, name) => {
    const container = setup();
    expect(container.querySelector(`[name="${name}"]`)).not.toBeNull();
  });

  it("🔴 必勾那格的 value 是 '1' —— 與解析器同字面(它逐字寫著不得放寬成 true/on)", () => {
    const container = setup();
    const box = container.querySelector(`[name="${BACKFILL_ATTESTED_FIELD}"]`);
    expect(box?.getAttribute('type')).toBe('checkbox');
    expect(box?.getAttribute('value')).toBe('1');
  });

  it('🔵 訂單 id 是 hidden 欄、值就是傳進來的那一張單', () => {
    const container = setup();
    const hidden = container.querySelector(`[name="${BACKFILL_ORDER_ID_FIELD}"]`);
    expect(hidden?.getAttribute('type')).toBe('hidden');
    expect((hidden as HTMLInputElement)?.value).toBe(ORDER);
  });

  // 🛑 片 B 刻意【沒有】重送保護欄 —— 因為送不出去。
  //    這一格不是在說「不該有」, 是在說「今天沒有, 而片 C 接線時要補回來」。
  //    ⇒ 📌 它紅的那一天, 意思是有人接線了 ⇒ 那就該回頭看片 C 的清單。
  it('🛑 今天沒有 request_token 欄(片 C 接線時要補回來)', () => {
    const container = setup();
    expect(container.querySelector('[name="request_token"]')).toBeNull();
  });
});
