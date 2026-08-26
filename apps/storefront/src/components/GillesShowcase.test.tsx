// @vitest-environment jsdom
//
// GillesShowcase smoke test — 上架第 17 家 N°01 + N°02(2026-08-27)。
// 驗 eyebrow logo / h2 / lead / 3 卡 + N°02 hero 影片帶(海報+不預載)+ 故事兩段 + 信任狀四格(前台 smoke 慣例)。
// jsdom 無 IntersectionObserver → 元件內建降級(不自動播、停留海報),render 不得丟錯。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { GillesShowcase } from './GillesShowcase';

afterEach(cleanup);

describe('GillesShowcase', () => {
  it('N°01:eyebrow logo + h2 + lead + 3 卡', () => {
    render(<GillesShowcase />);
    expect(document.querySelector('#pd-h-gilles01')).not.toBeNull();
    expect(screen.getByAltText('GILLES TOOLING')).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: '為什麼選 GILLES TOOLING' })).toBeDefined();
    expect(screen.getByText(/CNC 人車介面專家/)).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '起點是自己那台賽車' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '進得了原廠的門' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '掛得上驗車的認證' })).toBeDefined();
    expect(document.querySelectorAll('.pd-feature-card').length).toBe(3);
  });

  it('N°02:hero 影片帶 + 故事兩段 + 信任狀四格(pd-bs 共用骨架 + 品牌色 modifier)', () => {
    render(<GillesShowcase />);
    expect(screen.getByRole('heading', { level: 2, name: '手掌、腳掌與坐姿，一次對齊' })).toBeDefined();
    expect(document.querySelector('.pd-bs.pd-bs--gilles')).not.toBeNull();
    const video = document.querySelector('video.pd-hero-band');
    expect(video).not.toBeNull();
    expect(video?.getAttribute('src')).toBe('/brands/gilles/hero.mp4');
    expect(video?.getAttribute('poster')).toBe('/brands/gilles/hero-poster.webp');
    expect(video?.getAttribute('preload')).toBe('none');
    expect(screen.getByText('為自己那台車做的')).toBeDefined();
    expect(screen.getByText('六條線，同一台車')).toBeDefined();
    expect(document.querySelectorAll('.pd-bona-brow').length).toBe(2);
    expect(document.querySelectorAll('.pd-bs-stat').length).toBe(4);
  });

  it('🔴 信任狀四格逐格釘死字面(官網當場查證值;改動 = 對外可見的事實變更,必須連這裡一起改)', () => {
    render(<GillesShowcase />);
    // 2000 / 盧森堡 Grevenmacher — imprint 與 Behind-the-scenes 逐字
    expect(screen.getByText('2000')).toBeDefined();
    expect(screen.getByText('盧森堡 Grevenmacher')).toBeDefined();
    // 7075 / Made in Luxembourg — Footrest-systems 商品頁逐字
    expect(screen.getByText('7075')).toBeDefined();
    expect(screen.getByText('CNC Made in Luxembourg')).toBeDefined();
    // OEM 三家 — Behind-the-scenes 逐字 "OEM supplier for BMW Motorrad, Yamaha and Suzuki"
    expect(screen.getByText('BMW · Yamaha · Suzuki')).toBeDefined();
  });

  it('🔴 負對照:國籍不得寫成「德國」(來源側交接文件 §4 寫錯過,而 imprint 是盧森堡)', () => {
    const { container } = render(<GillesShowcase />);
    expect(container.textContent).toContain('盧森堡');
    expect(container.textContent).not.toContain('德國');
  });
});
