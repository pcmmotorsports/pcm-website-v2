// @vitest-environment jsdom
// 後台「最近 7 天新上架」清單頁(地圖 M-5-03;提案甲)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ listNewListings: vi.fn() }));
vi.mock('../../../lib/products/new-listing-repository', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  listNewListings: mocks.listNewListings,
}));
vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient: vi.fn() }));

import NewListingsPage from './page';

const ROW = {
  id: '11111111-2222-3333-4444-555555555555',
  createdAt: '2026-09-29T00:10:00Z',
  title: 'OH-4842 C 扳手',
  brandName: 'Öhlins',
  categoryName: '工具',
  priceGeneral: 100,
  flags: ['low_price'],
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('最近 7 天新上架清單頁', () => {
  it('列出上架時間、品牌、商品、分類、一般價、需要注意的項目, 並可到商品頁下架', async () => {
    mocks.listNewListings.mockResolvedValue({ rows: [ROW], truncated: false });
    render(await NewListingsPage());
    expect(screen.getByRole('heading', { name: '最近 7 天新上架' })).toBeTruthy();
    const row = screen.getAllByRole('row').find((r) => r.hasAttribute('data-new-listing-row'))!;
    expect(within(row).getByText('Öhlins')).toBeTruthy();
    expect(within(row).getByText('工具')).toBeTruthy();
    expect(within(row).getByText('NT$ 100')).toBeTruthy();
    expect(within(row).getByText('價格低於 NT$1,000')).toBeTruthy();
    const title = within(row).getByRole('link', { name: 'OH-4842 C 扳手' }) as HTMLAnchorElement;
    expect(title.getAttribute('href')).toBe('/products/11111111-2222-3333-4444-555555555555');
    const act = within(row).getByRole('link', { name: '到商品頁下架' }) as HTMLAnchorElement;
    expect(act.getAttribute('href')).toBe('/products/11111111-2222-3333-4444-555555555555');
  });

  it('沒有要注意的項目 ⇒ 那一格寫「—」;沒有價格 ⇒「沒有價格」', async () => {
    mocks.listNewListings.mockResolvedValue({
      rows: [
        { ...ROW, id: 'a', title: '正常商品', priceGeneral: 12000, flags: [] },
        { ...ROW, id: 'b', title: '沒價商品', priceGeneral: null, flags: ['no_price'] },
      ],
      truncated: false,
    });
    render(await NewListingsPage());
    const rows = screen.getAllByRole('row').filter((r) => r.hasAttribute('data-new-listing-row'));
    expect(within(rows[0]!).getByText('—')).toBeTruthy();
    expect(within(rows[1]!).getAllByText('沒有價格').length).toBe(2);
  });

  it('🔵 載入失敗 ⇒ 說明失敗與下一步, 不寫成「沒有新上架」', async () => {
    mocks.listNewListings.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(await NewListingsPage());
    expect(screen.getByText('新上架清單載入失敗，請重新整理。若仍無法載入，請聯絡系統管理員。')).toBeTruthy();
    expect(screen.queryByText('最近 7 天沒有新上架的商品。')).toBeNull();
  });

  it('🔵 真的沒有 ⇒「最近 7 天沒有新上架的商品。」', async () => {
    mocks.listNewListings.mockResolvedValue({ rows: [], truncated: false });
    render(await NewListingsPage());
    expect(screen.getByText('最近 7 天沒有新上架的商品。')).toBeTruthy();
  });

  it('超過上限 ⇒ 說明只列出最新的那些', async () => {
    mocks.listNewListings.mockResolvedValue({ rows: [ROW], truncated: true });
    render(await NewListingsPage());
    expect(screen.getByText(/只讀取最近建立的 1,000 件/)).toBeTruthy();
  });
});
