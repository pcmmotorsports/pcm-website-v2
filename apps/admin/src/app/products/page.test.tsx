// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// repository 拉 server-only 模組 ⇒ 整支 mock(同 `app/customers/page.test.tsx` 紀律)。
// 🔴 `resolvePrice` / `resolveListingState` **不 mock** —— 它們是本片的取值落點,
//    mock 掉等於把要驗的東西換成假的(memory `feedback_assertion-measures-the-wrong-thing`)。
const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../lib/products/product-repository', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../lib/products/product-repository')>();
  return { ...actual, listProductsForAdmin: mocks.list };
});
vi.mock('server-only', () => ({}));

import ProductsPage, { PRODUCTS_PAGE_SIZE } from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ROW = {
  id: 'p1',
  title: '碳纖維前土除',
  external_id: 'RPM-001',
  price_general: 4800,
  delisted_at: null,
};

async function renderPage(search: Record<string, string> = {}) {
  return render(await ProductsPage({ searchParams: Promise.resolve(search) }));
}

describe('/products 列表(#20 片1a)', () => {
  it('🔴 驗收 1:列出商品,含已下架的那批(後台存在的理由之一)', async () => {
    mocks.list.mockResolvedValue({
      items: [ROW, { ...ROW, id: 'p2', title: '停產排氣管', delisted_at: '2026-08-01T00:00:00Z' }],
      total: 2,
    });
    const { container } = await renderPage();
    const text = container.textContent ?? '';
    expect(text).toContain('碳纖維前土除');
    expect(text).toContain('停產排氣管');
    // 兩種狀態都要看得出來 —— 只顯示其中一種等於員工分不出哪些能上架回來。
    expect(text).toContain('上架中');
    expect(text).toContain('已下架');
    // 🔴 驗收 1 的字面是四欄(名稱/料號/售價/狀態)—— 第一版只驗了兩欄(code-reviewer MF4)
    //    ⇒ `priceCell` 壞掉(格式、NT$ 前綴、toLocaleString)整組照樣綠。
    expect(text).toContain('RPM-001');
    expect(text).toContain('NT$ 4,800');
  });

  it('🔴 驗收 2:讀取失敗 → 仍渲染錯誤態、不把 DB error 印到畫面', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.list.mockRejectedValue(new Error('PGRST301 permission denied for table products'));
    const { container } = await renderPage();
    const text = container.textContent ?? '';
    expect(text).toContain('商品列表載入失敗');
    // DB 錯誤字面不得外洩到畫面。
    expect(text).not.toContain('PGRST301');
    expect(text).not.toContain('permission denied');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('🔴 驗收 3:分頁走 server 端 —— ?page=2 送出的 offset 不是第 1 頁的', async () => {
    mocks.list.mockResolvedValue({ items: [], total: 100 });
    await renderPage({ page: '2' });
    expect(mocks.list).toHaveBeenCalledWith(PRODUCTS_PAGE_SIZE, PRODUCTS_PAGE_SIZE);

    // 負向對照:沒有這格,上面那條對「offset 恆為 20」也會綠。
    mocks.list.mockClear();
    await renderPage();
    expect(mocks.list).toHaveBeenCalledWith(PRODUCTS_PAGE_SIZE, 0);
  });

  it('壞的 ?page= 退回第 1 頁,不炸也不送負 offset', async () => {
    mocks.list.mockResolvedValue({ items: [], total: 0 });
    for (const bad of ['0', '-3', 'abc', '']) {
      mocks.list.mockClear();
      await renderPage({ page: bad });
      expect({ [bad]: mocks.list.mock.calls[0]?.[1] }).toEqual({ [bad]: 0 });
    }
  });

  it('零商品 → 空狀態文案,不是空白畫面', async () => {
    mocks.list.mockResolvedValue({ items: [], total: 0 });
    const { container } = await renderPage();
    expect(container.textContent ?? '').toContain('目前沒有商品');
  });

  it('🔴 本頁不得宣稱尚未存在的功能(suppliers 頁那條教訓)', async () => {
    mocks.list.mockResolvedValue({ items: [ROW], total: 1 });
    const { container } = await renderPage();
    const text = container.textContent ?? '';
    for (const promise of ['即將推出', '敬請期待', '可以編輯', '點擊修改']) {
      expect({ [promise]: text.includes(promise) }).toEqual({ [promise]: false });
    }
    expect(text).toContain('只能查看');
  });
});
