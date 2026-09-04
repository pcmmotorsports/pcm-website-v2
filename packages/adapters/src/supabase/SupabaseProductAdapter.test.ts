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
import { partNumberPattern, buildIlikeOrFilter } from './helpers/product-query-support';

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
    // 🔴 正向斷言【必留】(2026-08-18 V 窗抓、突變普查證):上面全是【否定斷言】⇒
    //    `captured.select=''`(沒呼叫 select)或 `select *`(帶回 price_store)都會讓 not.toContain
    //    恆真、這格恆綠。正向斷言把「量具真的量到一個非空、且是安全欄的投射」釘住 ——
    //    findByHandle 的同款免疫是【意外】得來的(那條 toContain 本為驗 embed 次數而寫),
    //    本格是【刻意】補上。⚠️ 有人「簡化」時把這行拿掉 = findById 對 `select *` 手滑恆綠、
    //    而 `select *` 正好會把經銷價帶回。
    expect(captured.select).toContain('price_general');
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
      // 🔴 原本這裡**直接 resolve** ⇒ 串第二個 `.order()` 會炸(`.order is not a function`)。
      //    改成回 builder + thenable(supabase 的 builder 本來就是 thenable)——
      //    ⇒ 📌 而**這個 mock 的形狀本身就是一道限制**:它只允許一個 `.order()`,
      //      所以「加第二個排序鍵」這件事**在改 mock 之前是測不出來的**。
      order(col: string, opts: unknown) {
        orderArgs.push([col, opts]);
        return b;
      },
      // ⚠️ **而這個 `then` 讓守門變薄了一格, 寫出來**:
      //    舊 mock 的 `select()` 回**非 thenable** ⇒ 一個 `.order()` 都不呼叫時 `await` 拿到 builder 本身、
      //    `data` 是 undefined ⇒ **連映射那格測試也會紅**(兩格擋)。
      //    新 mock 把 `then` 掛在 builder 上 ⇒ **完全不排序照樣回全量資料** ⇒ 只剩下面 `orderArgs`
      //    那一格擋得住。⇒ 📌 **我的突變只拿掉一個 `.order`, 沒測「兩個都拿掉」那個形狀。**
      then(resolve: (v: { data: CatRegistryRow[]; error: null }) => unknown) {
        return Promise.resolve({ data: categories, error: null }).then(resolve);
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
    // 🔴🔴 **三個鍵, 而順序不能反**:`name` 買「跨得過重灌 seed」(id 是 gen_random_uuid),
    //    `id` 買「全序」(name 也不唯一 —— 正式站實查 `(sort_order, name)` 還有 3 組平手:
    //    `水管束環` / `防爆水管組` / `維修零件`)。⇒ 📌 **兩格各買一半, 缺一個都不行。**
    //    少了它, `sort_order` 並列的列回傳順序沒有保證
    //    (正式站實查:117 個分類只有 30 個相異 sort_order ⇒ 87 列撞號)。
    // 🛑 而本格驗的是【我們有沒有【要求】那個順序】, **不是**【DB 有沒有照做】——
    //    後者要真 DB 才驗得到, 而這裡是 mock。⇒ 📌 射程寫出來, 不要讓它假裝更大。
    expect(orderArgs).toEqual([
      ['sort_order', { ascending: true }],
      ['name', { ascending: true }],
      ['id', { ascending: true }],
    ]);
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

// ── 新品區排除「維修零件」大類(Sean 2026-08-27 拍【甲】= 照大類切)──
//   🔴 作法:對【已經 embed 的 categories】過濾, 不另外查一輪 category_id。
//      `PRODUCT_SELECT_DETAIL` 的尾巴本來就有 `categories(raw_path, segments)`(:69)。
//   審查點:①select 換成 `categories!inner`(不加的話只會把 embed 變 null、列照回 ⇒ 排除完全失效)
//          ②兩條條件(大類本身 + 子類), 不是一條 `like '維修零件%'`(那會多殺「維修零件座」根類)
//          ③預設不排除、也不換 select(共用方法不得被改預設行為)
//          ④不複製那串 20 欄投影(複製一份就會漂)
function makeInnerClient(rows: SupabaseProductRow[]) {
  const calls: { select: string[]; not: Array<[string, string, string]> } = { select: [], not: [] };
  const products = {
    select(cols: string) { calls.select.push(cols); return products; },
    not(col: string, op: string, val: string) { calls.not.push([col, op, val]); return products; },
    order() { return products; },
    limit(n: number) { return Promise.resolve({ data: rows.slice(0, n), error: null }); },
    range(from: number, to: number) { return Promise.resolve({ data: rows.slice(from, to + 1), error: null }); },
  };
  const client = {
    from: (t: string) => {
      if (t === 'categories') throw new Error('不該再查一輪 categories —— raw_path 已在 embed 裡');
      return products;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe('SupabaseProductAdapter.listAllProducts — 排除大類(新品區排維修零件)', () => {
  it('排除時:select 換成 categories!inner, 並疊【兩條】not(大類本身 + 子類)', async () => {
    const { client, calls } = makeInnerClient(Array.from({ length: 10 }, (_, i) => makeRow(i)));
    const adapter = new SupabaseProductAdapter(client);

    await adapter.listAllProducts({ limit: 10, orderBy: 'created_desc', excludeCategoryFirstSegment: '維修零件' });

    // ① 不加 !inner 的話 PostgREST 只會把不符的 embed 變 null、那一列照樣回來 ⇒ 排除失效
    expect(calls.select[0]).toContain('categories!inner(raw_path, segments)');
    // ④ 沒有複製投影:其餘欄位逐字還在
    expect(calls.select[0]).toContain('sound_clips');
    expect(calls.select[0]).toContain('product_variants_public(id)');
    // ② 兩條, 不是一條 —— 單段大類與子類各一
    expect(calls.not).toEqual([
      ['categories.raw_path', 'eq', '維修零件'],
      ['categories.raw_path', 'like', '維修零件 · %'],
    ]);
  });

  // 🔴 這一格釘判準本身:只寫 `like '維修零件%'` 會把假想的「維修零件座」根類一起殺掉,
  //    而那個誤殺在畫面上只是「新品少了幾件」—— 與「本來就沒那麼多新品」長得一樣。
  it('子類那條用 `維修零件 · %`(帶分隔符), 不是裸前綴 `維修零件%`', async () => {
    const { client, calls } = makeInnerClient([makeRow(0)]);
    const adapter = new SupabaseProductAdapter(client);

    await adapter.listAllProducts({ limit: 1, excludeCategoryFirstSegment: '維修零件' });

    const likes = calls.not.filter(([, op]) => op === 'like').map(([, , v]) => v);
    expect(likes).toEqual(['維修零件 · %']);
    expect(likes).not.toContain('維修零件%');
  });

  // 🔴 共用方法:不傳選項 ⇒ select 不得變、也不得疊 not。
  it('不傳選項 → select 維持原樣(無 !inner)、不疊 not', async () => {
    const { client, calls } = makeInnerClient([makeRow(0)]);
    const adapter = new SupabaseProductAdapter(client);

    await adapter.listAllProducts({ limit: 1, orderBy: 'created_desc' });

    expect(calls.select[0]).toContain('categories(raw_path, segments)');
    expect(calls.select[0]).not.toContain('!inner');
    expect(calls.not).toHaveLength(0);
  });

  // 🔴 codex nit 訂正:上一版這格寫「排除後仍回滿 10 筆 ⇒ 證明濾在 DB 那側」——
  //   **而 mock 的 `not()` 根本不會過濾資料** ⇒ 就算排除完全失效, 它也照樣回 10 筆
  //   ⇒ 那一格是【恆綠】的, 它證不了它宣稱的東西。
  //   ⇒ 改成釘真正可測的那條性質:**adapter 不得在拿到列之後自己再濾一輪**。
  //     DB 那側回什麼它就回什麼 —— 因為在真的 DB 上, 事後才濾會讓列數少於 limit,
  //     而畫面上「少了幾格」與「就是只有這麼多新品」長得一樣。
  //   📌 而「排除真的有效」那件事, 是在【真 PostgREST】上量的, 不在這支 mock 裡:
  //     108 件(其中維修零件 4)⇒ 不加 !inner 回 108(全失效)/ 加了回 104 ⇒ 108−104=4。
  it('adapter 不得事後再濾:DB 回幾筆就回幾筆', async () => {
    const { client } = makeInnerClient(Array.from({ length: 10 }, (_, i) => makeRow(i)));
    const adapter = new SupabaseProductAdapter(client);

    const result = await adapter.listAllProducts({ limit: 10, excludeCategoryFirstSegment: '維修零件' });

    // 🔴 這一格會紅的世界:有人在 adapter 裡補一行 `.filter(...)` 想「保險再濾一次」
    //    ⇒ mock 回的 10 筆會被砍 ⇒ 這裡就不是 10 了。
    expect(result).toHaveLength(10);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// listByBrand —— 2026-09-01 補(線【帳號】`-7a`;主視窗 `-0a` 裁【甲】)
//
// 🔴 **為什麼這一格今天才補**:`packages/ports/src/IProductRepository.contract.ts` 裡有一個
//    `listByBrand` 的 `it.todo`, 而**那支 contract 的 `runProductRepositoryContract()` 全 repo 零真呼叫端**
//    ⇒ 那 15 個 `it.todo` 從來沒有被 vitest 收集過, **連「skipped」都不會出現在報告裡**。
//    ⇒ ⇒ 而 `InMemoryProductRepository.test.ts:183` 有測 —— **那是 InMemory 那一層**,
//        而這支 Supabase adapter 的 `listByBrand`(`SupabaseProductAdapter.ts:356`)沒有。
//
// 🔴 **而它是【活的】, 不是死路**:production 真呼叫端 =
//    `apps/storefront/src/lib/recommendations/rule-based-engine.ts:159-160`(推薦引擎)。
//    ⚠️ 而 `rule-based-engine.test.ts` 測的是【引擎】—— 它自己 stub 了一個 `listByBrand`
//    ⇒ **引擎有測, 而那句 Supabase 查詢沒有。**
//
// 🛑🛑 **這幾格證不到什麼(先讀, 不要把它們讀成「這個查詢是對的」)**:
//    本檔的 mock 攔的是 `.from()` / `.select()` / `.eq()` / `.order()` / `.limit()` 的**參數**
//    ⇒ 它驗的是「**這支 adapter 有沒有組出對的查詢**」,
//    **不是「那個查詢在真的 DB 上回對的列」** —— 後者只有真 Postgres 量得到, 而本檔沒有。
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 依 table 分流的 mock:`categories` 走 `.single()`(給 resolveCategoryId 用),
 * `products_public` 走 `.order().limit()` 回列。
 *
 * @param categoryRow `null` = 該分類查無(PGRST116)⇒ resolveCategoryId 回 null
 */
function makeBrandClient(opts: {
  rows: SupabaseProductRow[];
  categoryRow: { id: string } | null;
  productsError?: { message: string };
}) {
  const calls = {
    tables: [] as string[],
    selects: [] as string[],
    eqs: [] as Array<[string, unknown]>,
    order: null as null | [string, { ascending: boolean }],
    limit: null as null | number,
  };
  const productsBuilder = {
    select(cols: string) {
      calls.selects.push(cols);
      return productsBuilder;
    },
    eq(col: string, val: unknown) {
      calls.eqs.push([col, val]);
      return productsBuilder;
    },
    order(col: string, o: { ascending: boolean }) {
      calls.order = [col, o];
      return productsBuilder;
    },
    limit(n: number) {
      calls.limit = n;
      return Promise.resolve(
        opts.productsError
          ? { data: null, error: opts.productsError }
          : { data: opts.rows, error: null },
      );
    },
  };
  const categoriesBuilder = {
    select() {
      return categoriesBuilder;
    },
    eq() {
      return categoriesBuilder;
    },
    single() {
      return Promise.resolve(
        opts.categoryRow === null
          ? { data: null, error: { code: 'PGRST116', message: 'not found' } }
          : { data: opts.categoryRow, error: null },
      );
    },
  };
  const client = {
    from(table: string) {
      calls.tables.push(table);
      return table === 'categories' ? categoriesBuilder : productsBuilder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe('SupabaseProductAdapter.listByBrand', () => {
  const BRAND = 'b-akrapovic';

  it('打 products_public 安全 view、投射不含經銷欄、依 brand_id 過濾、order handle、limit poolLimit', async () => {
    const { client, calls } = makeBrandClient({ rows: [], categoryRow: null });
    const adapter = new SupabaseProductAdapter(client);

    await adapter.listByBrand(BRAND, 7);

    expect(calls.tables).toEqual(['products_public']); // 沒碰 base products 表、也沒碰 categories
    expect(calls.eqs).toEqual([['brand_id', BRAND]]);
    expect(calls.order).toEqual(['handle', { ascending: true }]);
    expect(calls.limit).toBe(7);
    for (const col of DEALER_COLUMNS) {
      expect(calls.selects.join(' ')).not.toContain(col);
    }
  });

  it('poolLimit 非正整數 ⇒ throw(不發查詢)', async () => {
    const { client, calls } = makeBrandClient({ rows: [], categoryRow: null });
    const adapter = new SupabaseProductAdapter(client);

    await expect(adapter.listByBrand(BRAND, 0)).rejects.toThrow();
    // 🔴 而「有沒有發查詢」要單獨驗 —— 一個先查再擋的實作也會 throw, 而它多打了一次 DB
    expect(calls.tables).toEqual([]);
  });

  it('給 categoryRaw 且解得到 ⇒ 分類 filter【下推 DB】(多一個 .eq),不是拉回來再篩', async () => {
    const { client, calls } = makeBrandClient({ rows: [], categoryRow: { id: 'cat-1' } });
    const adapter = new SupabaseProductAdapter(client);

    await adapter.listByBrand(BRAND, 5, '排氣管');

    expect(calls.tables).toEqual(['categories', 'products_public']);
    expect(calls.eqs).toEqual([
      ['brand_id', BRAND],
      ['category_id', 'cat-1'],
    ]);
  });

  it('🔴 給 categoryRaw 而【解不到】⇒ 回 [] 且【不 throw】、且不發商品查詢', async () => {
    // 🛑 這一格是最容易被「修掉」的那一種:一個回空而不報錯的分支,
    //    沒有測試釘住它時, 下一個人會覺得那是 bug 而把它改成 throw。
    //    ⇒ 而它是刻意的(與 listByCategory 同慣例, SupabaseProductAdapter.ts:364-370 逐字)。
    const { client, calls } = makeBrandClient({ rows: [], categoryRow: null });
    const adapter = new SupabaseProductAdapter(client);

    const result = await adapter.listByBrand(BRAND, 5, '不存在的分類');

    expect(result).toEqual([]);
    expect(calls.tables).toEqual(['categories']); // 沒有再去打 products_public
  });

  it('DB 回 error ⇒ throw(不吞成空陣列)', async () => {
    const { client } = makeBrandClient({
      rows: [],
      categoryRow: null,
      productsError: { message: 'boom' },
    });
    const adapter = new SupabaseProductAdapter(client);

    await expect(adapter.listByBrand(BRAND, 5)).rejects.toBeDefined();
  });

  it('DB 回幾筆就回幾筆(adapter 不得事後再濾)', async () => {
    const rows = Array.from({ length: 4 }, (_, i) => makeRow(i));
    const { client } = makeBrandClient({ rows, categoryRow: null });
    const adapter = new SupabaseProductAdapter(client);

    const result = await adapter.listByBrand(BRAND, 10);

    expect(result).toHaveLength(4);
  });
});

// ════════════════════════════════════════════════════════════════
// searchByKeyword 的 `countTotal` 分路 —— ⟦搜尋-每字全表掃⟧(2026-09-02,`-f3`)
//
// 🔴 **為什麼這兩格寫在【這裡】而不是 contract**:
//    `packages/ports/src/IProductRepository.contract.ts` 的 `searchByKeyword` 有一個 `it.todo`,
//    而 `runProductRepositoryContract()` **全 repo 零真呼叫端**(該檔 `:10` 自己逐字寫著)
//    ⇒ 那些 `it.todo` 從來沒有被 vitest 收集過,**連「skipped」都不會出現在報告裡**。
//    ⇒ 📌 寫進那裡 = **寫一道沒有接上的保護,而它與沒寫的行為相同、只是更貴。**
//    ⇒ ✅ 照 2026-09-01 `listByBrand` 那次的先例(主視窗裁【甲】):寫在 adapter 自己的測試裡。
//
// 🛑 **這兩格證不到什麼**:它們釘的是「**有沒有送出 `count: 'exact'`**」與「**回不回 `total`**」,
//    **不是**「那一發真的比較快」——(那要 `EXPLAIN ANALYZE`,而線 `-fc` 2026-09-02 已在正式庫量過)。
// ════════════════════════════════════════════════════════════════
describe('SupabaseProductAdapter.searchByKeyword — countTotal 分路', () => {
  function makeMock() {
    const captured: { countOption?: string; selectCalls: number } = { selectCalls: 0 };
    const builder = {
      select(_cols: string, options?: { count?: string }) {
        captured.selectCalls += 1;
        captured.countOption = options?.count;
        return builder;
      },
      or: () => builder,
      order: () => builder,
      range: () => Promise.resolve({ data: [], error: null, count: 7 }),
    };
    return {
      client: { from: () => builder } as unknown as SupabaseClient,
      captured,
    };
  }

  it('should ask the database to count when no option is passed', async () => {
    // 🔴 預設維持既有行為 —— `/search` 那條路(`app/search/page.tsx:85` 共 N 件)靠這一格。
    //    有人日後把預設翻成「不數」⇒ 客人看得到的「共 N 件」會消失,而**沒有別的東西會紅**。
    const { client, captured } = makeMock();
    const res = await new SupabaseProductAdapter(client).searchByKeyword('avon', {
      limit: 8,
      offset: 0,
    });

    expect(captured.countOption).toBe('exact');
    expect(res.total).toBe(7);
  });

  it('should not ask the database to count when countTotal is false', async () => {
    // 🔴 這一格是本片的本體:疊層那條路每打一個字都在數一個【它不顯示】的總數。
    const { client, captured } = makeMock();
    const res = await new SupabaseProductAdapter(client).searchByKeyword(
      'avon',
      { limit: 8, offset: 0 },
      { countTotal: false },
    );

    expect(captured.countOption).toBeUndefined();
    // 🔵 **2026-09-05 起是 2, 不是 1** —— 舊路多了一發 `from('brands').select('id, name')`
    //    (`⟦search-BRANDMULTIWORD⟧`:那張 view 上沒有品牌名, 而多字品牌名必須靠它才對得上)。
    //    🛑 **這一格仍然承重**:它守的是「`select` 真的被呼叫過 ⇒ `undefined` 不是【沒跑到】」,
    //    而**數字從 1 變 2 是一個【真的多了一次查詢】**, 不是測試變脆弱 ⇒ 照實改數字, 不改語意。
    expect(captured.selectCalls).toBe(2);
    expect(res.total).toBeUndefined();
  });

  it('should leave total undefined rather than zero when it did not count', async () => {
    // 🔴 「不知道總數」與「共 0 件」是**兩件事**。
    //    回 0 會讓畫面出現「拿到 8 筆卻說共 0 件」(`search.ts` 的 SearchResult 那段同一條)。
    const { client } = makeMock();
    const res = await new SupabaseProductAdapter(client).searchByKeyword(
      'avon',
      { limit: 8, offset: 0 },
      { countTotal: false },
    );

    expect('total' in res).toBe(false);
    expect(res.total).not.toBe(0);
  });

  it('should still count when countTotal is explicitly true', async () => {
    // 邊界:`opts` 有傳而值是 true ⇒ 走數的那條(判準是 `!== false`,不是 truthy)。
    const { client, captured } = makeMock();
    await new SupabaseProductAdapter(client).searchByKeyword(
      'avon',
      { limit: 8, offset: 0 },
      { countTotal: true },
    );

    expect(captured.countOption).toBe('exact');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⟦搜尋-多詞與料號⟧ 2026-09-03 線 `-mail`(Sean 線上親自撞到,主視窗-87 派)
//
// 🔴 **這一族的期望值【從驗收表推,不從實作推】** —— 表在
//    `docs/specs/2026-09-03-storefront-search-multiword-sku-plan.md` §4/§5,主視窗-87 批准的那一份。
//    (板子記過:期望值若是從我要寫的那行碼推的,那格測試從出生起就抓不到那行碼的缺陷。)
//
// 🔴 **線上量到的現況(2026-09-03 01:2x,`fetch('/api/search?q=…')` 在 shop.pcmmotorsports.com)**:
//    `rsv4` 8 · `油箱貼` 8 · `rpm` 8   ⇒ 單詞今天是綠的(正對照)
//    `rpm rsv4` 0 · `rsv4 油箱貼` 0     ⇒ 兩個詞一律 0
//    `CARK9650` 0 · `cark9650` 0        ⇒ 真料號(印在該商品自己的頁面上)
//    `zzqprbxx9999` 0                   ⇒ 負對照
describe('SupabaseProductAdapter.searchByKeyword — 多詞 AND + 料號欄(⟦搜尋-多詞與料號⟧)', () => {
  /**
   * 🔴 與上面那個 `makeSearchMock` 的差別:**這一個把 `.or()` 的參數記下來**。
   *    上面那份的 `or()` 是 `return builder`(不記)⇒ 它對「呼叫幾次、帶什麼」零判別力。
   */
  function makeOrCapturingMock() {
    // 🔴 `ranged` 是 codex 2026-09-03 MF6 逼出來的:原本只記 `ors` ⇒
    //    「零詞卻送出一句沒有條件的查詢」那個世界**照樣全綠**(`ors` 是空的 = 看起來很正常)。
    //    ⇒ 要分辨「沒有條件」與「根本沒發查詢」,**必須記【有沒有真的送出去】**。
    const captured: { ors: string[]; ranged: boolean; froms: string[] } = {
      ors: [],
      ranged: false,
      froms: [],
    };
    const builder = {
      select() {
        return builder;
      },
      or(filter: string) {
        captured.ors.push(filter);
        return builder;
      },
      order() {
        return builder;
      },
      range() {
        captured.ranged = true;
        return Promise.resolve({ data: [], error: null, count: 0 });
      },
    };
    const client = {
      from: (table: string) => {
        captured.froms.push(table);
        return builder;
      },
    };
    return { client: client as unknown as SupabaseClient, captured };
  }

  it('🟢 正對照:單詞不得回歸 —— `rsv4` 仍然只組一組 or()', async () => {
    const { client, captured } = makeOrCapturingMock();
    await new SupabaseProductAdapter(client).searchByKeyword('rsv4', { limit: 8, offset: 0 });
    expect(captured.ors).toHaveLength(1);
    expect(captured.ors[0]).toContain('%rsv4%');
  });

  it('🟢 正對照:中文不含空白不得回歸 —— `油箱貼` 仍是一個詞', async () => {
    const { client, captured } = makeOrCapturingMock();
    await new SupabaseProductAdapter(client).searchByKeyword('油箱貼', { limit: 8, offset: 0 });
    expect(captured.ors).toHaveLength(1);
    expect(captured.ors[0]).toContain('%油箱貼%');
  });

  it('🔴 主症狀:`rpm rsv4` 要組【兩組】or()(疊起來 = AND)', async () => {
    const { client, captured } = makeOrCapturingMock();
    await new SupabaseProductAdapter(client).searchByKeyword('rpm rsv4', { limit: 8, offset: 0 });
    // 期望來自驗收表:兩個詞【都要中】才算命中 ⇒ 兩組 or() 疊 = 交集
    // (機制是 repo 自己實測過的:SupabaseOrderAdapter.ts:1043 與 :1143)
    expect(captured.ors).toHaveLength(2);
    expect(captured.ors.some((f) => f.includes('%rpm%'))).toBe(true);
    expect(captured.ors.some((f) => f.includes('%rsv4%'))).toBe(true);
    // 🔴 而每一組【都】要含全部欄位 ⇒ 一個詞可以中在標題、另一個中在料號
    for (const f of captured.ors) {
      expect(f).toContain('title.ilike.');
      expect(f).toContain('external_id.ilike.');
    }
  });

  it('🔴 詞序顛倒同結果 —— `rsv4 rpm` 與 `rpm rsv4` 的 filter 集合相同', async () => {
    const a = makeOrCapturingMock();
    const b = makeOrCapturingMock();
    await new SupabaseProductAdapter(a.client).searchByKeyword('rpm rsv4', { limit: 8, offset: 0 });
    await new SupabaseProductAdapter(b.client).searchByKeyword('rsv4 rpm', { limit: 8, offset: 0 });
    // AND 對順序不敏感 ⇒ 排序後逐字相同
    expect([...b.captured.ors].sort()).toEqual([...a.captured.ors].sort());
  });

  it('🔴 多個空格 / 全形空格(U+3000)都要切開', async () => {
    for (const q of ['rpm  rsv4', 'rpm　rsv4', 'rpm\trsv4']) {
      const { client, captured } = makeOrCapturingMock();
      await new SupabaseProductAdapter(client).searchByKeyword(q, { limit: 8, offset: 0 });
      expect(captured.ors, `輸入 ${JSON.stringify(q)}`).toHaveLength(2);
    }
  });

  it('🔴 料號欄:`CARK9650` 要進到 external_id 那一欄的 ilike 裡', async () => {
    const { client, captured } = makeOrCapturingMock();
    await new SupabaseProductAdapter(client).searchByKeyword('CARK9650', { limit: 8, offset: 0 });
    expect(captured.ors).toHaveLength(1);
    expect(captured.ors[0]).toContain('external_id.ilike.%CARK9650%');
  });

  it('🔴 真料號含空白:`PED-GP EVO MON SX RS660` 切成 5 個詞、每個都要中', async () => {
    // 🔴 這一筆是**線上撈到的真料號**(8 筆樣本裡唯一含空白的那筆)——
    //    量法見 plan §7-b。它不是想出來的測資。
    const { client, captured } = makeOrCapturingMock();
    await new SupabaseProductAdapter(client).searchByKeyword('PED-GP EVO MON SX RS660', {
      limit: 8,
      offset: 0,
    });
    expect(captured.ors).toHaveLength(5);
    // 🔴 codex nit:原本只檢查頭尾兩個 ⇒ 中間三個被改成錯字仍會通過。逐個釘。
    for (const term of ['PED-GP', 'EVO', 'MON', 'SX', 'RS660']) {
      expect(captured.ors.some((f) => f.includes(`%${term}%`)), `${term} 應該在`).toBe(true);
    }
  });

  it('🔴 詞數上限:超過上限要截斷,不得無限長 URL', async () => {
    const { client, captured } = makeOrCapturingMock();
    const many = Array.from({ length: 20 }, (_, i) => `w${i}`).join(' ');
    await new SupabaseProductAdapter(client).searchByKeyword(many, { limit: 8, offset: 0 });
    // 期望來自 plan §4 第 10 格:上限 8(URL 過長會 414 / 被 proxy 砍,而那個失敗長得像「搜不到」)
    expect(captured.ors).toHaveLength(8);
    // 🔴 codex MF7:只斷言「八次」的話,改成「留後八個」或「任選八個」都會通過。
    //    ⇒ 釘住是【前】八個 w0…w7,而且 w8 之後一個都不准在。
    for (let i = 0; i < 8; i += 1) {
      expect(captured.ors.some((f) => f.includes(`%w${i}%`)), `w${i} 應該在`).toBe(true);
    }
    expect(captured.ors.some((f) => f.includes('%w8%')), 'w8 不該在').toBe(false);
    expect(captured.ors.some((f) => f.includes('%w19%')), 'w19 不該在').toBe(false);
  });

  it('🔴🔴 零詞輸入 ⇒ 一句查詢都不准送(不是「送一句沒有條件的」)', async () => {
    // 🔴 codex MF1:`'\u200B'.trim()` **仍是** `'\u200B'`(Unicode White_Space 不含它)
    //    ⇒ 它通過空字串短路、切完零詞;只打 `.` / `,` / `()` 同族(sanitize 換成空白)。
    //    少了 fail-closed ⇒ 送出**沒有任何條件**的查詢 ⇒ 整張 view 第一頁被當成搜尋結果,
    //    而 `count:'exact'` 順便去數全表。**失敗形狀是【成功】。**
    // 🛑 判別點是 `ranged` 不是 `ors` —— 兩個世界的 `ors` 都是空的。
    for (const q of ['', '   ', '　', '\u200B', '.', ',', '()', '""', '\uFEFF']) {
      const { client, captured } = makeOrCapturingMock();
      const res = await new SupabaseProductAdapter(client).searchByKeyword(q, {
        limit: 8,
        offset: 0,
      });
      expect(res, `輸入 ${JSON.stringify(q)}`).toEqual({ items: [], total: 0 });
      expect(captured.ors, `輸入 ${JSON.stringify(q)} 的 ors`).toHaveLength(0);
      expect(captured.ranged, `輸入 ${JSON.stringify(q)} 不該送出查詢`).toBe(false);
    }
  });

  it('🟢 正對照:有詞的輸入【確實會】送出查詢 —— 證明上面那個 false 不是恆 false', async () => {
    const { client, captured } = makeOrCapturingMock();
    await new SupabaseProductAdapter(client).searchByKeyword('rsv4', { limit: 8, offset: 0 });
    expect(captured.ranged).toBe(true);
    // 🔵 **2026-09-05 起舊路先問一次 `brands`**(`⟦search-BRANDMULTIWORD⟧`)——
    //    順序是刻意的:品牌那一發在前, 商品那一發在後(既有幾格斷言的是【最後一次 select 的選項】)。
    // 🛑 **而 `products_public` 那個字面仍然承重** —— 它守的是「不准換投影表」
    //    (那張 view 物理上沒有經銷價欄, 是實體隔離不是條件式)⇒ 這裡【列出全部】而不是只看有沒有它,
    //    這樣有人偷偷多打一張表也會紅。
    expect(captured.froms).toEqual(['brands', 'products_public']);
  });

  it('🔴 `AP.123` 這種帶符號的料號 ⇒ 切成兩個詞(sanitize 必須在切詞【之前】)', async () => {
    // 🔴 codex MF2:順序寫反的話 `AP.123` 只會是一個詞、之後變成 `%AP 123%`
    //    ⇒ 仍然要求同一欄裡連續出現 ⇒ 找不到。**而兩種順序在 diff 上長得一樣。**
    const { client, captured } = makeOrCapturingMock();
    await new SupabaseProductAdapter(client).searchByKeyword('AP.123', { limit: 8, offset: 0 });
    expect(captured.ors).toHaveLength(2);
    expect(captured.ors.some((f) => f.includes('%AP%'))).toBe(true);
    expect(captured.ors.some((f) => f.includes('%123%'))).toBe(true);
    // 🛑 而【不可以】出現含空白的 pattern —— 那正是寫反時的產物
    expect(captured.ors.some((f) => f.includes('%AP 123%'))).toBe(false);
  });

  it('🔴 ILIKE 萬用字元仍被轉義,而且【只轉一次】(雙重轉義會讓 `50%` 永遠 0 件)', async () => {
    // 🔴 codex MF8;而「只轉一次」是我改順序時自己製造的坑:
    //    sanitize 若跑兩次,`50%` ⇒ `50\%` ⇒ `50\\\%`,不報錯、只回 0 件。
    const { client, captured } = makeOrCapturingMock();
    await new SupabaseProductAdapter(client).searchByKeyword('50%', { limit: 8, offset: 0 });
    expect(captured.ors).toHaveLength(1);
    expect(captured.ors[0]).toContain('%50\\%%');
    expect(captured.ors[0]).not.toContain('50\\\\');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⟦搜尋-品牌⟧ 2026-09-03 線 `-mail`:**函式還沒貼的今天,行為必須逐字不變**
//
// 🔴 那支 RPC(`20260903050000`)**在等 Sean 貼** ⇒ 今天的正式站上**沒有它**。
//    ⇒ 本片的硬條件:**偵測不到它 ⇒ 走舊路 ⇒ 客人看到的東西零改變。**
//    ⇒ ✅ 判別句:**SQL 還沒貼的那一天,結果會【變差】,而不是【消失】。**
//
// 🔵 兩個「不在」的錯誤碼是**實測**的(拋棄式 PostgREST,兩個世界各打一發):
//    `PGRST202`(從來沒有過 / cache 剛重載 ⇒ **正式站今天就是這個**)· `42883`(被 DROP 而 cache 未重載)
// ─────────────────────────────────────────────────────────────────────────────
describe('SupabaseProductAdapter.searchByKeyword — ⟦搜尋-品牌⟧ RPC 不在時走舊路', () => {
  function makeMock(rpcResult: { data: unknown; error: unknown }) {
    // 🔴 `rpcRanged` / `rpcRange` 與 `ranged` **刻意分開**(code-reviewer must-fix 3):
    //    原本兩條路共寫同一個 `ranged` ⇒ RPC 先跑過 `.range()` 之後,
    //    「舊路要真的送出查詢」那格**恆為 true** ⇒ 它標籤說的那件事已經量不到。
    const captured: {
      ors: string[]; rpcCalls: number; ranged: boolean; ins: string[][];
      rpcRanged: boolean; rpcRange: [number, number] | null;
    } = {
      ors: [], rpcCalls: 0, ranged: false, ins: [], rpcRanged: false, rpcRange: null,
    };
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      select: () => builder,
      or: (f: string) => { captured.ors.push(f); return builder; },
      in: (_c: string, v: string[]) => { captured.ins.push(v); return builder; },
      order: () => builder,
      range: () => { captured.ranged = true; return Promise.resolve({ data: [], error: null, count: 0 }); },
      // 🔴 `.in(...).order(...)` 那條鏈**沒有 `.range()` 收尾** ⇒ 它是直接被 await 的
      //    ⇒ builder 本身要是 thenable, 否則 `rows` 會是 undefined 而測試紅在【我的 mock】上,
      //      而不是紅在被測的碼上。(第一版就是這樣紅的。)
      then: (res: (v: { data: unknown[]; error: null }) => unknown) =>
        res({ data: [], error: null }),
    });
    const client = {
      from: () => builder,
      // 🔴🔴 **2026-09-03 正式站故障之後改形狀 —— 而【舊的這個 mock 正是故障看不見的原因】**:
      //    ⛔ ~~`rpc: (_fn, _args, _opts) => Promise.resolve(rpcResult)`~~
      //       ↑ 收第三個參數、直接回 Promise ⇒ **它剛好長得跟【當時那份壞掉的碼】一樣**
      //    🛑 而真的 `supabase-js@2.105.3` 是:第三參 `{head,get,count}`、
      //       回一個 `PostgrestFilterBuilder`(`dist/index.d.mts:536`), `.range()` 掛在它身上。
      //    ⇒ 📌 **mock 照著被測的碼長, 而不是照著真的 SDK 長 ⇒ 它只會確認「碼跟它自己一致」。**
      //       那天正式站 503 了 11 次, 而這裡全綠。
      //    ✅ 現在的形狀**跟著 SDK 走**:回 builder、`.range()` 才 resolve;
      //       而 `rpc` 是**掛在 client 上的方法**(不是箭頭常數)⇒ 碼若再把它拆下來,
      //       `this` 一樣會不見 ⇒ 下面那格 throw 測試會紅。
      rpc(_fn: string, _args: unknown) {
        captured.rpcCalls += 1;
        // 🔴 摸一下 `this` —— 這是「方法有沒有被拆下來」的**唯一**判別點。
        //    拆下來呼叫時 `this` 是 undefined ⇒ 這一行就丟 TypeError(與真 SDK 同一種死法)。
        void (this as unknown as { from: unknown }).from;
        return {
          range: (from: number, to: number) => {
            captured.rpcRanged = true;
            captured.rpcRange = [from, to];   // 🔴 記下兩端 —— 沒有這格, 改 `.range()` 的參數不會紅
            return Promise.resolve(rpcResult);
          },
        };
      },
    };
    return { client: client as unknown as SupabaseClient, captured };
  }

  const NOT_DEPLOYED = [
    { code: 'PGRST202', message: 'Could not find the function' },   // 正式站今天
    { code: '42883', message: 'function ... does not exist' },      // 被 DROP 而 cache 未重載
  ];

  it.each(NOT_DEPLOYED)('🔴🔴 錯誤碼 $code ⇒ 走舊路,而 or() 與今天【逐字相同】', async (err) => {
    const { client, captured } = makeMock({ data: null, error: err });
    await new SupabaseProductAdapter(client).searchByKeyword('rpm rsv4', { limit: 8, offset: 0 });
    expect(captured.rpcCalls, '應該有試過那支 RPC').toBe(1);
    // 🎯 判別點:**舊路真的走了**, 而且是今天那個形狀(兩個詞 ⇒ 兩組 or(), 每組含五欄)
    expect(captured.ors).toHaveLength(2);
    expect(captured.ors.some((f) => f.includes('%rpm%'))).toBe(true);
    expect(captured.ors.some((f) => f.includes('%rsv4%'))).toBe(true);
    for (const f of captured.ors) {
      expect(f).toContain('title.ilike.');
      expect(f).toContain('external_id.ilike.');
    }
    expect(captured.ranged, '舊路要真的送出查詢').toBe(true);
    expect(captured.ins, '走舊路時不該用 .in(id)').toHaveLength(0);
  });

  it('🔴 而【其他】錯誤不得被吞掉 —— 吞掉會安靜地給客人比較差的結果', async () => {
    // 🛑 這一格擋的是「把 try/catch 寫寬一點」那個很自然的動作。
    const { client } = makeMock({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(
      new SupabaseProductAdapter(client).searchByKeyword('rpm rsv4', { limit: 8, offset: 0 }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('🟢 RPC 在的時候:用它的 id 走 .in(),而【不】再組 or()', async () => {
    const ids = [{ id: 'bbb' }, { id: 'aaa' }];
    const { client, captured } = makeMock({ data: ids, error: null });
    await new SupabaseProductAdapter(client).searchByKeyword('rpm rsv4', { limit: 8, offset: 0 });
    expect(captured.ors, 'RPC 成功時不該再走舊路').toHaveLength(0);
    // 🔴 `.in()` 不保證順序 ⇒ 自己排過, 才與舊路的 .order('id') 同序
    expect(captured.ins[0]).toEqual(['aaa', 'bbb']);
  });

  it('🔴 契約變了(回了列而一列都認不得)⇒ 必須【退回舊路】, 不是回空', async () => {
    // 🛑 code-reviewer must-fix:逐列驗形狀會把每一列都過濾掉 ⇒ ids 是空的
    //    ⇒ 而空陣列被讀成「走過了而沒找到」⇒ **客人恆得 0 筆且不退舊路**。
    //    📌 「我看不懂它回什麼」不是「沒找到」。
    const { client, captured } = makeMock({ data: [{ ident: 'aaa' }, { ident: 'bbb' }], error: null });
    await new SupabaseProductAdapter(client).searchByKeyword('rpm rsv4', { limit: 8, offset: 0 });
    expect(captured.ors, '認不得就要走舊路').toHaveLength(2);
    expect(captured.ins, '不該拿一份認不得的清單去 .in()').toHaveLength(0);
  });

  it('🔴 超過 db-max-rows 上限 ⇒ 退回舊路, 不得拿殘缺清單當全部', async () => {
    // 🛑 PostgREST 超過 db-max-rows 會【靜默截斷】並回 200 ⇒ 「剛好 N 筆」與「被砍成 N 筆」同形
    //    ⇒ 多要一筆當尺:拿回來超過 cap ⇒ 知道被截了 ⇒ 退回舊路(舊路的 count 是 exact)。
    const many = Array.from({ length: 1001 }, (_, i) => ({ id: `id-${i}` }));
    const { client, captured } = makeMock({ data: many, error: null });
    await new SupabaseProductAdapter(client).searchByKeyword('rpm rsv4', { limit: 8, offset: 0 });
    expect(captured.ors, '被截斷就要走舊路').toHaveLength(2);
  });

  it('🔴 分頁:offset 不是 0 時要拿【那一頁】的 id, 而不是永遠拿前 N 個', async () => {
    // 🛑 code-reviewer nit:先前每一格都 offset:0 ⇒ 把 slice(offset, offset+limit)
    //    改成 slice(0, limit) 四格全綠 ⇒ 分頁那個宣稱沒有任何一格守得住。
    const ids = Array.from({ length: 20 }, (_, i) => ({ id: `id-${String(i).padStart(2, '0')}` }));
    const { client, captured } = makeMock({ data: ids, error: null });
    await new SupabaseProductAdapter(client).searchByKeyword('rpm rsv4', { limit: 3, offset: 5 });
    expect(captured.ins[0]).toEqual(['id-05', 'id-06', 'id-07']);
  });

  it('🔴 total 是【全部命中數】不是【這一頁的筆數】', async () => {
    // 🛑 code-reviewer nit:先前那格完全不看回傳值 ⇒ 把 total 改成 pageIds.length 殺不掉。
    const ids = Array.from({ length: 20 }, (_, i) => ({ id: `id-${String(i).padStart(2, '0')}` }));
    const { client } = makeMock({ data: ids, error: null });
    const res = await new SupabaseProductAdapter(client).searchByKeyword('rpm rsv4', {
      limit: 3,
      offset: 0,
    });
    expect(res.total, 'total 應為 20(全部命中), 不是 3(這一頁)').toBe(20);
  });

  it('🟢 client 沒有 rpc 這個方法 ⇒ 也算「今天沒有這條路」, 走舊路而不是炸掉', async () => {
    // 🛑 code-reviewer nit:這道退路先前只被「既有 mock 沒有 rpc」偶然覆蓋
    //    ⇒ 哪天有人往共用 mock 補上 rpc, 它就沒有人在看了 ⇒ 給它自己一格。
    const { client, captured } = makeMock({ data: null, error: null });
    delete (client as unknown as { rpc?: unknown }).rpc;
    await new SupabaseProductAdapter(client).searchByKeyword('rpm rsv4', { limit: 8, offset: 0 });
    expect(captured.ors, '沒有 rpc 就走舊路').toHaveLength(2);
  });

  // 🔴 **`.range()` 的兩端與 `RPC_ID_CAP` 那個哨兵, 在 2026-09-03 之前【零覆蓋】**
  //    (code-reviewer important 4:`grep -n RPC_ID_CAP` 在本檔 0 命中,
  //     而 mock 的 `range` 把兩個參數丟掉)⇒ 把 `.range(0, CAP)` 改成 `.range(0, 5)`
  //     或整段刪掉 cap 哨兵, **全綠**。這兩格是那把尺。
  it('🔴 RPC 要帶 `.range(0, RPC_ID_CAP)` —— 少了它會吃 PostgREST 的 db-max-rows 靜默截斷', async () => {
    const { client, captured } = makeMock({ data: [], error: null });
    await new SupabaseProductAdapter(client).searchByKeyword('rpm rsv4', { limit: 8, offset: 0 });
    expect(captured.rpcRanged, '.range() 要真的被呼叫').toBe(true);
    // 🔴 兩端都釘死:`.range()` 兩端皆含 ⇒ 0..1000 是 1001 筆 = cap + 1,
    //    而「多要一筆」正是下面那格用來判斷「有沒有被截」的尺。
    expect(captured.rpcRange).toEqual([0, 1000]);
  });

  it('🔴 RPC 回超過 cap(1001 筆)⇒ 可能被截 ⇒ 退回舊路, 不拿一份可能不完整的 id 清單', async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => ({ id: `p${i}` }));
    const { client, captured } = makeMock({ data: ids, error: null });
    await new SupabaseProductAdapter(client).searchByKeyword('rpm rsv4', { limit: 8, offset: 0 });
    expect(captured.ors, '超過 cap 要走舊路').toHaveLength(2);
  });

  // 🔵 **nit 6 的守門**:`makeMock` 裡那個 `rpc(){}` 是本片對「方法被拆下來」的唯一判別點,
  //    而它自己沒有人守 —— 誰把它改回 `rpc: () => {}`, 守門就無聲消失、零測試會紅。
  it('🔵 mock 的 rpc 必須是【掛在 client 上的方法】—— 拆下來呼叫要當場 throw', () => {
    const { client } = makeMock({ data: [], error: null });
    const { rpc } = client as unknown as { rpc: (f: string, a: unknown) => unknown };
    // ESM 恆 strict ⇒ 拆下來呼叫時 this 是 undefined ⇒ 與真 SDK 同一種死法。
    expect(() => rpc('storefront_search_product_ids', {})).toThrow();
  });

  // 🔴🔴 **這一格是 2026-09-03 正式站故障(11 次 503)留下的守門。**
  //    當時的退路只接得住**回傳的 `error` 物件**;而真正發生的是一個 **`throw`**
  //    (方法被從 client 上拆下來 ⇒ `this` 不見 ⇒ `TypeError: … reading 'rest'`)
  //    ⇒ 它**穿過整條退路**, 讓 `/api/search` 回 503。
  //    📌 **⇒ 一道只接住其中一種失敗形狀的退路, 在另一種形狀上等於不存在 ——
  //       而那兩種形狀在測試裡長得完全不一樣, 所以「有退路」不等於「接得住」。**
  it('🔴 RPC 那條路【throw】⇒ 仍然退回舊路, 不得讓整個搜尋炸掉(正式站 503 的那一格)', async () => {
    const { client, captured } = makeMock({ data: null, error: null });
    (client as unknown as { rpc: unknown }).rpc = () => {
      throw new TypeError("Cannot read properties of undefined (reading 'rest')");
    };
    // 🔴 第一個斷言:**它不可以往上丟**。少了這一行, 下面那行在 throw 時根本跑不到,
    //    而 vitest 會把它報成「測試失敗」而不是「這個行為壞了」—— 診斷會指錯方向。
    const res = await new SupabaseProductAdapter(client).searchByKeyword('rpm rsv4', {
      limit: 8, offset: 0,
    });
    expect(res).toBeDefined();
    // 🎯 第二個斷言:**舊路真的走了**(兩個詞 ⇒ 兩組 or)—— 這才分得出
    //    「沒炸掉」與「炸掉但被別人吞了」。
    expect(captured.ors, 'throw 之後要走舊路').toHaveLength(2);
  });

  // 🔵 **負對照**:`.range()` 那一段丟出來的東西也要接得住 —— throw 可能發生在**兩個位置**
  //    (呼叫 `rpc()` 當下、或 await 那個 builder 的時候), 而只擋前者會漏掉後者。
  it('🔵 `.range()` 階段才 throw ⇒ 一樣退回舊路', async () => {
    const { client, captured } = makeMock({ data: null, error: null });
    (client as unknown as { rpc: unknown }).rpc = () => ({
      range: () => Promise.reject(new Error('連線在 range 階段斷了')),
    });
    const res = await new SupabaseProductAdapter(client).searchByKeyword('rpm rsv4', {
      limit: 8, offset: 0,
    });
    expect(res).toBeDefined();
    expect(captured.ors, 'range 階段 throw 之後也要走舊路').toHaveLength(2);
  });

  it('🔵 RPC 回【空陣列】≠ RPC 不在 —— 前者直接回空, 不得退回舊路', async () => {
    // 📌 「這條路走過了而一筆都沒找到」與「今天沒有這條路」是兩件事,
    //    收斂成同一個會讓「真的沒有這件商品」變成「用比較差的方式再找一次」。
    const { client, captured } = makeMock({ data: [], error: null });
    const res = await new SupabaseProductAdapter(client).searchByKeyword('rpm rsv4', {
      limit: 8, offset: 0,
    });
    // 🔴 而 `expect(res).toEqual({items:[],total:0})` **在兩條路上都成立**(舊路的 mock 也回空)
    //    ⇒ 那一行是恆真的, 已拿掉。真正有判別力的是下面這兩行。
    expect(captured.ors, '空結果不該退回舊路').toHaveLength(0);
    expect(captured.rpcCalls, '應該是走了 RPC 才拿到空的').toBe(1);
  });
});

// ── ⟦搜尋-料號正規化⟧ 2026-09-03 · Sean 逐字「打料號【一定要有】」──────────────
//
// 🔴 語氣分級不可合併(他同一分鐘內講的兩句):
//    料號「**一定要有**, 而且要有- 無- 有空格無空格等等方式」⇒ 硬要求
//    膠囊「**盡量就好**, 字詞、詞彙我們慢慢追加」            ⇒ best-effort
describe('partNumberPattern — 料號的不同打法要指向同一顆', () => {
  // 🔴🔴 **這一格是【唯一真的缺口】** —— 我量過四種打法才知道只缺這一種:
  //    資料是 `AB-123` 時, 本函式之前 `AB-123`/`AB 123`/`ab-123` 三種**本來就會中**
  //    (ILIKE 大小寫無關 · 空白會被切成兩詞 AND)⇒ **只有無分隔號那種不中。**
  //    ⇒ 📌 少了這個認識, 很容易寫一個「四種都修」的大東西去修一個一格的病。
  it('🔴 無分隔號的打法要切得開(這是唯一真的缺口)', () => {
    expect(partNumberPattern('ab123')).toBe('ab%123%');
  });

  it('🔵 有分隔號/空白/底線 ⇒ 與無分隔號【產生同一個 pattern】', () => {
    // 🎯 「同一個」才是 Sean 那句話的意思 —— 不是「都找得到」, 是**指向同一顆**。
    const want = 'AB%123%';
    for (const typed of ['AB-123', 'AB 123', 'AB_123', 'AB.123', 'AB/123']) {
      expect(partNumberPattern(typed), `打法 ${typed}`).toBe(want);
    }
  });

  // 🔴🔴 **錨定那一格 —— 主視窗擋下來要我先量, 而他是對的。**
  //    未錨定版 `%ab%123%` 會撈進 `CRAB-99123` / `LAB-X-40123` / `GRAB-123MM` /
  //    `SLAB123` / `FAB-1230`(語料 31 筆實測:10 件 vs 錨定版 5 件)。
  //    ⇒ 📌 而料號搜尋最貴的失敗**不是漏掉, 是撈進一堆不相干的** —— 一頁雜訊等於沒找到。
  it('🔴🔴 pattern **不得**以 % 開頭(開頭放 % ⇒ CRAB/LAB/GRAB 那一族全部會中)', () => {
    const p = partNumberPattern('ab123');
    expect(p).not.toBeNull();
    expect(p!.startsWith('%'), '開頭有 % = 未錨定 = 雜訊那一族回來了').toBe(false);
    expect(p!.endsWith('%'), '結尾要留 % —— 料號後面可能還有尾碼').toBe(true);
  });

  // 🛑 fail-closed 那一族:不適用時回 null, 呼叫端就只送原本那一發。
  it.each([
    ['純字母', 'akrapovic'],
    ['純數字', '9650'],
    ['中文', '油箱貼'],
    ['中英混', 'mt07油箱'],
    // 🔴🔴 **這一格換過內容 —— 原本餵 `'a1'.slice(0,1)` = `'a'`, 而那是【假綠】:**
    //    它被上面「沒有數字」那道守門攔掉, **從來沒有到過 `segments.length < 2` 那一行**。
    // ✅ 現在餵真的反例:`A#1` 含字母、含數字、純 ASCII, 而 `#` 卡在中間
    //    ⇒ 字母與數字**不相鄰** ⇒ 那一刀切不下去 ⇒ 恆 1 段。
    //    (`A+1` / `A(1` / `x$9` 同族;node 實測見 `product-query-support.ts` 那段。)
    ['含字母數字而【不相鄰】(# 卡在中間)', 'A#1'],
    ['同族:加號', 'A+1'],
  ])('🔵 %s ⇒ 回 null(不適用, 不是出錯)', (_label, term) => {
    expect(partNumberPattern(term)).toBeNull();
  });

  it('🔴 萬用字元【逐段轉義】—— 先串再整串轉義會讓 pattern 恆 0 筆', () => {
    // 🛑 若先 join 再 escape, 我自己放的 `%` 會被轉成字面百分號
    //    ⇒ 變成在找一個真的含 `%` 的料號 ⇒ **恆 0 筆, 而它不會報錯。**
    const p = partNumberPattern('a%b1');
    expect(p).toBe('a\\%b%1%');
  });
});

describe('buildIlikeOrFilter — 料號那一發只掛在 external_id 上', () => {
  // 🔴🔴 **為什麼不是每一欄**:`ab%123%` 比 `%ab123%` 寬。掛在 `description` 上時
  //    「AB 車系適用, 長度 123mm」這種句子會中 ⇒ 關鍵字搜尋開始噴無關的東西。
  it('🔴 額外那一發的欄位是 external_id, 不是 title/description', () => {
    const f = buildIlikeOrFilter(['title', 'description', 'external_id'], 'ab123');
    const extra = f.split(',').filter((c) => c.endsWith('ab%123%'));
    expect(extra, '應該只多一發').toHaveLength(1);
    expect(extra[0]).toBe('external_id.ilike.ab%123%');
  });

  it('🔵 負對照:欄位清單裡沒有 external_id ⇒ 一發都不加', () => {
    const f = buildIlikeOrFilter(['title', 'description'], 'ab123');
    expect(f.includes('ab%123%'), '沒有那一欄就不該憑空生一個 clause').toBe(false);
  });

  it('🔵 負對照:不像料號的詞 ⇒ 欄位數 = clause 數(沒有多送)', () => {
    const cols = ['title', 'subtitle', 'description', 'external_id'];
    expect(buildIlikeOrFilter(cols, 'akrapovic').split(',')).toHaveLength(cols.length);
  });

  it('🔴 像料號的詞 ⇒ 恰好多一發, 而原本那 N 發【一個都沒有被改掉】', () => {
    const cols = ['title', 'subtitle', 'description', 'external_id'];
    const parts = buildIlikeOrFilter(cols, 'ab123').split(',');
    expect(parts).toHaveLength(cols.length + 1);
    // 🎯 原本那幾發要**原封不動** —— 加功能不得順手改掉既有行為。
    for (const col of cols) {
      expect(parts).toContain(`${col}.ilike.%ab123%`);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 🔴🔴 **舊路要比對品牌名**(`⟦search-BRANDMULTIWORD⟧` · 2026-09-05)
//   病是實證的:正式站打「DBK SPECIAL PARTS」⇒ 0 筆(型錄 1,508 件), 而那一發的
//   `x-vercel-id` 對 log ⇒ 逐字「回超過 1000 筆 ⇒ 退回舊路」。
//   舊路只比 `products_public` 那四欄, 而**那張 view 上沒有品牌名** ⇒ 多字品牌名必然落空。
// ══════════════════════════════════════════════════════════════════════════
describe('buildIlikeOrFilter — 品牌那一支', () => {
  const COLS = ['title', 'subtitle'] as const;

  it('🔴 有品牌 id ⇒ 多一支 brand_id.in.()', () => {
    const f = buildIlikeOrFilter(COLS, 'SPECIAL', ['b1', 'b2']);
    expect(f).toContain('title.ilike.%SPECIAL%');
    // 🛑 釘的是【它多了那一支】, 而不只是「字串裡有 brand_id」——
    //    值也要在裡面, 否則一個永遠回 `brand_id.in.()` 的實作也會過。
    expect(f).toContain('brand_id.in.("b1","b2")');
  });

  it('🔴 沒有品牌 id ⇒ 【不得】多出那一支(空的 in.() 會把整個 filter 弄壞)', () => {
    const f = buildIlikeOrFilter(COLS, 'SPECIAL', []);
    expect(f).not.toContain('brand_id');
  });

  it('🔵 不傳第三個參數 ⇒ 行為與改動前逐字相同(既有呼叫端不受影響)', () => {
    // 🛑 少了這一格, 一個「預設就加空 in.()」的實作會靜靜改掉所有既有查詢。
    expect(buildIlikeOrFilter(COLS, 'x')).toBe(buildIlikeOrFilter(COLS, 'x', []));
  });

  it('🔴 值用雙引號包起來 —— 值裡若有逗號/括號不會把 filter 切壞', () => {
    const f = buildIlikeOrFilter(COLS, 'x', ['a,b']);
    expect(f).toContain('brand_id.in.("a,b")');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 🔴🔴 **接線那一格 —— 而它是【突變活下來】才補的**(`⟦search-BRANDMULTIWORD⟧` · 2026-09-05)
//   我先寫了 `buildIlikeOrFilter` 的四格(純函式), 三綠全過, 而突變
//   「把 adapter 裡的 `brandRows` 改成恆空」⇒ **87 格全綠**。
//   ⇒ 🎯 **尺是好的, 而它沒有接到被測的那條線上** —— 純函式測得到「會不會組出 brand_id」,
//     測不到「adapter 有沒有真的把品牌 id 交給它」。這一格補的就是那一段接線。
// ══════════════════════════════════════════════════════════════════════════
describe('searchByKeyword 舊路 — 品牌名要真的被查進去', () => {
  function makeBrandMock() {
    const captured: { froms: string[]; ors: string[] } = { froms: [], ors: [] };
    const builder = {
      select() {
        return builder;
      },
      or(filter: string) {
        captured.ors.push(filter);
        return builder;
      },
      order() {
        return builder;
      },
      range() {
        return Promise.resolve({ data: [], error: null, count: 0 });
      },
      then(res: (v: { data: unknown[]; error: null }) => unknown) {
        // 🔵 `from('brands').select(...)` 沒有 `.range()` ⇒ 它直接被 await ⇒ 要是 thenable。
        return Promise.resolve({
          data: [{ id: 'b-dbk', name: 'DBK SPECIAL PARTS' }],
          error: null,
        }).then(res);
      },
    };
    const client = {
      from(t: string) {
        captured.froms.push(t);
        return builder;
      },
    };
    return { client: client as unknown as SupabaseClient, captured };
  }

  it('🔴 打「DBK SPECIAL」⇒ 兩個詞的 or() 都要帶 brand_id.in.()', async () => {
    const { client, captured } = makeBrandMock();
    const adapter = new SupabaseProductAdapter(client);
    await adapter.searchByKeyword('DBK SPECIAL', { limit: 8, offset: 0 });

    expect(captured.froms).toContain('brands');
    // 🛑 **兩個詞都要** —— 只有第一個帶的話, `SPECIAL` 仍然對不上, 而那正是線上那個 0 筆。
    expect(captured.ors.length).toBe(2);
    for (const f of captured.ors) {
      expect(f, `這一組 or() 沒有品牌那一支 ⇒ 多字品牌名還是會 0 筆:${f}`).toContain(
        'brand_id.in.("b-dbk")',
      );
    }
  });

  it('🔵 品牌對不上的詞 ⇒ 那一組【不帶】brand_id(不得無條件加)', async () => {
    const { client, captured } = makeBrandMock();
    const adapter = new SupabaseProductAdapter(client);
    await adapter.searchByKeyword('排氣管', { limit: 8, offset: 0 });
    expect(captured.ors.length).toBe(1);
    expect(captured.ors[0]).not.toContain('brand_id');
  });
});
