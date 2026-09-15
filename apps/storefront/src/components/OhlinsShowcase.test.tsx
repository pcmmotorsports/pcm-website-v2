// @vitest-environment jsdom
//
// OhlinsShowcase smoke test — N°01 + N°02 文字版(2026-09-15)。形狀對照 WrsShowcase.test.tsx。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { OhlinsShowcase } from './OhlinsShowcase';

afterEach(cleanup);

describe('OhlinsShowcase', () => {
  it('N°01:文字 eyebrow + h2 + lead + 3 卡', () => {
    render(<OhlinsShowcase />);
    expect(document.querySelector('#pd-h-ohlins01')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: '為什麼選 Öhlins' })).toBeDefined();
    expect(screen.getByText(/1976 年由 Kenth Öhlin 在瑞典創立/)).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '從賽道起家' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '從 MotoGP 到一級方程式' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '避震器、前叉、轉向阻尼' })).toBeDefined();
    expect(document.querySelectorAll('.pd-feature-card').length).toBe(3);
  });

  it('🔴 信任狀四格逐格釘死字面(官網原文;改動 = 對外可見的事實變更)', () => {
    render(<OhlinsShowcase />);
    expect(screen.getByRole('heading', { level: 2, name: '半世紀的瑞典避震' })).toBeDefined();
    expect(document.querySelectorAll('.pd-bs-stat').length).toBe(4);
    expect(screen.getByText('Founded by Kenth Öhlin in 1976')).toBeDefined();
    expect(screen.getByText('400+ racing titles')).toBeDefined();
    expect(screen.getByText('400,000+ produced annually')).toBeDefined();
    expect(screen.getByText('3 production facilities')).toBeDefined();
  });

  it('🛑 四格裡的年份【白名單】:只准 1976', () => {
    render(<OhlinsShowcase />);
    const cells = [...document.querySelectorAll('.pd-bs-stat')].map((el) => el.textContent ?? '');
    expect(cells.length, '一格都沒抓到 ⇒ 尺沒接上').toBe(4);
    const years = [...new Set(cells.join(' | ').match(/\b(?:19|20)\d{2}\b/g) ?? [])];
    expect(years, '四格出現了白名單以外的年份').toEqual(['1976']);
  });

  // 🔴 官網首頁寫的是「400+ racing titles」(賽事冠軍);history 頁另有「world championship titles」300+(2013)
  //   ⇒ 兩個不同的量。🧬 突變:把「賽事冠軍」改成「世界冠軍」⇒ 這一格必須紅。
  it('🛑 400+ 不得講成「世界冠軍」', () => {
    const { container } = render(<OhlinsShowcase />);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/400[^。；]{0,6}世界冠軍|世界冠軍[^。；]{0,6}400/);
    expect(text).toContain('賽事冠軍');
  });

  it('🔵 文字版:不渲染任何 <img>', () => {
    const { container } = render(<OhlinsShowcase />);
    expect(container.querySelectorAll('img').length).toBe(0);
  });
});
