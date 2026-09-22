// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('server-only', () => ({}));
vi.mock('../../lib/orders/item-swap-actions', () => ({ swapOrderItemAction: vi.fn() }));
vi.mock('@/lib/orders/manual-order-catalog-actions', () => ({ searchManualOrderCatalogAction: vi.fn() }));

import { ItemSwapPanel, type ItemSwapPanelProps } from './item-swap-panel';

afterEach(cleanup);

const O = '0f9a3c2e-1b4d-4e6f-8a9b-0c1d2e3f4a5b';
const I = '1f9a3c2e-1b4d-4e6f-8a9b-0c1d2e3f4a5b';
const HIT = { variantId: '3f9a3c2e-1b4d-4e6f-8a9b-0c1d2e3f4a5b', sku: 'NEW-SKU', title: '新商品', unitPrice: 1000, dealerPriceUntaxed: 800 };

type Search = NonNullable<ItemSwapPanelProps['searchAction']>;
const okHits: Search = async () => ({ ok: true, hits: [HIT] });

function renderPanel(search: Search = okHits, submit = vi.fn()) {
  render(
    <ItemSwapPanel
      orderId={O}
      orderItemId={I}
      expectedVersion={7}
      currentSku='OLD-SKU'
      currentTitle='舊商品'
      currentUnitPrice={1000}
      sourceCatalogGeneral={1050}
      sourceCatalogDealerUntaxed={null}
      returnTo={`/orders/${O}`}
      searchAction={search}
      submitAction={submit}
    />,
  );
  return { search, submit };
}

async function openAndSearch() {
  fireEvent.click(screen.getByTestId('item-swap-open'));
  fireEvent.change(screen.getByLabelText('新商品的料號'), { target: { value: 'NEW' } });
  fireEvent.click(screen.getByRole('button', { name: '查詢料號' }));
  await waitFor(() => expect(screen.getAllByTestId('item-swap-hit').length).toBeGreaterThan(0));
}

describe('ItemSwapPanel', () => {
  it('收合時只有一顆「換商品」;點了才出現搜尋', () => {
    renderPanel();
    expect(screen.getByTestId('item-swap-open').textContent).toBe('換商品');
    expect(screen.queryByTestId('item-swap-panel')).toBeNull();
    fireEvent.click(screen.getByTestId('item-swap-open'));
    expect(screen.getByTestId('item-swap-panel')).toBeTruthy();
  });

  it('🔴 沒有選商品之前不能送出(沒有送出鈕)', async () => {
    renderPanel();
    await openAndSearch();
    expect(screen.queryByTestId('item-swap-submit')).toBeNull();
  });

  it('選了一筆 ⇒ 並排顯示原商品與新商品, 表單帶齊六個欄位', async () => {
    renderPanel();
    await openAndSearch();
    fireEvent.click(screen.getByTestId('item-swap-hit'));
    const form = screen.getByTestId('item-swap-confirm') as HTMLFormElement;
    expect(form.textContent).toContain('OLD-SKU');
    expect(form.textContent).toContain('NEW-SKU');
    // 原商品顯示目前目錄價(資料庫比對的那組)與成交單價
    expect(form.textContent).toContain('NT$ 1,050（含稅）');
    expect(form.textContent).toContain('經銷 —（未稅）');
    expect(form.textContent).toContain('成交單價 NT$ 1,000');
    const fd = new FormData(form);
    expect(fd.get('order_id')).toBe(O);
    expect(fd.get('order_item_id')).toBe(I);
    expect(fd.get('version')).toBe('7');
    expect(fd.get('new_variant_id')).toBe(HIT.variantId);
    expect(fd.get('return_to')).toBe(`/orders/${O}`);
    expect(String(fd.get('swap_request_id'))).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByTestId('item-swap-submit').textContent).toBe('確認換成這個商品');
  });

  it('每次打開換一個新的操作編號', async () => {
    renderPanel();
    await openAndSearch();
    fireEvent.click(screen.getByTestId('item-swap-hit'));
    const first = new FormData(screen.getByTestId('item-swap-confirm') as HTMLFormElement).get('swap_request_id');
    fireEvent.click(screen.getByRole('button', { name: '取消換商品' }));
    await openAndSearch();
    fireEvent.click(screen.getByTestId('item-swap-hit'));
    const second = new FormData(screen.getByTestId('item-swap-confirm') as HTMLFormElement).get('swap_request_id');
    expect(second).not.toBe(first);
  });

  it('查無料號 / 查詢失敗各有自己的話, 價格 null 不顯示成 0', async () => {
    renderPanel(async () => ({ ok: true, hits: [] }));
    fireEvent.click(screen.getByTestId('item-swap-open'));
    fireEvent.change(screen.getByLabelText('新商品的料號'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: '查詢料號' }));
    await waitFor(() => expect(screen.getByText('找不到這個料號，請確認後再查一次。')).toBeTruthy());
    cleanup();

    renderPanel(async () => ({ ok: false, reason: 'error', message: '商品查詢失敗' }));
    fireEvent.click(screen.getByTestId('item-swap-open'));
    fireEvent.change(screen.getByLabelText('新商品的料號'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: '查詢料號' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('商品查詢失敗'));
    cleanup();

    renderPanel(async () => ({ ok: true, hits: [{ ...HIT, dealerPriceUntaxed: null }] }));
    await openAndSearch();
    expect(screen.getByTestId('item-swap-hit').textContent).toContain('經銷 —');
  });

  it('查詢還沒回來就關掉重開 ⇒ 舊的結果不會出現在新面板', async () => {
    let resolveOld: (v: Awaited<ReturnType<Search>>) => void = () => {};
    const slow: Search = () => new Promise((r) => { resolveOld = r; });
    renderPanel(slow);
    fireEvent.click(screen.getByTestId('item-swap-open'));
    fireEvent.change(screen.getByLabelText('新商品的料號'), { target: { value: 'OLD' } });
    fireEvent.click(screen.getByRole('button', { name: '查詢料號' }));
    fireEvent.click(screen.getByRole('button', { name: '取消換商品' }));
    fireEvent.click(screen.getByTestId('item-swap-open'));
    resolveOld({ ok: true, hits: [HIT] });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryAllByTestId('item-swap-hit')).toHaveLength(0);
  });

  it('打開後焦點在料號欄, 取消後回到「換商品」按鈕', async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('item-swap-open'));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('新商品的料號')));
    fireEvent.click(screen.getByRole('button', { name: '取消換商品' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('item-swap-open')));
  });

  it('查詢中取消再重開 ⇒ 查詢按鈕可以再按(不會卡在查詢中)', async () => {
    const slow: Search = () => new Promise(() => {});
    renderPanel(slow);
    fireEvent.click(screen.getByTestId('item-swap-open'));
    fireEvent.change(screen.getByLabelText('新商品的料號'), { target: { value: 'OLD' } });
    fireEvent.click(screen.getByRole('button', { name: '查詢料號' }));
    fireEvent.click(screen.getByRole('button', { name: '取消換商品' }));
    fireEvent.click(screen.getByTestId('item-swap-open'));
    fireEvent.change(screen.getByLabelText('新商品的料號'), { target: { value: 'NEW' } });
    const btn = screen.getByRole('button', { name: '查詢料號' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
});
