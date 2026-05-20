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
import { MOCK_PRODUCTS } from '../data/mock-products';

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
