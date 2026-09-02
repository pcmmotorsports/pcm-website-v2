// @vitest-environment jsdom
//
// /search 守門 — 三種空狀態必須畫**三種**字。
//
// S1/S2/S3:沒打字 / 打了而零筆 / 這次撈失敗。
//   🔴 為什麼分三格而不是一格:`searchProducts` 撈失敗時回 `{items:[],total:0,error:true}`,
//      **與「真的沒有這件商品」的回傳只差一個布林**。少了 S3,一次 DB 抖動會告訴客人我們沒貨,
//      而畫面上完全正常、三綠全綠、沒有任何東西會紅。
//   每一格都同時斷言「該出現的出現」與「不該出現的沒出現」——只驗前者的話,一個把三句話
//   同時印出來的實作也會全過。
//
// S4:`robots.index=false` —— 同一批商品會長出無限多組 `?q=` 網址。
// S5:總數 > 顯示數時要講出來,否則客人以為只有這些。

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const searchProducts = vi.fn();
vi.mock('@/lib/search', () => ({ searchProducts, SEARCH_PAGE_LIMIT: 25 }));
vi.mock('@/components/Header', () => ({ Header: () => <div data-testid="header" /> }));
vi.mock('@/components/HomeFooter', () => ({ HomeFooter: () => <div data-testid="footer" /> }));
vi.mock('@/components/ProductCard', () => ({
  ProductCard: ({ p }: { p: { name: string } }) => <div data-testid="card">{p.name}</div>,
}));

const { default: SearchRoute, metadata } = await import('./page');

async function renderAt(q: string | undefined) {
  cleanup();
  render(await SearchRoute({ searchParams: Promise.resolve(q === undefined ? {} : { q }) }));
}

const ITEM = (name: string) => ({ id: 1, slug: 's', brand: 'B', name, price: 1 });

beforeEach(() => searchProducts.mockReset());

describe('/search', () => {
  it('S1 沒打字 ⇒ 提示怎麼用,不畫「沒有找到」也不畫「無法使用」', async () => {
    searchProducts.mockResolvedValue({ items: [], total: 0, error: false });
    await renderAt(undefined);
    expect(screen.getByText(/輸入商品名稱/)).toBeTruthy();
    expect(screen.queryByText(/沒有找到/)).toBeNull();
    expect(screen.queryByText(/無法使用/)).toBeNull();
  });

  it('S2 有字而零筆 ⇒ 「沒有找到」,不畫「無法使用」', async () => {
    searchProducts.mockResolvedValue({ items: [], total: 0, error: false });
    await renderAt('zzz');
    expect(screen.getByText(/沒有找到/)).toBeTruthy();
    expect(screen.queryByText(/無法使用/)).toBeNull();
  });

  it('S3 撈失敗 ⇒ 「暫時無法使用」,**不准**畫成「沒有找到」', async () => {
    searchProducts.mockResolvedValue({ items: [], total: 0, error: true });
    await renderAt('排氣管');
    expect(screen.getByText(/暫時無法使用/)).toBeTruthy();
    expect(screen.queryByText(/沒有找到/)).toBeNull();
  });

  it('S4 搜尋結果頁不進索引', () => {
    expect((metadata.robots as { index: boolean }).index).toBe(false);
  });

  it('S5 有結果 ⇒ 畫卡片;總數大於顯示數時要講「顯示前 N 件」', async () => {
    searchProducts.mockResolvedValue({ items: [ITEM('鈦合金排氣管')], total: 40, error: false });
    await renderAt('排氣管');
    expect(screen.getByTestId('card').textContent).toBe('鈦合金排氣管');
    expect(screen.getByText(/共 40 件.*顯示前 1 件/)).toBeTruthy();
  });

  it('S6 🔴 total=null(不知道總數)⇒ 整行不印,**不准**印成「共 0 件」', async () => {
    searchProducts.mockResolvedValue({ items: [ITEM('腳踏')], total: null, error: false });
    await renderAt('腳踏');
    // 卡片還是要在 —— 不知道總數不代表沒有結果
    expect(screen.getByTestId('card')).toBeTruthy();
    // 🔴 這一格擋的是 `?? 0`:那一版會印「共 0 件」而卡片就在那個 0 的正下方。
    expect(screen.queryByText(/共 .* 件/)).toBeNull();
  });

  it('S5-b 總數等於顯示數 ⇒ 不加那句尾巴(否則一頁看得完卻說「顯示前」)', async () => {
    searchProducts.mockResolvedValue({ items: [ITEM('腳踏')], total: 1, error: false });
    await renderAt('腳踏');
    expect(screen.getByText('共 1 件')).toBeTruthy();
  });
});
