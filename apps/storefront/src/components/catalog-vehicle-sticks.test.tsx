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
import { renderNextLike, router, type NextLikeHarness } from './test-utils/next-like-router';
import type { LandingMode } from './test-utils/next-like-navigation';
import type { MockMotoBrand } from '../data/mock-moto-brands';
import type { MockCategory } from '../data/mock-categories';
import type { CatalogCardProduct } from '@/lib/catalog-page';

vi.mock('next/navigation', async () => (await import('./test-utils/next-like-navigation')).navigationMock);
vi.mock('next/link', async () => ({ default: (await import('./test-utils/next-like-navigation')).FakeLink }));

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

// ── 探針:每一次 React commit 都記下「選車膠囊」顯示的車型(過程中每一次畫面更新,§0 ①)──
//    用 Profiler 的 onRender(每次 commit、DOM 已更新),不用 MutationObserver(會把多次 commit 併成一次,Codex 片 3 R1 必修 4)。
function vehicleShown(root: ParentNode): string | null {
  const chips = [...root.querySelectorAll('.ac-chip')].map((c) => c.firstChild?.textContent ?? '');
  return chips.find((t) => t === 'MT-07' || t === 'YZF-R7') ?? null;
}
let seen: string[] = [];
function recordCommit() {
  const v = vehicleShown(document) ?? '(none)';
  if (seen.at(-1) !== v) seen.push(v);
}
/** 客人選 R7 之後的畫面紀錄;一定要真的出現過 R7(否則「沒閃回」是空斷言)。 */
function afterPickR7(): string[] {
  const i = seen.indexOf('YZF-R7');
  expect(i, `畫面從沒出現 R7:${seen.join(' → ')}`).toBeGreaterThanOrEqual(0);
  return seen.slice(i);
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
  const before = router.replace.mock.calls.length;
  act(() => fireEvent.click(link!, { button: 0 }));
  // 點頁碼確實送出了帶 page=n 的導航(否則後面改排序把頁碼清掉,點頁碼失效也看不出來;Codex 片 3 R2 必修 2)
  const added = router.replace.mock.calls.slice(before).map((c) => new URL(c[0], 'http://x').searchParams.get('page'));
  expect(added, '點頁碼沒有送出 page=' + n).toContain(String(n));
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

// 🔴 負對照(今天的寫法會跳回舊車)跑在片 3 的 commit `c4452d654`(分支 agent/ops-17-exthost-correct):
//    T1、T4、T11、「第 3 頁選車」在舊寫法下都量到跳回 MT-07,正對照(第 1 頁出發、每步都等落地)沒跳 ⇒ 測試量得到問題。
//    接上新寫法之後,同一組情境改成下面的驗收斷言。

const RHYTHMS: Rhythm[] = ['noFlush', 'flushOne', 'flushAll'];
const cells = MODES.flatMap((mode) => RHYTHMS.map((rhythm) => [mode, rhythm] as const));

async function start(mode: LandingMode, url: string) {
  seen = [];
  h = renderNextLike(page, { mode, url, onCommit: recordCommit });
  await h.flushAll();
  return seen;
}
function expectStayed(_seen: string[], vehicle: string | null) {
  expect(vehicleOf(h!.landed()), `已落地 ${h!.landed()}`).toBe(vehicle);
  expect(vehicleOf(h!.address()), `網址列 ${h!.address()}`).toBe(vehicle);
  expect(vehicleShown(h!.container)).toBe(vehicle === 'yamaha:yzf-r7' ? 'YZF-R7' : null);
  if (vehicle === 'yamaha:yzf-r7') expect(afterPickR7(), `過程 ${seen.join(' → ')}`).not.toContain('MT-07');
}

describe('驗收:車款停在 YZF-R7(Sean 原話)', () => {
  it.each(cells)('T1(%s / %s)選 R7 ⇒ 換分類 ⇒ 點頁碼 2 ⇒ 改排序', async (mode, rhythm) => {
    const seen = await start(mode, '/products?vehicle=yamaha:mt-07&page=3');
    pickModel('YZF-R7');
    await between(rhythm);
    pickCategory('煞車系統');
    await between(rhythm);
    clickPage(2);
    await between(rhythm);
    if (rhythm === 'flushAll') {
      // 正對照:每步都落地時,第 2 頁真的落地了
      expect(new URL(h!.landed(), 'http://x').searchParams.get('page')).toBe('2');
    }
    changeSort('price-asc');
    await h!.flushAll();
    expectStayed(seen, 'yamaha:yzf-r7');
    // 其他操作也都生效了(不是「什麼都沒送」所以車款沒變)
    const q = new URL(h!.landed(), 'http://x').searchParams;
    expect(q.get('category')).toBe('煞車系統');
    expect(q.get('sort')).toBe('price-asc');
    expect(q.get('page')).toBeNull(); // 改排序回第 1 頁
  });

  it.each(MODES)('第 3 頁選車、慢慢等落地(%s)⇒ R7', async (mode) => {
    const seen = await start(mode, '/products?vehicle=yamaha:mt-07&page=3');
    pickModel('YZF-R7');
    await h!.flushAll();
    expectStayed(seen, 'yamaha:yzf-r7');
  });

  it.each(cells)('T4(%s / %s)清車 ⇒ 點頁碼 2 ⇒ 換分類 ⇒ 沒有車款', async (mode, rhythm) => {
    const seen = await start(mode, '/products?vehicle=yamaha:mt-07&page=3');
    expect(vehicleShown(h!.container)).toBe('MT-07');
    const clearedAt = seen.length; // 從清車那一刻起算(不是事後取最後一次空白,Codex 片 3 R2 必修 1)
    clearVehicle();
    // 清車確實生效:畫面立刻沒有車,且送出了一發不帶車款的導航(Codex 片 3 R1 必修 3)
    expect(vehicleShown(h!.container)).toBeNull();
    expect(router.replace.mock.calls.some((c) => vehicleOf(c[0]) === null)).toBe(true);
    await between(rhythm);
    clickPage(2);
    await between(rhythm);
    pickCategory('煞車系統');
    await h!.flushAll();
    expectStayed(seen, null);
    expect(new URL(h!.landed(), 'http://x').searchParams.get('category')).toBe('煞車系統');
    expect(seen.slice(clearedAt), `清車後的畫面 ${seen.slice(clearedAt).join(' → ')}`).not.toContain('MT-07');
  });

  it.each(MODES)('T11(%s)選 R7 ⇒ 立刻重新整理 ⇒ R7(網址列已預寫)', async (mode) => {
    await start(mode, '/products?vehicle=yamaha:mt-07');
    pickModel('YZF-R7');
    await h!.reload();
    await h!.flushAll();
    expectStayed([], 'yamaha:yzf-r7');
  });

  it.each(MODES)('R4 ①(%s)換分類 ⇒ 等落地 ⇒ 外部導航到 /products(沒被攔到)⇒ 改排序:分類不被寫回、車款 R7、排序保留', async (mode) => {
    const seen = await start(mode, '/products?vehicle=yamaha:yzf-r7');
    pickCategory('煞車系統');
    await h!.flushAll();
    expect(h!.landed()).toContain('category=');
    await h!.navigateExternal('/products');
    await h!.flushAll();
    changeSort('price-asc');
    await h!.flushAll();
    const q = new URL(h!.landed(), 'http://x').searchParams;
    expect(q.get('category')).toBeNull();
    expect(q.get('sort')).toBe('price-asc');
    expectStayed(seen, 'yamaha:yzf-r7');
  });
});
