// @vitest-environment jsdom
//
// GbRacingShowcase smoke test — 商品詳細頁 GB Racing 品牌形象區 N°01 + N°02(#270 B S4)。
// 驗 N°01 eyebrow(01 + GB Racing)/ h2 / lead / 3 卡(重用 pd-feature 骨架)+ N°02 工程血統
//   (信任狀四格 + 產品線水平捲四卡)字面渲染。文案真權威 = 07-08 壓縮版 Artifact(9368fc24)。
// 純 presentational、無 hooks / interactive(不需 provider wrapper)。非 coverage 達標(前台 smoke 慣例)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { GbRacingShowcase } from './GbRacingShowcase';

afterEach(cleanup);

describe('GbRacingShowcase', () => {
  it('N°01:巢狀 eyebrow(01 + GB Racing label)+ h2 + lead + 3 卡', () => {
    render(<GbRacingShowcase />);
    // eyebrow:義體數字 01 + 真 GB logo 圖(S6、pd-eb-logo img、Sean D5=B)
    expect(document.querySelector('#pd-h-gb01')).not.toBeNull();
    expect(screen.getByAltText('GB Racing')).toBeDefined(); // eyebrow logo img
    expect(screen.getByRole('heading', { level: 2, name: '為什麼選 GB Racing' })).toBeDefined();
    // lead 精簡兩行(Sean 2026-07-09 二次拍板)——取 lead 專有片語(不與卡片/信任狀重複)
    expect(screen.getByText(/帶回你的日常騎乘/)).toBeDefined();
    // 3 卡 title(逐字搬草稿)
    expect(screen.getByText('FIM 認證、賽道實證')).toBeDefined();
    expect(screen.getByText('專利複合材質、潰縮式防護')).toBeDefined();
    expect(screen.getByText('英國製造、全車系覆蓋')).toBeDefined();
    expect(document.querySelectorAll('.pd-feature-card').length).toBe(3);
  });

  it('N°02:工程血統 h2 + 冠軍橫幅圖 + 信任狀四格 + 產品線四卡', () => {
    render(<GbRacingShowcase />);
    expect(screen.getByText('工程血統')).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: 'FIM 唯一認證的引擎防護' })).toBeDefined();
    expect(screen.getByAltText('GB Racing 冠軍認證橫幅')).toBeDefined(); // S6 真 hero 圖
    // 信任狀四格:數字(2007/2009 唯一)+ label
    expect(screen.getByText('2007')).toBeDefined();
    expect(screen.getByText('2009')).toBeDefined();
    expect(screen.getByText('品牌創立')).toBeDefined();
    expect(screen.getByText('支援車型')).toBeDefined();
    expect(document.querySelectorAll('.pd-gb-stat').length).toBe(4);
    // 產品線四卡(用英文標唯一字串、避免與圖框 label + 卡標題重複)
    expect(screen.getByText('Engine Covers')).toBeDefined();
    expect(screen.getByText('Frame Sliders')).toBeDefined();
    expect(screen.getByText('Lever Guards')).toBeDefined();
    expect(screen.getByText('Axle Sliders')).toBeDefined();
    expect(document.querySelectorAll('.pd-gb-mcard').length).toBe(4);
  });
});
