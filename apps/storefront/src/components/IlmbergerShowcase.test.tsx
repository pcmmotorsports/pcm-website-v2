// @vitest-environment jsdom
//
// IlmbergerShowcase smoke test — N°01 + N°02(2026-09-15;同日下午補圖)。形狀對照 WrsShowcase.test.tsx。

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { IlmbergerShowcase } from './IlmbergerShowcase';

afterEach(cleanup);

describe('IlmbergerShowcase', () => {
  it('N°01:eyebrow logo + h2 + lead + 3 卡', () => {
    render(<IlmbergerShowcase />);
    expect(document.querySelector('#pd-h-ilmb01')).not.toBeNull();
    expect(screen.getByAltText('Ilmberger Carbon')).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: '為什麼選 Ilmberger' })).toBeDefined();
    expect(screen.getByText(/1990 年成立公司/)).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '只用熱壓罐與預浸碳纖' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '道路件附德國 ABE' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '清漆底下多一層粉體塗層' })).toBeDefined();
    expect(document.querySelectorAll('.pd-feature-card').length).toBe(3);
  });

  it('N°02:橫幅 + 故事兩段 + 信任狀四格', () => {
    render(<IlmbergerShowcase />);
    expect(screen.getByRole('heading', { level: 2, name: 'BMW 與 Ducati 的原廠供應商' })).toBeDefined();
    expect(document.querySelector('img.pd-hero-band')).not.toBeNull();
    expect(screen.getByText('樹脂均勻、纖維含量高')).toBeDefined();
    expect(screen.getByText('機械手臂修邊')).toBeDefined();
    expect(document.querySelectorAll('.pd-bona-brow').length).toBe(2);
    expect(document.querySelectorAll('.pd-bs-stat').length).toBe(4);
  });

  it('🔴 信任狀四格逐格釘死字面(官網原文;改動 = 對外可見的事實變更)', () => {
    render(<IlmbergerShowcase />);
    expect(screen.getByText('eine eigene Firma gründete')).toBeDefined();
    expect(screen.getByText('ihren ersten Serienauftrag')).toBeDefined();
    expect(screen.getByText('Werksteams in der WSBK')).toBeDefined();
    expect(screen.getByText('ISO 9001 und ISO 14001 zertifiziert')).toBeDefined();
  });

  it('🛑 四格裡的年份【白名單】:只准 1990 / 2016 / 2023', () => {
    render(<IlmbergerShowcase />);
    const cells = [...document.querySelectorAll('.pd-bs-stat')].map((el) => el.textContent ?? '');
    expect(cells.length, '一格都沒抓到 ⇒ 尺沒接上').toBe(4);
    const years = [...new Set(cells.join(' | ').match(/\b(?:19|20)\d{2}\b/g) ?? [])];
    expect(years, '四格出現了白名單以外的年份').toEqual(['1990', '2016', '2023']);
  });

  // 🔴🔴 查證抓到的:公司在德國,而官網 /de/Produktion/Norm 逐字寫碳纖件在斯洛維尼亞與波士尼亞的自有工廠製造。
  //   🧬 突變:在任一段(含圖片 alt)加「德國製」或 "Made in Germany" ⇒ 這一格必須紅。
  it('🛑 不得宣稱德國製(產地是斯洛維尼亞與波士尼亞)', () => {
    const { container } = render(<IlmbergerShowcase />);
    const alts = [...container.querySelectorAll('img')].map((el) => el.getAttribute('alt') ?? '').join(' ');
    const text = `${container.textContent ?? ''} ${alts}`;
    expect(text).not.toMatch(/德國製|德國製造|德國生產|Made in Germany/i);
    // 🟢 正對照:產地那一句要在 ⇒ 否則「整段產地被刪掉」的世界裡上一行照樣綠
    expect(text).toContain('斯洛維尼亞與波士尼亞的工廠製造');
  });

  // 🔴 ABE 的射程:官網原文是【道路件】全系列、而且是【德國】的許可 ⇒ 不得講成「全部產品」或暗示台灣可上路。
  it('🛑 ABE 不得講寬:限道路件、限德國', () => {
    const { container } = render(<IlmbergerShowcase />);
    const text = container.textContent ?? '';
    expect(text).toContain('整個道路件系列都有 ABE');
    expect(text).toContain('在德國不必逐件送 TÜV');
    expect(text).not.toMatch(/(全部|所有)(產品|零件|碳纖件)[^。；]{0,8}ABE/);
    expect(text).not.toMatch(/台灣[^。；]{0,10}(合法|上路|驗車)/);
  });

  // 🔵 圖片集合釘死 + 檔案真的在(WRS 那支 M4 / N6 的形狀)。全部在 /brands/ilmberger/。
  it('🔵 圖片集合 = logo + 橫幅 + 故事兩張,都在 /brands/ilmberger/ 底下且磁碟上存在', () => {
    const { container } = render(<IlmbergerShowcase />);
    const srcs = [...container.querySelectorAll('img')].map((el) => el.getAttribute('src') ?? '');
    expect(srcs.sort()).toEqual([
      '/brands/ilmberger/hero-autoclave.jpg',
      '/brands/ilmberger/logo.png',
      '/brands/ilmberger/story-cutting.jpg',
      '/brands/ilmberger/story-trimming.jpg',
    ]);
    for (const src of srcs) {
      const disk = resolve(process.cwd(), `apps/storefront/public${src}`);
      expect(existsSync(disk), `${src} 在磁碟上不存在 ⇒ 線上會破圖`).toBe(true);
    }
  });
});
