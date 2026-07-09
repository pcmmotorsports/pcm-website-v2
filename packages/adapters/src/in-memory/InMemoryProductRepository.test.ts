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
    productCode: 'AKRA-EX-01', // M-1-16c-4b:Product.productCode 必填
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
    highlights: [], // A/#270:Product.highlights 必填(本 factory 不測賣點 → 空陣列)
    manuals: [], // #270:Product.manuals 必填(本 factory 不測安裝資源 → 空陣列)
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

  // M-1-16c-2:findByHandle(各 impl 自備 fixture、非走 shared contract;codex 關卡1 must-fix 1)。
  // InMemory 存整 Product、variants 天生帶(save 時 structuredClone 含 variants[])。
  it('should return null when findByHandle handle not exists', async () => {
    const repo = new InMemoryProductRepository();
    const result = await repo.findByHandle('non-existent-handle');
    expect(result).toBeNull();
  });

  it('should find product by handle including its variants', async () => {
    const withVariants = createFakeProduct({
      id: 'p-variant',
      handle: 'rpm-bms1k2kr03',
      variants: [
        {
          id: 'v-1',
          sku: 'BMS1K2KR03-G-F',
          spec: { weave: 'Forged', finish: 'Glossy' },
          priceByTier: {
            general: { amount: toMoneyAmount(8400), currency: 'TWD' },
            store: { amount: toMoneyAmount(0), currency: 'TWD' },
            premiumStore: { amount: toMoneyAmount(0), currency: 'TWD' },
          },
          availability: 'in-stock',
          images: ['https://cdn.shopify.com/a.jpg'],
          sortOrder: 0,
        },
      ],
    });
    const repo = new InMemoryProductRepository([withVariants]);

    const found = await repo.findByHandle('rpm-bms1k2kr03');
    expect(found?.id).toBe('p-variant');
    expect(found?.variants).toHaveLength(1);
    expect(found?.variants[0]?.sku).toBe('BMS1K2KR03-G-F');
    expect(found?.variants[0]?.spec).toEqual({ weave: 'Forged', finish: 'Glossy' });
  });

  it('should list products by category raw match', async () => {
    const exhaust = createFakeProduct({ id: 'p-1', category: { raw: '引擎部品 · 排氣管', segments: ['引擎部品', '排氣管'] } });
    const brake = createFakeProduct({ id: 'p-2', category: { raw: '制動 · 卡鉗', segments: ['制動', '卡鉗'] } });
    const repo = new InMemoryProductRepository([exhaust, brake]);

    const result = await repo.listByCategory({ raw: '引擎部品 · 排氣管', segments: ['引擎部品', '排氣管'] });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('p-1');
  });

  // C4 接線:listAllProducts 回全目錄(跨分類、不綁 category)。
  it('should list all products across categories (listAllProducts、C4 全目錄)', async () => {
    const exhaust = createFakeProduct({ id: 'p-1', category: { raw: '引擎部品 · 排氣管', segments: ['引擎部品', '排氣管'] } });
    const brake = createFakeProduct({ id: 'p-2', category: { raw: '制動 · 卡鉗', segments: ['制動', '卡鉗'] } });
    const repo = new InMemoryProductRepository([exhaust, brake]);

    const result = await repo.listAllProducts();
    // 不像 listByCategory 只回單一分類 → 跨分類全回
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.id).sort()).toEqual(['p-1', 'p-2']);
  });

  it('should return [] for listAllProducts when repository empty', async () => {
    const repo = new InMemoryProductRepository();
    expect(await repo.listAllProducts()).toEqual([]);
  });

  // perf/P2:listAllProducts({ limit })——亂序 seed 證「先 id 升冪再取 limit」
  // (Map 插入序 ≠ id 序;不排序會與 SupabaseProductAdapter `.order('id')` 語意漂移、K1 round2 抓點)。
  it('should return first N products by id ascending for listAllProducts({ limit })(perf/P2、亂序 seed)', async () => {
    const p3 = createFakeProduct({ id: 'p-3' });
    const p1 = createFakeProduct({ id: 'p-1' });
    const p2 = createFakeProduct({ id: 'p-2' });
    const repo = new InMemoryProductRepository([p3, p1, p2]); // 插入序刻意亂

    const result = await repo.listAllProducts({ limit: 2 });
    expect(result.map((p) => p.id)).toEqual(['p-1', 'p-2']); // id 升冪前 2、非插入序前 2

    // 省略 limit → 既有行為不變(全量)
    expect(await repo.listAllProducts()).toHaveLength(3);
  });

  it('should throw for non-positive-integer limit in listAllProducts(perf/P2、fail-closed)', async () => {
    const repo = new InMemoryProductRepository([createFakeProduct()]);
    await expect(repo.listAllProducts({ limit: 0 })).rejects.toThrow(/limit 須為正整數/);
    await expect(repo.listAllProducts({ limit: -1 })).rejects.toThrow(/limit 須為正整數/);
    await expect(repo.listAllProducts({ limit: 2.5 })).rejects.toThrow(/limit 須為正整數/);
  });

  it('should list products by brand id match', async () => {
    const akra = createFakeProduct({ id: 'p-1', brand: { id: 'b-akrapovic', name: 'Akrapovič', slug: 'akrapovic', premium_extra_pct: 0 } });
    const brembo = createFakeProduct({ id: 'p-2', brand: { id: 'b-brembo', name: 'Brembo', slug: 'brembo', premium_extra_pct: 0 } });
    const repo = new InMemoryProductRepository([akra, brembo]);

    const result = await repo.listByBrand('b-akrapovic');
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('p-1');
  });

  it('should list general products (empty fitments) for listGeneral', async () => {
    const universal = createFakeProduct({ id: 'p-uni', fitments: [] });
    const specific = createFakeProduct({
      id: 'p-spec',
      fitments: [{ motoBrand: 'Ducati', modelCode: 'Panigale V4', yearStart: 2020, yearEnd: 2024 }],
    });
    const repo = new InMemoryProductRepository([universal, specific]);

    const result = await repo.listGeneral();
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('p-uni');
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

    // #93:8 個 matchFitment 邊界 case(對齊 resolveEnd 單年/開放/inclusive 重疊語意)
    it('單年 actual(yearEnd undefined → resolveEnd=yearStart)、spec 同年 → match', async () => {
      const single = createFakeProduct({
        id: 'p-single-2020',
        fitments: [{ motoBrand: 'Yamaha', modelCode: 'R1', yearStart: 2020 }],
      });
      const repo = new InMemoryProductRepository([single]);
      const result = await repo.listByFitment({ motoBrand: 'Yamaha', modelCode: 'R1', yearStart: 2020, yearEnd: 2020 });
      expect(result).toHaveLength(1);
    });

    it('相鄰年不 match:單年 actual 2020 vs spec 2021 → 無重疊', async () => {
      const single = createFakeProduct({
        id: 'p-single-2020b',
        fitments: [{ motoBrand: 'Yamaha', modelCode: 'R1', yearStart: 2020 }],
      });
      const repo = new InMemoryProductRepository([single]);
      const result = await repo.listByFitment({ motoBrand: 'Yamaha', modelCode: 'R1', yearStart: 2021, yearEnd: 2021 });
      expect(result).toHaveLength(0);
    });

    it('inclusive 下邊界:actual 2018-2020 vs spec 2020-2025 → 端點相接 match(≤ 非 <)', async () => {
      const lower = createFakeProduct({
        id: 'p-2018-2020',
        fitments: [{ motoBrand: 'Yamaha', modelCode: 'R1', yearStart: 2018, yearEnd: 2020 }],
      });
      const repo = new InMemoryProductRepository([lower]);
      const result = await repo.listByFitment({ motoBrand: 'Yamaha', modelCode: 'R1', yearStart: 2020, yearEnd: 2025 });
      expect(result).toHaveLength(1);
    });

    it('inclusive 上邊界:actual 2020-2024 vs spec 2015-2020 → 端點相接 match', async () => {
      const upper = createFakeProduct({
        id: 'p-2020-2024',
        fitments: [{ motoBrand: 'Yamaha', modelCode: 'R1', yearStart: 2020, yearEnd: 2024 }],
      });
      const repo = new InMemoryProductRepository([upper]);
      const result = await repo.listByFitment({ motoBrand: 'Yamaha', modelCode: 'R1', yearStart: 2015, yearEnd: 2020 });
      expect(result).toHaveLength(1);
    });

    it('空 fitments[] → 任何 spec 都不 match(some 對空陣列為 false)', async () => {
      const empty = createFakeProduct({ id: 'p-no-fitment', fitments: [] });
      const repo = new InMemoryProductRepository([empty]);
      const result = await repo.listByFitment({ motoBrand: 'Yamaha', modelCode: 'R1', yearStart: 2020, yearEnd: 2020 });
      expect(result).toHaveLength(0);
    });

    it('多 fitment OR(positive):spec 命中第二條 fitment → match', async () => {
      const multi = createFakeProduct({
        id: 'p-multi-or',
        fitments: [
          { motoBrand: 'Yamaha', modelCode: 'R1', yearStart: 2018, yearEnd: 2024 },
          { motoBrand: 'Honda', modelCode: 'CBR600RR', yearStart: 2010, yearEnd: 2012 },
        ],
      });
      const repo = new InMemoryProductRepository([multi]);
      const result = await repo.listByFitment({ motoBrand: 'Honda', modelCode: 'CBR600RR', yearStart: 2011, yearEnd: 2011 });
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('p-multi-or');
    });

    it('open-ended actual 下界:actual 2020+ vs spec 完全早於(2015)→ 不 match', async () => {
      const open = createFakeProduct({
        id: 'p-2020-open',
        fitments: [{ motoBrand: 'Yamaha', modelCode: 'MT-09', yearStart: 2020, yearEnd: null }],
      });
      const repo = new InMemoryProductRepository([open]);
      const result = await repo.listByFitment({ motoBrand: 'Yamaha', modelCode: 'MT-09', yearStart: 2015, yearEnd: 2015 });
      expect(result).toHaveLength(0);
    });

    it('actual 無年份(yearStart undefined)→ match 任意 spec 年份(鏡像 spec 無年份)', async () => {
      const noYear = createFakeProduct({
        id: 'p-no-year',
        fitments: [{ motoBrand: 'Yamaha', modelCode: 'R1' }],
      });
      const repo = new InMemoryProductRepository([noYear]);
      const result = await repo.listByFitment({ motoBrand: 'Yamaha', modelCode: 'R1', yearStart: 2099, yearEnd: 2099 });
      expect(result).toHaveLength(1);
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

describe('InMemoryProductRepository.listCategories — C1 接線(由庫存 product 推導)', () => {
  it('推導 distinct 分類 + 商品數、degenerate DB 欄位(id=raw / parentId=null / sortOrder=0)', async () => {
    const repo = new InMemoryProductRepository([
      createFakeProduct({ id: 'a', category: { raw: '引擎部品 · 排氣管', segments: ['引擎部品', '排氣管'] } }),
      createFakeProduct({ id: 'b', category: { raw: '引擎部品 · 排氣管', segments: ['引擎部品', '排氣管'] } }),
      createFakeProduct({ id: 'c', category: { raw: '車殼外觀', segments: ['車殼外觀'] } }),
    ]);

    const result = await repo.listCategories();

    expect(result).toHaveLength(2);
    const exhaust = result.find((c) => c.path.raw === '引擎部品 · 排氣管');
    const body = result.find((c) => c.path.raw === '車殼外觀');
    expect(exhaust).toEqual({
      id: '引擎部品 · 排氣管',
      name: '排氣管', // segments 末元素
      path: { raw: '引擎部品 · 排氣管', segments: ['引擎部品', '排氣管'] },
      parentId: null,
      sortOrder: 0,
      productCount: 2,
    });
    expect(body?.productCount).toBe(1);
    expect(body?.name).toBe('車殼外觀'); // 單段 segments → name = 該段
  });

  it('空 repo → 回空陣列', async () => {
    const repo = new InMemoryProductRepository();
    expect(await repo.listCategories()).toEqual([]);
  });
});
