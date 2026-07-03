// rpm-transform.test.ts — 去碳(config 驅動)單元測 + 🔴 RPM byte 回歸鎖(Phase 0 P0-A-3)
//
// 最高價值 = RPM 零回歸(不變式 3):transformGroup/transformVariant 去碳後、rpm 路徑輸出必須與去碳前逐欄一致,
//   **唯一授權差異 = 副標「碳纖維」→「碳纖維部品」**(Sean 2026-07-03 拍 A:副標隨分類名)。golden 由去碳前的
//   現況程式對相同 fixtures 實跑觀測而得(非推理)、subtitle 依拍板換字後釘死;其餘欄位 + key 順序 + 無 description key 全鎖。
// 次要 = 去碳新行為:per-group 副標=分類名(無碳纖維)、handle 前綴、description 條件寫、nullable 分類、spec 三形狀 sort fallback。

import { describe, it, expect } from 'vitest';
import type { SourceProductRow } from './rpm-fetch';
import {
  transformGroup,
  transformVariant,
  variantSortKey,
  type GroupTransformContext,
} from './rpm-transform';

const NOW = '2026-07-03T00:00:00.000Z';

// transformGroup 回傳 key 順序(rpm、無 description)→ 鎖 byte 序列化順序
const RPM_PRODUCT_KEYS = [
  'supplier_slug', 'external_id', 'handle', 'title', 'subtitle',
  'price_general', 'price_store', 'price_by_tier', 'fitments', 'images',
  'availability', 'brand_id', 'category_id', 'metadata', 'delisted_at', 'updated_at',
];
const VARIANT_KEYS = [
  'supplier_slug', 'sku', 'spec', 'price_general', 'price_store',
  'availability', 'images', 'sort_order', 'metadata', 'updated_at',
];

/** 依 rpm-import 迴圈語意跑一群(transformGroup + 依 variantSortKey 排序後編 sort_order)。 */
function runGroup(
  mainSku: string,
  variants: SourceProductRow[],
  vehicleLabel: string | null,
  ctx: GroupTransformContext,
) {
  const product = transformGroup(mainSku, variants, vehicleLabel, ctx, NOW);
  const sorted = [...variants].sort((a, b) => (variantSortKey(a) < variantSortKey(b) ? -1 : 1));
  const variantRows = sorted.map((v, idx) => transformVariant(v, NOW, idx));
  return { product, variantRows };
}

// ── RPM fixtures(= golden capture 用的同一組;涵蓋 string/number/null 價、圖池前綴過濾、fitment 去重、有/無車款)──
const APRILIA: SourceProductRow[] = [
  {
    supplier_slug: 'rpm', main_sku: 'APRILIA-01', sku: 'APRILIA-01-G-F',
    product_name: 'Front Fender', product_name_zh: '前土除',
    description: '碳纖維前土除,100% 手工。', category_zh: '土除', major_category_zh: '車殼外觀',
    vehicle_label: 'Aprilia RS660',
    fitment_parsed: [{ brand: 'Aprilia', model: 'RS660', year_start: 2021, year_end: null }],
    spec: { weave: 'G', finish: 'F' }, price_retail: '12000',
    image_url: 'https://cdn/rep-a.jpg',
    images: [{ url: 'https://cdn/aprilia-01-g-f-1.jpg' }, { url: 'https://cdn/aprilia-01-m-f-1.jpg' }],
    stock_status: 'in_stock',
  },
  {
    supplier_slug: 'rpm', main_sku: 'APRILIA-01', sku: 'APRILIA-01-M-F',
    product_name: 'Front Fender', product_name_zh: '前土除',
    description: '碳纖維前土除,100% 手工。', category_zh: '土除', major_category_zh: '車殼外觀',
    vehicle_label: 'Aprilia RS660',
    // 同車款、unconfirmed → 應被 G-F 的 confirmed 覆寫(去重、confirmed 優先)
    fitment_parsed: [{ brand: 'Aprilia', model: 'RS660', year_start: 2021, year_end: null, unconfirmed: true }],
    spec: { weave: 'M', finish: 'F' }, price_retail: 13500,
    image_url: null,
    images: [{ url: 'https://cdn/aprilia-01-m-f-1.jpg' }],
    stock_status: 'low',
  },
  {
    supplier_slug: 'rpm', main_sku: 'APRILIA-01', sku: 'APRILIA-01-T-G',
    product_name: 'Front Fender', product_name_zh: '',
    description: '碳纖維前土除,100% 手工。', category_zh: '土除', major_category_zh: '車殼外觀',
    vehicle_label: 'Aprilia RS660',
    fitment_parsed: null,
    spec: { weave: 'T', finish: 'G', special: 'limited' }, price_retail: 15000,
    image_url: null,
    images: null,
    stock_status: 'out',
  },
];
const UNIV: SourceProductRow[] = [
  {
    supplier_slug: 'rpm', main_sku: 'UNIV-CARBON', sku: 'UNIV-CARBON-A',
    product_name: 'Bolt Kit', product_name_zh: '螺絲組',
    description: '通用碳纖維螺絲。', category_zh: '螺絲', major_category_zh: '周邊配件',
    vehicle_label: null,
    fitment_parsed: [{ brand: '', model: '', year_start: null, year_end: null }], // 空 entry → 跳過
    spec: { weave: 'P', finish: 'G' }, price_retail: null, // roundTwd(null)→null
    image_url: null,
    images: [],
    stock_status: 'in_stock',
  },
  {
    supplier_slug: 'rpm', main_sku: 'UNIV-CARBON', sku: 'UNIV-CARBON-B',
    product_name: 'Bolt Kit', product_name_zh: '螺絲組',
    description: '通用碳纖維螺絲。', category_zh: '螺絲', major_category_zh: '周邊配件',
    vehicle_label: null,
    fitment_parsed: null,
    spec: { weave: 'P', finish: 'M' }, price_retail: '8000',
    image_url: null,
    images: [{ url: 'https://cdn/univ-carbon-b-1.jpg' }],
    stock_status: 'out',
  },
];

// rpm ctx = 現況鏡射;subtitleTag = 分類 rawPath「碳纖維部品」(Sean 拍板、副標隨分類名)
const RPM_CTX: GroupTransformContext = {
  brandId: 'brand-rpm', categoryId: 'cat-carbon', handlePrefix: 'rpm',
  subtitleTag: '碳纖維部品', syncDescription: false,
};

// golden(去碳前現況實跑觀測、subtitle 依拍板 碳纖維→碳纖維部品)
const GOLDEN_APRILIA_PRODUCT = {
  supplier_slug: 'rpm',
  external_id: 'APRILIA-01',
  handle: 'rpm-aprilia-01',
  title: '前土除',
  subtitle: 'Aprilia RS660 · 碳纖維部品', // 唯一授權差異(去碳前 = 「Aprilia RS660 · 碳纖維」)
  price_general: 12000,
  price_store: null,
  price_by_tier: { general: { amount: 12000, currency: 'TWD' }, store: { amount: 12000, currency: 'TWD' } },
  fitments: [{ motoBrand: 'Aprilia', modelCode: 'RS660', yearStart: 2021, yearEnd: null }],
  images: ['https://cdn/rep-a.jpg'],
  availability: 'in-stock',
  brand_id: 'brand-rpm',
  category_id: 'cat-carbon',
  metadata: { name_en: 'Front Fender' },
  delisted_at: null,
  updated_at: NOW,
};
const GOLDEN_APRILIA_VARIANTS = [
  { supplier_slug: 'rpm', sku: 'APRILIA-01-G-F', spec: { weave: 'G', finish: 'F' }, price_general: 12000, price_store: null, availability: 'in-stock', images: ['https://cdn/aprilia-01-g-f-1.jpg'], sort_order: 0, metadata: {}, updated_at: NOW },
  { supplier_slug: 'rpm', sku: 'APRILIA-01-M-F', spec: { weave: 'M', finish: 'F' }, price_general: 13500, price_store: null, availability: 'in-stock', images: ['https://cdn/aprilia-01-m-f-1.jpg'], sort_order: 1, metadata: {}, updated_at: NOW },
  { supplier_slug: 'rpm', sku: 'APRILIA-01-T-G', spec: { weave: 'T', finish: 'G', special: 'limited' }, price_general: 15000, price_store: null, availability: 'out-of-stock', images: [], sort_order: 2, metadata: {}, updated_at: NOW },
];
const GOLDEN_UNIV_PRODUCT = {
  supplier_slug: 'rpm',
  external_id: 'UNIV-CARBON',
  handle: 'rpm-univ-carbon',
  title: '螺絲組',
  subtitle: '碳纖維部品', // 唯一授權差異(去碳前 = 「碳纖維」)
  price_general: null,
  price_store: null,
  price_by_tier: { general: { amount: 0, currency: 'TWD' }, store: { amount: 0, currency: 'TWD' } },
  fitments: [],
  images: ['https://cdn/univ-carbon-b-1.jpg'],
  availability: 'in-stock',
  brand_id: 'brand-rpm',
  category_id: 'cat-carbon',
  metadata: { name_en: 'Bolt Kit' },
  delisted_at: null,
  updated_at: NOW,
};

describe('🔴 RPM byte 回歸鎖(去碳後 rpm 路徑逐欄不變、唯副標隨分類名)', () => {
  it('group A(有車款、碳纖維多變體):逐欄 = golden、key 順序不變、無 description key', () => {
    const { product, variantRows } = runGroup('APRILIA-01', APRILIA, 'Aprilia RS660', RPM_CTX);
    expect(product).toEqual(GOLDEN_APRILIA_PRODUCT); // 值 + 結構
    expect(Object.keys(product)).toEqual(RPM_PRODUCT_KEYS); // key 順序 + 證明無 description key
    expect('description' in product).toBe(false); // rpm syncDescription=false → 省欄
    expect(product.handle).toBe('rpm-aprilia-01'); // handle 前綴不變
    expect(product.subtitle).toBe('Aprilia RS660 · 碳纖維部品'); // Sean 拍板的唯一差異
    expect(product.subtitle).not.toContain('部品部品'); // 防詞重複
    expect(variantRows).toEqual(GOLDEN_APRILIA_VARIANTS); // 含 sort_order 0/1/2
    expect(Object.keys(variantRows[0]!)).toEqual(VARIANT_KEYS);
    expect(product.fitments).toHaveLength(1); // unconfirmed 被 confirmed 覆寫、去重成 1
  });

  it('group B(通用件、無車款、null 價、空 fitment):逐欄 = golden、副標=只分類名', () => {
    const { product, variantRows } = runGroup('UNIV-CARBON', UNIV, null, RPM_CTX);
    expect(product).toEqual(GOLDEN_UNIV_PRODUCT);
    expect(Object.keys(product)).toEqual(RPM_PRODUCT_KEYS);
    expect('description' in product).toBe(false);
    expect(product.subtitle).toBe('碳纖維部品'); // 無車款 → 只分類名
    expect(product.price_general).toBeNull(); // roundTwd(null)
    expect(product.price_by_tier.general).toEqual({ amount: 0, currency: 'TWD' }); // null ?? 0 placeholder
    expect(product.fitments).toEqual([]); // 空 entry 跳過 + null 跳過
    expect(variantRows.map((v) => v.sku)).toEqual(['UNIV-CARBON-A', 'UNIV-CARBON-B']);
  });
});

describe('去碳:per-group / config 驅動(GB/Bonamici 形狀)', () => {
  const gbBase: SourceProductRow = {
    supplier_slug: 'gbracing', main_sku: 'GB-001', sku: 'GB-001',
    product_name: 'Crankcase Cover', product_name_zh: '曲軸箱護蓋',
    description: '曲軸箱護蓋,CNC 切削。', category_zh: '引擎護蓋', major_category_zh: '操控部品',
    vehicle_label: 'Yamaha R1', fitment_parsed: null,
    spec: null, price_retail: '5000',
    image_url: 'https://cdn/gb-001.jpg', images: [{ url: 'https://cdn/gb-001.jpg' }],
    stock_status: 'in_stock',
  };
  const GB_CTX: GroupTransformContext = {
    brandId: 'brand-gb', categoryId: 'cat-ops', handlePrefix: 'gbracing',
    subtitleTag: '操控部品', syncDescription: true,
  };

  it('per-group 副標 = major_category_zh、無「碳纖維」字樣、handle 用供應商前綴', () => {
    const { product } = runGroup('GB-001', [gbBase], 'Yamaha R1', GB_CTX);
    expect(product.subtitle).toBe('Yamaha R1 · 操控部品');
    expect(product.subtitle).not.toContain('碳纖維');
    expect(product.handle).toBe('gbracing-gb-001');
    expect(product.brand_id).toBe('brand-gb');
    expect(product.category_id).toBe('cat-ops');
  });

  it('通用件(無車款)per-group 副標 = 只分類名', () => {
    const { product } = runGroup('GB-001', [gbBase], null, GB_CTX);
    expect(product.subtitle).toBe('操控部品');
  });

  it('syncDescription=true 且來源有值 → 寫 description key', () => {
    const { product } = runGroup('GB-001', [gbBase], 'Yamaha R1', GB_CTX);
    expect(product.description).toBe('曲軸箱護蓋,CNC 切削。');
    expect(Object.keys(product)).toContain('description');
  });

  it('syncDescription=true 但來源 null/空/純空白 → 省欄不寫 null(§2.9 F2 + F4)', () => {
    const nullDesc = [{ ...gbBase, description: null }];
    const emptyDesc = [{ ...gbBase, description: '' }];
    const blankDesc = [{ ...gbBase, description: '   ' }]; // F4:純空白不得寫入
    expect('description' in runGroup('GB-001', nullDesc, 'Yamaha R1', GB_CTX).product).toBe(false);
    expect('description' in runGroup('GB-001', emptyDesc, 'Yamaha R1', GB_CTX).product).toBe(false);
    expect('description' in runGroup('GB-001', blankDesc, 'Yamaha R1', GB_CTX).product).toBe(false);
  });

  it('per-group 分類 seed 前解析不到 → category_id=null(不 crash)', () => {
    const { product } = runGroup('GB-001', [gbBase], 'Yamaha R1', { ...GB_CTX, categoryId: null });
    expect(product.category_id).toBeNull();
  });

  it('副標邊角:subtitleTag 空 + 有車款 → 只車款;皆空 → 空字串', () => {
    expect(runGroup('X', [gbBase], 'Yamaha R1', { ...GB_CTX, subtitleTag: '' }).product.subtitle).toBe('Yamaha R1');
    expect(runGroup('X', [gbBase], null, { ...GB_CTX, subtitleTag: '' }).product.subtitle).toBe('');
  });

  it('bonamici spec {color,material} → variantSortKey 退化 sku-only、不 crash、依 sku ASC', () => {
    const bo: SourceProductRow[] = [
      { ...gbBase, supplier_slug: 'bonamici', sku: 'BON-B', spec: { color: 'red', material: 'alu' } },
      { ...gbBase, supplier_slug: 'bonamici', sku: 'BON-A', spec: { color: 'blue', material: 'alu' } },
    ];
    expect(variantSortKey(bo[0]!)).toBe('||0|BON-B'); // 無 weave/finish → 前綴空
    expect(variantSortKey(bo[1]!)).toBe('||0|BON-A');
    const { variantRows } = runGroup('BON-1', bo, null, { ...GB_CTX, handlePrefix: 'bonamici' });
    expect(variantRows.map((v) => v.sku)).toEqual(['BON-A', 'BON-B']); // sku ASC fallback
  });

  it('gbracing spec=null(單變體)→ variantSortKey 不 crash', () => {
    expect(variantSortKey(gbBase)).toBe('||0|GB-001');
    expect(() => runGroup('GB-001', [gbBase], 'Yamaha R1', GB_CTX)).not.toThrow();
  });
});
