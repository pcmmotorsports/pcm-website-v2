// @vitest-environment jsdom
//
// ProductGallery smoke test — 商品詳細頁圖片牆獨立單元測試
// M-1-13d 新建補 13c 違鐵則 11(動到前台元件未順手補 smoke test、本 sub-slice 順手補回)
// 驗 hero / thumbs / counter / 鍵盤切圖 / lightbox render 不報錯
// 不 mock next/navigation(ProductGallery 不用)、不 stub matchMedia(只 Header 用)
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { ProductGallery } from './ProductGallery';
import { MOCK_PRODUCTS, type UIVariant } from '../data/mock-products';

afterEach(() => {
  cleanup();
});

describe('ProductGallery', () => {
  it('should render 3 thumbnails + counter 01 / 03', () => {
    render(<ProductGallery product={MOCK_PRODUCTS[0]!} />);
    expect(screen.getByLabelText('圖片 1')).toBeDefined();
    expect(screen.getByLabelText('圖片 2')).toBeDefined();
    expect(screen.getByLabelText('圖片 3')).toBeDefined();
    expect(screen.getByText('01 / 03')).toBeDefined();
  });

  it('should advance activeImg when right arrow clicked', () => {
    render(<ProductGallery product={MOCK_PRODUCTS[0]!} />);
    fireEvent.click(screen.getByLabelText('下一張'));
    expect(screen.getByText('02 / 03')).toBeDefined();
  });

  it('should not render lightbox dialog by default', () => {
    render(<ProductGallery product={MOCK_PRODUCTS[0]!} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('should render sale badge when product.isSale is true', () => {
    // 找 isSale=true 的樣本(akrapovic-6 isSale=true 且 origPrice=112000、有 discount %)
    const saleSample = MOCK_PRODUCTS.find((p) => p.isSale && p.origPrice !== null)!;
    render(<ProductGallery product={saleSample} />);
    // hero badge 顯示 −XX%(對齊 design L261 字面 isSale ? `−{discountPct}%`)
    const expectedPct = Math.round(
      (1 - saleSample.price / (saleSample.origPrice as number)) * 100,
    );
    expect(screen.getByText(`−${expectedPct}%`)).toBeDefined();
  });

  it('should render NEW badge when product.isNew && !isSale', () => {
    const newSample = MOCK_PRODUCTS.find((p) => p.isNew && !p.isSale)!;
    render(<ProductGallery product={newSample} />);
    expect(screen.getByText('NEW')).toBeDefined();
  });

  // OD-4a/OD-7d:選中變體有自己的圖 → 圖庫顯變體圖。MOCK_PRODUCTS[0] 無 product.images/variants,
  //   故池 = 變體 2 張(OD-7d 聚合無其他圖可補、退化為變體圖 only 的特例)。
  it('should show selected variant images when product has no other images', () => {
    const variant: UIVariant = {
      sku: 'X-G-F',
      spec: { weave: 'Forged', finish: 'Glossy' },
      price: 8400,
      images: [
        'https://cdn.example.com/v1.jpg',
        'https://cdn.example.com/v2.jpg',
      ],
    };
    render(<ProductGallery product={MOCK_PRODUCTS[0]!} selectedVariant={variant} />);
    // 2 張變體圖 → counter 01 / 02(覆蓋 MOCK_PRODUCTS[0] 無圖時的 seed 3 張路徑)
    expect(screen.getByText('01 / 02')).toBeDefined();
    expect(screen.getByLabelText('圖片 1')).toBeDefined();
    expect(screen.getByLabelText('圖片 2')).toBeDefined();
    expect(screen.queryByLabelText('圖片 3')).toBeNull();
  });

  // OD-7d(Sean 2026-06-03 Q2):選中變體圖排最前 + 其餘所有變體圖 + 群代表圖補後、去重保序
  it('should put selected variant images first then append all other images (dedup)', () => {
    const variants: UIVariant[] = [
      { sku: 'A', spec: { weave: 'Twill', finish: 'Glossy' }, price: 1, images: ['https://cdn.example.com/a1.jpg', 'https://cdn.example.com/a2.jpg'] },
      { sku: 'B', spec: { weave: 'Plain', finish: 'Glossy' }, price: 1, images: ['https://cdn.example.com/b1.jpg'] },
    ];
    const product = {
      ...MOCK_PRODUCTS[0]!,
      images: ['https://cdn.example.com/b1.jpg'], // 代表圖 = B 的圖(模擬真 DB「代表圖已在某變體」、應去重)
      variants,
    };
    // 選變體 B(圖 b1)→ 池 = b1(選中)+ a1,a2(其餘變體)+ 代表圖 b1(去重)→ 3 張
    render(<ProductGallery product={product} selectedVariant={variants[1]!} />);
    expect(screen.getByText('01 / 03')).toBeDefined();
    // 第一張 = 選中變體 B 的圖 b1(排最前)
    const thumb1 = screen.getByLabelText('圖片 1').querySelector('img');
    expect(thumb1?.getAttribute('src')).toBe('https://cdn.example.com/b1.jpg');
    // 其餘 a1 / a2 接在後(可一路滑)
    const thumb2 = screen.getByLabelText('圖片 2').querySelector('img');
    expect(thumb2?.getAttribute('src')).toBe('https://cdn.example.com/a1.jpg');
  });

  // Fix A(Sean 2026-06-03 :3001 驗):縮圖列 >5 張顯翻頁箭頭、≤5 張不顯;全部縮圖仍渲染(視窗化靠 CSS 捲動)
  it('should render thumbnail paging arrows only when more than 5 images', () => {
    const make = (n: number): UIVariant => ({
      sku: 'M',
      spec: { weave: 'Twill', finish: 'Glossy' },
      price: 1,
      images: Array.from({ length: n }, (_, i) => `https://cdn.example.com/m${i}.jpg`),
    });
    const { unmount } = render(
      <ProductGallery product={MOCK_PRODUCTS[0]!} selectedVariant={make(6)} />,
    );
    expect(screen.getByLabelText('上一批縮圖')).toBeDefined();
    expect(screen.getByLabelText('下一批縮圖')).toBeDefined();
    expect(screen.getByText('01 / 06')).toBeDefined();
    expect(screen.getByLabelText('圖片 6')).toBeDefined(); // 全 6 縮圖渲染(5 格視窗 + 捲動)
    unmount();
    render(<ProductGallery product={MOCK_PRODUCTS[0]!} selectedVariant={make(5)} />);
    expect(screen.queryByLabelText('上一批縮圖')).toBeNull();
    expect(screen.queryByLabelText('下一批縮圖')).toBeNull();
  });

  // Fix(Sean 2026-06-03 :3001 手機驗:大圖無法放大):手機 tap(touchend)開大圖 lightbox。
  // ⚠️ jsdom 不合成 touch 後的 ghost click,本測只驗 tap-open 路徑;ghost-click-close 根因(已加 preventDefault)需真機驗。
  it('opens lightbox on a mobile tap (touchstart + touchend at same point)', () => {
    render(<ProductGallery product={MOCK_PRODUCTS[0]!} />);
    const hero = document.querySelector('.pd-hero-img') as HTMLElement;
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.touchStart(hero, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchEnd(hero, { changedTouches: [{ clientX: 100, clientY: 100 }] });
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('should clamp counter at 03 / 03 when right arrow reaches last image', () => {
    // ProductGallery.tsx line 150-151:setActiveImg(Math.min(gallery.length - 1, ...)) + disabled
    // 不 wraparound、clamped at last index
    render(<ProductGallery product={MOCK_PRODUCTS[0]!} />);
    fireEvent.click(screen.getByLabelText('下一張'));
    fireEvent.click(screen.getByLabelText('下一張'));
    expect(screen.getByText('03 / 03')).toBeDefined();
    // 已 disabled、再 click 無效、仍 03 / 03
    fireEvent.click(screen.getByLabelText('下一張'));
    expect(screen.getByText('03 / 03')).toBeDefined();
  });
});
