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
  workflowOptions: [
    { value: 'paid_wait', label: '已收未定' },
    { value: 'shipped_done', label: '出貨完成' },
    { value: 'unset', label: '未設定' },
  ],
  paymentOptions: [{ value: 'paid', label: '已付款' }],
  fulfillmentOptions: [{ value: 'shipped', label: '已出貨' }],
  sourceOptions: [
    { value: 'web', label: '網站' },
    { value: 'manual_line', label: 'LINE' },
  ],
  channelOptions: [{ value: 'tappay', label: '線上刷卡' }],
  initial: { wf: [], pay: '', ful: '', src: [], ch: [] },
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
  it('同軸快速連勾兩項 → 第二次 replace 帶兩值、兩 checkbox 皆勾(無回彈)', () => {
    const r = render(<OrderFilterControls {...PROPS} />);
    openPanel(r.getAllByRole, 0);
    fireEvent.click(r.getByLabelText('已收未定'));
    fireEvent.click(r.getByLabelText('出貨完成'));
    expect(replace).toHaveBeenLastCalledWith(
      '/orders?workflow_status=paid_wait&workflow_status=shipped_done',
      { scroll: false },
    );
    expect((r.getByLabelText('已收未定') as HTMLInputElement).checked).toBe(true);
    expect((r.getByLabelText('出貨完成') as HTMLInputElement).checked).toBe(true);
  });

  it('跨軸交錯(商品狀態→付款單選→來源)→ 最終 replace 三軸俱在、URL 無 page/r', () => {
    const r = render(<OrderFilterControls {...PROPS} />);
    openPanel(r.getAllByRole, 0);
    fireEvent.click(r.getByLabelText('已收未定'));
    fireEvent.change(r.getByLabelText('付款狀態'), { target: { value: 'paid' } });
    openPanel(r.getAllByRole, 1); // buttons=[商品狀態, 來源, 管道] 觸發鈕(單選軸無 button)→ index 1=來源
    fireEvent.click(r.getByLabelText('網站'));
    expect(replace).toHaveBeenLastCalledWith(
      '/orders?workflow_status=paid_wait&payment_status=paid&order_source=web',
      { scroll: false },
    );
  });

  it('取消勾選 → 該值移除;全清 → 乾淨 /orders', () => {
    const r = render(
      <OrderFilterControls {...PROPS} initial={{ ...PROPS.initial, wf: ['paid_wait'] }} />,
    );
    openPanel(r.getAllByRole, 0);
    fireEvent.click(r.getByLabelText('已收未定'));
    expect(replace).toHaveBeenLastCalledWith('/orders', { scroll: false });
  });

  it('已勾數 badge:未勾顯「全部」、勾 2 顯 2', () => {
    const r = render(
      <OrderFilterControls {...PROPS} initial={{ ...PROPS.initial, wf: ['paid_wait', 'unset'] }} />,
    );
    expect(nthButton(r.getAllByRole, 0).textContent).toContain('2');
    r.unmount();
    const clean = render(<OrderFilterControls {...PROPS} />);
    expect(nthButton(clean.getAllByRole, 0).textContent).toContain('全部');
  });

  it('nit-1:push 後餵舊回音 props → state 不回退;最終收斂回音 → 採用(no-op)', () => {
    const r = render(<OrderFilterControls {...PROPS} />);
    openPanel(r.getAllByRole, 0);
    fireEvent.click(r.getByLabelText('已收未定'));
    fireEvent.click(r.getByLabelText('出貨完成'));
    // 被超越舊導航的 RSC 仍被 commit=舊回音(只含第一勾)→ 不採、B 不掉勾
    r.rerender(
      <OrderFilterControls {...PROPS} initial={{ ...PROPS.initial, wf: ['paid_wait'] }} />,
    );
    expect((r.getByLabelText('出貨完成') as HTMLInputElement).checked).toBe(true);
    // 最終推送的收斂回音 → 採用(內容相同=no-op)
    r.rerender(
      <OrderFilterControls
        {...PROPS}
        initial={{ ...PROPS.initial, wf: ['paid_wait', 'shipped_done'] }}
      />,
    );
    expect((r.getByLabelText('已收未定') as HTMLInputElement).checked).toBe(true);
    expect((r.getByLabelText('出貨完成') as HTMLInputElement).checked).toBe(true);
  });

  it('unset 哨兵直通 URL(未設定可與 code 混勾)', () => {
    const r = render(<OrderFilterControls {...PROPS} />);
    openPanel(r.getAllByRole, 0);
    fireEvent.click(r.getByLabelText('未設定'));
    fireEvent.click(r.getByLabelText('已收未定'));
    expect(replace).toHaveBeenLastCalledWith(
      '/orders?workflow_status=unset&workflow_status=paid_wait',
      { scroll: false },
    );
  });
});
