// @vitest-environment jsdom
//
// IlmbergerShowcase smoke test — N°01 + N°02 文字版(2026-09-15)。形狀對照 WrsShowcase.test.tsx。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { IlmbergerShowcase } from './IlmbergerShowcase';

afterEach(cleanup);

describe('IlmbergerShowcase', () => {
  it('N°01:文字 eyebrow + h2 + lead + 3 卡', () => {
    render(<IlmbergerShowcase />);
    expect(document.querySelector('#pd-h-ilmb01')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: '為什麼選 Ilmberger' })).toBeDefined();
    expect(screen.getByText(/1990 年成立公司/)).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '只用熱壓罐與預浸碳纖' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '道路件附德國 ABE' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '清漆底下多一層粉體塗層' })).toBeDefined();
    expect(document.querySelectorAll('.pd-feature-card').length).toBe(3);
  });

  it('🔴 信任狀四格逐格釘死字面(官網原文;改動 = 對外可見的事實變更)', () => {
    render(<IlmbergerShowcase />);
    expect(screen.getByRole('heading', { level: 2, name: 'BMW 與 Ducati 的原廠供應商' })).toBeDefined();
    expect(document.querySelectorAll('.pd-bs-stat').length).toBe(4);
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
  //   🧬 突變:在任一段加「德國製」或 "Made in Germany" ⇒ 這一格必須紅。
  it('🛑 不得宣稱德國製(產地是斯洛維尼亞與波士尼亞)', () => {
    const { container } = render(<IlmbergerShowcase />);
    const text = container.textContent ?? '';
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

  it('🔵 文字版:不渲染任何 <img>', () => {
    const { container } = render(<IlmbergerShowcase />);
    expect(container.querySelectorAll('img').length).toBe(0);
  });
});
