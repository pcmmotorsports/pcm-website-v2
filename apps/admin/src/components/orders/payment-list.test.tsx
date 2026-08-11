// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { PaymentList, type PaymentListData } from './payment-list';
import type { OrderPaymentRow } from '../../lib/orders/payment-list-view';

// payment-list.test.tsx — #15-B2-a 排版層。
// 🔴 本檔最重要的一組是「三態畫出來的東西必須互相分得開」——
//    三者的輸入都是「沒有列可畫」,寫錯順序就會把讀取失敗顯示成「這單沒收過錢」,
//    而員工會照著再登一次 ⇒ 重複入帳(#328 同款形狀)。

const ROW: OrderPaymentRow = {
  id: 'p1',
  rail: 'card',
  amount: 6800,
  receivedAt: '2026-06-23T07:30:04+00:00',
  createdAt: '2026-08-11T04:55:37+00:00',
  actor: 'op4_backfill',
  bankReference: null,
  recTradeId: 'RCPVVJ',
  payerNote: null,
  reversesPaymentId: null,
  reversalReason: null,
  isReversal: false,
};

// 每格之間清乾淨:同一格裡連render 兩次(三態互比那格)靠的是各自的 container,
// 但跨格殘留會讓 `not.toContain` 這種否定斷言假紅/假綠。
afterEach(cleanup);

const text = (data: PaymentListData): string =>
  render(<PaymentList data={data} />).container.textContent ?? '';

describe('三態分得開', () => {
  it('讀取失敗 ⇒ 明說「不知道有沒有」且叫他不要再登一筆', () => {
    const t = text({ status: 'unreadable' });
    expect(t).toContain('讀取失敗');
    expect(t).toContain('不知道有沒有');
    expect(t).toContain('重複入帳');
    // 🔴 不可顯示「0 筆」—— 那是這一族最短的一句謊話。
    expect(t).toContain('筆數未知');
    expect(t).not.toContain('0 筆');
    // 也不可同時說「尚未登錄任何收款」。
    expect(t).not.toContain('尚未登錄任何收款');
  });

  it('訂單不存在 ⇒ 說查不到訂單,不是說沒收款', () => {
    const t = text({ status: 'order_not_found' });
    expect(t).toContain('查不到這張訂單');
    expect(t).not.toContain('尚未登錄任何收款');
    expect(t).toContain('筆數未知');
  });

  it('真的零筆 ⇒ 「尚未登錄任何收款」+「0 筆」', () => {
    const t = text({ status: 'ok', rows: [] });
    expect(t).toContain('尚未登錄任何收款');
    expect(t).toContain('0 筆');
    expect(t).not.toContain('讀取失敗');
  });

  it('🔴 三態的畫面文字兩兩不同(突變:把 unreadable 併進零筆分支 ⇒ 這格轉紅)', () => {
    const a = text({ status: 'unreadable' });
    const b = text({ status: 'order_not_found' });
    const c = text({ status: 'ok', rows: [] });
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);
  });
});

describe('列的內容', () => {
  it('card 軌畫得出中文(正式站現況全是它,而本表單做不出來)', () => {
    const t = text({ status: 'ok', rows: [ROW] });
    expect(t).toContain('信用卡');
    expect(t).toContain('6,800 元');
    expect(t).toContain('1 筆');
  });

  it('機器登錄者翻白話、憑證出得來', () => {
    const t = text({ status: 'ok', rows: [ROW] });
    expect(t).toContain('系統回填(歷史資料)');
    expect(t).toContain('RCPVVJ');
  });

  it('收款時間與登錄時間分開顯示(對帳看收款那個)', () => {
    const t = text({ status: 'ok', rows: [ROW] });
    expect(t).toContain('收款於 2026-06-23 15:30');
    expect(t).toContain('登錄於 2026-08-11 12:55');
  });

  it('🔴 正額的沖銷列仍標「沖銷更正」(不看金額正負)', () => {
    const t = text({
      status: 'ok',
      rows: [{ ...ROW, amount: 500, isReversal: true, reversalReason: '打錯金額' }],
    });
    expect(t).toContain('沖銷更正');
    expect(t).toContain('500 元');
    expect(t).toContain('打錯金額');
  });

  it('未知軌別顯示原值、不是空白', () => {
    const t = text({ status: 'ok', rows: [{ ...ROW, rail: 'crypto' }] });
    expect(t).toContain('crypto');
  });

  it('備註逐字渲染(React 天然 escape)', () => {
    const t = text({ status: 'ok', rows: [{ ...ROW, payerNote: '<b>客人說</b>' }] });
    expect(t).toContain('<b>客人說</b>');
  });
});
