// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const setCategory = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock('../../lib/products/product-category-actions', () => ({ setProductCategoryAction: (a: unknown) => setCategory(a) }));
const { ProductCategoryEditor } = await import('./product-category-editor');

const CATS = [{ id: 'c1', label: '引擎部品' }, { id: 'c2', label: '引擎部品 · 排氣管' }];
beforeEach(() => {
  setCategory.mockReset();
  setCategory.mockResolvedValue({ ok: true, results: [{ productId: 'p1', outcome: 'UPDATED' }] });
});
afterEach(cleanup);

describe('商品頁乙 C4:編輯頁分類區', () => {
  it('選另一個分類儲存 ⇒ 送這件商品與新分類(unlock=false),顯示「分類已儲存」', async () => {
    render(<ProductCategoryEditor productId='p1' currentCategoryId='c1' locked={false} categories={CATS} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c2' } });
    await act(async () => {
      fireEvent.click(screen.getByText('儲存分類'));
    });
    expect(setCategory).toHaveBeenCalledWith({ productIds: ['p1'], categoryId: 'c2', unlock: false });
    expect(screen.getByRole('status').textContent).toBe('分類已儲存。');
  });

  it('沒鎖時沒有「改回由同步決定」;鎖住時有,按下去送 unlock=true、不帶分類', async () => {
    const { rerender } = render(<ProductCategoryEditor productId='p1' currentCategoryId='c1' locked={false} categories={CATS} />);
    expect(screen.queryByText('改回由同步決定')).toBeNull();
    rerender(<ProductCategoryEditor productId='p1' currentCategoryId='c1' locked categories={CATS} />);
    await act(async () => {
      fireEvent.click(screen.getByText('改回由同步決定'));
    });
    expect(setCategory).toHaveBeenCalledWith({ productIds: ['p1'], categoryId: null, unlock: true });
  });

  it('沒有收到回應 ⇒ 說無法確認,不說失敗', async () => {
    setCategory.mockRejectedValueOnce(new Error('network'));
    render(<ProductCategoryEditor productId='p1' currentCategoryId='c1' locked={false} categories={CATS} />);
    await act(async () => {
      fireEvent.click(screen.getByText('儲存分類'));
    });
    expect(screen.getByRole('status').textContent).toContain('無法確認分類是否已儲存');
  });
});

describe('商品頁乙 F1:編輯頁分類被拒', () => {
  it('資料庫拒絕 ⇒ 顯示原因,不顯示「分類已儲存」', async () => {
    setCategory.mockResolvedValueOnce({ ok: false, message: '沒有權限改分類，請重新登入後再試。' });
    render(<ProductCategoryEditor productId='p1' currentCategoryId='c1' locked={false} categories={CATS} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c2' } });
    await act(async () => {
      fireEvent.click(screen.getByText('儲存分類'));
    });
    expect(screen.getByText('沒有權限改分類，請重新登入後再試。')).toBeTruthy();
    expect(screen.queryByText('分類已儲存。')).toBeNull();
  });
});
