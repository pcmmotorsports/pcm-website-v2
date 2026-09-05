import { describe, expect, it } from 'vitest';
import {
  cancelPendingRefundNotice,
  railLabel,
} from './cancel-pending-refund-notice';

describe('cancelPendingRefundNotice —— 三個世界必須分得開', () => {
  // 🔴🔴 **這一族真正在守的是「`unknown` 不會塌成 `none`」。**
  //    兩者在畫面上的差別是「一句話」vs「沒有紅框」, 而後者與「這單沒收過錢」一模一樣
  //    ⇒ 差一筆該退給客人的錢。
  it('🔴 讀不到(null)⇒ unknown, 不是 none', () => {
    expect(cancelPendingRefundNotice(null)).toEqual({ kind: 'unknown' });
  });

  it('🔵 空陣列 ⇒ none —— 那是函式算出來的「不欠」, 不是讀失敗', () => {
    expect(cancelPendingRefundNotice([])).toEqual({ kind: 'none' });
  });

  it('有金額 ⇒ amounts, 逐軌原樣帶出去', () => {
    const r = cancelPendingRefundNotice([
      { rail: 'bank_transfer', amount: 600 },
      { rail: 'cash', amount: 400 },
    ]);
    expect(r).toEqual({
      kind: 'amounts',
      rails: [
        { rail: 'bank_transfer', amount: 600 },
        { rail: 'cash', amount: 400 },
      ],
    });
  });

  it('🔴 0 元的軌要被濾掉 —— 一列 0 元 = 一筆沒有人要付的待辦', () => {
    // 🔵 上游 `pcm_pending_refund_amounts` 已經濾過, 而**這一層不假設上游的性質**。
    expect(cancelPendingRefundNotice([{ rail: 'cash', amount: 0 }])).toEqual({ kind: 'none' });
  });

  it('🔴 全部都是 0 ⇒ none;而其中一筆有值 ⇒ amounts 只留有值那筆', () => {
    const r = cancelPendingRefundNotice([
      { rail: 'bank_transfer', amount: 0 },
      { rail: 'cash', amount: 250 },
    ]);
    expect(r).toEqual({ kind: 'amounts', rails: [{ rail: 'cash', amount: 250 }] });
  });
});

describe('railLabel', () => {
  it.each([
    ['bank_transfer', '匯款'],
    ['cash', '現金'],
    ['card', '刷卡'],
  ])('%s ⇒ %s', (a, b) => expect(railLabel(a)).toBe(b));

  it('🔵 不認得的軌照原字印出來, 不吞掉', () => {
    // 🛑 吞掉會讓「多了一條軌」這件事零訊號。
    expect(railLabel('linepay')).toBe('linepay');
  });
});

describe('🔴 負數 —— 它不是「不欠錢」', () => {
  // 🛑 負數今天到不了這裡(`20260902030000:90` 已濾)。看到一個 ⇒ **上游換了或我讀錯函式**,
  //    而那兩種都不是「這單不欠」。靜靜吞成 `none` = 畫面沒有紅框 = 與「沒收過錢」同形。
  it('有負數 ⇒ unknown(畫成一句話), 不是 none', () => {
    expect(cancelPendingRefundNotice([{ rail: 'cash', amount: -100 }])).toEqual({ kind: 'unknown' });
  });

  it('🔵 正對照:正數與負數混在一起, 也是 unknown —— 不可以只把正的那筆畫出來', () => {
    // 少了這一格,一個「先濾正數再判負數」的實作會讓上面那格綠而這個世界靜靜漏掉。
    expect(
      cancelPendingRefundNotice([
        { rail: 'bank_transfer', amount: 600 },
        { rail: 'cash', amount: -100 },
      ]),
    ).toEqual({ kind: 'unknown' });
  });
});
