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

import { SEARCH_VEHICLE_TAXONOMY_UNAVAILABLE } from '@/components/products-message-state';
const searchProducts = vi.fn();
vi.mock('@/lib/search', () => ({ searchProducts, SEARCH_PAGE_LIMIT: 25 }));
vi.mock('@/components/Header', () => ({ Header: () => <div data-testid="header" /> }));
vi.mock('@/components/HomeFooter', () => ({ HomeFooter: () => <div data-testid="footer" /> }));
vi.mock('@/components/ProductCard', () => ({
  ProductCard: ({ p, priority }: { p: { name: string }; priority?: boolean }) => (
    <div data-testid="card" data-priority={priority ? 'true' : 'false'}>
      {p.name}
    </div>
  ),
}));

// 品牌俗名退路(Sean 2026-09-15 Q3):taxonomy 與目錄取數 mock 掉;parseSearchFacets 與退路判準用真的。
const fetchCatalogPage = vi.fn();
vi.mock('@/lib/products', () => ({
  tryCatalogBrandTaxonomy: vi.fn(async () => ({ brands: [{ id: 'akrapovic', name: 'Akrapovic' }], failed: false })),
  tryCategories: vi.fn(async () => ({ categories: [], failed: false })),
  tryVehicleTaxonomyBase: vi.fn(async () => ({ motoBrands: [], failed: false })),
  fetchCatalogPage,
}));
vi.mock('server-only', () => ({}));

const { default: SearchRoute, generateMetadata } = await import('./page');

async function renderAt(q: string | undefined) {
  cleanup();
  render(await SearchRoute({ searchParams: Promise.resolve(q === undefined ? {} : { q }) }));
}

const ITEM = (name: string) => ({ id: 1, slug: 's', brand: 'B', name, price: 1 });

beforeEach(() => {
  searchProducts.mockReset();
  fetchCatalogPage.mockReset();
  fetchCatalogPage.mockResolvedValue({ products: [], total: 0, error: false });
});

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

  it('S4 搜尋結果頁不進索引', async () => {
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ q: '排氣管' }) });
    expect((metadata.robots as { index: boolean }).index).toBe(false);
  });

  it('S4b 仍有一條 canonical 指向這一頁自己(2026-09-29:否則手機分享會拿到上一頁的網址)', async () => {
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ q: '排氣管' }) });
    expect(String(metadata.alternates?.canonical)).toMatch(/\/search\?q=%E6%8E%92%E6%B0%A3%E7%AE%A1$/);
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

  it('S7 🔴 超長 q ⇒ 畫面印的是【截斷後】的字,與實際搜的那個字串相同(R2 must-fix 2)', async () => {
    searchProducts.mockResolvedValue({ items: [], total: 0, error: false });
    const long = '排'.repeat(300);
    await renderAt(long);
    const label = screen.getByText(/沒有找到/).textContent ?? '';
    // 畫面上那個字串的長度 = 上限,不是 300
    expect(label).toContain('排'.repeat(100));
    expect(label, '畫面印了 300 個字,而實際只搜了 100 ⇒ 那句話描述的不是真正跑過的查詢').not.toContain('排'.repeat(101));
    // 🔵 而它與傳給 searchProducts 的是【同一個字串】—— 這才是本格真正要證的
    expect((searchProducts.mock.calls[0] as [string])[0]).toHaveLength(100);
  });

  it('S7-b 🔵 負對照:沒超過上限的字原樣印,不被截(否則上一格用「永遠截」也會過)', async () => {
    searchProducts.mockResolvedValue({ items: [], total: 0, error: false });
    await renderAt('排氣管');
    expect(screen.getByText(/沒有找到「排氣管」/)).toBeTruthy();
  });

  it('S8 🔴 Sean Q3:打「阿卡」文字搜尋 0 筆 ⇒ 改列 Akrapovic 品牌目錄(與疊層同一份退路), 不畫「沒有找到」', async () => {
    searchProducts.mockResolvedValue({ items: [], total: 0, error: false });
    fetchCatalogPage.mockResolvedValue({ products: [ITEM('Akrapovic 尾段'), ITEM('Akrapovic 全段')], total: 2, error: false });
    await renderAt('阿卡');
    expect(screen.getAllByTestId('card').map((c) => c.textContent)).toEqual(['Akrapovic 尾段', 'Akrapovic 全段']);
    expect(screen.queryByText(/沒有找到/)).toBeNull();
    const catalogQuery = fetchCatalogPage.mock.calls[0]![0] as { brands?: string[]; pbrands?: string[] };
    expect(JSON.stringify(catalogQuery)).toContain('akrapovic');
  });

  it('S8-b 負對照:不是俗名的字 0 筆 ⇒ 不打目錄、照舊「沒有找到」', async () => {
    searchProducts.mockResolvedValue({ items: [], total: 0, error: false });
    await renderAt('zzz');
    expect(fetchCatalogPage).not.toHaveBeenCalled();
    expect(screen.getByText(/沒有找到/)).toBeTruthy();
  });

  it('S8-c 🔴 撈失敗時不走退路(否則「暫時無法使用」會被一頁品牌商品蓋掉)', async () => {
    searchProducts.mockResolvedValue({ items: [], total: 0, error: true });
    await renderAt('阿卡');
    expect(fetchCatalogPage).not.toHaveBeenCalled();
    expect(screen.getByText(/暫時無法使用/)).toBeTruthy();
  });
});

describe('搜尋結果首屏照片(2026-09-29 手機速度, 與目錄同一個問題)', () => {
  it('前 4 張卡帶 priority(照片立刻載入、高優先);第 5 張起不帶', async () => {
    // 本檔的 ProductCard 是 mock ⇒ 這裡驗「頁面有沒有把 priority 傳給前 4 張」;
    //   priority 怎麼變成 loading / fetchpriority 由 ProductImage.test.tsx 驗。
    const items = Array.from({ length: 6 }, (_, i) => ({ ...ITEM(`品${i}`), id: i + 1, slug: `s${i}` }));
    searchProducts.mockResolvedValue({ items, total: 6, error: false });
    await renderAt('排氣管');
    expect(screen.getAllByTestId('card').map((c) => c.getAttribute('data-priority'))).toEqual(['true', 'true', 'true', 'true', 'false', 'false']);
  });
});

describe('車款清單讀不到(2026-09-29)', () => {
  it('0 筆而車款清單讀不到 ⇒ 說車款清單讀不到, 不說「沒有找到」;讀得到時照舊', async () => {
    const products = await import('@/lib/products');
    const tv = vi.mocked(products.tryVehicleTaxonomyBase);
    searchProducts.mockResolvedValue({ items: [], total: 0, error: false });
    tv.mockResolvedValueOnce({ motoBrands: [], failed: true });
    await renderAt('rsv4');
    expect(screen.getByText(SEARCH_VEHICLE_TAXONOMY_UNAVAILABLE)).toBeTruthy();
    expect(screen.queryByText(/沒有找到/)).toBeNull();
    tv.mockResolvedValueOnce({ motoBrands: [], failed: false });
    await renderAt('rsv4');
    expect(screen.queryByText(SEARCH_VEHICLE_TAXONOMY_UNAVAILABLE)).toBeNull();
    expect(screen.getByText(/沒有找到/)).toBeTruthy();
  });
});
