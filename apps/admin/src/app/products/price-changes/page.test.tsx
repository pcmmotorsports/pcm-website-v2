// @vitest-environment jsdom
// 後台「價格變動」清單(地圖 M-5-08;主視窗 2026-09-29 派)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ listPriceChanges: vi.fn(), listBrandOptions: vi.fn() }));
vi.mock('../../../lib/products/price-change-repository', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  listPriceChanges: mocks.listPriceChanges,
  listBrandOptions: mocks.listBrandOptions,
}));
vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient: vi.fn() }));

import PriceChangesPage from './page';

const ROW = {
  id: 9,
  changedAt: '2026-09-29T00:10:00Z',
  productId: '11111111-2222-3333-4444-555555555555',
  productTitle: 'Öhlins TTX GP 避震器',
  brandName: 'Öhlins',
  sku: 'TTX-01',
  oldPrice: 58000,
  newPrice: 61200,
  pct: 5.5,
};
const page = async (sp: Record<string, string> = {}) => render(await PriceChangesPage({ searchParams: Promise.resolve(sp) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listBrandOptions.mockResolvedValue([{ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', name: 'Öhlins' }]);
});
afterEach(cleanup);

describe('價格變動清單頁', () => {
  it('列出時間、品牌、商品(連到商品頁)、料號、舊價 → 新價、漲跌幅', async () => {
    mocks.listPriceChanges.mockResolvedValue({ rows: [ROW], truncated: false });
    await page();
    expect(screen.getByRole('heading', { name: '價格變動' })).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Öhlins TTX GP 避震器' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/products/11111111-2222-3333-4444-555555555555');
    expect(screen.getByText('TTX-01')).toBeTruthy();
    expect(screen.getByText('NT$ 58,000 → NT$ 61,200')).toBeTruthy();
    expect(screen.getByText('+5.5%')).toBeTruthy();
  });

  it('預設最近 7 天、不篩品牌與漲跌;網址參數照傳, 不認得的值當成沒帶', async () => {
    mocks.listPriceChanges.mockResolvedValue({ rows: [], truncated: false });
    await page();
    expect(mocks.listPriceChanges).toHaveBeenLastCalledWith({ days: 7 });
    await page({ days: '30', brand: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', dir: 'down' });
    expect(mocks.listPriceChanges).toHaveBeenLastCalledWith({
      days: 30,
      brandId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      direction: 'down',
    });
    await page({ days: '999', brand: 'not-a-uuid', dir: 'sideways' });
    expect(mocks.listPriceChanges).toHaveBeenLastCalledWith({ days: 7 });
  });

  it('沒有價格的一側印「沒有價格」, 漲跌印「—」;商品已刪除不給連結', async () => {
    mocks.listPriceChanges.mockResolvedValue({
      rows: [{ ...ROW, productTitle: null, oldPrice: null, pct: null }],
      truncated: false,
    });
    await page();
    expect(screen.getByText('沒有價格 → NT$ 61,200')).toBeTruthy();
    expect(screen.getByText('（商品已刪除）')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /避震器/ })).toBeNull();
  });

  it('沒有資料:沒篩選說「最近 N 天沒有價格變動」, 有篩選說「沒有符合篩選條件」;都不是讀不到', async () => {
    mocks.listPriceChanges.mockResolvedValue({ rows: [], truncated: false });
    await page();
    expect(screen.getByText('最近 7 天沒有價格變動。')).toBeTruthy();
    cleanup();
    await page({ dir: 'up' });
    expect(screen.getByText('沒有符合篩選條件的價格變動。')).toBeTruthy();
  });

  it('讀不到:說明載入失敗與下一步, 不印成「沒有變動」', async () => {
    mocks.listPriceChanges.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await page();
    expect(screen.getByText('價格變動載入失敗，請重新整理。若仍無法載入，請聯絡系統管理員。')).toBeTruthy();
    expect(screen.queryByText(/沒有價格變動/)).toBeNull();
  });

  it('讀到上限:說明只列出最近那些', async () => {
    mocks.listPriceChanges.mockResolvedValue({ rows: [ROW], truncated: true });
    await page();
    expect(screen.getByText(/只讀取最近 1,000 筆變動，更早的沒有列出。/)).toBeTruthy();
  });
});
