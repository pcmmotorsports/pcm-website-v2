// 客人選好車時, 目錄卡片那一行改寫「適用您的車」(2026-09-29 主視窗派工第 3 項;計畫 ~/pcm-mailbox/計畫-卡片適用您的車-20260929.md, Fable R1 PASS)。
// 🔴 錯說「適用」比不說更糟 ⇒ 下面一半是「不該標」的格子。
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: (...a: unknown[]) => unknown) => fn }));
const anonRpc = vi.fn();
vi.mock('@pcm/adapters', async () => {
  const real = await vi.importActual<typeof import('@pcm/adapters')>('@pcm/adapters');
  return { ...real, createSupabaseAnonClient: () => ({ rpc: anonRpc }) as never };
});

const { fetchCatalogPage } = await import('./products');
const { parseCatalogQuery } = await import('./catalog-query');

const q = parseCatalogQuery({ get: () => null } as never);
const MT09 = [{ motoBrand: 'Yamaha', modelCode: 'MT-09', yearStart: 2021, yearEnd: 2023 }];
const row = (fitments: unknown, handle = 'a') => ({
  item: { id: handle, handle, title: 'T', subtitle: null, availability: null, price_general: 100, card_image: null, fits: 'Yamaha MT-09', brand_name: 'B', brand_slug: 'b', category_raw: null, fitments },
  total: 1,
});
const run = async (fitments: unknown, vehicle: { brand: string; model?: string; year?: number } | null, scope: 'fit' | 'universal' | 'all' = 'fit') => {
  anonRpc.mockResolvedValue({ data: [row(fitments)], error: null });
  const r = await fetchCatalogPage(q, vehicle, 'general', scope);
  return r.products[0] as Record<string, unknown>;
};

beforeEach(() => anonRpc.mockReset());

describe('目錄卡片的 fitsVehicle(只有「適用這台車」清單才標)', () => {
  it('選了車型、沒選年份, 而商品有年份限制 ⇒ qualified(卡片要請客人確認年份)', async () => {
    expect((await run(MT09, { brand: 'Yamaha', model: 'MT-09' })).fitsVehicle).toBe('qualified');
  });

  it('選了年份而且在範圍內 ⇒ match', async () => {
    expect((await run(MT09, { brand: 'Yamaha', model: 'MT-09', year: 2022 })).fitsVehicle).toBe('match');
  });

  it('商品不限年份、客人沒選年份 ⇒ match', async () => {
    expect((await run([{ motoBrand: 'Yamaha', modelCode: 'MT-09' }], { brand: 'Yamaha', model: 'MT-09' })).fitsVehicle).toBe('match');
  });

  it('🔵 名稱對不上(前端判 no-match)⇒ 不標, 卡片維持原本那一句', async () => {
    expect(await run(MT09, { brand: 'Yamaha', model: 'MT-07' })).not.toHaveProperty('fitsVehicle');
  });

  it('🔵 只選品牌沒選車型 ⇒ 不標(checkFitment 是 undetermined)', async () => {
    expect(await run(MT09, { brand: 'Yamaha' })).not.toHaveProperty('fitsVehicle');
  });

  it('🔵 通用款清單(universal)與沒選車(all)⇒ 不標', async () => {
    expect(await run(MT09, { brand: 'Yamaha', model: 'MT-09', year: 2022 }, 'universal')).not.toHaveProperty('fitsVehicle');
    expect(await run(MT09, null, 'all')).not.toHaveProperty('fitsVehicle');
  });

  it('🔵 年份存成字串(Fable R1 建議 1)⇒ 不標 —— 否則會被當成「不限年份」而錯說 match', async () => {
    expect(await run([{ motoBrand: 'Yamaha', modelCode: 'MT-09', yearStart: '2021', yearEnd: 2023 }], { brand: 'Yamaha', model: 'MT-09' })).not.toHaveProperty('fitsVehicle');
  });

  it('🔵 卡片仍不帶 fitments 陣列(頁面大小, catalog-page.ts:126)', async () => {
    expect(await run(MT09, { brand: 'Yamaha', model: 'MT-09' })).not.toHaveProperty('fitments');
  });
});
