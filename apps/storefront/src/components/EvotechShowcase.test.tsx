// @vitest-environment jsdom
//
// EvotechShowcase smoke test — 品牌放量 N°01 + N°02(#212 方向3)。
// 驗 eyebrow logo / h2 / lead / 3 卡 + N°02 信任狀四格 + 產品線四卡字面渲染(前台 smoke 慣例)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { EvotechShowcase } from './EvotechShowcase';

afterEach(cleanup);

describe('EvotechShowcase', () => {
  it('N°01:eyebrow logo + h2 + lead + 3 卡', () => {
    render(<EvotechShowcase />);
    expect(document.querySelector('#pd-h-evo01')).not.toBeNull();
    expect(screen.getByAltText('Evotech Performance')).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: '為什麼選 Evotech Performance' })).toBeDefined();
    expect(screen.getByText(/航太級鋁合金防護配件/)).toBeDefined();
    expect(screen.getByText('賽事實戰驗證')).toBeDefined();
    expect(screen.getByText('航太級鋁合金、英國自家製')).toBeDefined();
    expect(screen.getByText('選對車型、精準貼合')).toBeDefined();
    expect(document.querySelectorAll('.pd-feature-card').length).toBe(3);
  });

  it('N°02:信任狀四格 + 產品線五卡(pd-bs 共用骨架 + 品牌色 modifier)', () => {
    render(<EvotechShowcase />);
    expect(screen.getByRole('heading', { level: 2, name: '從賽道回到日常的防護配件' })).toBeDefined();
    expect(document.querySelector('.pd-bs.pd-bs--evotech')).not.toBeNull();
    expect(screen.getByText('2003')).toBeDefined();
    expect(screen.getByText('品牌創立')).toBeDefined();
    expect(document.querySelectorAll('.pd-bs-stat').length).toBe(4);
    expect(screen.getByText('Race Protection')).toBeDefined();
    expect(screen.getByText('Spindle Protection')).toBeDefined();
    expect(document.querySelectorAll('.pd-bs-mcard').length).toBe(5);
  });
});
