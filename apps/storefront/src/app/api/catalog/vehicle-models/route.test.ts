// @vitest-environment node
//
// route.test.ts — vehicle-models route 守門(plan 2026-09-14 P1)。
//
// 三個世界三個碼是本 route 的全部契約:形狀不合 400 / 沒這牌子 404 / 字典這次讀不到 503。
// 🔴 404 與 503 不能混:client 對 404 是「牌子不存在,不用再試」,對 503 是「走字典不可用那扇門」。
// 🔴 成功回應要帶 s-maxage=3600(與 server 端 TTL 對齊);失敗一律 no-store(CDN 不得記住一次瞬時錯)。

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fetchVehicleTaxonomy } = vi.hoisted(() => ({ fetchVehicleTaxonomy: vi.fn() }));

vi.mock('@/lib/products', () => ({
  fetchVehicleTaxonomy,
  VEHICLE_TAXONOMY_REVALIDATE_SECONDS: 3600,
}));

const TAXONOMY = [
  {
    id: 'kawasaki',
    name: 'KAWASAKI',
    models: [{ id: 'zx10r', name: 'Ninja ZX-10R', years: [2023, 2024] }],
  },
  { id: 'honda', name: 'HONDA', models: [] },
];

import { GET } from './route';

const req = (qs: string) => new Request(`http://localhost/api/catalog/vehicle-models${qs}`);

describe('GET /api/catalog/vehicle-models', () => {
  beforeEach(() => {
    fetchVehicleTaxonomy.mockReset();
    fetchVehicleTaxonomy.mockResolvedValue(TAXONOMY);
  });

  it('回那個牌子的 models,帶 s-maxage=3600', async () => {
    const res = await GET(req('?brand=kawasaki'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(
      'public, s-maxage=3600, stale-while-revalidate=86400',
    );
    await expect(res.json()).resolves.toEqual({
      brandId: 'kawasaki',
      models: [{ id: 'zx10r', name: 'Ninja ZX-10R', years: [2023, 2024] }],
    });
  });

  it('沒有 brand / 形狀不合 ⇒ 400,不碰字典', async () => {
    for (const qs of ['', '?brand=', '?brand=Kawasaki', '?brand=a%20b', '?brand=a:b']) {
      const res = await GET(req(qs));
      expect(res.status, qs).toBe(400);
      expect(res.headers.get('cache-control'), qs).toBe('no-store');
    }
    expect(fetchVehicleTaxonomy).not.toHaveBeenCalled();
  });

  it('形狀合法但字典裡沒這牌子 ⇒ 404(不是 500),no-store', async () => {
    const res = await GET(req('?brand=ducati'));
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    await expect(res.json()).resolves.toEqual({ error: 'brand_not_found' });
  });

  it('字典 throw ⇒ 503 no-store', async () => {
    fetchVehicleTaxonomy.mockRejectedValue(new Error('boom'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET(req('?brand=kawasaki'));
    spy.mockRestore();
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('字典回空陣列 ⇒ 503(空 = 這次查不到,不是沒有牌子)', async () => {
    fetchVehicleTaxonomy.mockResolvedValue([]);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET(req('?brand=kawasaki'));
    spy.mockRestore();
    expect(res.status).toBe(503);
  });
});
