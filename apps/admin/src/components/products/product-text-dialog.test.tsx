// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const load = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock('../../lib/products/product-text-actions', () => ({ loadProductTextAction: (id: string) => load(id) }));
vi.mock('./product-overrides-editor', () => ({
  ProductOverridesEditor: ({ productId, supplier }: { productId: string; supplier: { title: string } }) => (
    <div data-editor>{`${productId}:${supplier.title}`}</div>
  ),
}));
const { ProductTextDialog } = await import('./product-text-dialog');

beforeEach(() => {
  load.mockReset();
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
});
afterEach(cleanup);

describe('商品頁乙 A10:列表的「改文字…」彈窗', () => {
  it('打開時讀這件商品,放入商品頁同一個編輯器', async () => {
    load.mockResolvedValue({ ok: true, supplier: { title: 'Brake Lever', subtitle: null, highlights: [] }, overrides: { title: null, subtitle: null, highlights: null } });
    render(<ProductTextDialog productId='p1' title='Brake Lever' />);
    await act(async () => {
      fireEvent.click(screen.getByText('改文字…'));
    });
    expect(load).toHaveBeenCalledWith('p1');
    expect(document.querySelector('[data-editor]')?.textContent).toBe('p1:Brake Lever');
  });

  it('讀不到 ⇒ 說明並建議打開完整頁,不顯示編輯器', async () => {
    load.mockResolvedValue({ ok: false, message: '商品文字讀取失敗，請稍後再試，或打開完整頁修改。' });
    render(<ProductTextDialog productId='p1' title='x' />);
    await act(async () => {
      fireEvent.click(screen.getByText('改文字…'));
    });
    expect(screen.getByText('商品文字讀取失敗，請稍後再試，或打開完整頁修改。')).toBeTruthy();
    expect(document.querySelector('[data-editor]')).toBeNull();
  });
});
