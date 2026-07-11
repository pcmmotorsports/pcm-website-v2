// @vitest-environment jsdom
//
// ProductInfo smoke test — 商品詳細頁右欄 pd-info column
// M-1-16c-3:由 mock color/size 選擇器改吃真變體(資料驅動 weave/finish/special 文字鈕、選了換價)。
// 驗 SKU/title/subtitle + 變體選擇器渲染 + 選變體換價 + special 第三排 + 無變體向後相容。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)

import { useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';

// ProductInfo 的「立即購買」用 useRouter().push('/cart') 導頁(2026-07-11);測試需 mock next/navigation。
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { ProductInfo } from './ProductInfo';
import { MOCK_PRODUCTS, type MockProduct, type UIVariant } from '../data/mock-products';
import type { MemberTier } from '@pcm/domain';
import { CartProvider } from '../contexts/CartContext';

// render shadow + CartProvider wrapper(useCart 必須在 Provider 內)
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: CartProvider });

// OD-4a:ProductInfo 改受控(selectedVariant 提升 ProductPage)。測試用 stateful harness 持 state、
//   模擬 ProductPage 持有 selectedVariant,讓「點規格鈕 → onSelectVariant → 換價」行為可驗。
function renderInfo(product: MockProduct, tier: MemberTier = 'general') {
  function Harness() {
    const [sv, setSv] = useState<UIVariant | null>(product.variants?.[0] ?? null);
    return (
      <ProductInfo product={product} tier={tier} selectedVariant={sv} onSelectVariant={setSv} />
    );
  }
  return render(<Harness />);
}

afterEach(() => {
  cleanup();
  if (typeof window !== 'undefined') window.localStorage.clear();
});

// 帶變體的 fixture(weave × finish、價隨 weave 變;對齊 RPM 真資料 shape)
const variantProduct: MockProduct = {
  ...MOCK_PRODUCTS[0]!,
  price: 8400,
  variants: [
    { id: 'v-A-G-F', sku: 'A-G-F', spec: { weave: 'Forged', finish: 'Glossy' }, price: 8400, images: [] },
    { id: 'v-A-M-F', sku: 'A-M-F', spec: { weave: 'Forged', finish: 'Matt' }, price: 8400, images: [] },
    { id: 'v-A-G-T', sku: 'A-G-T', spec: { weave: 'Twill', finish: 'Glossy' }, price: 6800, images: [] },
    { id: 'v-A-M-T', sku: 'A-M-T', spec: { weave: 'Twill', finish: 'Matt' }, price: 6800, images: [] },
  ],
};

// 帶 special 第三維的 fixture(部分變體有 special、應渲染第三排 + 標準選項)
const specialProduct: MockProduct = {
  ...MOCK_PRODUCTS[0]!,
  price: 6800,
  variants: [
    { id: 'v-B-G-P', sku: 'B-G-P', spec: { weave: 'Plain', finish: 'Glossy' }, price: 6800, images: [] },
    { id: 'v-B-G-12P', sku: 'B-G-12P', spec: { weave: 'Plain', finish: 'Glossy', special: '12K' }, price: 8400, images: [] },
  ],
};

describe('ProductInfo', () => {
  // M-1-16c-4a:料號顯真 sku(有變體)/ slug(無變體 fallback)、不再顯 PCM-{hash}
  it('should render SKU line with selected variant sku when product has variants', () => {
    renderInfo(variantProduct);
    expect(screen.getByText(`${variantProduct.brand} · A-G-F`)).toBeDefined();
  });

  it('should fallback SKU line to slug when product has no variants', () => {
    const product = MOCK_PRODUCTS[0]!;
    renderInfo(product);
    expect(screen.getByText(`${product.brand} · ${product.slug}`)).toBeDefined();
  });

  it('should render product title as h1', () => {
    const product = MOCK_PRODUCTS[0]!;
    renderInfo(product);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toBe(product.name);
  });

  // M-1-16c-4a:副標顯 DB 真 subtitle、拿掉寫死「義大利原裝進口」
  it('should render .pd-sub with product.subtitle when present (no hardcoded 義大利)', () => {
    const product = { ...MOCK_PRODUCTS[0]!, subtitle: 'Ducati Panigale · 碳纖維' };
    renderInfo(product);
    expect(screen.getByText('Ducati Panigale · 碳纖維')).toBeDefined();
    expect(screen.queryByText(/義大利原裝進口/)).toBeNull();
  });

  it('should fallback .pd-sub to 適用 {fits} when no subtitle (no hardcoded 義大利)', () => {
    const product = { ...MOCK_PRODUCTS[0]!, subtitle: undefined };
    renderInfo(product);
    expect(screen.getByText(`適用 ${product.fits}`)).toBeDefined();
    expect(screen.queryByText(/義大利原裝進口/)).toBeNull();
  });

  // ── M-1-16c-3 變體選擇器 ──

  it('should render weave + finish selectors with Chinese labels when product has variants', () => {
    renderInfo(variantProduct);
    expect(screen.getByText('紋路')).toBeDefined();
    expect(screen.getByText('表面')).toBeDefined();
    expect(screen.getByRole('button', { name: '鍛造' })).toBeDefined();
    expect(screen.getByRole('button', { name: '斜紋' })).toBeDefined();
    expect(screen.getByRole('button', { name: '亮光' })).toBeDefined();
    expect(screen.getByRole('button', { name: '消光' })).toBeDefined();
  });

  it('should default to first variant (Forged Glossy, NT$ 8,400) with active state', () => {
    renderInfo(variantProduct);
    expect(screen.getByText('NT$ 8,400')).toBeDefined();
    expect(screen.getByRole('button', { name: '鍛造' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '亮光' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('should change price when a different weave is selected (snap to nearest variant)', () => {
    renderInfo(variantProduct);
    // 預設 Forged Glossy 8400;點斜紋 → snap Twill Glossy 6800
    fireEvent.click(screen.getByRole('button', { name: '斜紋' }));
    expect(screen.getByText('NT$ 6,800')).toBeDefined();
    expect(screen.getByRole('button', { name: '斜紋' }).getAttribute('aria-pressed')).toBe('true');
    // finish 維持 Glossy(snap 保留其他維度)
    expect(screen.getByRole('button', { name: '亮光' }).getAttribute('aria-pressed')).toBe('true');
  });

  // OD-4c:12K 折進紋路(顯「12K平織」)、無「特殊」獨立欄、無「標準」NONE(Sean Q-OD4c-1=A)
  it('should fold 12K into 紋路 (12K平織) with no separate 特殊 row, price changes', () => {
    renderInfo(specialProduct);
    // 無「特殊材質」獨立欄 / 無「標準」NONE 選項
    expect(screen.queryByText('特殊材質')).toBeNull();
    expect(screen.queryByRole('button', { name: '標準' })).toBeNull();
    // 紋路含 平織 + 12K平織(special 折入);表面只 亮光(1 值不渲染)
    expect(screen.getByText('紋路')).toBeDefined();
    expect(screen.queryByText('表面')).toBeNull();
    expect(screen.getByRole('button', { name: '平織' })).toBeDefined();
    expect(screen.getByRole('button', { name: '12K平織' })).toBeDefined();
    // 預設 平織 6800;點 12K平織 → 8400;點回 平織 → 6800
    fireEvent.click(screen.getByRole('button', { name: '12K平織' }));
    expect(screen.getByText('NT$ 8,400')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '平織' }));
    expect(screen.getByText('NT$ 6,800')).toBeDefined();
  });

  // OD-4c:Kevlar 也折進紋路(顯「Kevlar斜紋」、Sean Q-OD4c-2=A、同 12K 邏輯)
  it('should fold Kevlar into 紋路 (Kevlar斜紋)', () => {
    const kevlarProduct: MockProduct = {
      ...MOCK_PRODUCTS[0]!,
      price: 6800,
      variants: [
        { id: 'v-K-G-T', sku: 'K-G-T', spec: { weave: 'Twill', finish: 'Glossy' }, price: 6800, images: [] },
        { id: 'v-K-G-KT', sku: 'K-G-KT', spec: { weave: 'Twill', finish: 'Glossy', special: 'Kevlar' }, price: 9200, images: [] },
      ],
    };
    renderInfo(kevlarProduct);
    expect(screen.queryByText('特殊材質')).toBeNull();
    expect(screen.getByRole('button', { name: '斜紋' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Kevlar斜紋' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Kevlar斜紋' }));
    expect(screen.getByText('NT$ 9,200')).toBeDefined();
  });

  it('should NOT render variant selectors and shows product.price when product has no variants', () => {
    const noVariant = MOCK_PRODUCTS[0]!; // 無 variants 欄
    renderInfo(noVariant);
    expect(screen.queryByText('紋路')).toBeNull();
    expect(screen.queryByText('表面')).toBeNull();
    expect(screen.getByText(`NT$ ${noVariant.price.toLocaleString()}`)).toBeDefined();
  });

  it('should add to cart without crashing (variant_id discriminator)', () => {
    renderInfo(variantProduct);
    fireEvent.click(screen.getByRole('button', { name: '加入購物車' }));
    // 不崩潰即可(cart 寫 localStorage);變體 variant_id(selectedVariant.id)走 cart 線契約、非本 smoke 斷言範圍
    expect(screen.getByRole('button', { name: '加入購物車' })).toBeDefined();
  });

  // ── W2(#265/#267)非 RPM 泛型規格形狀 ──
  // fixture 對齊報價單真資料形狀(2026-07-04 乾跑/DB 親見):bonamici {color,material}、cncracing {color}

  it('should render generic color/material selectors for bonamici-shaped spec (W2)', () => {
    const bonamiciProduct: MockProduct = {
      ...MOCK_PRODUCTS[0]!,
      price: 1900,
      variants: [
        { id: 'v-bo-br', sku: '0025_BR', spec: { color: '古銅色', material: '鋁合金' }, price: 1900, images: [] },
        { id: 'v-bo-bk', sku: '0025_BK', spec: { color: '黑色', material: '鋁合金' }, price: 1900, images: [] },
        { id: 'v-bo-bk-ti', sku: '0025_BKT', spec: { color: '黑色', material: '鈦合金' }, price: 2400, images: [] },
      ],
    };
    renderInfo(bonamiciProduct);
    // 泛型維標籤(GENERIC_DIM_LABEL)+ 值原字直出
    expect(screen.getByText('顏色')).toBeDefined();
    expect(screen.getByText('材質')).toBeDefined();
    expect(screen.getByRole('button', { name: '古銅色' })).toBeDefined();
    expect(screen.getByRole('button', { name: '鋁合金' })).toBeDefined();
    // RPM 維不出現
    expect(screen.queryByText('紋路')).toBeNull();
    expect(screen.queryByText('表面')).toBeNull();
    // 選材質換價(snap:黑色+鈦合金 2400)
    fireEvent.click(screen.getByRole('button', { name: '黑色' }));
    fireEvent.click(screen.getByRole('button', { name: '鈦合金' }));
    expect(screen.getByText('NT$ 2,400')).toBeDefined();
  });

  it('should render single 顏色 dim for cncracing-shaped spec and change price (W2)', () => {
    const cncProduct: MockProduct = {
      ...MOCK_PRODUCTS[0]!,
      price: 9500,
      variants: [
        { id: 'v-ca-b', sku: 'CA210B', spec: { color: '黑色' }, price: 9500, images: [] },
        { id: 'v-ca-bpr', sku: 'CA210BPR', spec: { color: 'Pramac 黑色' }, price: 10800, images: [] },
      ],
    };
    renderInfo(cncProduct);
    expect(screen.getByText('顏色')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Pramac 黑色' }));
    expect(screen.getByText('NT$ 10,800')).toBeDefined();
    // 料號隨選中變體連動
    expect(screen.getByText(`${cncProduct.brand} · CA210BPR`)).toBeDefined();
  });

  it('should NOT render RPM swatch preview card for non-RPM spec shapes (W2 降級)', () => {
    const cncProduct: MockProduct = {
      ...MOCK_PRODUCTS[0]!,
      variants: [
        { id: 'v-ca-b', sku: 'CA210B', spec: { color: '黑色' }, price: 9500, images: [] },
        { id: 'v-ca-r', sku: 'CA210R', spec: { color: '紅色' }, price: 9500, images: [] },
      ],
    };
    renderInfo(cncProduct);
    // 預覽卡(「當前樣式」)不得出現 — 防 findSwatch fallback 顯錯誤 RPM 碳纖樣品
    expect(screen.queryByText('當前樣式')).toBeNull();
  });

  it('should still render RPM swatch preview card for RPM spec shapes (W2 迴歸錨)', () => {
    renderInfo(variantProduct);
    expect(screen.getByText('當前樣式')).toBeDefined();
  });

  it('should treat eazigrip finish-only spec as generic (no swatch card, 表面 dim) — E1 2026-07-12', () => {
    // GUARD/TANK 犀牛皮表面貼真形狀:只有 finish、無 weave → finish 不再單獨觸發 RPM
    const eaziGuard: MockProduct = {
      ...MOCK_PRODUCTS[0]!,
      variants: [
        { id: 'v-g-g', sku: 'GUARDDUC025', spec: { finish: '亮光面' }, price: 830, images: [] },
        { id: 'v-g-m', sku: 'GUARDDUC025M', spec: { finish: '消光面' }, price: 830, images: [] },
      ],
    };
    renderInfo(eaziGuard);
    expect(screen.queryByText('當前樣式')).toBeNull(); // 不再誤掛碳纖紋路預覽卡
    expect(screen.getByText('表面')).toBeDefined(); // 走泛型「表面」維
    expect(screen.getByRole('button', { name: '消光面' })).toBeDefined();
    expect(screen.getByRole('button', { name: '亮光面' })).toBeDefined();
  });

  it('should label pack dim as 入數 for eazigrip dashboard protector (E3 2026-07-12)', () => {
    const dash: MockProduct = {
      ...MOCK_PRODUCTS[0]!,
      variants: [
        { id: 'v-d-1', sku: 'DASHMVA004', spec: { pack: '一組' }, price: 830, images: [] },
        { id: 'v-d-2', sku: 'DASHMVA004-2', spec: { pack: '兩組' }, price: 830, images: [] },
      ],
    };
    renderInfo(dash);
    expect(screen.getByText('入數')).toBeDefined(); // PACK → 入數
    expect(screen.getByRole('button', { name: '一組' })).toBeDefined();
    expect(screen.getByRole('button', { name: '兩組' })).toBeDefined();
  });

  it('should filter empty values when generic spec keys are uneven (W2 對抗審 F1)', () => {
    // eazigrip HOSE 群真形狀:主列 spec={} + 色彩變體列 {color}(2026-07-04 DB 親見)
    const unevenProduct: MockProduct = {
      ...MOCK_PRODUCTS[0]!,
      variants: [
        { id: 'v-h-main', sku: 'HOSEBMW001', spec: {}, price: 2000, images: [] },
        { id: 'v-h-blue', sku: 'HOSEBMW001BLUE', spec: { color: 'Blue' }, price: 2000, images: [] },
        { id: 'v-h-red', sku: 'HOSEBMW001RED', spec: { color: 'Red' }, price: 2000, images: [] },
      ],
    };
    renderInfo(unevenProduct);
    // color 維渲染 Blue/Red 兩鈕、無空白按鈕(空值已濾)
    expect(screen.getByRole('button', { name: 'Blue' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Red' })).toBeDefined();
    const optButtons = screen.getAllByRole('button').filter((b) => b.className.includes('pd-size-btn'));
    expect(optButtons).toHaveLength(2);
    expect(optButtons.every((b) => (b.textContent ?? '').trim() !== '')).toBe(true);
  });

  it('should treat mixed weave+color spec as RPM shape (W2 對抗審 F2 既定行為錨)', () => {
    // 髒資料防禦性釘住:任一變體含 weave/finish/special → 整商品走 RPM 模式(color 軸不渲染)。
    // 真實資料不應出現此形狀(報價單 onboarding 已列三 key 為 RPM 保留字)。
    const mixedProduct: MockProduct = {
      ...MOCK_PRODUCTS[0]!,
      variants: [
        { id: 'v-m-1', sku: 'M-1', spec: { weave: 'Twill', finish: 'Glossy', color: '黑色' }, price: 100, images: [] },
        { id: 'v-m-2', sku: 'M-2', spec: { weave: 'Plain', finish: 'Glossy', color: '紅色' }, price: 100, images: [] },
      ],
    };
    renderInfo(mixedProduct);
    expect(screen.getByText('紋路')).toBeDefined(); // RPM 模式
    expect(screen.queryByText('顏色')).toBeNull(); // color 軸不渲染(既定取捨、源頭保留字防護)
  });

  it('should fallback unknown generic spec key to raw key label (W2)', () => {
    const unknownKeyProduct: MockProduct = {
      ...MOCK_PRODUCTS[0]!,
      variants: [
        { id: 'v-u-1', sku: 'U-1', spec: { size: 'S' }, price: 100, images: [] },
        { id: 'v-u-2', sku: 'U-2', spec: { size: 'M' }, price: 100, images: [] },
      ],
    };
    renderInfo(unknownKeyProduct);
    // size 不在 GENERIC_DIM_LABEL → 顯 key 原字(fail-safe、不 crash)
    expect(screen.getByText('size')).toBeDefined();
    expect(screen.getByRole('button', { name: 'S' })).toBeDefined();
  });
});
