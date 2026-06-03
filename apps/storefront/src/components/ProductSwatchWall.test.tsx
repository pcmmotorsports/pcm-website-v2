// @vitest-environment jsdom
//
// ProductSwatchWall smoke test — N°02「紋路 × 表面」紋路樣式牆(OD-7b 新建)。
// 驗 eyebrow / h2 / lead / 亮光 6 + 消光 4 = 10 卡 + is-rare 徽章 + swatch-note。
// 純 presentational、無 props、無 hooks(prop-less RPM 品牌通用展示)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ProductSwatchWall } from './ProductSwatchWall';

afterEach(cleanup);

describe('ProductSwatchWall', () => {
  it('renders N°02 eyebrow (02) + h2 + lead', () => {
    render(<ProductSwatchWall />);
    expect(document.querySelector('.pd-eb-no')?.textContent).toBe('02');
    const h2 = screen.getByRole('heading', { level: 2 });
    expect(h2.textContent).toContain('五款紋路');
    expect(screen.getByText(/紋路依花色不同價格不一樣/)).toBeDefined();
  });

  it('renders two surface groups (亮光 6 + 消光 4)', () => {
    render(<ProductSwatchWall />);
    expect(screen.getByText('亮光款')).toBeDefined();
    expect(screen.getByText('消光款')).toBeDefined();
    expect(screen.getByText('6 種樣式')).toBeDefined();
    expect(screen.getByText('4 種樣式')).toBeDefined();
  });

  it('renders exactly 10 swatch cards with real CDN image URLs', () => {
    render(<ProductSwatchWall />);
    const cards = document.querySelectorAll('.swatch-card');
    expect(cards.length).toBe(10);
    const imgs = document.querySelectorAll('.swatch-card-img img');
    expect(imgs.length).toBe(10);
    // 圖片用 Shopee 圖床真 URL(直接搬 OD 模板、非本地資產)
    imgs.forEach((img) => {
      expect(img.getAttribute('src')).toMatch(/^https:\/\/down-sg\.img\.susercontent\.com\//);
    });
  });

  it('renders 3 is-rare cards (2 款 12K + 1 消光蜂巢) with tag badges', () => {
    render(<ProductSwatchWall />);
    const rare = document.querySelectorAll('.swatch-card.is-rare');
    expect(rare.length).toBe(3);
    // 12K tag × 2 + 特別訂製 × 1
    expect(screen.getAllByText('12K').length).toBe(2);
    expect(screen.getByText('特別訂製')).toBeDefined();
  });

  it('renders the swatch-note 挑選小提醒', () => {
    render(<ProductSwatchWall />);
    expect(screen.getByText(/挑選小提醒/)).toBeDefined();
    expect(screen.getByText(/特殊樣式需等/)).toBeDefined();
  });
});
