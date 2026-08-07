// @vitest-environment jsdom
//
// AkrapovicShowcase smoke test — 上架第三批 N°01 + N°02(2026-07-19)。
// 驗 eyebrow logo / h2 / lead / 3 卡 + N°02 hero 影片帶(海報+不預載)+ 故事兩段 + 信任狀四格(前台 smoke 慣例)。
// jsdom 無 IntersectionObserver → 元件內建降級(不自動播、停留海報),render 不得丟錯。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { AkrapovicShowcase } from './AkrapovicShowcase';

afterEach(cleanup);

describe('AkrapovicShowcase', () => {
  it('N°01:eyebrow logo + h2 + lead + 3 卡', () => {
    render(<AkrapovicShowcase />);
    expect(document.querySelector('#pd-h-akra01')).not.toBeNull();
    expect(screen.getByAltText('Akrapovič')).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: '為什麼選 Akrapovič' })).toBeDefined();
    expect(screen.getByText(/排氣系統世界霸主/)).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '世界冠軍血統' })).toBeDefined();
    // 「自有鈦合金鑄造廠」亦出現在 N°02 故事段/信任狀(皆 div)→ 用 h3 role 精準鎖 N°01 卡標
    expect(screen.getByRole('heading', { level: 3, name: '自有鈦合金鑄造廠' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '斯洛維尼亞原廠工藝' })).toBeDefined();
    expect(document.querySelectorAll('.pd-feature-card').length).toBe(3);
  });

  it('N°02:hero 影片帶 + 故事兩段 + 信任狀四格(pd-bs 共用骨架 + 品牌色 modifier)', () => {
    render(<AkrapovicShowcase />);
    expect(screen.getByRole('heading', { level: 2, name: '從鈦合金熔湯，到世界冠軍的聲浪' })).toBeDefined();
    expect(document.querySelector('.pd-bs.pd-bs--akrapovic')).not.toBeNull();
    const video = document.querySelector('video.pd-hero-band');
    expect(video).not.toBeNull();
    expect(video?.getAttribute('poster')).toBe('/brands/akrapovic/hero-poster.webp');
    expect(video?.getAttribute('preload')).toBe('none');
    expect(screen.getByText('材料實驗室')).toBeDefined();
    expect(document.querySelectorAll('.pd-bona-brow').length).toBe(2);
    expect(screen.getByText('1991')).toBeDefined();
    expect(screen.getByText('品牌創立')).toBeDefined();
    expect(document.querySelectorAll('.pd-bs-stat').length).toBe(4);
  });
});
