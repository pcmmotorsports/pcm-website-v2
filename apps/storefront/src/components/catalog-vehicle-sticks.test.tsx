// @vitest-environment jsdom
// catalog-vehicle-sticks.test.tsx — :901 驗收標準本身(plan `docs/plans/2026-09-22-catalog-url-writer-plan.md` §4-2)。
//
// Sean 原話:「不管客人點多快、點哪裡,車款都會停在 YZF-R7,不會自己跳回去。」
// 用真的 `ProductsPage` + `test-utils/next-like-router`(兩種落地模型:dev 依序落地 / production 只落最後一發)。
//
// 🔴 片 3(本檔第一版)= **負對照**:用今天的寫法跑 T1、T4、T11,證明這套測試抓得到「跳回舊車」。
//    片 8 接上新寫法後,同一組情境改成斷言「不跳回」。
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { ProductsPage } from './ProductsPage';
import { CartProvider } from '../contexts/CartContext';
import { renderNextLike, type NextLikeHarness } from './test-utils/next-like-router';
import type { LandingMode } from './test-utils/next-like-navigation';
import type { MockMotoBrand } from '../data/mock-moto-brands';
import type { MockCategory } from '../data/mock-categories';
import type { CatalogCardProduct } from '@/lib/catalog-page';

vi.mock('next/navigation', async () => (await import('./test-utils/next-like-navigation')).navigationMock);

const MOTO_BRANDS: MockMotoBrand[] = [
  {
    id: 'yamaha',
    name: 'Yamaha',
    models: [
      { id: 'mt-07', name: 'MT-07', years: [] },
      { id: 'yzf-r7', name: 'YZF-R7', years: [] },
    ],
  },
];
const CATEGORIES: MockCategory[] = [
  { id: 'a', name: '排氣系統', count: 300, children: [] },
  { id: 'b', name: '煞車系統', count: 50, children: [] },
];
// 每頁 100 件、共 350 件 ⇒ 有第 3、4 頁(起點 page=3 是畫面上做得到的)
const PRODUCTS = Array.from({ length: 100 }, (_, i) => ({
  id: i + 1,
  slug: `p-${i + 1}`,
  brand: 'AKRAPOVIC',
  name: `排氣管${i + 1}號`,
  fits: '',
  price: 1000,
  origPrice: null,
  isNew: false,
  isSale: false,
  inStock: true,
  category: '排氣系統',
  color: 'silver',
  imgTone: 'neutral',
})) as unknown as CatalogCardProduct[];

beforeAll(() => {
  window.scrollTo = () => {};
  window.matchMedia =
    window.matchMedia ||
    ((query: string) =>
      ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }) as MediaQueryList);
  // 件數 API:測試不關心,回空
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
});

let h: NextLikeHarness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
  sessionStorage.clear();
  localStorage.clear();
});

const page = () => (
  <CartProvider>
    <ProductsPage products={PRODUCTS} total={350} error={false} categories={CATEGORIES} motoBrands={MOTO_BRANDS} />
  </CartProvider>
);

// ── 探針:每一次 DOM 變動都記下「選車膠囊」顯示的車型(過程中每一次畫面更新,§0 ①)──
function vehicleShown(root: ParentNode): string | null {
  const chips = [...root.querySelectorAll('.ac-chip')].map((c) => c.firstChild?.textContent ?? '');
  return chips.find((t) => t === 'MT-07' || t === 'YZF-R7') ?? null;
}
function watchVehicle(root: HTMLElement): string[] {
  const seen: string[] = [];
  const record = () => {
    const v = vehicleShown(root);
    if (seen.at(-1) !== v) seen.push(v ?? '(none)');
  };
  record();
  new MutationObserver(record).observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
  return seen;
}

// ── 客人操作(都點真的元件)──
function pickModel(name: string) {
  const input = screen.getAllByPlaceholderText(/選擇或輸入車型/)[0]!;
  act(() => {
    fireEvent.change(input, { target: { value: name } });
    fireEvent.blur(input);
  });
}
function clearVehicle() {
  act(() => fireEvent.click(screen.getAllByText('清除車輛')[0]!));
}
function pickCategory(name: string) {
  const row = [...document.querySelectorAll('.fs-tree-l1')].find((el) => el.textContent?.includes(name));
  act(() => fireEvent.click(row!));
}
function clickPage(n: number) {
  const link = [...document.querySelectorAll('.pp-pagination .pp-page-num')].find((el) => el.textContent === String(n));
  act(() => fireEvent.click(link!, { button: 0 }));
}
function changeSort(value: string) {
  act(() => fireEvent.change(screen.getAllByLabelText('排序方式')[0]!, { target: { value } }));
}

type Rhythm = 'noFlush' | 'flushOne' | 'flushAll';
async function between(r: Rhythm) {
  if (r === 'flushOne') await h!.flushOne();
  if (r === 'flushAll') await h!.flushAll();
}
const vehicleOf = (href: string) => new URL(href, 'http://x').searchParams.get('vehicle');

const MODES: LandingMode[] = ['sequential', 'latestOnly'];

describe('🔴 負對照:今天的寫法會跳回舊車(片 3;證明測試抓得到)', () => {
  it('T1 選 R7 ⇒ 換分類 ⇒ 點頁碼 2 ⇒ 改排序:至少一種模型、一種節奏最後不是 R7 或過程中閃回 MT-07', async () => {
    const failures: string[] = [];
    for (const mode of MODES) {
      for (const rhythm of ['noFlush', 'flushOne'] as Rhythm[]) {
        h = renderNextLike(page, { mode, url: '/products?vehicle=yamaha:mt-07&page=3', withWriter: false });
        await h.flushAll();
        const seen = watchVehicle(h.container);
        pickModel('YZF-R7');
        await between(rhythm);
        pickCategory('煞車系統');
        await between(rhythm);
        clickPage(2);
        await between(rhythm);
        changeSort('price-asc');
        await h.flushAll();
        const afterPick = seen.slice(seen.indexOf('YZF-R7'));
        if (vehicleOf(h.landed()) !== 'yamaha:yzf-r7' || afterPick.includes('MT-07')) failures.push(`${mode}/${rhythm}`);
        h.dispose();
        h = null;
      }
    }
    expect(failures.length, '今天的寫法應該至少在一格跳回 MT-07;若全部通過,代表這套測試量不到問題').toBeGreaterThan(0);
  });

  it('第 3 頁選車、慢慢等落地:今天就會回到 MT-07(兩種模型都是)', async () => {
    for (const mode of MODES) {
      h = renderNextLike(page, { mode, url: '/products?vehicle=yamaha:mt-07&page=3', withWriter: false });
      await h.flushAll();
      pickModel('YZF-R7');
      await h.flushAll();
      expect(vehicleOf(h.landed()), mode).toBe('yamaha:mt-07');
      h.dispose();
      h = null;
    }
  });

  it('T4 清車 ⇒ 點頁碼 2 ⇒ 換分類:至少一格把 MT-07 寫回來', async () => {
    const failures: string[] = [];
    for (const mode of MODES) {
      h = renderNextLike(page, { mode, url: '/products?vehicle=yamaha:mt-07&page=3', withWriter: false });
      await h.flushAll();
      clearVehicle();
      clickPage(2);
      pickCategory('煞車系統');
      await h.flushAll();
      if (vehicleOf(h.landed()) !== null) failures.push(mode);
      h.dispose();
      h = null;
    }
    expect(failures.length).toBeGreaterThan(0);
  });

  // 🔵 正對照:從第 1 頁出發、每一步都等落地(客人點得慢)時,今天的寫法是對的
  //    ⇒ 證明上面的紅不是因為「操作根本沒生效」。
  // 🔴 起點不能是第 3 頁:今天在第 2 頁以後選車,「選車」與「回第 1 頁」兩個寫入者在同一次更新裡
  //    都送出,後者從還沒落地的舊網址複製 ⇒ 把 MT-07 寫回去 —— 客人點得再慢也一樣(2026-09-22 本檔實測)。
  it.each(MODES)('正對照(%s):第 1 頁出發、每步都落地 ⇒ 最後是 R7、選 R7 後沒閃回', async (mode) => {
    h = renderNextLike(page, { mode, url: '/products?vehicle=yamaha:mt-07', withWriter: false });
    await h.flushAll();
    const seen = watchVehicle(h.container);
    expect(vehicleShown(h.container)).toBe('MT-07');
    pickModel('YZF-R7');
    await h.flushAll();
    expect(vehicleShown(h.container)).toBe('YZF-R7');
    pickCategory('煞車系統');
    await h.flushAll();
    expect(h.landed()).toContain('category=');
    clickPage(2);
    await h.flushAll();
    expect(new URL(h.landed(), 'http://x').searchParams.get('page')).toBe('2');
    changeSort('price-asc');
    await h.flushAll();
    expect(new URL(h.landed(), 'http://x').searchParams.get('sort')).toBe('price-asc');
    expect(vehicleOf(h.landed())).toBe('yamaha:yzf-r7');
    expect(seen.slice(seen.indexOf('YZF-R7'))).not.toContain('MT-07');
    // 🔴 這裡不接「清車」:清車會連分類一起清,分類的寫入者從舊網址複製 ⇒ production 模型下車款又回來
    //    (今天的另一個同類問題,由 T4 負責)。
  });

  it('T11 選 R7 ⇒ 立刻重新整理:回到 MT-07(網址列沒有預寫)', async () => {
    h = renderNextLike(page, { mode: 'latestOnly', url: '/products?vehicle=yamaha:mt-07', withWriter: false });
    await h.flushAll();
    pickModel('YZF-R7');
    expect(vehicleShown(h.container)).toBe('YZF-R7'); // 選車有生效
    await h.reload();
    await h.flushAll();
    expect(vehicleOf(h.landed())).toBe('yamaha:mt-07');
  });
});
