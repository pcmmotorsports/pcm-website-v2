// @vitest-environment jsdom
// assertNoDealerLeak 的正負對照(主視窗 2026-09-25:排除頁尾只限「經銷」兩個字, 價格欄位與金額頁尾也不例外)。
import { describe, expect, it } from 'vitest';
import { assertNoDealerLeak } from './dealer-leak';

function page(main: string, footer: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = `<main>${main}</main><footer class="ed-footer">${footer}</footer>`;
  return el;
}

describe('經銷零洩漏檢查', () => {
  it('頁尾的「經銷商申請」入口不算外洩', () => {
    expect(() => assertNoDealerLeak(page('NT$ 15,200', '<a href="/dealer-apply">經銷商申請</a>'))).not.toThrow();
  });
  it('🔴 頁尾以外出現「經銷」⇒ 紅', () => {
    expect(() => assertNoDealerLeak(page('經銷價 NT$ 13,680', ''))).toThrow(/頁尾以外出現「經銷」/);
  });
  it('🔴 負對照:price_store / priceByTier 放在頁尾 ⇒ 照樣紅', () => {
    expect(() => assertNoDealerLeak(page('', 'price_store'))).toThrow(/price_store/);
    expect(() => assertNoDealerLeak(page('', 'priceByTier'))).toThrow(/priceByTier/);
  });
  it('🔴 負對照:經銷價金額放在頁尾 ⇒ 照樣紅', () => {
    expect(() => assertNoDealerLeak(page('NT$ 15,200', 'NT$ 13,680'), ['NT$ 13,680'])).toThrow(/NT\$ 13,680/);
  });
  it('🔴 劃線價在頁尾也算', () => {
    expect(() => assertNoDealerLeak(page('', '<s>NT$ 16,000</s>'))).toThrow(/劃線價/);
  });
  it('🔴 頁面裡別的 <footer> 區塊(不是全站頁尾)出現「經銷」⇒ 照樣紅', () => {
    const el = document.createElement('div');
    el.innerHTML = '<main><footer class="cart-sum">經銷價小計</footer></main><footer class="ed-footer">經銷商申請</footer>';
    expect(() => assertNoDealerLeak(el)).toThrow(/頁尾以外出現「經銷」/);
  });
});
