// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import {
  EMPTY_REFUND_INPUT,
  refundFailure,
  type RefundActionState,
} from '../../lib/payment/refund-action-state';

// M-3 A7c RW2d:退款入口表單的接線測試(語意層在 refund-actions*.test.ts,這裡只測表單)。
// 🔴 mock 掉 server action 模組(transitively 拉 next/cache / composition / server-only,jsdom 載不了)。

const actionMock =
  vi.fn<(prev: RefundActionState, form: FormData) => Promise<RefundActionState>>();
vi.mock('../../lib/payment/refund-actions', () => ({
  initiateRefundAction: (prev: RefundActionState, form: FormData) => actionMock(prev, form),
}));
// useRouter 需要 app router context;jsdom 沒有 ⇒ mock 成只記呼叫的假 router(procurement 同款)
const routerRefresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: routerRefresh }) }));

import { RefundSection } from './refund-section';

const ORDER_ID = '3f2f2c1e-0000-4000-8000-000000000001';
const TOKEN = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function tokenInput(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>('input[name="request_token"]');
  if (!el) throw new Error('request_token hidden input 不在');
  return el;
}
function amountInput(container: HTMLElement): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>('input[name="amount"]');
}

beforeEach(() => {
  actionMock.mockReset();
  actionMock.mockResolvedValue({ status: 'idle', requestToken: TOKEN });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** #350d-4:表單的 `return_to` 值(站內 /orders 路徑,過得了 parser)。 */
const RETURN_TO = '/orders?payment_status=paid';

describe('#350d-4 return_to 這一跳(表單 → action)', () => {
  // 🔴🔴 元件收了 prop、action 讀了欄位,但**中間那顆 hidden input 沒有人數** ⇒ 刪掉它全套照樣綠,
  //    而正式站每次退款都靜默走 fallback、把面板關掉(取消線 R1 must-fix 2 的同型)。
  //    突變:拿掉 `<input name={ORDER_RETURN_TO_FIELD}>` ⇒ 這格紅。
  it('送出去的 FormData 帶著逐字相同的 return_to,而且是 hidden input', () => {
    const { container } = render(
      <RefundSection returnTo={RETURN_TO} orderId={ORDER_ID} serverToken={TOKEN} />,
    );
    const form = container.querySelector('form');
    if (form === null) throw new Error('沒有 form 可以送出');
    expect(new FormData(form).getAll('return_to')).toEqual([RETURN_TO]);
    const els = Array.from(container.querySelectorAll('[name="return_to"]'));
    expect(els).toHaveLength(1);
    expect(els[0]?.tagName).toBe('INPUT');
    expect(els[0]?.getAttribute('type')).toBe('hidden');
  });
});

describe('RefundSection — RW2d', () => {
  it('[1] 初始:預設全額、amount 欄不在 DOM;hidden order_id / token = serverToken', () => {
    const { container, getByRole } = render(
      <RefundSection returnTo={RETURN_TO} orderId={ORDER_ID} serverToken={TOKEN} />,
    );
    expect(
      container.querySelector<HTMLInputElement>('input[name="order_id"]')?.value,
    ).toBe(ORDER_ID);
    expect(tokenInput(container).value).toBe(TOKEN);
    expect(amountInput(container)).toBeNull();
    expect(getByRole('button', { name: '全額退款' })).toBeTruthy();
  });

  it('[2] 契約債①:切部分→打金額→切回全額 = amount 欄整個消失;再切回部分 = 值已清空', () => {
    const { container, getByLabelText } = render(
      <RefundSection returnTo={RETURN_TO} orderId={ORDER_ID} serverToken={TOKEN} />,
    );
    fireEvent.click(getByLabelText('部分退款'));
    const amount = amountInput(container);
    expect(amount).not.toBeNull();
    fireEvent.change(amount!, { target: { value: '500' } });
    expect(amount!.value).toBe('500');
    fireEvent.click(getByLabelText('全額退款'));
    expect(amountInput(container)).toBeNull();
    fireEvent.click(getByLabelText('部分退款'));
    expect(amountInput(container)!.value).toBe('');
  });

  it('[3] full 送出:FormData 結構上不帶 amount 鍵;kind/order_id/token/確認碼/原因齊', async () => {
    const { container, getByLabelText } = render(
      <RefundSection returnTo={RETURN_TO} orderId={ORDER_ID} serverToken={TOKEN} />,
    );
    fireEvent.change(getByLabelText('確認碼(訂單號末 4 碼)'), { target: { value: '1234' } });
    fireEvent.change(getByLabelText('退款原因'), { target: { value: '缺貨退款' } });
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(actionMock.mock.calls.length).toBe(1));
    const form = actionMock.mock.calls[0]![1];
    expect(form.has('amount')).toBe(false);
    expect(form.get('kind')).toBe('full');
    expect(form.get('order_id')).toBe(ORDER_ID);
    expect(form.get('request_token')).toBe(TOKEN);
    expect(form.get('confirm_code')).toBe('1234');
    expect(form.get('reason')).toBe('缺貨退款');
  });

  it('[4] partial 送出:amount 進 FormData', async () => {
    const { container, getByLabelText } = render(
      <RefundSection returnTo={RETURN_TO} orderId={ORDER_ID} serverToken={TOKEN} />,
    );
    fireEvent.click(getByLabelText('部分退款'));
    fireEvent.change(amountInput(container)!, { target: { value: '3' } });
    fireEvent.change(getByLabelText('確認碼(訂單號末 4 碼)'), { target: { value: '5678' } });
    fireEvent.change(getByLabelText('退款原因'), { target: { value: '部分缺貨' } });
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(actionMock.mock.calls.length).toBe(1));
    const form = actionMock.mock.calls[0]![1];
    expect(form.get('kind')).toBe('partial');
    expect(form.get('amount')).toBe('3');
  });

  it('[4b] 稽核 P1-4:partialBlockedReason 非 null ⇒ 部分退款停用、原因印出來;全額照常可選', () => {
    const { getByLabelText, getByTestId } = render(
      <RefundSection
        returnTo={RETURN_TO}
        orderId={ORDER_ID}
        serverToken={TOKEN}
        partialBlockedReason='銀行還沒完成請款,現在只能全額退款;請款完成後才能部分退款。'
      />,
    );
    expect((getByLabelText('部分退款') as HTMLInputElement).disabled).toBe(true);
    expect((getByLabelText('全額退款') as HTMLInputElement).disabled).toBe(false);
    expect(getByTestId('partial-refund-blocked-reason').textContent).toContain('銀行還沒完成請款');
  });

  it('[4d] 稽核 P1-4 R2 n1:失敗回填 kind=partial 而原因非 null ⇒ partial 不停用、送出帶 kind=partial', async () => {
    actionMock.mockResolvedValue(
      refundFailure('not_captured', { kind: 'partial', amount: '3', reason: 'r', confirmCode: '0000' }, TOKEN),
    );
    const { container, findByRole, getByLabelText } = render(
      <RefundSection returnTo={RETURN_TO} orderId={ORDER_ID} serverToken={TOKEN} partialBlockedReason='x' />,
    );
    fireEvent.submit(container.querySelector('form')!);
    await findByRole('alert');
    await waitFor(() => expect((getByLabelText('部分退款') as HTMLInputElement).checked).toBe(true));
    expect((getByLabelText('部分退款') as HTMLInputElement).disabled).toBe(false);
    expect(new FormData(container.querySelector('form')!).get('kind')).toBe('partial');
  });

  it('[4c] partialBlockedReason 沒傳 ⇒ 部分退款照舊可選、沒有原因句(正對照)', () => {
    const { getByLabelText, queryByTestId } = render(
      <RefundSection returnTo={RETURN_TO} orderId={ORDER_ID} serverToken={TOKEN} />,
    );
    expect((getByLabelText('部分退款') as HTMLInputElement).disabled).toBe(false);
    expect(queryByTestId('partial-refund-blocked-reason')).toBeNull();
  });

  it('[5] 失敗 state:alert 顯訊息、token 用 state 那把(原樣帶回)、輸入套回畫面', async () => {
    const failedState = refundFailure(
      'confirm_mismatch',
      { kind: 'partial', amount: '3', reason: '部分缺貨', confirmCode: '0000' },
      'ffffffff-0000-4000-8000-000000000009',
    );
    actionMock.mockResolvedValue(failedState);
    const { container, findByRole, getByLabelText } = render(
      <RefundSection returnTo={RETURN_TO} orderId={ORDER_ID} serverToken={TOKEN} />,
    );
    fireEvent.submit(container.querySelector('form')!);
    const alert = await findByRole('alert');
    expect(alert.textContent).toContain('確認碼與訂單號末 4 碼不符');
    // confirm_mismatch ∉ FRESH_TOKEN_CODES ⇒ refundFailure 原樣帶回;hidden 必須用 state 那把。
    expect(tokenInput(container).value).toBe('ffffffff-0000-4000-8000-000000000009');
    // 輸入套回(A10b finding 2 同型:effect 套 state.input,不靠 useState 初值)
    await waitFor(() => expect(amountInput(container)?.value).toBe('3'));
    expect((getByLabelText('退款原因') as HTMLInputElement).value).toBe('部分缺貨');
    expect((getByLabelText('確認碼(訂單號末 4 碼)') as HTMLInputElement).value).toBe('0000');
  });

  it('[6] 終態失敗(deferred ∈ FRESH_TOKEN_CODES):hidden token = state 換發的新把', async () => {
    const failedState = refundFailure(
      'deferred',
      { kind: 'partial', amount: '3', reason: 'r', confirmCode: '1234' },
      TOKEN,
    );
    // refundFailure 對 FRESH_TOKEN_CODES 已換新鍵 —— 前提自斷言,防上游規則變動讓本格恆真。
    expect(failedState.status).toBe('failed');
    const fresh = failedState.status === 'failed' ? failedState.requestToken : '';
    expect(fresh).not.toBe(TOKEN);
    actionMock.mockResolvedValue(failedState);
    const { container, findByRole } = render(
      <RefundSection returnTo={RETURN_TO} orderId={ORDER_ID} serverToken={TOKEN} />,
    );
    fireEvent.submit(container.querySelector('form')!);
    await findByRole('alert');
    expect(tokenInput(container).value).toBe(fresh);
  });

  it('[7] denied:input 空殼不得清掉員工輸入(refund-action-state.ts:169 例外)', async () => {
    actionMock.mockResolvedValue(
      refundFailure('denied', EMPTY_REFUND_INPUT, 'ffffffff-0000-4000-8000-000000000009'),
    );
    const { container, findByRole, getByLabelText } = render(
      <RefundSection returnTo={RETURN_TO} orderId={ORDER_ID} serverToken={TOKEN} />,
    );
    fireEvent.change(getByLabelText('確認碼(訂單號末 4 碼)'), { target: { value: '9999' } });
    fireEvent.change(getByLabelText('退款原因'), { target: { value: '員工打了一半的原因' } });
    fireEvent.submit(container.querySelector('form')!);
    await findByRole('alert');
    expect((getByLabelText('退款原因') as HTMLInputElement).value).toBe('員工打了一半的原因');
    expect((getByLabelText('確認碼(訂單號末 4 碼)') as HTMLInputElement).value).toBe('9999');
  });

  it('[7b] disabled:input 是真輸入、必須套回(與 denied 空殼相反;R1 N3/N6①——這格擋「把 disabled 也加進跳過清單」的誤修)', async () => {
    actionMock.mockResolvedValue(
      refundFailure(
        'disabled',
        { kind: 'partial', amount: '7', reason: '旗標關著時打的原因', confirmCode: '4321' },
        TOKEN,
      ),
    );
    const { container, findByRole, getByLabelText } = render(
      <RefundSection returnTo={RETURN_TO} orderId={ORDER_ID} serverToken={TOKEN} />,
    );
    fireEvent.submit(container.querySelector('form')!);
    await findByRole('alert');
    await waitFor(() => expect(amountInput(container)?.value).toBe('7'));
    expect((getByLabelText('退款原因') as HTMLInputElement).value).toBe('旗標關著時打的原因');
    expect((getByLabelText('確認碼(訂單號末 4 碼)') as HTMLInputElement).value).toBe('4321');
  });

  it('[8] pending:fieldset 全鎖 —— 按鈕與每個欄位都 disabled(codex MF2:欄位可編輯=「眼前值」與「正在動的錢」分岔)', async () => {
    // 🔴 promise 要在斷言完放掉:React 19 的 async action 是全域 entangle 的,
    //    一個永不 resolve 的 action 會讓本檔之後所有「等 action 回來」的測試一起卡在送出中(走查 D 那組撞到)。
    let release: (s: RefundActionState) => void = () => {};
    actionMock.mockImplementation(() => new Promise<RefundActionState>((resolve) => { release = resolve; }));
    const { container, getByRole, getByLabelText, queryByRole } = render(
      <RefundSection returnTo={RETURN_TO} orderId={ORDER_ID} serverToken={TOKEN} />,
    );
    fireEvent.click(getByLabelText('部分退款'));
    fireEvent.change(amountInput(container)!, { target: { value: '100' } });
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => {
      expect(getByRole('button', { name: '送出中…' })).toHaveProperty('disabled', true);
    });
    // fieldset disabled ⇒ matches(':disabled') 對每個後代控制項為真
    for (const el of container.querySelectorAll<HTMLInputElement>(
      'input[name], button[type="submit"]',
    )) {
      expect(el.matches(':disabled'), `${el.name || 'submit'} 應被鎖`).toBe(true);
    }
    release({ status: 'idle', requestToken: TOKEN });
    await waitFor(() => expect(queryByRole('button', { name: '送出中…' })).toBeNull());
  });

  it('[9] pageshow persisted → 只 router.refresh、token 絕不 client 換鍵(codex MF1:換鍵=拆掉 G4 重送保護=雙退窗);非 persisted 不 refresh', () => {
    const { container } = render(<RefundSection returnTo={RETURN_TO} orderId={ORDER_ID} serverToken={TOKEN} />);
    const persistedShow = new Event('pageshow');
    Object.defineProperty(persistedShow, 'persisted', { value: true });
    fireEvent(window, persistedShow);
    expect(routerRefresh.mock.calls.length).toBe(1);
    // 🔴 本格的主角:token 必須原封不動 —— 舊鍵撞 G4 才是重送保護;新鍵只准從 server 來。
    expect(tokenInput(container).value).toBe(TOKEN);
    fireEvent(window, new Event('pageshow'));
    expect(routerRefresh.mock.calls.length).toBe(1);
  });

  it('[9b] refresh 帶回新 serverToken → 表單用新把(新鍵唯一合法來源=server 渲染)', () => {
    const NEW_TOKEN = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
    const { container, rerender } = render(
      <RefundSection returnTo={RETURN_TO} orderId={ORDER_ID} serverToken={TOKEN} />,
    );
    rerender(<RefundSection returnTo={RETURN_TO} orderId={ORDER_ID} serverToken={NEW_TOKEN} />);
    expect(tokenInput(container).value).toBe(NEW_TOKEN);
  });

  it('[10] 單行原因欄:輸入不可能含換行(控制字元會被解析器/RPC 拒 ⇒ 結構上不給輸入)', () => {
    const { getByLabelText } = render(<RefundSection returnTo={RETURN_TO} orderId={ORDER_ID} serverToken={TOKEN} />);
    const reason = getByLabelText('退款原因') as HTMLInputElement;
    expect(reason.tagName).toBe('INPUT');
    expect(reason.maxLength).toBe(200);
  });
});

// 2026-09-15 走查 D:送出失敗回來, `<form action>` 自動 reset 把 radio DOM 打回全額 ⇒ 照畫面再按送出 kind=full,
//   再失敗一次就整張翻成全額退款表單。action 照實回傳送出的那份(server 的 carryBack 就是這樣做)。
function echoFailure(code: 'not_captured' | 'no_card_transaction') {
  return async (_prev: RefundActionState, form: FormData): Promise<RefundActionState> =>
    refundFailure(
      code,
      {
        kind: String(form.get('kind') ?? ''),
        amount: String(form.get('amount') ?? ''),
        reason: String(form.get('reason') ?? ''),
        confirmCode: String(form.get('confirm_code') ?? ''),
      },
      TOKEN,
    );
}

describe('走查 D:失敗回來不得把員工選的退款種類改掉', () => {
  function fillPartial(container: HTMLElement, getByLabelText: (t: string) => HTMLElement) {
    fireEvent.click(getByLabelText('部分退款'));
    fireEvent.change(amountInput(container)!, { target: { value: '500' } });
    fireEvent.change(getByLabelText('確認碼(訂單號末 4 碼)'), { target: { value: '1003' } });
    fireEvent.change(getByLabelText('退款原因'), { target: { value: '部分缺貨' } });
  }

  it('[D1] 部分退款失敗一次:仍勾部分、金額還在、再送出的 kind 是 partial', async () => {
    actionMock.mockImplementation(echoFailure('no_card_transaction'));
    const { container, findByRole, getByLabelText, getByRole } = render(
      <RefundSection returnTo={RETURN_TO} orderId={ORDER_ID} serverToken={TOKEN} />,
    );
    fillPartial(container, getByLabelText);
    fireEvent.submit(container.querySelector('form')!);
    await findByRole('alert');
    await waitFor(() => expect((getByLabelText('部分退款') as HTMLInputElement).checked).toBe(true));
    expect((getByLabelText('全額退款') as HTMLInputElement).checked).toBe(false);
    expect(amountInput(container)?.value).toBe('500');
    expect(getByRole('button', { name: '部分退款' })).toBeTruthy();
    const form = new FormData(container.querySelector('form')!);
    expect(form.getAll('kind')).toEqual(['partial']);
    expect(form.get('amount')).toBe('500');
  });

  it('[D2] 部分退款連續失敗兩次:第二次送出仍是 partial,畫面沒有翻成全額退款表單', async () => {
    actionMock.mockImplementation(echoFailure('not_captured'));
    const { container, findByRole, getByLabelText, queryByRole } = render(
      <RefundSection returnTo={RETURN_TO} orderId={ORDER_ID} serverToken={TOKEN} />,
    );
    fillPartial(container, getByLabelText);
    fireEvent.submit(container.querySelector('form')!);
    await findByRole('alert');
    await waitFor(() => expect(actionMock.mock.calls.length).toBe(1));
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(actionMock.mock.calls.length).toBe(2));
    expect(actionMock.mock.calls[1]![1].get('kind')).toBe('partial');
    expect(actionMock.mock.calls[1]![1].get('amount')).toBe('500');
    await waitFor(() => expect((getByLabelText('部分退款') as HTMLInputElement).checked).toBe(true));
    expect(amountInput(container)?.value).toBe('500');
    expect(queryByRole('button', { name: '全額退款' })).toBeNull();
  });

  it('[D3] 回填不得自動翻成全額:state 帶回 kind=full 而員工選著部分 ⇒ 仍是部分', async () => {
    actionMock.mockResolvedValue(
      refundFailure('not_captured', { kind: 'full', amount: '', reason: '部分缺貨', confirmCode: '1003' }, TOKEN),
    );
    const { container, findByRole, getByLabelText, queryByRole } = render(
      <RefundSection returnTo={RETURN_TO} orderId={ORDER_ID} serverToken={TOKEN} />,
    );
    fillPartial(container, getByLabelText);
    fireEvent.submit(container.querySelector('form')!);
    await findByRole('alert');
    await waitFor(() => expect((getByLabelText('部分退款') as HTMLInputElement).checked).toBe(true));
    expect(new FormData(container.querySelector('form')!).get('kind')).toBe('partial');
    expect(queryByRole('button', { name: '全額退款' })).toBeNull();
  });

  it('[D5] 畫面勾部分而 state 還是全額(hydration 前先點、瀏覽器還原表單)⇒ 送出的是 partial 不是 full', () => {
    // adversarial-reviewer R1 F1:「kind 改由 hidden input 從 state 帶」會把這個畫面送成合法全額退款。
    //   radio 直接送出 ⇒ kind=partial 沒金額 ⇒ 解析器判無效、錢不動。這格擋那個改法回來。
    const { container, getByLabelText } = render(
      <RefundSection returnTo={RETURN_TO} orderId={ORDER_ID} serverToken={TOKEN} />,
    );
    (getByLabelText('部分退款') as HTMLInputElement).checked = true;
    const form = new FormData(container.querySelector('form')!);
    expect(form.getAll('kind')).toEqual(['partial']);
    expect(form.has('amount')).toBe(false);
  });

  it('[D4] 正對照:員工本來就選全額,失敗回來仍是全額、不帶金額欄', async () => {
    actionMock.mockImplementation(echoFailure('no_card_transaction'));
    const { container, findByRole, getByLabelText, getByRole } = render(
      <RefundSection returnTo={RETURN_TO} orderId={ORDER_ID} serverToken={TOKEN} />,
    );
    fireEvent.change(getByLabelText('確認碼(訂單號末 4 碼)'), { target: { value: '1003' } });
    fireEvent.change(getByLabelText('退款原因'), { target: { value: '整單退' } });
    fireEvent.submit(container.querySelector('form')!);
    await findByRole('alert');
    expect((getByLabelText('全額退款') as HTMLInputElement).checked).toBe(true);
    expect(amountInput(container)).toBeNull();
    expect(getByRole('button', { name: '全額退款' })).toBeTruthy();
    const form = new FormData(container.querySelector('form')!);
    expect(form.getAll('kind')).toEqual(['full']);
    expect(form.has('amount')).toBe(false);
  });
});
