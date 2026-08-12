// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { ReverseResult } from '../../lib/orders/payment-reverse-state';

// 🔴 mock 掉沖銷 server action(transitively 拉 next/cache 與 session,jsdom 載不了);
//    action 自己的語意在 `payment-reverse-state.test.ts` 測,本檔測的是**元件接了哪一句**。
const reverseMock = vi.fn<(args: unknown) => Promise<ReverseResult>>();
vi.mock('../../lib/orders/payment-reverse-actions', () => ({
  reversePaymentAction: (args: unknown) => reverseMock(args),
}));

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
const ORDER_ID = 'ord-1';
const RETURN_TO = '/orders/ord-1';
const view = (data: PaymentListData, amountDue: number = DEFAULT_DUE) =>
  render(
    <PaymentList data={data} amountDue={amountDue} orderId={ORDER_ID} returnTo={RETURN_TO} />,
  );
const text = (data: PaymentListData, amountDue: number = DEFAULT_DUE): string =>
  view(data, amountDue).container.textContent ?? '';

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
  view(data, amountDue).container;

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

// ── #372-A12 沖銷入口 ────────────────────────────────────────────────────────
// 🔴 這一族**量的是 render 出來的字**,不是常數表(關卡1 R3 F3):
//    只讀常數的話,元件把「一般收款」與「沖銷列」兩句確認詞接反照樣全綠,
//    而那正是會害員工把原款加回帳上的那個錯。

/** 可沖銷的一列(ROW 是 card 軌,RPC 硬拒 ⇒ 沖銷這一族不能用它當主角)。 */
const CASH: OrderPaymentRow = { ...ROW, id: 'c1', rail: 'cash', recTradeId: null };

beforeEach(() => {
  reverseMock.mockReset();
  reverseMock.mockResolvedValue({ ok: true });
});

const btn = (c: HTMLElement, name: string): HTMLButtonElement | undefined =>
  [...c.querySelectorAll('button')].find((b) => b.textContent === name);

describe('#372-A12 哪幾列有沖銷鈕', () => {
  it('人工軌(現金)有鈕', () => {
    expect(btn(dom({ status: 'ok', rows: [CASH] }), '沖銷這一筆')).toBeDefined();
  });

  it('🔴 卡軌沒有鈕,而且要說明為什麼(空白會被讀成壞了)', () => {
    const c = dom({ status: 'ok', rows: [ROW] });
    expect(btn(c, '沖銷這一筆')).toBeUndefined();
    expect(c.textContent).toContain('刷卡收款的更正走 TapPay 退款,不在這裡沖銷。');
  });

  it('🔴 已被沖銷的列沒有鈕,而且掛「已沖銷」標記(留痕可見)', () => {
    const c = dom({
      status: 'ok',
      rows: [CASH, { ...CASH, id: 'c2', amount: -6800, isReversal: true, reversesPaymentId: 'c1' }],
    });
    expect(c.textContent).toContain('已沖銷');
    // c1 被沖 ⇒ 只剩沖銷列 c2 自己那一顆鈕。
    expect([...c.querySelectorAll('button')].filter((b) => b.textContent === '沖銷這一筆')).toHaveLength(1);
  });

  it('🔴 沖銷列本身仍可沖(誤沖的更正 = 沖銷之沖銷,Sean 2026-08-10 拍板)', () => {
    const c = dom({
      status: 'ok',
      rows: [{ ...CASH, id: 'r1', amount: -6800, isReversal: true, reversesPaymentId: 'gone' }],
    });
    expect(btn(c, '沖銷這一筆')).toBeDefined();
  });
});

describe('🔴 兩句確認詞不可接反', () => {
  const openPanel = (rows: OrderPaymentRow[]): string => {
    const c = dom({ status: 'ok', rows });
    fireEvent.click(btn(c, '沖銷這一筆')!);
    return c.textContent ?? '';
  };

  it('一般收款列 ⇒ 講「從『已收』裡扣掉」,不講恢復', () => {
    const t = openPanel([CASH]);
    expect(t).toContain('這筆錢會從「已收」裡扣掉');
    expect(t).not.toContain('恢復到帳上');
  });

  it('沖銷列 ⇒ 講「恢復到帳上」', () => {
    const t = openPanel([
      { ...CASH, id: 'r1', amount: -6800, isReversal: true, reversesPaymentId: 'gone' },
    ]);
    expect(t).toContain('恢復到帳上');
    expect(t).not.toContain('這筆錢會從「已收」裡扣掉');
  });

  // 突變靶:把 payment-reverse-button.tsx 的 `isReversal ? B : A` 對調 ⇒ 上面兩格都紅、其餘不動。
});

describe('🔴 原因必填擋在前端(DB 的 G3 是 btrim 後判空)', () => {
  const confirmBtn = (reason: string): HTMLButtonElement => {
    const c = dom({ status: 'ok', rows: [CASH] });
    fireEvent.click(btn(c, '沖銷這一筆')!);
    fireEvent.change(c.querySelector('input')!, { target: { value: reason } });
    return btn(c, '確認沖銷')!;
  };

  it.each(['', '   ', '　'])('空白原因「%s」⇒ 送不出去', (reason) => {
    expect(confirmBtn(reason).disabled).toBe(true);
  });

  it('填了字才送得出去', () => {
    expect(confirmBtn('登錯金額').disabled).toBe(false);
  });
});

describe('🔴 失敗訊息就地顯示(而且是核可句本身)', () => {
  it('拿到 not_reversible ⇒ 畫出那一句,零重試指令', async () => {
    reverseMock.mockResolvedValue({
      ok: false,
      code: 'not_reversible',
      message: '這一筆現在不能沖銷。',
    });
    const c = dom({ status: 'ok', rows: [CASH] });
    fireEvent.click(btn(c, '沖銷這一筆')!);
    fireEvent.change(c.querySelector('input')!, { target: { value: '登錯' } });
    fireEvent.click(btn(c, '確認沖銷')!);
    await vi.waitFor(() => expect(c.textContent).toContain('這一筆現在不能沖銷。'));
  });
});

describe('🔴 島送出去的參數逐欄對(關卡2 R1 MF4:接錯欄位 = 沖錯列,畫面看不出來)', () => {
  const submit = async (rows: OrderPaymentRow[], nth: number, reason: string) => {
    const c = dom({ status: 'ok', rows });
    const buttons = [...c.querySelectorAll('button')].filter((b) => b.textContent === '沖銷這一筆');
    fireEvent.click(buttons[nth]!);
    fireEvent.change(c.querySelector('input')!, { target: { value: reason } });
    fireEvent.click([...c.querySelectorAll('button')].find((b) => b.textContent === '確認沖銷')!);
    await vi.waitFor(() => expect(reverseMock).toHaveBeenCalled());
    return c;
  };

  it('第一列 ⇒ 帶第一列的 id;orderId / returnTo 照 props;reason 是 trim 過的', async () => {
    await submit([CASH], 0, '  登錯金額  ');
    expect(reverseMock).toHaveBeenCalledWith({
      paymentId: 'c1',
      orderId: ORDER_ID,
      returnTo: RETURN_TO,
      reason: '登錯金額',
    });
  });

  it('🔴 第二列 ⇒ 帶的是**第二列**的 id(釘住「哪一顆鈕對應哪一列」)', async () => {
    const second = { ...CASH, id: 'c9' };
    await submit([CASH, second], 1, '沖第二筆');
    expect(reverseMock).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'c9' }));
  });
});

describe('🔴 action 呼叫本身 reject(斷線)⇒ 要畫出雙分支那句,鈕不可卡死', () => {
  it('關卡2 R1 MF1:沒有 catch 的話這裡會靜默、busy 永久 true', async () => {
    reverseMock.mockRejectedValue(new Error('network down'));
    const c = dom({ status: 'ok', rows: [CASH] });
    fireEvent.click([...c.querySelectorAll('button')].find((b) => b.textContent === '沖銷這一筆')!);
    fireEvent.change(c.querySelector('input')!, { target: { value: '登錯' } });
    fireEvent.click([...c.querySelectorAll('button')].find((b) => b.textContent === '確認沖銷')!);

    await vi.waitFor(() =>
      expect(c.textContent).toContain('如果它沒有「已沖銷」的標記,代表沖銷沒有完成,請回到原本那一筆再沖一次'),
    );
    // 🔴 鈕要回得來(finally):卡死的話員工連重試都做不到。
    const confirm = [...c.querySelectorAll('button')].find(
      (b) => b.textContent === '確認沖銷',
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
  });
});

describe('🔴 成功後要有正面確認(R2 nit7:面板收起來 = 什麼都沒發生,兩者長得一樣)', () => {
  it('成功 ⇒ 畫出成功那句', async () => {
    const c = dom({ status: 'ok', rows: [CASH] });
    fireEvent.click([...c.querySelectorAll('button')].find((b) => b.textContent === '沖銷這一筆')!);
    fireEvent.change(c.querySelector('input')!, { target: { value: '登錯' } });
    fireEvent.click([...c.querySelectorAll('button')].find((b) => b.textContent === '確認沖銷')!);
    await vi.waitFor(() => expect(c.textContent).toContain('沖銷完成了'));
    // 反面:失敗時不可出現它(否則這格對「永遠畫成功」也會綠)。
    expect(c.textContent).not.toContain('這一筆現在不能沖銷');
  });

  it('失敗 ⇒ 不可出現成功那句', async () => {
    reverseMock.mockResolvedValue({
      ok: false,
      code: 'not_reversible',
      message: '這一筆現在不能沖銷。',
    });
    const c = dom({ status: 'ok', rows: [CASH] });
    fireEvent.click([...c.querySelectorAll('button')].find((b) => b.textContent === '沖銷這一筆')!);
    fireEvent.change(c.querySelector('input')!, { target: { value: '登錯' } });
    fireEvent.click([...c.querySelectorAll('button')].find((b) => b.textContent === '確認沖銷')!);
    await vi.waitFor(() => expect(c.textContent).toContain('這一筆現在不能沖銷。'));
    expect(c.textContent).not.toContain('沖銷完成了');
  });
});

describe('🔴 溢收 → 沖掉之後翻回正確態(R2 nit4:Sean 肉眼驗走的正是這條算術)', () => {
  it('應收 5000、已收 6800(溢收 1,800)⇒ 沖掉那筆 ⇒ 已收 0 ⇒ 還差 5,000', () => {
    const before = text({ status: 'ok', rows: [{ ...CASH, amount: 6800 }] }, 5000);
    expect(before).toContain('溢收 1,800 元');

    cleanup();
    const after = text(
      {
        status: 'ok',
        rows: [
          { ...CASH, amount: 6800 },
          { ...CASH, id: 'c2', amount: -6800, isReversal: true, reversesPaymentId: 'c1' },
        ],
      },
      5000,
    );
    // 🔴 這條分支既有格子沒走過(既有的只走「已收足 → 還差」)。
    expect(after).toContain('還差 5,000 元');
    expect(after).not.toContain('溢收');
    expect(after).not.toContain('已收足');
  });
});
