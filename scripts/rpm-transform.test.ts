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
  normalizeHandleSegment,
  resolveFitmentYears,
  liveVariantsOf,
  type GroupTransformContext,
} from './rpm-transform';
import type { SourceFitmentEntry } from './rpm-fetch';

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

/** 依 rpm-import 迴圈語意跑一群(transformGroup + 依 variantSortKey 排序後編 sort_order)。
 *  W3:helper 預設 'sku-prefix-pool' = RPM 現行行為(byte 錨測試全走此值);per-variant 測試顯式覆寫。 */
function runGroup(
  mainSku: string,
  variants: SourceProductRow[],
  vehicleLabel: string | null,
  ctx: GroupTransformContext,
  variantImages: 'sku-prefix-pool' | 'per-variant' = 'sku-prefix-pool',
) {
  const product = transformGroup(mainSku, variants, vehicleLabel, ctx, NOW);
  const sorted = [...variants].sort((a, b) => (variantSortKey(a) < variantSortKey(b) ? -1 : 1));
  const variantRows = sorted.map((v, idx) => transformVariant(v, NOW, idx, variantImages));
  return { product, variantRows };
}

// ── RPM fixtures(= golden capture 用的同一組;涵蓋 string/number/null 價、圖池前綴過濾、fitment 去重、有/無車款)──
const APRILIA: SourceProductRow[] = [
  {
    supplier_slug: 'rpm', main_sku: 'APRILIA-01', sku: 'APRILIA-01-G-F', highlights_zh: null, pdf_urls: null, pdf_docs: null, video_urls: null,
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
    supplier_slug: 'rpm', main_sku: 'APRILIA-01', sku: 'APRILIA-01-M-F', highlights_zh: null, pdf_urls: null, pdf_docs: null, video_urls: null,
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
    supplier_slug: 'rpm', main_sku: 'APRILIA-01', sku: 'APRILIA-01-T-G', highlights_zh: null, pdf_urls: null, pdf_docs: null, video_urls: null,
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
    supplier_slug: 'rpm', main_sku: 'UNIV-CARBON', sku: 'UNIV-CARBON-A', highlights_zh: null, pdf_urls: null, pdf_docs: null, video_urls: null,
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
    supplier_slug: 'rpm', main_sku: 'UNIV-CARBON', sku: 'UNIV-CARBON-B', highlights_zh: null, pdf_urls: null, pdf_docs: null, video_urls: null,
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
  subtitleTag: '碳纖維部品', syncDescription: false, syncInstallResources: false, appendManualFilename: false,
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
    supplier_slug: 'gbracing', main_sku: 'GB-001', sku: 'GB-001', highlights_zh: null, pdf_urls: null, pdf_docs: null, video_urls: null,
    product_name: 'Crankcase Cover', product_name_zh: '曲軸箱護蓋',
    description: '曲軸箱護蓋,CNC 切削。', category_zh: '引擎護蓋', major_category_zh: '操控部品',
    vehicle_label: 'Yamaha R1', fitment_parsed: null,
    spec: null, price_retail: '5000',
    image_url: 'https://cdn/gb-001.jpg', images: [{ url: 'https://cdn/gb-001.jpg' }],
    stock_status: 'in_stock',
  };
  const GB_CTX: GroupTransformContext = {
    brandId: 'brand-gb', categoryId: 'cat-ops', handlePrefix: 'gbracing',
    subtitleTag: '操控部品', syncDescription: true, syncInstallResources: true, appendManualFilename: false,
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

describe('W3(#267):variantImages 策略 — 非 RPM per-variant 直用、RPM 前綴過濾不變', () => {
  // bonamici 真形狀(2026-07-04 view 實測):URL 含自身 sku 目錄、sku 後跟 / . 而非 '-'
  const boVariant: SourceProductRow = {
    supplier_slug: 'bonamici', main_sku: '0025', sku: '0025_BR', highlights_zh: null, pdf_urls: null, pdf_docs: null, video_urls: null,
    product_name: 'Oil Cap', product_name_zh: '機油蓋',
    description: null, category_zh: '引擎部品', major_category_zh: '引擎部品',
    vehicle_label: null, fitment_parsed: null,
    spec: { color: '古銅色', material: '鋁合金' }, price_retail: '1900',
    image_url: 'https://www.bonamiciracing.it/images/prodotti/0025_BR/0025_BR.jpg',
    // 🔴 真形狀 = 純字串陣列(bonamici/cncracing fetcher 寫法、2026-07-04 view 實測;非 rpm 的 [{url}])
    images: ['https://www.bonamiciracing.it/images/prodotti/0025_BR/0025_BR.jpg'],
    stock_status: 'in_stock',
  };

  it("per-variant:直接全用該列 images(不做 sku 前綴過濾)", () => {
    const row = transformVariant(boVariant, NOW, 0, 'per-variant');
    expect(row.images).toEqual(['https://www.bonamiciracing.it/images/prodotti/0025_BR/0025_BR.jpg']);
  });

  it("sku-prefix-pool 對 bonamici 形狀檔名必 miss(sku 後跟 / . 非 '-')→ [](W3 修復前的病灶重現)", () => {
    const row = transformVariant(boVariant, NOW, 0, 'sku-prefix-pool');
    expect(row.images).toEqual([]); // 這就是「選色不換圖」根因;bonamici/cncracing 必須走 per-variant
  });

  it('per-variant 不過濾:cncracing 混情境照也全保留(view 該列 images 即該變體圖組)', () => {
    const cnc: SourceProductRow = {
      ...boVariant, supplier_slug: 'cncracing', main_sku: 'CA210', sku: 'CA210B',
      spec: { color: '黑色' }, price_retail: '9500',
      image_url: 'https://www.cncracing.com/images_web/variante/1200x/CA210B.jpg',
      images: [
        'https://www.cncracing.com/images_web/variante/1200x/CA210B.jpg',
        'https://www.cncracing.com/images_web/prod/1200x/CA210B_CA210R.jpg',
      ],
    };
    const row = transformVariant(cnc, NOW, 0, 'per-variant');
    expect(row.images).toHaveLength(2);
    expect(row.images[0]).toContain('variante/1200x/CA210B.jpg'); // 首張 = 乾淨變體圖
  });

  it('RPM byte 錨:sku-prefix-pool 前綴過濾行為與既有 golden 一致(APRILIA 圖池)', () => {
    // 既有 byte 鎖測試走 runGroup default('sku-prefix-pool');此處顯式斷言過濾語意不變
    const rpmV: SourceProductRow = {
      ...boVariant, supplier_slug: 'rpm', main_sku: 'APRILIA-01', sku: 'APRILIA-01-G-F',
      spec: { weave: 'G', finish: 'F' }, price_retail: '12000', image_url: null,
      images: [{ url: 'https://cdn/aprilia-01-g-f-1.jpg' }, { url: 'https://cdn/aprilia-01-m-f-1.jpg' }],
    };
    const row = transformVariant(rpmV, NOW, 0, 'sku-prefix-pool');
    expect(row.images).toEqual(['https://cdn/aprilia-01-g-f-1.jpg']); // 只留自身前綴、不誤收 m-f
  });
});

describe('#266 normalizeHandleSegment(handle 片段正規化、Sean 拍 A)', () => {
  it('rpm/gbracing 合法 sku = no-op(byte 不變、保留連字號)', () => {
    expect(normalizeHandleSegment('APRILIA-01')).toBe('aprilia-01'); // = RPM golden handle 片段
    expect(normalizeHandleSegment('UNIV-CARBON')).toBe('univ-carbon');
    expect(normalizeHandleSegment('GB-001')).toBe('gb-001');
  });

  it('保留底線(P0-A-4c、bonamici PU_001)', () => {
    expect(normalizeHandleSegment('PU_001')).toBe('pu_001');
    expect(normalizeHandleSegment('PU_001_BK')).toBe('pu_001_bk');
  });

  it('gbracing 25 髒 handle 三類 → URL-safe(小數點/空格/斜線 → hyphen)', () => {
    expect(normalizeHandleSegment('M10X1.25')).toBe('m10x1-25'); // ① 小數點(牙距)
    expect(normalizeHandleSegment('M12X1.25X40')).toBe('m12x1-25x40');
    expect(normalizeHandleSegment('M6 HEX HEAD')).toBe('m6-hex-head'); // ② 空格
    expect(normalizeHandleSegment('M6 SOCKET CAP HEAD')).toBe('m6-socket-cap-head');
    expect(normalizeHandleSegment('FS-CBR600-2008-R/L')).toBe('fs-cbr600-2008-r-l'); // ③ 斜線(Frame Slider 主力)
  });

  it('連續/前後分隔符收斂 + 去邊(HANDLE_RE 合規)', () => {
    expect(normalizeHandleSegment('a..b')).toBe('a-b'); // 連續無效 → 單 hyphen
    expect(normalizeHandleSegment('a-.b')).toBe('a-b'); // - 後接無效 → 收斂單 hyphen
    expect(normalizeHandleSegment('  x  ')).toBe('x'); // 前後空白 → 去邊
    expect(normalizeHandleSegment('-a_')).toBe('a'); // 前後分隔符去除
    expect(normalizeHandleSegment('a__b')).toBe('a-b'); // 連續底線收斂
  });

  it('全無效字元 → 空字串(交 handle preflight charset 攔、非靜默寫髒)', () => {
    const HANDLE_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/; // 同 rpm-preflight.ts
    expect(normalizeHandleSegment('...')).toBe('');
    expect(normalizeHandleSegment('   ')).toBe('');
    // 安全網:空段組成 `${prefix}-` 尾綴分隔符 → HANDLE_RE 拒絕 → preflight charset 攔(非靜默寫髒)
    expect(HANDLE_RE.test(`gbracing-${normalizeHandleSegment('...')}`)).toBe(false);
  });

  it('正規化後 transform 端 handle 過 HANDLE_RE(與 preflight 同步)', () => {
    const HANDLE_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/; // 同 rpm-preflight.ts HANDLE_RE
    for (const sku of ['M10X1.25', 'M6 HEX HEAD', 'FS-CBR600-2008-R/L', 'PU_001', 'APRILIA-01']) {
      expect(HANDLE_RE.test(`gbracing-${normalizeHandleSegment(sku)}`)).toBe(true);
    }
  });
});

// 2026-07-05:供應商 fitment 年份 schema 不一致 —— bonamici/rpm 數字欄、gbracing 字串欄 year_str。
describe('resolveFitmentYears(year_str fallback、修 gbracing 年份掉落)', () => {
  const e = (o: Partial<SourceFitmentEntry>): SourceFitmentEntry => ({ brand: 'X', model: 'Y', ...o });

  it('🔴 數字欄 present(rpm/bonamici)→ 原樣用、不碰 year_str(byte 錨)', () => {
    expect(resolveFitmentYears(e({ year_start: 2006, year_end: 2015 }))).toEqual({ start: 2006, end: 2015 });
    // 數字欄 present 但 year_str 也在 → 數字欄優先(byte-safe、忽略字串)
    expect(resolveFitmentYears(e({ year_start: 2006, year_end: 2015, year_str: '9999' }))).toEqual({ start: 2006, end: 2015 });
    // 明確 null 數字欄(present=undefined 之外)→ null,不回退字串
    expect(resolveFitmentYears(e({ year_start: null, year_end: null, year_str: '2006-2010' }))).toEqual({ start: null, end: null });
    // 開放式(僅起年數字)
    expect(resolveFitmentYears(e({ year_start: 2020, year_end: null }))).toEqual({ start: 2020, end: null });
  });

  it('🔴 gbracing 情境:無數字欄、year_str 區間 "2006-2010" → 解析出年份(修年份掉落)', () => {
    expect(resolveFitmentYears(e({ year_str: '2006-2010' }))).toEqual({ start: 2006, end: 2010 });
  });

  it('year_str 各格式:單年 / 開放 / 空 / 空白 / en-dash / em-dash', () => {
    expect(resolveFitmentYears(e({ year_str: '2024' }))).toEqual({ start: 2024, end: 2024 }); // 單年 start=end
    expect(resolveFitmentYears(e({ year_str: '2019-' }))).toEqual({ start: 2019, end: null }); // 開放式
    expect(resolveFitmentYears(e({ year_str: '2006 - 2010' }))).toEqual({ start: 2006, end: 2010 }); // 內部空白
    expect(resolveFitmentYears(e({ year_str: '' }))).toEqual({ start: null, end: null }); // 空
    expect(resolveFitmentYears(e({ year_str: '  ' }))).toEqual({ start: null, end: null }); // 空白
    expect(resolveFitmentYears(e({ year_str: '2006–2010' }))).toEqual({ start: 2006, end: 2010 }); // en-dash
    expect(resolveFitmentYears(e({ year_str: '2006—2010' }))).toEqual({ start: 2006, end: 2010 }); // em-dash
    expect(resolveFitmentYears(e({}))).toEqual({ start: null, end: null }); // 三欄皆無
  });

  it('🔴 嚴格 whitelist(codex 對抗審 must-fix):髒 year_str 一律廢、不 parseInt 寬鬆吞', () => {
    expect(resolveFitmentYears(e({ year_str: '2006abc' }))).toEqual({ start: null, end: null }); // 尾綴髒字 → 非 2006
    expect(resolveFitmentYears(e({ year_str: '2006/2010' }))).toEqual({ start: null, end: null }); // 斜線非 dash → 廢(非塌 2006)
    expect(resolveFitmentYears(e({ year_str: '2006-2010-2012' }))).toEqual({ start: null, end: null }); // 三段 → 廢(非忽略第三段)
    expect(resolveFitmentYears(e({ year_str: '-2006' }))).toEqual({ start: null, end: null }); // 缺起年 → 廢
    expect(resolveFitmentYears(e({ year_str: '20' }))).toEqual({ start: null, end: null }); // 兩位 → 廢
    expect(resolveFitmentYears(e({ year_str: '1800-3000' }))).toEqual({ start: null, end: null }); // 超年界擋掉
    expect(resolveFitmentYears(e({ year_str: '2006-abc' }))).toEqual({ start: 2006, end: null }); // 起年合法迄年髒 → 開放式(起年保留)
  });
});

// A/#270:賣點條列 highlights_zh → products.highlights(供應商級 syncDescription gate + 正規化 + rpm 凍結)
describe('A/#270 highlights 賣點條列', () => {
  const gbHl: SourceProductRow = {
    supplier_slug: 'gbracing', main_sku: 'GB-HL', sku: 'GB-HL', highlights_zh: ['6AL-4V G5 鈦合金,輕量耐腐蝕', 'DLC 黑鈦塗層'], pdf_urls: null, pdf_docs: null, video_urls: null,
    product_name: 'Bolt', product_name_zh: '鈦合金螺絲',
    description: '鈦合金螺絲。', category_zh: '螺絲', major_category_zh: '操控部品',
    vehicle_label: null, fitment_parsed: null,
    spec: null, price_retail: '900',
    image_url: null, images: [], stock_status: 'in_stock',
  };
  const GB_HL_CTX: GroupTransformContext = {
    brandId: 'brand-gb', categoryId: 'cat-ops', handlePrefix: 'gbracing',
    subtitleTag: '操控部品', syncDescription: true, syncInstallResources: true, appendManualFilename: false,
  };

  it('syncDescription=true → 展開 highlights key、值 = 正規化 string[]', () => {
    const { product } = runGroup('GB-HL', [gbHl], null, GB_HL_CTX);
    expect(product.highlights).toEqual(['6AL-4V G5 鈦合金,輕量耐腐蝕', 'DLC 黑鈦塗層']);
    expect('highlights' in product).toBe(true);
  });

  it('🔴 syncDescription=false(rpm)→ 省 highlights key(凍結不覆寫、byte 錨延伸)', () => {
    const rpmHl = [{ ...gbHl, supplier_slug: 'rpm' }];
    const { product } = runGroup('GB-HL', rpmHl, null, RPM_CTX); // RPM_CTX.syncDescription=false
    expect('highlights' in product).toBe(false);
  });

  it('正規化:濾非字串與純空白(保留原字面不 trim)、非陣列 → []', () => {
    const dirty = [{ ...gbHl, highlights_zh: ['  留白邊  ', '', '   ', 123 as unknown as string, null as unknown as string] }];
    expect(runGroup('GB-HL', dirty, null, GB_HL_CTX).product.highlights).toEqual(['  留白邊  ']);
    const notArr = [{ ...gbHl, highlights_zh: 'not-an-array' as unknown as string[] }];
    expect(runGroup('GB-HL', notArr, null, GB_HL_CTX).product.highlights).toEqual([]);
  });

  it('syncDescription=true 但來源無賣點(null / 空陣列)→ highlights=[](key 仍在、前台 guard 空)', () => {
    const nullHl = [{ ...gbHl, highlights_zh: null }];
    const { product } = runGroup('GB-HL', nullHl, null, GB_HL_CTX);
    expect(product.highlights).toEqual([]);
    expect('highlights' in product).toBe(true); // gbracing syncDescription=true → key 恆在
  });
});

// #270 安裝資源:pdf_urls/video_urls → products.manuals/video_url(供應商級 gate + 群級彙整 + 形狀轉換)
describe('#270 安裝資源 manuals/video_url', () => {
  // ── normalizeManuals / pickInstallVideo 的單元測已於 2026-08-08 隨函式搬到 rpm-attachments.test.ts
  //    (rpm-transform.ts 破 400 行、鐵則 6 拆檔)。本區只留 transformGroup 層的接線行為。
  // ── transformGroup:群級彙整跨全變體(codex 關卡1 must-fix)+ 供應商級 gate ──
  const irBase: SourceProductRow = {
    supplier_slug: 'gbracing', main_sku: 'GB-IR', sku: 'GB-IR', highlights_zh: null, pdf_urls: null, pdf_docs: null, video_urls: null,
    product_name: 'Case', product_name_zh: '護蓋',
    description: null, category_zh: '護蓋', major_category_zh: '操控部品',
    vehicle_label: null, fitment_parsed: null,
    spec: null, price_retail: '5000',
    image_url: null, images: [], stock_status: 'in_stock',
  };
  const GB_IR_CTX: GroupTransformContext = {
    brandId: 'brand-gb', categoryId: 'cat-ops', handlePrefix: 'gbracing',
    subtitleTag: '操控部品', syncDescription: true, syncInstallResources: true, appendManualFilename: false,
  };

  it('🔴 群級彙整:某變體有 PDF、另一變體沒有 → 仍收(非只看 basis / 第一列)', () => {
    const variants = [
      { ...irBase, sku: 'GB-IR-A', pdf_urls: null }, // 第一列空
      { ...irBase, sku: 'GB-IR-B', pdf_urls: ['https://gb.eu/m.pdf'] }, // 第二列有
    ];
    const { product } = runGroup('GB-IR', variants, null, GB_IR_CTX);
    expect(product.manuals).toEqual([{ label: '安裝說明書', url: 'https://gb.eu/m.pdf' }]);
  });

  it('🔴 群級彙整:跨變體多支去重保序 + 影片取第一支 YouTube', () => {
    const variants = [
      { ...irBase, sku: 'A', pdf_urls: ['https://gb.eu/a.pdf'], video_urls: ['https://youtu.be/dQw4w9WgXcQ'] },
      { ...irBase, sku: 'B', pdf_urls: ['https://gb.eu/a.pdf', 'https://gb.eu/b.pdf'] }, // a.pdf 跨變體重複
    ];
    const { product } = runGroup('GB-IR', variants, null, GB_IR_CTX);
    expect(product.manuals).toEqual([
      { label: '安裝說明書 1', url: 'https://gb.eu/a.pdf' },
      { label: '安裝說明書 2', url: 'https://gb.eu/b.pdf' },
    ]);
    expect(product.video_url).toBe('https://youtu.be/dQw4w9WgXcQ');
  });

  // ── 來源 null 防清空(2026-08-07)──
  // 🔴 這組取代原本那條「來源全空 → manuals=[] / video_url=null(key 恆在)」——那條把 bug 釘死成契約:
  //    官方詳情 API 暫掛時來源這兩欄會整批變 null,寫 [] 就等於清光客人全部說明書(報價單交接檔 §7)。
  //    新契約:null(來源沒說話)⇒ 省 key 保留現值;[](來源說「沒有」)⇒ 照寫。
  //    ⚠️ 一律用 Object.hasOwn 斷 key 不存在,不用 `product.manuals === undefined` ——
  //       後者對「key 在、值 undefined」也綠 = 假綠,而值 undefined 進 upsert 仍會被 postgrest 當欄位送出。

  it('🔴 來源 pdf_urls/video_urls 整群皆 null → 省兩 key(保留現值、不清空)', () => {
    const { product } = runGroup('GB-IR', [irBase], null, GB_IR_CTX); // irBase 兩欄皆 null
    expect(Object.hasOwn(product, 'manuals')).toBe(false);
    expect(Object.hasOwn(product, 'video_url')).toBe(false);
  });

  it('🔴 來源給空陣列(明確「沒有」)→ 兩 key 照寫 [] / null(真空是真相、不保留舊值)', () => {
    const emptyArr = [{ ...irBase, pdf_urls: [], video_urls: [] }];
    const { product } = runGroup('GB-IR', emptyArr, null, GB_IR_CTX);
    expect(Object.hasOwn(product, 'manuals')).toBe(true);
    expect(Object.hasOwn(product, 'video_url')).toBe(true);
    expect(product.manuals).toEqual([]);
    expect(product.video_url).toBeNull();
  });

  it('🔴 兩欄各判各的:PDF 有值 + 影片全 null → 只展開 manuals(單欄故障不連累另一欄)', () => {
    const pdfOnly = [{ ...irBase, pdf_urls: ['https://gb.eu/m.pdf'], video_urls: null }];
    const { product } = runGroup('GB-IR', pdfOnly, null, GB_IR_CTX);
    expect(Object.hasOwn(product, 'manuals')).toBe(true);
    expect(product.manuals).toEqual([{ label: '安裝說明書', url: 'https://gb.eu/m.pdf' }]);
    expect(Object.hasOwn(product, 'video_url')).toBe(false);
  });

  it('🔴 兩欄各判各的(反向):影片有值 + PDF 全 null → 只展開 video_url', () => {
    const videoOnly = [{ ...irBase, pdf_urls: null, pdf_docs: null, video_urls: ['https://youtu.be/dQw4w9WgXcQ'] }];
    const { product } = runGroup('GB-IR', videoOnly, null, GB_IR_CTX);
    expect(Object.hasOwn(product, 'video_url')).toBe(true);
    expect(product.video_url).toBe('https://youtu.be/dQw4w9WgXcQ');
    expect(Object.hasOwn(product, 'manuals')).toBe(false);
  });

  it('群級判定用 some 不用 every:群內一列 null、另一列有值 → 仍展開(彙整行為不變)', () => {
    const mixed = [
      { ...irBase, sku: 'GB-IR-A', pdf_urls: null },
      { ...irBase, sku: 'GB-IR-B', pdf_urls: ['https://gb.eu/m.pdf'] },
    ];
    const { product } = runGroup('GB-IR', mixed, null, GB_IR_CTX);
    expect(Object.hasOwn(product, 'manuals')).toBe(true);
    expect(product.manuals).toEqual([{ label: '安裝說明書', url: 'https://gb.eu/m.pdf' }]);
  });

  it('🔴 syncInstallResources=false(rpm)→ 省 manuals/video_url key(凍結不覆寫、byte 錨延伸)', () => {
    const rpmIr = [{ ...irBase, supplier_slug: 'rpm', pdf_urls: ['https://x/m.pdf'], video_urls: ['https://youtu.be/x'] }];
    const { product } = runGroup('GB-IR', rpmIr, null, RPM_CTX); // RPM_CTX.syncInstallResources=false
    expect('manuals' in product).toBe(false);
    expect('video_url' in product).toBe(false);
  });

  // ── 合約 v5:pdf_docs 接線 + 兩欄逐列擇一(2026-08-08、主視窗 E-174-A Q1=A)──
  // 🔴 「絕不合併」在這層的意思:同一列永遠只取一欄 ⇒ 建構上不可能同一份文件列兩次。
  //    實查佐證(2026-08-08 00:0x):pdf_docs 的 URL 串與 pdf_urls 相等,合併會讓每份文件出現兩次。

  it('🔴 該列有 pdf_docs → 只用 pdf_docs,同一列的 pdf_urls 完全不看(絕不合併)', () => {
    // ⚠️ 這條測試的形狀是被突變逼出來的:原本寫成「兩欄裝同一個 URL」,結果把實作改成
    //    【合併兩欄】也照樣全綠 —— URL 去重會把合併產生的重複項吃掉,觀察值由別的機制供應
    //    ⇒ 零判別力。改成「pdf_urls 多帶一個 pdf_docs 沒有的 URL」才分得出擇一 vs 合併:
    //    擇一 ⇒ 只有 x.pdf;合併 ⇒ 會多出 stale.pdf。
    const both = [{
      ...irBase,
      pdf_docs: [{ doc_type: 'parts_diagram', url: 'https://gb.eu/x.pdf' }],
      pdf_urls: ['https://gb.eu/x.pdf', 'https://gb.eu/stale.pdf'],
    }];
    const { product } = runGroup('GB-IR', both, null, GB_IR_CTX);
    expect(product.manuals).toEqual([{ label: '零件分解圖', url: 'https://gb.eu/x.pdf' }]);
  });

  it('🔴 該列 pdf_docs=null → 退回 pdf_urls(裸 URL 走 ?? install)= 五家 5,049 群今日行為不變', () => {
    // 2026-08-08 實查:gbracing/evotech/lightech/cncracing/bonamici 的 pdf_docs 整欄仍 null
    const legacy = [{ ...irBase, pdf_docs: null, pdf_urls: ['https://gb.eu/m.pdf'] }];
    const { product } = runGroup('GB-IR', legacy, null, GB_IR_CTX);
    expect(product.manuals).toEqual([{ label: '安裝說明書', url: 'https://gb.eu/m.pdf' }]);
  });

  it('🔴 逐列擇一、非群級擇一:A 列有 pdf_docs、B 列只有 pdf_urls → 兩列各走各的', () => {
    // A 列的 pdf_urls 刻意多帶一個 pdf_docs 沒有的 URL(同上一條的理由:否則合併與擇一無法分辨)
    const mixed = [
      { ...irBase, sku: 'A', pdf_docs: [{ doc_type: 'other', url: 'https://gb.eu/a.pdf' }], pdf_urls: ['https://gb.eu/a.pdf', 'https://gb.eu/a-stale.pdf'] },
      { ...irBase, sku: 'B', pdf_docs: null, pdf_urls: ['https://gb.eu/b.pdf'] },
    ];
    const { product } = runGroup('GB-IR', mixed, null, GB_IR_CTX);
    expect(product.manuals).toEqual([
      { label: '文件', url: 'https://gb.eu/a.pdf' },       // A 走 pdf_docs 的 doc_type
      { label: '安裝說明書', url: 'https://gb.eu/b.pdf' }, // B 走 pdf_urls 的 ?? install
    ]);
  });

  it('🔴 pdfSeen 看兩欄:pdf_docs=null 但 pdf_urls 有值 → 仍展開 key(不可誤判成「來源沒說話」而凍結)', () => {
    const legacy = [{ ...irBase, pdf_docs: null, pdf_urls: [] }];
    const { product } = runGroup('GB-IR', legacy, null, GB_IR_CTX);
    expect(Object.hasOwn(product, 'manuals')).toBe(true); // 來源說「沒有」⇒ 照寫空
    expect(product.manuals).toEqual([]);
  });

  it('🔴 兩欄皆 null 才算來源沒說話 → 省 key(片 1 防清空仍成立)', () => {
    const { product } = runGroup('GB-IR', [{ ...irBase, pdf_docs: null, pdf_urls: null }], null, GB_IR_CTX);
    expect(Object.hasOwn(product, 'manuals')).toBe(false);
  });

  it('🔴 驗收硬項:三欄皆 null(=7 家零附件的來源形狀)→ 省 key ⇒ DB 終態不變', () => {
    // 交接檔 §6:eazigrip/samco/rpm/motogadget/extreme/front3d/materya 共 5,554 群三欄恆 null。
    // 口徑=**DB 終態**逐位不變(主視窗 E-173-A Q2=A):省 key ⇒ ON CONFLICT 不覆寫 ⇒ 既有 [] 原地不動;
    // 新列吃 products.manuals 的 DEFAULT '[]'。payload 本身與片 1 前不同,那正是片 1 要修的行為。
    //
    // ⚠️ 誠實邊界(Fable 對抗審 N2):原本寫成迴圈跑七個 supplier_slug,但 transformGroup 根本不看
    //    supplier_slug(gate 一律來自 ctx)⇒ 那是同一條路徑重跑七次、測試名宣稱大於事實。這裡只驗
    //    真正的不變式一次;「那七家的來源確實三欄皆 null」是**報價單側的事實**,單元測證不到,
    //    靠交接檔 §6 與 2026-08-08 00:0x 唯讀實查背書。
    const row = { ...irBase, pdf_docs: null, pdf_urls: null, video_urls: null };
    // 刻意用 syncInstallResources=true 的 ctx:證明「省 key」是來源 null 決定的,不是靠 gate 關著才碰巧沒事
    const { product } = runGroup('X', [row], null, GB_IR_CTX);
    expect(Object.hasOwn(product, 'manuals')).toBe(false);
    expect(Object.hasOwn(product, 'video_url')).toBe(false);
  });

  it('🔴 違約形狀:pdf_docs=[] 但 pdf_urls 有值 → 退回 pdf_urls,不得寫 [] 清空(Fable 對抗審 C4)', () => {
    // 合約說故障時是 null 不是 [],但安全不能只靠上游守約 —— 這條把安全方向釘死。
    const rogue = [{ ...irBase, pdf_docs: [], pdf_urls: ['https://gb.eu/m.pdf'] }];
    const { product } = runGroup('GB-IR', rogue, null, GB_IR_CTX);
    expect(product.manuals).toEqual([{ label: '安裝說明書', url: 'https://gb.eu/m.pdf' }]);
  });

  it('兩欄都空 → 仍寫 [](真的沒有;上一條的 fallback 不會反過來讓空值寫不進去)', () => {
    const { product } = runGroup('GB-IR', [{ ...irBase, pdf_docs: [], pdf_urls: [] }], null, GB_IR_CTX);
    expect(Object.hasOwn(product, 'manuals')).toBe(true);
    expect(product.manuals).toEqual([]);
  });

  it('🔴 appendManualFilename 由 ctx 供給、逐家不同:同一批來源在兩家產出不同標籤', () => {
    const docs = [
      { doc_type: 'install', url: 'https://gb.eu/f/1198 2007-2013.pdf' },
      { doc_type: 'install', url: 'https://gb.eu/f/899 2012-2014.pdf' },
    ];
    const rows = [{ ...irBase, pdf_docs: docs }];
    const appended = runGroup('GB-IR', rows, null, { ...GB_IR_CTX, appendManualFilename: true }).product;
    const numbered = runGroup('GB-IR', rows, null, { ...GB_IR_CTX, appendManualFilename: false }).product;
    expect(appended.manuals!.map((m) => m.label)).toEqual([
      '安裝說明書(1198 2007-2013)', '安裝說明書(899 2012-2014)',
    ]);
    expect(numbered.manuals!.map((m) => m.label)).toEqual(['安裝說明書 1', '安裝說明書 2']);
  });
});

describe('下架權威鏡射(合約 §10、view v3 投影 delisted_at)', () => {
  const dBase: SourceProductRow = {
    supplier_slug: 'bonamici', main_sku: 'BON-D', sku: 'BON-D-A', highlights_zh: null, pdf_urls: null, pdf_docs: null, video_urls: null,
    product_name: 'Rearset', product_name_zh: '腳踏後移',
    description: null, category_zh: '腳踏', major_category_zh: '操控部品',
    vehicle_label: null, fitment_parsed: null,
    spec: null, price_retail: '9000',
    image_url: null, images: [], stock_status: 'in_stock',
  };
  const D_CTX: GroupTransformContext = {
    brandId: 'brand-bon', categoryId: 'cat-ops', handlePrefix: 'bonamici',
    subtitleTag: '操控部品', syncDescription: true, syncInstallResources: false, appendManualFilename: false,
  };

  it('來源未投影此欄(舊 view / 舊 fixture)→ null,行為與改前一致', () => {
    const { product } = runGroup('BON-D', [dBase], null, D_CTX);
    expect(product.delisted_at).toBeNull();
  });

  it('全部變體皆已下架 → 鏡射為整群下架(取最新時戳)', () => {
    const variants = [
      { ...dBase, sku: 'BON-D-A', delisted_at: '2026-07-09T00:00:00.000Z' },
      { ...dBase, sku: 'BON-D-B', delisted_at: '2026-07-11T00:00:00.000Z' },
    ];
    const { product } = runGroup('BON-D', variants, null, D_CTX);
    expect(product.delisted_at).toBe('2026-07-11T00:00:00.000Z');
  });

  it('🔴 只有部分變體下架 → 整群維持上架(比照 availability 的 bool_or,不可誤殺還在賣的變體)', () => {
    const variants = [
      { ...dBase, sku: 'BON-D-A', delisted_at: '2026-07-09T00:00:00.000Z' },
      { ...dBase, sku: 'BON-D-B', delisted_at: null },
    ];
    const { product } = runGroup('BON-D', variants, null, D_CTX);
    expect(product.delisted_at).toBeNull();
  });

  // 🔴 對抗審查 F1:上一條只鎖「群層」答案,若不同時斷言「那顆停產變體去哪了」= 假綠。
  //    停產變體必須被當成缺席(不進 sourceVariantSkus)→ 判孤兒 → 硬刪,否則會永遠掛在
  //    選項裡可下單:create_order 的下架擋阻只看產品層 delisted_at,部分停產群的產品層是 null。
  //    ⚠️ 直接 import 正式的 liveVariantsOf(不在測試裡複製一份邏輯,否則正式碼改壞測試仍綠)。

  it('🔴 F1 部分下架:停產變體必須被剔除(視同缺席→孤兒→硬刪),在售變體保留', () => {
    const variants = [
      { ...dBase, sku: 'BON-D-A', delisted_at: '2026-07-09T00:00:00.000Z' },
      { ...dBase, sku: 'BON-D-B', delisted_at: null },
    ];
    const live = liveVariantsOf(variants);
    expect(live.map((v) => v.sku)).toEqual(['BON-D-B']);
  });

  it('🔴 F1 整群下架:變體【全部保留】(產品層已擋單;全刪會撞變體刪除 10% 閘)', () => {
    const variants = [
      { ...dBase, sku: 'BON-D-A', delisted_at: '2026-07-09T00:00:00.000Z' },
      { ...dBase, sku: 'BON-D-B', delisted_at: '2026-07-10T00:00:00.000Z' },
    ];
    const live = liveVariantsOf(variants);
    expect(live.map((v) => v.sku)).toEqual(['BON-D-A', 'BON-D-B']);
  });

  it('F1 無任何停產:變體原封不動(零行為改變)', () => {
    const variants = [
      { ...dBase, sku: 'BON-D-A', delisted_at: null },
      { ...dBase, sku: 'BON-D-B' },
    ];
    expect(liveVariantsOf(variants).map((v) => v.sku)).toEqual(['BON-D-A', 'BON-D-B']);
  });

  it('商品復架(來源清空 delisted_at)→ 鏡射回 null,不需人工介入', () => {
    const variants = [{ ...dBase, sku: 'BON-D-A', delisted_at: null }];
    const { product } = runGroup('BON-D', variants, null, D_CTX);
    expect(product.delisted_at).toBeNull();
  });

  it('🔴 RPM byte 錨不破:rpm fixture 無此欄 → 仍為 null(key 位置與型別不變)', () => {
    const { product } = runGroup('APRILIA-01', APRILIA, 'Aprilia RS660', RPM_CTX);
    expect(product.delisted_at).toBeNull();
    expect(Object.keys(product)).toEqual(RPM_PRODUCT_KEYS);
  });
});

describe('🔴 群層與變體層必須用同一個變體集合(對抗審查:商品卡價格洩漏已剔除的停產變體)', () => {
  const pBase: SourceProductRow = {
    supplier_slug: 'cncracing', main_sku: 'PR320', sku: 'PR320-A', highlights_zh: null, pdf_urls: null, pdf_docs: null, video_urls: null,
    product_name: 'Lever', product_name_zh: '拉桿',
    description: null, category_zh: '拉桿', major_category_zh: '操控部品',
    vehicle_label: null, fitment_parsed: null,
    spec: null, price_retail: '2000',
    image_url: null, images: [], stock_status: 'in_stock',
  };
  const P_CTX: GroupTransformContext = {
    brandId: 'brand-cnc', categoryId: 'cat-ops', handlePrefix: 'cncracing',
    subtitleTag: '操控部品', syncDescription: true, syncInstallResources: false, appendManualFilename: false,
  };

  it('停產的最低價變體不可決定群價(群層必須吃 liveVariantsOf 的結果)', () => {
    const variants = [
      { ...pBase, sku: 'PR320-CHEAP', price_retail: '1000', delisted_at: '2026-07-09T00:00:00.000Z' },
      { ...pBase, sku: 'PR320-LIVE', price_retail: '2000', delisted_at: null },
    ];
    const live = liveVariantsOf(variants);
    const { product } = runGroup('PR320', live, null, P_CTX);
    expect(live.map((v) => v.sku)).toEqual(['PR320-LIVE']);
    expect(Number(product.price_general)).toBe(2000); // 不可是 1000(那顆變體已被剔除、站上不存在)
    expect(product.delisted_at).toBeNull(); // 部分停產 → 整群維持上架
  });

  it('整群停產:變體全保留、群價照舊算、群層帶最新下架時戳', () => {
    const variants = [
      { ...pBase, sku: 'PR320-A', price_retail: '1000', delisted_at: '2026-07-09T00:00:00.000Z' },
      { ...pBase, sku: 'PR320-B', price_retail: '2000', delisted_at: '2026-07-10T00:00:00.000Z' },
    ];
    const live = liveVariantsOf(variants);
    const { product, variantRows } = runGroup('PR320', live, null, P_CTX);
    expect(variantRows).toHaveLength(2);
    expect(product.delisted_at).toBe('2026-07-10T00:00:00.000Z');
  });
});
