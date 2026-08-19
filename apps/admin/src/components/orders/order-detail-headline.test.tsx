// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AdminOrderDetail } from '@pcm/domain';

import { OrderSummaryCards } from './order-detail-summary-cards';

// order-detail-headline.test.tsx — 片3 頭條「尾款」那一格的守門(設計稿 §1 區塊①)。
//
// 🔴 **為什麼需要它**:本片加完那一格之後,`components/orders` + `app/orders` 全部 826 格
//    **沒有一格紅、也沒有一格綠是因為它** —— 那一格加上去的當下就沒有任何人在看。
//
// 🔴 **四態必須各自有一格,不能只測 `short`**:它們的**下一步不同**,而畫面上只差一個數字。
//    最危險的是 `unknown` 被答成 `0` —— 那是對員工說「收齊了」,他就不會去催尾款。
//
// ⚠️ **本檔擋得住 / 擋不住**:
//   擋得住 —— 四態任一被合併、`unknown` 被填成數字、`over` 印出負數、整格被刪。
//   **擋不住** —— 三格有沒有真的排成一列、字級、`tracking` 那些。要真瀏覽器 + Sean 的眼睛。

vi.mock('server-only', () => ({}));

const base = {
  id: '11111111-1111-4111-8111-111111111111',
  displayId: 'ABC123',
  createdAt: '2026-08-10T02:00:00+00:00',
  paymentStatus: 'partiallyPaid',
  invoiceStatus: 'not_issued',
  paidAt: null,
  cancelledAt: null,
  orderSource: 'storefront',
  paymentChannel: 'tappay',
  shippingMethod: 'homeDelivery',
  invoiceRequest: { type: 'personal', taxId: null, title: null, carrier: null },
  invoiceNumber: null,
  invoiceAmount: null,
  customer: { name: '沈佑霖', phone: null, email: null },
  customerUserId: null,
  shippingAddress: { name: null, phone: null, line: null },
  total: { amount: 23800, currency: 'TWD' },
  items: [],
  itemsTruncated: false,
  notes: [],
} as unknown as AdminOrderDetail;

const paid = (n: number) => [{ id: 'p1', amount: n }] as never;

/**
 * 🔴🔴 **取【尾款那一格】的值,不是整個容器的文字。**
 *
 * 本檔第一版用 `container.textContent` 比對,而**突變測試當場證明那把尺是壞的**:
 * 把「`unknown` ⇒ 未知」改成「`unknown` ⇒ 0」之後,**四格全綠** ——
 * 因為「未知」**左邊那格(總額/已收)也會印**,`textContent` 分不出是誰印的。
 * ⇒ 那正是本檔要擋的那個 bug,而尺看不見它。
 *
 * ⇒ 改成:找到小標是「尾款」的那個 `<section>`,只讀它的值。
 *   **量具自檢**:找不到那一格就直接 throw —— 「找不到」與「值不對」必須分得開,
 *   否則整格被刪掉時,下面每一條 `not.toContain` 都會**因為什麼都沒有而變綠**。
 *
 * 🔴 **選法本身也自檢過(W4 指出「那個選法就是一個【只看這一段】的決定」)** ——
 *    2026-08-19 四態各跑一次、印出它抓到第幾個 `<section>` 與全部小標:
 *    ```
 *    [short]   n=7 idx=1 val=13,800     labels=總額 / 已收|尾款|件數 已訂 / 到貨|(四張大卡)
 *    [unknown] n=7 idx=1 val=未知
 *    [settled] n=7 idx=1 val=0
 *    [over]    n=7 idx=1 val=溢收 6,200
 *    ```
 *    ⇒ 四態**都抓到同一格、值都正確**,且沒有第二個小標叫「尾款」⇒ 選法不會抓錯。
 *    ⚠️ 而這只證明「**今天這七個 section 之下**成立」——日後有人再加一格小標叫「尾款」就會撞,
 *       那時 `find` 會回第一個。**不是永久保證,是一次量測。**
 */
function balanceCell(payments: Parameters<typeof OrderSummaryCards>[0]['payments']): string {
  const { container } = render(<OrderSummaryCards detail={base} payments={payments} />);
  const section = [...container.querySelectorAll('section')].find(
    (el) => el.querySelector('p:last-of-type')?.textContent === '尾款',
  );
  if (!section) throw new Error('找不到小標為「尾款」的那一格 —— 整格被刪掉了?');
  return section.querySelector('p')?.textContent ?? '';
}

describe('片3 頭條「尾款」四態', () => {
  afterEach(cleanup);

  // 🔴🔴 **N1(W6 抓):上面那些格釘住「尾款那格印什麼」,沒有一格釘住「它在哪一格」。**
  //    設計稿 §1 指定它在**中間**;而我寫在 `balanceCell` 註解裡的 `idx=1`
  //    是**一次量測,不是守門** ⇒ 有人調換 section 順序,四態全綠而畫面不照稿。
  //    ⇒ 這一格同時綁住「恰三格」——多一格 / 少一格都不是設計稿那條。
  it('🔴 頭條**恰三格、且依序**是 總額/已收 → 尾款 → 件數(順序被調換 ⇒ 這一格紅,四態格不會紅)', () => {
    const { container } = render(
      <OrderSummaryCards detail={base} payments={{ status: 'ok', rows: paid(10000) }} />,
    );
    // 🔴 只取頭條那一列 —— 下面四張大卡(客戶/收件/付款/發票)也是 `<section>`,
    //    不限定的話這一格會變成在斷言七格的順序。
    const headline = container.querySelector('div.grid');
    const labels = [...(headline?.querySelectorAll('section') ?? [])].map(
      (el) => el.querySelector('p:last-of-type')?.textContent,
    );
    expect(labels).toEqual(['總額 / 已收', '尾款', '件數 已訂 / 到貨']);
  });

  it('🔴 `short` ⇒ 印差額(設計稿那一格:23,800 / 10,000 ⇒ 13,800)', () => {
    expect(balanceCell({ status: 'ok', rows: paid(10000) })).toBe('13,800');
  });

  it('🔴🔴 `unknown`(收款列讀不到)⇒ 印「未知」,**絕不印 0** —— 0 = 對員工說「收齊了」', () => {
    // 🔴 用 `toBe` 不是 `toContain`:`toContain('未知')` 在整格印成 `0` 時**仍可能綠**
    //    (左邊那格也印「未知」)—— 第一版就是這樣被突變測試打回來的。
    expect(balanceCell({ status: 'unreadable' } as never)).toBe('未知');
  });

  it('🔴 `settled` ⇒ 真的印 `0`,不是留白(留白讀起來像「還沒算」)', () => {
    expect(balanceCell({ status: 'ok', rows: paid(23800) })).toBe('0');
  });

  it('🔴 `over` ⇒ 印「溢收 N」,**不印負數**(負的尾款會被讀成「還要收 -N」)', () => {
    const v = balanceCell({ status: 'ok', rows: paid(30000) });
    expect(v).toBe('溢收 6,200');
    expect(v).not.toContain('-');
  });
});
