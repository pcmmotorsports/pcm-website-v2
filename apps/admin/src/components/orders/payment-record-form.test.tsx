// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import {
  paymentFailure,
  type PaymentActionState,
  type PaymentFormValues,
} from '../../lib/orders/payment-action-state';

// payment-record-form.test.tsx — M-4b E10 #15-B2-c 片2a:表單接線 smoke test。
// 🔴 mock 掉 server action 模組(transitively 拉 next/cache 與 session,jsdom 載不了);
//    action 的語意層在 `payment-actions.test.ts` 測過,本檔只測表單這一層。
//    ⚠️ 生命週期(失敗→重送→換鍵)在 **2b** 的 `payment-lifecycle.test.tsx`,不在這裡。

const actionMock = vi.fn<(prev: PaymentActionState, form: FormData) => Promise<PaymentActionState>>();
vi.mock('../../lib/orders/payment-actions', () => ({
  recordManualPaymentAction: (prev: PaymentActionState, form: FormData) => actionMock(prev, form),
}));

import { PaymentRecordForm } from './payment-record-form';

const ORDER_ID = '3f2f2c1e-0000-4000-8000-000000000001';
const STAMP = {
  requestId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  cashReceivedAt: '2026-08-12T02:00:00.000Z',
};
const RETURN_TO = '/orders?payment_status=paid';

function renderForm(props: Partial<Parameters<typeof PaymentRecordForm>[0]> = {}) {
  return render(
    <PaymentRecordForm
      orderId={ORDER_ID}
      returnTo={RETURN_TO}
      stamp={STAMP}
      detailsReadable
      {...props}
    />,
  );
}

/** 表單此刻**真的會送出去**的 payload —— 斷言對象一律是它,不是畫面上的字。 */
function payload(container: HTMLElement): FormData {
  const form = container.querySelector('form');
  if (form === null) throw new Error('沒有 form 可以送出');
  return new FormData(form);
}

function submitButton(container: HTMLElement): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (el === null) throw new Error('找不到送出鈕');
  return el;
}

function checkbox(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (el === null) throw new Error('找不到確認勾選格');
  return el;
}

function pickCash(container: HTMLElement) {
  fireEvent.click(container.querySelector('input[name="rail"][value="cash"]')!);
}

beforeEach(() => {
  actionMock.mockReset();
  actionMock.mockResolvedValue({ status: 'idle' });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('印章 = 整組兩格、成組送出', () => {
  // 🔴 `payment-form.ts:160-166` 逐字「印章的形狀在**兩軌都驗**」——匯款軌不使用
  //    `cash_received_at`,但少了它解析器一樣判 invalid。⇒ 兩軌各驗一次,不只驗現金軌。
  it.each([
    ['匯款軌(預設)', (_c: HTMLElement) => {}],
    ['現金軌', pickCash],
  ])('%s:request_id 與 cash_received_at 都在 payload 裡、值等於 server 章', (_name, pick) => {
    const { container } = renderForm();
    pick(container);
    const form = payload(container);
    expect(form.getAll('request_id')).toEqual([STAMP.requestId]);
    expect(form.getAll('cash_received_at')).toEqual([STAMP.cashReceivedAt]);
  });

  // 🔴 送兩份會讓 `readSingleString` 回 null ⇒ `anyMalformed` 擋下 ⇒ `invalid`,
  //    而畫面上兩個 hidden 長得一模一樣、完全看不出來(`payment-form.ts:146-149`)。
  it('每個印章欄位只有一份', () => {
    const { container } = renderForm();
    expect(container.querySelectorAll('[name="request_id"]')).toHaveLength(1);
    expect(container.querySelectorAll('[name="cash_received_at"]')).toHaveLength(1);
  });

  it('order_id 與 return_to 各一份、值逐字相同', () => {
    const { container } = renderForm();
    const form = payload(container);
    expect(form.getAll('order_id')).toEqual([ORDER_ID]);
    expect(form.getAll('return_to')).toEqual([RETURN_TO]);
  });
});

describe('兩軌的欄位不同(不是同一組欄位有些留空)', () => {
  // 🔴 現金軌**帶了單號就是偽造 payload、當場拒**(`payment-form.ts:178`)。
  //    ⇒ 那一欄在現金軌必須**不存在**,而不是存在但空著 —— 空字串經 `orNull` 會變 null 沒事,
  //    但只要員工先在匯款軌打了單號再切現金,殘值就會跟著送出去。本格釘的是後者。
  it('現金軌:切過去之後 payload 裡沒有 bank_reference(即使先前打過)', () => {
    const { container } = renderForm();
    fireEvent.change(container.querySelector('input[name="bank_reference"]')!, {
      target: { value: 'CTBC-12345' },
    });
    expect(payload(container).getAll('bank_reference')).toEqual(['CTBC-12345']);

    pickCash(container);
    expect(payload(container).getAll('bank_reference')).toEqual([]);
  });

  it('現金軌:沒有銀行入帳日那一欄(時點來自 server 章)', () => {
    const { container } = renderForm();
    pickCash(container);
    expect(container.querySelector('input[name="received_date"]')).toBeNull();
  });

  it('匯款軌:銀行入帳日與單號兩欄都在', () => {
    const { container } = renderForm();
    expect(container.querySelector('input[name="received_date"]')).not.toBeNull();
    expect(container.querySelector('input[name="bank_reference"]')).not.toBeNull();
  });
});

describe('文案紅線(plan v4 §4a)', () => {
  // 🔴 `payment-action-state.ts:54-57` 逐字:這個時點 FormData 偽造得掉
  //    ⇒ **不得**把它講成可信來源。「系統自動記錄」正是被點名的那種說法。
  it('現金軌的說明不得出現「系統自動記錄」', () => {
    const { container } = renderForm();
    pickCash(container);
    expect(container.textContent).not.toContain('系統自動記錄');
  });

  // 🔴 Fable R3 F3:`rejected`(P0001)是一碼多義,零寫入也走它
  //    ⇒ 「開始下一筆」那顆鈕**不得斷言已入帳**。
  //
  // 🔴🔴 **這一格差一點寫成恆真**:第一版只有三條 `not.toContain`,而 `useActionState`
  //    是非同步的 —— 沒等就讀的話鈕根本還沒出現、`label` 是空字串,三條否定斷言**全部照過**,
  //    而且「文案改成『已入帳』」這個突變也照樣綠。⇒ 修法 = **先正面斷言鈕真的在**
  //    (`toContain('確認明細')`),否定斷言才有東西可否定。
  it.each(['error', 'rejected'] as const)('%s 失敗後出現的鈕,文案不得斷言已入帳', async (code) => {
    const { container } = renderForm();
    const label = await buttonLabelAfterFailure(container, code);
    // 前提自斷言:鈕真的渲染出來了(否則下面三條是空轉)。
    expect(label).toContain('確認明細');
    expect(label).not.toContain('已入帳');
    expect(label).not.toContain('已經入帳');
    expect(label).not.toContain('確認入帳');
  });
});

describe('Q-D8=B 確認閘(Sean 2026-08-12 拍)', () => {
  it('全新掛載:沒勾之前送出鈕是停用的', () => {
    const { container } = renderForm();
    expect(submitButton(container).disabled).toBe(true);
  });

  it('勾了之後才啟用', () => {
    const { container } = renderForm();
    fireEvent.click(checkbox(container));
    expect(submitButton(container).disabled).toBe(false);
  });

  // 🔴 明細讀不到時**連那一格也停用**:不讓「叫你去看明細」與「明細讀不到」
  //    同時出現在畫面上互打(plan v4 §5)。
  it.each([false])('detailsReadable=%s:勾選格與送出鈕都停用', (readable) => {
    const { container } = renderForm({ detailsReadable: readable });
    expect(checkbox(container).disabled).toBe(true);
    expect(submitButton(container).disabled).toBe(true);
  });

  // 🔴 表單**不卸載**(plan v4 §3 D3):卸載會銷毀 `state` 裡那組舊印章,
  //    重新掛載 = 新印章 = 重複入帳那條路。
  it('detailsReadable=false 時表單仍在畫面上(只是不能送)', () => {
    const { container } = renderForm({ detailsReadable: false });
    expect(container.querySelector('form')).not.toBeNull();
    expect(payload(container).getAll('request_id')).toEqual([STAMP.requestId]);
  });

  // 🔴 送出中也要停用(codex 關卡2 nit1:拿掉 `isPending` 那半,原本全套照樣綠)。
  //    連點兩下 = 同一把鍵兩個併發請求打進 RPC;G8 擋得掉重複入帳,但那是**第二道**,
  //    第一道本來就該是不讓他按第二下。
  it('送出中(action 還沒回)送出鈕是停用的', async () => {
    actionMock.mockImplementation(() => new Promise(() => {})); // 永不 resolve = 停在 pending
    const { container } = renderForm();
    fireEvent.click(checkbox(container));
    expect(submitButton(container).disabled).toBe(false); // 前提自斷言:送出前是啟用的
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => {
      if (!submitButton(container).disabled) throw new Error('送出中仍可再按');
    });
  });
});

/**
 * 讓表單真的走到某個失敗碼,回傳「開始下一筆」那顆鈕的文字。
 * 🔴 `waitFor` 不是保險起見 —— `useActionState` 的 state 是下一輪才到,
 *    不等的話呼叫端拿到空字串、否定斷言全部空轉(見上面那段)。
 */
async function buttonLabelAfterFailure(
  container: HTMLElement,
  code: 'error' | 'rejected',
): Promise<string> {
  const values: PaymentFormValues = {
    rail: 'bank_transfer',
    amount: '1000',
    receivedDate: '2026-08-12',
    bankReference: 'CTBC-1',
    payerNote: '',
    requestId: STAMP.requestId,
    cashReceivedAt: STAMP.cashReceivedAt,
  };
  actionMock.mockResolvedValue(paymentFailure(code, values));
  fireEvent.click(checkbox(container));
  fireEvent.submit(container.querySelector('form')!);
  return await waitFor(() => {
    const button = container.querySelector('button[type="button"]');
    if (button === null) throw new Error('「開始下一筆」鈕還沒出現');
    return button.textContent ?? '';
  });
}
