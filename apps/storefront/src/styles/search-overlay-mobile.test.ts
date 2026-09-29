// 2026-09-29 正式站手機 390 走查抓到的兩件搜尋疊層問題(~/pcm-mailbox/正式站手機購物走查-20260929.md)。
// 🔵 這兩格讀的是 CSS 字面;畫面上的效果另有前後截圖(同一份走查的資料夾), 這裡守的是「規則還在」。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, 'search-overlay-mobile.css'), 'utf8');
/** 取出某個選擇器第一個規則塊的內容。 */
function ruleBody(selector: string): string {
  const i = css.indexOf(`${selector} {`);
  if (i < 0) return '';
  return css.slice(i, css.indexOf('}', i));
}

describe('搜尋疊層在手機上', () => {
  it('🔴 商品那一列收在格子寬度內(min-width:0), 長品名才會變成「…」而不是超出螢幕', () => {
    expect(ruleBody('.search-overlay-product')).toMatch(/min-width:\s*0/);
  });

  it('🔴 瀏覽器自帶的搜尋框 × 要收掉(我們已經有一顆「清除」)', () => {
    expect(css).toMatch(/\.search-overlay-input::-webkit-search-cancel-button\s*\{[^}]*display:\s*none/);
  });
});
