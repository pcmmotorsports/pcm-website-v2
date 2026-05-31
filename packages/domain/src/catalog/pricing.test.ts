import { describe, it, expect } from 'vitest';
import type { Product } from './types';
import { toMoneyAmount } from '../shared/types';
import { computeEffectivePrice } from './pricing';

/**
 * Helper: 建 fake Product entity(本檔 inline 用、對齊
 * packages/adapters/src/in-memory/InMemoryProductRepository.test.ts createFakeProduct 慣例)。
 *
 * 預設值:store=38000、general=45000、premiumStore=36000(僅用作 priceByTier 完整性、
 * `premiumStore` 顯示價由 computeEffectivePrice 動態算、不吃 priceByTier.premiumStore 字面;
 * 對齊 supabase-schema-design.md §5.1)。
 */
function createFakeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p-001',
    name: 'Akrapovič 鈦合金全段排氣管',
    brand: { id: 'b-akrapovic', name: 'Akrapovič', slug: 'akrapovic', premium_extra_pct: 0 },
    category: { raw: '引擎部品 · 排氣管', segments: ['引擎部品', '排氣管'] },
    fitments: [
      { motoBrand: 'Ducati', modelCode: 'Panigale V4', yearStart: 2018, yearEnd: 2024 },
    ],
    priceByTier: {
      general: { amount: toMoneyAmount(45000), currency: 'TWD' },
      store: { amount: toMoneyAmount(38000), currency: 'TWD' },
      premiumStore: { amount: toMoneyAmount(36000), currency: 'TWD' },
    },
    description: '全段鈦合金、輕量化 35%、原廠 ECU 相容',
    images: ['https://example.com/img1.jpg'],
    availability: 'in-stock',
    handle: 'akrapovic-titanium-full-exhaust',
    subtitle: '適用 Panigale V4 / 2018-2024 / 輕量化 35%',
    variants: [], // M-1-16a:variants 必填、本 factory 不測變體 → 空陣列
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('computeEffectivePrice', () => {
  describe('三 tier 基本回值', () => {
    it('general tier 返 priceByTier.general', () => {
      const product = createFakeProduct();
      const result = computeEffectivePrice(product, 'general');
      expect(result).toEqual({ amount: toMoneyAmount(45000), currency: 'TWD' });
    });

    it('store tier 返 priceByTier.store', () => {
      const product = createFakeProduct();
      const result = computeEffectivePrice(product, 'store');
      expect(result).toEqual({ amount: toMoneyAmount(38000), currency: 'TWD' });
    });

    it('premiumStore tier 動態算、不吃 priceByTier.premiumStore 字面', () => {
      // 即使 priceByTier.premiumStore = 36000、computeEffectivePrice 仍從 store + premium_extra_pct 算
      // brand.premium_extra_pct = 0 → 結果應 = store(38000)、不是 priceByTier.premiumStore(36000)
      const product = createFakeProduct();
      const result = computeEffectivePrice(product, 'premiumStore');
      expect(result.amount).toBe(toMoneyAmount(38000));
      expect(result.amount).not.toBe(toMoneyAmount(36000));
    });
  });

  describe('premiumStore 公式 + premium_extra_pct 邊界', () => {
    it('premium_extra_pct = 5 → store × 0.95、Math.round', () => {
      const product = createFakeProduct({
        brand: { id: 'b', name: 'B', slug: 'b', premium_extra_pct: 5 },
        priceByTier: {
          general: { amount: toMoneyAmount(45000), currency: 'TWD' },
          store: { amount: toMoneyAmount(38000), currency: 'TWD' },
          premiumStore: { amount: toMoneyAmount(36000), currency: 'TWD' },
        },
      });
      // 38000 * 0.95 = 36100、整數無 round
      const result = computeEffectivePrice(product, 'premiumStore');
      expect(result.amount).toBe(toMoneyAmount(36100));
      expect(result.currency).toBe('TWD');
    });

    it('premium_extra_pct = 30 上限邊界(對齊 brands.premium_extra_pct CHECK 0-30)', () => {
      const product = createFakeProduct({
        brand: { id: 'b', name: 'B', slug: 'b', premium_extra_pct: 30 },
      });
      // 38000 * 0.7 = 26600
      const result = computeEffectivePrice(product, 'premiumStore');
      expect(result.amount).toBe(toMoneyAmount(26600));
    });

    it('premium_extra_pct = 0 → fallback effect、回 store 價', () => {
      const product = createFakeProduct({
        brand: { id: 'b', name: 'B', slug: 'b', premium_extra_pct: 0 },
      });
      const result = computeEffectivePrice(product, 'premiumStore');
      expect(result.amount).toBe(toMoneyAmount(38000));
    });

    it('Math.round 行為:非整數結果 round 到最近整數', () => {
      const product = createFakeProduct({
        brand: { id: 'b', name: 'B', slug: 'b', premium_extra_pct: 5 },
        priceByTier: {
          general: { amount: toMoneyAmount(45000), currency: 'TWD' },
          store: { amount: toMoneyAmount(38001), currency: 'TWD' },
          premiumStore: { amount: toMoneyAmount(36000), currency: 'TWD' },
        },
      });
      // 38001 * 0.95 = 36100.95 → Math.round = 36101
      const result = computeEffectivePrice(product, 'premiumStore');
      expect(result.amount).toBe(toMoneyAmount(36101));
    });
  });

  /**
   * 為何用 `as unknown as number`:
   * Brand.premium_extra_pct 型別已強制 number、TS 不允許直接賦 null / string;
   * test 需偽造 corrupt data 驗 runtime guard、繞過 type system 是必要 trade-off
   * (對齊 simp-17「雙重 type+runtime 防護」教訓)
   */
  describe('premium_extra_pct 非 number 邊界 fallback 0%', () => {
    it('premium_extra_pct = null → fallback 0%、回 store 價', () => {
      const product = createFakeProduct({
        brand: {
          id: 'b',
          name: 'B',
          slug: 'b',
          premium_extra_pct: null as unknown as number,
        },
      });
      const result = computeEffectivePrice(product, 'premiumStore');
      expect(result.amount).toBe(toMoneyAmount(38000));
    });

    it('premium_extra_pct = undefined → fallback 0%、回 store 價', () => {
      const product = createFakeProduct({
        brand: {
          id: 'b',
          name: 'B',
          slug: 'b',
          premium_extra_pct: undefined as unknown as number,
        },
      });
      const result = computeEffectivePrice(product, 'premiumStore');
      expect(result.amount).toBe(toMoneyAmount(38000));
    });

    it('premium_extra_pct = 字串(corrupt data)→ fallback 0%、回 store 價', () => {
      const product = createFakeProduct({
        brand: {
          id: 'b',
          name: 'B',
          slug: 'b',
          premium_extra_pct: 'abc' as unknown as number,
        },
      });
      const result = computeEffectivePrice(product, 'premiumStore');
      expect(result.amount).toBe(toMoneyAmount(38000));
    });
  });

  describe('currency 對齊 store tier', () => {
    it('premiumStore 返 Money.currency 從 store tier 拿', () => {
      const product = createFakeProduct({
        brand: { id: 'b', name: 'B', slug: 'b', premium_extra_pct: 5 },
      });
      const result = computeEffectivePrice(product, 'premiumStore');
      expect(result.currency).toBe('TWD');
    });
  });
});
