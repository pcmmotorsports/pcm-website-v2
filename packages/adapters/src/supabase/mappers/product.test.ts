import { describe, expect, it } from 'vitest';
import {
  mapDomainProductToSupabase,
  mapSupabaseProductToDomain,
  mapVariantRow,
  type SupabaseProductRow,
  type SupabaseVariantRow,
} from './product';

// ─────────────────────────────────────────────────────────────
// M-1-16c-2 變體資料層 mapper 單測(backlog #203)
//   - mapVariantRow:wire variant row → domain ProductVariant
//   - mapSupabaseProductToDomain 變體整合:embed → variants(sortOrder 排序)/ list 路徑 → []
// 🔴 經銷價防護 contract(working-style 第 35 條):
//   - SupabaseVariantRow 型別本就無 price_store / metadata(view 物理排除)
//   - mapVariantRow 輸出 store / premiumStore = dummy 0(非 price_general)、不洩經銷價
// ─────────────────────────────────────────────────────────────

const baseVariantRow: SupabaseVariantRow = {
  id: 'var-1',
  sku: 'BMS1K2KR03-G-F',
  spec: { weave: 'Forged', finish: 'Glossy' },
  price_general: 8400,
  availability: 'in-stock',
  images: ['https://cdn.shopify.com/a.jpg', 'https://cdn.shopify.com/b.jpg'],
  sort_order: 0,
};

const baseProductRow: SupabaseProductRow = {
  id: 'prod-1',
  external_id: 'prod-1',
  title: '單座蓋',
  subtitle: 'Aprilia RSV4 · 碳纖維',
  description: '<p>desc</p>',
  highlights: [],
  manuals: [],
  video_url: null,
  handle: 'rpm-bms1k2kr03',
  price_general: 6800,
  fitments: [],
  images: ['https://cdn.shopify.com/group.jpg'],
  availability: 'in-stock',
  brand_id: 'brand-1',
  category_id: 'cat-1',
  metadata: {},
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T01:00:00Z',
  brands: {
    id: 'brand-1',
    name: 'RPM CARBON',
    slug: 'rpm-carbon',
    description: null,
    logo_url: null,
    premium_extra_pct: 0,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
  },
  categories: {
    id: 'cat-1',
    parent_category_id: null,
    name: '碳纖維部品',
    raw_path: '碳纖維部品',
    segments: ['碳纖維部品'],
    sort_order: 0,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
  },
};

describe('mapVariantRow', () => {
  it('happy path:還原 sku / spec / availability / sortOrder / images + general 價', () => {
    const v = mapVariantRow(baseVariantRow);
    expect(v.id).toBe('var-1');
    expect(v.sku).toBe('BMS1K2KR03-G-F');
    expect(v.spec).toEqual({ weave: 'Forged', finish: 'Glossy' });
    expect(v.availability).toBe('in-stock');
    expect(v.sortOrder).toBe(0);
    expect(v.images).toEqual([
      'https://cdn.shopify.com/a.jpg',
      'https://cdn.shopify.com/b.jpg',
    ]);
    expect(v.priceByTier.general.amount).toBe(8400);
    expect(v.priceByTier.general.currency).toBe('TWD');
  });

  it('🔴 經銷價防護:store / premiumStore = dummy 0(非 price_general)、不洩經銷價', () => {
    const v = mapVariantRow({ ...baseVariantRow, price_general: 8400 });
    expect(v.priceByTier.store.amount).toBe(0);
    expect(v.priceByTier.premiumStore.amount).toBe(0);
    // 確認 dummy 不是把 general 灌進去(若誤把 price_general 當經銷價會等於 8400)
    expect(v.priceByTier.store.amount).not.toBe(8400);
    expect(v.priceByTier.premiumStore.amount).not.toBe(8400);
  });

  it('special 第三維 spec 還原(weave × finish × special)', () => {
    const v = mapVariantRow({
      ...baseVariantRow,
      spec: { weave: 'Plain', finish: 'Glossy', special: '12K' },
    });
    expect(v.spec).toEqual({ weave: 'Plain', finish: 'Glossy', special: '12K' });
  });

  it('空 images [] 合法(16c fallback 商品圖)', () => {
    const v = mapVariantRow({ ...baseVariantRow, images: [] });
    expect(v.images).toEqual([]);
  });

  it('price_general null → throw(16b 應已定價)', () => {
    expect(() => mapVariantRow({ ...baseVariantRow, price_general: null })).toThrow(
      /price_general/,
    );
  });

  it('runtime guard:spec 非 string 值 → throw(防 import 錯 shape 進 client)', () => {
    expect(() =>
      mapVariantRow({
        ...baseVariantRow,
        spec: { weave: 'Forged', finish: 123 as unknown as string },
      }),
    ).toThrow(/spec\.finish 非 string/);
  });

  it('runtime guard:images 非 string 元素 → throw', () => {
    expect(() =>
      mapVariantRow({
        ...baseVariantRow,
        images: ['ok.jpg', { url: 'x' } as unknown as string],
      }),
    ).toThrow(/images\[1\] 非 string/);
  });

  // #264:jsonb 來源 spec/images 可為 null(試點 spec=NULL 未經 rpm-transform ?? {} 轉、或歷史列);
  //   舊版 Object.entries(null)/null.map() 會 throw → 整個商品詳情頁 adapter 層 500。harden 後視為空、不 throw。
  it('#264:spec=null → 空 spec、不 throw(防商品頁整頁 500)', () => {
    const v = mapVariantRow({ ...baseVariantRow, spec: null });
    expect(v.spec).toEqual({});
    expect(v.sku).toBe(baseVariantRow.sku); // 其餘欄位正常映射
  });

  it('#264:images=null → 空陣列、不 throw(靠 16c 商品代表圖 fallback)', () => {
    const v = mapVariantRow({ ...baseVariantRow, images: null });
    expect(v.images).toEqual([]);
  });

  it('#264:spec 與 images 同時 null → 兩者空、不 throw', () => {
    const v = mapVariantRow({ ...baseVariantRow, spec: null, images: null });
    expect(v.spec).toEqual({});
    expect(v.images).toEqual([]);
  });
});

describe('mapSupabaseProductToDomain 變體整合', () => {
  it('detail 路徑(embed product_variants_public)→ variants 填真 + 依 sortOrder 穩定排序', () => {
    const p = mapSupabaseProductToDomain({
      ...baseProductRow,
      product_variants_public: [
        { ...baseVariantRow, id: 'v2', sku: 'B-2', sort_order: 2 },
        { ...baseVariantRow, id: 'v0', sku: 'B-0', sort_order: 0 },
        { ...baseVariantRow, id: 'v1', sku: 'B-1', sort_order: 1 },
      ],
    });
    expect(p.variants.map((v) => v.sortOrder)).toEqual([0, 1, 2]);
    expect(p.variants.map((v) => v.sku)).toEqual(['B-0', 'B-1', 'B-2']);
  });

  it('list 路徑(無 embed key)→ variants 空陣列(避 N+1)', () => {
    const p = mapSupabaseProductToDomain(baseProductRow);
    expect(p.variants).toEqual([]);
  });

  // M-1-16c-4b:productCode read/write round-trip(codex 關卡1 must-fix 2 + consider 5)
  it('read:productCode ← wire external_id(非 UUID id)', () => {
    const p = mapSupabaseProductToDomain({ ...baseProductRow, external_id: 'RPM-DCC01' });
    expect(p.productCode).toBe('RPM-DCC01');
    expect(p.productCode).not.toBe(p.id);
  });

  it('write:external_id ← domain.productCode(round-trip、非 domain.id placeholder)', () => {
    const domain = mapSupabaseProductToDomain({ ...baseProductRow, external_id: 'RPM-DCC01' });
    const wire = mapDomainProductToSupabase(domain, { brandId: 'b-1', categoryId: 'c-1' });
    expect(wire.external_id).toBe('RPM-DCC01');
    expect(wire.external_id).not.toBe(domain.id);
  });

  it('sortOrder 並列(DB DEFAULT 0)→ sku tie-breaker 保確定性排序(codex 關卡2 consider 1)', () => {
    const p = mapSupabaseProductToDomain({
      ...baseProductRow,
      product_variants_public: [
        { ...baseVariantRow, id: 'vc', sku: 'SKU-C', sort_order: 0 },
        { ...baseVariantRow, id: 'va', sku: 'SKU-A', sort_order: 0 },
        { ...baseVariantRow, id: 'vb', sku: 'SKU-B', sort_order: 0 },
      ],
    });
    expect(p.variants.map((v) => v.sku)).toEqual(['SKU-A', 'SKU-B', 'SKU-C']);
  });

  // A/#270:highlights guard — jsonb 來源 shape 不保證 → mapper 收斂為乾淨 string[](擋髒資料進 client)
  it('read:highlights 正常字串陣列 → 原樣還原', () => {
    const p = mapSupabaseProductToDomain({ ...baseProductRow, highlights: ['G5 鈦合金', 'DLC 塗層'] });
    expect(p.highlights).toEqual(['G5 鈦合金', 'DLC 塗層']);
  });

  it('read:highlights = null / 非陣列 / 混非字串 → guard 收斂(恆 string[])', () => {
    expect(mapSupabaseProductToDomain({ ...baseProductRow, highlights: null }).highlights).toEqual([]);
    expect(
      mapSupabaseProductToDomain({ ...baseProductRow, highlights: { a: 1 } as unknown as unknown[] }).highlights,
    ).toEqual([]); // 非陣列 jsonb(object)→ []
    expect(
      mapSupabaseProductToDomain({ ...baseProductRow, highlights: ['乾淨', 123, null, { x: 1 }] as unknown[] })
        .highlights,
    ).toEqual(['乾淨']); // 混入非字串 → 只留 string
  });

  it('write:highlights round-trip(save mapper 持久化 domain.highlights)', () => {
    const domain = mapSupabaseProductToDomain({ ...baseProductRow, highlights: ['賣點一', '賣點二'] });
    const wire = mapDomainProductToSupabase(domain, { brandId: 'b-1', categoryId: 'c-1' });
    expect(wire.highlights).toEqual(['賣點一', '賣點二']);
  });

  // #270:manuals/video_url guard — jsonb 元素 shape 不保證 → 收斂為乾淨 ProductManual[] / optional string(擋髒資料進 client)
  it('read:manuals 正常物件陣列 → 原樣還原(sizeKB 為 number 才留)', () => {
    const p = mapSupabaseProductToDomain({
      ...baseProductRow,
      manuals: [
        { label: '安裝說明書', url: 'https://x/a.pdf' },
        { label: '接線圖', url: 'https://x/b.pdf', sizeKB: 1200 },
      ],
    });
    expect(p.manuals).toEqual([
      { label: '安裝說明書', url: 'https://x/a.pdf' },
      { label: '接線圖', url: 'https://x/b.pdf', sizeKB: 1200 },
    ]);
  });

  it('read:manuals 髒項(缺 label/url、非物件、sizeKB 非 number)→ guard 濾除(恆 ProductManual[])', () => {
    expect(mapSupabaseProductToDomain({ ...baseProductRow, manuals: null }).manuals).toEqual([]);
    expect(
      mapSupabaseProductToDomain({ ...baseProductRow, manuals: { a: 1 } as unknown as unknown[] }).manuals,
    ).toEqual([]); // 非陣列 jsonb(object)→ []
    expect(
      mapSupabaseProductToDomain({
        ...baseProductRow,
        manuals: [
          { label: '有效', url: 'https://x/ok.pdf' },
          { label: '缺 url' }, // 缺 url → 濾
          { url: 'https://x/no-label.pdf' }, // 缺 label → 濾
          'not-an-object', // 非物件 → 濾
          { label: '壞大小', url: 'https://x/c.pdf', sizeKB: '1200' }, // sizeKB 非 number → 丟 sizeKB 保 label+url
        ] as unknown[],
      }).manuals,
    ).toEqual([
      { label: '有效', url: 'https://x/ok.pdf' },
      { label: '壞大小', url: 'https://x/c.pdf' },
    ]);
  });

  it('read:video_url 字串 → passthrough;null / 純空白 → undefined', () => {
    expect(
      mapSupabaseProductToDomain({ ...baseProductRow, video_url: 'https://youtu.be/dQw4w9WgXcQ' }).videoUrl,
    ).toBe('https://youtu.be/dQw4w9WgXcQ');
    expect(mapSupabaseProductToDomain({ ...baseProductRow, video_url: null }).videoUrl).toBeUndefined();
    expect(mapSupabaseProductToDomain({ ...baseProductRow, video_url: '   ' }).videoUrl).toBeUndefined();
  });

  it('write:manuals/video_url round-trip(save mapper 持久化;videoUrl undefined→null)', () => {
    const domain = mapSupabaseProductToDomain({
      ...baseProductRow,
      manuals: [{ label: '安裝說明書', url: 'https://x/a.pdf' }],
      video_url: 'https://youtu.be/dQw4w9WgXcQ',
    });
    const wire = mapDomainProductToSupabase(domain, { brandId: 'b-1', categoryId: 'c-1' });
    expect(wire.manuals).toEqual([{ label: '安裝說明書', url: 'https://x/a.pdf' }]);
    expect(wire.video_url).toBe('https://youtu.be/dQw4w9WgXcQ');
    const noVideo = mapDomainProductToSupabase({ ...domain, videoUrl: undefined }, { brandId: 'b-1', categoryId: 'c-1' });
    expect(noVideo.video_url).toBeNull(); // videoUrl undefined → null 持久化(對齊 products.video_url nullable)
  });
});
