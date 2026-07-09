// @vitest-environment jsdom
//
// Front3dShowcase smoke test — 品牌放量精簡版 N°01 + 短 N°02(#212 方向3)。含賽道用途免責 note。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { Front3dShowcase } from './Front3dShowcase';

afterEach(cleanup);

describe('Front3dShowcase', () => {
  it('N°01:eyebrow 文字 lockup + h2 + lead + 3 卡', () => {
    render(<Front3dShowcase />);
    expect(document.querySelector('#pd-h-f3d01')).not.toBeNull();
    const lockup = document.querySelector('.pd-eb-lockup');
    expect(lockup?.textContent).toBe('Front3D'); // 無 logo 檔 → 文字 lockup(補圖清單)
    expect(screen.getByRole('heading', { level: 2, name: '為什麼選 Front3D' })).toBeDefined();
    expect(screen.getByText(/賽道日外觀一次到位/)).toBeDefined();
    expect(screen.getByText('3D 列印一體成形')).toBeDefined();
    expect(screen.getByText('原廠螺絲直上、免鑽孔')).toBeDefined();
    expect(screen.getByText('賽道取向、誠實定位')).toBeDefined();
    expect(document.querySelectorAll('.pd-feature-card').length).toBe(3);
  });

  it('短 N°02:信任狀三格(cols-3)+ 產品線三卡 + 官方用途免責 note', () => {
    render(<Front3dShowcase />);
    expect(screen.getByRole('heading', { level: 2, name: '給街車的賽道空力語彙' })).toBeDefined();
    expect(document.querySelector('.pd-bs-stats.cols-3')).not.toBeNull();
    expect(document.querySelectorAll('.pd-bs-stat').length).toBe(3);
    expect(screen.getByText('適配車廠')).toBeDefined();
    expect(screen.getByText('Side Wings')).toBeDefined();
    expect(screen.getByText('Brake Coolers')).toBeDefined();
    expect(document.querySelectorAll('.pd-bs-mcard').length).toBe(3);
    // 免責 note 必在(front3d.com/pages/about 官方聲明轉譯、誠實揭露)
    expect(screen.getByText(/未經道路使用認證/)).toBeDefined();
  });
});
