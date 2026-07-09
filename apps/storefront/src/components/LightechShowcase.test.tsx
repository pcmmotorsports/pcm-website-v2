// @vitest-environment jsdom
//
// LightechShowcase smoke test — 品牌放量 N°01 + N°02(#212 方向3)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { LightechShowcase } from './LightechShowcase';

afterEach(cleanup);

describe('LightechShowcase', () => {
  it('N°01:eyebrow logo + h2 + lead + 3 卡', () => {
    render(<LightechShowcase />);
    expect(document.querySelector('#pd-h-lt01')).not.toBeNull();
    expect(screen.getByAltText('LighTech')).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: '為什麼選 LighTech' })).toBeDefined();
    expect(screen.getByText(/做進每一顆腳踏與拉桿/)).toBeDefined();
    expect(screen.getByText('車手創辦、賽場出身')).toBeDefined();
    expect(screen.getByText('義大利自家產線、不外包')).toBeDefined();
    expect(screen.getByText('品牌．車型．年式 三層對照')).toBeDefined();
    expect(document.querySelectorAll('.pd-feature-card').length).toBe(3);
  });

  it('N°02:信任狀四格 + 產品線四卡', () => {
    render(<LightechShowcase />);
    expect(screen.getByRole('heading', { level: 2, name: '從世界賽場做回街車的精品' })).toBeDefined();
    expect(document.querySelector('.pd-bs.pd-bs--lightech')).not.toBeNull();
    expect(screen.getByText('1997')).toBeDefined();
    expect(screen.getByText('2026')).toBeDefined();
    expect(document.querySelectorAll('.pd-bs-stat').length).toBe(4);
    expect(screen.getByText('Mirror Adapters')).toBeDefined();
    expect(screen.getByText('Carbon Parts')).toBeDefined();
    expect(document.querySelectorAll('.pd-bs-mcard').length).toBe(4);
  });
});
