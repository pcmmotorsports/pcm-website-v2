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
import { useSearchParams } from 'next/navigation';
import { navigateToCatalog } from '@/lib/catalog-navigation';
import { sentForTests } from '@/lib/url-writer';
import { getVehicleIntent } from '@/lib/vehicle-intent';
import { resolveVehicleFromUrl } from '@/lib/vehicle-url';
import { ProductsPage } from './ProductsPage';
import { CartProvider } from '../contexts/CartContext';
import { renderNextLike, router, type NextLikeHarness } from './test-utils/next-like-router';
import type { LandingMode } from './test-utils/next-like-navigation';
import type { MockMotoBrand } from '../data/mock-moto-brands';
import type { MockCategory } from '../data/mock-categories';
import type { MockBrand } from '../data/mock-brands';
import { readVehicleContext, writeVehicleContext } from '@/lib/vehicle-context';
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

const BRANDS = [{ id: 'akrapovic', name: 'AKRAPOVIC', count: 300 }] as unknown as MockBrand[];
/** 伺服器依網址給的 `searchKeyword`(關鍵字頁才有),照已落地網址算 ⇒ 移除關鍵字後膠囊會消失。 */
function PageFromUrl() {
  const sp = useSearchParams();
  return (
    <ProductsPage
      products={PRODUCTS}
      total={350}
      error={false}
      categories={CATEGORIES}
      brands={BRANDS}
      motoBrands={MOTO_BRANDS}
      searchKeyword={sp.get('search') ?? undefined}
      // 伺服器選了車才給第二區「通用配件」(自己的頁碼 upage)
      universal={
        resolveVehicleFromUrl(sp, MOTO_BRANDS).kind === 'ok'
          ? { products: PRODUCTS.slice(0, 20), total: 350, page: Number(sp.get('upage') ?? 1) }
          : null
      }
    />
  );
}
const page = () => (
  <CartProvider>
    <PageFromUrl />
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
function pickBrand(name: string) {
  const input = screen.getAllByPlaceholderText('選擇或輸入廠牌')[0]!;
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
/** `from`:傳 `[]` = 不檢查過程(客人自己中途選過別台,例如 T7)。 */
function expectStayed(from: string[], vehicle: string | null) {
  expect(vehicleOf(h!.landed()), `已落地 ${h!.landed()}`).toBe(vehicle);
  expect(vehicleOf(h!.address()), `網址列 ${h!.address()}`).toBe(vehicle);
  expect(vehicleShown(h!.container)).toBe(vehicle === 'yamaha:yzf-r7' ? 'YZF-R7' : null);
  if (vehicle === 'yamaha:yzf-r7' && from.length > 0) expect(afterPickR7(), `過程 ${seen.join(' → ')}`).not.toContain('MT-07');
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

describe('Codex 片 4+5 R1 必修', () => {
  const q = () => new URL(h!.landed(), 'http://x').searchParams;

  it.each(MODES)('① 進站帶品牌(%s):品牌不被取消;之後選分類,品牌仍在網址上', async (mode) => {
    await start(mode, '/products?pbrands=akrapovic&page=3');
    expect([...document.querySelectorAll('.ac-chip')].map((c) => c.firstChild?.textContent)).toContain('AKRAPOVIC');
    pickCategory('煞車系統');
    await h!.flushAll();
    expect(q().get('pbrands')).toBe('akrapovic');
    expect(q().get('category')).toBe('煞車系統');
  });

  it.each(MODES)('② 外部導航到關鍵字頁(%s):目的網址的分類、品牌、頁碼、unmatched 都留著,不產生 q0', async (mode) => {
    await start(mode, '/products?category=%E6%8E%92%E6%B0%A3%E7%B3%BB%E7%B5%B1');
    await h!.navigateExternal('/products?search=abc&category=%E7%85%9E%E8%BB%8A%E7%B3%BB%E7%B5%B1&pbrands=akrapovic&page=3&unmatched=zzz');
    await h!.flushAll();
    expect(q().get('search')).toBe('abc');
    expect(q().get('category')).toBe('煞車系統');
    expect(q().get('pbrands')).toBe('akrapovic');
    expect(q().get('page')).toBe('3');
    expect(q().get('unmatched')).toBe('zzz');
    expect(q().get('q0')).toBeNull();
  });

  it.each(MODES)('③ hydration 進站 ?車款+分類+page=3(%s):停在第 3 頁', async (mode) => {
    seen = [];
    h = renderNextLike(page, {
      mode,
      url: '/products?vehicle=yamaha:yzf-r7&category=%E6%8E%92%E6%B0%A3%E7%B3%BB%E7%B5%B1&page=3',
      onCommit: recordCommit,
      hydrate: true,
    });
    await h.flushAll();
    expect(q().get('page')).toBe('3');
    expect(vehicleOf(h.landed())).toBe('yamaha:yzf-r7');
    expect(vehicleShown(h.container)).toBe('YZF-R7');
  });

  it.each(MODES)('③ 同頁外部導航同時換車、換分類、指定 page=3(%s):停在第 3 頁', async (mode) => {
    await start(mode, '/products?vehicle=yamaha:mt-07');
    await h!.navigateExternal('/products?vehicle=yamaha:yzf-r7&category=%E6%8E%92%E6%B0%A3%E7%B3%BB%E7%B5%B1&page=3');
    await h!.flushAll();
    expect(q().get('page')).toBe('3');
    expect(vehicleOf(h!.landed())).toBe('yamaha:yzf-r7');
  });

  it.each(MODES)('④ 進站 ?page=3(沒有鏡)後改排序(%s):回第 1 頁', async (mode) => {
    await start(mode, '/products?page=3');
    changeSort('price-asc');
    await h!.flushAll();
    expect(q().get('sort')).toBe('price-asc');
    expect(q().get('page')).toBeNull();
  });

  it.each(MODES)('④ 進站 ?分類&page=3 而鏡有車(%s):回第 1 頁(R1 MF-3)', async (mode) => {
    writeVehicleContext({ brandId: 'yamaha', modelId: 'mt-07', label: 'Yamaha MT-07', brandName: 'Yamaha', modelName: 'MT-07' });
    await start(mode, '/products?category=%E6%8E%92%E6%B0%A3%E7%B3%BB%E7%B5%B1&page=3');
    expect(vehicleOf(h!.landed())).toBe('yamaha:mt-07');
    expect(q().get('page')).toBeNull();
  });

  it.each(MODES)('⑤ 選 MT-07 後按上一頁回到沒有車款的網址(%s):選車鏡清掉', async (mode) => {
    await start(mode, '/products');
    await h!.navigateExternal('/products?filter=new');
    await h!.flushAll();
    pickBrand('Yamaha');
    pickModel('MT-07');
    await h!.flushAll();
    expect(readVehicleContext()?.modelId).toBe('mt-07');
    await h!.back();
    await h!.flushAll();
    expect(vehicleOf(h!.landed())).toBeNull();
    expect(vehicleShown(h!.container)).toBeNull();
    expect(readVehicleContext()).toBeNull();
  });
});

describe('片 6:清除全部、移除分類 / 關鍵字、頁首連結、搜尋面板交接', () => {
  const q = () => new URL(h!.landed(), 'http://x').searchParams;
  const clickText = (sel: string, text: string) => {
    const el = [...document.querySelectorAll(sel)].find((e) => e.textContent?.includes(text));
    expect(el, `找不到 ${sel} ${text}`).toBeTruthy();
    act(() => fireEvent.click(el!, { button: 0 }));
  };

  it.each(cells)('T2b(%s / %s)選 R7 ⇒ 移除關鍵字(push)⇒ 改排序', async (mode, rhythm) => {
    const seen = await start(mode, '/products?vehicle=yamaha:mt-07&search=abc');
    pickModel('YZF-R7');
    await between(rhythm);
    clickText('.ac-chip', '搜尋:abc');
    await between(rhythm);
    changeSort('price-asc');
    await h!.flushAll();
    expectStayed(seen, 'yamaha:yzf-r7');
    expect(q().get('search')).toBeNull();
    expect(q().get('sort')).toBe('price-asc');
  });

  it.each([
    ['膠囊列', '.ac-clear-all'],
    ['側欄', '.fs-clear'],
  ])('T3 清除全部(%s)⇒ 改排序 ⇒ 重新整理:沒有車款、沒有分類', async (_n, sel) => {
    for (const mode of MODES) {
      await start(mode, '/products?vehicle=yamaha:yzf-r7&category=%E6%8E%92%E6%B0%A3%E7%B3%BB%E7%B5%B1');
      clickText(sel, '清除全部');
      changeSort('price-asc');
      await h!.reload();
      await h!.flushAll();
      expect(vehicleOf(h!.landed()), mode).toBeNull();
      expect(q().get('category'), mode).toBeNull();
      expect(q().get('sort'), mode).toBe('price-asc');
      expect(readVehicleContext(), mode).toBeNull();
      h!.dispose();
      h = null;
    }
  });

  it.each(cells)('T8(%s / %s)換分類 ⇒ 點「商品目錄」連結 ⇒ 立刻改排序:R7、分類清掉、排序保留', async (mode, rhythm) => {
    const seen = await start(mode, '/products?vehicle=yamaha:yzf-r7');
    pickCategory('煞車系統');
    await between(rhythm);
    // 列表頁上的「商品目錄」:麵包屑那一顆(選了分類才出現;與頁首同一個 CatalogLink)。測試環境的頁首是手機版
    clickText('.pp-breadcrumb a', '商品目錄');
    changeSort('price-asc');
    await h!.flushAll();
    expectStayed(seen, 'yamaha:yzf-r7');
    expect(q().get('category')).toBeNull();
    expect(q().get('sort')).toBe('price-asc');
  });

  it.each(MODES)('T8b(%s)點頁尾「新品上架」⇒ 立刻改排序:R7、filter=new、排序保留', async (mode) => {
    const seen = await start(mode, '/products?vehicle=yamaha:yzf-r7');
    clickText('a', '新品上架');
    changeSort('price-asc');
    await h!.flushAll();
    expectStayed(seen, 'yamaha:yzf-r7');
    expect(q().get('filter')).toBe('new');
    expect(q().get('sort')).toBe('price-asc');
  });

  it.each(MODES)('T9(%s)列表頁有分類時用搜尋面板選 R7 ⇒ 分類跟著新網址清掉,不被寫回(Fable 片 6 R1 必修)', async (mode) => {
    const seen = await start(mode, '/products?vehicle=yamaha:mt-07');
    pickCategory('煞車系統');
    await h!.flushAll();
    expect(q().get('category')).toBe('煞車系統');
    act(() => navigateToCatalog(router, '/products?vehicle=yamaha:yzf-r7'));
    await h!.flushAll();
    changeSort('price-asc');
    await h!.flushAll();
    expect(q().get('category')).toBeNull();
    expect([...document.querySelectorAll('.ac-chip')].map((c) => c.firstChild?.textContent)).not.toContain('煞車系統');
    expectStayed(seen, 'yamaha:yzf-r7');
  });

  it.each(cells)('T9(%s / %s)搜尋面板選 R7(navigateToCatalog)⇒ 立刻改排序:R7', async (mode, rhythm) => {
    const seen = await start(mode, '/products?vehicle=yamaha:mt-07');
    act(() => navigateToCatalog(router, '/products?vehicle=yamaha:yzf-r7'));
    await between(rhythm);
    changeSort('price-asc');
    await h!.flushAll();
    expectStayed(seen, 'yamaha:yzf-r7');
    expect(q().get('sort')).toBe('price-asc');
  });

  it.each(MODES)('T9b(%s)搜尋面板選 R7 ⇒ 導航完成前重新整理:回到 MT-07,畫面 / 網址一致(已接受限制 §0-1 第 1 條)', async (mode) => {
    await start(mode, '/products?vehicle=yamaha:mt-07');
    act(() => navigateToCatalog(router, '/products?vehicle=yamaha:yzf-r7'));
    await h!.reload();
    await h!.flushAll();
    expect(vehicleOf(h!.landed())).toBe('yamaha:mt-07');
    expect(vehicleOf(h!.address())).toBe('yamaha:mt-07');
    expect(vehicleShown(h!.container)).toBe('MT-07');
  });

  it.each(MODES)('T9c(%s)搜尋面板選 R7 ⇒ 等完成 ⇒ 重新整理:R7', async (mode) => {
    await start(mode, '/products?vehicle=yamaha:mt-07');
    act(() => navigateToCatalog(router, '/products?vehicle=yamaha:yzf-r7'));
    await h!.flushAll();
    await h!.reload();
    await h!.flushAll();
    expectStayed([], 'yamaha:yzf-r7');
  });

  it.each(MODES)('T9d(%s)搜尋面板搜另一個關鍵字(不帶車款)⇒ 落地後網址補回 R7', async (mode) => {
    await start(mode, '/products?vehicle=yamaha:yzf-r7');
    act(() => navigateToCatalog(router, '/products?search=xyz'));
    await h!.flushAll();
    expect(q().get('search')).toBe('xyz');
    expect(vehicleOf(h!.landed())).toBe('yamaha:yzf-r7');
  });
});

describe('片 7:認不得的車款提示、建議、移除車款條件、商品卡與頁碼連結', () => {
  const q = () => new URL(h!.landed(), 'http://x').searchParams;
  const notice = () => document.querySelector('[role="status"]')?.textContent ?? '';

  it.each(cells)('T5(%s / %s)認不得的車款 ⇒ 提示、不顯示商品 ⇒ 點建議 R7 ⇒ 改排序 ⇒ 換分類', async (mode, rhythm) => {
    const seen = await start(mode, '/products?vehicle=yamaha:nosuch');
    expect(notice()).toContain('找不到這台車,你是不是要找:');
    expect(document.querySelector('.pp-grid')).toBeNull();
    expect(vehicleShown(h!.container)).toBeNull(); // 不套用上次選的車
    const link = [...document.querySelectorAll('.pp-vehicle-suggestion')].find((a) => a.textContent === 'Yamaha YZF-R7')!;
    expect(new URL(link.getAttribute('href')!, 'http://x').searchParams.get('vehicle')).toBe('yamaha:yzf-r7');
    act(() => fireEvent.click(link, { button: 0 }));
    await between(rhythm);
    changeSort('price-asc');
    await between(rhythm);
    pickCategory('煞車系統');
    await h!.flushAll();
    expectStayed(seen, 'yamaha:yzf-r7');
    expect(q().get('sort')).toBe('price-asc');
    expect(q().get('category')).toBe('煞車系統');
    expect(readVehicleContext()?.modelId).toBe('yzf-r7');
  });

  it.each(MODES)('T6(%s)只差空白 ⇒ 直接選 R7、網址改成正規寫法;換分類 ⇒ 改排序仍是 R7', async (mode) => {
    const seen = await start(mode, '/products?vehicle=yamaha:YZF%20R7');
    expect(vehicleOf(h!.landed())).toBe('yamaha:yzf-r7');
    pickCategory('煞車系統');
    changeSort('price-asc');
    await h!.flushAll();
    expectStayed(seen, 'yamaha:yzf-r7');
  });

  it.each(MODES)('移除車款條件(%s)⇒ 沒有車款、選車鏡清掉、頁碼回第 1 頁;重新整理不會跑回舊車', async (mode) => {
    writeVehicleContext({ brandId: 'yamaha', modelId: 'mt-07', label: 'Yamaha MT-07', brandName: 'Yamaha', modelName: 'MT-07' });
    await start(mode, '/products?vehicle=yamaha:nosuch&page=2');
    const btn = [...document.querySelectorAll('.pp-vehicle-notfound-remove')][0]!;
    act(() => fireEvent.click(btn));
    await h!.flushAll();
    expect(vehicleOf(h!.landed())).toBeNull();
    expect(q().get('page')).toBeNull();
    expect(readVehicleContext()).toBeNull();
    expect(document.querySelector('.pp-grid')).not.toBeNull();
    await h!.reload();
    await h!.flushAll();
    expect(vehicleOf(h!.landed())).toBeNull();
    expect(vehicleShown(h!.container)).toBeNull();
  });

  it.each(MODES)('牌子也認不得(%s)⇒ 沒有建議的那一句', async (mode) => {
    await start(mode, '/products?vehicle=zzq:nope');
    expect(notice()).toContain('找不到這台車,請在上方重新選擇車款,或');
    expect(document.querySelectorAll('.pp-vehicle-suggestion')).toHaveLength(0);
  });

  // Sean 2026-09-27 Q2 甲:車款以外還有篩選時,提示裡要能一鍵清掉全部(否則要先移除車款、再清一次)。
  it.each(MODES)('清除所有篩選(%s)⇒ 車款、品牌、分類都拿掉,排序保留;重新整理不會跑回舊車', async (mode) => {
    await start(mode, '/products?vehicle=yamaha:nosuch&pbrands=zzqx-nobrand&category=%E6%8E%92%E6%B0%A3%E7%B3%BB%E7%B5%B1&sort=price-asc');
    const btn = [...document.querySelectorAll('.ac-clear-all')].find((e) => e.textContent === '清除所有篩選');
    expect(btn, '提示裡沒有「清除所有篩選」').toBeTruthy();
    act(() => fireEvent.click(btn!));
    await h!.flushAll();
    expect(vehicleOf(h!.landed())).toBeNull();
    expect(q().get('pbrands')).toBeNull();
    expect(q().get('category')).toBeNull();
    expect(q().get('sort')).toBe('price-asc');
    expect(readVehicleContext()).toBeNull();
    await h!.reload();
    await h!.flushAll();
    expect(vehicleOf(h!.landed())).toBeNull();
    expect(q().get('pbrands')).toBeNull();
  });

  it.each(MODES)('只有車款條件(%s)⇒ 提示裡不出現「清除所有篩選」(移除車款條件就等於清除全部)', async (mode) => {
    await start(mode, '/products?vehicle=yamaha:nosuch&sort=price-asc&page=2');
    expect(notice()).toContain('找不到這台車');
    expect([...document.querySelectorAll('button')].some((e) => e.textContent === '清除所有篩選')).toBe(false);
  });

  it.each(MODES)('L1 / L2(%s)選 R7 之後、還沒落地:商品卡與頁碼連結已經帶 R7', async (mode) => {
    await start(mode, '/products?vehicle=yamaha:mt-07');
    pickModel('YZF-R7');
    const card = document.querySelector('.pp-grid a[href^="/products/"]')!;
    expect(new URL(card.getAttribute('href')!, 'http://x').searchParams.get('vehicle')).toBe('yamaha:yzf-r7');
    const pageLink = [...document.querySelectorAll('.pp-pagination .pp-page-num[href]')].find((a) => a.textContent === '2')!;
    expect(new URL(pageLink.getAttribute('href')!, 'http://x').searchParams.get('vehicle')).toBe('yamaha:yzf-r7');
  });
});

describe('片 8:其餘驗收情境(plan §4-2)', () => {
  const q = () => new URL(h!.landed(), 'http://x').searchParams;
  const clickText = (sel: string, text: string) => {
    const el = [...document.querySelectorAll(sel)].find((e) => e.textContent?.includes(text));
    expect(el, `找不到 ${sel} ${text}`).toBeTruthy();
    act(() => fireEvent.click(el!, { button: 0 }));
  };
  // 關鍵字頁不畫篩選膠囊(只有關鍵字那顆)⇒ 車款改讀選車列(車型欄位的值)
  const selectorShows = () => {
    const input = screen.getAllByPlaceholderText(/選擇或輸入車型/)[0] as HTMLInputElement;
    return input.value === 'YZF-R7' ? 'yamaha:yzf-r7' : input.value === 'MT-07' ? 'yamaha:mt-07' : null;
  };
  const intentSegment = () => {
    const i = getVehicleIntent();
    return i?.kind === 'vehicle' ? i.segment : i?.kind ?? null;
  };

  it.each(cells)('T2(%s / %s)選 R7 ⇒ 移除分類膠囊 ⇒ 點通用配件頁碼 2', async (mode, rhythm) => {
    const seen = await start(mode, '/products?vehicle=yamaha:mt-07&category=%E6%8E%92%E6%B0%A3%E7%B3%BB%E7%B5%B1&page=3');
    pickModel('YZF-R7');
    await between(rhythm);
    clickText('.ac-chip', '排氣系統');
    await between(rhythm);
    const link = [...document.querySelectorAll('.pp-universal .pp-pagination .pp-page-num')].find((e) => e.textContent === '2')!;
    act(() => fireEvent.click(link, { button: 0 }));
    await h!.flushAll();
    expectStayed(seen, 'yamaha:yzf-r7');
    expect(q().get('category')).toBeNull();
    expect(q().get('upage')).toBe('2');
  });

  it.each(MODES)('T7 / T7b(%s)選 MT-07 ⇒ 選回 R7(不再操作)⇒ R7、清單清空;再外部導航到 MT-07 ⇒ 意圖改成 MT-07', async (mode) => {
    await start(mode, '/products?vehicle=yamaha:yzf-r7');
    pickModel('MT-07');
    pickModel('YZF-R7');
    await h!.flushAll();
    expectStayed([], 'yamaha:yzf-r7');
    expect(sentForTests()).toHaveLength(0);
    await h!.navigateExternal('/products?vehicle=yamaha:mt-07');
    await h!.flushAll();
    expect(intentSegment()).toBe('yamaha:mt-07');
    expect(vehicleShown(h!.container)).toBe('MT-07');
  });

  it.each(MODES)('T10(%s)選 R7 ⇒ 卸載再掛載 ⇒ 換分類:不閃回、R7', async (mode) => {
    const seen = await start(mode, '/products?vehicle=yamaha:mt-07');
    pickModel('YZF-R7');
    await h!.remount();
    pickCategory('煞車系統');
    await h!.flushAll();
    expectStayed(seen, 'yamaha:yzf-r7');
  });

  it.each(MODES)('T10b(%s)MT-07 ⇒ 選回 R7 ⇒ 卸載再掛載 ⇒ 等完成 ⇒ 外部連結 MT-07:意圖改成 MT-07', async (mode) => {
    await start(mode, '/products?vehicle=yamaha:yzf-r7');
    pickModel('MT-07');
    pickModel('YZF-R7');
    await h!.remount();
    await h!.flushAll();
    await h!.navigateExternal('/products?vehicle=yamaha:mt-07');
    await h!.flushAll();
    expect(intentSegment()).toBe('yamaha:mt-07');
    expect(vehicleOf(h!.landed())).toBe('yamaha:mt-07');
  });

  it.each(MODES)('T12(%s)選 R7 ⇒ 移除關鍵字(push)⇒ 等完成 ⇒ 上一頁:三樣一致、有 refresh', async (mode) => {
    await start(mode, '/products?vehicle=yamaha:mt-07&search=abc');
    pickModel('YZF-R7');
    clickText('.ac-chip', '搜尋:abc');
    await h!.flushAll();
    router.refresh.mockClear();
    await h!.back();
    await h!.flushAll();
    expect(router.refresh).toHaveBeenCalled();
    expect(vehicleOf(h!.landed())).toBe(vehicleOf(h!.address()));
    expect(q().get('search')).toBe('abc'); // 真的回到了關鍵字那一筆
    expect(selectorShows()).toBe(vehicleOf(h!.landed()));
  });

  it.each(MODES)('T13(%s)清車 ⇒ 移除關鍵字 ⇒ 上一頁:以歷史網址為準(沒有車款、有關鍵字),不補回 R7', async (mode) => {
    await start(mode, '/products?vehicle=yamaha:yzf-r7&search=abc');
    clearVehicle();
    clickText('.ac-chip', '搜尋:abc');
    await h!.flushAll();
    await h!.back();
    await h!.flushAll();
    expect(vehicleOf(h!.landed())).toBeNull();
    expect(q().get('search')).toBe('abc');
    expect(selectorShows()).toBeNull();
  });

  it.each(MODES)('T14(%s)選 R7 ⇒ 立刻點頁尾「商品目錄」⇒ 等完成 ⇒ 上一頁:有 refresh、三樣一致', async (mode) => {
    await start(mode, '/products?vehicle=yamaha:mt-07');
    pickModel('YZF-R7');
    clickText('a', '商品目錄');
    await h!.flushAll();
    router.refresh.mockClear();
    await h!.back();
    await h!.flushAll();
    expect(router.refresh).toHaveBeenCalled();
    expect(vehicleOf(h!.landed())).toBe(vehicleOf(h!.address()));
    const shown = vehicleShown(h!.container);
    expect(shown === 'YZF-R7' ? 'yamaha:yzf-r7' : shown === 'MT-07' ? 'yamaha:mt-07' : null).toBe(vehicleOf(h!.landed()));
  });

  it.each(MODES)('T15(%s)選 R7 ⇒ 點真的頁碼 2(送出 page=2)⇒ 落地第 2 頁 ⇒ 改排序回第 1 頁、仍是 R7', async (mode) => {
    const seen = await start(mode, '/products?vehicle=yamaha:mt-07');
    pickModel('YZF-R7');
    await h!.flushAll();
    clickPage(2); // 會斷言確實送出 page=2(若把頁碼連結當成外部目標登記,這裡就不會送)
    await h!.flushAll();
    expect(q().get('page')).toBe('2');
    changeSort('price-asc');
    await h!.flushAll();
    expect(q().get('page')).toBeNull();
    expect(q().get('sort')).toBe('price-asc');
    expectStayed(seen, 'yamaha:yzf-r7');
  });
});

describe('Fable 片 4+5 R2 必修', () => {
  const q = () => new URL(h!.landed(), 'http://x').searchParams;

  it.each(MODES)('必修 1(%s)離開列表頁後用歷史跳回「沒有車款」的那一筆 ⇒ 沒有車、不會卡住', async (mode) => {
    await start(mode, '/products');
    await h!.navigateExternal('/products?vehicle=yamaha:mt-07'); // push:新增一筆紀錄
    await h!.flushAll();
    expect(vehicleOf(h!.landed())).toBe('yamaha:mt-07');
    h!.unmountAll(); // 去商品頁 / 首頁
    h!.dispose();
    const back = new Promise<void>((r) => window.addEventListener('popstate', () => r(), { once: true }));
    window.history.back(); // 回到沒有車款的那一筆(此時列表頁不在畫面上)
    await back;
    h = renderNextLike(page, { mode, url: '/products', keepModuleState: true, onCommit: recordCommit });
    await h.flushAll();
    expect(vehicleOf(h.landed()), '上一頁清掉的車被寫回').toBeNull();
    expect(vehicleOf(h.address())).toBeNull();
    expect(vehicleShown(h.container)).toBeNull();
  });

  it.each(MODES)('必修 3(%s)卸載再掛載之後,外部導航到「掛載時那個網址」仍要同步分類', async (mode) => {
    await start(mode, '/products?category=%E6%8E%92%E6%B0%A3%E7%B3%BB%E7%B5%B1');
    await h!.remount(); // 卸載再掛載(落地已處理過 ⇒ 不會再叫落地處理)
    pickCategory('煞車系統');
    await h!.flushAll();
    expect(q().get('category')).toBe('煞車系統');
    await h!.navigateExternal('/products?category=%E6%8E%92%E6%B0%A3%E7%B3%BB%E7%B5%B1');
    await h!.flushAll();
    // 🔴 看側欄的「已選」(它讀頁面狀態);膠囊讀的是網址,兩邊不一致時膠囊看起來仍是對的
    const active = [...document.querySelectorAll('.fs-tree-row.is-active')].map((e) => e.textContent?.replace(/\d+$/, '').trim());
    expect(active, '側欄還停在舊分類').toContain('排氣系統');
    expect(active).not.toContain('煞車系統');
    changeSort('price-asc');
    await h!.flushAll();
    expect(q().get('category'), '舊分類被寫回網址').toBe('排氣系統');
  });
});

describe('Fable 片 6 R2 必修', () => {
  const q = () => new URL(h!.landed(), 'http://x').searchParams;

  it.each(MODES)('A1(%s)已經在 /products 又點一次「商品目錄」⇒ 之後換分類仍然寫得進網址', async (mode) => {
    await start(mode, '/products');
    const link = [...document.querySelectorAll('a')].find((a) => a.textContent?.includes('商品目錄'))!;
    act(() => fireEvent.click(link, { button: 0 })); // 目的地就是現在這一頁 ⇒ 不會有落地
    act(() => fireEvent.click(link, { button: 0 })); // 再點一次(同形:連點兩下)
    await h!.flushAll();
    pickCategory('煞車系統');
    await h!.flushAll();
    expect(q().get('category'), '分類寫不進網址(清單裡卡著一筆永遠不會落地的目標)').toBe('煞車系統');
  });
});

describe('Codex 總審必修 4', () => {
  // 🔴 「現在是認不得的車 ⇒ 上一頁回到沒有車款的網址」那一條,原本只設成沒有車、**沒有清選車紀錄**
  //   ⇒ 重新整理時初始化又去讀紀錄,舊車復活,而網址上沒有車 ⇒ 畫面與網址從此各說各話。
  //   把 use-catalog-vehicle-intent 那兩段的順序調回去(notFound 排在 history 前面),這格會紅。
  it.each(MODES)('%s:認不得的車 ⇒ 上一頁到沒有車款的網址 ⇒ 選車紀錄也要清掉', async (mode) => {
    // 🔵 起點用關鍵字頁:那條路刻意不套用選車紀錄(否則紀錄會先被寫進網址,就走不到這個情境)
    writeVehicleContext({ brandId: 'yamaha', modelId: 'mt-07', label: 'Yamaha MT-07', brandName: 'Yamaha', modelName: 'MT-07' });
    await start(mode, '/products?search=carbon');
    expect(vehicleOf(h!.landed()), '前置沒成立:起點不該有車款').toBeNull();
    await h!.navigateExternal('/products?vehicle=yamaha:nosuch'); // 舊書籤那種認不得的車
    await h!.flushAll();
    expect(getVehicleIntent()?.kind, '前置沒成立:這一頁應該是認不得的車').toBe('notFound');
    await h!.back();
    await h!.flushAll();
    expect(vehicleOf(h!.landed())).toBeNull();
    expect(getVehicleIntent()?.kind).toBe('none');
    expect(readVehicleContext(), '上一頁回到沒有車款的網址, 選車紀錄卻還留著舊車').toBeNull();
  });
});

describe('Fable 片 4+5 R4 必修', () => {
  // 🔴 「這台車是程式派給選車列的」那份清單只增不減 ⇒ 後來客人真的按「清除車輛」會被當成程式帶動的。
  //   走一次上一頁 / 下一頁就會各留一筆沒消耗掉的:
  //   把 `use-catalog-vehicle-intent.tsx` 的消耗搬回「意圖與選車列相同就早退」之後,這格會紅。
  it.each(MODES)(
    '%s:外部導航帶車款 ⇒ 上一頁 ⇒ 下一頁 ⇒ 按「清除車輛」⇒ 車款、網址、選車鏡都真的清掉',
    async (mode) => {
      await start(mode, '/products');
      await h!.navigateExternal('/products?vehicle=yamaha:mt-07');
      await h!.flushAll();
      await h!.back();
      await h!.flushAll();
      expect(vehicleOf(h!.landed())).toBeNull();
      await h!.forward();
      await h!.flushAll();
      expect(vehicleOf(h!.landed()), '下一頁沒有回到帶車款那一頁').toBe('yamaha:mt-07');
      expect(vehicleShown(h!.container)).toBe('MT-07');

      clearVehicle();
      await h!.flushAll();
      expect(vehicleShown(h!.container), '選車列沒清掉').toBeNull();
      expect(vehicleOf(h!.landed()), '只有選車列變空, 網址還帶著車款').toBeNull();
      expect(getVehicleIntent()?.kind, '只有選車列變空, 車款意圖沒清').toBe('none');
      expect(readVehicleContext(), '只有選車列變空, 選車鏡沒清').toBeNull();
    },
  );
});

describe('Fable 片 4+5 R3 必修', () => {
  it.each(MODES)(
    '%s:清車 ⇒ 再選一台車(還沒落地)⇒ 頁面進載入畫面時按上一頁 ⇒ 不會卡住、照歷史網址(沒有車)',
    async (mode) => {
    await start(mode, '/products');
    await h!.navigateExternal('/products?vehicle=yamaha:mt-07'); // push:多一筆歷史
    await h!.flushAll();
    clearVehicle();
    await h!.flushAll();
    expect(vehicleOf(h!.landed())).toBeNull(); // 已落地 /products,與待會兒上一頁的目的網址同一個字串
    pickBrand('Yamaha');
    pickModel('YZF-R7'); // 還沒落地
    h!.setPageMounted(false); // 列表頁進 loading.tsx(頁面元件卸載、落地處理沒人登記)
    await h!.back();
    h!.setPageMounted(true); // 頁面掛回來(替身在 popstate 已照 Next 丟掉還沒完成的導航)
    await h!.flushAll();
    expect(vehicleOf(h!.landed()), '上一頁之後又被寫回車款').toBeNull();
    expect(vehicleShown(h!.container)).toBeNull();
    },
  );
});

