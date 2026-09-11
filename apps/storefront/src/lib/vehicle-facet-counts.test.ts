// @vitest-environment node
//
// vehicle-facet-counts.test.ts — 目錄頁側欄件數取數層的行為守門(2026-09-12 起一發 `catalog_facet_counts`)。
//
// 「未快取核心」`queryFacetCounts` 與快取包裝 `fetchFacetCounts` 各一組;route handler 在 route.test.ts。
// node env + mock 'server-only':本檔與 products.ts 都 `import 'server-only'`(對齊 products.test.ts)。
//
// 🔴 這裡的每一條都對應一個「壞掉會顯示錯數字給客人」的具體情境:
//   - 車 / 已選沒帶進去 ⇒ 算出來的是全站數(= #306 的病灶,換個地方再發生一次)
//   - 沒回來的 key 被補成 0 ⇒ 有商品的格子被灰掉、客人點不進去
//   - 失敗卻回部分結果 ⇒ 半套數字比不給更糟(必須 throw,由外層退回不顯示)
// 🛑 「面板數字 = 點進去的件數」這件事**不在這裡驗** —— mock 的 RPC 驗不到 SQL。
//   那一半在 `scripts/20260912010000-verify.sh`(拋棄式 PG 對照)與 migration 的行為閘。

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const rpc = vi.fn();

vi.mock('@pcm/adapters', () => ({
  createSupabaseAnonClient: () => ({ rpc }),
  SupabaseProductAdapter: class {},
  availabilityToBool: () => true,
}));

// unstable_cache 換成直通,才測得到「快取內側」的名額閘與快取 key 的組法。
const { cacheDeclarations, cachedCallArgs } = vi.hoisted(() => ({
  cacheDeclarations: [] as Array<{ keyParts: unknown; options: unknown }>,
  cachedCallArgs: [] as string[][],
}));
vi.mock('next/cache', () => ({
  unstable_cache: (
    fn: (...a: string[]) => unknown,
    keyParts: unknown,
    options: unknown,
  ) => {
    cacheDeclarations.push({ keyParts, options });
    return (...args: string[]) => {
      cachedCallArgs.push(args);
      return fn(...args);
    };
  },
}));

import { queryFacetCounts, fetchFacetCounts, MAX_CONCURRENT_FANOUTS } from './vehicle-facet-counts';

const VEHICLE = { brand: 'KAWASAKI', model: 'Ninja ZX-10R', year: 2024 };
const NONE = { categories: [], brandSlugs: [] };
const ok = (rows: Array<{ facet: string; key: string; n: number | string | null }>) =>
  Promise.resolve({ data: rows, error: null });

beforeEach(() => {
  rpc.mockReset();
});

describe('queryFacetCounts', () => {
  it('一發 RPC 的列 → 分類 / 品牌兩張表', async () => {
    rpc.mockReturnValue(
      ok([
        { facet: 'category', key: '碳纖維部品', n: 198 },
        { facet: 'category', key: '排氣系統', n: 0 },
        { facet: 'brand', key: 'rpm-carbon', n: 190 },
      ]),
    );
    const counts = await queryFacetCounts(VEHICLE, ['碳纖維部品', '排氣系統'], ['rpm-carbon'], NONE);
    expect(counts).toEqual({
      categories: { '碳纖維部品': 198, '排氣系統': 0 },
      brands: { 'rpm-carbon': 190 },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('車三段 + 兩份清單 + 兩份已選都帶進 RPC(已選不得漏,漏了就是 Sean 抓到的那個病)', async () => {
    rpc.mockReturnValue(ok([]));
    await queryFacetCounts(VEHICLE, ['外觀與後視鏡'], ['eazi-grip', 'rpm-carbon'], {
      categories: ['外觀與後視鏡'],
      brandSlugs: ['eazi-grip'],
    });
    expect(rpc).toHaveBeenCalledWith('catalog_facet_counts', {
      p_category_keys: ['外觀與後視鏡'],
      p_brand_keys: ['eazi-grip', 'rpm-carbon'],
      p_brand: 'KAWASAKI',
      p_model: 'Ninja ZX-10R',
      p_year: 2024,
      p_selected_categories: ['外觀與後視鏡'],
      p_selected_brand_slugs: ['eazi-grip'],
    });
  });

  it('沒選車 → 車三段都送 null(RPC 走全目錄);只選廠牌 → 車型 / 年份 null', async () => {
    rpc.mockReturnValue(ok([]));
    await queryFacetCounts(null, ['a'], [], { categories: [], brandSlugs: ['eazi-grip'] });
    await queryFacetCounts({ brand: 'YAMAHA' }, ['a'], [], NONE);
    const calls = rpc.mock.calls as Array<[string, Record<string, unknown>]>;
    expect(calls[0]?.[1]).toMatchObject({ p_brand: null, p_model: null, p_year: null });
    expect(calls[1]?.[1]).toMatchObject({ p_brand: 'YAMAHA', p_model: null, p_year: null });
  });

  it('n 是字串(bigint 走 JSON)也轉成數字;非數值當 0、不讓 NaN 進 UI', async () => {
    rpc.mockReturnValue(
      ok([
        { facet: 'category', key: 'a', n: '2130' },
        { facet: 'category', key: 'b', n: 'not-a-number' },
        { facet: 'brand', key: 'c', n: null },
      ]),
    );
    const counts = await queryFacetCounts(VEHICLE, ['a', 'b'], ['c'], NONE);
    expect(counts).toEqual({ categories: { a: 2130, b: 0 }, brands: { c: 0 } });
  });

  it('🔴 RPC 沒回的 key 不補 0(那是「算不出來」,補 0 會把有商品的格子灰掉)', async () => {
    rpc.mockReturnValue(ok([{ facet: 'category', key: 'a', n: 3 }]));
    const counts = await queryFacetCounts(VEHICLE, ['a', ' '], ['x'], NONE);
    expect(counts.categories).toEqual({ a: 3 });
    expect(counts.brands).toEqual({});
  });

  it('RPC 回錯 → throw(不得回半套)', async () => {
    rpc.mockReturnValue(Promise.resolve({ data: null, error: { message: 'statement timeout' } }));
    await expect(queryFacetCounts(VEHICLE, ['a'], [], NONE)).rejects.toThrow('statement timeout');
  });
});

describe('fetchFacetCounts(快取包裝 + 名額閘)', () => {
  beforeEach(() => {
    rpc.mockImplementation(() => ok([{ facet: 'category', key: 'a', n: 7 }]));
  });

  it('快取 key 帶滿車三段 + 兩份清單 + 兩份已選 ⇒ 不同的篩選不會共用同一筆快取', async () => {
    cachedCallArgs.length = 0;
    await fetchFacetCounts({ brand: 'YAMAHA', model: 'MT-09', year: 2021 }, ['a'], ['b'], NONE);
    await fetchFacetCounts({ brand: 'YAMAHA', model: 'MT-09', year: 2022 }, ['a'], ['b'], NONE);
    await fetchFacetCounts(null, ['a'], ['b'], { categories: [], brandSlugs: ['b'] });
    await fetchFacetCounts(null, ['a'], ['b'], { categories: ['a'], brandSlugs: [] });

    expect(cachedCallArgs).toEqual([
      ['["YAMAHA","MT-09",2021]', '["a"]', '["b"]', '[]', '[]'],
      ['["YAMAHA","MT-09",2022]', '["a"]', '["b"]', '[]', '[]'],
      ['null', '["a"]', '["b"]', '[]', '["b"]'],
      ['null', '["a"]', '["b"]', '["a"]', '[]'],
    ]);
    // 快取宣告:1 分鐘 + catalog tag;key 前綴換版(語意變了,不得讀到 v1 的舊結果)
    expect(cacheDeclarations.at(-1)).toMatchObject({
      keyParts: ['catalog-facet-counts-v2'],
      options: { revalidate: 60, tags: ['catalog'] },
    });
  });

  it('已選的順序不影響 key(同一組篩選不同點法共用一份快取)', async () => {
    cachedCallArgs.length = 0;
    await fetchFacetCounts(null, ['a'], ['b'], { categories: ['y', 'x'], brandSlugs: ['q', 'p'] });
    expect(cachedCallArgs[0]?.slice(3)).toEqual(['["x","y"]', '["p","q"]']);
  });

  it('沒選車也能從快取 key 還原成 null 車(不是 { brand: null })', async () => {
    rpc.mockClear();
    await fetchFacetCounts(null, ['a'], [], { categories: [], brandSlugs: ['b'] });
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_brand: null });
  });

  it('🔴 同一組同時來多個請求 → 只打一發(unstable_cache 不是 single-flight)', async () => {
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    rpc.mockReset();
    rpc.mockImplementation(() => blocked.then(() => ({ data: [], error: null })));

    const same = () => fetchFacetCounts({ brand: 'SAME' }, ['a', 'b'], ['c'], NONE);
    const all = [same(), same(), same()];
    release?.();
    const results = await Promise.all(all);

    expect(results.every((r) => r !== null)).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('同時進行的冷查超過上限 → 拒絕(回 null 讓 route 回 503),名額用完會歸還', async () => {
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    rpc.mockImplementation(() => blocked.then(() => ({ data: [], error: null })));

    const inFlight = Array.from({ length: MAX_CONCURRENT_FANOUTS }, (_, i) =>
      fetchFacetCounts({ brand: `B${i}` }, ['a'], [], NONE),
    );
    await expect(fetchFacetCounts({ brand: 'OVERFLOW' }, ['a'], [], NONE)).resolves.toBeNull();

    release?.();
    await Promise.all(inFlight);
    await expect(fetchFacetCounts({ brand: 'AFTER' }, ['a'], [], NONE)).resolves.not.toBeNull();
  });

  it('RPC 失敗 → 回 null(不 throw 到 route、也不回半套)', async () => {
    rpc.mockReturnValue(Promise.resolve({ data: null, error: { message: 'boom' } }));
    await expect(fetchFacetCounts({ brand: 'FAIL' }, ['a'], [], NONE)).resolves.toBeNull();
  });
});
