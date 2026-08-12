// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import {
  paymentFailure,
  type PaymentActionState,
  type PaymentFormValues,
} from '../../../lib/orders/payment-action-state';

// payment-lifecycle.test.tsx — M-4b E10 #15-B2-c 片2b:**印章生命週期**整合測試。
//
// 🔴🔴 **本檔的觀察機制是硬規格,不是風格**(plan v4 §6a,折 Fable R3 F4):
//   ① 斷言對象一律是 **action 實際收到的 `FormData`**,不是畫面上的 hidden 值 ——
//      畫面對了而送出去的不對(或反過來)是這一族真正會出事的形狀。
//   ② **中途換 `stamp` prop**(模擬 revalidate 給了新章)。沒換過 prop 的「印章沒變」斷言
//      是**同值恆綠**:它連自己在測什麼都分不出來。三把章 A/B/C 讓每條路徑在數值上可辨識。
//   ③ 每個突變靶只准紅它宣稱的那一格;一個靶紅多格 = 斷言互相蘊含,要拆。
//
// 🔴 為什麼這件事值得一整個檔:換錯一次鍵 = RPC 的 G8 認不出這是重送 = **多一筆刪不掉的收款**
//   (`payment-action-state.ts:193-200` 逐字)。畫面上完全看不出來。

const actionMock = vi.fn<(prev: PaymentActionState, form: FormData) => Promise<PaymentActionState>>();
vi.mock('../../../lib/orders/payment-actions', () => ({
  recordManualPaymentAction: (prev: PaymentActionState, form: FormData) => actionMock(prev, form),
}));

import { PaymentRecordForm } from '../../../components/orders/payment-record-form';
import { PaymentSection } from '../../../components/orders/payment-section';
// 🔴 **真的那支**,不是 mock:S5 要驗的是「server 清空規則 × client 重鑄」這兩端的契約。
import { carryBackPaymentValues } from '../../../lib/orders/payment-form';

const ORDER_A = '3f2f2c1e-0000-4000-8000-00000000000a';
const ORDER_B = '3f2f2c1e-0000-4000-8000-00000000000b';
const RETURN_TO = '/orders?payment_status=paid';

/** 三把互不相同的章。🔴 值本身要看得出來是哪一把 —— 斷言失敗時才讀得懂。 */
const STAMP_A = {
  requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  cashReceivedAt: '2026-08-12T01:00:00.000Z',
};
const STAMP_B = {
  requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  cashReceivedAt: '2026-08-12T02:00:00.000Z',
};
const STAMP_C = {
  requestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  cashReceivedAt: '2026-08-12T03:00:00.000Z',
};

function failureValues(stamp: { requestId: string; cashReceivedAt: string }): PaymentFormValues {
  return {
    rail: 'bank_transfer',
    amount: '1000',
    receivedDate: '2026-08-12',
    bankReference: 'CTBC-1',
    payerNote: '',
    requestId: stamp.requestId,
    cashReceivedAt: stamp.cashReceivedAt,
  };
}

function form(container: HTMLElement): HTMLFormElement {
  const el = container.querySelector('form');
  if (el === null) throw new Error('沒有 form');
  return el;
}

/**
 * 勾確認閘。🔴 **勾完必須斷言送出鈕真的啟用了**(codex 關卡2 MF2):
 * 下面所有序列都用 `fireEvent.submit(form)` 送出,而那條路**繞過 disabled 屬性**
 * ⇒ 少了這一行,「重勾之後閘卡在停用」這個 bug 會讓每一格照樣綠。
 */
function arm(container: HTMLElement) {
  // 🔴 **確保勾起來,不是切換** —— 第一版寫 `fireEvent.click` 無條件點下去,
  //    而失敗態**不會**清掉勾選(只有「開始下一筆」會)⇒ 第二次呼叫等於把它取消勾。
  //    (這個 bug 是 codex MF2 那條斷言補上去之後才現形的:在那之前,
  //     `fireEvent.submit(form)` 繞過 disabled ⇒ 沒勾也送得出去 ⇒ 全綠。)
  const box = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  if (!box.checked) fireEvent.click(box);
  const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit === null) throw new Error('找不到送出鈕');
  if (submit.disabled) throw new Error('勾了確認閘之後送出鈕仍然停用 —— 閘卡死了');
}

/** 送出一次,回傳 action **實際收到**的那份 FormData。 */
async function submitAndCapture(container: HTMLElement): Promise<FormData> {
  const before = actionMock.mock.calls.length;
  fireEvent.submit(form(container));
  await waitFor(() => {
    if (actionMock.mock.calls.length <= before) throw new Error('action 還沒被呼叫');
  });
  return actionMock.mock.calls[actionMock.mock.calls.length - 1]![1];
}

/** 讓表單走進某個失敗態(並等它真的到畫面上)。 */
async function failWith(
  container: HTMLElement,
  code: 'error' | 'rejected' | 'invalid',
  values: PaymentFormValues,
) {
  actionMock.mockResolvedValue(paymentFailure(code, values));
  arm(container);
  await submitAndCapture(container);
  await waitFor(() => {
    if (!container.textContent?.includes('沒有寫入') && !container.textContent?.includes('可能已經寫進去了') && !container.textContent?.includes('不能登錄收款')) {
      throw new Error('失敗訊息還沒出現');
    }
  });
}

function renderForm(stamp = STAMP_A, detailsReadable = true) {
  return render(
    <PaymentRecordForm
      orderId={ORDER_A}
      returnTo={RETURN_TO}
      stamp={stamp}
      detailsReadable={detailsReadable}
    />,
  );
}

beforeEach(() => {
  actionMock.mockReset();
  actionMock.mockResolvedValue({ status: 'idle' });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('S1 / S6:失敗 → revalidate 換了新章 → 重送,送出的仍是舊章', () => {
  // 🔴 這是整條線最貴的一格:`'error'` 的定義是「RPC **可能已經 commit**、回應斷在路上」
  //    ⇒ 重送若帶新鍵,G8 認不出是重送 ⇒ 第二筆收款。
  // 靶:把印章改成讀受控 `values`(而非 `state`)⇒ 失敗後第一次 render 兩格是空的
  //    ⇒ 落回 `stamp` prop(此時已是 B)⇒ 本格紅。
  it('送出去的 request_id / cash_received_at 等於失敗那次的舊章,不是新 prop', async () => {
    const { container, rerender } = renderForm(STAMP_A);
    await failWith(container, 'error', failureValues(STAMP_A));

    // revalidate:server 重渲染、給了一把新章。
    rerender(
      <PaymentRecordForm
        orderId={ORDER_A}
        returnTo={RETURN_TO}
        stamp={STAMP_B}
        detailsReadable
      />,
    );

    actionMock.mockResolvedValue({ status: 'idle' });
    arm(container);
    const sent = await submitAndCapture(container);
    expect(sent.get('request_id')).toBe(STAMP_A.requestId);
    expect(sent.get('cash_received_at')).toBe(STAMP_A.cashReceivedAt);
    // 前提自斷言:新章真的不同 —— 兩把章相同的話上面兩條恆真。
    expect(STAMP_B.requestId).not.toBe(STAMP_A.requestId);
  });

  // S6:失敗後**還沒做任何互動**的那一刻,畫面上掛的就已經是舊章
  //    (不是「effect 跑完才對」)。量的是 DOM,配合上面那格量 FormData,兩個面都蓋到。
  it('失敗後未經任何互動,hidden 值就已經是舊章', async () => {
    const { container, rerender } = renderForm(STAMP_A);
    await failWith(container, 'error', failureValues(STAMP_A));
    rerender(
      <PaymentRecordForm orderId={ORDER_A} returnTo={RETURN_TO} stamp={STAMP_B} detailsReadable />,
    );
    expect(new FormData(form(container)).get('request_id')).toBe(STAMP_A.requestId);
  });
});

describe('S4 / S7 / S11:「開始下一筆」釘住當下那組,之後 revalidate 不影響', () => {
  // 🔴 三個靶一次打完,但斷言分三條、各自對應一個靶:
  //   · 送出的**不是** A(舊鍵)⇒ 靶 = 拿掉 D1 的 dismissed 閘(S11)
  //   · 送出的**是** B(按鈕那一刻那組)⇒ 靶 = 按鈕改成只清空不釘住(S4)
  //   · 送出的**不是** C(按完之後 revalidate 又換的)⇒ 靶 = 拿掉 pin(S7)
  it('按鈕之後再 revalidate 一次,送出的仍是按鈕當下那把', async () => {
    const { container, rerender } = renderForm(STAMP_A);
    await failWith(container, 'error', failureValues(STAMP_A));

    // revalidate #1:prop 換成 B。此時畫面上仍是 A(S1 已證)。
    rerender(
      <PaymentRecordForm orderId={ORDER_A} returnTo={RETURN_TO} stamp={STAMP_B} detailsReadable />,
    );

    // 員工按「開始下一筆」⇒ 釘住 B、dismiss 掉那個 failed state。
    const nextButton = container.querySelector('button[type="button"]');
    expect(nextButton).not.toBeNull();
    fireEvent.click(nextButton!);

    // revalidate #2:prop 又換成 C。釘住的 B 不該被它蓋掉。
    rerender(
      <PaymentRecordForm orderId={ORDER_A} returnTo={RETURN_TO} stamp={STAMP_C} detailsReadable />,
    );

    actionMock.mockResolvedValue({ status: 'idle' });
    arm(container);
    const sent = await submitAndCapture(container);
    expect(sent.get('request_id')).not.toBe(STAMP_A.requestId); // S11
    expect(sent.get('request_id')).toBe(STAMP_B.requestId); // S4
    expect(sent.get('request_id')).not.toBe(STAMP_C.requestId); // S7
  });

  // S10:按完鈕之後確認閘要**重新武裝** —— 按鈕不是全新掛載,不顯式重設的話
  //     上一筆勾的那格會延用到下一筆,而下一筆正是最需要他再對一次明細的時候。
  it('按完「開始下一筆」之後,送出鈕重新變回停用', async () => {
    const { container } = renderForm(STAMP_A);
    await failWith(container, 'error', failureValues(STAMP_A));
    // failWith 內已經勾過一次 ⇒ 此刻是啟用的(前提自斷言)。
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(
      false,
    );
    fireEvent.click(container.querySelector('button[type="button"]')!);
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  });
});

describe('D4:「開始下一筆」只在不能排除已寫入的碼出現', () => {
  it.each([
    ['error', true],
    ['rejected', true],
    ['invalid', false],
  ] as const)('%s → 鈕出現 = %s', async (code, shown) => {
    const { container } = renderForm(STAMP_A);
    const values =
      code === 'invalid'
        ? { ...failureValues(STAMP_A), requestId: '', cashReceivedAt: '' }
        : failureValues(STAMP_A);
    await failWith(container, code, values);
    expect(container.querySelector('button[type="button"]') !== null).toBe(shown);
  });
});

describe('S5:印章自己壞掉(invalid)⇒ 兩格清空 ⇒ 重鑄', () => {
  // 🔴 `payment-form.ts:215-220` 逐字:`invalid` 那條路的 payload 依定義是壞的,
  //    `carryBackPaymentValues` 會把整組印章清空,讓本層重鑄。
  //    靶 = 改成沿用壞印章 ⇒ 表單被鎖死(每次送出又都因印章不合法判 invalid)⇒ 本格紅。
  //
  // 🔴🔴 **空印章不是我捏的,是真的跑出來的**(codex 關卡2 MF3):第一版直接在 mock 裡寫
  //    `requestId: ''`,等於**我自己假設了 server 會清空** —— 那條「壞一格就兩格一起清」的規則
  //    要是被改掉,本格照樣綠,而正式站的表單會卡死在壞鍵上。
  //    ⇒ 改成把**真的** `carryBackPaymentValues` import 進來,餵它一份壞掉的 payload,
  //      用它**實際吐出來**的值當 state。這樣兩端的契約才有人守。
  it('清空後的重送用的是新章,不是空字串', async () => {
    const brokenPayload = new FormData();
    brokenPayload.set('rail', 'bank_transfer');
    brokenPayload.set('amount', '1000');
    brokenPayload.set('received_date', '2026-08-12');
    brokenPayload.set('bank_reference', 'CTBC-1');
    brokenPayload.set('payer_note', '');
    brokenPayload.set('request_id', STAMP_A.requestId);
    brokenPayload.set('cash_received_at', '不是 ISO 時點'); // 壞掉的是這一格
    const carried = carryBackPaymentValues(brokenPayload);
    // 前提自斷言:真的規則把**兩格一起**清了(只清壞的那格 = 本格失去意義)。
    expect(carried.requestId).toBe('');
    expect(carried.cashReceivedAt).toBe('');

    const { container, rerender } = renderForm(STAMP_A);
    await failWith(container, 'invalid', carried);
    rerender(
      <PaymentRecordForm orderId={ORDER_A} returnTo={RETURN_TO} stamp={STAMP_B} detailsReadable />,
    );
    actionMock.mockResolvedValue({ status: 'idle' });
    arm(container);
    const sent = await submitAndCapture(container);
    expect(sent.get('request_id')).toBe(STAMP_B.requestId);
    expect(sent.get('cash_received_at')).toBe(STAMP_B.cashReceivedAt);
  });
});

describe('S8:失敗之後員工改得動金額', () => {
  // 🔴 靶 = 拿掉「每個新 failed state 同步一次受控欄位」⇒ 帶回來的值不會被任何一次 render 消費
  //    ⇒「保留員工輸入」變成空頭支票(`receipt-record-form.tsx:82-85` 立過同一條)。
  it('帶回來的金額出現在欄位裡,而且改得動、改完的值真的送出去', async () => {
    const { container } = renderForm(STAMP_A);
    await failWith(container, 'error', failureValues(STAMP_A));
    const amount = container.querySelector<HTMLInputElement>('input[name="amount"]')!;
    // 🔴 **等的必須是欄位值本身,不能拿「失敗訊息出現了」當代理**:訊息是 `state` 驅動的、
    //    同一次 render 就到;欄位值要等 `useEffect` 同步,**晚一拍**。第一版拿訊息當代理
    //    ⇒ 全套跑(機器忙)時真的抓到中間那一拍、`''` vs `'1000'` 紅過一次。
    //    ⓘ 順帶:只有這一格會飄,因為只有它依賴 effect ——
    //      印章那幾格直接讀 `state`,結構上沒有這個窗口(那正是 D1 改讀 `state` 的理由)。
    await waitFor(() => {
      if (amount.value !== '1000') throw new Error(`欄位還沒同步(現在是 '${amount.value}')`);
    });

    fireEvent.change(amount, { target: { value: '2500' } });
    actionMock.mockResolvedValue({ status: 'idle' });
    arm(container);
    const sent = await submitAndCapture(container);
    expect(sent.get('amount')).toBe('2500');
    // 改了金額但**鍵不變** —— 那正是 G8 會擋下來的情境,擋下來才對(換鍵才會變第二筆)。
    expect(sent.get('request_id')).toBe(STAMP_A.requestId);
  });
});

describe('S2:換單必須換掉整個表單實例(key={orderId})', () => {
  // 🔴 冪等鍵的作用域是**這張單**(`payment-action-state.ts:24-28` 逐字:
  //    同一把鍵用在另一張單上 DB 擋不到,會是兩筆各自成立的收款)。
  //    靶 = 拿掉 `PaymentSection` 的 `key={orderId}` ⇒ A 單的失敗態(連同它的舊鍵)
  //    會被帶到 B 單 ⇒ 本格紅。
  it('A 單失敗後導覽到 B 單,送出的不是 A 單那把鍵', async () => {
    const payments = { status: 'ok', rows: [] } as const;
    const { container, rerender } = render(
      <PaymentSection orderId={ORDER_A} returnTo={RETURN_TO} payments={payments} />,
    );
    await failWith(container, 'error', failureValues(STAMP_A));

    rerender(<PaymentSection orderId={ORDER_B} returnTo={RETURN_TO} payments={payments} />);

    actionMock.mockResolvedValue({ status: 'idle' });
    arm(container);
    const sent = await submitAndCapture(container);
    expect(sent.get('order_id')).toBe(ORDER_B);
    expect(sent.get('request_id')).not.toBe(STAMP_A.requestId);
    // 前提自斷言:送出的鍵是**有值的 uuid**,不是「因為沒渲染所以是 null」那種假通過。
    expect(String(sent.get('request_id'))).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('S3:明細讀不到 ⇒ 表單留著、只停用送出', () => {
  // 🔴 靶 = 改回「讀不到就卸載表單」⇒ 卸載會銷毀 `state` 裡那組唯一的舊印章,
  //    重新掛載 = 新印章 = 重複入帳那條路 ⇒ 本格紅。
  it.each(['unreadable', 'order_not_found'] as const)('%s:表單在、送出停用', (status) => {
    const { container } = render(
      <PaymentSection orderId={ORDER_A} returnTo={RETURN_TO} payments={{ status }} />,
    );
    expect(container.querySelector('form')).not.toBeNull();
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true);
  });

  // 🔴🔴 **兩段文案不得在同一個畫面上各說各話**(片2a code-reviewer must-fix 1)。
  //    失敗訊息(`error`)逐字說「先不要重新整理」,而明細讀不到那段原本無條件說「請先重新整理」——
  //    兩個條件**同時為真**的情境是真的會發生的:送出失敗之後那次 revalidate 的明細讀取也掛掉。
  //    員工照後者去重整 ⇒ 表單重掛拿到新章 ⇒ G8 認不出是重送 ⇒ **第二筆入帳**。
  //    🔴 這格量的是**整個表單此刻的可見文字**(兩段都在裡面),不是分別去看某一段 ——
  //      「互相矛盾」本來就只有把兩段放在一起看才成立。
  it('失敗態 + 明細讀不到:畫面上不得出現叫他「重新整理」的話', async () => {
    const ok = { status: 'ok', rows: [] } as const;
    const { container, rerender } = render(
      <PaymentSection orderId={ORDER_A} returnTo={RETURN_TO} payments={ok} />,
    );
    await failWith(container, 'error', failureValues(STAMP_A));
    // 前提自斷言:失敗訊息真的在畫面上(否則下面等於在空畫面上驗「沒有那四個字」)。
    expect(container.textContent).toContain('可能已經寫進去了');

    rerender(
      <PaymentSection orderId={ORDER_A} returnTo={RETURN_TO} payments={{ status: 'unreadable' }} />,
    );
    const text = container.querySelector('form')!.textContent ?? '';
    expect(text).toContain('可能已經寫進去了'); // 失敗訊息還在 ⇒ 兩段確實同框
    // 🔴 禁的是**祈使句**(叫他去做),不是「重新整理」這四個字本身 ——
    //    失敗訊息裡「重新整理會換一把新的鍵」是**解釋後果**,那句要留著,它正是勸阻的理由。
    //    (第一版寫成 `/(?<!不要)重新整理/` 把解釋句一起禁掉了,實跑時被自己抓下來。)
    expect(text).not.toContain('請先重新整理');
    expect(text).not.toContain('請重新整理');
  });

  // 對照組:**沒有**活的失敗態時,叫他重新整理是對的(這時重掛不會害到任何東西)。
  // 🔴 少了這格,上面那條可以用「把兩段字都刪光」通過 —— 那不是修好,是把話說沒了。
  it('沒有失敗態、只是明細讀不到:仍然要叫他重新整理', () => {
    const { container } = render(
      <PaymentSection orderId={ORDER_A} returnTo={RETURN_TO} payments={{ status: 'unreadable' }} />,
    );
    expect(container.querySelector('form')!.textContent).toContain('請先重新整理');
  });

  // 🔴🔴 **這一格才是 D3 真正的驗收**(codex 關卡2 MF1 補的):上面兩格只證明「表單還看得到」,
  //    而 D3 存在的理由是「**舊鍵要活下來**」—— 表單被卸載重掛的話畫面上一樣有一張表單,
  //    差別是它帶著一把**新鍵**,而那正是重複入帳那條路。兩者在「表單在不在」這個觀察點上
  //    **不可分辨**,只有把鍵撈出來比才分得出。
  //    序列 = 真實災難:送出失敗(可能已寫入)→ 明細那次讀取也掛了 → 下一次 render 明細回來了。
  it('失敗後明細一度讀不到、再恢復 —— 送出的仍是失敗那次的舊鍵', async () => {
    const ok = { status: 'ok', rows: [] } as const;
    const { container, rerender } = render(
      <PaymentSection orderId={ORDER_A} returnTo={RETURN_TO} payments={ok} />,
    );
    await failWith(container, 'error', failureValues(STAMP_A));

    rerender(
      <PaymentSection orderId={ORDER_A} returnTo={RETURN_TO} payments={{ status: 'unreadable' }} />,
    );
    // 讀不到的那一刻送不出去(前提自斷言:閘真的關了,不然下面的恢復沒有意義)。
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);

    rerender(<PaymentSection orderId={ORDER_A} returnTo={RETURN_TO} payments={ok} />);

    actionMock.mockResolvedValue({ status: 'idle' });
    arm(container);
    const sent = await submitAndCapture(container);
    expect(sent.get('request_id')).toBe(STAMP_A.requestId);
    expect(sent.get('cash_received_at')).toBe(STAMP_A.cashReceivedAt);
  });
});
