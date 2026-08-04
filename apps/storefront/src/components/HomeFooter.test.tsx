// @vitest-environment jsdom
//
// HomeFooter smoke test — WO-3 工作流優化、前台 regression 安全網。
// 驗「render 不報錯」(純展示 server component、無互動)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { HomeFooter } from './HomeFooter';

afterEach(cleanup);

describe('HomeFooter', () => {
  it('should render the footer without crashing', () => {
    render(<HomeFooter />);
    expect(screen.getByText('PCM MOTORSPORTS')).toBeDefined();
    expect(screen.getByText('商品目錄')).toBeDefined();
  });

  it('should render real contact phone and tax id from site-config (A4、非佔位假值)', () => {
    render(<HomeFooter />);
    // 真值來自 lib/site-config SSoT(Sean 2026-06-21 提供);防回歸 design 佔位 02-2998-xxxx / xxxxxxxx
    expect(screen.getByText('0930-531-867')).toBeDefined();
    expect(screen.getByText('統編 · 90003020')).toBeDefined();
    expect(screen.queryByText(/2998/)).toBeNull();
    expect(screen.queryByText(/xxxxxxxx/)).toBeNull();
  });

  it('should render live social links from site-config (Q2=A、#136 supersede)', () => {
    render(<HomeFooter />);
    // 三顆社群 = 真連結 <a>(新分頁 + noopener 防 tabnabbing);三顆同構逐一驗
    const expected: Array<[string, string | RegExp]> = [
      ['Facebook', 'https://www.facebook.com/partscheaper'],
      ['Instagram', 'https://www.instagram.com/pcm_officialtw/'],
      ['LINE', /^https:\/\//], // LINE_ADD_URL 走 line-cta SSoT、驗協定不重複寫死短網址
    ];
    for (const [label, href] of expected) {
      const a = screen.getByText(label).closest('a')!;
      if (typeof href === 'string') expect(a.getAttribute('href')).toBe(href);
      else expect(a.getAttribute('href')).toMatch(href);
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toContain('noopener');
    }
    // 聯絡客服仍 disabled(拍板範圍外)
    expect(screen.getByLabelText('聯絡客服(尚未上線)')).toBeDefined();
  });

  // 🔴 D3a 加了 optional `tagline`(品牌頁的頁尾標語每家不同,設計稿
  //    `pcm-home-redesign/brand-page.html:1510-1512` 註解 + `:2029` 灌值)。這兩條是成對的:
  //    只留下面那條的話,有人把預設值刪掉、讓首頁頁尾標語變空也會全綠。
  it('🔴 不給 tagline 時,首頁那句預設標語字面完全不變', () => {
    const { container } = render(<HomeFooter />);
    const p = container.querySelector('.ed-footer-tagline')!;
    expect(p.textContent).toContain('改裝不只是升級配件,');
    expect(p.textContent).toContain('是風格與態度的延伸。');
    // 換行是設計字面的一部分(兩句分兩行),不是可有可無的空白
    expect(p.querySelectorAll('br')).toHaveLength(1);
  });

  it('🔴 給 tagline 時取代預設值(不是疊加 —— 疊加會變成兩句話同時出現)', () => {
    const { container } = render(<HomeFooter tagline={<>先把金屬做好。</>} />);
    const p = container.querySelector('.ed-footer-tagline')!;
    expect(p.textContent).toBe('先把金屬做好。');
    expect(p.textContent).not.toContain('改裝不只是升級配件');
  });
});
