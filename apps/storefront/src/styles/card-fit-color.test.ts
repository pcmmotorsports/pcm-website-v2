// 卡片「適用您的車」要跟商品頁「適用您的車」同一個綠(Sean 2026-09-29 批准上線時加的;主視窗轉達)。
// 🔵 守的是「兩邊吃同一個 token」, 不是色碼本身 —— 哪天調綠, 兩邊一起變。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = (f: string) => readFileSync(resolve(__dirname, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('卡片與商品頁的「適用」綠色是同一個 token', () => {
  it('tokens.css 定義 --c-fit-match(值 = 商品頁原本那個綠 #16a34a)', () => {
    expect(css('tokens.css')).toMatch(/--c-fit-match:\s*#16a34a\s*;/);
  });

  it('商品頁的適用框改吃 token, 不再寫死色碼', () => {
    const pp = css('product-page.css');
    expect(pp).toMatch(/\.pfc-match\s*\{[^}]*border-color:\s*var\(--c-fit-match\)/);
    expect(pp).toMatch(/\.pfc-match \.pfc-badge\s*\{[^}]*background:\s*var\(--c-fit-match\)/);
  });

  it('卡片標了適用那一行(.pcard-fits.is-fit)吃同一個 token', () => {
    expect(css('product-card.css')).toMatch(/\.pcard-fits\.is-fit\s*\{[^}]*color:\s*var\(--c-fit-match\)/);
  });
});
