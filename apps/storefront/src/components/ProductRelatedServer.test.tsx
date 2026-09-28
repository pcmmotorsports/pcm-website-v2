/**
 * ProductRelatedServer(計畫-商品頁推薦查詢逾時 §4 甲-3)。
 * Codex R1 建議 3:清冊只查「有呼叫 withDealerCardPrices」, 改成把原本的 items 傳下去照樣綠 ⇒ 這裡看實際傳給卡片的是哪一份。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const items = [{ slug: 'rec-1', name: '推薦一', price: 1000, productId: 'u-1' }];
const fetchRecommendedProducts = vi.fn(async () => ({ items, hasMore: true }));
const withDealerCardPrices = vi.fn(async (list: typeof items, tier: string) =>
  tier === 'store' ? list.map((p) => ({ ...p, price: 800 })) : [...list],
);
vi.mock('@/lib/recommendations/fetch-recommendations', () => ({ fetchRecommendedProducts }));
vi.mock('@/lib/dealer-card-prices', () => ({ withDealerCardPrices }));

const { ProductRelatedServer } = await import('./ProductRelatedServer');

beforeEach(() => {
  fetchRecommendedProducts.mockClear();
  withDealerCardPrices.mockClear();
});

describe('ProductRelatedServer', () => {
  it('🔴 經銷商:卡片拿到的是換過經銷價的那一份,用伺服器給的 tier', async () => {
    const el = await ProductRelatedServer({ handle: 'h-1', vehicle: undefined, vehicleParam: undefined, brandSlug: 'rizoma', tier: 'store' });
    expect(withDealerCardPrices).toHaveBeenCalledWith(items, 'store');
    expect(el.props.related[0].price).toBe(800);
  });

  it('一般會員:卡片是一般價', async () => {
    const el = await ProductRelatedServer({ handle: 'h-1', vehicle: undefined, vehicleParam: undefined, brandSlug: 'rizoma', tier: 'general' });
    expect(el.props.related[0].price).toBe(1000);
  });

  it('「查看全部」:有車連車款、沒車連品牌、都沒有連全站', async () => {
    const vehicle = { motoBrand: 'BMW', modelCode: 'S 1000 RR', year: 2021 };
    const withCar = await ProductRelatedServer({ handle: 'h-1', vehicle, vehicleParam: 'bmw:s-1000-rr:2021', brandSlug: 'rizoma', tier: 'general' });
    expect(withCar.props.moreHref).toBe('/products?vehicle=bmw%3As-1000-rr%3A2021');
    expect(withCar.props.hasVehicle).toBe(true);
    expect(fetchRecommendedProducts).toHaveBeenLastCalledWith('h-1', vehicle);
    const brandOnly = await ProductRelatedServer({ handle: 'h-1', vehicle: undefined, vehicleParam: undefined, brandSlug: 'rizoma', tier: 'general' });
    expect(brandOnly.props.moreHref).toBe('/products?brand=rizoma');
    const none = await ProductRelatedServer({ handle: 'h-1', vehicle: undefined, vehicleParam: undefined, brandSlug: undefined, tier: 'general' });
    expect(none.props.moreHref).toBe('/products');
  });
});
