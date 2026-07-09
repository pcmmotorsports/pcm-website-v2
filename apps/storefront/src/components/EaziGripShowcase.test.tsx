// @vitest-environment jsdom
//
// EaziGripShowcase smoke test — 品牌放量 N°01 + N°02(#212 方向3)。eyebrow=文字 lockup(無 logo 檔)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { EaziGripShowcase } from './EaziGripShowcase';

afterEach(cleanup);

describe('EaziGripShowcase', () => {
  it('N°01:eyebrow 文字 lockup + h2 + lead + 3 卡', () => {
    render(<EaziGripShowcase />);
    expect(document.querySelector('#pd-h-eazi01')).not.toBeNull();
    const lockup = document.querySelector('.pd-eb-lockup');
    expect(lockup?.textContent).toBe('Eazi-Grip'); // 無 logo 檔 → 文字 lockup(補圖清單)
    expect(screen.getByRole('heading', { level: 2, name: '為什麼選 Eazi-Grip' })).toBeDefined();
    expect(screen.getByText(/WSBK 世界冠軍車手同款的夾持感/)).toBeDefined();
    expect(screen.getByText('車型專屬裁型、不用自己剪')).toBeDefined();
    expect(screen.getByText('三系列材質、按騎法選')).toBeDefined();
    expect(screen.getByText('頂級賽事車隊採用')).toBeDefined();
    expect(document.querySelectorAll('.pd-feature-card').length).toBe(3);
  });

  it('N°02:信任狀四格 + 產品線三卡(中性 accent、無品牌 modifier)', () => {
    render(<EaziGripShowcase />);
    expect(screen.getByRole('heading', { level: 2, name: '貼上去，過彎重煞都咬得住' })).toBeDefined();
    expect(screen.getByText('2011')).toBeDefined();
    expect(screen.getByText('Evo 系列問世')).toBeDefined();
    expect(document.querySelectorAll('.pd-bs-stat').length).toBe(4);
    expect(screen.getByText('Tank Grips')).toBeDefined();
    expect(screen.getByText('Dash Protection')).toBeDefined();
    expect(document.querySelectorAll('.pd-bs-mcard').length).toBe(3);
  });
});
