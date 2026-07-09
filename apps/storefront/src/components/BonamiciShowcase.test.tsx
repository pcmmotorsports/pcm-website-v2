// @vitest-environment jsdom
//
// BonamiciShowcase smoke test — Bonamici 品牌形象區 N°01 + N°02(#270 B S5)。
// 驗 N°01 eyebrow(01 + Bonamici)/ h2 / lead / 3 卡(重用 pd-feature 骨架)+ N°02 產線巡禮
//   (影片佔位 + 研發/職人兩段 + 8 色陽極 + 20 年徽章)字面渲染。文案真權威 = 07-08 壓縮版 Artifact(9368fc24)。
// 純 presentational、無 hooks / interactive(不需 provider wrapper)。非 coverage 達標(前台 smoke 慣例)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { BonamiciShowcase } from './BonamiciShowcase';

afterEach(cleanup);

describe('BonamiciShowcase', () => {
  it('N°01:巢狀 eyebrow(01 + Bonamici label)+ h2 + lead + 3 卡', () => {
    render(<BonamiciShowcase />);
    expect(document.querySelector('#pd-h-bona01')).not.toBeNull();
    expect(screen.getByAltText('Bonamici Racing')).toBeDefined(); // eyebrow logo img(S6、pd-eb-logo)
    expect(screen.getByRole('heading', { level: 2, name: '為什麼選 Bonamici' })).toBeDefined();
    expect(screen.getByText(/義大利薩賓丘陵的家族工坊/)).toBeDefined();
    expect(screen.getByText('義大利家族工坊，三代傳承')).toBeDefined();
    expect(screen.getByText('航太級鋁合金 × F1 等級研發')).toBeDefined();
    expect(screen.getByText('WorldSBK 冠軍血統實戰驗證')).toBeDefined();
    expect(document.querySelectorAll('.pd-feature-card').length).toBe(3);
  });

  it('N°02:產線巡禮 h2 + 影片 facade + 研發/職人兩段 + 8 色陽極 + 徽章', () => {
    render(<BonamiciShowcase />);
    expect(screen.getByRole('heading', { level: 2, name: '從一塊鋁，到一件賽車部品' })).toBeDefined();
    expect(document.querySelector('.pd-bona-video')).not.toBeNull(); // 品牌影片區
    expect(screen.getByRole('button', { name: '播放 Bonamici Racing 品牌形象影片' })).toBeDefined(); // S6 影片 facade(點擊才載 iframe)
    // 研發/職人兩段(英文步驟標唯一字串)
    expect(screen.getByText('01 — Research & Development')).toBeDefined();
    expect(screen.getByText('02 — Craftsmanship')).toBeDefined();
    expect(document.querySelectorAll('.pd-bona-brow').length).toBe(2);
    // 8 色陽極
    expect(document.querySelectorAll('.pd-bona-sw-item').length).toBe(8);
    expect(screen.getByText('可選陽極色')).toBeDefined();
    // 20 年徽章 4 格
    expect(document.querySelectorAll('.pd-bona-badge').length).toBe(4);
    expect(screen.getByText('精工淬鍊')).toBeDefined();
  });
});
