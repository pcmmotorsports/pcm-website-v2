// @vitest-environment jsdom
//
// MateryaShowcase smoke test — 品牌放量精簡版 N°01 + 短 N°02(#212 方向3)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { MateryaShowcase } from './MateryaShowcase';

afterEach(cleanup);

describe('MateryaShowcase', () => {
  it('N°01:eyebrow logo + h2 + lead + 3 卡', () => {
    render(<MateryaShowcase />);
    expect(document.querySelector('#pd-h-mty01')).not.toBeNull();
    expect(screen.getByAltText('Materya')).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: '為什麼選 Materya' })).toBeDefined();
    expect(screen.getByText(/專車專用的義式細節/)).toBeDefined();
    expect(screen.getByText('設計師直營、不是公版模具')).toBeDefined();
    expect(screen.getByText('三種工藝並用')).toBeDefined();
    expect(screen.getByText('專車專用、小廠溫度')).toBeDefined();
    expect(document.querySelectorAll('.pd-feature-card').length).toBe(3);
  });

  it('短 N°02:信任狀三格(cols-3)+ 產品線三卡', () => {
    render(<MateryaShowcase />);
    expect(screen.getByRole('heading', { level: 2, name: '車頭細節的義式收尾' })).toBeDefined();
    expect(document.querySelector('.pd-bs-stats.cols-3')).not.toBeNull();
    expect(screen.getByText('Milano')).toBeDefined();
    expect(document.querySelectorAll('.pd-bs-stat').length).toBe(3);
    expect(screen.getByText('Dashboard Covers')).toBeDefined();
    expect(document.querySelectorAll('.pd-bs-mcard').length).toBe(3);
  });
});
