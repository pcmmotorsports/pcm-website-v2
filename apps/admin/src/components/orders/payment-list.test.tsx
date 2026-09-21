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
//    三者的輸入都是「沒有列可畫」,寫錯順序就會把載入失敗顯示成「這單沒收過錢」,
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
    <PaymentList data={data} amountDue={amountDue} refundedTotal={0} cancelled={false} orderId={ORDER_ID} returnTo={RETURN_TO} />,
  );
const text = (data: PaymentListData, amountDue: number = DEFAULT_DUE): string =>
  view(data, amountDue).container.textContent ?? '';

// 🔴🔴 **[2026-09-16 Sean 拍【乙】· 對抗審查 M1 / C5]**
//   「系統算不出這張單取消後還該收多少」與「收款紀錄讀不到」**都會**讓彙總是 `unknown`,
//   而它們要員工做的事**相反**:前者重整幾次都不會變(要人工計算), 後者重整就好。
//   ⛔ 不分開的話, 這一態會印「(收款或退款明細沒載入)請重新整理」—— **那是錯的指示**。
//   🧬 **突變(一次只拿掉一處,分開跑)** —— 本元件有【兩個】版面,各有一處 `amountUncomputable ?` 早退:
//     · `payment-list.tsx:360`(卡片版,明細頁)⇒ 拿掉 ⇒ 下面第 1 格紅。
//     · `payment-list.tsx:336`(**dialog 版**,列表頁「新增收款」彈窗)⇒ 拿掉 ⇒ 下面第 3 格紅。
//   🔴 **這段自述的第一版寫「那兩處拿掉 ⇒ 這兩格紅」,而那是假的** —— 當時只有卡片版有格,
//     dialog 版拿掉照樣全綠。R2 抓到的。📌 **一份沒有人驗過的突變自述,比沒有覆蓋更糟:
//     它讓下一個人以為這裡守住了。** ⇒ 現在三格,兩處各自對應得到,突變一次只動一處。
describe('算不出來 ≠ 讀不到(兩者都讓彙總是 unknown)', () => {
  const rows = { status: 'ok', rows: [ROW] } as PaymentListData;

  it('🔴 卡片版:印「算不出來、請人工計算」, 而【不得】印「沒載入」', () => {
    const { container } = render(
      <PaymentList
        data={rows}
        amountDue={null}
        amountUncomputable
        refundedTotal={0}
        cancelled={false}
        orderId={ORDER_ID}
        returnTo={RETURN_TO}
      />,
    );
    const t = container.textContent ?? '';
    expect(t).toContain('算不出');
    expect(t).toContain('人工計算');
    expect(t).not.toContain('沒載入');
  });

  it('🟢 負對照:同樣是 unknown 但【不是】算不出來 ⇒ 仍要印原本那句「沒載入」', () => {
    // 沒有這一格, 上面那格可以靠「永遠印算不出來」通過, 而真的讀不到時員工會被叫去人工計算。
    const { container } = render(
      <PaymentList
        data={rows}
        amountDue={null}
        refundedTotal={0}
        cancelled={false}
        orderId={ORDER_ID}
        returnTo={RETURN_TO}
      />,
    );
    const t = container.textContent ?? '';
    expect(t).toContain('沒載入');
    expect(t).not.toContain('人工計算');
  });

  // 🔴 **[R2 N-2]** dialog 版是**員工實際登收款那條路**(列表頁「新增收款」彈窗)——
  //    它有自己的一處早退(`:336`),而在本格加進來之前**零覆蓋**:拿掉它照樣全綠。
  it('🔴 dialog 版(列表頁彈窗)也要印「算不出來」—— 它有自己的一處早退', () => {
    const { container } = render(
      <PaymentList
        data={rows}
        amountDue={null}
        amountUncomputable
        refundedTotal={0}
        cancelled={false}
        orderId={ORDER_ID}
        returnTo={RETURN_TO}
        layout='dialog'
      />,
    );
    const t = container.textContent ?? '';
    expect(t).toContain('算不出');
    expect(t).toContain('人工計算');
    expect(t).not.toContain('沒載入');
  });
});

describe('三態分得開', () => {
  it('載入失敗 ⇒ 明說「無法確認已登記的款項」且叫他不要再登一筆', () => {
    const t = text({ status: 'unreadable' });
    expect(t).toContain('載入失敗');
    expect(t).toContain('無法確認已登記的款項');
    expect(t).toContain('重複入帳');
    // 🔴 不可顯示「0 筆」—— 那是這一族最短的一句謊話。
    expect(t).toContain('筆數未知');
    expect(t).not.toContain('0 筆');
    // 也不可同時說「尚未登錄任何收款」。
    expect(t).not.toContain('尚未登錄任何收款');
  });

  it('訂單不存在 ⇒ 說查不到訂單,不是說沒收款', () => {
    const t = text({ status: 'order_not_found' });
    expect(t).toContain('找不到此訂單');
    expect(t).not.toContain('尚未登錄任何收款');
    expect(t).toContain('筆數未知');
  });

  it('真的零筆 ⇒ 「尚未登錄任何收款」+「0 筆」', () => {
    const t = text({ status: 'ok', rows: [] });
    expect(t).toContain('尚未登錄任何收款');
    expect(t).toContain('0 筆');
    expect(t).not.toContain('載入失敗');
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

  // 🔴 Sean 2026-09-05 `Q-多匯 = 乙`(逐字):狀態不翻, 而單上要標「待人工」。
  //    🛑 這一格與上一格【分開】—— 它們釘的是兩個不同的拍板(08-12 的金額 / 09-05 的待人工),
  //      而合成一格會讓「其中一個被刪掉」不留痕跡。
  it('🔴 溢收 ⇒ 同時標「多付, 待人工」(Sean 2026-09-05 Q-多匯=乙)', () => {
    const t = text({ status: 'ok', rows: [{ ...ROW, amount: 6800 }] }, 5000);
    expect(t).toContain('多付, 待人工');
    // 🟢 而那三個字【只在溢收時】出現 —— 少了這一格, 一個無條件印它的版本會全綠。
    const settled = text({ status: 'ok', rows: [{ ...ROW, amount: 5000 }] }, 5000);
    expect(settled).not.toContain('多付, 待人工');
    const short = text({ status: 'ok', rows: [{ ...ROW, amount: 3000 }] }, 5000);
    expect(short).not.toContain('多付, 待人工');
  });

  // ⟦Q1 甲⟧ Sean 2026-09-16:「取消完顯示『多收 5,080 待退』，退完顯示『已收足』，另外加一行『待退款 X 元（已開，尚未退）』」
  //   鑽機 PCM-2026-1009:收 14,300、部分取消 5,080 ⇒ 應收 9,220。
  const cancelView = (opts: { refunded: number; pending: number | null; cancelled?: boolean; due?: number; paid?: number }) =>
    render(
      <PaymentList
        data={{ status: 'ok', rows: opts.paid === 0 ? [] : [{ ...ROW, amount: opts.paid ?? 14300 }] }}
        amountDue={opts.due ?? 9220}
        refundedTotal={opts.refunded}
        cancelled={opts.cancelled ?? false}
        cancelAdjusted
        openPendingRefund={opts.pending}
        orderId={ORDER_ID}
        returnTo={RETURN_TO}
      />,
    ).container.textContent ?? '';

  it('⟦Q1 甲⟧ 部分取消還沒退 ⇒「多收 5,080 待退」+ 待退款那一行;不印溢收 / 多付, 待人工 / 還差', () => {
    const t = cancelView({ refunded: 0, pending: 5080 });
    expect(t).toContain('應收 9,220 元 / 已收 14,300 元');
    expect(t).toContain('多收 5,080 待退');
    expect(t).toContain('待退款 5,080 元（已開，尚未退）');
    expect(t).not.toContain('溢收');
    expect(t).not.toContain('多付, 待人工');
    expect(t).not.toContain('還差');
  });

  it('⟦Q1 甲⟧ 退完 ⇒「已收足」,待退款結清後那一行消失;讀不到待退款(null)也不印', () => {
    const t = cancelView({ refunded: 5080, pending: 0 });
    expect(t).toContain('應收 9,220 元 / 已收 9,220 元');
    expect(t).toContain('已收足');
    expect(t).not.toContain('待退');
    expect(cancelView({ refunded: 0, pending: null })).not.toContain('待退款');
  });

  it('⟦Q1 甲⟧ 整單取消:收過錢退完 ⇒ 已收足;一毛沒收過 ⇒ 不印「已收足」', () => {
    expect(cancelView({ refunded: 14300, pending: 0, cancelled: true, due: 0 })).toContain('已收足');
    const unpaid = cancelView({ refunded: 0, pending: 0, cancelled: true, due: 0, paid: 0 });
    expect(unpaid).toContain('應收 0 元 / 已收 0 元');
    expect(unpaid).not.toContain('已收足');
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

// ── B17(2026-09-14):dialog 版面確認勾**下面那一行**的「目前收款情形：…」摘要 ──────────────
// 由本元件手上那份 summary 算(不新開 toPaymentSummary 呼叫端);三個反例是 codex R1 must-fix 逐字給的。
// 🔴 2026-09-16 訂正標題:原本寫「確認勾那句『我看過這張單已收的(…)』」—— 那句話**已經不存在**
//    (Sean 走查說看不懂 ⇒ 拆成動作句 + 狀態行,狀態行也移出 `<label>`)。
//    📌 標題留著舊字面 ⇒ 下一個人會照著去 grep 一個找不到的東西。
describe('B17 dialog 版面:確認勾下面那行狀態摘要', () => {
  // 🔴🔴 **[2026-09-16 · 8d 窗的標本,而這支 helper 是現行犯]**
  //   8d 逐字:「**表達不出來的世界,突變也突變不到** —— 因為那個突變產生的行為差異,
  //   在所有既有 fixture 上都是零。」
  //   本 helper 原本有兩個洞,而它們讓兩種世界**寫不出來**:
  //   ① `cancelledUnknown` 不在參數列 —— 那一族**真的有一格在測它**,而那一格是
  //      **另外手寫一整個 `render` 繞過本 helper**(見下面「取消狀態讀不到」那格的歷史)。
  //      📌 **一個繞過 helper 手寫的 fixture,就是這面牆的收據** —— 它不會紅、不會警告,
  //         只是靜靜告訴下一個人「這條路走不通,自己想辦法」,而下一個人多半就不測了。
  //   ② `renderForm={(n) => …}` **只拿第一個參數** ⇒ 2026-09-16 新增的第三個參數
  //      (「帶入尾款」那顆鈕要填的數字)**接不到** ⇒ 把那顆鈕的判準改成恆真恆假,
  //      這一族**一格都不會紅**。
  //   ⇒ **先拆 helper 再寫斷言**,不是先寫斷言再遷就 helper —— 順序反過來的話,
  //     寫的人會不自覺地只測 helper 造得出來的世界,然後回報「六格全綠」。
  // 🔴 `amountDue` 收 `number | null` —— **`null` 是「算不出來」那個世界的唯一入口**。
  //    ⚠️ 我第一版把它寫成 `number`,然後在下面那格**繞過本 helper 手寫了一個 `render`**
  //       —— 就寫在上面那段「繞過 helper 就是收據」的註解**下面幾行**。
  //    📌 那不是巧合:**牆擋住你的那一刻,繞過去永遠比拆掉便宜。** 這一行就是拆掉的成本。
  // 🔴🔴 **第五次,而且又是這支 helper**:`refundedTotal` 原本**寫死 `0`**
  //    ⇒ 「這張單退過款」那個世界**造不出來**。而那正是 2026-09-16 抓到的第四個洞所在:
  //    退款還在 `processing`(錢可能還沒出去)⇒ 淨額已收偏低 ⇒ 差額變大
  //    ⇒ 一顆「帶入尾款」的鈕會叫員工**多收客人的錢**。
  //    📌 **那一格當時 153 格全綠** —— 因為沒有任何一格造得出那個世界。
  //    ⇒ 8d 2026-09-16 那句的第五次:**表達不出來的世界,突變也突變不到。**
  const renderDialog = (
    rows: OrderPaymentRow[],
    amountDue: number | null,
    opts: {
      cancelled?: boolean;
      cancelledUnknown?: boolean;
      refundedTotal?: number | null;
      /**
       * 🔴 **[對抗審查 nice-to-have ③]** 明細讀不到那兩態(`unreadable` / `order_not_found`)
       *    原本**這一族表達不出來** —— `data` 是寫死的 `{status:'ok'}`。
       *    今天它們靠 `payment-list.tsx` 的 `if (rows !== null …)` fail-closed,而**哪天有人
       *    把 `fillableDue` 的計算移出那個 if,這一族一格都不會紅。**
       * 📌 這是同一支 helper **第三次**為同一個理由拆牆(前兩次:`cancelledUnknown`、`refundedTotal`)。
       *    ⇒ 一面被拆過三次的牆,說明的不是運氣不好,是**一開始就不該把世界寫死在 helper 裡**。
       */
      data?: PaymentListData;
    } = {},
  ) =>
    render(
      <PaymentList
        data={opts.data ?? { status: 'ok', rows }}
        amountDue={amountDue}
        refundedTotal={opts.refundedTotal === undefined ? 0 : opts.refundedTotal}
        cancelled={opts.cancelled ?? false}
        cancelledUnknown={opts.cancelledUnknown ?? false}
        orderId={ORDER_ID}
        returnTo={RETURN_TO}
        layout='dialog'
        renderForm={(n, _h, fill) => (
          <>
            <p data-testid='note'>{n ?? 'undefined'}</p>
            <p data-testid='fill'>{fill === null ? 'null' : String(fill)}</p>
          </>
        )}
      />,
    );
  const note = (rows: OrderPaymentRow[], amountDue: number, cancelled = false): string | undefined =>
    renderDialog(rows, amountDue, { cancelled }).getByTestId('note').textContent ?? undefined;
  /**
   * 「帶入尾款」那顆鈕拿到的數字;`'null'` = 不畫那顆鈕。
   * 🔴 **`opts` 的形狀要跟 `renderDialog` 同步** —— 我第一版只在 `renderDialog` 加了
   *    `refundedTotal`,**忘了這一層** ⇒ 那個世界從這個入口仍然表達不出來。
   *    📌 **拆牆只拆一半,牆還是在。** 這次是 typecheck 抓到的(`TS2353`),
   *       而前幾次同族的沒有型別在守 ⇒ **靜靜全綠**。有型別守著的那一半是幸運的那一半。
   */
  const fillable = (
    rows: OrderPaymentRow[],
    amountDue: number | null,
    opts: Parameters<typeof renderDialog>[2] = {},
  ): string => renderDialog(rows, amountDue, opts).getByTestId('fill').textContent ?? '';
  const pay = (id: string, amount: number, receivedAt: string, extra: Partial<OrderPaymentRow> = {}): OrderPaymentRow => ({
    ...ROW, id, rail: 'bank_transfer', recTradeId: null, amount, receivedAt, ...extra,
  });

  it('零筆 ⇒ 還沒登過 · 尾款 = 應收', () => {
    expect(note([], 1000)).toBe('還沒登過 · 尾款 NT$1,000');
  });
  it('🔴 收 500 → 沖銷 → 再沖銷(錢回來了)⇒ 不能印「還沒登過」,金額沿用彙總', () => {
    const rows = [
      pay('a', 500, '2026-09-09T00:00:00+00:00'),
      pay('b', -500, '2026-09-10T00:00:00+00:00', { isReversal: true, reversesPaymentId: 'a' }),
      pay('c', 500, '2026-09-11T00:00:00+00:00', { isReversal: true, reversesPaymentId: 'b' }),
    ];
    const n = note(rows, 1000)!;
    expect(n).not.toContain('還沒登過');
    expect(n).toContain('累計收 500');
    expect(n).toContain('尾款 NT$500');
  });
  it('🔴 最近收款日要是【最新】那筆,不是列表順序的最後一筆', () => {
    const rows = [
      pay('b', 600, '2026-09-12T00:00:00+00:00'),
      pay('a', 500, '2026-09-09T00:00:00+00:00'),
    ];
    // receivedAtShort 對匯款(帶時分)印「MM/DD HH:mm」,只驗日期那半
    const n = note(rows, 1100)!;  // 一次 render(同格 render 兩次會撞同一個 testid)
    expect(n).toMatch(/^最近 09\/12/);
    expect(n).toContain('累計收 1,100 · 已收足');
  });
  // 🔵 **本格 2026-09-16 收回 helper** —— 它原本是整段手寫的 `render`,因為當時的 helper
  //    沒有 `cancelledUnknown` 那個參數。那就是上面註解講的「收據」:牆還在,只是有人繞過去了。
  //    ⇒ 現在參數列有它,這格不必再繞。**斷言一個字沒改。**
  it('🔴 取消狀態讀不到(明細那發失敗)⇒ 不當成沒取消、不印「尾」', () => {
    const n = renderDialog([pay('a', 1, '2026-09-09T00:00:00+00:00')], 1200, { cancelledUnknown: true })
      .getByTestId('note').textContent!;
    expect(n).toContain('取消狀態讀不到');
    expect(n).not.toMatch(/尾 \d/);  // 沒有「尾 <數字>」
  });
  it('🔴 已取消的單不印「尾」', () => {
    const n = note([pay('a', 1, '2026-09-09T00:00:00+00:00')], 1200, true)!;
    expect(n).toContain('已取消');
    expect(n).not.toContain('尾');
  });

  // ── 🔴🔴 [2026-09-16 Sean 走查第 2 件]「帶入尾款」那顆鈕拿到的數字 ──────────────────
  //   📌 判準一句話:**看得到鈕 = 真的還差錢。**
  //   🛑 而這一族真正在守的是**哪一個數字**:`gap`(還差多少)不是 `due`(應收總額)。
  //      帶錯 ⇒ 收過訂金的單會被再收一次全額,而那正是確認勾在防的事(重複入帳)
  //      ⇒ **一顆帶錯數字的鈕會繞過那道勾**:勾了也擋不住,因為金額本身就是錯的。
  describe('帶入尾款的數字', () => {
    const one = (amount: number) => [pay('a', amount, '2026-09-09T00:00:00+00:00')];

    it('🔴 還差錢 ⇒ 給【還差多少】,不是應收總額', () => {
      // 應收 1000、已收 300 ⇒ 要 700。給 1000 的話他會再收一次全額。
      expect(fillable(one(300), 1000)).toBe('700');
    });

    it('🔴 一筆都沒收過 ⇒ 差額就是全額(而它仍然是 gap 算出來的,不是直接拿 due)', () => {
      expect(fillable([], 1000)).toBe('1000');
    });

    it('🔵 已收足 ⇒ 不畫(帶入 0 沒有意義)', () => {
      expect(fillable(one(1000), 1000)).toBe('null');
    });

    it('🔵 多收 ⇒ 不畫(他不該再收)', () => {
      expect(fillable(one(1500), 1000)).toBe('null');
    });

    it('🔴 算不出來 ⇒ 不畫 —— 型別上根本沒有 gap 這個欄位,沒有數字可帶', () => {
      // `amountDue` 為 null ⇒ `toPaymentSummary` 回 `{kind:'unknown'}`(`payment-list-view.ts:185`)。
      expect(fillable(one(300), null)).toBe('null');
    });

    it('🔴 已取消 ⇒ 不畫', () => {
      expect(fillable(one(300), 1000, { cancelled: true })).toBe('null');
    });

    it('🔴 取消狀態讀不到 ⇒ 不畫(我們【不知道】它取消了沒,就不該遞一個數字給他填)', () => {
      expect(fillable(one(300), 1000, { cancelledUnknown: true })).toBe('null');
    });

    // ── 🔴🔴 退過款的單(2026-09-16 主視窗裁甲)────────────────────────────────
    //   這一族**在加進來之前,上面 153 格全綠** —— 因為當時的 helper 把 `refundedTotal`
    //   寫死成 `0`,那個世界**造不出來**。⇒ 8d 那句的第五次。
    it('🔴 退過款 ⇒ 不畫 —— 退款可能還在途中,「還差多少」本身就不確定', () => {
      // 應收 1,000 · 收 1,000 · 退 300(可能還在 processing、錢沒出去)
      // ⇒ 淨額已收 700 ⇒ `short`、差額 300 ⇒ **沒有 `refundedTotal === 0` 那道條件的話,
      //    鈕會印「帶入尾款 NT$300」而員工按下去就多收了 300。**
      expect(fillable(one(1000), 1000, { refundedTotal: 300 })).toBe('null');
    });

    it('🟢 正對照:條件一模一樣但【沒退過款】⇒ 鈕在 —— 否則上一格可能是因為別的原因而綠', () => {
      expect(fillable(one(300), 1000, { refundedTotal: 0 })).toBe('700');
    });

    it('🔴 已退多少【算不出來】(null)⇒ 也不畫(兩層都擋:unknown 與退款條件)', () => {
      expect(fillable(one(300), 1000, { refundedTotal: null })).toBe('null');
    });

    // ── 🔴 [對抗審查 nice-to-have ③] 明細讀不到那兩態 ────────────────────────────
    //   這兩格**是那道剛拆開的牆的用途** —— 不補的話 `data` 那個參數沒有任何呼叫端,
    //   牆等於白拆。今天它們靠 `payment-list.tsx` 的 `if (rows !== null …)` fail-closed,
    //   而**哪天有人把計算移出那個 if,沒有這兩格就一格都不會紅。**
    it('🔴 收款明細讀不到(unreadable)⇒ 不畫 —— 不知道收過多少,就不該遞一個數字給他', () => {
      expect(fillable([], 1000, { data: { status: 'unreadable' } })).toBe('null');
    });

    it('🔴 查無訂單(order_not_found)⇒ 不畫(三態裡的第二態,別只測 unreadable)', () => {
      expect(fillable([], 1000, { data: { status: 'order_not_found' } })).toBe('null');
    });
  });
});

describe('🔴 B17:沖銷原因欄按 Enter 不得送出外層「新增收款」表單(codex R2 must-fix ②)', () => {
  it('Enter 被吃掉(preventDefault),外層 form 的 submit 不會被觸發', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const { getByRole, getByLabelText } = render(
      <form onSubmit={onSubmit}>
        <PaymentList data={{ status: 'ok', rows: [{ ...ROW, rail: 'bank_transfer', recTradeId: null }] }} amountDue={DEFAULT_DUE} refundedTotal={0} cancelled={false} orderId={ORDER_ID} returnTo={RETURN_TO} layout='dialog' renderForm={(_n, history) => <>{history}</>} />
        <input name='amount' defaultValue='100' />
      </form>,
    );
    fireEvent.click(getByRole('button', { name: '沖銷這一筆' }));
    const reason = getByLabelText('沖銷原因');
    // jsdom 不做「按 Enter 隱含送出」⇒ 直接量 defaultPrevented(codex R3 nit:拿掉攔截這格才會紅)。
    const prevented = !fireEvent.keyDown(reason, { key: 'Enter', code: 'Enter' });
    expect(prevented, 'Enter 沒被 preventDefault ⇒ 真瀏覽器會送出外層「新增收款」').toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
