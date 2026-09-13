// @vitest-environment jsdom
// 列表到貨彈窗的撤銷:成功之後要導回列表 + 展開那張單(codex 2026-09-14 R1 must-fix A),
// 而且**只在員工還停在這張單的彈窗時**導(R3 must-fix:他關窗開了 B,A 的回應回來不能把他拉回 A)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ undo: vi.fn(), replace: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('../../lib/orders/receipt-actions', () => ({ undoItemReceiptAction: mocks.undo }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ replace: mocks.replace, push: vi.fn(), refresh: vi.fn() }),
}));

import { ReceiptDeleteButton } from './receipt-delete-button';

const ORDER = 'o-1';
const DONE = '/orders?open=o-1';

function mount(doneHref?: string) {
  return render(
    <ReceiptDeleteButton receiptId='rc-1' orderId={ORDER} orderItemId='it-1' returnTo={DONE} receivedAt='2026-09-13T02:00:00.000Z' quantity={1} doneHref={doneHref} />,
  );
}

async function pressUndo() {
  fireEvent.click(screen.getByText('撤銷'));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /確定撤銷/ }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  mocks.undo.mockReset();
  mocks.replace.mockReset();
  window.history.replaceState(null, '', `/orders?next=${ORDER}&do=receipt`);
});
afterEach(() => cleanup());

describe('ReceiptDeleteButton × doneHref(列表到貨彈窗)', () => {
  it('🔴 撤銷成功 + 還在這張單的彈窗 ⇒ replace(doneHref)', async () => {
    mocks.undo.mockResolvedValue({ status: 'undone' });
    mount(DONE);
    await pressUndo();
    expect(mocks.replace).toHaveBeenCalledWith(DONE);
  });

  it('🔴 那筆已不在(already_gone)也導 —— 留在彈窗裡沒有下一步', async () => {
    mocks.undo.mockResolvedValue({ status: 'already_gone' });
    mount(DONE);
    await pressUndo();
    expect(mocks.replace).toHaveBeenCalledWith(DONE);
  });

  it('🔴 回應回來時網址已經不是這張單的彈窗(員工關了 A 開了 B)⇒ 不導(codex R3 must-fix)', async () => {
    mocks.undo.mockImplementation(async () => {
      window.history.replaceState(null, '', '/orders?next=o-OTHER&do=receipt');
      return { status: 'undone' };
    });
    mount(DONE);
    await pressUndo();
    expect(mocks.replace, '把員工從 B 拉回 A 了').not.toHaveBeenCalled();
  });

  it('🔴 同一張單但換成下訂彈窗(do=order)⇒ 不導(codex R4:別把他剛開的下訂表單關掉)', async () => {
    mocks.undo.mockImplementation(async () => {
      window.history.replaceState(null, '', `/orders?next=${ORDER}&do=order`);
      return { status: 'undone' };
    });
    mount(DONE);
    await pressUndo();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('🔴 失敗不導(failed / blocked 都留在原地讓他看訊息)', async () => {
    mocks.undo.mockResolvedValue({ status: 'failed', code: 'error', message: 'x' });
    mount(DONE);
    await pressUndo();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('🔵 明細頁(不傳 doneHref)⇒ 成功也不導,就地變「已撤銷」', async () => {
    mocks.undo.mockResolvedValue({ status: 'undone' });
    mount(undefined);
    await pressUndo();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.getByText('已撤銷')).toBeTruthy();
  });
});
