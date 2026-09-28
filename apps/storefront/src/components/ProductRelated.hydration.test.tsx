// @vitest-environment jsdom
/**
 * 推薦區改成串流之後(計畫-商品頁推薦查詢逾時 §4 甲),它比 ProductPage 晚 hydrate。
 * 那時車款意圖多半已經接手 ⇒ 若 hydrate 當下就讀意圖, 卡片連結與伺服器 HTML 不同, React 只警告不修正。
 * 這支釘兩件事:hydrate 不報不一致;hydrate 完連結會換成意圖那台車。
 */
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOCK_PRODUCTS } from '@/data/mock-products';
import { CartProvider } from '@/contexts/CartContext';
import { PdpVehicleIntentContext, ProductRelated } from './ProductRelated';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('推薦區晚 hydrate', () => {
  it('🔴 伺服器沒有車、意圖已經是一台車 ⇒ hydrate 不報不一致, 之後卡片連結帶那台車', async () => {
    const related = MOCK_PRODUCTS.slice(1, 3);
    const tree = (intent: Parameters<typeof PdpVehicleIntentContext.Provider>[0]['value']) => (
      <CartProvider>
        <PdpVehicleIntentContext.Provider value={intent}>
          <ProductRelated related={related} hasMore moreHref="/products?brand=x" hasVehicle={false} />
        </PdpVehicleIntentContext.Provider>
      </CartProvider>
    );
    const container = document.createElement('div');
    container.innerHTML = renderToString(tree(null));
    document.body.appendChild(container);

    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const recoverable = vi.fn();
    await act(async () => {
      hydrateRoot(container, tree({ kind: 'vehicle', segment: 'yamaha:yzf-r7', brandName: 'Yamaha', modelName: 'YZF-R7' }), {
        onRecoverableError: recoverable,
      });
    });
    const mismatch = errors.mock.calls.filter((c) => String(c[0]).includes('hydrat'));
    errors.mockRestore();
    expect(mismatch, 'hydrate 報了不一致').toEqual([]);
    expect(recoverable).not.toHaveBeenCalled();

    const card = container.querySelector('.pd-related-grid a')!;
    expect(card.getAttribute('href')).toContain('vehicle=yamaha%3Ayzf-r7');
    expect(container.querySelector('.pd-related-more-link')!.getAttribute('href')).toBe('/products?vehicle=yamaha%3Ayzf-r7');
  });
});
