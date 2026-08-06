// @vitest-environment jsdom
//
// ProductCard smoke test — WO-3 工作流優化、前台 regression 安全網。
// 驗「render 不報錯 + hover 切換不報錯」。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProductCard } from './ProductCard';
import { MOCK_PRODUCTS } from '../data/mock-products';

const product = MOCK_PRODUCTS[0]!;

afterEach(cleanup);

describe('ProductCard', () => {
  it('should render a product card without crashing', () => {
    render(<ProductCard p={product} />);
    expect(screen.getByText(product.brand)).toBeDefined();
    expect(screen.getByText(product.name)).toBeDefined();
  });

  it('should not crash on hover enter / leave', () => {
    render(<ProductCard p={product} />);
    const card = screen.getByText(product.name).closest('article')!;
    fireEvent.mouseEnter(card);
    fireEvent.mouseLeave(card);
    expect(card).toBeDefined();
  });

  it('should toggle the like button without crashing', () => {
    render(<ProductCard p={product} />);
    fireEvent.click(screen.getByLabelText('收藏'));
    expect(screen.getByLabelText('收藏')).toBeDefined();
  });

  it('should render an anchor with href when href prop is provided', () => {
    render(<ProductCard p={product} href={`/products/${product.slug}?from=catalog`} />);
    const anchor = screen.getByText(product.name).closest('a');
    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute('href')).toBe(`/products/${product.slug}?from=catalog`);
  });

  it('should fall back to article + onClick when href is absent', () => {
    render(<ProductCard p={product} />);
    expect(screen.getByText(product.name).closest('a')).toBeNull();
    expect(screen.getByText(product.name).closest('article')).not.toBeNull();
  });

  // M-1-16c-1:真圖渲染 + 無圖 fallback
  it('should render the real product image when p.image is provided', () => {
    const realUrl = 'https://cdn.shopify.com/s/files/test-carbon.jpg';
    render(<ProductCard p={{ ...product, image: realUrl }} />);
    const imgs = screen.getAllByAltText(product.brand);
    expect(imgs.some((el) => el.getAttribute('src') === realUrl)).toBe(true);
    // 真圖分支只渲染單張、不走 unsplash placeholder
    expect(imgs.some((el) => el.getAttribute('src')?.includes('images.unsplash.com'))).toBe(false);
  });

  it('should fall back to placeholder gallery when p.image is absent', () => {
    render(<ProductCard p={product} />);
    const imgs = screen.getAllByAltText(product.brand);
    expect(imgs.some((el) => el.getAttribute('src')?.includes('images.unsplash.com'))).toBe(true);
  });

  // 🔴 2026-08-07(R1 MF3):以下幾條(trim/contain/漸層)量的是 jsdom 產出的 React inline style
  // **字串**(`el.style.background` 等),沒有 cascade/合成/真瀏覽器——不是「畫面實測」。本片沒有
  // 任何真瀏覽器證據(本機三條路由都渲染不出商品卡、無法起站量測),實際外觀待 Sean 在有資料的
  // 站上看。products-r1.test.ts 那邊若引用這裡,引的也只是「字面對不對」,不是「畫面對不對」。
  // trim 線 S4b:去白邊模式 vs cover fallback
  it('should apply trim positioning and white background when p.imageTrim resolves', () => {
    const realUrl = 'https://cdn.shopify.com/s/files/test-trim.jpg';
    // l=t=0.1 w=h=0.5 方圖 → computeTrimStyle width 184% / left top -14.4%
    const trim = { l: 0.1, t: 0.1, w: 0.5, h: 0.5, nw: 1000, nh: 1000 };
    render(<ProductCard p={{ ...product, image: realUrl, imageTrim: trim }} />);
    const img = screen.getAllByAltText(product.brand).find((el) => el.getAttribute('src') === realUrl)!;
    expect(img.style.width).toBe('184%');
    expect(img.style.left).toBe('-14.4%');
    expect(img.style.top).toBe('-14.4%');
    expect(img.style.transformOrigin).toBe('35% 35%');
    expect(img.style.objectFit).toBe('');
    const gallery = img.closest('.pcard-gallery') as HTMLElement;
    expect(gallery.style.background, '前提(非獨立防線,被下面的 toContain 嚴格蘊含):gallery 有算出 background(非空字串)').not.toBe('');
    expect(gallery.style.background).toContain('255, 255, 255');
  });

  it('should use object-fit contain (full image, no crop) when imageTrim is absent or too small', () => {
    // Sean 2026-07-24 拍板:非 trim 的 fallback 由 cover→contain(非正方形合成圖 cover 會裁掉上下)。
    const realUrl = 'https://cdn.shopify.com/s/files/test-cover.jpg';
    // 無 trim → contain fallback
    render(<ProductCard p={{ ...product, image: realUrl }} />);
    // 內容過小(w=h=0.2 → 460% 超 300% 上限)→ 一樣走 contain fallback
    render(<ProductCard p={{ ...product, image: realUrl, imageTrim: { l: 0.4, t: 0.4, w: 0.2, h: 0.2, nw: 1000, nh: 1000 } }} />);
    const covers = screen.getAllByAltText(product.brand).filter((el) => el.getAttribute('src') === realUrl);
    expect(covers.length).toBe(2);
    for (const img of covers) {
      expect(img.style.objectFit).toBe('contain');
      expect(img.style.width).toBe('100%');
      const gallery = img.closest('.pcard-gallery') as HTMLElement;
      // 圖框白底(Sean 2026-08-06 拍 A、推翻 07-24 拍板 Q1=A 的 --c-surface-2 灰底 letterbox)
      expect(gallery.style.background, '前提(非獨立防線,被下面的 toContain 嚴格蘊含):gallery 有算出 background(非空字串)').not.toBe('');
      expect(gallery.style.background, 'contain fallback 應是純白 #ffffff').toContain('255, 255, 255');
      expect(gallery.style.background, '不該殘留舊的 --c-surface-2 灰底').not.toContain('--c-surface-2');
    }
  });

  // 圖框白底(2026-08-06 拍 A)· 漸層 placeholder 分支釘住不變(本片刻意不動、見 ProductCard.tsx 元件註解)
  it('should keep the colored gradient background for the no-real-image placeholder path (untouched by 08-06 white-card change)', () => {
    render(<ProductCard p={{ ...product, image: null }} />);
    const img = screen.getAllByAltText(product.brand).find((el) => el.getAttribute('src')?.includes('images.unsplash.com'))!;
    const gallery = img.closest('.pcard-gallery') as HTMLElement;
    expect(gallery.style.background, '前提(非獨立防線,被下面的 toContain 嚴格蘊含):gallery 有算出 background(非空字串)').not.toBe('');
    expect(gallery.style.background, 'placeholder 分支應仍是 linear-gradient、不是純白').toContain('linear-gradient');
    // 🔴 2026-08-07(R1 nit):這條前提是 PALETTES(見 ProductCard.tsx)六色沒有一個含
    // rgb(255, 255, 255) —— 日後有人加一個含白的 palette(例如更淺的 cool 色),這條會無聲失效
    // (linear-gradient 字串裡混進 '255, 255, 255' 也一樣通過上面那條 toContain)。
    expect(gallery.style.background, 'placeholder 分支不該被誤改成 #fff').not.toContain('255, 255, 255');
  });
});
