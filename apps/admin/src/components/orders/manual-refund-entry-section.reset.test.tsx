// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import {
  EMPTY_MANUAL_REFUND_INPUT,
  MANUAL_REFUND_AMOUNT_FIELD,
  MANUAL_REFUND_CARD_CONFIRM_FIELD,
  MANUAL_REFUND_OCCURRED_AT_FIELD,
  MANUAL_REFUND_RAIL_FIELD,
  MANUAL_REFUND_REASON_FIELD,
  type ManualRefundActionState,
} from '../../lib/payment/manual-refund-action-state';

// 2026-09-15 走查 E:登記退款選「現金」送出失敗,`<form action>` 自動 reset 把 radio DOM 打回「匯款」,
//   一個字不改再按 ⇒ 送出 rail=bank_transfer(鑽機實測 server 收到 bank_transfer)。
// 🔵 本檔**不 mock useActionState**(隔壁 manual-refund-entry-section.test.tsx 有 mock,那樣表單 reset 根本不會發生,
//    抓不到這個病)⇒ 只 mock server action 模組。

const actionMock =
  vi.fn<(prev: ManualRefundActionState, form: FormData) => Promise<ManualRefundActionState>>();
vi.mock('../../lib/payment/manual-refund-actions', () => ({
  recordManualRefundAction: (prev: ManualRefundActionState, form: FormData) => actionMock(prev, form),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ManualRefundEntrySection } from './manual-refund-entry-section';

/** 照實回傳送出的那份(server 的 carryBack 就是這樣做),失敗碼 error = 「用同一張表單稍後再試」。 */
async function echoFailure(_prev: ManualRefundActionState, form: FormData): Promise<ManualRefundActionState> {
  return {
    status: 'failed',
    code: 'error',
    message: '退款登記未完成,可以用同一張表單稍後再試',
    requestToken: 'tok-failed',
    input: {
      rail: String(form.get(MANUAL_REFUND_RAIL_FIELD) ?? ''),
      amount: String(form.get(MANUAL_REFUND_AMOUNT_FIELD) ?? ''),
      reason: String(form.get(MANUAL_REFUND_REASON_FIELD) ?? ''),
      occurredAt: String(form.get(MANUAL_REFUND_OCCURRED_AT_FIELD) ?? ''),
      confirmCardNotRefunded: form.get(MANUAL_REFUND_CARD_CONFIRM_FIELD) === '1',
    },
  } as ManualRefundActionState;
}

function renderSection() {
  return render(
    <ManualRefundEntrySection orderId='o-1' returnTo='/orders/o-1' serverToken='tok-idle' ledgerSettled={false} />,
  );
}

function radio(container: HTMLElement, value: 'bank_transfer' | 'cash'): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`);
  if (!el) throw new Error(`radio ${value} 不在`);
  return el;
}

function fillCash(container: HTMLElement) {
  fireEvent.click(radio(container, 'cash'));
  fireEvent.change(container.querySelector(`input[name="${MANUAL_REFUND_AMOUNT_FIELD}"]`)!, { target: { value: '500' } });
  fireEvent.change(container.querySelector(`input[name="${MANUAL_REFUND_REASON_FIELD}"]`)!, { target: { value: '商品缺貨' } });
}

beforeEach(() => {
  actionMock.mockReset();
  actionMock.mockImplementation(echoFailure);
});
afterEach(() => {
  cleanup();
});

describe('走查 E:失敗回來不得把員工選的退款管道換掉', () => {
  it('[E1] 選現金失敗一次:仍勾現金、金額還在、再送出的 rail 是 cash', async () => {
    const { container, findByRole } = renderSection();
    fillCash(container);
    fireEvent.submit(container.querySelector('form')!);
    await findByRole('alert');
    await waitFor(() => expect(radio(container, 'cash').checked).toBe(true));
    expect(radio(container, 'bank_transfer').checked).toBe(false);
    const form = new FormData(container.querySelector('form')!);
    expect(form.getAll(MANUAL_REFUND_RAIL_FIELD)).toEqual(['cash']);
    expect(form.get(MANUAL_REFUND_AMOUNT_FIELD)).toBe('500');
  });

  it('[E2] 選現金連續失敗兩次、中間一個字不改:第二次送出仍是 cash', async () => {
    const { container, findByRole } = renderSection();
    fillCash(container);
    fireEvent.submit(container.querySelector('form')!);
    await findByRole('alert');
    await waitFor(() => expect(actionMock.mock.calls.length).toBe(1));
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(actionMock.mock.calls.length).toBe(2));
    expect(actionMock.mock.calls[1]![1].get(MANUAL_REFUND_RAIL_FIELD)).toBe('cash');
    await waitFor(() => expect(radio(container, 'cash').checked).toBe(true));
  });

  it('[E3] 送出時畫面勾現金而 state 還是匯款(hydration 前先點、瀏覽器還原表單)⇒ 失敗回來畫面仍是現金', async () => {
    // adversarial-reviewer R1 C2:回填要對齊「送出當下畫面上勾的那個」,不能讓重掛把畫面打回 state 的舊值。
    const { container, findByRole } = renderSection();
    fireEvent.change(container.querySelector(`input[name="${MANUAL_REFUND_AMOUNT_FIELD}"]`)!, { target: { value: '500' } });
    fireEvent.change(container.querySelector(`input[name="${MANUAL_REFUND_REASON_FIELD}"]`)!, { target: { value: '商品缺貨' } });
    radio(container, 'cash').checked = true; // 不經 React 事件
    fireEvent.submit(container.querySelector('form')!);
    await findByRole('alert');
    expect(actionMock.mock.calls[0]![1].get(MANUAL_REFUND_RAIL_FIELD)).toBe('cash');
    await waitFor(() => expect(radio(container, 'cash').checked).toBe(true));
    expect(new FormData(container.querySelector('form')!).get(MANUAL_REFUND_RAIL_FIELD)).toBe('cash');
  });

  it('[E6] denied(input 是空殼)⇒ 員工選的現金與勾選框都留著', async () => {
    // adversarial-reviewer R1 N1:把 setResultSeq 搬到 denied 早退之後,E1–E5 全綠不會叫;這格會紅。
    actionMock.mockImplementation(async () => ({
      status: 'failed',
      code: 'denied',
      message: '沒有權限或登入狀態已失效',
      requestToken: 'tok-failed',
      input: EMPTY_MANUAL_REFUND_INPUT,
    }) as ManualRefundActionState);
    const { container, findByRole } = renderSection();
    fillCash(container);
    const box = () =>
      container.querySelector<HTMLInputElement>(`input[type="checkbox"][name="${MANUAL_REFUND_CARD_CONFIRM_FIELD}"]`)!;
    fireEvent.click(box());
    fireEvent.submit(container.querySelector('form')!);
    await findByRole('alert');
    await waitFor(() => expect(radio(container, 'cash').checked).toBe(true));
    expect(box().checked).toBe(true);
    const form = new FormData(container.querySelector('form')!);
    expect(form.get(MANUAL_REFUND_RAIL_FIELD)).toBe('cash');
    expect(form.get(MANUAL_REFUND_CARD_CONFIRM_FIELD)).toBe('1');
  });

  it('[E4] 勾了卡片確認而送失敗 ⇒ 框在 DOM 上仍是勾的、再送出帶著它', async () => {
    const { container, findByRole } = renderSection();
    fillCash(container);
    const box = () =>
      container.querySelector<HTMLInputElement>(`input[type="checkbox"][name="${MANUAL_REFUND_CARD_CONFIRM_FIELD}"]`)!;
    fireEvent.click(box());
    expect(box().checked).toBe(true);
    fireEvent.submit(container.querySelector('form')!);
    await findByRole('alert');
    await waitFor(() => expect(box().checked).toBe(true));
    expect(new FormData(container.querySelector('form')!).get(MANUAL_REFUND_CARD_CONFIRM_FIELD)).toBe('1');
  });

  it('[E5] 正對照:沒動管道(預設匯款)失敗回來仍是匯款', async () => {
    const { container, findByRole } = renderSection();
    fireEvent.change(container.querySelector(`input[name="${MANUAL_REFUND_AMOUNT_FIELD}"]`)!, { target: { value: '300' } });
    fireEvent.change(container.querySelector(`input[name="${MANUAL_REFUND_REASON_FIELD}"]`)!, { target: { value: '匯款退回' } });
    fireEvent.submit(container.querySelector('form')!);
    await findByRole('alert');
    expect(radio(container, 'bank_transfer').checked).toBe(true);
    expect(actionMock.mock.calls[0]![1].get(MANUAL_REFUND_RAIL_FIELD)).toBe('bank_transfer');
    expect(new FormData(container.querySelector('form')!).getAll(MANUAL_REFUND_RAIL_FIELD)).toEqual(['bank_transfer']);
  });
});
