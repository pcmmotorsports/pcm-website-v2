// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { OrderOverpaidNotice } from './order-overpaid-notice';

/**
 * ⟦b4-PAIDTHENOVERPAID⟧ **三個世界各一格,而第三格是【符號】那一格。**
 *
 * 🔴 為什麼三格不是一格:`balanceDue` 這一欄的病不是「印不印」,是**方向**。
 *    把條件寫成 `!== 0`、或把 `-balanceDue` 寫成 `balanceDue`,
 *    畫面會對一個**還欠我們錢**的客人印「多付」—— 而那不會有任何東西紅。
 *    ⇒ 📌 所以 `+200 ⇒ 不印` 那一格是本族最承重的一格, 不是湊數的。
 */
describe('OrderOverpaidNotice — 三個世界', () => {
  afterEach(cleanup);

  it('🔴 多付(balanceDue = -200)⇒ 印, 而金額是 200 不是 -200', () => {
    render(<OrderOverpaidNotice balanceDue={-200} />);
    const box = document.querySelector('[data-testid="order-overpaid-notice"]');
    expect(box).not.toBeNull();
    // 🔴 標籤逐字釘住 —— Sean 2026-09-05 拍乙的原字面, 「處理」兩個字不在裡面。
    expect(document.querySelector('[data-testid="order-overpaid-label"]')?.textContent).toBe(
      '多付, 待人工',
    );
    const amount = document.querySelector('[data-testid="order-overpaid-amount"]')?.textContent ?? '';
    expect(amount, '金額沒印出來').toContain('200');
    // 🛑 負號跑到畫面上 = 符號翻錯了(或忘了取負)。
    expect(amount, '畫面印了負號 ⇒ 取負那一步沒做').not.toContain('-200');
  });

  it('🔴 算不出來(balanceDue = null)⇒ 不印 —— 不猜、不補 0', () => {
    render(<OrderOverpaidNotice balanceDue={null} />);
    expect(document.querySelector('[data-testid="order-overpaid-notice"]')).toBeNull();
  });

  it('🔴🔴 還欠錢(balanceDue = +200)⇒ 不印 —— 那是尾款不是多付, 符號不准反', () => {
    render(<OrderOverpaidNotice balanceDue={200} />);
    expect(
      document.querySelector('[data-testid="order-overpaid-notice"]'),
      '對一個【還欠我們錢】的客人印了「多付」⇒ 條件寫成 !== 0 或符號反了',
    ).toBeNull();
  });

  it('⚪ 邊界:剛好付清(balanceDue = 0)⇒ 不印', () => {
    render(<OrderOverpaidNotice balanceDue={0} />);
    expect(document.querySelector('[data-testid="order-overpaid-notice"]')).toBeNull();
  });

  it('⚪ 正對照:這把尺真的會印 —— 否則上面三格「不印」證明不了任何事', () => {
    render(<OrderOverpaidNotice balanceDue={-1} />);
    expect(
      document.querySelector('[data-testid="order-overpaid-notice"]'),
      '連 -1 都不印 ⇒ 這個元件根本沒渲染過, 上面每一格都恆綠',
    ).not.toBeNull();
  });
});
