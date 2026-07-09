// @vitest-environment jsdom
//
// SamcoShowcase smoke test — 品牌放量 N°01 + N°02(#212 方向3)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { SamcoShowcase } from './SamcoShowcase';

afterEach(cleanup);

describe('SamcoShowcase', () => {
  it('N°01:eyebrow logo + h2 + lead + 3 卡', () => {
    render(<SamcoShowcase />);
    expect(document.querySelector('#pd-h-samco01')).not.toBeNull();
    expect(screen.getByAltText('Samco Sport')).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: '為什麼選 Samco Sport' })).toBeDefined();
    expect(screen.getByText(/終身保固。$/)).toBeDefined();
    expect(screen.getByText('英國手工製造 26 年')).toBeDefined();
    expect(screen.getByText('終身保固、裝了就忘')).toBeDefined();
    expect(screen.getByText('車型專用、原廠直上')).toBeDefined();
    expect(document.querySelectorAll('.pd-feature-card').length).toBe(3);
  });

  it('N°02:信任狀四格 + 產品線三卡', () => {
    render(<SamcoShowcase />);
    expect(screen.getByRole('heading', { level: 2, name: '水冷系統的最後一次升級' })).toBeDefined();
    expect(document.querySelector('.pd-bs.pd-bs--samco')).not.toBeNull();
    expect(screen.getByText('Lifetime')).toBeDefined();
    expect(screen.getByText('MXGP')).toBeDefined();
    expect(document.querySelectorAll('.pd-bs-stat').length).toBe(4);
    expect(screen.getByText('Hose Kits')).toBeDefined();
    expect(screen.getByText('Clamp Kits')).toBeDefined();
    expect(document.querySelectorAll('.pd-bs-mcard').length).toBe(3);
  });
});
