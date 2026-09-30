// 匯款對帳小工具(2026-09-30 Sean 批研究 Q2 乙)。
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TransferMatchPanel, TRANSFER_NO_MATCH_TEXT, type TransferMatchResult } from './transfer-match-panel';

const html = (result: TransferMatchResult, amountInput = '', refInput = '') =>
  renderToStaticMarkup(
    <TransferMatchPanel
      formHref='/orders?todo=unpaid-transfer&payment_status=unpaid'
      searchHref='/orders'
      amountInput={amountInput}
      refInput={refInput}
      result={result}
    />,
  );

describe('TransferMatchPanel', () => {
  it('表單用 GET 送回同一條待辦網址(保留 todo 與篩選), 兩格帶著員工剛輸入的值', () => {
    const out = html({ kind: 'idle' }, '7000', '12345');
    expect(out).toContain('method="get"');
    expect(out).toContain('action="/orders"');
    expect(out).toContain('name="todo" value="unpaid-transfer"');
    expect(out).toContain('name="payment_status" value="unpaid"');
    expect(out).toContain('name="match_amt"');
    expect(out).toContain('value="7000"');
    expect(out).toContain('value="12345"');
    expect(out).toContain('找相符的單');
  });

  it('沒有相符的單 ⇒ 說清楚可能少匯或多匯、請用客戶名稱搜尋, 並給搜尋的路', () => {
    const out = html({ kind: 'ok', amount: 7000, rows: [], truncated: false }, '7000');
    expect(TRANSFER_NO_MATCH_TEXT).toBe('沒有金額剛好相符的單，可能少匯或多匯，請用客戶名稱搜尋。');
    expect(out).toContain(TRANSFER_NO_MATCH_TEXT);
    expect(out).toContain('href="/orders"');
    // Fable R1 B2:取消過 / 退過款的單刻意不列, 要講出來(不然「少匯或多匯」對這類單是錯的診斷)。
    expect(out).toContain('取消過或退過款的單不會列在這裡');
  });

  it('有相符的單 ⇒ 每張一列、「新增收款」連到帶好金額與末五碼的收款彈窗, 並提醒核對後再送出', () => {
    const out = html(
      {
        kind: 'ok',
        amount: 7000,
        rows: [{ id: 'a', displayId: 'PCM-0001', customerName: '王小明', payHref: '/orders?pay=a&match_amt=7000&match_ref=12345' }],
        truncated: false,
      },
      '7000',
      '12345',
    );
    expect(out).toContain('PCM-0001');
    expect(out).toContain('王小明');
    expect(out).toContain('還差 7,000');
    expect(out).toContain('href="/orders?pay=a&amp;match_amt=7000&amp;match_ref=12345"');
    expect(out).toContain('新增收款');
    expect(out).toContain('我已核對');
  });

  it('讀不完 / 讀不到 / 金額不對, 各自說清楚, 不假裝沒有相符的單', () => {
    expect(html({ kind: 'ok', amount: 7000, rows: [], truncated: true })).toContain('只比對了');
    const unreadable = html({ kind: 'unreadable' });
    expect(unreadable).toContain('待收款的訂單載入失敗');
    expect(unreadable).not.toContain(TRANSFER_NO_MATCH_TEXT);
    expect(html({ kind: 'invalid' }, 'abc')).toContain('請輸入入帳金額');
  });
});
