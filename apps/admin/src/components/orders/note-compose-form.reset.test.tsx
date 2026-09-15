// @vitest-environment jsdom
process.env.TZ = 'Asia/Taipei';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import {
  NOTE_BODY_FIELD,
  NOTE_TYPE_FIELD,
  noteFailure,
  type NoteActionState,
} from '../../lib/orders/note-action-state';

// 2026-09-15(同退款 96d84ee4c / a2fe7bba9 那個病):`<form action>` 送完 React 19 自動 reset 表單,
//   型別 radio 與「這次有正式告知客人」勾選的 DOM 被打回初次渲染的勾選,而 state 沒變就不重畫
//   ⇒ 畫面顯示的型別 ≠ hidden `note_type` 送出的型別 ⇒ 員工照畫面再按,告知義務的證據記錯。
// 🔵 另開一檔:隔壁 note-compose-form.test.tsx 的 [7] 掛了永不 resolve 的 action,
//    排在它後面的 useActionState 更新推不動(那支檔尾註解有寫)。

const actionMock = vi.fn<(prev: NoteActionState, form: FormData) => Promise<NoteActionState>>();
vi.mock('../../lib/orders/note-actions', () => ({
  appendOrderNoteAction: (prev: NoteActionState, form: FormData) => actionMock(prev, form),
}));

import { NoteComposeForm } from './note-compose-form';

const ORDER_ID = '3f2f2c1e-0000-4000-8000-000000000001';
const TOKEN = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const TARGET = {
  id: 'cccccccc-1111-4222-8333-444444444444',
  seq: 2,
  noteType: 'customer_notified' as const,
  typeLabel: '客人聯繫 · 已告知',
  excerpt: '原內容',
  channel: 'line' as const,
  occurredAtLocal: '2026-08-02T14:30',
};

/** 每次回一個新的失敗物件(真 server action 每次回應都是新物件),body 照送出的帶回。 */
async function echoFailure(_prev: NoteActionState, form: FormData): Promise<NoteActionState> {
  return noteFailure('INVALID_BODY', String(form.get(NOTE_BODY_FIELD) ?? ''), 'tok-failed');
}

const q = <T extends Element>(c: HTMLElement, sel: string) => {
  const el = c.querySelector<T>(sel);
  if (!el) throw new Error(`${sel} 不在`);
  return el;
};
const internalRadio = (c: HTMLElement) => q<HTMLInputElement>(c, 'input[name="note_type_ui"][value="internal"]');
const contactRadio = (c: HTMLElement) => q<HTMLInputElement>(c, 'input[name="note_type_ui"][value="contact"]');
const notifiedBox = (c: HTMLElement) => q<HTMLInputElement>(c, 'input[type="checkbox"]');
const sentType = (c: HTMLElement) => new FormData(q<HTMLFormElement>(c, 'form')).get(NOTE_TYPE_FIELD);

function fillBody(c: HTMLElement) {
  fireEvent.change(q(c, `textarea[name="${NOTE_BODY_FIELD}"]`), { target: { value: '電話告知延遲出貨' } });
}
function fillContactNotified(c: HTMLElement) {
  fireEvent.click(contactRadio(c));
  fireEvent.click(notifiedBox(c));
  fireEvent.change(q(c, 'input[type="datetime-local"]'), { target: { value: '2026-09-15T10:00' } });
  fillBody(c);
}
async function submit(c: HTMLElement) {
  await act(async () => {
    fireEvent.submit(q(c, 'form'));
  });
}

beforeEach(() => {
  actionMock.mockReset();
  actionMock.mockImplementation(echoFailure);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('送出失敗回來,畫面上的型別 / 告知勾選不得被打回初值', () => {
  it('[R1] 客人聯繫 + 勾告知,失敗一次:畫面仍是客人聯繫 + 勾著,送出的是 customer_notified', async () => {
    const { container, findByRole } = render(
      <NoteComposeForm returnTo='/orders' orderId={ORDER_ID} serverToken={TOKEN} correctTarget={null} />,
    );
    fillContactNotified(container);
    await submit(container);
    await findByRole('alert');
    expect(actionMock.mock.calls[0]![1].get(NOTE_TYPE_FIELD)).toBe('customer_notified');
    await waitFor(() => expect(contactRadio(container).checked).toBe(true));
    expect(internalRadio(container).checked).toBe(false);
    expect(notifiedBox(container).checked).toBe(true);
    expect(sentType(container)).toBe('customer_notified');
  });

  it('[R2] 一個字不改連失敗兩次:第二次送出與畫面都還是 customer_notified', async () => {
    const { container, findByRole } = render(
      <NoteComposeForm returnTo='/orders' orderId={ORDER_ID} serverToken={TOKEN} correctTarget={null} />,
    );
    fillContactNotified(container);
    await submit(container);
    await findByRole('alert');
    await submit(container);
    await waitFor(() => expect(actionMock.mock.calls.length).toBe(2));
    expect(actionMock.mock.calls[1]![1].get(NOTE_TYPE_FIELD)).toBe('customer_notified');
    await waitFor(() => expect(contactRadio(container).checked).toBe(true));
    expect(internalRadio(container).checked).toBe(false);
    expect(notifiedBox(container).checked).toBe(true);
  });

  it('[R3] 更正「已告知」那筆、員工取消勾選,失敗回來:勾選仍是空的、送出 contact_log(不得跳回已告知)', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { container, findByRole } = render(
      <NoteComposeForm returnTo='/orders' orderId={ORDER_ID} serverToken={TOKEN} correctTarget={TARGET} />,
    );
    expect(notifiedBox(container).checked).toBe(true);
    fireEvent.click(notifiedBox(container));
    fillBody(container);
    await submit(container);
    await findByRole('alert');
    expect(actionMock.mock.calls[0]![1].get(NOTE_TYPE_FIELD)).toBe('contact_log');
    await waitFor(() => expect(notifiedBox(container).checked).toBe(false));
    expect(contactRadio(container).checked).toBe(true);
    expect(sentType(container)).toBe('contact_log');
  });

  it('[R4] 送出時畫面勾客人聯繫而 state 還是內部備註(不經 React 事件)⇒ 失敗回來照畫面那個', async () => {
    const { container, findByRole } = render(
      <NoteComposeForm returnTo='/orders' orderId={ORDER_ID} serverToken={TOKEN} correctTarget={null} />,
    );
    fillBody(container);
    contactRadio(container).checked = true;
    await submit(container);
    await findByRole('alert');
    await waitFor(() => expect(contactRadio(container).checked).toBe(true));
    expect(internalRadio(container).checked).toBe(false);
    expect(sentType(container)).toBe('contact_log');
  });

  it('[R5] 正對照:沒動型別(內部備註)失敗回來仍是內部備註', async () => {
    const { container, findByRole } = render(
      <NoteComposeForm returnTo='/orders' orderId={ORDER_ID} serverToken={TOKEN} correctTarget={null} />,
    );
    fillBody(container);
    await submit(container);
    await findByRole('alert');
    expect(internalRadio(container).checked).toBe(true);
    expect(contactRadio(container).checked).toBe(false);
    expect(sentType(container)).toBe('internal');
  });

  it('[R6] 正常路徑:成功(不回 failed)⇒ 送出 customer_notified、沒有錯誤訊息', async () => {
    actionMock.mockResolvedValue({ status: 'idle', requestToken: TOKEN });
    const { container, queryByRole } = render(
      <NoteComposeForm returnTo='/orders' orderId={ORDER_ID} serverToken={TOKEN} correctTarget={null} />,
    );
    fillContactNotified(container);
    await submit(container);
    await waitFor(() => expect(actionMock.mock.calls.length).toBe(1));
    expect(actionMock.mock.calls[0]![1].get(NOTE_TYPE_FIELD)).toBe('customer_notified');
    expect(queryByRole('alert')).toBeNull();
  });
});
