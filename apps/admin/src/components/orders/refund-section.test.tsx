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
    actionMock.mockImplementation(() => new Promise(() => {}));
    const { container, getByRole, getByLabelText } = render(
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
