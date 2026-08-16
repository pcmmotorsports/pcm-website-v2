const TEST_POOL_LIMIT = 100;
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

    // 🔴 2026-08-08 R2 must-fix:detail 投射**只能** embed 這個關係一次。
    //   `PRODUCT_SELECT_DETAIL_VIEW` 自本日起已含 `product_variants_public(id)`(為了 list 的
    //   variantCount);`..._WITH_VARIANTS` 若仍由它組,展開後會變成
    //   `…, product_variants_public(id), product_variants_public(id, sku, …)` = 同一關係 embed 兩次。
    //   PostgREST 對未取別名的重複 embed 行為不確定:報錯 ⇒ 本方法整條 throw = PDP 全掛;
    //   或解析取到只有 id 的那份 ⇒ PDP `variants=[]`、`cart/actions.ts` 的 fail-closed 失效、
    //   變體商品以群代表價結帳。
    //   🔴 補這條的理由是**突變實測**:退回吃 VIEW 的寫法時,全套測試零紅。
    expect(
      captured.select.match(/product_variants_public/g)?.length,
      'detail 投射把 product_variants_public embed 了不只一次(見上方註解:PDP 會掛或拿到空變體)',
    ).toBe(1);
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
  const selectCalls: string[] = [];
  let eqCalled = false;
  let idx = 0;
  const products = {
    select(cols: string) { selectCalls.push(cols); return products; },
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
  return { client: client as unknown as SupabaseClient, rangeCalls, selectCalls, eqCalled: () => eqCalled };
}

describe('SupabaseProductAdapter.listAllProducts — 全目錄分頁(C4/#205)', () => {
  // 🔴 2026-08-08 Q28:list 投射必須 embed `product_variants_public(id)`。
  //
  // 這條守的不是「效能」而是**正確性**:少了它,`variantCount` 恆 0 ⇒ 列表卡片分不出
  // 「這款真的沒變體」與「有變體但沒帶下來」⇒ 快速加購把有變體商品加成幽靈品項
  // (購物車 fail-closed 丟掉那行、客人卻看到加購成功、還刪不掉)。
  // 🔴 **加這條的理由是突變實測**:拿掉 adapter 那段 embed 時,全套測試**沒有任何一條紅**
  // ——mapper 與卡片的測試都餵自己的 fixture、碰不到真正的投射字串。這是幽靈品項復發的最短路徑。
  // ⚠️ 同時釘住「只投 id」:多投 spec/images 會讓 :74 那個「避 N+1 jsonb 膨脹」的理由失效。
  it('🔴 list 投射 embed product_variants_public(id) 且只投 id(幽靈品項回歸守門)', async () => {
    const { client, selectCalls } = makeAllProductsClient([0]);
    const adapter = new SupabaseProductAdapter(client);

    await adapter.listAllProducts();

    expect(selectCalls.length).toBeGreaterThan(0);
    for (const cols of selectCalls) {
      expect(cols).toContain('product_variants_public(id)');
      // 只投 id:不得把 detail 那套 7 欄搬進 list 投射
      expect(cols).not.toContain('product_variants_public(id, sku');
      for (const heavy of ['spec', 'images', 'price_general']) {
        expect(cols).not.toContain(`product_variants_public(${heavy}`);
      }
    }
  });

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
  eqs: [string, unknown][];
  publicSelect?: string;
  generalEq?: [string, unknown];
  publicOr?: string;
  publicOrReferencedTable?: string;
  publicOrder?: [string, boolean];
  publicLimit?: number;
}

/**
 * 🔴 2026-08-17:本 mock 由「兩個 builder(product_fitments + products_public)」改為單一 builder。
 *
 * **不是因為 mock 壞了,是因為被測的行為換了**:`queryProductsByFitment` 從兩步查詢
 * (撈 `product_fitments` 列 → `.in('id', ids)`)改為一步 `!inner` join(頂層是商品、fitment 當 filter)。
 * ⇒ 舊斷言(`captured.pfOr` / 「空結果不查 products_public」)驗的是**已經不存在的步驟**,
 *   留著它們會變成「測一個不會發生的狀態」。
 * 📎 改的是**被測行為的描述**,不是為了讓紅的變綠而放寬期望值 —— 新斷言比舊的更嚴
 *   (多驗了 `!inner` 字面、embedded filter 的掛載表、`limit`/`order` 有沒有下推)。
 */
function makeFitmentMock(
  _unusedLegacyPfRows: { product_id: string }[],
  publicRows: SupabaseProductRow[],
) {
  const captured: FitmentMockCaptured = { tables: [], eqs: [] };

  const builder = {
    select(cols: string) {
      captured.publicSelect = cols;
      return builder;
    },
    eq(col: string, val: unknown) {
      captured.eqs.push([col, val]);
      captured.generalEq = [col, val];
      return builder;
    },
    or(filter: string, opts?: { referencedTable?: string }) {
      captured.publicOr = filter;
      captured.publicOrReferencedTable = opts?.referencedTable;
      return builder;
    },
    order(col: string, opts?: { ascending?: boolean }) {
      captured.publicOrder = [col, opts?.ascending !== false];
      return builder;
    },
    limit(n: number) {
      captured.publicLimit = n;
      return builder;
    },
    then(resolve: (v: { data: unknown; error: null }) => void) {
      resolve({ data: publicRows, error: null });
    },
  };

  const client = {
    from(table: string) {
      captured.tables.push(table);
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, captured };
}

describe('SupabaseProductAdapter.listByFitment — 一步 !inner 反查(2026-08-17 由兩步改)', () => {
  it('頂層查 products_public + product_fitments!inner，filter 掛在被內嵌那張表、年份 or 帶 referencedTable、安全投射', async () => {
    const { client, captured } = makeFitmentMock(
      [],
      [
        { ...baseRow, id: 'p1', handle: 'h1' },
        { ...baseRow, id: 'p2', handle: 'h2' },
      ],
    );
    const adapter = new SupabaseProductAdapter(client);

    const result = await adapter.listByFitment(
      {
        motoBrand: 'Ducati',
        modelCode: 'Streetfighter V4',
        yearStart: 2021,
        yearEnd: 2021,
      },
      TEST_POOL_LIMIT,
    );

    // 🔴 一步:只查 products_public，不再有 product_fitments 那一趟
    expect(captured.tables).toEqual(['products_public']);
    expect(captured.publicSelect).toContain('product_fitments!inner(');
    // filter 掛在【被內嵌的那張表】上，不是商品表
    expect(captured.eqs).toEqual([
      ['product_fitments.moto_brand', 'Ducati'],
      ['product_fitments.model_code', 'Streetfighter V4'],
    ]);
    expect(captured.publicOr).toBe(
      'year_start.is.null,and(year_start.lte.2021,or(year_end.is.null,year_end.gte.2021))',
    );
    // 🔴 這一條是舊測試沒有的：or 掛錯表會讓年份條件套到商品上 ⇒ 靜默回錯結果
    expect(captured.publicOrReferencedTable).toBe('product_fitments');
    // 🔴 上限與排序有沒有真的下推 DB（本片的重點；沒下推就回到「靜默停在 1000」）
    expect(captured.publicLimit).toBe(TEST_POOL_LIMIT);
    expect(captured.publicOrder).toEqual(['handle', true]);
    // 安全:products_public 安全 view、投射不含經銷欄
    for (const col of DEALER_COLUMNS) {
      expect(captured.publicSelect).not.toContain(col);
    }
    expect(result).toHaveLength(2);
  });

  it('spec 無 yearStart → 不加年份 or filter(不限年份、對齊 matchFitmentYear 早退)', async () => {
    const { client, captured } = makeFitmentMock([], [{ ...baseRow, id: 'p1' }]);
    const adapter = new SupabaseProductAdapter(client);

    await adapter.listByFitment(
      { motoBrand: 'Ducati', modelCode: 'Panigale V4' },
      TEST_POOL_LIMIT,
    );

    expect(captured.publicOr).toBeUndefined();
    // 沒有年份條件時，上限仍要下推（否則這條路徑又變回無上限）
    expect(captured.publicLimit).toBe(TEST_POOL_LIMIT);
  });

  it('開放式 spec(yearEnd null → specEnd Infinity)→ or filter 省 lte 段', async () => {
    const { client, captured } = makeFitmentMock([], [{ ...baseRow, id: 'p1' }]);
    const adapter = new SupabaseProductAdapter(client);

    await adapter.listByFitment(
      {
        motoBrand: 'BMW',
        modelCode: 'S 1000 RR',
        yearStart: 2020,
        yearEnd: null,
      },
      TEST_POOL_LIMIT,
    );

    expect(captured.publicOr).toBe(
      'year_start.is.null,or(year_end.is.null,year_end.gte.2020)',
    );
    expect(captured.publicOrReferencedTable).toBe('product_fitments');
  });

  it('查無相容商品 → 回 []', async () => {
    const { client } = makeFitmentMock([], []);
    const adapter = new SupabaseProductAdapter(client);

    const result = await adapter.listByFitment(
      { motoBrand: 'X', modelCode: 'Y', yearStart: 2020 },
      TEST_POOL_LIMIT,
    );

    // ⚠️ 舊測試在這裡驗的是「不查 products_public(短路)」——那是兩步查法才有的性質。
    //    一步查法沒有可短路的第二趟 ⇒ 那條斷言【描述一個不會發生的狀態】，已移除而非放寬。
    expect(result).toEqual([]);
  });

  it('poolLimit 非正整數 → throw(fail-closed，不靜靜代入預設值)', async () => {
    const { client } = makeFitmentMock([], []);
    const adapter = new SupabaseProductAdapter(client);

    await expect(
      adapter.listByFitment({ motoBrand: 'X', modelCode: 'Y' }, 0),
    ).rejects.toThrow(/poolLimit 須為正整數/);
    await expect(
      adapter.listByFitment({ motoBrand: 'X', modelCode: 'Y' }, 1.5),
    ).rejects.toThrow(/poolLimit 須為正整數/);
  });
});

describe('SupabaseProductAdapter.listGeneral — R2a 通用款(fitments 空陣列)', () => {
  it('查 products_public fitments=[]、安全投射、回 mapped', async () => {
    const { client, captured } = makeFitmentMock(
      [],
      [{ ...baseRow, id: 'g1', handle: 'gen-1' }],
    );
    const adapter = new SupabaseProductAdapter(client);

    const result = await adapter.listGeneral(TEST_POOL_LIMIT);

    expect(captured.tables).toContain('products_public');
    expect(captured.generalEq).toEqual(['fitments', '[]']);
    for (const col of DEALER_COLUMNS) {
      expect(captured.publicSelect).not.toContain(col);
    }
    expect(result).toHaveLength(1);
    expect(result[0]?.handle).toBe('gen-1');
  });
});

describe('SupabaseProductAdapter.searchByKeyword — 分頁穩定序(2026-08-17 V 窗掃出)', () => {
  // 🔴 本 describe 是新增的:`searchByKeyword` 在本檔原本**零測試**
  //    （數法:改動前 `grep -n 'searchByKeyword' 本檔` ⇒ 零命中）。
  function makeSearchMock() {
    const captured: {
      orders: [string, boolean][];
      range?: [number, number];
      countOption?: string;
    } = { orders: [] };
    const builder = {
      select(_cols: string, options?: { count?: string }) {
        captured.countOption = options?.count;
        return builder;
      },
      or() {
        return builder;
      },
      order(col: string, o?: { ascending?: boolean }) {
        captured.orders.push([col, o?.ascending !== false]);
        return builder;
      },
      range(from: number, to: number) {
        captured.range = [from, to];
        return Promise.resolve({ data: [], error: null, count: 0 });
      },
    };
    const client = {
      from() {
        return builder;
      },
    };
    return { client: client as unknown as SupabaseClient, captured };
  }

  it('分頁查詢必須帶穩定序 —— 沒有 ORDER BY 時 SQL 不保證列順序，兩頁是兩次獨立查詢', async () => {
    const { client, captured } = makeSearchMock();
    const adapter = new SupabaseProductAdapter(client);

    await adapter.searchByKeyword('avon', { limit: 20, offset: 40 });

    // 🔴 這一格擋的是「有人日後把 .order 拿掉當作簡化」
    expect(captured.orders).toEqual([['id', true]]);
  });

  it('.range 兩端皆含 —— offset 40 + limit 20 ⇒ [40, 59] 而不是 [40, 60]', async () => {
    const { client, captured } = makeSearchMock();
    const adapter = new SupabaseProductAdapter(client);

    await adapter.searchByKeyword('avon', { limit: 20, offset: 40 });

    // 寫成 offset+limit 會每頁多撈一筆、跨頁重複（V 窗整理的分頁族第 2 條）
    expect(captured.range).toEqual([40, 59]);
  });

  it('空字串查詢短路 —— 不打 DB', async () => {
    const { client, captured } = makeSearchMock();
    const adapter = new SupabaseProductAdapter(client);

    const res = await adapter.searchByKeyword('   ', { limit: 20, offset: 0 });

    expect(res).toEqual({ items: [], total: 0 });
    // 負向對照:上面兩格的 captured 會被填，這格不該被填 ⇒ 證明 mock 真的在記錄
    expect(captured.range).toBeUndefined();
    expect(captured.orders).toEqual([]);
  });
});
