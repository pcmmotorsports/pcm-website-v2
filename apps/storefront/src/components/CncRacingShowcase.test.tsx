// @vitest-environment jsdom
//
// CncRacingShowcase smoke test — 品牌放量 N°01 + N°02(#212 方向3)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { CncRacingShowcase } from './CncRacingShowcase';

afterEach(cleanup);

describe('CncRacingShowcase', () => {
  it('N°01:eyebrow logo + h2 + lead + 3 卡', () => {
    render(<CncRacingShowcase />);
    expect(document.querySelector('#pd-h-cnc01')).not.toBeNull();
    expect(screen.getByAltText('CNC Racing')).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: '為什麼選 CNC Racing' })).toBeDefined();
    expect(screen.getByText(/MotoGP 圍場實戰背書/)).toBeDefined();
    expect(screen.getByText('Since 1995、義大利切削工藝')).toBeDefined();
    expect(screen.getByText('MotoGP 圍場實戰')).toBeDefined();
    expect(screen.getByText('歐系車款深度覆蓋')).toBeDefined();
    expect(document.querySelectorAll('.pd-feature-card').length).toBe(3);
  });

  it('N°02:信任狀四格 + 產品線四卡', () => {
    render(<CncRacingShowcase />);
    expect(screen.getByRole('heading', { level: 2, name: '整塊鋁，切出來的義大利精品' })).toBeDefined();
    expect(document.querySelector('.pd-bs.pd-bs--cnc-racing')).not.toBeNull();
    expect(screen.getByText('1995')).toBeDefined();
    expect(screen.getByText('1,787')).toBeDefined();
    expect(document.querySelectorAll('.pd-bs-stat').length).toBe(4);
    expect(screen.getByText('Controls')).toBeDefined();
    expect(screen.getByText('Chassis')).toBeDefined();
    expect(document.querySelectorAll('.pd-bs-mcard').length).toBe(4);
  });
});
