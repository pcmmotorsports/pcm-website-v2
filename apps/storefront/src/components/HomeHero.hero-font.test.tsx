// @vitest-environment jsdom
//
// 首頁大標的中文字型（Noto Sans TC 700）只在首頁宣告。
// 計畫：~/pcm-mailbox/計畫-CSS拆分-20260928.md §三（主視窗 2026-09-28 依 Sean「優化全排」定案 Q2 甲）。
// next/font 的 @font-face CSS 跟著「呼叫它的那個模組」走：寫在根 layout ⇒ 每一頁都下載那份 35 KB 的宣告 CSS；
// 寫在 HomeHero ⇒ 只有首頁。所以這支釘兩件事：layout 不再呼叫它、HomeHero 把變數掛在大標的祖先上。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

vi.mock('next/font/google', () => ({
  Noto_Sans_TC: () => ({ className: '', variable: 'hero-cjk-var', style: { fontFamily: '' } }),
}));

import { HomeHero } from './HomeHero';

afterEach(cleanup);

describe('首頁大標中文字型只在首頁宣告', () => {
  it('根 layout 不呼叫 Noto_Sans_TC（搬回去 ⇒ 每一頁又多 35 KB 擋畫面的 CSS）', () => {
    const layout = readFileSync(resolve(__dirname, '../app/layout.tsx'), 'utf8');
    const code = layout
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/Noto_Sans_TC/);
  });

  it('HomeHero 最外層 section 帶字型變數（大標 .b-hero-title--cjk 讀 var(--font-hero-cjk) 靠它）', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const { container } = render(<HomeHero />);
    const section = container.querySelector('section#vehicle-finder');
    expect(section?.classList.contains('hero-cjk-var')).toBe(true);
    vi.unstubAllGlobals();
  });
});
