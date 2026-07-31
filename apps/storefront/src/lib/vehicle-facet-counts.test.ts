// @vitest-environment node
//
// vehicle-facet-counts.test.ts — #306 facet 取數層的行為守門。
//
// 這支只測「未快取核心」`queryVehicleFacetCounts`;`unstable_cache` 包裝層與 route handler
// 各自有自己的守門(route.test.ts)。node env + mock 'server-only':本檔與 products.ts 都
// `import 'server-only'`,node 環境無 window、mock 掉避免 import throw(對齊 products.test.ts)。
//
// 🔴 這裡的每一條都對應一個「壞掉會顯示錯數字給客人」的具體情境:
//   - 車輛參數沒帶進去 ⇒ 算出來的是全站數(= #306 本身的病灶,只是換個地方再發生一次)
//   - 品牌走錯參數(p_brand 是車輛廠牌、p_brand_slugs 才是商品品牌)⇒ 靜默回全廠牌件數
//   - 零列沒當成 0 ⇒ 0 件的分類不會灰掉,客人照樣點進去看到空的
//   - 一支失敗卻回部分結果 ⇒ 半套數字比不給更糟(必須整批 throw,由外層退回不顯示)

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const rpc = vi.fn();

vi.mock('@pcm/adapters', () => ({
  createSupabaseAnonClient: () => ({ rpc }),
  SupabaseProductAdapter: class {},
  availabilityToBool: () => true,
}));

// unstable_cache 換成直通,才測得到「快取內側」的 fan-out 閘與快取 key 的組法。
// (factory 會被 hoist ⇒ 它引用的東西必須用 vi.hoisted 一起提上去)
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

import {
  queryVehicleFacetCounts,
  fetchVehicleFacetCounts,
  FACET_CONCURRENCY,
  MAX_CONCURRENT_FANOUTS,
} from './vehicle-facet-counts';

type RpcArgs = {
  p_brand: string;
  p_model: string | null;
  p_year: number | null;
  p_offset: number;
  p_limit: number;
  p_category: string | null;
  p_brand_slugs: string[] | null;
  p_price_min: null;
  p_price_max: null;
};

const VEHICLE = { brand: 'KAWASAKI', model: 'Ninja ZX-10R', year: 2024 };

/** total 依 p_category / p_brand_slugs 決定的假 RPC(rows 形狀同真 RPC:[{item,total}])。 */
function respondWith(totals: Record<string, number | string>) {
  rpc.mockImplementation((_fn: string, args: RpcArgs) => {
    const key = args.p_category ?? args.p_brand_slugs?.[0] ?? '';
    const total = totals[key];
    // 真 RPC 在 0 件時回**零列**(讀不到 total)——這裡照樣模擬,不是回 total:0。
    if (total === undefined) return Promise.resolve({ data: [], error: null });
    return Promise.resolve({ data: [{ item: {}, total }], error: null });
  });
}

beforeEach(() => {
  rpc.mockReset();
});

describe('queryVehicleFacetCounts', () => {
  it('分類與品牌各自回自己的件數,0 件(RPC 零列)回 0', async () => {
    respondWith({ '碳纖維部品': 198, '拉桿與把手': 12, 'rpm-carbon': 190 });

    const counts = await queryVehicleFacetCounts(
      VEHICLE,
      ['碳纖維部品', '拉桿與把手', '排氣系統'],
      ['rpm-carbon', 'akrapovic'],
    );

    expect(counts).toEqual({
      categories: { '碳纖維部品': 198, '拉桿與把手': 12, '排氣系統': 0 },
      brands: { 'rpm-carbon': 190, akrapovic: 0 },
    });
  });

  it('每支查詢都帶滿車輛三段,且分類走 p_category、商品品牌走 p_brand_slugs', async () => {
    respondWith({});
    await queryVehicleFacetCounts(VEHICLE, ['碳纖維部品'], ['rpm-carbon']);

    const calls = rpc.mock.calls as Array<[string, RpcArgs]>;
    expect(calls).toHaveLength(2);
    for (const [fn, args] of calls) {
      expect(fn).toBe('search_catalog_by_vehicle');
      // 🔴 車輛沒帶進去 = 算出全站數 = #306 的病灶本身
      expect(args.p_brand).toBe('KAWASAKI');
      expect(args.p_model).toBe('Ninja ZX-10R');
      expect(args.p_year).toBe(2024);
      // facet 只吃「車輛 + 自己那一維」:價格不疊
      expect(args.p_price_min).toBeNull();
      expect(args.p_price_max).toBeNull();
      // 只要 total,不要整頁商品
      expect(args.p_limit).toBe(1);
      // 🔴 p_offset 必須是 0:RPC 的 count 在 OFFSET 之前算 ⇒ 非 0 時 total 仍對、
      //    但「恰好 1 件」的 facet 會回零列 ⇒ 被判成 0 件、在 #306-b 被灰掉且點不下去。
      expect(args.p_offset).toBe(0);
    }
    const [categoryCall, brandCall] = calls.map(([, args]) => args);
    expect(categoryCall).toMatchObject({ p_category: '碳纖維部品', p_brand_slugs: null });
    // 🔴 p_brand 是車輛廠牌;商品品牌必須走 p_brand_slugs,寫錯會靜默回「整個車廠」的件數
    expect(brandCall).toMatchObject({ p_category: null, p_brand_slugs: ['rpm-carbon'] });
    expect(brandCall?.p_brand).toBe('KAWASAKI');
  });

  it('車型/年份未選時傳 null(只選廠牌也要能算)', async () => {
    respondWith({});
    await queryVehicleFacetCounts({ brand: 'YAMAHA' }, ['碳纖維部品'], []);
    const [, args] = (rpc.mock.calls as Array<[string, RpcArgs]>)[0]!;
    expect(args.p_model).toBeNull();
    expect(args.p_year).toBeNull();
  });

  it('空字串品牌 slug 仍當成過濾條件,不得退成「完全不過濾品牌」', async () => {
    // 🔴 fail-open 方向錯誤的典型:`p_brand_slugs: null` = 不過濾 ⇒ 會把整台車的總件數
    //    當成那個品牌的件數(數字大很多、而且看起來很合理)。
    respondWith({});
    await queryVehicleFacetCounts(VEHICLE, [], ['']);
    const [, args] = (rpc.mock.calls as Array<[string, RpcArgs]>)[0]!;
    expect(args.p_brand_slugs).toEqual(['']);
  });

  it('total 是字串(bigint 走 JSON)也轉成數字;非數值當 0、不讓 NaN 進 UI', async () => {
    respondWith({ a: '2130', b: 'not-a-number' });
    const counts = await queryVehicleFacetCounts(VEHICLE, ['a', 'b'], []);
    expect(counts.categories).toEqual({ a: 2130, b: 0 });
  });

  it('同時在跑的查詢數不超過 FACET_CONCURRENCY', async () => {
    let inFlight = 0;
    let peak = 0;
    rpc.mockImplementation(
      () =>
        new Promise((resolve) => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          setTimeout(() => {
            inFlight -= 1;
            resolve({ data: [{ item: {}, total: 1 }], error: null });
          }, 1);
        }),
    );

    const keys = Array.from({ length: FACET_CONCURRENCY * 3 }, (_, i) => `c${i}`);
    const counts = await queryVehicleFacetCounts(VEHICLE, keys, []);

    expect(Object.keys(counts.categories)).toHaveLength(keys.length);
    expect(peak).toBeLessThanOrEqual(FACET_CONCURRENCY);
    expect(peak).toBeGreaterThan(1); // 真的有併發,不是一條一條跑
  });

  it('任一支失敗 → 整批 throw(不得回半套數字)', async () => {
    rpc.mockImplementation((_fn: string, args: RpcArgs) =>
      Promise.resolve(
        args.p_category === 'boom'
          ? { data: null, error: { message: 'statement timeout' } }
          : { data: [{ item: {}, total: 3 }], error: null },
      ),
    );

    await expect(
      queryVehicleFacetCounts(VEHICLE, ['ok-1', 'boom', 'ok-2'], ['rpm-carbon']),
    ).rejects.toThrow('statement timeout');
  });

  it('throw 出去時所有 worker 已收乾淨,不留在背景繼續打 DB(allSettled 收尾的理由)', async () => {
    // 🔴 這是 allSettled 與 Promise.all 唯一真正的差別:後者在第一個 reject 當下就往外拋,
    //    其餘 worker 的查詢還在飛 —— 回應都送出去了、DB 還在被打。
    //    (原本這裡寫的理由「Promise.all 會造成 unhandled rejection」是錯的,實測不成立。)
    let started = 0;
    let finished = 0;
    rpc.mockImplementation((_fn: string, args: RpcArgs) => {
      started += 1;
      if (args.p_category === 'boom') {
        finished += 1;
        return Promise.resolve({ data: null, error: { message: 'boom' } });
      }
      return new Promise((resolve) =>
        setTimeout(() => {
          finished += 1;
          resolve({ data: [{ item: {}, total: 1 }], error: null });
        }, 30),
      );
    });

    const keys = ['boom', ...Array.from({ length: 10 }, (_, i) => `slow-${i}`)];
    await expect(queryVehicleFacetCounts(VEHICLE, keys, [])).rejects.toThrow('boom');
    expect(finished).toBe(started);
  });

  it('第一支失敗後不再發後續查詢(DB 已在噴錯就別再打 100 條)', async () => {
    rpc.mockImplementation((_fn: string, args: RpcArgs) =>
      args.p_category === 'c0'
        ? Promise.resolve({ data: null, error: { message: 'boom' } })
        : new Promise((resolve) =>
            setTimeout(() => resolve({ data: [{ item: {}, total: 1 }], error: null }), 5),
          ),
    );

    const keys = Array.from({ length: 40 }, (_, i) => `c${i}`);
    await expect(queryVehicleFacetCounts(VEHICLE, keys, [])).rejects.toThrow('boom');
    expect(rpc.mock.calls.length).toBeLessThan(keys.length);
  });
});

describe('fetchVehicleFacetCounts(快取包裝 + fan-out 閘)', () => {
  beforeEach(() => {
    rpc.mockImplementation(() =>
      Promise.resolve({ data: [{ item: {}, total: 7 }], error: null }),
    );
  });

  it('快取 key 帶滿車輛三段 + 兩份清單 ⇒ 不同的車不會共用同一筆快取', async () => {
    cachedCallArgs.length = 0;
    await fetchVehicleFacetCounts({ brand: 'YAMAHA', model: 'MT-09', year: 2021 }, ['a'], ['b']);
    await fetchVehicleFacetCounts({ brand: 'YAMAHA', model: 'MT-09', year: 2022 }, ['a'], ['b']);
    await fetchVehicleFacetCounts({ brand: 'YAMAHA' }, ['a'], ['b']);

    // unstable_cache 是**以參數**當 key 的 ⇒ 這三組參數必須彼此不同
    expect(cachedCallArgs).toEqual([
      ['["YAMAHA","MT-09",2021]', '["a"]', '["b"]'],
      ['["YAMAHA","MT-09",2022]', '["a"]', '["b"]'],
      ['["YAMAHA",null,null]', '["a"]', '["b"]'],
    ]);
    // 清單變動也要換 key(分類樹長出新分類時不得讀到少一格的舊結果)
    cachedCallArgs.length = 0;
    await fetchVehicleFacetCounts({ brand: 'YAMAHA' }, ['a', 'z'], ['b']);
    expect(cachedCallArgs[0]?.[1]).toBe('["a","z"]');
    // 快取宣告本身:15 分鐘 + catalog tag(與目錄頁同一個失效開關)
    expect(cacheDeclarations.at(-1)?.options).toMatchObject({ revalidate: 900, tags: ['catalog'] });
  });

  it('🔴 同一台車同時來多個請求 → 只跑一次 fan-out(unstable_cache 不是 single-flight)', async () => {
    // codex 關卡2 C3:同一個冷 key 同時來三個 request,三個都 miss、都進 callback
    // ⇒ 瞬間 324 次 RPC、第四位客人直接 503。原本的併發測試刻意用**不同** key,測不到這件事。
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    rpc.mockImplementation(() => blocked.then(() => ({ data: [{ item: {}, total: 1 }], error: null })));

    const same = () => fetchVehicleFacetCounts({ brand: 'SAME' }, ['a', 'b'], ['c']);
    const all = [same(), same(), same()];
    release?.();
    const results = await Promise.all(all);

    expect(results.every((r) => r !== null)).toBe(true);
    // 三個請求 × 3 個 facet = 9 次;single-flight 之下只該有 3 次
    expect(rpc.mock.calls.length).toBe(3);
  });

  it('同時進行的 fan-out 超過上限 → 拒絕(回 null 讓 route 回 503),名額用完會歸還', async () => {
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    rpc.mockImplementation(
      () => blocked.then(() => ({ data: [{ item: {}, total: 1 }], error: null })),
    );

    const inFlight = Array.from({ length: MAX_CONCURRENT_FANOUTS }, (_, i) =>
      fetchVehicleFacetCounts({ brand: `B${i}` }, ['a'], []),
    );
    // 🔴 上面幾支都還卡在 DB ⇒ 這一支必須被擋下,而不是排隊等
    await expect(fetchVehicleFacetCounts({ brand: 'OVERFLOW' }, ['a'], [])).resolves.toBeNull();

    release?.();
    await Promise.all(inFlight);
    // 名額歸還後,同樣的請求要能成功
    await expect(fetchVehicleFacetCounts({ brand: 'AFTER' }, ['a'], [])).resolves.not.toBeNull();
  });
});
