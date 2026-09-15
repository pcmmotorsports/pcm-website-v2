// @vitest-environment jsdom
//
// OhlinsShowcase smoke test — N°01 + N°02(2026-09-15;同日下午補圖)。形狀對照 WrsShowcase.test.tsx。

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { OhlinsShowcase } from './OhlinsShowcase';

afterEach(cleanup);

describe('OhlinsShowcase', () => {
  it('N°01:eyebrow logo + h2 + lead + 3 卡', () => {
    render(<OhlinsShowcase />);
    expect(document.querySelector('#pd-h-ohlins01')).not.toBeNull();
    expect(screen.getByAltText('Öhlins')).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: '為什麼選 Öhlins' })).toBeDefined();
    expect(screen.getByText(/1976 年由 Kenth Öhlin 在瑞典創立/)).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '從賽道起家' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '從 MotoGP 到一級方程式' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '避震器、前叉、轉向阻尼' })).toBeDefined();
    expect(document.querySelectorAll('.pd-feature-card').length).toBe(3);
  });

  it('N°02:橫幅 + TTX / NIX 兩段 + 信任狀四格', () => {
    render(<OhlinsShowcase />);
    expect(screen.getByRole('heading', { level: 2, name: '半世紀的瑞典避震' })).toBeDefined();
    expect(document.querySelector('img.pd-hero-band')).not.toBeNull();
    expect(screen.getByText('雙筒設計，油壓不掉')).toBeDefined();
    expect(screen.getByText('壓縮與回彈，分腳調')).toBeDefined();
    expect(document.querySelectorAll('.pd-bona-brow').length).toBe(2);
    expect(document.querySelectorAll('.pd-bs-stat').length).toBe(4);
  });

  it('🔴 信任狀四格逐格釘死字面(官網原文;改動 = 對外可見的事實變更)', () => {
    render(<OhlinsShowcase />);
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

  // 🔵 圖片集合釘死 + 檔案真的在(WRS 那支 M4 / N6 的形狀)。全部在 /brands/ohlins/。
  it('🔵 圖片集合 = logo + 橫幅 + 故事兩張,都在 /brands/ohlins/ 底下且磁碟上存在', () => {
    const { container } = render(<OhlinsShowcase />);
    const srcs = [...container.querySelectorAll('img')].map((el) => el.getAttribute('src') ?? '');
    expect(srcs.sort()).toEqual([
      '/brands/ohlins/hero-damper.jpg',
      '/brands/ohlins/logo.png',
      '/brands/ohlins/story-nix.jpg',
      '/brands/ohlins/story-ttx.jpg',
    ]);
    for (const src of srcs) {
      const disk = resolve(process.cwd(), `apps/storefront/public${src}`);
      expect(existsSync(disk), `${src} 在磁碟上不存在 ⇒ 線上會破圖`).toBe(true);
    }
  });
});
