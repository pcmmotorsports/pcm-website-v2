// @vitest-environment jsdom
//
// ProductsPage smoke test — 前台 regression 安全網。
// 驗「商品列表頁 render 不報錯 + 標題 / 商品數 / 商品卡 / 篩選器 / 載入失敗態」。
// Header useRouter 走 vi.mock、matchMedia 走 beforeAll stub(同 Header.test.tsx)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。
//
// M-1-13e-b-2:Header 改讀 useCart().totalQty、render 必須 wrap <CartProvider>、否則 throw。
// #220:ProductsPage 改吃 server 傳入的 { products, error } props(列表遷真 Supabase 目錄)。
//   本 smoke 傳小 MockProduct[] fixture(非 MOCK_PRODUCTS)、不依真 DB;另驗 error 旗標 → 載入失敗態。

import { StrictMode, type ReactElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';

// #6:mock 改可變(vi.hoisted)——URL 還原測試需逐測換 searchParams;預設空參數(舊測試行為不變)。
const hoisted = vi.hoisted(() => ({ search: new URLSearchParams() }));
vi.mock('next/navigation', () => ({
  // S1:useVehicleUrlSync 需 router.replace(vehicle → URL → server 重查;測試中 no-op stub)
  useRouter: () => ({
    push: vi.fn(),
    replace: (url: string) => window.history.replaceState(null, '', url),
  }),
  // M-1-13I Bug 1:ProductsPage useSearchParams 讀 URL vehicle(+#6 page/sort/per lazy init)
  useSearchParams: () => hoisted.search,
}));

import { ProductsPage } from './ProductsPage';
import type { MockProduct } from '../data/mock-products';
import type { MockCategory } from '../data/mock-categories';
import type { MockMotoBrand } from '../data/mock-moto-brands';
import { CartProvider } from '../contexts/CartContext';

// S1:車輛下拉清單改 server prop(fetchVehicleTaxonomy);本 smoke 不測車輛下拉、傳空清單
const MOTO_BRANDS: MockMotoBrand[] = [];

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: CartProvider });

// 小 fixture(對齊真資料單一品牌 RPM CARBON、碳纖維部品);取代 MOCK_PRODUCTS 全量。
const FIXTURE: MockProduct[] = [
  {
    id: 1, slug: 'rpm-carbon-tail', brand: 'RPM CARBON', name: '碳纖維車台護蓋',
    fits: 'Aprilia RSV4', price: 14600, origPrice: null, isNew: false, isSale: false,
    inStock: true, category: '碳纖維部品', color: 'silver', imgTone: 'neutral',
  },
  {
    id: 2, slug: 'rpm-carbon-fender', brand: 'RPM CARBON', name: '碳纖維前土除',
    fits: 'Ducati Panigale', price: 9800, origPrice: null, isNew: false, isSale: false,
    inStock: true, category: '碳纖維部品', color: 'silver', imgTone: 'neutral',
  },
];

// C2:分類樹 prop(選項 A 只留有商品分類;RPM 現況即碳纖維部品一項)。
const CATEGORIES: MockCategory[] = [
  { id: 'carbon', name: '碳纖維部品', count: 2, children: [] },
];

beforeAll(() => {
  // jsdom 不實作 matchMedia、Header useEffect 會呼叫 → 補最小 stub
  window.matchMedia = window.matchMedia || ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  } as MediaQueryList));
});

afterEach(() => {
  cleanup();
  // 清掉 CartProvider 寫進 localStorage 的測試殘留、避免 test 之間互染
  if (typeof window !== 'undefined') window.localStorage.clear();
  // #6:還原 searchParams mock + jsdom URL(URL 同步 effect 會 replaceState、避免測試互染)
  hoisted.search = new URLSearchParams();
  window.history.replaceState(null, '', '/');
});

describe('ProductsPage', () => {
  it('should render the products listing without crashing', () => {
    render(<ProductsPage products={FIXTURE} error={false} categories={CATEGORIES} motoBrands={MOTO_BRANDS} />);
    // 預設標題「全部商品」(無篩選)+ 商品數 = fixture 長度(非 MOCK_PRODUCTS)
    expect(screen.getByText('全部商品')).toBeDefined();
    expect(screen.getByText(`${FIXTURE.length} 件商品`)).toBeDefined();
  });

  it('should mount the cascade bar and side filter', () => {
    render(<ProductsPage products={FIXTURE} error={false} categories={CATEGORIES} motoBrands={MOTO_BRANDS} />);
    expect(screen.getByText('確認適用車款')).toBeDefined();
    expect(screen.getByText('篩選條件')).toBeDefined();
  });

  it('should render product cards from the products prop', () => {
    render(<ProductsPage products={FIXTURE} error={false} categories={CATEGORIES} motoBrands={MOTO_BRANDS} />);
    // fixture 商品名 render 進卡片(證真資料 props 接線、非 MOCK_PRODUCTS)
    expect(screen.getByText('碳纖維車台護蓋')).toBeDefined();
    expect(screen.getByText('碳纖維前土除')).toBeDefined();
  });

  it('should render pagination and the mobile filter fab', () => {
    render(<ProductsPage products={FIXTURE} error={false} categories={CATEGORIES} motoBrands={MOTO_BRANDS} />);
    expect(screen.getByLabelText('每頁')).toBeDefined();
    expect(screen.getByText('篩選')).toBeDefined();
  });

  it('should show the load-error state when error flag is set (#220 Q2=A)', () => {
    render(<ProductsPage products={[]} error={true} categories={CATEGORIES} motoBrands={MOTO_BRANDS} />);
    // error → 「載入失敗、請稍後再試」(與真 0 結果「找不到符合條件的商品」區分)
    expect(screen.getByText('載入失敗、請稍後再試')).toBeDefined();
    expect(screen.queryByText('找不到符合條件的商品')).toBeNull();
  });

  it('C4a+C3:零件分類 + 品牌側欄現身(解除 hideCategory/hideBrand);顏色/其他仍隱藏、保留價格範圍', () => {
    render(<ProductsPage products={FIXTURE} error={false} categories={CATEGORIES} motoBrands={MOTO_BRANDS} />);
    // C4a:零件分類樹解除隱藏 → accordion 標題 + 真分類名(碳纖維部品)現身於側欄(ProductCard 不渲染 category、故唯一)
    expect(screen.getByText('零件分類')).toBeDefined();
    expect(screen.getAllByText('碳纖維部品').length).toBeGreaterThan(0);
    // C3:品牌 accordion 現身(filter-specific selector `.fs-section-title`、避與 Header nav「品牌」撞);
    //     展開後見搜尋品牌 input(buildBrandTaxonomy 動態衍生、現況單一 RPM CARBON)
    const brandTitle = screen.getByText('品牌', { selector: '.fs-section-title' });
    fireEvent.click(brandTitle);
    expect(screen.getByPlaceholderText('搜尋品牌')).toBeDefined();
    // 仍隱藏(真資料 no-op):全 silver 顏色 / 無促銷其他
    expect(screen.queryByText('顏色')).toBeNull();
    expect(screen.queryByText('其他')).toBeNull(); // 僅現貨(#161 關)+ 新品/特價(隱)皆空 → 整段隱藏
    // 保留:真價格可篩 + 側欄殼
    expect(screen.getByText('價格範圍')).toBeDefined();
    expect(screen.getByText('篩選條件')).toBeDefined();
  });

  it('欄數:預設自動欄數(auto-fill、卡片固定寬),點欄數鈕鎖定、再點同顆回自動(2026-07-11 撐滿改版)', () => {
    const { container } = render(<ProductsPage products={FIXTURE} error={false} categories={CATEGORIES} motoBrands={MOTO_BRANDS} />);
    const gridCols = () => (container.querySelector('.pp-grid') as HTMLElement).style.gridTemplateColumns;
    // 預設 = 自動欄數(寬螢幕自動加欄、卡片維持固定寬)
    expect(gridCols()).toContain('auto-fill');
    // 點「5 欄」鈕 → 鎖定固定 5 欄
    fireEvent.click(screen.getByLabelText('每排 5 欄'));
    expect(gridCols()).toContain('repeat(5');
    // 再點同一顆 → 回到自動(免加獨立「自動」鈕)
    fireEvent.click(screen.getByLabelText('每排 5 欄'));
    expect(gridCols()).toContain('auto-fill');
  });
});

// #6:page/sort/perPage URL round-trip(back 回列表不重置;Sean 2026-07-03 實測回報)
describe('ProductsPage #6 browse-state URL round-trip', () => {
  // 30 件 fixture:預設每頁 25 → 2 頁,可觀察 page 還原/重置
  const MANY: MockProduct[] = Array.from({ length: 30 }, (_, i) => ({
    ...FIXTURE[0]!,
    id: i + 1,
    slug: `rpm-fixture-${i + 1}`,
    name: `碳纖維部品${i + 1}號`,
  }));

  it('should restore page/sort/perPage from URL params on mount (back-nav 還原)', () => {
    hoisted.search = new URLSearchParams('page=2&sort=price-asc&per=25');
    render(<ProductsPage products={MANY.slice(25)} total={30} error={false} categories={CATEGORIES} motoBrands={MOTO_BRANDS} />);
    // sort/perPage select 還原(displayValue = option 文字)
    expect(screen.getByDisplayValue('價格低到高')).toBeDefined();
    expect(screen.getByDisplayValue('25')).toBeDefined();
    // page=2 還原:每頁 25、共 30 件 → 第 2 頁只顯 5 件;價格全同、sku ASC 穩定 →
    // 第 2 頁應含 30 號(page=1 才有 1 號);mount 首輪不得被 setPage(1) effect 重置(mount-guard)。
    // 🔴 正向斷言必用 getByText(absent 即 throw);queryByText(...).toBeDefined() 是空斷言(回 null 仍過)
    expect(screen.getByText('碳纖維部品30號')).toBeDefined();
    expect(screen.queryByText('碳纖維部品1號')).toBeNull();
  });

  it('should fall back to defaults on invalid params (fail-safe 白名單)', () => {
    hoisted.search = new URLSearchParams('page=-3&sort=bogus&per=999');
    render(<ProductsPage products={MANY.slice(0, 25)} total={30} error={false} categories={CATEGORIES} motoBrands={MOTO_BRANDS} />);
    expect(screen.getByDisplayValue('推薦排序')).toBeDefined(); // sort 白名單外 → recommend
    expect(screen.getByDisplayValue('25')).toBeDefined(); // per 白名單外 → 25
    expect(screen.getByText('碳纖維部品1號')).toBeDefined(); // page<1 → 第 1 頁(getByText:absent 即 throw)
  });

  it('should still reset to page 1 when user changes sort (mount-guard 不得吃掉真重置)', () => {
    hoisted.search = new URLSearchParams('page=2');
    render(<ProductsPage products={MANY.slice(25)} total={30} error={false} categories={CATEGORIES} motoBrands={MOTO_BRANDS} />);
    expect(screen.getByText('碳纖維部品30號')).toBeDefined();
    // P4：排序變更會發出 server navigation；本次 props 仍是目前頁，不能在 client 偽造下一頁。
    fireEvent.change(screen.getByDisplayValue('推薦排序'), { target: { value: 'new' } });
    expect(window.location.search).toContain('sort=new');
    expect(window.location.search).not.toContain('page=');
  });

  it('should sync non-default state back into the URL (replaceState 自癒/分享)', () => {
    hoisted.search = new URLSearchParams('page=2&sort=price-asc');
    render(<ProductsPage products={MANY.slice(25)} total={30} error={false} categories={CATEGORIES} motoBrands={MOTO_BRANDS} />);
    // URL 同步 effect:非預設值寫回 jsdom URL(page=2、sort=price-asc;per=25 預設不寫)
    expect(window.location.search).toContain('page=2');
    expect(window.location.search).toContain('sort=price-asc');
    expect(window.location.search).not.toContain('per=');
  });
});

// Q4-S5(2026-07-05):?category= / ?brand= 入站深連結(首頁分類卡點了無過濾 + 品牌牆 404 修復的
// /products 端接線;producers = CategoryGrid / BrandIndex 連結、另片改)
describe('ProductsPage Q4-S5 category/brand 深連結', () => {
  // 雙分類雙品牌 fixture:證「過濾真的生效」而非只 render(GB 駐車架 + RPM 碳纖維部品)
  const TWO_BRANDS: MockProduct[] = [
    FIXTURE[0]!, // RPM CARBON / 碳纖維部品 / 碳纖維車台護蓋
    {
      ...FIXTURE[1]!,
      id: 3, slug: 'gbracing-ba-675', brand: 'GB RACING', name: '前輪軸防倒球',
      category: '駐車架',
    },
  ];
  const TWO_CATEGORIES: MockCategory[] = [
    { id: 'cat-carbon', name: '碳纖維部品', count: 1, children: [] },
    { id: 'cat-stand', name: '駐車架', count: 1, children: [] },
  ];

  it('?category=<真分類名> → 套用分類篩選(名稱比對、對齊 matchesCategory 鍵)', () => {
    hoisted.search = new URLSearchParams('category=駐車架');
    render(<ProductsPage products={[TWO_BRANDS[1]!]} total={1} error={false} categories={TWO_CATEGORIES} motoBrands={MOTO_BRANDS} />);
    expect(screen.getByText('前輪軸防倒球')).toBeDefined();
    expect(screen.queryByText('碳纖維車台護蓋')).toBeNull(); // 他分類商品被濾掉 = 真過濾
  });

  it('?category=查無值 → fail-safe 忽略、顯示全部(不套用不炸)', () => {
    hoisted.search = new URLSearchParams('category=exhaust');
    render(<ProductsPage products={TWO_BRANDS} total={2} error={false} categories={TWO_CATEGORIES} motoBrands={MOTO_BRANDS} />);
    expect(screen.getByText('前輪軸防倒球')).toBeDefined();
    expect(screen.getByText('碳纖維車台護蓋')).toBeDefined();
  });

  it('?brand=<產品品牌 slug> → 套用品牌篩選(buildBrandTaxonomy 衍生 id 驗證)', () => {
    hoisted.search = new URLSearchParams('pbrand=gb-racing');
    render(<ProductsPage products={[TWO_BRANDS[1]!]} total={1} error={false} categories={TWO_CATEGORIES} motoBrands={MOTO_BRANDS} />);
    expect(screen.getByText('前輪軸防倒球')).toBeDefined();
    expect(screen.queryByText('碳纖維車台護蓋')).toBeNull();
  });

  it('?brand=非產品品牌(如車輛長版遺留值)→ 兩對照表皆查無、fail-safe 顯示全部', () => {
    hoisted.search = new URLSearchParams('brand=Yamaha'); // vehicle 長版 fallback 命名空間、非產品品牌
    render(<ProductsPage products={TWO_BRANDS} error={false} categories={TWO_CATEGORIES} motoBrands={MOTO_BRANDS} />);
    expect(screen.getByText('前輪軸防倒球')).toBeDefined();
    expect(screen.getByText('碳纖維車台護蓋')).toBeDefined();
  });

  it('?brand= 在 StrictMode 雙跑下仍套用一次(urlBrandInitRef 守 toggleBrand 非冪等)', () => {
    // StrictMode dev 雙 invoke mount effect;若無守衛,toggleBrand add→remove 抵銷 → 顯示全部。
    // 守衛正確 → 品牌過濾維持(前輪軸防倒球在、他品牌不在)。
    hoisted.search = new URLSearchParams('brand=gb-racing');
    rtlRender(
      <StrictMode>
        <CartProvider>
          <ProductsPage products={[TWO_BRANDS[1]!]} total={1} error={false} categories={TWO_CATEGORIES} motoBrands={MOTO_BRANDS} />
        </CartProvider>
      </StrictMode>,
    );
    expect(screen.getByText('前輪軸防倒球')).toBeDefined();
    expect(screen.queryByText('碳纖維車台護蓋')).toBeNull();
  });

  it('?category=…&page=2 → 分類還原不誤觸頁碼重置(skipOnce 旗標涵蓋 category)', () => {
    const MANY_STAND: MockProduct[] = Array.from({ length: 30 }, (_, i) => ({
      ...FIXTURE[0]!, id: i + 1, slug: `gb-fixture-${i + 1}`, brand: 'GB RACING',
      name: `駐車架部品${i + 1}號`, category: '駐車架',
    }));
    hoisted.search = new URLSearchParams('category=駐車架&page=2');
    render(<ProductsPage products={MANY_STAND.slice(25)} total={30} error={false} categories={TWO_CATEGORIES} motoBrands={MOTO_BRANDS} />);
    // 30 件同分類、每頁 25 → 第 2 頁只有 26-30 號;mount 的 category dispatch 不得把 page 打回 1
    expect(screen.getByText('駐車架部品30號')).toBeDefined();
    expect(screen.queryByText('駐車架部品1號')).toBeNull();
  });
});
