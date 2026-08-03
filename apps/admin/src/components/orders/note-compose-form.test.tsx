// @vitest-environment jsdom
// 🔴 釘非 UTC 時區(R1 MF3):CI 是 UTC,epoch 等值斷言在 UTC 下對「把 local 當 UTC 解析」的
//    突變恆真(兩邊同錯相消)。釘 Asia/Taipei 後該突變差 8 小時、必轉紅;test [3] 內含前提自斷言。
process.env.TZ = 'Asia/Taipei';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { noteFailure, type NoteActionState } from '../../lib/orders/note-action-state';

// M-4b E10 A10a-3 smoke test(plan §4;測試矩陣編號對照)。
// 🔴 mock 掉 server action 模組(transitively 拉 next/cache 與 session,jsdom 載不了);
//    action 的語意層在 note-actions.test.ts 測過,這裡只測表單接線。

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
  noteType: 'internal' as const,
  typeLabel: '內部備註',
  excerpt: '原內容',
};

function tokenInput(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>('input[name="request_token"]');
  if (!el) throw new Error('request_token hidden input 不在');
  return el;
}

beforeEach(() => {
  actionMock.mockReset();
  actionMock.mockResolvedValue({ status: 'idle', requestToken: TOKEN });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('NoteComposeForm — A10a-3', () => {
  it('[1] 預設 internal:無管道/時間欄;hidden token=serverToken、order_id 正確', () => {
    const { container } = render(
      <NoteComposeForm orderId={ORDER_ID} serverToken={TOKEN} correctTarget={null} />,
    );
    expect(tokenInput(container).value).toBe(TOKEN);
    expect(container.querySelector<HTMLInputElement>('input[name="order_id"]')?.value).toBe(ORDER_ID);
    expect(container.querySelector('select[name="channel"]')).toBeNull();
    expect(container.querySelector('input[type="datetime-local"]')).toBeNull();
    expect(container.querySelector('input[name="corrects_note_id"]')).toBeNull();
  });

  it('[2] 切聯絡紀錄:管道+時間出現且 required;切回 internal 消失', () => {
    const { container, getByLabelText } = render(
      <NoteComposeForm orderId={ORDER_ID} serverToken={TOKEN} correctTarget={null} />,
    );
    fireEvent.click(getByLabelText('聯絡紀錄'));
    const channel = container.querySelector<HTMLSelectElement>('select[name="channel"]');
    expect(channel?.required).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[type="datetime-local"]')?.required).toBe(true);
    fireEvent.click(getByLabelText('內部備註'));
    expect(container.querySelector('select[name="channel"]')).toBeNull();
  });

  it('[3] datetime 換算:hidden occurred_at 帶偏移且與員工指的那個台北時刻等值', () => {
    // 前提自斷言:本檔第 1 行的 TZ 釘住真的生效(否則 epoch 斷言無判別力 = MF3)
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Asia/Taipei');
    const { container, getByLabelText } = render(
      <NoteComposeForm orderId={ORDER_ID} serverToken={TOKEN} correctTarget={null} />,
    );
    fireEvent.click(getByLabelText('聯絡紀錄'));
    fireEvent.change(getByLabelText('聯絡時間(台北時間)'), {
      target: { value: '2026-08-02T14:30' },
    });
    const hidden = container.querySelector<HTMLInputElement>('input[name="occurred_at"]');
    // 帶偏移字面(債②:datetime-local 原始值會被解析器拒收)
    expect(hidden?.value).toMatch(/(Z|[+-]\d{2}:\d{2})$/);
    // 台北 14:30 = UTC 06:30(把 local 當 UTC 解析的突變會給 14:30Z,差 8 小時 → 紅)
    expect(hidden!.value).toBe('2026-08-02T06:30:00.000Z');
  });

  it('[4] 更正模式:不可撤回文案 + hidden corrects_note_id + 取消更正連結', () => {
    const { container, getByText } = render(
      <NoteComposeForm orderId={ORDER_ID} serverToken={TOKEN} correctTarget={TARGET} />,
    );
    expect(container.textContent).toContain('不可撤回');
    expect(container.querySelector<HTMLInputElement>('input[name="corrects_note_id"]')?.value).toBe(TARGET.id);
    expect(getByText('取消更正').getAttribute('href')).toBe(`/orders/${ORDER_ID}`);
  });

  it('[5] confirm 閘(債⑥):更正模式 confirm=false 擋下送出、true 放行;非更正不問', async () => {
    // 🔴 觀察點 = action 呼叫次數,不是 submit 事件的 preventDefault ——
    //    React 19 接手 form action 時本來就會 preventDefault,事件層分不出「誰擋的」。
    const confirmSpy = vi.spyOn(window, 'confirm');
    const { container, rerender } = render(
      <NoteComposeForm orderId={ORDER_ID} serverToken={TOKEN} correctTarget={TARGET} />,
    );
    const form = container.querySelector('form')!;
    confirmSpy.mockReturnValue(false);
    fireEvent.submit(form);
    expect(confirmSpy.mock.calls.length).toBe(1);
    expect(confirmSpy.mock.calls[0]![0]).toContain('不可撤回');
    expect(confirmSpy.mock.calls[0]![0]).toContain(TARGET.excerpt);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(actionMock.mock.calls.length).toBe(0);
    confirmSpy.mockReturnValue(true);
    fireEvent.submit(form);
    await waitFor(() => expect(actionMock.mock.calls.length).toBe(1));
    // 非更正模式:不問 confirm
    rerender(<NoteComposeForm orderId={ORDER_ID} serverToken={TOKEN} correctTarget={null} />);
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(actionMock.mock.calls.length).toBe(2));
    expect(confirmSpy.mock.calls.length).toBe(2);
  });

  it('[6] 失敗 state:訊息顯示 + token 沿用 state 那把(R2-2)', async () => {
    actionMock.mockResolvedValue(noteFailure('INVALID_BODY', '員工打的字', 'ffffffff-0000-4000-8000-000000000009'));
    const { container, findByRole } = render(
      <NoteComposeForm orderId={ORDER_ID} serverToken={TOKEN} correctTarget={null} />,
    );
    fireEvent.submit(container.querySelector('form')!);
    const alert = await findByRole('alert');
    expect(alert.textContent).toContain('備註內容不能空白');
    expect(tokenInput(container).value).toBe('ffffffff-0000-4000-8000-000000000009');
  });

  it('[7] pending:送出中按鈕 disabled(disabled 按鈕吃不到後續 click;真雙擊窗口 jsdom 測不到,真保證=A6 token 冪等)', async () => {
    actionMock.mockImplementation(() => new Promise(() => {})); // 懸置
    const { container, getByRole } = render(
      <NoteComposeForm orderId={ORDER_ID} serverToken={TOKEN} correctTarget={null} />,
    );
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => {
      expect(getByRole('button', { name: '送出中…' })).toHaveProperty('disabled', true);
    });
    fireEvent.click(getByRole('button', { name: '送出中…' }));
    expect(actionMock.mock.calls.length).toBe(1);
  });

  it('[8] pageshow persisted → token 重產(債④);非 persisted 不換、值仍合法 uuid', () => {
    const { container } = render(
      <NoteComposeForm orderId={ORDER_ID} serverToken={TOKEN} correctTarget={null} />,
    );
    const persistedShow = new Event('pageshow');
    Object.defineProperty(persistedShow, 'persisted', { value: true });
    fireEvent(window, persistedShow);
    const regenerated = tokenInput(container).value;
    expect(regenerated).not.toBe(TOKEN);
    expect(regenerated).toMatch(/^[0-9a-f-]{36}$/);
    // 非 persisted(一般載入)不得換
    fireEvent(window, new Event('pageshow'));
    expect(tokenInput(container).value).toBe(regenerated);
  });

  it('[9] MF1:更正聯絡類備註 → radio 初值 = 原型別、管道/時間欄直接在場', () => {
    const { container, getByLabelText } = render(
      <NoteComposeForm
        orderId={ORDER_ID}
        serverToken={TOKEN}
        correctTarget={{ ...TARGET, noteType: 'customer_notified', typeLabel: '已告知客人' }}
      />,
    );
    expect((getByLabelText('已告知客人') as HTMLInputElement).checked).toBe(true);
    expect(container.querySelector('select[name="channel"]')).not.toBeNull();
  });

  it('[10] MF2:correctionMissing → 警告顯示「會是新備註」、不進更正模式', () => {
    const { container } = render(
      <NoteComposeForm
        orderId={ORDER_ID}
        serverToken={TOKEN}
        correctTarget={null}
        correctionMissing
      />,
    );
    expect(container.textContent).toContain('找不到指定要更正的備註');
    expect(container.textContent).toContain('新備註');
    expect(container.querySelector('input[name="corrects_note_id"]')).toBeNull();
  });
});
