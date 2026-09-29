// @vitest-environment jsdom
// components/SearchOverlayProducts.tsx —— 疊層商品列的價格(B2B 5d)。
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { SearchOverlayProducts } from './SearchOverlayProducts';

afterEach(cleanup);

const item = (over: object) => ({ slug: 'x', brand: 'B', name: 'N', price: 1000, image: null, ...over });

describe('SearchOverlayProducts 價格(B2B 5d)', () => {
  it('經銷會員取不到經銷價 ⇒ 印「價格暫時無法取得」;一般價缺 ⇒ 「—」;有價 ⇒ 金額', () => {
    const { container } = render(
      <SearchOverlayProducts
        items={[item({ price: null, dealerPriceMissing: true }), item({ slug: 'y', price: null }), item({ slug: 'z' })]}
        onNavigate={() => undefined}
      />,
    );
    expect([...container.querySelectorAll('.sop-price')].map((e) => e.textContent)).toEqual(['價格暫時無法取得', '—', 'NT$ 1,000']);
  });
});

describe('SearchOverlayProducts 適用車款那一行(2026-09-29 同名商品分不出來)', () => {
  it('有 fits ⇒ 品名下方印「適用 …」,文字與商品卡片相同', () => {
    const { container } = render(
      <SearchOverlayProducts
        items={[item({ fits: "Ducati Scrambler Sixty2 '16–'21" }), item({ slug: 'y', fits: '5 款車型' })]}
        onNavigate={() => undefined}
      />,
    );
    expect([...container.querySelectorAll('.sop-fits')].map((e) => e.textContent)).toEqual([
      "適用 Ducati Scrambler Sixty2 '16–'21",
      '適用 5 款車型',
    ]);
  });

  it('🔵 負對照:沒有 fits(舊快取或舊 API)⇒ 不印空的「適用 」', () => {
    const { container } = render(<SearchOverlayProducts items={[item({})]} onNavigate={() => undefined} />);
    expect(container.querySelector('.sop-fits')).toBeNull();
  });
});
