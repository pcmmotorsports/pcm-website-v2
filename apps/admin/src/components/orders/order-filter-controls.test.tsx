// @vitest-environment jsdom
// order-filter-controls.test.tsx — D-1b 篩選互動核心(值班台 MF-1 修復驗證:連勾不丟值)。
// 🔴 測試設計:mock 的 useRouter.replace 不觸發任何 re-render/props 更新=模擬 RSC 往返未完成
// (部署延遲數百 ms)的窗;此窗內連續互動若基底取 stale 快照就會互相蓋寫——斷言全數保留。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { OrderFilterControls } from './order-filter-controls';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

const PROPS = {
  paymentOptions: [{ value: 'paid', label: '已付款' }],
  fulfillmentOptions: [{ value: 'shipped', label: '已出貨' }],
  sourceOptions: [
    { value: 'web', label: '網站' },
    { value: 'manual_line', label: 'LINE' },
  ],
  channelOptions: [{ value: 'tappay', label: '線上刷卡' }],
  initial: { pay: '', ful: '', src: [], ch: [], no: '', supplierNo: '' },
};

beforeEach(() => replace.mockClear());
afterEach(cleanup);

function nthButton(getAllByRole: ReturnType<typeof render>['getAllByRole'], index: number) {
  const el = getAllByRole('button')[index];
  if (!el) throw new Error(`button[${index}] 不存在`);
  return el;
}

function openPanel(getAllByRole: ReturnType<typeof render>['getAllByRole'], index: number) {
  fireEvent.click(nthButton(getAllByRole, index));
}

describe('OrderFilterControls — MF-1 連勾不丟值(props 凍結窗內)', () => {
  // 🔴 A9w2:這一組原本拿「商品狀態」軸當載具,而那個軸隨九碼退場已下架。
  //    被測的行為(多勾選軸的連勾競態、被超越回音不採用)**仍然活著**於來源/管道兩軸
  //    ⇒ 改用來源軸重寫,不是刪掉 —— 刪掉會讓 MF-1 那條修復從此無人看守。
  //    移除後觸發鈕只剩 [來源, 管道](單選軸無 button)⇒ index 0=來源、1=管道。
  it('同軸快速連勾兩項 → 第二次 replace 帶兩值、兩 checkbox 皆勾(無回彈)', () => {
    const r = render(<OrderFilterControls {...PROPS} />);
    openPanel(r.getAllByRole, 0);
    fireEvent.click(r.getByLabelText('網站'));
    fireEvent.click(r.getByLabelText('LINE'));
    expect(replace).toHaveBeenLastCalledWith(
      '/orders?order_source=web&order_source=manual_line',
      { scroll: false },
    );
    expect((r.getByLabelText('網站') as HTMLInputElement).checked).toBe(true);
    expect((r.getByLabelText('LINE') as HTMLInputElement).checked).toBe(true);
  });

  it('跨軸交錯(來源→付款單選→管道)→ 最終 replace 三軸俱在、URL 無 page/r', () => {
    const r = render(<OrderFilterControls {...PROPS} />);
    openPanel(r.getAllByRole, 0);
    fireEvent.click(r.getByLabelText('網站'));
    fireEvent.change(r.getByLabelText('付款狀態'), { target: { value: 'paid' } });
    openPanel(r.getAllByRole, 1);
    fireEvent.click(r.getByLabelText('線上刷卡'));
    expect(replace).toHaveBeenLastCalledWith(
      '/orders?payment_status=paid&order_source=web&payment_channel=tappay',
      { scroll: false },
    );
  });

  it('取消勾選 → 該值移除;全清 → 乾淨 /orders', () => {
    const r = render(
      <OrderFilterControls {...PROPS} initial={{ ...PROPS.initial, src: ['web'] }} />,
    );
    openPanel(r.getAllByRole, 0);
    fireEvent.click(r.getByLabelText('網站'));
    expect(replace).toHaveBeenLastCalledWith('/orders', { scroll: false });
  });

  it('已勾數 badge:未勾顯「全部」、勾 2 顯 2', () => {
    const r = render(
      <OrderFilterControls
        {...PROPS}
        initial={{ ...PROPS.initial, src: ['web', 'manual_line'] }}
      />,
    );
    expect(nthButton(r.getAllByRole, 0).textContent).toContain('2');
    r.unmount();
    const clean = render(<OrderFilterControls {...PROPS} />);
    expect(nthButton(clean.getAllByRole, 0).textContent).toContain('全部');
  });

  it('nit-1:push 後餵舊回音 props → state 不回退;最終收斂回音 → 採用(no-op)', () => {
    const r = render(<OrderFilterControls {...PROPS} />);
    openPanel(r.getAllByRole, 0);
    fireEvent.click(r.getByLabelText('網站'));
    fireEvent.click(r.getByLabelText('LINE'));
    // 被超越舊導航的 RSC 仍被 commit=舊回音(只含第一勾)→ 不採、B 不掉勾
    r.rerender(<OrderFilterControls {...PROPS} initial={{ ...PROPS.initial, src: ['web'] }} />);
    expect((r.getByLabelText('LINE') as HTMLInputElement).checked).toBe(true);
    // 最終推送的收斂回音 → 採用(內容相同=no-op)
    r.rerender(
      <OrderFilterControls
        {...PROPS}
        initial={{ ...PROPS.initial, src: ['web', 'manual_line'] }}
      />,
    );
    expect((r.getByLabelText('網站') as HTMLInputElement).checked).toBe(true);
    expect((r.getByLabelText('LINE') as HTMLInputElement).checked).toBe(true);
  });

  it('🔴 A9w2:商品狀態軸真的不見了(下架後不得再渲染那個面板)', () => {
    const r = render(<OrderFilterControls {...PROPS} />);
    expect(r.queryByText('商品狀態')).toBeNull();
    // 觸發鈕只剩兩顆多勾選軸(來源 / 管道);多一顆 = 有人把九碼軸掛回來了。
    expect(r.getAllByRole('button').length).toBe(2);
  });
});

// ── M-4b E10 A10c1:單號搜尋輸入框 ──────────────────────────────────────────
describe('OrderFilterControls — A10c1 單號搜尋', () => {
  it('flag 未開 → 完全不渲染搜尋框(D0 apply 前的預設狀態)', () => {
    const { queryByLabelText } = render(<OrderFilterControls {...PROPS} />);
    expect(queryByLabelText('訂單編號')).toBeNull();
  });

  it('flag 開啟 → 輸入單號按 Enter 才送出(打字中不查詢)', () => {
    const { getByLabelText } = render(
      <OrderFilterControls {...PROPS} orderNumberSearchEnabled />,
    );
    const input = getByLabelText('訂單編號');
    fireEvent.change(input, { target: { value: 'YWP3PC' } });
    expect(replace).not.toHaveBeenCalled(); // 每打一個字就查 = 又吵又慢
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0]?.[0]).toContain('order_no=YWP3PC');
  });

  it('舊格式單號同樣送得出去(改號後客服拿舊號來查)', () => {
    const { getByLabelText } = render(
      <OrderFilterControls {...PROPS} orderNumberSearchEnabled />,
    );
    const input = getByLabelText('訂單編號');
    fireEvent.change(input, { target: { value: 'PCM-2026-0104' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(replace.mock.calls[0]?.[0]).toContain('order_no=PCM-2026-0104');
  });

  it('🔴 送出後再改其他篩選,單號不得被丟掉(href 由 state 全量導出、漏帶就 fail-open)', () => {
    const { getByLabelText, getAllByRole } = render(
      <OrderFilterControls {...PROPS} orderNumberSearchEnabled />,
    );
    const input = getByLabelText('訂單編號');
    fireEvent.change(input, { target: { value: 'YWP3PC' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    replace.mockClear();

    // 改付款狀態(AutoApplySelect;第一個 select 是付款軸)
    const selects = getAllByRole('combobox');
    const paySelect = selects[0];
    if (!paySelect) throw new Error('付款狀態 select 不存在');
    fireEvent.change(paySelect, { target: { value: 'paid' } });

    const href = replace.mock.calls[0]?.[0] as string;
    expect(href).toContain('payment_status=paid');
    expect(href, '改其他篩選時單號被丟掉 = 列表悄悄變回全部訂單').toContain('order_no=YWP3PC');
  });

  it('清空搜尋框送出 → URL 不再帶 order_no(等於取消搜尋)', () => {
    const { getByLabelText } = render(
      <OrderFilterControls
        {...PROPS}
        orderNumberSearchEnabled
        initial={{ ...PROPS.initial, no: 'YWP3PC' }}
      />,
    );
    const input = getByLabelText('訂單編號');
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(replace.mock.calls[0]?.[0]).not.toContain('order_no');
  });

  it('initial.no 有值時輸入框要顯示出來(整頁載入後看得到自己搜了什麼)', () => {
    const { getByLabelText } = render(
      <OrderFilterControls
        {...PROPS}
        orderNumberSearchEnabled
        initial={{ ...PROPS.initial, no: 'PCM-2026-0104' }}
      />,
    );
    expect((getByLabelText('訂單編號') as HTMLInputElement).value).toBe(
      'PCM-2026-0104',
    );
  });
});

// A10c1 補強(code-reviewer nit):輸入框與其他軸的競態、以及 form 的送出入口
describe('OrderFilterControls — A10c1 邊界', () => {
  it('🔴 邊等其他軸的回音邊打字,打到一半的字不得被清空', () => {
    const r = render(<OrderFilterControls {...PROPS} orderNumberSearchEnabled />);
    const input = () => r.getByLabelText('訂單編號') as HTMLInputElement;

    // 先改別軸(replace 在途、props 尚未追上)
    const paySelect = r.getAllByRole('combobox')[0];
    if (!paySelect) throw new Error('付款狀態 select 不存在');
    fireEvent.change(paySelect, { target: { value: 'paid' } });

    // 使用者邊等邊打字
    fireEvent.change(input(), { target: { value: 'YWP3' } });

    // 收斂回音進來(內容 = 我方最後推送的 state)
    r.rerender(
      <OrderFilterControls
        {...PROPS}
        orderNumberSearchEnabled
        initial={{ ...PROPS.initial, pay: 'paid' }}
      />,
    );
    expect(input().value, '回音採用時把打到一半的字清掉 = 使用者白打').toBe('YWP3');
  });

  it('外部導航真的換了單號時,輸入框要跟著換', () => {
    const r = render(
      <OrderFilterControls
        {...PROPS}
        orderNumberSearchEnabled
        initial={{ ...PROPS.initial, no: 'YWP3PC' }}
      />,
    );
    r.rerender(
      <OrderFilterControls
        {...PROPS}
        orderNumberSearchEnabled
        initial={{ ...PROPS.initial, no: 'BKPR5M' }}
      />,
    );
    expect((r.getByLabelText('訂單編號') as HTMLInputElement).value).toBe('BKPR5M');
  });

  it('form 有明確的 submit 控制項(不靠 implicit submission、螢幕閱讀器也按得到)', () => {
    const { getByRole } = render(<OrderFilterControls {...PROPS} orderNumberSearchEnabled />);
    const btn = getByRole('button', { name: '搜尋訂單編號' });
    expect((btn as HTMLButtonElement).type).toBe('submit');
  });

  it('🔴 input 不得有 name:form 無 action,hydration 前按 Enter 會走原生 GET 而清掉其他篩選', () => {
    const { getByLabelText } = render(
      <OrderFilterControls {...PROPS} orderNumberSearchEnabled />,
    );
    expect((getByLabelText('訂單編號') as HTMLInputElement).getAttribute('name')).toBeNull();
  });

  it('🔴 不得用 type=search:原生 × 與 Esc 只清草稿不送出,會讓人以為搜尋已取消', () => {
    const { getByLabelText } = render(
      <OrderFilterControls {...PROPS} orderNumberSearchEnabled />,
    );
    expect((getByLabelText('訂單編號') as HTMLInputElement).type).toBe('text');
  });
});

describe('OrderFilterControls — A10c2 供應商單號搜尋', () => {
  it('flag 未開 → 完全不渲染(A9b2-M apply 前的預設狀態)', () => {
    const { queryByLabelText } = render(<OrderFilterControls {...PROPS} />);
    expect(queryByLabelText('供應商單號')).toBeNull();
  });

  it('🔴 兩個 flag 互相獨立 —— 開單號搜尋不會順便把供應商搜尋也開出來', () => {
    const { queryByLabelText } = render(
      <OrderFilterControls {...PROPS} orderNumberSearchEnabled />,
    );
    expect(queryByLabelText('訂單編號')).not.toBeNull();
    expect(queryByLabelText('供應商單號')).toBeNull();
  });

  it('flag 開啟 → 輸入後按 Enter 才送出(打字中不查詢)', () => {
    const { getByLabelText } = render(
      <OrderFilterControls {...PROPS} supplierOrderNoSearchEnabled />,
    );
    const input = getByLabelText('供應商單號');
    fireEvent.change(input, { target: { value: 'SO-123' } });
    expect(replace).not.toHaveBeenCalled();
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0]?.[0]).toContain('supplier_no=SO-123');
  });

  it('🔴 兩個搜尋框各自獨立的 form —— 在供應商框按 Enter 不得把訂單編號清掉', () => {
    const { getByLabelText } = render(
      <OrderFilterControls {...PROPS} orderNumberSearchEnabled supplierOrderNoSearchEnabled />,
    );
    const orderInput = getByLabelText('訂單編號');
    fireEvent.change(orderInput, { target: { value: 'YWP3PC' } });
    fireEvent.submit(orderInput.closest('form') as HTMLFormElement);
    replace.mockClear();

    const supplierInput = getByLabelText('供應商單號');
    fireEvent.change(supplierInput, { target: { value: 'SO-1' } });
    fireEvent.submit(supplierInput.closest('form') as HTMLFormElement);

    const href = replace.mock.calls[0]?.[0] as string;
    expect(href).toContain('supplier_no=SO-1');
    // 漏掉這半邊 = 搜了供應商單號就把訂單編號靜默丟掉(href 由 state 全量導出的老坑)
    expect(href).toContain('order_no=YWP3PC');
  });

  it('🔴 送出後再改其他篩選,供應商單號不得被丟掉', () => {
    const { getByLabelText, getAllByRole } = render(
      <OrderFilterControls {...PROPS} supplierOrderNoSearchEnabled />,
    );
    const input = getByLabelText('供應商單號');
    fireEvent.change(input, { target: { value: 'SO-1' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    replace.mockClear();

    const paySelect = getAllByRole('combobox')[0];
    if (!paySelect) throw new Error('付款狀態 select 不存在');
    fireEvent.change(paySelect, { target: { value: 'paid' } });
    expect(replace.mock.calls[0]?.[0]).toContain('supplier_no=SO-1');
  });

  it('送出前 trim(貼上時常帶前後空白)', () => {
    const { getByLabelText } = render(
      <OrderFilterControls {...PROPS} supplierOrderNoSearchEnabled />,
    );
    const input = getByLabelText('供應商單號');
    fireEvent.change(input, { target: { value: '  SO-9  ' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(replace.mock.calls[0]?.[0]).toContain('supplier_no=SO-9');
  });
});
