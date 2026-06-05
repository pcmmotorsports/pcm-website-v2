// @vitest-environment jsdom
//
// ProductSwatchPreview smoke test — picker 上方紋路樣品預覽卡 + 樣品 lightbox(OD-7c 新建)。
// 驗 null 變體不渲染 / 預覽卡 sample + value / findSwatch 對應 + fallback / 點圖開 lightbox。
// 'use client'(useState/useEffect)、不需 router / matchMedia stub。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { ProductSwatchPreview } from './ProductSwatchPreview';
import { findSwatch, RPM_SWATCHES } from '../data/rpm-swatches';
import type { UIVariant } from '../data/mock-products';

afterEach(cleanup);

const variant = (spec: Record<string, string>): UIVariant => ({
  id: `v-${Object.values(spec).join('-') || 'base'}`,
  sku: 'X',
  spec,
  price: 1,
  images: [],
});

describe('findSwatch', () => {
  it('exact match weave + surface (Twill Glossy)', () => {
    const s = findSwatch({ weave: 'Twill', finish: 'Glossy' });
    expect(s.weave).toBe('Twill');
    expect(s.surface).toBe('glossy');
    expect(s.special).toBeUndefined();
  });

  it('12K twill glossy → 12K glossy swatch', () => {
    const s = findSwatch({ weave: 'Twill', finish: 'Glossy', special: '12K' });
    expect(s.special).toBe('12K');
    expect(s.surface).toBe('glossy');
  });

  it('12K + matte (無樣品) → fallback 12K glossy 同 weave', () => {
    const s = findSwatch({ weave: 'Plain', finish: 'Matt', special: '12K' });
    expect(s.special).toBe('12K');
    expect(s.weave).toBe('Plain');
    expect(s.surface).toBe('glossy'); // 無 12K 消光、退亮光
  });

  it('Honeycomb + matte → 消光蜂巢 樣品(存在)', () => {
    const s = findSwatch({ weave: 'Honeycomb', finish: 'Matt' });
    expect(s.weave).toBe('Honeycomb');
    expect(s.surface).toBe('matte');
    expect(s.rare).toBe(true);
  });

  it('Kevlar (無專屬樣品) → fallback 同 weave 一般碳纖', () => {
    const s = findSwatch({ weave: 'Twill', finish: 'Glossy', special: 'Kevlar' });
    expect(s.weave).toBe('Twill');
    expect(s.special).toBeUndefined(); // 退無 special 的基礎 weave
  });
});

describe('ProductSwatchPreview', () => {
  it('renders nothing when selectedVariant is null', () => {
    const { container } = render(<ProductSwatchPreview selectedVariant={null} valueText="" />);
    expect(container.querySelector('.pd-pattern-preview')).toBeNull();
  });

  it('renders preview card with sample image + value text', () => {
    render(<ProductSwatchPreview selectedVariant={variant({ weave: 'Forged', finish: 'Glossy' })} valueText="鍛造 · 亮光" />);
    expect(screen.getByText('當前樣式')).toBeDefined();
    expect(screen.getByText('鍛造 · 亮光')).toBeDefined();
    const img = document.querySelector('.pd-pattern-preview-img img');
    expect(img?.getAttribute('src')).toMatch(/^https:\/\/down-sg\.img\.susercontent\.com\//);
  });

  it('applies is-rare style for 12K selection', () => {
    render(<ProductSwatchPreview selectedVariant={variant({ weave: 'Twill', finish: 'Glossy', special: '12K' })} valueText="12K斜紋 · 亮光" />);
    expect(document.querySelector('.pd-pattern-preview.is-rare')).not.toBeNull();
  });

  it('opens lightbox on preview image click (browses all 10 swatches)', () => {
    render(<ProductSwatchPreview selectedVariant={variant({ weave: 'Forged', finish: 'Glossy' })} valueText="鍛造 · 亮光" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByLabelText('放大檢視當前選擇的紋路樣品'));
    expect(screen.getByRole('dialog')).toBeDefined();
    // counter 顯 NN / 10
    expect(screen.getByText(new RegExp(`/ ${String(RPM_SWATCHES.length).padStart(2, '0')}$`))).toBeDefined();
  });
});
