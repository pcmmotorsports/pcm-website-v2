import { describe, it, expect } from 'vitest';
import type { Product } from '@pcm/domain';
import { toMoneyAmount } from '@pcm/domain';
import { InMemoryProductRepository } from './InMemoryProductRepository';

/**
 * Helper: 建 fake Product entity(M-1-02 test inline 用、不抽到別處對齊 Q3=A 最小集精神)。
 *
 * 對齊 catalog/types.ts 7 欄位擴(本 slice Q1=A2)+
 * docs/architecture/testing-strategy.md §3 mock 風格規範。
 */
function createFakeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p-001',
    name: 'Akrapovič 鈦合金全段排氣管',
    brand: { id: 'b-akrapovic', name: 'Akrapovič', slug: 'akrapovic' },
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
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('InMemoryProductRepository', () => {
  it('should return null when findById id not exists', async () => {
    const repo = new InMemoryProductRepository();
    const result = await repo.findById('p-non-existent');
    expect(result).toBeNull();
  });

  it('should save and retrieve product by id', async () => {
    const repo = new InMemoryProductRepository();
    const product = createFakeProduct({ id: 'p-save-test' });
    const saved = await repo.save(product);
    expect(saved).toBe(product);
    const found = await repo.findById('p-save-test');
    expect(found).toEqual(product);
  });

  it('should list products by category raw match', async () => {
    const exhaust = createFakeProduct({ id: 'p-1', category: { raw: '引擎部品 · 排氣管', segments: ['引擎部品', '排氣管'] } });
    const brake = createFakeProduct({ id: 'p-2', category: { raw: '制動 · 卡鉗', segments: ['制動', '卡鉗'] } });
    const repo = new InMemoryProductRepository([exhaust, brake]);

    const result = await repo.listByCategory({ raw: '引擎部品 · 排氣管', segments: ['引擎部品', '排氣管'] });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('p-1');
  });

  it('should list products by brand id match', async () => {
    const akra = createFakeProduct({ id: 'p-1', brand: { id: 'b-akrapovic', name: 'Akrapovič', slug: 'akrapovic' } });
    const brembo = createFakeProduct({ id: 'p-2', brand: { id: 'b-brembo', name: 'Brembo', slug: 'brembo' } });
    const repo = new InMemoryProductRepository([akra, brembo]);

    const result = await repo.listByBrand('b-akrapovic');
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('p-1');
  });

  it('should list products by fitment motoBrand + modelCode match', async () => {
    const ducati = createFakeProduct({
      id: 'p-1',
      fitments: [{ motoBrand: 'Ducati', modelCode: 'Panigale V4', yearStart: 2018, yearEnd: 2024 }],
    });
    const yamaha = createFakeProduct({
      id: 'p-2',
      fitments: [{ motoBrand: 'Yamaha', modelCode: 'CBR600RR', yearStart: 2020, yearEnd: null }],
    });
    const repo = new InMemoryProductRepository([ducati, yamaha]);

    const result = await repo.listByFitment({ motoBrand: 'Ducati', modelCode: 'Panigale V4' });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('p-1');
  });

  it('should search products by keyword case-insensitive (name + description)', async () => {
    const titaniumExhaust = createFakeProduct({
      id: 'p-1',
      name: 'Akrapovič 鈦合金全段排氣管',
      description: '輕量化 35%',
    });
    const carbonShield = createFakeProduct({
      id: 'p-2',
      name: 'CNC RACING 碳纖前土除',
      description: '輕量化 50% 強度提升',
    });
    const repo = new InMemoryProductRepository([titaniumExhaust, carbonShield]);

    // hit name(case-insensitive)
    const byName = await repo.searchByKeyword('akrapovič');
    expect(byName).toHaveLength(1);
    expect(byName[0]?.id).toBe('p-1');

    // hit description
    const byDesc = await repo.searchByKeyword('輕量化');
    expect(byDesc).toHaveLength(2);
  });

  it('should overwrite existing product when save is called with same id', async () => {
    const repo = new InMemoryProductRepository();
    const original = createFakeProduct({ id: 'p-1', availability: 'in-stock' });
    await repo.save(original);
    const updated = createFakeProduct({ id: 'p-1', availability: 'out-of-stock' });
    await repo.save(updated);

    const found = await repo.findById('p-1');
    expect(found?.availability).toBe('out-of-stock');
  });
});
