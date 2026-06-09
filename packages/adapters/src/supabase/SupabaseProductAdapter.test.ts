// SupabaseProductAdapter.test.ts — DB 查詢層 SELECT 投射經銷價防護回歸守門(2026-06-05 安全稽核 M-11)。
//
// 經銷價防護鏈的 DB 查詢層:read method 必須只向「安全 view」(products_public / product_variants_public)
// 取「不含經銷欄」的投射。稽核發現此層原本零自動化測試 —— 若有人把 PRODUCT_SELECT_* 改成含 price_store /
// price_by_tier / metadata,或把查詢從 products_public 改成 base products 表,CI 不會紅燈。
//
// 本測試用注入式 mock SupabaseClient 攔截 `.from(table)` 與 `.select(cols)` 的實際參數,斷言:
//   - 查的是 products_public 安全 view(非 base products 表);
//   - SELECT 投射字串不含任何經銷敏感欄(price_store / price_by_tier / metadata / cost);
//   - 變體 embed 走 product_variants_public 安全 view(非 base product_variants 表)、且只投射 price_general。
// 註:DB 層另有 view 物理排除 + column GRANT 兩道硬防護(MCP 實測 42703);本測試守的是「應用層投射選擇」
//   這一道,三層任一被改壞都該被某層測試/DB 擋下。
//
// mock 讓 findById/findByHandle 的 .single() 回 PGRST116(not-found)→ findSingle 回 null,
//   故不需建完整 row、只攔截 SELECT 參數即可。

import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProductId } from '@pcm/domain';
import { SupabaseProductAdapter } from './SupabaseProductAdapter';
import type { SupabaseProductRow } from './mappers/product';

const DEALER_COLUMNS = ['price_store', 'price_by_tier', 'metadata', 'cost'];

function makeMockClient() {
  const captured = { table: '', select: '' };
  const builder = {
    select(cols: string) {
      captured.select = cols;
      return builder;
    },
    eq() {
      return builder;
    },
    single() {
      // PGRST116 = not-found → findSingle 回 null(免建完整 row)
      return Promise.resolve({
        data: null,
        error: { code: 'PGRST116', message: 'not found' },
      });
    },
  };
  const client = {
    from(table: string) {
      captured.table = table;
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, captured };
}

describe('SupabaseProductAdapter — SELECT 投射經銷價防護(M-11 安全回歸)', () => {
  it('findByHandle:走 products_public 安全 view、投射不含經銷欄、變體 embed 走 product_variants_public', async () => {
    const { client, captured } = makeMockClient();
    const adapter = new SupabaseProductAdapter(client);

    const result = await adapter.findByHandle('any-handle');
    expect(result).toBeNull(); // PGRST116 → null

    // 查安全 view、非 base products 表
    expect(captured.table).toBe('products_public');
    // 投射不含任何經銷敏感欄
    for (const col of DEALER_COLUMNS) {
      expect(captured.select).not.toContain(col);
    }
    // 變體 embed 走 product_variants_public 安全 view(非 base product_variants 表)、只投射 price_general
    expect(captured.select).toContain('product_variants_public');
    expect(captured.select).not.toContain('product_variants('); // 不直接查 base 變體表
    expect(captured.select).toContain('price_general');
  });

  it('findById:同走 products_public 安全 view、同投射不含經銷欄', async () => {
    const { client, captured } = makeMockClient();
    const adapter = new SupabaseProductAdapter(client);

    const result = await adapter.findById('p-001' as unknown as ProductId);
    expect(result).toBeNull();

    expect(captured.table).toBe('products_public');
    for (const col of DEALER_COLUMNS) {
      expect(captured.select).not.toContain(col);
    }
  });
});

// ── #220 listAllByCategory 分頁迴圈(繞 PostgREST/Supabase Max rows=1000)──
//   審查點:迴圈終止(末頁 <1000 停)+ 合併無重複/漏行(.order('id') 穩定 + .range 連續非重疊視窗)。
//   mapper-valid row(對齊 mappers/product.test baseProductRow)讓 mapSupabaseProductToDomain 不 throw。

const baseRow: SupabaseProductRow = {
  id: 'prod-0',
  external_id: 'prod-0',
  title: '碳纖維單座蓋',
  subtitle: 'Aprilia RSV4 · 碳纖維',
  description: '<p>d</p>',
  handle: 'rpm-0',
  price_general: 6800,
  fitments: [],
  images: ['https://cdn.example/g.jpg'],
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
function makeRow(i: number): SupabaseProductRow {
  return { ...baseRow, id: `prod-${i}`, external_id: `prod-${i}`, handle: `rpm-${i}` };
}

// categories.single() 回 cat-1;products_public.range() 依呼叫序回各頁(每頁 row 數 = pageSizes[i],id 連續不重疊)
function makePaginatedClient(pageSizes: number[]) {
  const rangeCalls: Array<[number, number]> = [];
  let idx = 0;
  const products = {
    select() { return products; },
    eq() { return products; },
    order() { return products; },
    range(from: number, to: number) {
      rangeCalls.push([from, to]);
      const n = pageSizes[idx] ?? 0;
      idx += 1;
      return Promise.resolve({
        data: Array.from({ length: n }, (_, j) => makeRow(from + j)),
        error: null,
      });
    },
  };
  const categories = {
    select() { return categories; },
    eq() { return categories; },
    single() { return Promise.resolve({ data: { id: 'cat-1' }, error: null }); },
  };
  const client = { from: (t: string) => (t === 'categories' ? categories : products) };
  return { client: client as unknown as SupabaseClient, rangeCalls };
}

const CARBON = { raw: '碳纖維部品', segments: ['碳纖維部品'] };

describe('SupabaseProductAdapter.listAllByCategory — 分頁迴圈(#220)', () => {
  it('跨頁合併:1000 + 115 → 1115、range 連續非重疊、末頁<1000 即停、無重複 id', async () => {
    const { client, rangeCalls } = makePaginatedClient([1000, 115]);
    const adapter = new SupabaseProductAdapter(client);

    const result = await adapter.listAllByCategory(CARBON);

    expect(result).toHaveLength(1115);
    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ]); // 連續非重疊視窗
    expect(new Set(result.map((p) => p.id)).size).toBe(1115); // 無重複/漏行
  });

  it('單頁(<1000)→ 一次 range 即停', async () => {
    const { client, rangeCalls } = makePaginatedClient([500]);
    const adapter = new SupabaseProductAdapter(client);

    const result = await adapter.listAllByCategory(CARBON);

    expect(result).toHaveLength(500);
    expect(rangeCalls).toHaveLength(1);
  });

  it('恰為 PAGE_SIZE 整數倍:1000 + 0 → 1000、第二頁空頁正常停(無漏行、不無限迴圈)', async () => {
    const { client, rangeCalls } = makePaginatedClient([1000, 0]);
    const adapter = new SupabaseProductAdapter(client);

    const result = await adapter.listAllByCategory(CARBON);

    expect(result).toHaveLength(1000);
    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('category 不存在 → [](fail-closed、不查 products)', async () => {
    const client = {
      from: (t: string) => {
        if (t === 'categories') {
          const b = {
            select() { return b; },
            eq() { return b; },
            single() {
              return Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'nf' } });
            },
          };
          return b;
        }
        throw new Error('category 不存在時不該查 products_public');
      },
    };
    const adapter = new SupabaseProductAdapter(client as unknown as SupabaseClient);

    const result = await adapter.listAllByCategory(CARBON);

    expect(result).toEqual([]);
  });
});
