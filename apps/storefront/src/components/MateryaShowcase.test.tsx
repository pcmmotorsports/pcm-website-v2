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
    expect(screen.getByText('四種製程並用')).toBeDefined();
    expect(screen.getByText('專車專用、小廠溫度')).toBeDefined();
    expect(document.querySelectorAll('.pd-feature-card').length).toBe(3);
  });

  it('短 N°02:信任狀三格(cols-3)+ 產品線三卡', () => {
    render(<MateryaShowcase />);
    expect(screen.getByRole('heading', { level: 2, name: '車頭細節的義式收尾' })).toBeDefined();
    expect(document.querySelector('.pd-bs-stats.cols-3')).not.toBeNull();
    expect(screen.getByText('Milano')).toBeDefined();
    expect(document.querySelectorAll('.pd-bs-stat').length).toBe(3);
    expect(screen.getByText('Carbon Dash')).toBeDefined();
    expect(document.querySelectorAll('.pd-bs-mcard').length).toBe(3);
  });

  // 🔴 釘 Sean 2026-09-16 拍板 C(b7 轉述):賽道牌照板不出現在本站任何地方。
  //    理由不是官網不賣,官網自己的頁尾還在寫 `Track Days Plate` —— 是**我們上架的 64 件裡 0 件**,
  //    寫了客人點進來撲空。那張卡已換成 Flyscreen(風鏡與定風翼 32 件,我們的最大宗)。
  it('產品線不出現賽道牌照板(Sean 0916 拍板 C:我們 0 件在庫)', () => {
    render(<MateryaShowcase />);
    expect(screen.queryByText('Track Days Plate')).toBeNull();
    expect(screen.getByText('Flyscreen')).toBeDefined();
  });

  // 🔴 釘 Sean 2026-09-16 拍板 B:評論相關(則數 / 星等 / 誰回覆)一律不寫,數字會變、要人維護。
  it('不出現官網評論的說法(Sean 0916 拍板 B)', () => {
    const { container } = render(<MateryaShowcase />);
    expect(container.textContent).not.toContain('評論');
  });
});
