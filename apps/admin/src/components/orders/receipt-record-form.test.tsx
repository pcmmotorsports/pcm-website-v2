// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReceiptActionState } from '../../lib/orders/receipt-action-state';

vi.mock('server-only', () => ({}));

// action 本體不在本檔的射程內 —— 這裡量的是**畫面**。
// `vi.mock` 的 factory 被提升到檔首 ⇒ 引用的變數必須走 `vi.hoisted`,否則 TDZ。
// 🔴 `undoItemReceiptAction` 也要給 —— 本表單成功後會渲染 `ReceiptUndoBar`,它 `useActionState`
//    吃那支。只 mock 登錄那支的話,撤銷那支是 `undefined` ⇒ 成功路徑當場炸(實測:本檔兩格紅,
//    其中一格是**既有**的「成功後換新鍵」)。這是今天第三次撞到「整包 mock 抹掉具名匯出」。
const mocks = vi.hoisted(() => ({ action: vi.fn(), undo: vi.fn() }));
vi.mock('../../lib/orders/receipt-actions', () => ({
  recordItemReceiptAction: mocks.action,
  undoItemReceiptAction: mocks.undo,
}));
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

// ── #352-b-2 I2:彈窗模式成功後換新冪等鍵 ──────────────────────────────
describe('ReceiptRecordForm — 彈窗模式成功後的冪等鍵', () => {
  const RECORDED = {
    status: 'recorded_inline' as const,
    outcome: 'recorded' as const,
    procurementId: 'p-1',
  };

  async function mounted() {
    const r = renderForm();
    await waitFor(() =>
      expect(
        (r.container.querySelector('input[name="request_id"]') as HTMLInputElement).value,
      ).not.toBe(''),
    );
    return r;
  }
  const keyOf = (c: HTMLElement) =>
    (c.querySelector('input[name="request_id"]') as HTMLInputElement).value;

  // 🔴🔴 失效症狀是註解自己寫的那句:員工登錄**第二批**真到貨會永遠拿到 DUPLICATE_REQUEST,
  //    畫面說「先前已經登錄過」⇒ 那批貨再也記不進去。拿掉換鍵那行 ⇒ 這格必紅。
  it('🔴 成功之後換一把新鍵(否則第二批到貨永遠 DUPLICATE)', async () => {
    action.mockResolvedValue(RECORDED);
    const { container } = await mounted();
    const before = keyOf(container);
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(keyOf(container)).not.toBe(before));
    expect(keyOf(container)).not.toBe('');
  });

  // 🔴 失敗路徑**不換鍵** —— 同一次嘗試重送必須還是同一把,否則「重試」會變成第二筆到貨。
  it('🔴 失敗之後**不**換鍵(重試仍是同一次嘗試)', async () => {
    action.mockResolvedValue({
      status: 'failed',
      code: 'RECEIVED_AT_IN_FUTURE',
      message: 'x',
      procurementId: 'p-1',
      values: { quantity: '', surplusQuantity: '', receivedAtLocal: '', note: '' },
    } as ReceiptActionState);
    const { container } = await mounted();
    const before = keyOf(container);
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(action).toHaveBeenCalled());
    expect(keyOf(container)).toBe(before);
  });

  // 🔴 別筆採購的成功不得換掉這一份的鍵。
  it('別筆採購的 recorded_inline 不換本表單的鍵', async () => {
    action.mockResolvedValue({ ...RECORDED, procurementId: 'p-OTHER' });
    const { container } = await mounted();
    const before = keyOf(container);
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(action).toHaveBeenCalled());
    expect(keyOf(container)).toBe(before);
  });

  // 🔴🔴 R2 must-fix 1:`<ReceiptUndoBar key={undoKey}>` 那把 key 是承重的,而它原本零守門
  //    (刪掉那行,`orders/` 底下 1482 格全綠)。跨批殘留的症狀:登錄第 1 批 → 撤銷成功 →
  //    登錄第 2 批,撤銷列仍停在「已撤銷剛剛那筆」而第 2 批**已寫入且沒被撤銷**,鈕也不回來。
  //    ⚠️ 寫這格的陷阱(審查者踩過、我照抄他的提醒):兩次成功要用 `mockImplementation`
  //    產出**不同的 state 物件** —— `mockResolvedValue` 會回同一個物件,而元件用
  //    `handledRef.current === state` 判「這件事處理過沒」⇒ 第二次直接被 early return,
  //    測試會**假紅**,讓人誤以為修法無效。
  it('🔴 撤銷成功後再登錄第二批,撤銷鈕要回來(終態不得跨批殘留)', async () => {
    // 🔴 **第一版這格是 no-op**:我斷言撤銷表單的 hidden `request_id` 有換掉 —— 那個值吃的是
    //    `consumedKey` **prop**,prop 換了就會重畫,**不論有沒有 key** ⇒ 刪掉 key 照樣全綠。
    //    真正會殘留的是撤銷列自己的 `useActionState`:撤銷成功後 state=`undone` ⇒ 表單不渲染
    //    ⇒ **第二批沒有鈕**。⇒ 要斷言的是「鈕回來了沒」,不是 hidden 欄的值。
    action.mockImplementation(async () => ({ ...RECORDED }));
    mocks.undo.mockImplementation(async () => ({ status: 'undone' as const }));
    const { container } = await mounted();

    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(screen.queryByText('撤銷剛剛那筆')).not.toBeNull());

    fireEvent.click(screen.getByText('撤銷剛剛那筆'));
    await waitFor(() => expect(screen.queryByText(/已撤銷剛剛那筆到貨/)).not.toBeNull());
    expect(screen.queryByText('撤銷剛剛那筆'), '前提:撤銷成功後這一批的鈕確實收起來了').toBeNull();

    // 第二批:同一個表單再登錄一次。
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() =>
      expect(
        screen.queryByText('撤銷剛剛那筆'),
        '撤銷列停在上一批的「已撤銷」終態 ⇒ 第二批已寫入卻沒有撤銷入口(而畫面還說已撤銷)',
      ).not.toBeNull(),
    );
  });

  // 🔴🔴 撤銷入口拿到的必須是**剛剛消費掉的那把鍵**,不是成功後新鑄的那把(「改軟」線片 1)。
  //    拿到新鍵的話,action 反查冪等帳查無產物 ⇒ 一律當呼叫端 bug ⇒ **撤銷鈕永遠按不動**,
  //    而且症狀是沉默的(畫面只說「被系統擋下」,沒人會想到是鍵拿錯了)。
  //    這條接線在本片之前零守門 —— 我拿它做突變時才發現自己寫的因果註解是假的(順序無關)。
  it('🔴 成功後出現的撤銷鈕,帶的是剛剛用掉的那把鍵(不是新鑄的)', async () => {
    action.mockResolvedValue(RECORDED);
    const { container } = await mounted();
    const consumed = keyOf(container);
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(action).toHaveBeenCalled());

    // 成功後本表單已換新鍵(既有格釘過),而撤銷表單要留住舊的那把。
    await waitFor(() => expect(container.querySelectorAll('form').length).toBe(2));
    expect(keyOf(container), '前提:登錄表單自己已經換過鍵了').not.toBe(consumed);
    const undoForm = container.querySelectorAll('form')[1]!;
    const undoKey = undoForm.querySelector<HTMLInputElement>('input[name="request_id"]')?.value;
    expect(undoKey, '撤銷帶的鍵不是剛剛消費掉的那把 ⇒ 反查不到產物、鈕永遠按不動').toBe(consumed);
  });
});
