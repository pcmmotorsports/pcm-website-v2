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
