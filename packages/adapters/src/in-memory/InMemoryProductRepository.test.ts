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

  it('should save and retrieve product by id (defensive copy isolation)', async () => {
    const repo = new InMemoryProductRepository();
    const product = createFakeProduct({ id: 'p-save-test' });
    const saved = await repo.save(product);
    // M-1-02-audit C1 defensive copy:save 返回 deep clone、不是同一引用
    expect(saved).not.toBe(product);
    expect(saved).toEqual(product);
    const found = await repo.findById('p-save-test');
    expect(found).toEqual(product);
    // caller mutate 原 product 不影響 stored entity
    product.name = 'mutated';
    const foundAgain = await repo.findById('p-save-test');
    expect(foundAgain?.name).not.toBe('mutated');
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
    const byName = await repo.searchByKeyword('akrapovič', { limit: 10 });
    expect(byName.items).toHaveLength(1);
    expect(byName.items[0]?.id).toBe('p-1');

    // hit description
    const byDesc = await repo.searchByKeyword('輕量化', { limit: 10 });
    expect(byDesc.items).toHaveLength(2);
  });

  it('should respect pagination limit and report total', async () => {
    // 7 個 product 都含 name "排氣管"、query 都 match
    const products = Array.from({ length: 7 }, (_, i) =>
      createFakeProduct({
        id: `p-${i + 1}`,
        name: `排氣管 ${i + 1}`,
      })
    );
    const repo = new InMemoryProductRepository(products);

    const result = await repo.searchByKeyword('排氣管', { limit: 3, offset: 0 });
    expect(result.items).toHaveLength(3);
    expect(result.total).toBe(7);
    expect(result.nextCursor).toBeUndefined();
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

  // 件 #4 / 4(對齊 backlog #83 + supabase-schema-design.md §2.4):
  // matchFitment 為 InMemoryProductRepository private method、本段透過 listByFitment
  // 間接測 4 個 year-range case;contract 級 it.todo 嵌套在 packages/ports/src/
  // IProductRepository.contract.ts 內 describe('listByFitment') > describe('year-range matching')
  //
  // describe 命名以 port public method 為錨(M-1-03-prep-audit S2、Sean Q5=E1):
  // 不暴露 adapter 內部 helper 名(對應 contract 級 listByFitment > year-range matching 嵌套)
  // 規範:docs/lessons-learned.md §12-2、reviews 檔 F2 / F3 / F16(雙視角 Major)
  describe('listByFitment year-range matching', () => {
    it('yearStart/yearEnd 範圍重疊 → match', async () => {
      const inRange = createFakeProduct({
        id: 'p-cbr-2018-2024',
        fitments: [{ motoBrand: 'Yamaha', modelCode: 'CBR600RR', yearStart: 2018, yearEnd: 2024 }],
      });
      const outOfRange = createFakeProduct({
        id: 'p-cbr-2010-2015',
        fitments: [{ motoBrand: 'Yamaha', modelCode: 'CBR600RR', yearStart: 2010, yearEnd: 2015 }],
      });
      const repo = new InMemoryProductRepository([inRange, outOfRange]);

      const result = await repo.listByFitment({
        motoBrand: 'Yamaha',
        modelCode: 'CBR600RR',
        yearStart: 2020,
        yearEnd: 2022,
      });
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('p-cbr-2018-2024');
    });

    it('yearEnd null 開放式範圍("2025+") → match 任何 ≥ yearStart 的 spec', async () => {
      const openEnded = createFakeProduct({
        id: 'p-mt09-open',
        fitments: [{ motoBrand: 'Yamaha', modelCode: 'MT-09', yearStart: 2025, yearEnd: null }],
      });
      const repo = new InMemoryProductRepository([openEnded]);

      const result = await repo.listByFitment({
        motoBrand: 'Yamaha',
        modelCode: 'MT-09',
        yearStart: 2026,
        yearEnd: 2026,
      });
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('p-mt09-open');
    });

    it('spec 無年份 → match 任意 yearRange', async () => {
      const honda = createFakeProduct({
        id: 'p-honda-cbr',
        fitments: [{ motoBrand: 'Honda', modelCode: 'CBR600RR', yearStart: 2018, yearEnd: 2024 }],
      });
      const repo = new InMemoryProductRepository([honda]);

      const result = await repo.listByFitment({
        motoBrand: 'Honda',
        modelCode: 'CBR600RR',
      });
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('p-honda-cbr');
    });

    it('false-positive 防線:actual 2018-2020 vs spec 2025 → 不 match', async () => {
      const ducati = createFakeProduct({
        id: 'p-pani-2018-2020',
        fitments: [{ motoBrand: 'Ducati', modelCode: 'Panigale V4', yearStart: 2018, yearEnd: 2020 }],
      });
      const repo = new InMemoryProductRepository([ducati]);

      const result = await repo.listByFitment({
        motoBrand: 'Ducati',
        modelCode: 'Panigale V4',
        yearStart: 2025,
        yearEnd: 2025,
      });
      expect(result).toHaveLength(0);
    });
  });

  // 跨車型 false positive 防護(M-1-03-main-c sub-slice 2.5 落地、Sean 業務拍板):
  // product.fitments 含多車型時、必須 cross-check 該條 fitment 三條(brand+model+year)全符,
  // 避免 fitment A match brand+model + fitment B match year 交叉觸發 false positive。
  // InMemory.matchFitment(L108-111)已 cross-check brand+model+year 三條、本 test 防 regression。
  it('listByFitment 跨車型 false positive:fitment A match brand+model + fitment B match year → 不應 cross-match', async () => {
    const multiFitment = createFakeProduct({
      id: 'p-multi-fitment',
      fitments: [
        { motoBrand: 'Yamaha', modelCode: 'R1', yearStart: 2018, yearEnd: 2024 },
        { motoBrand: 'Honda', modelCode: 'CBR600RR', yearStart: 2010, yearEnd: 2012 },
      ],
    });
    const repo = new InMemoryProductRepository([multiFitment]);

    // spec=(Honda, CBR600RR, 2020):若無 cross-check brand+model 在 fitment 級、會撞
    // Yamaha R1 fitment(year 2020 ∈ [2018,2024])false positive。
    const result = await repo.listByFitment({
      motoBrand: 'Honda',
      modelCode: 'CBR600RR',
      yearStart: 2020,
      yearEnd: 2020,
    });
    expect(result).toHaveLength(0);

    // 對照組:spec=(Yamaha, R1, 2020) → 應 match(該條 fitment 三條全符)
    const positive = await repo.listByFitment({
      motoBrand: 'Yamaha',
      modelCode: 'R1',
      yearStart: 2020,
      yearEnd: 2020,
    });
    expect(positive).toHaveLength(1);
    expect(positive[0]?.id).toBe('p-multi-fitment');
  });
});
