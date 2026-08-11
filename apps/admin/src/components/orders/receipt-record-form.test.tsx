// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { ReceiptActionState } from '../../lib/orders/receipt-action-state';

vi.mock('server-only', () => ({}));

// action 本體不在本檔的射程內 —— 這裡量的是**畫面**。
// `vi.mock` 的 factory 被提升到檔首 ⇒ 引用的變數必須走 `vi.hoisted`,否則 TDZ。
const mocks = vi.hoisted(() => ({ action: vi.fn() }));
vi.mock('../../lib/orders/receipt-actions', () => ({ recordItemReceiptAction: mocks.action }));
const action = mocks.action as unknown as ReturnType<
  typeof vi.fn<(prev: ReceiptActionState, form: FormData) => Promise<ReceiptActionState>>
>;

import { ReceiptRecordForm } from './receipt-record-form';

afterEach(cleanup);

function renderForm(remaining = 3) {
  return render(
    <ReceiptRecordForm
      orderId='o-1'
      orderItemId='i-1'
      procurementId='p-1'
      returnTo='/orders/o-1'
      remaining={remaining}
    />,
  );
}

describe('ReceiptRecordForm — 取消後到貨那條出路在 UI 上活著', () => {
  // 🔴🔴 R1 Important 5:出路是**兩層**(解析器 + UI),而 UI 那層原本零守門 ——
  //    把 min 改成 1,32 格全綠而員工再也填不了 0 ⇒ 取消後到貨在畫面上直接死掉,
  //    症狀還是沉默的(瀏覽器只會擋住送出、不會說為什麼)。
  it('🔴「到貨幾件」的 min 是 0,不是 1', () => {
    const { container } = renderForm();
    const qty = container.querySelector('input[name="quantity"]');
    expect(qty?.getAttribute('min')).toBe('0');
  });

  it('溢收欄同樣收得下 0(預設就是 0)', () => {
    const { container } = renderForm();
    const surplus = container.querySelector<HTMLInputElement>('input[name="surplus_quantity"]');
    expect(surplus?.getAttribute('min')).toBe('0');
    expect(surplus?.value).toBe('0');
  });

  it('到貨件數預設 = 這筆採購還沒到的件數', () => {
    const { container } = renderForm(5);
    expect(container.querySelector<HTMLInputElement>('input[name="quantity"]')?.value).toBe('5');
  });
});

describe('ReceiptRecordForm — 到貨時間預設值', () => {
  // 🔴🔴 R2 must-fix ②:R1 修掉的時區 bug **零守門** —— reviewer 把原式逐字寫回,9 格全綠。
  //    它是本片唯一「靜默寫錯資料」的形狀:早 8 小時仍在合法範圍、也不是未來
  //    ⇒ RPC 三道時間守門全部放行,員工不改就送 = 到貨時間永久錯 8 小時且沒人會發現。
  //    ⇒ 這一格拿**假時鐘**釘住「輸入框顯示的是台北牆鐘」。
  //
  //    🔴🔴 **更正(R3 打掉我上一版寫的理由)**:我原本在這裡寫「突變靶在**任何 TZ 下都紅**」——
  //    **那句是我沒量就寫的,而且是錯的**。實測三個時區跑原式(輸入 `2026-08-11T02:22Z`):
  //      · `Asia/Taipei`   offset −480 ⇒ 產出 `02:22`  ← 錯 8 小時
  //      · `UTC`           offset    0 ⇒ 產出 `10:22`  ← **恰好正確**
  //      · `America/New_York` offset 240 ⇒ 產出 `14:22` ← 錯
  //    ⇒ 錯式在 UTC 下與正解**等價**,而 CI 正是 UTC ⇒ 這格在 CI 上**恆綠、零判別力**。
  //    修法是把測試時區釘死在 `vitest.config.ts`(`env: { TZ: 'Asia/Taipei' }`),
  //    判別力因此**依賴那一行 config** —— 所以下面第一格是**前置錨點**:
  //    拿掉那行 config,錨點格會**紅**(而不是讓時區格靜默變恆真)。
  afterEach(() => vi.useRealTimers());

  // 🔴 前置錨點:本 describe 的判別力建立在「測試跑在台北時區」之上。
  //    沒有這格的話,誰把 vitest.config 那行拿掉,下面那格會**靜默**退化成恆真。
  it('🔴 前置:測試時區釘在 Asia/Taipei(拿掉 config 那行這格會紅)', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Asia/Taipei');
    expect(new Date('2026-08-11T02:22:00.000Z').getTimezoneOffset()).toBe(-480);
  });

  it('🔴 預設值 = 台北牆鐘(不是 UTC,也不是裝置時區)', async () => {
    // 2026-08-11T02:22:00Z ⇒ 台北 10:22
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T02:22:00.000Z'));
    const { container } = renderForm();
    await vi.waitFor(() => {
      const at = container.querySelector<HTMLInputElement>('input[name="received_at_local"]');
      expect(at?.value).toBe('2026-08-11T10:22');
    });
  });
});

describe('ReceiptRecordForm — 冪等鍵', () => {
  // 🔴 掛載後才鑄鍵 ⇒ SSR 的 HTML 裡是空的。鈕在那之前停用,員工看到的是「載入中…」
  //    而不是一顆按了必定 invalid 的鈕。
  it('掛載後鍵才有值,且鍵有值之前送出鈕是停用的', async () => {
    const { container } = renderForm();
    await waitFor(() => {
      const key = container.querySelector<HTMLInputElement>('input[name="request_id"]');
      expect(key?.value).not.toBe('');
    });
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
      false,
    );
  });

  // 🔴 重 render **不得**換鍵 —— 換了的話員工「再按一次」會變成一筆全新的登錄,
  //    而他以為自己是在重試同一筆。
  it('重新 render 不會換掉那把鍵', async () => {
    const { container, rerender } = renderForm();
    let first = '';
    await waitFor(() => {
      first = container.querySelector<HTMLInputElement>('input[name="request_id"]')!.value;
      expect(first).not.toBe('');
    });
    rerender(
      <ReceiptRecordForm
        orderId='o-1'
        orderItemId='i-1'
        procurementId='p-1'
        returnTo='/orders/o-1'
        remaining={3}
      />,
    );
    expect(container.querySelector<HTMLInputElement>('input[name="request_id"]')?.value).toBe(first);
  });
});

describe('ReceiptRecordForm — 失敗回來要真的看得到', () => {
  const FAILED: ReceiptActionState = {
    status: 'failed',
    code: 'EXCEEDS_ROOM_AFTER_CANCELLATION',
    message: '這張單被取消掉的份額不能再登錄到貨。請把「到貨幾件」改成 0。',
    procurementId: 'p-1',
    values: { quantity: '7', surplusQuantity: '2', receivedAtLocal: '2026-08-11T09:00', note: '備註' },
  };

  // 🔴🔴 R1 Important 6:原本四欄裡有三欄走 `defaultValue`,而 `defaultValue` 只在掛載那一次
  //    寫進 DOM ⇒ 失敗回來時 `state.values` 不會被任何一次 render 消費、員工打的字**真的不見**。
  //    這格量的是 DOM,不是函式回傳值。
  it('🔴 失敗回來時員工打的四欄都回到輸入框裡', async () => {
    action.mockResolvedValue(FAILED);
    const { container } = renderForm();
    await waitFor(() =>
      expect(
        container.querySelector<HTMLInputElement>('input[name="request_id"]')!.value,
      ).not.toBe(''),
    );
    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => {
      expect(container.querySelector<HTMLInputElement>('input[name="quantity"]')?.value).toBe('7');
    });
    expect(
      container.querySelector<HTMLInputElement>('input[name="surplus_quantity"]')?.value,
    ).toBe('2');
    expect(
      container.querySelector<HTMLInputElement>('input[name="received_at_local"]')?.value,
    ).toBe('2026-08-11T09:00');
    expect(container.querySelector<HTMLInputElement>('input[name="note"]')?.value).toBe('備註');
  });

  it('失敗訊息顯示在畫面上(role=alert)', async () => {
    action.mockResolvedValue(FAILED);
    const { container, findByRole } = renderForm();
    await waitFor(() =>
      expect(
        container.querySelector<HTMLInputElement>('input[name="request_id"]')!.value,
      ).not.toBe(''),
    );
    fireEvent.submit(container.querySelector('form')!);
    expect((await findByRole('alert')).textContent).toContain('改成 0');
  });

  // 🔴 帶回值進 state 之後**還要能繼續打字** —— 用三元把 value 綁在 `state.values` 上的話,
  //    輸入框會被釘死、`onChange` 改不動它,員工只能重整。
  it('帶回值之後還改得動(不是被釘死)', async () => {
    action.mockResolvedValue(FAILED);
    const { container } = renderForm();
    await waitFor(() =>
      expect(
        container.querySelector<HTMLInputElement>('input[name="request_id"]')!.value,
      ).not.toBe(''),
    );
    fireEvent.submit(container.querySelector('form')!);
    const qty = () => container.querySelector<HTMLInputElement>('input[name="quantity"]')!;
    await waitFor(() => expect(qty().value).toBe('7'));
    fireEvent.change(qty(), { target: { value: '1' } });
    expect(qty().value).toBe('1');
  });

  // 🔴🔴 R2 must-fix ①:`invalid` 帶 null procurementId 時橫幅**必須照樣渲染** ——
  //    否則員工清空到貨時間送出後畫面完全沒反應,和「沒送出去」分不出來。
  //    (`denied` 同形:授權閘排在讀欄位之前 ⇒ 它只能帶 null。)
  it.each([
    ['invalid', '表單內容不正確'],
    ['denied', '沒有權限'],
  ])('🔴 %s(procurementId=null)照樣看得到訊息', async (code, text) => {
    action.mockResolvedValue({
      status: 'failed',
      code,
      message: code === 'invalid' ? '表單內容不正確,到貨沒有寫入。' : '沒有權限或登入狀態已失效,到貨沒有寫入。',
      procurementId: null,
      values: { quantity: '', surplusQuantity: '', receivedAtLocal: '', note: '' },
    } as ReceiptActionState);
    const { container, findByRole } = renderForm();
    await waitFor(() =>
      expect(
        container.querySelector<HTMLInputElement>('input[name="request_id"]')!.value,
      ).not.toBe(''),
    );
    fireEvent.submit(container.querySelector('form')!);
    expect((await findByRole('alert')).textContent).toContain(text);
  });

  // 🔴 一個品項可能有多筆採購、各有一份表單 ⇒ 別的表單失敗不可以污染這一份。
  it('別筆採購的失敗不顯示在這一份表單上', async () => {
    action.mockResolvedValue({ ...FAILED, procurementId: 'p-OTHER' });
    const { container } = renderForm();
    await waitFor(() =>
      expect(
        container.querySelector<HTMLInputElement>('input[name="request_id"]')!.value,
      ).not.toBe(''),
    );
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(action).toHaveBeenCalled());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector<HTMLInputElement>('input[name="quantity"]')?.value).toBe('3');
  });
});
