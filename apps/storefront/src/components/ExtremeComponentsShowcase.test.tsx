// @vitest-environment jsdom
//
// ExtremeComponentsShowcase smoke test — 品牌放量 N°01 + N°02(2026-07-24)。
// 驗 eyebrow logo / h2 / lead / 3 卡 + N°02 賽車橫幅(img.pd-hero-band、非影片)+ 三段圖文 + 信任狀四格(pd-bs--extreme)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ExtremeComponentsShowcase } from './ExtremeComponentsShowcase';

afterEach(cleanup);

describe('ExtremeComponentsShowcase', () => {
  it('N°01:eyebrow logo + h2 + lead + 3 卡', () => {
    render(<ExtremeComponentsShowcase />);
    expect(document.querySelector('#pd-h-ext01')).not.toBeNull();
    expect(screen.getByAltText('Extreme Components')).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: '為什麼選 Extreme Components' })).toBeDefined();
    expect(screen.getByText(/Moto3 世界冠軍/)).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '六座冠軍，同一個賽季' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '三種纖維，三個戰場' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '賽場先跑過，才輪到你' })).toBeDefined();
    expect(document.querySelectorAll('.pd-feature-card').length).toBe(3);
  });

  it('N°02:賽車橫幅 + 三段圖文 + 信任狀四格(pd-bs--extreme 紅 accent)', () => {
    render(<ExtremeComponentsShowcase />);
    expect(screen.getByRole('heading', { level: 2, name: '從一塊 7075，到世界冠軍的腳下' })).toBeDefined();
    expect(document.querySelector('.pd-bs.pd-bs--extreme')).not.toBeNull();
    // 無官方影片 → hero band 為 img(非 video/iframe)
    const band = document.querySelector('img.pd-hero-band');
    expect(band).not.toBeNull();
    expect(band?.getAttribute('src')).toBe('/brands/extreme/band.webp');
    expect(document.querySelector('video.pd-hero-band')).toBeNull();
    expect(document.querySelectorAll('.pd-bona-brow').length).toBe(3);
    expect(screen.getByText('6', { exact: true })).toBeDefined();
    expect(screen.getByText('2025 冠軍頭銜')).toBeDefined();
    expect(document.querySelectorAll('.pd-bs-stat').length).toBe(4);
  });
});
