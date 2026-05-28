// @vitest-environment jsdom
//
// OverviewTab smoke + 字面對齊(g-2)。
//
// 驗:
// - 3 stats:Member tier(TierBadge)/ Stored value / Total orders
// - tier sub 字面 3 種(general/store/premiumStore 對齊 design L477-481)
// - 訂單空狀態(orderCount=0)字面
// - 為你推薦 3 分支:有商品 / 空 / error
// - 連結:onJumpToOrders / onJumpToWallet 觸發(纯 client setState)

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// next/link mock(避免帶 router context;OverviewTab 只用 Link href)
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { OverviewTab } from './OverviewTab';
import type { FeaturedResult } from '@/lib/products';
import type { MockProduct } from '@/data/mock-products';

afterEach(cleanup);

const EMPTY_FEATURED: FeaturedResult = { products: [], error: false };

function renderTab(overrides: Partial<React.ComponentProps<typeof OverviewTab>> = {}) {
  const props: React.ComponentProps<typeof OverviewTab> = {
    stats: { tier: 'general', walletBalance: 0, orderCount: 0 },
    featured: EMPTY_FEATURED,
    onJumpToOrders: vi.fn(),
    onJumpToWallet: vi.fn(),
    ...overrides,
  };
  return { ...render(<OverviewTab {...props} />), props };
}

describe('OverviewTab(g-2 真資料、對齊 design AccountPages.jsx L467-535)', () => {
  it('3 stats 卡(Member tier / Stored value / Total orders)字面', () => {
    renderTab();
    expect(screen.getByText('Member tier')).toBeTruthy();
    expect(screen.getByText('Stored value')).toBeTruthy();
    expect(screen.getByText('Total orders')).toBeTruthy();
    expect(screen.getByText('2024 年起累計')).toBeTruthy();
  });

  it('tier=general:badge 一般會員 + sub「一般會員價(升級需聯絡客服)」', () => {
    renderTab();
    expect(screen.getByText('一般會員')).toBeTruthy();
    expect(screen.getByText('一般會員價(升級需聯絡客服)')).toBeTruthy();
  });

  it('tier=store:badge 店家會員 + sub「已享店家經銷價」', () => {
    renderTab({ stats: { tier: 'store', walletBalance: 0, orderCount: 0 } });
    expect(screen.getByText('店家會員')).toBeTruthy();
    expect(screen.getByText('已享店家經銷價')).toBeTruthy();
  });

  it('tier=premiumStore:badge PREMIUM STORE + sub「已享 PREMIUM 經銷折扣」', () => {
    renderTab({ stats: { tier: 'premiumStore', walletBalance: 25000, orderCount: 3 } });
    expect(screen.getByText('PREMIUM STORE')).toBeTruthy();
    expect(screen.getByText('已享 PREMIUM 經銷折扣')).toBeTruthy();
    expect(screen.getByText('NT$ 25,000')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy(); // orderCount 顯示
  });

  it('orderCount=0:最近訂單顯示 acc-empty「目前尚無訂單紀錄」(business override)', () => {
    renderTab();
    expect(screen.getByText('目前尚無訂單紀錄')).toBeTruthy();
  });

  it('「查看明細 →」點擊觸發 onJumpToWallet', () => {
    const { props } = renderTab();
    fireEvent.click(screen.getByRole('button', { name: /查看明細/ }));
    expect(props.onJumpToWallet).toHaveBeenCalledTimes(1);
  });

  it('「查看全部 →」點擊觸發 onJumpToOrders', () => {
    const { props } = renderTab();
    fireEvent.click(screen.getByRole('button', { name: /查看全部/ }));
    expect(props.onJumpToOrders).toHaveBeenCalledTimes(1);
  });

  it('featured 空:推薦顯「商品即將上架」', () => {
    renderTab({ featured: { products: [], error: false } });
    expect(screen.getByText('推薦商品即將上架')).toBeTruthy();
  });

  it('featured error:推薦顯「載入失敗、請稍後再試」', () => {
    renderTab({ featured: { products: [], error: true } });
    expect(screen.getByText('推薦商品載入失敗、請稍後再試')).toBeTruthy();
  });

  it('featured 有商品:列 4 個 acc-rec-item + name + price + slug link', () => {
    const products: MockProduct[] = [
      { id: 1, slug: 'p-1', brand: 'BRAND1', name: '商品 A', fits: '通用', price: 1200, origPrice: null, isNew: false, isSale: false, inStock: true, category: '操控部品', color: 'silver', imgTone: 'cool', originalPrice: null, tierLabel: null },
      { id: 2, slug: 'p-2', brand: 'BRAND2', name: '商品 B', fits: '通用', price: 3400, origPrice: null, isNew: false, isSale: false, inStock: true, category: '操控部品', color: 'silver', imgTone: 'cool', originalPrice: null, tierLabel: null },
      { id: 3, slug: 'p-3', brand: 'BRAND3', name: '商品 C', fits: '通用', price: 5600, origPrice: null, isNew: false, isSale: false, inStock: true, category: '操控部品', color: 'silver', imgTone: 'cool', originalPrice: null, tierLabel: null },
      { id: 4, slug: 'p-4', brand: 'BRAND4', name: '商品 D', fits: '通用', price: 7800, origPrice: null, isNew: false, isSale: false, inStock: true, category: '操控部品', color: 'silver', imgTone: 'cool', originalPrice: null, tierLabel: null },
    ];
    const { container } = renderTab({ featured: { products, error: false } });
    const items = container.querySelectorAll('.acc-rec-item');
    expect(items.length).toBe(4);
    expect(screen.getByText('商品 A')).toBeTruthy();
    expect(screen.getByText('NT$ 1,200')).toBeTruthy();
    expect(screen.getByText('NT$ 7,800')).toBeTruthy();
    // slug link
    const firstLink = items[0] as HTMLAnchorElement;
    expect(firstLink.getAttribute('href')).toBe('/products/p-1');
  });
});
