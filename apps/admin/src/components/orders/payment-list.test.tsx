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

// 🔴 `amountDue` 預設值刻意**不用 0**:0 會讓「已收 0 = 應收 0」恆成立,
//    整族既有格子從此都跑在「已收足」那一態下 —— 那正是 fixture 值讓斷言恆真的形狀
//    (memory `fixture-value-makes-guard-vacuous`)。預設用一個與各格 fixture 金額
//    (6800)不同的數,任何一格意外落到 settled 都看得出來;要驗三態的格子自己傳。
const DEFAULT_DUE = 1180;
const text = (data: PaymentListData, amountDue: number = DEFAULT_DUE): string =>
  render(<PaymentList data={data} amountDue={amountDue} />).container.textContent ?? '';

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
    // 🔴 #437 ② 之後**列上的金額是無空格那份**(`6,800元`);有空格的 `6,800 元` 是彙總行的格式。
    //    這格原本斷言 `6,800 元`,#437 加上彙總行之後它會**因為彙總行而通過** ——
    //    列的金額就算整個不見也照樣綠(量錯東西)。改成只可能由列產生的字面。
    expect(t).toContain('6,800元');
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
    // 同上:列的金額是無空格那份;`500 元` 會被彙總行的「已收 500 元」擋掉判別力。
    expect(t).toContain('500元');
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

// ── #437 Sean 肉眼驗四點 ─────────────────────────────────────────────────────
// 🔴 收合這件事**不能用文字斷言驗**:`details` 收起來的內容仍然在 DOM 裡、
//    `textContent` 照樣讀得到 ⇒ 拿 `toContain` 驗「有沒有收起來」是恆真。
//    要驗就驗 `details.open` 這個真的會變的東西。
const dom = (data: PaymentListData, amountDue: number = DEFAULT_DUE): HTMLElement =>
  render(<PaymentList data={data} amountDue={amountDue} />).container;

describe('#437 ① 標題', () => {
  it('標題是「收款」,不再是「已登錄的收款」', () => {
    const t = text({ status: 'ok', rows: [ROW] });
    expect(t).toContain('收款');
    expect(t).not.toContain('已登錄的收款');
  });
});

describe('#437 ② 每筆列精簡單行 + 細節收合', () => {
  it('單行帶軌別/短時點/無空格金額;完整時點與登錄者不在單行上', () => {
    const c = dom({ status: 'ok', rows: [ROW] });
    const summary = c.querySelector('li details summary');
    expect(summary).not.toBeNull();
    const s = summary?.textContent ?? '';
    expect(s).toContain('信用卡');
    expect(s).toContain('6,800元');
    // 06/23 = ROW.receivedAt 在 Asia/Taipei 的月日(2026-06-23T07:30:04Z → 台北 15:30)
    expect(s).toContain('06/23 15:30');
    // 🔴 這三條是這格的重點:它們必須**不在單行上**(在展開區)——
    //    少了這三條,把細節原封不動留在單行上也會全綠 = 精簡沒被驗到。
    expect(s).not.toContain('登錄於');
    expect(s).not.toContain('憑證');
    expect(s).not.toContain('2026-06-23');
  });

  it('細節在展開區裡(登錄者/憑證/完整時點)', () => {
    const c = dom({ status: 'ok', rows: [ROW] });
    const body = c.querySelector('li details > div');
    const b = body?.textContent ?? '';
    expect(b).toContain('系統回填(歷史資料)');
    expect(b).toContain('RCPVVJ');
    expect(b).toContain('2026-06-23 15:30');
  });

  it('🔴 列**預設收合**(open 為 false)', () => {
    const c = dom({ status: 'ok', rows: [ROW] });
    const d = c.querySelector('li details');
    expect(d).not.toBeNull();
    expect((d as HTMLDetailsElement).open).toBe(false);
  });
});

describe('#437 ④ 卡頂彙總三態', () => {
  it('已收足:應收=已收 ⇒ 徽章,且不出現「還差」「溢收」', () => {
    const t = text({ status: 'ok', rows: [{ ...ROW, amount: 6800 }] }, 6800);
    expect(t).toContain('已收足');
    expect(t).not.toContain('還差');
    expect(t).not.toContain('溢收');
  });

  it('少收:差額算得出來且逐字「還差」(Sean 補「少收也要注意」)', () => {
    const t = text({ status: 'ok', rows: [{ ...ROW, amount: 6800 }] }, 10000);
    expect(t).toContain('還差 3,200 元');
    expect(t).not.toContain('已收足');
    expect(t).not.toContain('溢收');
  });

  it('溢收:超收金額標出來,且**不擋**(Q-溢收=A 只標不擋)', () => {
    const t = text({ status: 'ok', rows: [{ ...ROW, amount: 6800 }] }, 5000);
    expect(t).toContain('溢收 1,800 元');
    expect(t).not.toContain('已收足');
    expect(t).not.toContain('還差');
  });

  it('🔴 沖銷列要算進已收(SUM(amount),不可濾掉沖銷列再加)', () => {
    // 6800 收 + (-6800) 沖 = 已收 0;應收 6800 ⇒ 還差 6800。
    // 濾掉沖銷列的寫法會算成已收 6800 ⇒ 畫「已收足」⇒ 這格紅。
    const t = text(
      {
        status: 'ok',
        rows: [ROW, { ...ROW, id: 'p2', amount: -6800, isReversal: true }],
      },
      6800,
    );
    expect(t).toContain('還差 6,800 元');
    expect(t).not.toContain('已收足');
  });

  it('🔴 讀不到明細時**不得**畫出任何三態(那會是一句他分不出真假的催款訊息)', () => {
    for (const status of ['unreadable', 'order_not_found'] as const) {
      cleanup();
      const t = text({ status }, 6800);
      expect(t).toContain('已收金額');
      expect(t).toContain('未知');
      expect(t).not.toContain('還差');
      expect(t).not.toContain('溢收');
      expect(t).not.toContain('已收足');
    }
  });
});
