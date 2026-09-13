// @vitest-environment jsdom
// 列表下訂彈窗的作廢鈕:兩段式、理由必填、成功導回列表展開那張單、只在還停在這張單的下訂彈窗時導。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ act: vi.fn(), replace: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('../../lib/orders/procurement-actions', () => ({ voidItemProcurementAction: mocks.act }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ replace: mocks.replace, push: vi.fn(), refresh: vi.fn() }),
}));

import { ProcurementVoidButton } from './procurement-void-button';

const ORDER = 'o-1';
const DONE = '/orders?open=o-1';

function mount(doneHref?: string) {
  return render(<ProcurementVoidButton procurementId='pr-1' orderId={ORDER} returnTo={DONE} doneHref={doneHref} label='甲供應商 3 件' />);
}
async function pressConfirm() {
  fireEvent.click(screen.getByText('作廢'));
  fireEvent.change(screen.getByLabelText('作廢理由'), { target: { value: '訂錯家' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /確認作廢/ }));
    await Promise.resolve();
    await Promise.resolve();
  });
}
beforeEach(() => {
  mocks.act.mockReset();
  mocks.replace.mockReset();
  window.history.replaceState(null, '', `/orders?next=${ORDER}&do=order`);
});
afterEach(() => cleanup());

describe('ProcurementVoidButton', () => {
  it('🔴 摺著時只有「作廢」;展開才有理由欄(required)與紅鈕', () => {
    mount(DONE);
    expect(screen.getByText('作廢')).toBeTruthy();
    const reason = screen.getByLabelText('作廢理由') as HTMLInputElement;
    expect(reason.required).toBe(true);
    expect(screen.getByRole('button', { name: /確認作廢/ }).className).toContain('bg-destructive');
  });

  it('🔴 成功 ⇒ replace(doneHref);表單送的是 order_id / procurement_id / request_id / void_reason', async () => {
    mocks.act.mockResolvedValue({ status: 'voided' });
    mount(DONE);
    await pressConfirm();
    expect(mocks.replace).toHaveBeenCalledWith(DONE);
    const fd = mocks.act.mock.calls[0]![1] as FormData;
    expect(fd.get('order_id')).toBe(ORDER);
    expect(fd.get('procurement_id')).toBe('pr-1');
    expect(fd.get('void_reason')).toBe('訂錯家');
    expect(String(fd.get('request_id') ?? '').length, '冪等鍵沒鑄').toBeGreaterThan(8);
  });

  it('🔴 有到貨(has_receipts)⇒ 不導、留在原地印「先撤到貨」', async () => {
    mocks.act.mockResolvedValue({ status: 'has_receipts' });
    mount(DONE);
    await pressConfirm();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('先到「到貨登記」');
  });

  it('🔴 回應回來時網址已是別張單 / 別的動作 ⇒ 不導', async () => {
    for (const q of ['?next=o-OTHER&do=order', `?next=${ORDER}&do=receipt`]) {
      mocks.replace.mockReset();
      mocks.act.mockImplementation(async () => {
        window.history.replaceState(null, '', `/orders${q}`);
        return { status: 'voided' };
      });
      mount(DONE);
      await pressConfirm();
      expect(mocks.replace, q).not.toHaveBeenCalled();
      cleanup();
      window.history.replaceState(null, '', `/orders?next=${ORDER}&do=order`);
    }
  });

  it('🔵 不傳 doneHref ⇒ 就地變「已作廢」,不導', async () => {
    mocks.act.mockResolvedValue({ status: 'voided' });
    mount(undefined);
    await pressConfirm();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.getByText('已作廢')).toBeTruthy();
  });
});
