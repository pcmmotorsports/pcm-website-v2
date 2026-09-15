// @vitest-environment jsdom
//
// ArrowShowcase smoke test — N°01 + N°02 文字版(2026-09-15)。形狀對照 WrsShowcase.test.tsx。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ArrowShowcase } from './ArrowShowcase';

afterEach(cleanup);

describe('ArrowShowcase', () => {
  it('N°01:文字 eyebrow + h2 + lead + 3 卡', () => {
    render(<ArrowShowcase />);
    expect(document.querySelector('#pd-h-arrow01')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: '為什麼選 ARROW' })).toBeDefined();
    expect(screen.getByText(/1985 年由越野賽車手 Giorgio Giannelli 在義大利創立/)).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '從越野賽道起家' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '原型直接在車上做' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '車廠也找它合作' })).toBeDefined();
    expect(document.querySelectorAll('.pd-feature-card').length).toBe(3);
  });

  it('🔴 信任狀四格逐格釘死字面(官網原文;改動 = 對外可見的事實變更)', () => {
    render(<ArrowShowcase />);
    expect(screen.getByRole('heading', { level: 2, name: '設計到生產，都在 San Giustino' })).toBeDefined();
    expect(document.querySelectorAll('.pd-bs-stat').length).toBe(4);
    expect(screen.getByText('1985')).toBeDefined();
    expect(screen.getByText('inizia la sua attività nel 1985')).toBeDefined();
    expect(screen.getByText('oltre 40 titoli mondiali')).toBeDefined();
    expect(screen.getByText('presenti in oltre 60 paesi')).toBeDefined();
    expect(screen.getByText('eseguite completamente in Italia')).toBeDefined();
  });

  // 🛑 年份白名單:四格只准 1985。逐格取再接(WRS 那支記過:整段 textContent 連起來 `\b` 會靜靜不匹配)。
  it('🛑 四格裡的年份【白名單】:只准 1985', () => {
    render(<ArrowShowcase />);
    const cells = [...document.querySelectorAll('.pd-bs-stat')].map((el) => el.textContent ?? '');
    expect(cells.length, '一格都沒抓到 ⇒ 尺沒接上').toBe(4);
    const years = [...new Set(cells.join(' | ').match(/\b(?:19|20)\d{2}\b/g) ?? [])];
    expect(years, '四格出現了白名單以外的年份 ⇒ 有人搬了一個沒有來源的數字進來').toEqual(['1985']);
  });

  // 🔴 官網 R&D 原文是「La maggior parte ... omologata」= 【大部分】有認證版 ⇒ 不得寫成「全部 / 全系列」。
  it('🛑 認證那句不得講寬:不得出現「全部 / 全系列」認證', () => {
    const { container } = render(<ArrowShowcase />);
    const text = container.textContent ?? '';
    expect(text).toContain('多數排氣系統另有道路合法的認證版本');
    expect(text).not.toMatch(/(全部|全系列|所有)[^。；]{0,12}認證/);
  });

  // 🔵 文字版:沒有任何圖(素材授權未確認)。有人加圖回來時要一起補授權紀錄與這一格。
  it('🔵 文字版:不渲染任何 <img>', () => {
    const { container } = render(<ArrowShowcase />);
    expect(container.querySelectorAll('img').length).toBe(0);
  });
});
