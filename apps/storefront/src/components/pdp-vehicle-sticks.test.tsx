// @vitest-environment jsdom
// pdp-vehicle-sticks.test.tsx — :901 商品詳情頁的驗收(plan `docs/plans/2026-09-22-catalog-url-writer-plan.md` §4-4)。
//
// 規則與列表頁同一套:客人最後選的車款說了算,還沒落地時做的事(點連結、加入購物車)也帶那台車;
// 清車之後不論重新整理或卸載再掛載都不會跑回來。用真的 `ProductPage` + 仿 Next 的 router 替身。
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { ProductPage } from './ProductPage';
import { CartProvider } from '../contexts/CartContext';
import { renderNextLike, router, type NextLikeHarness } from './test-utils/next-like-router';
import type { LandingMode } from './test-utils/next-like-navigation';
import { MOCK_PRODUCTS } from '../data/mock-products';
import type { MockMotoBrand } from '@/data/mock-moto-brands';
import { readVehicleContext, writeVehicleContext } from '@/lib/vehicle-context';

vi.mock('next/navigation', async () => (await import('./test-utils/next-like-navigation')).navigationMock);
vi.mock('next/link', async () => ({ default: (await import('./test-utils/next-like-navigation')).FakeLink }));

const MOTO: MockMotoBrand[] = [
  {
    id: 'yamaha',
    name: 'Yamaha',
    models: [
      { id: 'mt-07', name: 'MT-07', years: [2021] },
      { id: 'yzf-r7', name: 'YZF-R7', years: [2021, 2022] },
      // 🔴 撞名序號 id(字典 id 與 slugify(名稱) 不同)⇒ 拿來證明選車鏡寫的是字典 id
      { id: 'mt-07-2', name: 'MT 07', years: [2021] },
    ],
  },
];
const PRODUCT = {
  ...MOCK_PRODUCTS[0]!,
  fitments: [
    { motoBrand: 'Yamaha', modelCode: 'MT-07', yearStart: 2021, yearEnd: 2021 },
    { motoBrand: 'Yamaha', modelCode: 'YZF-R7', yearStart: 2021, yearEnd: 2022 },
    { motoBrand: 'Yamaha', modelCode: 'MT 07', yearStart: 2021, yearEnd: 2021 },
  ],
};

beforeAll(() => {
  window.scrollTo = () => {};
  window.matchMedia =
    window.matchMedia ||
    ((query: string) =>
      ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }) as MediaQueryList);
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
    {/* 🔴 `relatedMoreHref` 是伺服器依【當時網址】算的,帶著那時的車款 ⇒ 清車後不能再用它。
        `relatedHasVehicle` 跟著一起給:route 是 `relatedHasVehicle={vehicle != null}`
        (`app/products/[slug]/page.tsx:288,328`)⇒ 連結帶車 = 這個旗標為真,兩者在正式站不會不一致。 */}
    <ProductPage
      product={PRODUCT}
      tier="general"
      related={MOCK_PRODUCTS.slice(1, 3)}
      relatedHasMore
      relatedMoreHref="/products?vehicle=yamaha%3Amt-07"
      relatedHasVehicle
      motoBrands={MOTO}
    />
  </CartProvider>
);
const start = async (mode: LandingMode, url: string) => {
  h = renderNextLike(page, { mode, url });
  await h.flushAll();
};
const vehicleOf = (href: string) => new URL(href, 'http://x').searchParams.get('vehicle');
const cartVehicle = () => {
  const raw = window.localStorage.getItem('pcm-cart-mock-v2');
  return raw ? (JSON.parse(raw) as { vehicle?: { model?: string } }[])[0]?.vehicle : undefined;
};
/** 在「是否適用我的車」那一區選車(廠牌 ⇒ 車型 ⇒ 確認)。 */
function pickVehicleInFitment(model: string) {
  act(() => fireEvent.click(screen.getAllByText(/更改車款|選擇車款|選擇您的車/)[0]!));
  const brand = screen.getAllByPlaceholderText(/選擇或輸入廠牌/)[0]!;
  act(() => {
    fireEvent.change(brand, { target: { value: 'Yamaha' } });
    fireEvent.blur(brand);
  });
  const m = screen.getAllByPlaceholderText(/選擇或輸入車型/)[0]!;
  act(() => {
    fireEvent.change(m, { target: { value: model } });
    fireEvent.blur(m);
  });
}
const clearInBreadcrumb = () => act(() => fireEvent.click(screen.getByLabelText(/清除車輛篩選/)));
const addToCartMobile = async () => {
  const btn = document.querySelector('.pd-mbb-cart') as HTMLButtonElement;
  expect(btn, '找不到手機加入購物車').toBeTruthy();
  await act(async () => {
    fireEvent.click(btn);
  });
};

const MODES: LandingMode[] = ['sequential', 'latestOnly'];

describe('商品詳情頁:車款停在客人最後選的那台', () => {
  it.each(MODES)('%s:選 R7 ⇒ 還沒落地就點麵包屑車款標籤 / 相關商品 / 看更多 ⇒ 都帶 R7', async (mode) => {
    await start(mode, '/products/lightech-1?vehicle=yamaha:mt-07');
    pickVehicleInFitment('YZF-R7');
    const related = document.querySelector('.pd-related-grid a[href^="/products/"]')!;
    expect(vehicleOf(related.getAttribute('href')!)).toBe('yamaha:yzf-r7');
    const more = document.querySelector('.pd-related-more-link')!;
    expect(vehicleOf(more.getAttribute('href')!)).toBe('yamaha:yzf-r7');
    const pill = screen.getByLabelText(/回到商品列表/);
    expect(pill.textContent).toContain('YZF-R7');
    act(() => fireEvent.click(pill));
    expect(vehicleOf(router.push.mock.calls.at(-1)?.[0] as string)).toBe('yamaha:yzf-r7');
  });

  it.each(MODES)('%s:選 R7 ⇒ 立刻加入購物車(手機與桌機)⇒ 帶 R7', async (mode) => {
    await start(mode, '/products/lightech-1?vehicle=yamaha:mt-07');
    pickVehicleInFitment('YZF-R7');
    await addToCartMobile();
    expect(cartVehicle(), '手機加購沒帶車款').toMatchObject({ brand: 'Yamaha', model: 'YZF-R7' });
    // 🔵 桌機那顆在 `ProductInfo.test.tsx` 自己那一格驗(兩個入口讀同一支 `readSearchVehicle`);
    //    這裡只確認它在畫面上(不是被藏起來了)。
    expect(document.querySelector('.pd-add-btn')).not.toBeNull();
  });

  it.each(MODES)('%s:麵包屑清車 ⇒ 立刻加購不帶車、選車鏡清掉、重新整理也不會跑回來', async (mode) => {
    writeVehicleContext({ brandId: 'yamaha', modelId: 'mt-07', label: 'Yamaha MT-07', brandName: 'Yamaha', modelName: 'MT-07' });
    await start(mode, '/products/lightech-1?vehicle=yamaha:mt-07');
    clearInBreadcrumb();
    await addToCartMobile();
    expect(cartVehicle()).toBeUndefined();
    expect(readVehicleContext()).toBeNull();
    await h!.flushAll();
    expect(vehicleOf(h!.landed())).toBeNull();
    await h!.reload();
    await h!.flushAll();
    expect(vehicleOf(h!.landed())).toBeNull();
    expect(screen.queryByLabelText(/回到商品列表/)).toBeNull();
  });

  it.each(MODES)('%s:純長版網址 ?brand=&model= 清車 ⇒ 網址不留車款(短版與長版一起清)', async (mode) => {
    await start(mode, '/products/lightech-1?brand=yamaha&model=mt-07&from=catalog');
    clearInBreadcrumb();
    await h!.flushAll();
    const q = new URL(h!.landed(), 'http://x').searchParams;
    expect(q.get('vehicle')).toBeNull();
    expect(q.get('brand')).toBeNull();
    expect(q.get('model')).toBeNull();
    expect(q.get('from')).toBe('catalog');
  });

  it.each(MODES)('%s:選 R7 ⇒ 卸載再掛載 ⇒ 仍是 R7(不閃回 MT-07)', async (mode) => {
    await start(mode, '/products/lightech-1?vehicle=yamaha:mt-07');
    pickVehicleInFitment('YZF-R7');
    await h!.remount();
    expect(screen.getByLabelText(/回到商品列表/).textContent).toContain('YZF-R7');
    await h!.flushAll();
    expect(vehicleOf(h!.landed())).toBe('yamaha:yzf-r7');
  });

  it.each(MODES)('%s:網址車款認不得 ⇒ 提示與建議(通用商品也看得到)、不套用選車鏡', async (mode) => {
    writeVehicleContext({ brandId: 'yamaha', modelId: 'mt-07', label: 'Yamaha MT-07', brandName: 'Yamaha', modelName: 'MT-07' });
    h = renderNextLike(
      () => (
        <CartProvider>
          {/* 通用商品:沒有 fitments ⇒ 適用判斷那一區本來整段不畫,提示要在那道早退之前 */}
          <ProductPage product={{ ...MOCK_PRODUCTS[0]!, fitments: [] }} tier="general" related={[]} motoBrands={MOTO} />
        </CartProvider>
      ),
      { mode, url: '/products/lightech-1?vehicle=yamaha:nosuch' },
    );
    await h.flushAll();
    expect(document.querySelector('[role="status"]')?.textContent).toContain('找不到這台車');
    expect(screen.queryByLabelText(/回到商品列表/)).toBeNull(); // 不套用上次選的車
    const suggestion = [...document.querySelectorAll('.pp-vehicle-suggestion')].find((a) => a.textContent === 'Yamaha YZF-R7')!;
    expect(suggestion, '沒有列出同品牌建議').toBeTruthy();
    act(() => fireEvent.click(suggestion, { button: 0 }));
    await h.flushAll();
    expect(vehicleOf(h.landed())).toBe('yamaha:yzf-r7');
    expect(readVehicleContext()?.modelId).toBe('yzf-r7');
  });

  it.each(MODES)('%s(Fable R1 必修 1)通用商品沒有車款字典 ⇒ 加入購物車仍帶選車鏡那台車', async (mode) => {
    writeVehicleContext({ brandId: 'yamaha', modelId: 'mt-07', label: 'Yamaha MT-07', brandName: 'Yamaha', modelName: 'MT-07' });
    h = renderNextLike(
      () => (
        <CartProvider>
          {/* route 對沒有 fitments 的商品就是傳空字典 */}
          <ProductPage product={{ ...MOCK_PRODUCTS[0]!, fitments: [] }} tier="general" related={[]} motoBrands={[]} />
        </CartProvider>
      ),
      { mode, url: '/products/lightech-1' },
    );
    await h.flushAll();
    await addToCartMobile();
    expect(cartVehicle(), '通用商品加購把選車鏡那台車弄丟了').toMatchObject({ brand: 'Yamaha', model: 'MT-07' });
  });

  // 🔴 落地處理也要有「字典是空的就不判」那道(Fable 片 9+10 R2 nit A)——
  //    少了它:通用商品頁收到一個帶車款的落地 ⇒ 拿空字典去解 ⇒ 合法的車被判成「認不得」
  //    ⇒ 意圖變 notFound ⇒ 加購不帶車。拿掉 `use-pdp-vehicle-intent.tsx` 那一行守衛,這格會紅。
  it.each(MODES)('%s(Fable R2 nit A)沒有車款字典時收到帶車款的落地 ⇒ 不把那台車判成認不得', async (mode) => {
    writeVehicleContext({ brandId: 'yamaha', modelId: 'mt-07', label: 'Yamaha MT-07', brandName: 'Yamaha', modelName: 'MT-07' });
    h = renderNextLike(
      () => (
        <CartProvider>
          <ProductPage product={{ ...MOCK_PRODUCTS[0]!, fitments: [] }} tier="general" related={[]} motoBrands={[]} />
        </CartProvider>
      ),
      { mode, url: '/products/lightech-1' },
    );
    await h.flushAll();
    h.navigateExternal('/products/lightech-1?vehicle=yamaha:mt-07');
    await h.flushAll();
    await addToCartMobile();
    expect(cartVehicle(), '空字典把合法車款判成認不得, 加購就不帶車了').toMatchObject({ brand: 'Yamaha', model: 'MT-07' });
  });

  it.each(MODES)('%s(Fable R1 必修 2)麵包屑清車 ⇒ 立刻點「看更多」⇒ 連結不帶車款', async (mode) => {
    await start(mode, '/products/lightech-1?vehicle=yamaha:mt-07');
    clearInBreadcrumb();
    const more = document.querySelector('.pd-related-more-link')!;
    expect(vehicleOf(more.getAttribute('href')!), '清掉的車又出現在「看更多」連結上').toBeNull();
  });

  it.each(MODES)('%s(Fable R1 必修 3)選撞名序號的車型 ⇒ 選車鏡存的是字典 id,不是裸 slug', async (mode) => {
    await start(mode, '/products/lightech-1?vehicle=yamaha:yzf-r7');
    pickVehicleInFitment('MT 07');
    await h!.flushAll();
    expect(readVehicleContext()?.modelId, '鏡被 slugify(名稱) 蓋掉了').toBe('mt-07-2');
    expect(vehicleOf(h!.landed())).toBe('yamaha:mt-07-2');
  });

  it.each(MODES)('%s:適用判斷區的「清除車輛」⇒ 沒有車款、選車鏡清掉(plan §4-4)', async (mode) => {
    await start(mode, '/products/lightech-1?vehicle=yamaha:mt-07');
    act(() => fireEvent.click(screen.getByText('清除車輛')));
    await h!.flushAll();
    expect(vehicleOf(h!.landed())).toBeNull();
    expect(readVehicleContext()).toBeNull();
    await addToCartMobile();
    expect(cartVehicle()).toBeUndefined();
  });
});

