// @vitest-environment jsdom
//
// ProductPage smoke test — 前台 regression 安全網(M-1-13b)。
// 驗「商品詳細頁骨架 + breadcrumb 8-source 3 分支 + vehicle pill render 不報錯」。
// Header useRouter / useSearchParams / usePathname 走 vi.mock、matchMedia 走 beforeAll stub。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import type { ReactElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render as rtlRender, screen, within } from '@testing-library/react';

const mockReplace = vi.fn();
const mockPush = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  usePathname: () => '/products/lightech-1',
}));

import { ProductPage } from './ProductPage';
import { MOCK_PRODUCTS } from '../data/mock-products';
import { CartProvider } from '../contexts/CartContext';

// M-1-13e-b:render shadow + CartProvider wrapper(useCart 必須在 Provider 內)
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: CartProvider });

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
  mockReplace.mockReset();
  mockPush.mockReset();
  mockSearchParams = new URLSearchParams();
  // 清掉 CartProvider 寫進 localStorage 的測試殘留、避免 test 之間互染
  if (typeof window !== 'undefined') window.localStorage.clear();
});

describe('ProductPage', () => {
  it('should render baseline from=catalog + category breadcrumb', () => {
    mockSearchParams = new URLSearchParams('from=catalog&category=操控部品');
    render(<ProductPage product={MOCK_PRODUCTS[0]!} tier="general" related={[]} />);
    // 用 within(nav) 限定 breadcrumb 範圍、避免與 Footer 內同字面衝突
    const breadcrumbNav = screen.getByLabelText('navigation path');
    expect(within(breadcrumbNav).getByText('首頁')).toBeDefined();
    expect(within(breadcrumbNav).getByText('商品目錄')).toBeDefined();
    expect(within(breadcrumbNav).getByText('操控部品')).toBeDefined();
    expect(within(breadcrumbNav).getByText(MOCK_PRODUCTS[0]!.name)).toBeDefined();
  });

  it('should render from=brand branch with sourceLabel', () => {
    mockSearchParams = new URLSearchParams('from=brand&sourceId=akrapovic&sourceLabel=AKRAPOVIČ');
    const akrapovic = MOCK_PRODUCTS.find((p) => p.slug === 'akrapovic-6')!;
    render(<ProductPage product={akrapovic} tier="general" related={[]} />);
    const breadcrumbNav = screen.getByLabelText('navigation path');
    expect(within(breadcrumbNav).getByText('品牌')).toBeDefined();
    expect(within(breadcrumbNav).getByText('AKRAPOVIČ')).toBeDefined();
    expect(within(breadcrumbNav).getByText(akrapovic.name)).toBeDefined();
  });

  it('should render from=sale branch with default sourceLabel', () => {
    mockSearchParams = new URLSearchParams('from=sale');
    render(<ProductPage product={MOCK_PRODUCTS[1]!} tier="general" related={[]} />);
    const breadcrumbNav = screen.getByLabelText('navigation path');
    expect(within(breadcrumbNav).getByText('特價精選')).toBeDefined();
  });

  it('should render vehicle pill when vehicle searchParam set', () => {
    mockSearchParams = new URLSearchParams('from=catalog&vehicle=yamaha:r6:2024');
    render(<ProductPage product={MOCK_PRODUCTS[0]!} tier="general" related={[]} />);
    // M-1-13I Bug 3:pill 拆兩層、外層 button(本體導航)aria-label「回到商品列表 ...」、
    // 內層 span.×(清除)aria-label「清除車輛篩選 ...」;render 驗外層 button 含 label 字面
    // (vehiclePill label = 'YAMAHA · YZF-R6 · 2024')
    const pill = screen.getByLabelText(/回到商品列表/);
    expect(pill).toBeDefined();
    expect(pill.textContent).toContain('YAMAHA');
    expect(pill.textContent).toContain('YZF-R6');
    expect(pill.textContent).toContain('2024');
  });

  it('should resolve pill label from product fitments for derived slug ids (S1 #152)', () => {
    // S1 後 /products 端 vehicle id = fitment 衍生 slug(非靜態 mock id);
    // pill 以商品自身 fitments + slugify 同源反查、還原原字串(非裸 slug)
    mockSearchParams = new URLSearchParams(
      'from=catalog&vehicle=harley-davidson:road-glide:2024',
    );
    const withFitment = {
      ...MOCK_PRODUCTS[0]!,
      fitments: [{ motoBrand: 'Harley-Davidson', modelCode: 'Road Glide', yearStart: 2020, yearEnd: null }],
    };
    render(<ProductPage product={withFitment} tier="general" related={[]} />);
    const pill = screen.getByLabelText(/回到商品列表/);
    expect(pill.textContent).toContain('Harley-Davidson');
    expect(pill.textContent).toContain('Road Glide');
    expect(pill.textContent).toContain('2024');
  });

  it('should call router.push to /products with vehicle when pill body clicked', () => {
    // M-1-13I Bug 3:點 pill 本體(外層 button、非 ×)→ router.push 商品列表帶 vehicle
    mockSearchParams = new URLSearchParams('from=catalog&vehicle=yamaha:r6:2024');
    render(<ProductPage product={MOCK_PRODUCTS[0]!} tier="general" related={[]} />);
    const pill = screen.getByLabelText(/回到商品列表/);
    fireEvent.click(pill);
    expect(mockPush).toHaveBeenCalledOnce();
    const calledWith = mockPush.mock.calls[0]![0] as string;
    expect(calledWith).toContain('/products?vehicle=');
    expect(calledWith).toContain('yamaha'); // encodeURIComponent('yamaha:r6:2024')
  });

  it('should call router.replace without vehicle when pill × clicked', () => {
    mockSearchParams = new URLSearchParams('from=catalog&category=操控部品&vehicle=yamaha:r6:2024');
    render(<ProductPage product={MOCK_PRODUCTS[0]!} tier="general" related={[]} />);
    const pill = screen.getByLabelText(/清除車輛篩選/);
    fireEvent.click(pill);
    expect(mockReplace).toHaveBeenCalledOnce();
    const calledWith = mockReplace.mock.calls[0]![0] as string;
    // 應保留 from + category、移除 vehicle
    expect(calledWith).toContain('from=catalog');
    expect(calledWith).toContain('category');
    expect(calledWith).not.toContain('vehicle');
  });

  // ProductGallery / ProductInfo 獨立單元測試移至 ProductGallery.test.tsx / ProductInfo.test.tsx
  // 本檔留 2 個整合 case、證明 ProductPage 正確 mount 兩個子元件、不重複測 internal state

  it('should integrate ProductGallery (render counter 01 / 03)', () => {
    mockSearchParams = new URLSearchParams('from=catalog');
    render(<ProductPage product={MOCK_PRODUCTS[0]!} tier="general" related={[]} />);
    expect(screen.getByText('01 / 03')).toBeDefined();
  });

  it('should integrate ProductInfo (render SKU line + brand)', () => {
    mockSearchParams = new URLSearchParams('from=catalog');
    const product = MOCK_PRODUCTS[0]!;
    render(<ProductPage product={product} tier="general" related={[]} />);
    // M-1-16c-4a:pd-sku 由舊「{brand} · PCM-{id hash}」改「{brand} · {selectedVariant?.sku ?? slug}」
    //   (Sean Q1=A、顯選中變體真 sku、無變體 fallback slug)。MOCK_PRODUCTS[0]=LIGHTECH 無 variants
    //   → 走 slug fallback → 「LIGHTECH · lightech-1」。
    //   字面 vs 事實(鐵則 11):16c-4a 只跑 vitest 子集(ProductInfo)、漏跑完整套件、此整合測試 cross-effect
    //   紅未被抓、commit body 測試狀態與完整 vitest 不符;16c-4a v2 修此斷言 + 重跑完整 pnpm test 全綠。
    const productInfo = document.querySelector('.pd-info');
    expect(productInfo).not.toBeNull();
    expect(
      within(productInfo as HTMLElement).getByText(
        `${product.brand} · ${product.slug}`,
      ),
    ).toBeDefined();
  });

  // OD-9:N°03 相關商品 section 換 OD N° 巢狀 eyebrow(03 + 金線 + N° 相關商品、對齊 N°01/N°02)。
  // R3:related 由 server 推薦引擎 prop 傳入;傳非空 fixture → section 渲染。無車 → 標題「同款推薦」(L1)。
  it('should render N°03 related section with OD nested eyebrow (related prop 非空、無車標題)', () => {
    mockSearchParams = new URLSearchParams('from=catalog');
    render(<ProductPage product={MOCK_PRODUCTS[0]!} tier="general" related={MOCK_PRODUCTS.slice(1, 3)} />);
    const related = document.querySelector('.pd-related');
    expect(related).not.toBeNull();
    expect(related!.querySelector('.pd-eb-no')?.textContent).toBe('03');
    expect(related!.querySelector('.pd-eb-label')?.textContent).toContain('相關商品');
    expect(within(related as HTMLElement).getByText('同款推薦')).toBeDefined();
  });

  // R3 情境化標題(L1):有選車(relatedHasVehicle)→「這台車也適用」。
  it('should show vehicle-context title when relatedHasVehicle', () => {
    mockSearchParams = new URLSearchParams('from=catalog');
    render(
      <ProductPage
        product={MOCK_PRODUCTS[0]!}
        tier="general"
        related={MOCK_PRODUCTS.slice(1, 3)}
        relatedHasVehicle
      />,
    );
    const related = document.querySelector('.pd-related');
    expect(within(related as HTMLElement).getByText('這台車也適用')).toBeDefined();
    expect(within(related as HTMLElement).queryByText('同款推薦')).toBeNull();
  });

  // R3:hasMore=true + href → 顯「查看全部」連結、href 正確。無車 → 文案「同款商品」(codex R3 F2)。
  it('should show "查看全部同款商品" link with href when relatedHasMore (無車)', () => {
    mockSearchParams = new URLSearchParams('from=catalog');
    render(
      <ProductPage
        product={MOCK_PRODUCTS[0]!}
        tier="general"
        related={MOCK_PRODUCTS.slice(1, 3)}
        relatedHasMore
        relatedMoreHref="/products?brand=rpm-carbon"
      />,
    );
    const link = document.querySelector('.pd-related-more-link') as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link!.textContent).toContain('查看全部同款商品'); // 無車分支
    expect(link!.getAttribute('href')).toBe('/products?brand=rpm-carbon');
  });

  // R3 codex F2:有車 → CTA 文案「相容商品」(對齊 vehicle filter 目標)。
  it('should show "查看全部相容商品" link when relatedHasMore + relatedHasVehicle (有車)', () => {
    mockSearchParams = new URLSearchParams('from=catalog');
    render(
      <ProductPage
        product={MOCK_PRODUCTS[0]!}
        tier="general"
        related={MOCK_PRODUCTS.slice(1, 3)}
        relatedHasMore
        relatedHasVehicle
        relatedMoreHref="/products?vehicle=yamaha%3Amt09%3A2024"
      />,
    );
    const link = document.querySelector('.pd-related-more-link') as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link!.textContent).toContain('查看全部相容商品'); // 有車分支
    expect(link!.getAttribute('href')).toBe('/products?vehicle=yamaha%3Amt09%3A2024');
  });

  // R3:hasMore=false(預設)→ 不顯「查看全部」連結。
  it('should hide "查看全部" link when relatedHasMore is false', () => {
    mockSearchParams = new URLSearchParams('from=catalog');
    render(<ProductPage product={MOCK_PRODUCTS[0]!} tier="general" related={MOCK_PRODUCTS.slice(1, 3)} />);
    expect(document.querySelector('.pd-related-more-link')).toBeNull();
  });

  // R3:related 為空(引擎撈不到 / 失敗降級)→ 相關商品 section 條件隱藏(不顯空卡、不 crash)。
  it('should hide related section when related prop is empty', () => {
    mockSearchParams = new URLSearchParams('from=catalog');
    render(<ProductPage product={MOCK_PRODUCTS[0]!} tier="general" related={[]} />);
    expect(document.querySelector('.pd-related')).toBeNull();
  });

  // 🔴 P0-C 去碳品牌切換骨架(F1 回歸網):RPM 頁渲染碳纖維專屬區、非 RPM 頁空白(Q2=B)。
  //   守門用 brandSlug(≠ product.brand 顯示名);此測釘死「RPM 見、非 RPM 不見」防 F1 恆 false 回歸。
  it('RPM 品牌(brandSlug=rpm-carbon)→ 渲染碳纖維專屬區(N°01 + N°02 + 服務橫條泰國原廠卡)', () => {
    mockSearchParams = new URLSearchParams('from=catalog');
    const rpm = { ...MOCK_PRODUCTS[0]!, brandSlug: 'rpm-carbon' };
    render(<ProductPage product={rpm} tier="general" related={[]} />);
    // N°01「為什麼選 RPM Carbon」(ProductHighlights、整段守門 mount;字面為該區 h2 專屬)
    expect(screen.getByText('為什麼選 RPM Carbon')).toBeDefined();
    // N°02 紋路牆(ProductSwatchWall、整段守門 mount;'亮光款'/'消光款' 為 SwatchWall 專屬字面)
    expect(screen.getByText('亮光款')).toBeDefined();
    expect(screen.getByText('消光款')).toBeDefined();
    // 服務橫條「泰國原廠」卡(卡級守門顯;此字面僅 ProductServices)
    expect(screen.getByText('泰國原廠')).toBeDefined();
  });

  it('非 RPM 品牌(brandSlug=gb-racing)→ 碳纖維專屬區全空白、但通用服務卡照顯(Q2=B 去碳)', () => {
    mockSearchParams = new URLSearchParams('from=catalog');
    const nonRpm = { ...MOCK_PRODUCTS[0]!, brandSlug: 'gb-racing' };
    render(<ProductPage product={nonRpm} tier="general" related={[]} />);
    // 碳纖維專屬整段(N°01/N°02)+ 泰國原廠卡皆不 mount(P0-C-a 守門;ProductTabs 去碳為 P0-C-b、故不驗其碳字)
    expect(screen.queryByText('為什麼選 RPM Carbon')).toBeNull();
    expect(screen.queryByText('亮光款')).toBeNull();
    expect(screen.queryByText('消光款')).toBeNull();
    expect(screen.queryByText('泰國原廠')).toBeNull();
    // 但 3 張通用服務承諾卡仍全顯(不誤藏、非 RPM 商品也要看到 PCM 服務)
    expect(screen.getByText('滿額免運')).toBeDefined();
    expect(screen.getByText('專業安裝')).toBeDefined();
    expect(screen.getByText('LINE 諮詢')).toBeDefined();
  });

  // 🔴 #270 B S3(Sean 拍 B 一致性 + codex 關卡1 must-fix 補 DOM 順序斷言):品牌形象區統一搬到規格
  //   分頁「之下」。順序鎖:規格(.pd-spec-section)< 品牌形象 N°01(#pd-h-rpm)< 相關商品 N°03
  //   (.pd-related)< FAQ N°04(#pd-h-faq)。防未來誤把形象區搬回規格上方 / 順序漂移。
  // a 在 DOM 排在 b 之前(a.compareDocumentPosition(b) 含 FOLLOWING=4 → b 在 a 之後)
  const expectBefore = (a: Element | null, b: Element | null, la: string, lb: string) => {
    expect(a, `${la} 應存在`).not.toBeNull();
    expect(b, `${lb} 應存在`).not.toBeNull();
    expect(a!.compareDocumentPosition(b!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  };

  it('RPM 頁 DOM 順序:規格區 < 品牌形象 N°01 < 相關商品 N°03 < FAQ N°04', () => {
    mockSearchParams = new URLSearchParams('from=catalog');
    const rpm = { ...MOCK_PRODUCTS[0]!, brandSlug: 'rpm-carbon' };
    render(<ProductPage product={rpm} tier="general" related={MOCK_PRODUCTS.slice(1, 3)} />);
    const spec = document.querySelector('.pd-spec-section');
    const showcase = document.getElementById('pd-h-rpm'); // N°01「為什麼選 RPM Carbon」heading
    const related = document.querySelector('.pd-related');
    const faq = document.getElementById('pd-h-faq'); // N°04 常見問題 heading
    expectBefore(spec, showcase, '規格區', '品牌形象 N°01');
    expectBefore(showcase, related, '品牌形象 N°01', '相關商品 N°03');
    expectBefore(related, faq, '相關商品 N°03', 'FAQ N°04');
  });

  it('RPM 頁 related 為空時:品牌形象 N°01 仍在規格之下、且在 FAQ 之前', () => {
    mockSearchParams = new URLSearchParams('from=catalog');
    const rpm = { ...MOCK_PRODUCTS[0]!, brandSlug: 'rpm-carbon' };
    render(<ProductPage product={rpm} tier="general" related={[]} />);
    expect(document.querySelector('.pd-related')).toBeNull(); // related 空 → N°03 不渲染
    const spec = document.querySelector('.pd-spec-section');
    const showcase = document.getElementById('pd-h-rpm');
    const faq = document.getElementById('pd-h-faq');
    expectBefore(spec, showcase, '規格區', '品牌形象 N°01');
    expectBefore(showcase, faq, '品牌形象 N°01', 'FAQ N°04');
  });

  it('RPM hasSpotlight=true → Spotlight 渲染且排在規格之下(reorder 後仍顯、雙守門通過)', () => {
    mockSearchParams = new URLSearchParams('from=catalog');
    const rpm = { ...MOCK_PRODUCTS[0]!, brandSlug: 'rpm-carbon', hasSpotlight: true };
    render(<ProductPage product={rpm} tier="general" related={[]} />);
    const spec = document.querySelector('.pd-spec-section');
    const spotlight = document.querySelector('.pd-spotlight');
    expectBefore(spec, spotlight, '規格區', 'Spotlight'); // 存在 + 在規格之下
  });

  it('非 RPM(gb-racing)hasSpotlight=true → Spotlight 仍不渲染(brandSlug 第二道守門)', () => {
    mockSearchParams = new URLSearchParams('from=catalog');
    const nonRpm = { ...MOCK_PRODUCTS[0]!, brandSlug: 'gb-racing', hasSpotlight: true };
    render(<ProductPage product={nonRpm} tier="general" related={[]} />);
    // BrandShowcase gb-racing → null(S4 前無形象區);Spotlight 雙守門(brandSlug≠rpm-carbon)不渲染
    expect(document.querySelector('.pd-spotlight')).toBeNull();
    expect(document.getElementById('pd-h-rpm')).toBeNull(); // N°01 亦不顯
    // 規格區仍在、且在 FAQ 之前(頁面結構完整)
    expectBefore(
      document.querySelector('.pd-spec-section'),
      document.getElementById('pd-h-faq'),
      '規格區',
      'FAQ N°04',
    );
  });
});
