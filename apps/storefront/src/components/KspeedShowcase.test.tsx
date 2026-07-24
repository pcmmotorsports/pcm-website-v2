// @vitest-environment jsdom
//
// KspeedShowcase smoke test — 品牌放量 N°01 + N°02(2026-07-24)。
// 驗 eyebrow logo / h2 / lead / 3 卡 + N°02 影片 facade(點擊前為 button、非 iframe)+ 兩段圖文 + 信任狀四格。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';

import { KspeedShowcase } from './KspeedShowcase';

afterEach(cleanup);

describe('KspeedShowcase', () => {
  it('N°01:eyebrow logo + h2 + lead + 3 卡', () => {
    render(<KspeedShowcase />);
    expect(document.querySelector('#pd-h-ks01')).not.toBeNull();
    expect(screen.getByAltText('K-SPEED')).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: '為什麼選 K-SPEED' })).toBeDefined();
    expect(screen.getByText(/全黑美學/)).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '原廠指名的訂製設計' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '全黑化，不是隨便噴黑' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '小車改裝的天花板' })).toBeDefined();
    expect(document.querySelectorAll('.pd-feature-card').length).toBe(3);
  });

  it('N°02:影片 facade + 兩段圖文 + 信任狀四格(pd-bs 中性 accent)', () => {
    render(<KspeedShowcase />);
    expect(screen.getByRole('heading', { level: 2, name: '從一間小零件店，到全世界的街頭' })).toBeDefined();
    expect(document.querySelector('.pd-section.pd-bs')).not.toBeNull();
    // 點擊前:facade button(非 iframe、省流量)
    const facade = screen.getByRole('button', { name: '播放 K-SPEED 品牌形象影片' });
    expect(facade).toBeDefined();
    expect(document.querySelector('iframe.pd-bona-video-frame')).toBeNull();
    // 點擊後:載入 YouTube iframe
    fireEvent.click(facade);
    expect(document.querySelector('iframe.pd-bona-video-frame')).not.toBeNull();
    expect(document.querySelectorAll('.pd-bona-brow').length).toBe(2);
    expect(screen.getByText('2002')).toBeDefined();
    expect(screen.getByText('品牌創立')).toBeDefined();
    expect(document.querySelectorAll('.pd-bs-stat').length).toBe(4);
  });
});
