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
  // 清掉 CartProvider 寫進 localStorage 的測試殘留 + 選車 context 鏡、避免 test 之間互染
  if (typeof window !== 'undefined') {
    window.localStorage.clear();
    window.sessionStorage.clear();
  }
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

  // Q2=A vehicle producer:relatedVehicleParam 設定 → 相關商品卡片連結帶 ?vehicle=(車輛 context
  //   在 PDP→相關商品→下一個 PDP 點擊鏈中延續、「這台車也適用」不斷)。
  it('should carry ?vehicle on related card links when relatedVehicleParam set', () => {
    mockSearchParams = new URLSearchParams('vehicle=yamaha:mt09:2024');
    render(
      <ProductPage
        product={MOCK_PRODUCTS[0]!}
        tier="general"
        related={MOCK_PRODUCTS.slice(1, 3)}
        relatedHasVehicle
        relatedVehicleParam="yamaha:mt09:2024"
      />,
    );
    const grid = document.querySelector('.pd-related-grid')!;
    const links = grid.querySelectorAll('a[href^="/products/"]');
    expect(links.length).toBeGreaterThan(0);
    links.forEach((a) => expect(a.getAttribute('href')).toContain('?vehicle=yamaha'));
  });

  // 無 relatedVehicleParam(Case B / 無車)→ 卡片連結為純 /products/{slug}、不帶 ?vehicle。
  it('should NOT carry ?vehicle on related card links without relatedVehicleParam', () => {
    mockSearchParams = new URLSearchParams('from=catalog');
    render(<ProductPage product={MOCK_PRODUCTS[0]!} tier="general" related={MOCK_PRODUCTS.slice(1, 3)} />);
    const grid = document.querySelector('.pd-related-grid')!;
    const links = grid.querySelectorAll('a[href^="/products/"]');
    expect(links.length).toBeGreaterThan(0);
    links.forEach((a) => expect(a.getAttribute('href')).not.toContain('vehicle='));
  });

  // R3:related 為空(引擎撈不到 / 失敗降級)→ 相關商品 section 條件隱藏(不顯空卡、不 crash)。
  it('should hide related section when related prop is empty', () => {
    mockSearchParams = new URLSearchParams('from=catalog');
    render(<ProductPage product={MOCK_PRODUCTS[0]!} tier="general" related={[]} />);
    expect(document.querySelector('.pd-related')).toBeNull();
  });

  // ══════════════════════════════════════════════════════════════════════
  // 🔴 2026-08-07 H7:品牌形象區(D8)整組刪除 ⇒ 本區原本 7 條測試中,有 6 條斷言的是
  //    **已經不存在的東西**(RPM 碳纖專屬區 / GB 形象區 / Bonamici 形象區 / 三者的 DOM 順序)。
  //    Sean 在選項明寫「= 推翻 07-08 #270 B S3 拍板」之後仍選 C ⇒ 非誤拍,版位空缺是知情接受。
  //    ⇒ 那 6 條**不是刪掉了事**,改成兩件更該守的事:
  //      ①**正面釘住「刻意留空」**:三個品牌都不得再冒出形象區 —— 擋的是有人「順手補一個回來」。
  //      ②DOM 順序仍要守,但鏈條少一環:規格 < 相關商品 < FAQ(品牌不再影響順序 ⇒ 三條併一條)。
  //    ⚠️ 這 6 條是**動手前的預期 Δ 沒算到的**:我的 consumer 清單只查了「誰 import Showcase」,
  //       `ProductPage.test.tsx` 我看到的是註解、沒查它有沒有**斷言**。已在 STOP 據實申報。
  // ══════════════════════════════════════════════════════════════════════
  // 🔴 這顆 helper 是 H7 改寫時**被我的區間替換連帶吃掉的**(它夾在要換掉的那批測試中間)——
  //    `expectBefore is not defined` 紅了才發現。原封還原,一個字沒改。
  //    ⇒ 這正是本片刪除紀律要防的「起訖索引切段落會靜默吃掉鄰居」,而我在同一片裡又踩了一次。
  // a 在 DOM 排在 b 之前(a.compareDocumentPosition(b) 含 FOLLOWING=4 → b 在 a 之後)
  const expectBefore = (a: Element | null, b: Element | null, la: string, lb: string) => {
    expect(a, `${la} 應存在`).not.toBeNull();
    expect(b, `${lb} 應存在`).not.toBeNull();
    expect(a!.compareDocumentPosition(b!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  };

  it.each([['rpm-carbon'], ['gb-racing'], ['bonamici']])(
    '🔴 H7:%s 頁不得再渲染品牌形象區(版位刻意留空,詳情頁批照 OD 稿重建)',
    (slug) => {
      mockSearchParams = new URLSearchParams('from=catalog');
      render(
        <ProductPage product={{ ...MOCK_PRODUCTS[0]!, brandSlug: slug }} tier="general" related={[]} />,
      );
      // 三支已刪 showcase 的專屬字面 / heading id,一個都不該回來。
      expect(screen.queryByText('為什麼選 RPM Carbon'), 'RPM 形象區又出現了').toBeNull();
      expect(screen.queryByText('為什麼選 GB Racing'), 'GB 形象區又出現了').toBeNull();
      expect(screen.queryByText('為什麼選 Bonamici'), 'Bonamici 形象區又出現了').toBeNull();
      for (const id of ['pd-h-rpm', 'pd-h-gb01', 'pd-h-bona01']) {
        expect(document.getElementById(id), `形象區 heading #${id} 又出現了`).toBeNull();
      }
      // 前提:頁面本身仍完整渲染(否則上面全 null 只是因為整頁沒 render = 恆真)。
      expect(document.querySelector('.pd-spec-section'), '規格區不見了 ⇒ 本條前提失效').not.toBeNull();
    },
  );

  it.each([['rpm-carbon'], ['gb-racing'], ['bonamici']])(
    'H7 後 DOM 順序(%s):規格區 < 相關商品 N°03 < FAQ N°04(品牌不再影響順序)',
    (slug) => {
      mockSearchParams = new URLSearchParams('from=catalog');
      render(
        <ProductPage
          product={{ ...MOCK_PRODUCTS[0]!, brandSlug: slug }}
          tier="general"
          related={MOCK_PRODUCTS.slice(1, 3)}
        />,
      );
      const spec = document.querySelector('.pd-spec-section');
      const related = document.querySelector('.pd-related');
      const faq = document.getElementById('pd-h-faq');
      expectBefore(spec, related, '規格區', '相關商品 N°03');
      expectBefore(related, faq, '相關商品 N°03', 'FAQ N°04');
    },
  );

  it('H7 後 related 為空時:規格區仍在 FAQ 之前(頁面結構不因少一區而塌)', () => {
    mockSearchParams = new URLSearchParams('from=catalog');
    const rpm = { ...MOCK_PRODUCTS[0]!, brandSlug: 'rpm-carbon' };
    render(<ProductPage product={rpm} tier="general" related={[]} />);
    expect(document.querySelector('.pd-related')).toBeNull();
    expectBefore(
      document.querySelector('.pd-spec-section'),
      document.getElementById('pd-h-faq'),
      '規格區',
      'FAQ N°04',
    );
  });

  it('V-2h/MF-4:手機 sticky buybar 加購亦帶車款(讀選車 context、與 ProductInfo 共用 readSearchVehicle)', () => {
    mockSearchParams = new URLSearchParams('from=catalog');
    window.sessionStorage.setItem(
      'pcm.vehicle.v1',
      JSON.stringify({ brandId: 'yamaha', modelId: 'mt-09-sp', year: 2021, label: 'x', brandName: 'Yamaha', modelName: 'MT-09 SP', savedAt: 1 }),
    );
    const { container } = render(<ProductPage product={MOCK_PRODUCTS[0]!} tier="general" related={[]} />);
    const buybarCart = container.querySelector('.pd-mbb-cart') as HTMLButtonElement;
    expect(buybarCart).toBeTruthy();
    fireEvent.click(buybarCart);
    const items = JSON.parse(window.localStorage.getItem('pcm-cart-mock-v2')!);
    expect(items[0].vehicle).toEqual({ kind: 'dict', brand: 'Yamaha', model: 'MT-09 SP', year: 2021, source: 'search' });
  });

  it('V-2h/MF-4:buybar 無選車 context → item 不帶 vehicle(零猜、對照)', () => {
    mockSearchParams = new URLSearchParams('from=catalog'); // 無 sessionStorage 選車鏡
    const { container } = render(<ProductPage product={MOCK_PRODUCTS[0]!} tier="general" related={[]} />);
    fireEvent.click(container.querySelector('.pd-mbb-cart') as HTMLButtonElement);
    const items = JSON.parse(window.localStorage.getItem('pcm-cart-mock-v2')!);
    expect(items[0].vehicle).toBeUndefined();
  });
});
