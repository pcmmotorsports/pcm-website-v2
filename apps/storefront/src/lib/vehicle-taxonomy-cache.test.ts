/**
 * vehicle-taxonomy-cache.test.ts —— 車款樹快取只存 RPC 原始那一份(2026-09-15 主視窗第 18 件)。
 *
 * 守兩件事:
 *  ① 快取回呼回的是原始 `{ n, rows }`(~499KB), 不是組好的樹(舊版 2.68MB, 超過 Next 單條 2MB 存不進去)。
 *  ② 形狀壞的 payload 仍然 throw、不進快取 —— 邊界往內縮之後, 「壞的那份被存一小時」不能發生。
 * 形狀照 `pdp-product-cache.test.ts`:`unstable_cache` 換成記憶體 Map, 真的會「命中」。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const cacheStore = new Map<string, unknown>();
vi.mock('next/cache', () => ({
  unstable_cache:
    (fn: (...a: unknown[]) => unknown) =>
    async (...args: unknown[]) => {
      const key = JSON.stringify(args);
      if (cacheStore.has(key)) return cacheStore.get(key);
      const out = await fn(...args);
      cacheStore.set(key, out);
      return out;
    },
}));

const GOOD = {
  n: 3,
  rows: [
    ['Yamaha', 'MT-09', 2021, null],
    ['Yamaha', 'MT-07', null, 2020],
    ['Ducati', 'Panigale V4', 2018, 2024],
  ],
};
let payload: unknown = GOOD;
let rpcCalls = 0;
vi.mock('@/lib/catalog-anon-client', () => ({
  createCatalogAnonClient: () => ({
    rpc: async () => {
      rpcCalls += 1;
      return { data: payload, error: null };
    },
  }),
}));

// 🔵 2026-09-15 第 20 件:products.ts 多了一層模組層記憶(singleFlightStale)⇒ 每一格重新載入模組,
//   否則上一格記住的值會讓下一格根本不進快取(斷言本體不動)。
let tryVehicleTaxonomy: typeof import('./products').tryVehicleTaxonomy;

beforeEach(async () => {
  cacheStore.clear();
  payload = GOOD;
  rpcCalls = 0;
  vi.resetModules();
  ({ tryVehicleTaxonomy } = await import('./products'));
});

describe('車款樹快取只存原始 rows', () => {
  it('🔴 快取裡是原始 { n, rows }, 不是組好的樹;第二發命中快取、照樣組得出樹', async () => {
    const first = await tryVehicleTaxonomy();
    expect(first.failed).toBe(false);
    expect(first.motoBrands.map((b) => b.name).sort()).toEqual(['Ducati', 'Yamaha']);

    expect(cacheStore.size).toBe(1);
    const [stored] = [...cacheStore.values()];
    expect(stored).toEqual(GOOD);

    const second = await tryVehicleTaxonomy();
    expect(rpcCalls).toBe(1);
    expect(second.motoBrands).toEqual(first.motoBrands);
  });

  it('🔴 形狀壞的 payload ⇒ failed、不進快取;下一發資料好了就回得來', async () => {
    payload = { n: 1, rows: [['Yamaha', 'MT-09', 2021]] };
    const bad = await tryVehicleTaxonomy();
    expect(bad).toEqual({ motoBrands: [], failed: true });
    expect(cacheStore.size).toBe(0);

    payload = GOOD;
    const good = await tryVehicleTaxonomy();
    expect(good.failed).toBe(false);
    expect(rpcCalls).toBe(2);
  });
});
