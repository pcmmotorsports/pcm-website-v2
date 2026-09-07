// @vitest-environment jsdom
//
// ProductInfo smoke test — 商品詳細頁右欄 pd-info column
// M-1-16c-3:由 mock color/size 選擇器改吃真變體(資料驅動 weave/finish/special 文字鈕、選了換價)。
// 驗 SKU/title/subtitle + 變體選擇器渲染 + 選變體換價 + special 第三排 + 無變體向後相容。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)

import { useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';

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

/**
 * 帶變體的 fixture(weave × finish、價隨 weave 變;對齊 RPM 真資料 shape)
 *
 * 🔴 **2026-09-01:本檔 16 處 `renderInfo(MOCK_PRODUCTS[0]!)` 全部改用它**(板 `⟦b4-NOVARIANT1⟧`)。
 *    成因:Sean 2026-08-31 拍「一件**沒有規格**的商品不賣」⇒ PDP 的加入購物車對它會擋下
 *    ⇒ 而 `MOCK_PRODUCTS[0]` **沒有 variants** ⇒ 那 16 格裡有 9 格因此紅。
 * 🔵 **而它們紅【不是因為它們在測「無變體」】** —— 它們測的是 qty / 車型帶入 / 上限 / 回饋計時器,
 *    用無變體商品只是「點一下就加進去」最短的路。
 * ✅ **證據**:16 處全改之後 **40 格全綠, 沒有一格因此紅**
 *    ⇒ 📌 若其中有任何一格真的在測「無變體」, 它會在這一改之後變紅 —— 而沒有。
 * ⚠️ 而**卡片那一側不同**(`product-card-quick-add.test.tsx`):那裡有 10 格是 `it.skip`,
 *    因為卡片直加那條路**整條不可達**, 不是 fixture 的問題。**同樣的表面現象, 兩種意義。**
 */
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
  // ⛔ ~~M-1-16c-4a:料號顯真 sku(有變體)/ slug(無變體 fallback)~~
  // ⛔ ~~**Sean 2026-09-03 重答 `Q23 = 甲`:商品頁只印【原廠料號】(`productCode`)。**~~
  // ⛔ ~~⇒ 這一行**不再隨變體連動** —— 那是這個決定的代價~~
  // 🔴🔴 **2026-09-06 Sean 看畫面重議** —— 他選了紅色而上方仍印母料號 `PET52`, 他要 `PET52R`。
  //    📌 **Q23 沒有被推翻** —— `ProductInfo.tsx` 那段註解**自己就寫了觸發條件**:
  //    逐字「🛑 哪天發現出貨單 / 揀貨單 / 發票上對帳靠的是那個變體號, **這一片要重議**」
  //    ⇒ **今天他自己看畫面撞到了它。** 板列 `⟦f3-PDPSKUSTATIC⟧`。
  it('🔴 選了變體 ⇒ 那一行印【變體的 sku】(2026-09-06 重議前印母料號)', () => {
    const p = { ...variantProduct, productCode: 'ISS118' };
    renderInfo(p); // harness 預設選中 variants[0]
    expect(screen.getByText(`${p.brand} · 原廠料號 ${p.variants![0]!.sku}`)).toBeDefined();
  });

  it('沒有 productCode ⇒ 退回 slug, 而標籤仍在', () => {
    const product = MOCK_PRODUCTS[0]!;
    renderInfo(product);
    expect(screen.getByText(`${product.brand} · 原廠料號 ${product.slug}`)).toBeDefined();
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
    // ⛔ ~~料號隨選中變體連動~~
    // ⛔ ~~**Sean 2026-09-03 重答甲之後, 那一行改印【原廠料號】⇒ 它【不再隨變體連動】。**~~
    // 🔴🔴 **2026-09-06 Sean 看畫面重議 ⇒ 它【又隨變體連動了】**(板列 `⟦f3-PDPSKUSTATIC⟧`)。
    //    🔵 而上面那句舊註解裡有一格**今天仍然成立、而且救了這一格**:
    //       「本格原本靠那一行當『選了變體有反應』的第二個證據 —— 而**價格那行仍然守著連動**」
    //       ⇒ 📌 **這一格的判別力從頭到尾都在價格那一行**, 料號那行怎麼改它都還站得住。
    //    ⇒ ⇒ **那正是當初寫「拿掉一個斷言之前, 先確認它守的那件事還有沒有別人在守」的用處** ——
    //       它讓今天的我不必重新推導一次。
    // 🔴 **是 `[1]` 不是 `[0]`** —— 這一格上面 `fireEvent.click` 點的是第二個變體(`Pramac 黑色`)
    //   ⇒ 📌 **而這剛好讓本格變成 Sean 那件事的直接證據**:他要的就是「點了另一個規格, 上面那行跟著變」。
    expect(screen.getByText(`${cncProduct.brand} · 原廠料號 ${cncProduct.variants![1]!.sku}`)).toBeDefined();
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

describe('ProductInfo — V-2a 路徑1(搜尋情境自動帶入車款)', () => {
  const CTX_KEY = 'pcm.vehicle.v1';
  const CART_KEY = 'pcm-cart-mock-v2';
  afterEach(() => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.clear();
      window.localStorage.clear();
    }
  });

  it('context 名稱字面齊全 → 加入購物車帶 vehicle kind:dict source:search', () => {
    window.sessionStorage.setItem(
      CTX_KEY,
      JSON.stringify({ brandId: 'yamaha', modelId: 'mt-09-sp', year: 2021, label: 'Yamaha MT-09 SP 2021', brandName: 'Yamaha', modelName: 'MT-09 SP', savedAt: 1 }),
    );
    renderInfo(variantProduct);
    fireEvent.click(screen.getByRole('button', { name: '加入購物車' }));
    const items = JSON.parse(window.localStorage.getItem(CART_KEY)!);
    expect(items[0].vehicle).toEqual({ kind: 'dict', brand: 'Yamaha', model: 'MT-09 SP', year: 2021, source: 'search' });
  });

  it('context 缺名稱欄(舊 context)→ 不自動帶入(零猜)', () => {
    window.sessionStorage.setItem(
      CTX_KEY,
      JSON.stringify({ brandId: 'yamaha', modelId: 'mt-09-sp', label: 'Yamaha MT-09 SP', savedAt: 1 }),
    );
    renderInfo(variantProduct);
    fireEvent.click(screen.getByRole('button', { name: '加入購物車' }));
    const items = JSON.parse(window.localStorage.getItem(CART_KEY)!);
    expect(items[0].vehicle).toBeUndefined();
  });
});

// W11-019 B1/B2:數量改可鍵盤輸入 + 修既有無上限 bug(+ 按到 107、加購後靜默變 99)。
describe('ProductInfo — 數量輸入框(W11-019 B1/B2)', () => {
  it('打 0 失焦 → 回復成 1(§5 row1)', () => {
    renderInfo(variantProduct);
    const input = screen.getByRole('textbox', { name: '數量' });
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);
    expect((input as HTMLInputElement).value).toBe('1');
  });

  it('輸入非數字字元 → 被過濾掉、不會進到輸入框(§5 row2)', () => {
    renderInfo(variantProduct);
    const input = screen.getByRole('textbox', { name: '數量' });
    fireEvent.change(input, { target: { value: '1a2.5-3' } });
    expect((input as HTMLInputElement).value).toBe('1253'); // 非數字字元(a/./-)被濾掉,數字字元原序保留
  });

  it('打 >99 失焦 → 夾到 99 並顯示提示(§5 row3,對照 B2 既有 bug:不再靜默夾)', () => {
    renderInfo(variantProduct);
    const input = screen.getByRole('textbox', { name: '數量' });
    fireEvent.change(input, { target: { value: '500' } });
    fireEvent.blur(input);
    expect((input as HTMLInputElement).value).toBe('99');
    expect(screen.getByText('已達購買上限 99')).toBeDefined();
  });

  it('B2 修復:連按「+」超過 99 次也夾在 99,不再無上限累加(對照舊值可到 107)', () => {
    renderInfo(variantProduct);
    const plus = screen.getByRole('button', { name: '增加數量' });
    for (let i = 0; i < 105; i += 1) fireEvent.click(plus);
    const input = screen.getByRole('textbox', { name: '數量' }) as HTMLInputElement;
    expect(input.value).toBe('99');
  });

  it('加入購物車帶的 qty 就是輸入框確定後的值(不是打到一半的暫存文字)', () => {
    renderInfo(variantProduct);
    const input = screen.getByRole('textbox', { name: '數量' });
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole('button', { name: '加入購物車' }));
    const CART_KEY = 'pcm-cart-mock-v2';
    const items = JSON.parse(window.localStorage.getItem(CART_KEY)!);
    expect(items[0].qty).toBe(5);
  });
});

// ── A3:桌機按「加入購物車」要有回饋(補洞窗)──────────────────────────────────
// 🔴 這四格是**一組**,少哪一格會讓哪一種錯實作全綠:
//   · 少「按之前不出字」⇒ 一個**恆真**的字(永遠掛在那裡)會過 —— 那不是回饋。
//   · 少「按第二下數字要變」⇒ 一個寫死「已加入」的字會過,而客人照樣不知道自己按了幾下,
//     那正是本條要治的病(再按三下、結帳發現買了 4 個)。
//   · 少「換到沒加過的規格要消失」⇒ 會長出手機列 2026-08-22 修掉的**同一個病**
//     (`ProductPage.tsx:131-155` 有真瀏覽器實走紀錄):畫面說「已加入」,而購物車裡沒那一列。
describe('ProductInfo — A3 加入購物車回饋', () => {
  const NOTICE = /已加入購物車 · 車上共/;

  it('按之前不出字(它是回饋,不是裝飾)', () => {
    renderInfo(variantProduct);
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it('按一下 ⇒ 出「已加入購物車 · 車上共 1 件」', () => {
    renderInfo(variantProduct);
    fireEvent.click(screen.getByRole('button', { name: '加入購物車' }));
    expect(screen.getByText('已加入購物車 · 車上共 1 件')).toBeDefined();
  });

  it('再按一下 ⇒ 數字從 1 變 2(畫面會動 = 他不會再盲按)', () => {
    renderInfo(variantProduct);
    const btn = screen.getByRole('button', { name: '加入購物車' });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(screen.getByText('已加入購物車 · 車上共 2 件')).toBeDefined();
  });

  it('換到一個從沒加過的規格 ⇒ 字要消失(不得留在那裡說謊)', () => {
    renderInfo(variantProduct);
    fireEvent.click(screen.getByRole('button', { name: '加入購物車' }));
    expect(screen.getByText(NOTICE)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '斜紋' }));
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  // 🔴 上面那格**抓不到「壽命 effect 被刪掉」**(實測:刪掉 effect 那格照樣綠)——
  //   因為切到「斜紋」那一列本來就不在車上,`cartLineQty > 0` 那道守門自己就把字擋掉了。
  //   ⇒ 真正只有 effect 守得住的是**繞回來**這條路:切走再切回,那個字不該自己回來。
  //   它回來時講的話是**真的**(車上確實有 1 件),所以這格釘的是「這句話的意思是【你剛剛做了什麼】」,
  //   而不是「車上有什麼」—— 後者是購物車徽章的工作,不是回饋字的。
  it('切走再切回原規格 ⇒ 字**不**自己回來(回饋講的是「你剛剛做了什麼」)', () => {
    renderInfo(variantProduct);
    fireEvent.click(screen.getByRole('button', { name: '加入購物車' }));
    expect(screen.getByText(NOTICE)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '斜紋' }));
    fireEvent.click(screen.getByRole('button', { name: '鍛造' }));
    expect(screen.queryByText(NOTICE)).toBeNull();
  });
});

// ── A5:數量合併靜默夾到 99(補洞窗)──────────────────────────────────────────
// 病:車裡 90 再加 20 ⇒ 變 99,**沒有一個字告訴他少了 11 件**。
// 🔴 負對照是這組的重點:沒滿的時候**不准**冒出提示,否則「每次都提示」也會全綠 ——
//   而那種提示客人看兩次就不看了,等於沒有。
describe('ProductInfo — A5 加購被上限夾掉要明說', () => {
  function addQty(n: number) {
    const input = screen.getByRole('textbox', { name: '數量' });
    fireEvent.change(input, { target: { value: String(n) } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole('button', { name: '加入購物車' }));
  }

  it('車裡 90 再加 20 ⇒ 明說「少加了 11 件」', () => {
    renderInfo(variantProduct);
    addQty(90);
    addQty(20);
    expect(screen.getByText('已達購買上限 99,這次少加了 11 件')).toBeDefined();
  });

  // 🔴🔴 R1 must-fix(2026-08-23):車上已 99 再加 ⇒ **一件都沒進去**,而畫面說「已加入購物車」。
  //   真瀏覽器實測:`localStorage` 前後都是 `qty:99`(沒有變),而兩句同時在畫面上。
  //   ⇒ 那是**一句斷言它沒有造成的事**,與 `#883` 的 `/logout`「您已登出」同族。
  //   ⚠️ 而**這一格在修之前是不存在的** —— 39 格全綠,沒有任何一格抓得到它。
  const ADDED_RE = /已加入購物車 · 車上共/;
  it('🔴 車上已滿 99 再加 ⇒ **不准**說「已加入」(一件都沒進去)', () => {
    renderInfo(variantProduct);
    addQty(99);
    expect(screen.getByText(ADDED_RE)).toBeDefined(); // 這一發是真的加進去了 ⇒ 該說
    addQty(5); // 車上已 99 ⇒ 全部被夾掉 ⇒ 零件進車
    expect(screen.getByText('已達購買上限 99,這次少加了 5 件')).toBeDefined();
    expect(screen.queryByText(ADDED_RE)).toBeNull(); // 🔴 承重:上一次留下的那句也必須當場收掉
  });

  it('負對照:沒滿就加(1 + 5)⇒ **不准**出任何上限提示', () => {
    renderInfo(variantProduct);
    addQty(1);
    addQty(5);
    expect(screen.queryByText(/購買上限/)).toBeNull();
  });

  // ── 🔴 Sean 2026-08-23 拍甲:這句改【常駐】,不再 2.5 秒消失 ──────────────────
  //   (memory `project_0823-sean-overlimit-notice-persists`)
  it('常駐:出現之後【不會自己消失】(逾時 3 秒後仍在)', () => {
    vi.useFakeTimers();
    try {
      renderInfo(variantProduct);
      addQty(99);
      addQty(1);
      expect(screen.getByText('已達購買上限 99,這次少加了 1 件')).toBeDefined();
      // 舊行為是 2500ms 之後消失 ⇒ 推過那個點,它必須還在。
      act(() => { vi.advanceTimersByTime(3000); });
      expect(screen.getByText('已達購買上限 99,這次少加了 1 件')).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('🔴 終止條件 = 換規格(Sean 逐字「直到他換規格或離開」)⇒ 換規格後那句要收掉', () => {
    renderInfo(variantProduct);
    addQty(99);
    addQty(1);
    expect(screen.getByText(/少加了/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '斜紋' }));
    expect(screen.queryByText(/少加了/)).toBeNull();
  });

  it('🔴 打字超過上限那句【沒有被順手改成常駐】—— Sean 沒有被問到那一句', () => {
    vi.useFakeTimers();
    try {
      renderInfo(variantProduct);
      const input = screen.getByRole('textbox', { name: '數量' });
      fireEvent.change(input, { target: { value: '500' } });
      fireEvent.blur(input);
      expect(screen.getByText('已達購買上限 99')).toBeDefined();
      act(() => { vi.advanceTimersByTime(3000); });
      // 它仍然是一次性的 ⇒ 3 秒後不見。改動它 = 把裁定擴張到他沒被問的東西上。
      expect(screen.queryByText('已達購買上限 99')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('已經 99 再加 1 ⇒ 說「少加了 1 件」(而不是靜靜地什麼都沒發生)', () => {
    renderInfo(variantProduct);
    addQty(99);
    addQty(1);
    expect(screen.getByText('已達購買上限 99,這次少加了 1 件')).toBeDefined();
  });
});

// ⟦Q23 = 丙⟧ Sean 2026-09-03:兩個編號都印並標清楚。
// 🛑 **丙不會讓料號變成搜得到** —— 它只讓客人知道該抄哪一個。真正的修法是甲(要貼 SQL)。
describe('Q23 · 商品頁的料號(Sean 2026-09-03 重答甲 ⇒ 2026-09-06 看畫面重議)', () => {
  // ⛔ ~~丙:兩個編號都印, 暫用標籤「搜尋用」~~(commit c68cc9fe)
  // 🔴 **同日 Sean 重答甲** —— 而丙**沒有錯**:它要解的病(客人抄了搜不到)仍然成立,
  //    換掉的是解法。他給了一句業務事實:「我們工作基本上都是用原廠料號在工作」
  //    ⇒ 而搜尋比對的剛好就是那一個 ⇒ **問題不是要印兩個, 是印錯了那一個。**
  const p: MockProduct = { ...variantProduct, productCode: 'ISS118' };

  // ⛔ ~~🔴 印的是【原廠料號】(productCode), 不是變體個別料號(sku)~~
  // ⛔ ~~🎯 判別點:變體那一串不得再出現在這一行 —— 它正是客人抄了會搜不到的那個~~
  // 🔴🔴 **2026-09-06 重議:選了變體就印變體的 sku。**
  //   🔵 而**當初那個顧慮沒有消失, 只是它的前提變了** —— 舊註解怕的是「客人抄了搜不到」,
  //     而 **db 58(2026-09-06 已貼正式庫)把變體 sku 也納入搜尋** ⇒ 我當場在正式站量過:
  //     搜 `PET52R` / `AZ203B` 各回 **1 件**(貼前 Sean 回報是 0)。
  //   ⇒ 📌 **抄得到也搜得到了 ⇒ 那個顧慮被【另一片】解掉, 而不是被忽略。**
  it('🔴 選了變體 ⇒ 印變體的 sku(而標籤那四個字仍在)', () => {
    const { container } = renderInfo(p);
    const line = container.querySelector('.pd-sku')?.textContent ?? '';
    expect(line).toContain(p.variants![0]!.sku);
    expect(line).toContain('原廠料號');
  });

  // 🔵 **沒選變體那條路【必須逐字不變】** —— 本片只動「有選」那一側。
  it('🔵 沒有變體的商品 ⇒ 仍印母料號(本片不得動到這一側)', () => {
    const noVariant: MockProduct = { ...p, variants: [] };
    const { container } = renderInfo(noVariant);
    const line = container.querySelector('.pd-sku')?.textContent ?? '';
    expect(line).toContain('ISS118');
  });

  // 🔴🔴 **空字串那一格 —— 型別說 `sku: string`(非 optional), 而型別不保證執行期。**
  //   mock / 舊資料 / 未來的 mapper 都可能給空字串 ⇒ **不得印出一行沒有號碼的「原廠料號 」**。
  //   ⇒ 實作用 `?.trim() ||` 而不是 `??`(後者只擋 null/undefined, 擋不掉 `''`)。
  it('🔵 負對照:變體的 sku 是空字串 ⇒ 退回母料號, 不得印空', () => {
    const blank: MockProduct = {
      ...p,
      variants: [{ ...p.variants![0]!, sku: '   ' }],
    };
    const { container } = renderInfo(blank);
    const line = container.querySelector('.pd-sku')?.textContent ?? '';
    expect(line).toContain('ISS118');
    expect(line.trim()).not.toMatch(/原廠料號\s*$/);
  });

  it('🔴 標籤逐字是「原廠料號」—— 那是 Sean 自己的用語, 已定稿不是暫用', () => {
    const { container } = renderInfo(p);
    const line = container.querySelector('.pd-sku')?.textContent ?? '';
    // 🛑 改成**釘住必須有這四個字**, 而不是先前那種「不得出現某些詞」的禁詞式守門:
    //    禁詞擋得住我選錯一個名字, 擋不住有人把標籤整個拿掉。
    expect(line).toContain('原廠料號');
  });

  it('🔵 負對照:沒有變體也沒有 productCode ⇒ 退回 slug, 而【標籤仍在】(不得變成一串沒有名字的碼)', () => {
    // 🔴 **這一格加了 `variants: []`** —— 2026-09-06 重議之後, 有選變體時印的是 sku
    //   ⇒ 舊寫法(帶變體)會走到 sku 那一側, 而**這一格要問的是最底層那個 fallback**。
    const noCode: MockProduct = { ...variantProduct, productCode: undefined, variants: [] };
    const { container } = renderInfo(noCode);
    const line = container.querySelector('.pd-sku')?.textContent ?? '';
    expect(line).toContain('原廠料號');
    expect(line).toContain(noCode.slug);
  });

  it('🔵 負對照:那條「兩個都印」的路已經拿掉 ⇒ 畫面上不得再有第二行編號', () => {
    const { container } = renderInfo(p);
    // 🔴 少了這一格, 把丙那一行加回來不會有任何東西紅。
    expect(container.querySelectorAll('.pd-sku-searchable')).toHaveLength(0);
    expect(container.querySelectorAll('.pd-sku')).toHaveLength(1);
  });
});

// ── ⟦b4-DEALERSIGNUPUNSEEN⟧ M-2-08 PDP 經銷價 · 兩個世界(2026-09-07) ──────────
// 🔴 **兩世界各跑一次, 而【無差價】那個世界是今天正式庫的常態路徑**
//    (`lib/tier-prices.ts:22-27`:25,769 件商品 + 59,841 個變體全無差價)
//    ⇒ 只測「有差價」那個世界 = 測了一個今天不存在的世界。
describe('⟦b4-DEALERSIGNUPUNSEEN⟧ PDP 經銷價 —— 兩個世界', () => {
  /** 有差價：store 比 general 便宜。 */
  const WITH_DEALER: MockProduct = {
    ...variantProduct,
    price: 8400,
    dealerPrice: 6720,
    variants: [
      { id: 'v-1', sku: 'S-1', spec: { weave: 'Forged' }, price: 8400, dealerPrice: 6720, images: [] },
    ],
  };
  /**
   * 無差價 ⇒ **RPC 自己 `coalesce` 回 general** ⇒ 回來的是 `8400`，不是 `undefined`、更不是 `0`。
   * ⛔ ~~本 fixture 原本寫 `dealerPrice: undefined`~~（codex R2 must-fix ⑧）——
   *   那其實是「**RPC 少回一列**」那一案，而我把它當成「無差價」釘下來
   *   ⇒ 📌 **fixture 說的話與真 RPC 不同時，那一格守的是我腦裡的世界，不是線上的。**
   */
  const NO_DEALER: MockProduct = {
    ...variantProduct,
    price: 8400,
    dealerPrice: 8400,
    variants: [
      { id: 'v-1', sku: 'S-1', spec: { weave: 'Forged' }, price: 8400, dealerPrice: 8400, images: [] },
    ],
  };
  /** RPC **少回那一列**（下架 / amount NULL / uuid 查無）⇒ route 端不賦值 ⇒ 這裡是 `undefined`。 */
  const ROW_MISSING: MockProduct = {
    ...variantProduct,
    price: 8400,
    variants: [{ id: 'v-1', sku: 'S-1', spec: { weave: 'Forged' }, price: 8400, images: [] }],
  };

  it('🟢 store + 有差價 ⇒ 顯 store 價、非 NT$ 0、有「經銷價」標記（三件一起）', () => {
    renderInfo(WITH_DEALER, 'store');
    const body = document.body.textContent ?? '';
    expect(body).toContain('6,720');          // 顯 store 價
    expect(body).not.toContain('NT$ 0');       // 🔴 A 指定的負測
    expect(body).toContain('經銷價');           // 稿 design-reference/components/ProductPage.jsx:295 那個標記
    // 🔴 原價那一行要印【一般價】，不是把同一個數字印兩次（稿 :294 逐字用 product.price）
    expect(body).toContain('8,400');
  });

  it('🔴 ① store + 【無差價】（RPC coalesce 回 general）⇒ 頁面不得出現 NT$ 0（A 2026-09-07 的負測）', () => {
    renderInfo(NO_DEALER, 'store');
    const body = document.body.textContent ?? '';
    expect(body).not.toContain('NT$ 0');
    expect(body).toContain('8,400');
    // 標記照樣出現 —— 他仍然是經銷商，只是這一件沒有差價。
    expect(body).toContain('經銷價');
  });

  it('🔴 ② store + 【真的 0 元商品】⇒ **要顯 NT$ 0**（主視窗 B 2026-09-07 裁甲、codex R2 must-fix ②）', () => {
    // 🔴 `price_store` 的約束是 `CHECK (price_store IS NULL OR price_store >= 0)`
    //   （`supabase/migrations/20260531142533_init_product_variants.sql:56-61`）⇒ **0 是合法價**。
    //   ⛔ ~~R1 之後我用 `dealer > 0` 把它壓成一般價~~ —— 那把「無差價」與「真 0 元」壓成同一案。
    const ZERO: MockProduct = {
      ...variantProduct,
      price: 8400,
      dealerPrice: 0,
      variants: [{ id: 'v-1', sku: 'S-1', spec: { weave: 'Forged' }, price: 8400, dealerPrice: 0, images: [] }],
    };
    renderInfo(ZERO, 'store');
    const body = document.body.textContent ?? '';
    expect(body).toContain('NT$ 0');
  });

  it('🔴 ③ store + RPC 少回那一列（`dealerPrice` undefined）⇒ 退回一般價、不得 NT$ 0', () => {
    renderInfo(ROW_MISSING, 'store');
    const body = document.body.textContent ?? '';
    expect(body).not.toContain('NT$ 0');
    expect(body).toContain('8,400');
  });

  it('🔴 選了變體而【那個變體】沒有經銷價 ⇒ 不得跨層套商品級經銷價（codex R2 must-fix ⑤）', () => {
    // 商品級 6,720、變體一般價 9,900、變體自己沒有經銷價
    // ⇒ 應顯 **9,900**（該變體的一般價），而不是 6,720（別的東西的價）。
    const CROSS: MockProduct = {
      ...variantProduct,
      price: 8400,
      dealerPrice: 6720,
      variants: [{ id: 'v-1', sku: 'S-1', spec: { weave: 'Forged' }, price: 9900, images: [] }],
    };
    renderInfo(CROSS, 'store');
    const body = document.body.textContent ?? '';
    expect(body).toContain('9,900');
    expect(body).not.toContain('6,720');
  });

  it('🔴 經銷 tier 不得出現「含稅」字樣（Sean 2026-09-06 Q24：未稅、且不標未稅）', () => {
    renderInfo(WITH_DEALER, 'store');
    const body = document.body.textContent ?? '';
    expect(body).not.toContain('含稅');
    expect(body).not.toContain('未稅');
  });

  it('🟢 正對照：general 仍看得到「含稅」那一句（上一格不是因為整句被刪掉才綠）', () => {
    renderInfo(WITH_DEALER, 'general');
    expect(document.body.textContent ?? '').toContain('含稅');
  });

  // ── `hasDiscount` 那一格的守門（codex R3 must-fix ⑦：原本 fixture 的 origPrice 全是 null）──
  it('🟢 origPrice **高於**一般價 ⇒ 劃掉的是 origPrice（不是一般價）', () => {
    renderInfo({ ...WITH_DEALER, origPrice: 9900 }, 'store');
    const body = document.body.textContent ?? '';
    expect(body).toContain('6,720');   // 經銷價
    expect(body).toContain('9,900');   // 劃掉的原價
  });

  it('🔴 origPrice **低於**一般價（假原價）⇒ 不得被畫出來，退回一般價', () => {
    renderInfo({ ...WITH_DEALER, origPrice: 5000 }, 'store');
    // 🔴 **尺要對準那一格, 不是整頁**：整頁的 `textContent` 裡本來就有
    //   「滿額免運 NT$ **5,000** 以上免運費」那塊信任徽章 ⇒ 拿整頁比 `'5,000'`
    //   會紅在一個**與價格無關**的地方，而它紅得很像真的。
    expect(document.querySelector('.pd-price-orig')?.textContent).toContain('8,400');
    expect(document.querySelector('.pd-price-orig')?.textContent).not.toContain('5,000');
  });

  it('🔴 origPrice === 0 ⇒ 不得出現「原價 NT$ 0」（`?? ` 擋不住 0 的同一族）', () => {
    renderInfo({ ...WITH_DEALER, origPrice: 0 }, 'store');
    const body = document.body.textContent ?? '';
    expect(body).not.toContain('NT$ 0');
    expect(body).toContain('8,400');
  });

  it('🔴 劃掉的原價要與 displayPrice **同層** —— 選了變體就用那個變體的一般價', () => {
    // 商品級一般價 8,400、變體一般價 9,900、變體經銷價 7,000
    // ⇒ 劃掉的要是 **9,900**（變體的一般價），不是 8,400。
    const SAME_LAYER: MockProduct = {
      ...variantProduct,
      price: 8400,
      dealerPrice: 6720,
      variants: [
        { id: 'v-1', sku: 'S-1', spec: { weave: 'Forged' }, price: 9900, dealerPrice: 7000, images: [] },
      ],
    };
    renderInfo(SAME_LAYER, 'store');
    const body = document.body.textContent ?? '';
    expect(body).toContain('7,000');
    expect(body).toContain('9,900');
    expect(body).not.toContain('8,400');
  });

  it('🔴 store + 無差價 ⇒ **同一個數字不得印兩次**（標記還在、原價那半收掉）', () => {
    renderInfo(NO_DEALER, 'store');
    // 8,400 只能出現在「現價」那一格；`.pd-price-orig` 整個不渲染。
    expect(document.querySelector('.pd-price-orig')).toBeNull();
    expect(document.body.textContent ?? '').toContain('經銷價');
  });

  it('🔴 store + RPC 少回那一列 ⇒ **不得有「經銷價」標記**（假標記與真標記長得一樣）', () => {
    renderInfo(ROW_MISSING, 'store');
    const body = document.body.textContent ?? '';
    expect(body).not.toContain('經銷價');
    expect(body).toContain('8,400');
  });

  it('🔴 premiumStore ⇒ 不得出現「經銷價」標記（本片不做那一級，R1 must-fix 2 的靶）', () => {
    renderInfo(WITH_DEALER, 'premiumStore');
    const body = document.body.textContent ?? '';
    expect(body).not.toContain('經銷價');
    expect(body).toContain('8,400');     // 顯一般價
    expect(body).not.toContain('6,720'); // 不得讀到 store 價
  });

  it('🟢 general ⇒ 顯一般價、沒有「經銷價」標記（而 dealerPrice 就算在也不得被讀）', () => {
    renderInfo(WITH_DEALER, 'general');
    const body = document.body.textContent ?? '';
    expect(body).toContain('8,400');
    expect(body).not.toContain('6,720');       // 🔴 這一格守的是「一般會員看不到經銷價」
    expect(body).not.toContain('經銷價');
    // 🛑 **而這一格答不出「有沒有外洩」**（codex R2 must-fix ⑨）：本檔直接把 `product` 當 prop 餵進去，
    //   經銷價**在 props 裡是被我自己放進去的** ⇒ 這裡只證得了「畫面沒印出來」。
    //   ⇒ 📌 **真正的邊界在 route**：一般會員的 `product.dealerPrice` 必須從頭到尾沒被賦值，
    //     那一格在 `app/products/[slug]/page.test.tsx`（stub 直接讀 props 裡的價）。
  });
});
