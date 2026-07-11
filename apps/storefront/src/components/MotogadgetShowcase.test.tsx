// @vitest-environment jsdom
//
// MotogadgetShowcase smoke test — 品牌放量 N°01 + N°02(#212 方向3)。eyebrow=官方 logo(2026-07-10 rollout 補檔)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { MotogadgetShowcase } from './MotogadgetShowcase';

afterEach(cleanup);

describe('MotogadgetShowcase', () => {
  it('N°01:eyebrow logo + h2 + lead + 3 卡', () => {
    render(<MotogadgetShowcase />);
    expect(document.querySelector('#pd-h-mg01')).not.toBeNull();
    expect(screen.getByAltText('motogadget')).toBeDefined(); // eyebrow 官方 logo img
    expect(screen.getByRole('heading', { level: 2, name: '為什麼選 Motogadget' })).toBeDefined();
    expect(screen.getByText(/德國製造、專利逾百件/)).toBeDefined();
    expect(screen.getByText('德國工程、認證齊全')).toBeDefined();
    expect(screen.getByText('專利逾百件的原創設計')).toBeDefined();
    expect(screen.getByText('mo.unit 電控中樞')).toBeDefined();
    expect(document.querySelectorAll('.pd-feature-card').length).toBe(3);
  });

  it('N°02:信任狀四格 + 產品線五卡(中性 accent)', () => {
    render(<MotogadgetShowcase />);
    expect(screen.getByRole('heading', { level: 2, name: '把車頭改乾淨的德國答案' })).toBeDefined();
    expect(screen.getByText('2000')).toBeDefined();
    expect(screen.getByText('全球專利 IP')).toBeDefined();
    expect(document.querySelectorAll('.pd-bs-stat').length).toBe(4);
    expect(screen.getByText('mo.view Mirrors')).toBeDefined();
    expect(screen.getByText('Switches')).toBeDefined();
    expect(document.querySelectorAll('.pd-bs-mcard').length).toBe(5);
  });
});
