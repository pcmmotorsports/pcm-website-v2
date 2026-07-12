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
  highlights: [],
  manuals: [],
  video_url: null,
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

// ── C4 接線:listAllProducts 全目錄分頁(繞 1000 上限、不綁 category)──
//   審查點:同 listAllByCategory 分頁正確性(迴圈終止 + 無重複/漏行)+ 🔴 **不 resolve category、不 .eq category_id**
//   (全目錄語意 = 撈整個公開目錄,非單一分類);故 from('categories') 若被觸碰即 throw(證未走分類 resolve)。

// products_public.range() 依呼叫序回各頁;記錄 eq 是否被呼叫(listAllProducts 不該疊 category_id)。
function makeAllProductsClient(pageSizes: number[]) {
  const rangeCalls: Array<[number, number]> = [];
  let eqCalled = false;
  let idx = 0;
  const products = {
    select() { return products; },
    eq() { eqCalled = true; return products; },
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
  const client = {
    from(t: string) {
      if (t === 'categories') throw new Error('listAllProducts 不該 resolve category(全目錄、不綁分類)');
      return products;
    },
  };
  return { client: client as unknown as SupabaseClient, rangeCalls, eqCalled: () => eqCalled };
}

describe('SupabaseProductAdapter.listAllProducts — 全目錄分頁(C4/#205)', () => {
  it('跨頁合併全目錄:1000 + 117 → 1117、range 連續非重疊、末頁<1000 即停、無重複 id、且不綁分類(未 .eq category_id / 未查 categories)', async () => {
    const { client, rangeCalls, eqCalled } = makeAllProductsClient([1000, 117]);
    const adapter = new SupabaseProductAdapter(client);

    const result = await adapter.listAllProducts();

    expect(result).toHaveLength(1117);
    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ]); // 連續非重疊視窗
    expect(new Set(result.map((p) => p.id)).size).toBe(1117); // 無重複/漏行
    expect(eqCalled()).toBe(false); // 🔴 全目錄:未疊 .eq(category_id)(from('categories') throw 亦已擋分類 resolve)
  });

  it('單頁(<1000)→ 一次 range 即停', async () => {
    const { client, rangeCalls } = makeAllProductsClient([420]);
    const adapter = new SupabaseProductAdapter(client);

    const result = await adapter.listAllProducts();

    expect(result).toHaveLength(420);
    expect(rangeCalls).toHaveLength(1);
  });

  it('恰為 PAGE_SIZE 整數倍:1000 + 0 → 1000、第二頁空頁正常停(無漏行、不無限迴圈)', async () => {
    const { client, rangeCalls } = makeAllProductsClient([1000, 0]);
    const adapter = new SupabaseProductAdapter(client);

    const result = await adapter.listAllProducts();

    expect(result).toHaveLength(1000);
    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('products 查詢 error → throw(fail-closed、fetchAllPaginated 不吞錯)', async () => {
    const products = {
      select() { return products; },
      order() { return products; },
      range() { return Promise.resolve({ data: null, error: { code: 'XX000', message: 'boom' } }); },
    };
    const client = { from: () => products };
    const adapter = new SupabaseProductAdapter(client as unknown as SupabaseClient);

    await expect(adapter.listAllProducts()).rejects.toMatchObject({ message: 'boom' });
  });
});

// ── perf/P2:listAllProducts({ limit })——limit 下推 DB、免撈全表(2026-07-08 效能修復 plan P2)──
//   審查點:limit ≤1000 走單次 .order('id').limit(n)、**不走 .range 分頁迴圈**;
//   亂序資料由 DB `.order` 定序(mock 斷言呼叫參數、回 id 升冪 rows);非正整數 fail-closed throw。

function makeLimitClient(rows: SupabaseProductRow[]) {
  const calls: { order: Array<[string, { ascending: boolean }]>; limit: number[]; range: Array<[number, number]> } = {
    order: [],
    limit: [],
    range: [],
  };
  const products = {
    select() { return products; },
    order(col: string, opts: { ascending: boolean }) { calls.order.push([col, opts]); return products; },
    limit(n: number) {
      calls.limit.push(n);
      return Promise.resolve({ data: rows.slice(0, n), error: null });
    },
    range(from: number, to: number) {
      calls.range.push([from, to]);
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
    },
  };
  const client = { from: () => products };
  return { client: client as unknown as SupabaseClient, calls };
}

describe('SupabaseProductAdapter.listAllProducts({ limit }) — limit 下推(perf/P2)', () => {
  it('limit=4 → 單次 .order(id 升冪).limit(4)、不走 .range 分頁、回前 4 筆', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => makeRow(i));
    const { client, calls } = makeLimitClient(rows);
    const adapter = new SupabaseProductAdapter(client);

    const result = await adapter.listAllProducts({ limit: 4 });

    expect(result).toHaveLength(4);
    expect(result.map((p) => p.id)).toEqual(['prod-0', 'prod-1', 'prod-2', 'prod-3']); // id 升冪前 4
    expect(calls.order).toEqual([['id', { ascending: true }]]);
    expect(calls.limit).toEqual([4]);
    expect(calls.range).toHaveLength(0); // 免撈全表:未走分頁迴圈
  });

  it('limit 非正整數(0 / 1.5)→ throw fail-closed、不打 DB', async () => {
    const { client, calls } = makeLimitClient([]);
    const adapter = new SupabaseProductAdapter(client);

    await expect(adapter.listAllProducts({ limit: 0 })).rejects.toThrow(/limit 須為正整數/);
    await expect(adapter.listAllProducts({ limit: -1 })).rejects.toThrow(/limit 須為正整數/);
    await expect(adapter.listAllProducts({ limit: 1.5 })).rejects.toThrow(/limit 須為正整數/);
    expect(calls.limit).toHaveLength(0);
    expect(calls.range).toHaveLength(0);
  });

  it('limit>1000(PostgREST 單查詢上限)→ 走分頁迴圈撈滿再裁切、不靜默截斷', async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => makeRow(i));
    const { client, calls } = makeLimitClient(rows);
    const adapter = new SupabaseProductAdapter(client);

    const result = await adapter.listAllProducts({ limit: 1200 });

    expect(result).toHaveLength(1200);
    expect(calls.limit).toHaveLength(0); // 不走單次 .limit(會被 PostgREST 砍到 1000)
    expect(calls.range).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    // 分頁路徑仍須逐頁 .order('id' 升冪)(K2 nit:防「移除 order」mutation 不紅)
    expect(calls.order).toEqual([
      ['id', { ascending: true }],
      ['id', { ascending: true }],
    ]);
    expect(result.map((p) => p.id).slice(0, 3)).toEqual(['prod-0', 'prod-1', 'prod-2']);
  });
});

// ── 前菜 D(M-4a):listAllProducts({ orderBy: 'created_desc' })——首頁「最新商品」──
//   審查點:排序改由 DB `.order('created_at' 遞減).order('id' 遞減)` 下推(mock 不實排、斷言呼叫參數);
//   id 遞減為 created_at 撞值 tie-break、保兩實作定序一致。省略 orderBy 時 byte 等價既有 id 升冪。
describe("SupabaseProductAdapter.listAllProducts({ orderBy: 'created_desc' }) — 最新商品(前菜 D)", () => {
  it('limit≤1000 → 單次 .order(created_at 遞減).order(id 遞減).limit(n)、不走 .range', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => makeRow(i));
    const { client, calls } = makeLimitClient(rows);
    const adapter = new SupabaseProductAdapter(client);

    const result = await adapter.listAllProducts({ limit: 4, orderBy: 'created_desc' });

    expect(result).toHaveLength(4);
    expect(calls.order).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
    expect(calls.limit).toEqual([4]);
    expect(calls.range).toHaveLength(0);
  });

  it('無 limit + created_desc → 走分頁迴圈撈全目錄(guard:orderBy 分支不炸、full-set 回傳)', async () => {
    // makePaginatedClient.order() 忽略參數、無法斷言排序欄位;此 case 守分頁分支帶 orderBy 仍正常撈滿。
    const { client, rangeCalls } = makePaginatedClient([1000, 3]);
    const adapter = new SupabaseProductAdapter(client);

    const result = await adapter.listAllProducts({ orderBy: 'created_desc' });

    expect(result).toHaveLength(1003);
    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });
});

// ── C1 接線:listCategories(全部分類 + 各分類上架商品數)──
//   mock 兩個查詢對象:
//   - from('categories').select(cols).order()        → 回分類註冊表
//   - from('products_public').select('id',{count,head}).eq('category_id',id) → 回 exact count
//   守門:count 查安全 view products_public(非 base products)、select 不含經銷欄、逐分類 eq category_id。

type CatRegistryRow = {
  id: string;
  name: string;
  raw_path: string;
  segments: unknown;
  parent_category_id: string | null;
  sort_order: number;
};

function makeCategoriesClient(
  categories: CatRegistryRow[],
  countByCatId: Record<string, number>,
) {
  const selectCalls: string[] = [];
  const tables: string[] = [];
  const countEqCols: string[] = [];
  const orderArgs: Array<[string, unknown]> = [];
  const countSelectOpts: unknown[] = [];

  function categoriesBuilder() {
    const b = {
      select(cols: string) {
        selectCalls.push(cols);
        return b;
      },
      order(col: string, opts: unknown) {
        orderArgs.push([col, opts]);
        return Promise.resolve({ data: categories, error: null });
      },
    };
    return b;
  }
  function productsPublicBuilder() {
    const b = {
      select(cols: string, opts?: unknown) {
        selectCalls.push(cols);
        if (opts !== undefined) countSelectOpts.push(opts);
        return b;
      },
      eq(col: string, val: string) {
        countEqCols.push(col);
        return Promise.resolve({ count: countByCatId[val] ?? 0, error: null });
      },
    };
    return b;
  }
  const client = {
    from(table: string) {
      tables.push(table);
      if (table === 'categories') return categoriesBuilder();
      if (table === 'products_public') return productsPublicBuilder();
      throw new Error(`listCategories 不該查 ${table}(僅 categories + products_public)`);
    },
  };
  return {
    client: client as unknown as SupabaseClient,
    selectCalls,
    tables,
    countEqCols,
    orderArgs,
    countSelectOpts,
  };
}

const CATS: CatRegistryRow[] = [
  { id: 'cat-carbon', name: '碳纖維部品', raw_path: '碳纖維部品', segments: ['碳纖維部品'], parent_category_id: null, sort_order: 0 },
  { id: 'cat-handle', name: '操控部品', raw_path: '操控部品', segments: ['操控部品'], parent_category_id: null, sort_order: 1 },
  { id: 'cat-empty', name: '排氣系統', raw_path: '排氣系統', segments: ['排氣系統'], parent_category_id: null, sort_order: 2 },
];
const COUNTS: Record<string, number> = { 'cat-carbon': 1117, 'cat-handle': 5, 'cat-empty': 0 };

describe('SupabaseProductAdapter.listCategories — C1 接線', () => {
  it('回全部分類 + 各分類上架商品數、空分類 count=0、依 sortOrder 遞增映射正確', async () => {
    const { client } = makeCategoriesClient(CATS, COUNTS);
    const adapter = new SupabaseProductAdapter(client);

    const result = await adapter.listCategories();

    expect(result).toHaveLength(3);
    // 逐欄映射(id / name / path / parentId / sortOrder / productCount)
    expect(result[0]).toEqual({
      id: 'cat-carbon',
      name: '碳纖維部品',
      path: { raw: '碳纖維部品', segments: ['碳纖維部品'] },
      parentId: null,
      sortOrder: 0,
      productCount: 1117,
    });
    // 空分類仍回、count=0(不過濾、消費端決定)
    expect(result[2]).toMatchObject({ id: 'cat-empty', productCount: 0 });
    // 順序沿 categories 查詢序(sortOrder 遞增)、Promise.all 不打亂
    expect(result.map((c) => c.sortOrder)).toEqual([0, 1, 2]);
    expect(result.map((c) => c.productCount)).toEqual([1117, 5, 0]);
  });

  it('經銷價防護:count 走 products_public 安全 view(非 base products)、select 不含經銷欄、逐分類 eq category_id、分類查詢請求 sort_order 遞增', async () => {
    const { client, selectCalls, tables, countEqCols, orderArgs, countSelectOpts } =
      makeCategoriesClient(CATS, COUNTS);
    const adapter = new SupabaseProductAdapter(client);

    await adapter.listCategories();

    // adapter 確實向 DB 請求 sort_order 遞增排序(真實排序由 DB 執行、非靠 mock 預排)
    expect(orderArgs).toEqual([['sort_order', { ascending: true }]]);
    // count 查詢確實傳 head:true + count:'exact'(head:true=零 row 傳輸、避 1000-row 截斷)
    expect(countSelectOpts).toEqual(
      CATS.map(() => ({ count: 'exact', head: true })),
    );

    // 從不查 base products 表(mock from() 對非白名單 table 會 throw、額外保險再斷言)
    expect(tables).not.toContain('products');
    // count 查詢命中安全 view、且數量 = 分類數(逐分類一次)
    expect(tables.filter((t) => t === 'products_public')).toHaveLength(CATS.length);
    // 每個 select 投射都不含經銷敏感欄
    for (const cols of selectCalls) {
      for (const dealer of DEALER_COLUMNS) {
        expect(cols).not.toContain(dealer);
      }
    }
    // count 過濾鍵恆為 category_id
    expect(countEqCols).toEqual(['category_id', 'category_id', 'category_id']);
  });

  it('segments 髒 jsonb → 退化守契約:非陣列→[]、陣列含非 string→濾除、不 throw', async () => {
    const dirty: CatRegistryRow[] = [
      { id: 'c1', name: 'X', raw_path: 'X', segments: null, parent_category_id: null, sort_order: 0 },
      { id: 'c2', name: 'Y', raw_path: 'Y', segments: [1, '排氣管', null, '管'], parent_category_id: null, sort_order: 1 },
    ];
    const { client } = makeCategoriesClient(dirty, { c1: 3, c2: 4 });
    const adapter = new SupabaseProductAdapter(client);

    const result = await adapter.listCategories();

    // 非陣列 → []
    expect(result[0]).toEqual({
      id: 'c1',
      name: 'X',
      path: { raw: 'X', segments: [] },
      parentId: null,
      sortOrder: 0,
      productCount: 3,
    });
    // 陣列含非 string → 只留 string 元素
    expect(result[1]).toEqual({
      id: 'c2',
      name: 'Y',
      path: { raw: 'Y', segments: ['排氣管', '管'] },
      parentId: null,
      sortOrder: 1,
      productCount: 4,
    });
  });
});

// ── R2a 推薦引擎正規化反查:listByFitment(product_fitments)+ listGeneral ──
//   審查點:① listByFitment 兩步(product_fitments 過濾 → products_public .in)、年份範圍重疊
//   filter 字面正確、product_id 去重、空結果短路不查 products_public;② listGeneral fitments=[]
//   通用款;③ 兩者走 products_public 安全 view、投射不含經銷欄。thenable builder mock 讓
//   list 路徑 `await query` 解析 { data, error }(list method 直接 await、非 .single())。

interface FitmentMockCaptured {
  tables: string[];
  pfEq: Record<string, unknown>;
  pfOr?: string;
  publicSelect?: string;
  publicIn?: unknown[];
  generalEq?: [string, unknown];
}

function makeFitmentMock(
  pfRows: { product_id: string }[],
  publicRows: SupabaseProductRow[],
) {
  const captured: FitmentMockCaptured = { tables: [], pfEq: {} };

  const pfBuilder = {
    select() {
      return pfBuilder;
    },
    eq(col: string, val: unknown) {
      captured.pfEq[col] = val;
      return pfBuilder;
    },
    or(filter: string) {
      captured.pfOr = filter;
      return pfBuilder;
    },
    then(resolve: (v: { data: unknown; error: null }) => void) {
      resolve({ data: pfRows, error: null });
    },
  };

  const publicBuilder = {
    select(cols: string) {
      captured.publicSelect = cols;
      return publicBuilder;
    },
    in(_col: string, vals: unknown[]) {
      captured.publicIn = vals;
      return publicBuilder;
    },
    eq(col: string, val: unknown) {
      captured.generalEq = [col, val];
      return publicBuilder;
    },
    then(resolve: (v: { data: unknown; error: null }) => void) {
      resolve({ data: publicRows, error: null });
    },
  };

  const client = {
    from(table: string) {
      captured.tables.push(table);
      return table === 'product_fitments' ? pfBuilder : publicBuilder;
    },
  };
  return { client: client as unknown as SupabaseClient, captured };
}

describe('SupabaseProductAdapter.listByFitment — R2a 正規化反查(product_fitments)', () => {
  it('查 product_fitments(brand+model 等值 + 年份範圍重疊 or)→ product_id 去重 → products_public .in、安全投射', async () => {
    const { client, captured } = makeFitmentMock(
      [{ product_id: 'p1' }, { product_id: 'p1' }, { product_id: 'p2' }],
      [
        { ...baseRow, id: 'p1', handle: 'h1' },
        { ...baseRow, id: 'p2', handle: 'h2' },
      ],
    );
    const adapter = new SupabaseProductAdapter(client);

    const result = await adapter.listByFitment({
      motoBrand: 'Ducati',
      modelCode: 'Streetfighter V4',
      yearStart: 2021,
      yearEnd: 2021,
    });

    // 步驟①:product_fitments 等值 + 年份範圍重疊(對齊 helpers/fitment matchFitmentYear)
    expect(captured.tables[0]).toBe('product_fitments');
    expect(captured.pfEq).toEqual({
      moto_brand: 'Ducati',
      model_code: 'Streetfighter V4',
    });
    expect(captured.pfOr).toBe(
      'year_start.is.null,and(year_start.lte.2021,or(year_end.is.null,year_end.gte.2021))',
    );
    // 步驟②:product_id 去重(p1 兩筆 → 一筆)後 .in products_public
    expect(captured.tables).toContain('products_public');
    expect(captured.publicIn).toEqual(['p1', 'p2']);
    // 安全:products_public 安全 view、投射不含經銷欄
    for (const col of DEALER_COLUMNS) {
      expect(captured.publicSelect).not.toContain(col);
    }
    expect(result).toHaveLength(2);
  });

  it('spec 無 yearStart → 不加年份 or filter(不限年份、對齊 matchFitmentYear 早退)', async () => {
    const { client, captured } = makeFitmentMock(
      [{ product_id: 'p1' }],
      [{ ...baseRow, id: 'p1' }],
    );
    const adapter = new SupabaseProductAdapter(client);

    await adapter.listByFitment({ motoBrand: 'Ducati', modelCode: 'Panigale V4' });

    expect(captured.pfOr).toBeUndefined();
  });

  it('開放式 spec(yearEnd null → specEnd Infinity)→ or filter 省 lte 段', async () => {
    const { client, captured } = makeFitmentMock(
      [{ product_id: 'p1' }],
      [{ ...baseRow, id: 'p1' }],
    );
    const adapter = new SupabaseProductAdapter(client);

    await adapter.listByFitment({
      motoBrand: 'BMW',
      modelCode: 'S 1000 RR',
      yearStart: 2020,
      yearEnd: null,
    });

    expect(captured.pfOr).toBe(
      'year_start.is.null,or(year_end.is.null,year_end.gte.2020)',
    );
  });

  it('product_fitments 空 → 回 [] 且不查 products_public(短路)', async () => {
    const { client, captured } = makeFitmentMock([], []);
    const adapter = new SupabaseProductAdapter(client);

    const result = await adapter.listByFitment({
      motoBrand: 'X',
      modelCode: 'Y',
      yearStart: 2020,
    });

    expect(result).toEqual([]);
    expect(captured.tables).not.toContain('products_public');
  });
});

describe('SupabaseProductAdapter.listGeneral — R2a 通用款(fitments 空陣列)', () => {
  it('查 products_public fitments=[]、安全投射、回 mapped', async () => {
    const { client, captured } = makeFitmentMock(
      [],
      [{ ...baseRow, id: 'g1', handle: 'gen-1' }],
    );
    const adapter = new SupabaseProductAdapter(client);

    const result = await adapter.listGeneral();

    expect(captured.tables).toContain('products_public');
    expect(captured.generalEq).toEqual(['fitments', '[]']);
    for (const col of DEALER_COLUMNS) {
      expect(captured.publicSelect).not.toContain(col);
    }
    expect(result).toHaveLength(1);
    expect(result[0]?.handle).toBe('gen-1');
  });
});
