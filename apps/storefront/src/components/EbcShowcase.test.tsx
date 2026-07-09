// @vitest-environment jsdom
//
// EbcShowcase smoke test — 品牌放量精簡版 N°01 + 短 N°02(#212 方向3)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { EbcShowcase } from './EbcShowcase';

afterEach(cleanup);

describe('EbcShowcase', () => {
  it('N°01:eyebrow logo(官方 svg)+ h2 + lead + 3 卡', () => {
    render(<EbcShowcase />);
    expect(document.querySelector('#pd-h-ebc01')).not.toBeNull();
    expect(screen.getByAltText('EBC Brakes')).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: '為什麼選 EBC Brakes' })).toBeDefined();
    expect(screen.getByText(/止得住街道，也止得住賽道/)).toBeDefined();
    expect(screen.getByText('英美自有工廠、非貼牌')).toBeDefined();
    expect(screen.getByText('認證印在產品上')).toBeDefined();
    expect(screen.getByText('按騎法選系列')).toBeDefined();
    expect(document.querySelectorAll('.pd-feature-card').length).toBe(3);
  });

  it('短 N°02:信任狀四格 + 產品線雙卡', () => {
    render(<EbcShowcase />);
    expect(screen.getByRole('heading', { level: 2, name: '六十年只研究一件事——停下來' })).toBeDefined();
    expect(document.querySelector('.pd-bs.pd-bs--ebc')).not.toBeNull();
    expect(screen.getByText('1980s')).toBeDefined();
    expect(screen.getByText('品號規模')).toBeDefined();
    expect(document.querySelectorAll('.pd-bs-stat').length).toBe(4);
    expect(screen.getByText('Race Pads')).toBeDefined();
    expect(screen.getByText('Street Pads')).toBeDefined();
    expect(document.querySelectorAll('.pd-bs-mcard').length).toBe(2);
  });
});
