// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const batch = vi.fn();
const setCategory = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }), useSearchParams: () => new URLSearchParams() }));
const readStates = vi.fn();
vi.mock('../../lib/products/product-listing-batch-actions', () => ({
  setProductListingBatchAction: (a: unknown) => batch(a),
  readProductListingStatesAction: (ids: string[]) => readStates(ids),
}));
vi.mock('../../lib/products/product-category-actions', () => ({ setProductCategoryAction: (a: unknown) => setCategory(a) }));

const { ProductBatchBar } = await import('./product-batch-bar');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function setup(n: number) {
  render(
    <div>
      {Array.from({ length: n }, (_, i) => (
        <input key={i} type='checkbox' data-product-select value={id(i + 1)} data-title={`商品${i + 1}`} defaultChecked />
      ))}
      <ProductBatchBar categories={[{ id: 'c1', label: '引擎部品' }, { id: 'c2', label: '引擎部品 · 排氣管' }]} />
    </div>,
  );
}

beforeEach(() => {
  batch.mockReset();
  setCategory.mockReset();
  readStates.mockReset();
  readStates.mockResolvedValue({ ok: true, states: [] });
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
});
afterEach(cleanup);

describe('商品頁乙 A8:批次按鈕列', () => {
  it('每 50 件送一次;第二段沒有回應 ⇒ 那一段標「結果未確認」、後面標「尚未執行」,第一段的結果照實列', async () => {
    setup(120);
    batch
      .mockResolvedValueOnce({ ok: true, results: Array.from({ length: 50 }, (_, i) => ({ productId: id(i + 1), outcome: 'UPDATED' })) })
      .mockRejectedValueOnce(new Error('timeout'));
    fireEvent.click(screen.getByText('下架已選商品'));
    await act(async () => {
      fireEvent.click(screen.getByText('確定下架 120 件'));
    });
    expect(batch).toHaveBeenCalledTimes(2);
    expect((batch.mock.calls[0]![0] as { productIds: string[] }).productIds).toHaveLength(50);
    const result = document.querySelector('[data-product-batch-result]')!;
    expect(result.textContent).toContain('已更新 50 件');
    expect(result.textContent).toContain('結果未確認 50 件');
    expect(result.textContent).toContain('尚未執行 20 件');
    expect(result.textContent).not.toContain('沒有成功');
  });

  it('選超過 200 件 ⇒ 按鈕停用並說明,不會送出', () => {
    setup(201);
    expect((screen.getByText('下架已選商品') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/一次最多處理 200 件/)).toBeTruthy();
  });
});

describe('商品頁乙 C5:批次改分類', () => {
  it('選分類後儲存 ⇒ 送出已選的商品與分類;「改回由同步決定」⇒ 不帶分類、unlock=true', async () => {
    setup(2);
    setCategory.mockResolvedValue({ ok: true, results: [{ productId: id(1), outcome: 'UPDATED' }, { productId: id(2), outcome: 'NO_CHANGE' }] });
    fireEvent.click(screen.getByText('改分類…'));
    fireEvent.change(document.querySelector('[data-product-category-dialog] select')!, { target: { value: 'c2' } });
    await act(async () => {
      fireEvent.click(screen.getByText('儲存分類（2 件）'));
    });
    expect(setCategory).toHaveBeenCalledWith({ productIds: [id(1), id(2)], categoryId: 'c2', unlock: false });
    expect(document.querySelector('[data-product-category-result]')!.textContent).toBe('已更新 1 件、未變更 1 件。');
  });

  it('改回由同步決定', async () => {
    setup(1);
    setCategory.mockResolvedValue({ ok: true, results: [{ productId: id(1), outcome: 'UPDATED' }] });
    fireEvent.click(screen.getByText('改分類…'));
    await act(async () => {
      fireEvent.click(screen.getByText('改回由同步決定'));
    });
    expect(setCategory).toHaveBeenCalledWith({ productIds: [id(1)], categoryId: null, unlock: true });
  });
});

describe('商品頁乙 A8:第一輪審查的五個情況', () => {
  it('換了一批商品(舊的勾選已經不在畫面上)⇒ 按下批次按鈕時重新讀,不會送上一頁的商品', async () => {
    const { rerender } = render(
      <div>
        <input key='old' type='checkbox' data-product-select value={id(1)} data-title='舊商品' defaultChecked />
        <ProductBatchBar />
      </div>,
    );
    rerender(
      <div>
        <input key='new' type='checkbox' data-product-select value={id(9)} data-title='新商品' />
        <ProductBatchBar />
      </div>,
    );
    fireEvent.click(screen.getByText('下架已選商品'));
    expect(document.querySelector('dialog')?.open).not.toBe(true);
    expect(batch).not.toHaveBeenCalled();
  });

  it('還在送的時候不能關閉;送完才出現「關閉」', async () => {
    setup(60);
    let release!: (v: unknown) => void;
    batch
      .mockResolvedValueOnce({ ok: true, results: Array.from({ length: 50 }, (_, i) => ({ productId: id(i + 1), outcome: 'UPDATED' })) })
      .mockImplementationOnce(() => new Promise((r) => (release = r)));
    fireEvent.click(screen.getByText('下架已選商品'));
    await act(async () => {
      fireEvent.click(screen.getByText('確定下架 60 件'));
    });
    expect(screen.queryByText('關閉')).toBeNull();
    expect(screen.getByText('還在處理中，完成前請不要關閉這個視窗。')).toBeTruthy();
    await act(async () => {
      release({ ok: true, results: Array.from({ length: 10 }, (_, i) => ({ productId: id(i + 51), outcome: 'UPDATED' })) });
    });
    expect(screen.getByText('關閉')).toBeTruthy();
  });

  it('結果未確認 ⇒ 主動讀目前狀態並列在旁邊;成功的那幾件也逐件列出', async () => {
    setup(2);
    batch.mockResolvedValueOnce({ ok: true, results: [{ productId: id(1), outcome: 'UPDATED' }, { productId: id(2), outcome: 'UNCONFIRMED' }] });
    readStates.mockResolvedValueOnce({ ok: true, states: [{ productId: id(2), title: '商品2', listed: true }] });
    fireEvent.click(screen.getByText('下架已選商品'));
    await act(async () => {
      fireEvent.click(screen.getByText('確定下架 2 件'));
    });
    expect(readStates).toHaveBeenCalledWith([id(2)]);
    const items = [...document.querySelectorAll('[data-product-batch-result] li')].map((li) => li.textContent);
    expect(items).toEqual(['商品2 · 結果未確認 · 目前上架中', '商品1 · 已更新']);
  });
});

// ─────────────── 商品頁乙 F1:失敗流程(計畫第五節 F1 逐條)───────────────
describe('商品頁乙 F1:批次失敗時員工看得到哪幾件、怎麼了', () => {
  it('部分失敗:同一段有成功、沒有成功、要逐件確認、找不到 ⇒ 各自計數,沒成功的列在前面,不說「結果未確認」', async () => {
    setup(4);
    batch.mockResolvedValueOnce({
      ok: true,
      results: [
        { productId: id(1), outcome: 'UPDATED' },
        { productId: id(2), outcome: 'FAILED' },
        { productId: id(3), outcome: 'NEEDS_REVIEW' },
        { productId: id(4), outcome: 'NOT_FOUND' },
      ],
    });
    fireEvent.click(screen.getByText('上架已選商品'));
    await act(async () => {
      fireEvent.click(screen.getByText('確定上架 4 件'));
    });
    const result = document.querySelector('[data-product-batch-result]')!;
    expect(result.textContent).toContain('已更新 1 件');
    expect(result.textContent).toContain('沒有成功 1 件');
    expect(result.textContent).toContain('需要到商品頁逐件確認 1 件');
    expect(result.textContent).toContain('找不到這件商品 1 件');
    expect(result.textContent).not.toContain('結果未確認');
    const order = [...result.querySelectorAll('li[data-outcome]')].map((li) => li.getAttribute('data-outcome'));
    expect(order.at(-1), '成功的那件應該排在最後').toBe('UPDATED');
    expect(order.slice(0, 3).sort()).toEqual(['FAILED', 'NEEDS_REVIEW', 'NOT_FOUND']);
  });

  it('伺服器明確拒絕某一段(例如沒登入)⇒ 顯示原因,那一段和後面標「尚未執行」,不說「結果未確認」', async () => {
    setup(60);
    batch
      .mockResolvedValueOnce({ ok: true, results: Array.from({ length: 50 }, (_, i) => ({ productId: id(i + 1), outcome: 'UPDATED' })) })
      .mockResolvedValueOnce({ ok: false, message: '請重新登入後再操作。' });
    fireEvent.click(screen.getByText('下架已選商品'));
    await act(async () => {
      fireEvent.click(screen.getByText('確定下架 60 件'));
    });
    expect(screen.getByText('請重新登入後再操作。')).toBeTruthy();
    const result = document.querySelector('[data-product-batch-result]')!;
    expect(result.textContent).toContain('已更新 50 件');
    expect(result.textContent).toContain('尚未執行 10 件');
    expect(result.textContent).not.toContain('結果未確認');
  });

  it('批次改分類被資料庫拒絕 ⇒ 顯示員工看得懂的原因,不顯示「已更新」', async () => {
    setup(2);
    setCategory.mockResolvedValue({ ok: false, message: '商品正在更新，請稍後再試。' });
    fireEvent.click(screen.getByText('改分類…'));
    fireEvent.change(document.querySelector('[data-product-category-dialog] select')!, { target: { value: 'c2' } });
    await act(async () => {
      fireEvent.click(screen.getByText('儲存分類（2 件）'));
    });
    expect(screen.getByText('商品正在更新，請稍後再試。')).toBeTruthy();
    expect(document.querySelector('[data-product-category-result]')).toBeNull();
  });

  it('批次改分類沒有收到回應 ⇒ 說無法確認,不說失敗', async () => {
    setup(1);
    setCategory.mockRejectedValue(new Error('network'));
    fireEvent.click(screen.getByText('改分類…'));
    fireEvent.change(document.querySelector('[data-product-category-dialog] select')!, { target: { value: 'c1' } });
    await act(async () => {
      fireEvent.click(screen.getByText('儲存分類（1 件）'));
    });
    expect(screen.getByText(/無法確認分類是否已儲存/)).toBeTruthy();
    expect(screen.queryByText(/失敗/)).toBeNull();
  });
});
