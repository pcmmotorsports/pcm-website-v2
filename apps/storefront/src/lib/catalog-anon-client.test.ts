// catalog-anon-client.test.ts — 目錄讀路四處都走帶 15 秒上限的那一支;寫路(search-log)不走。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { createSupabaseAnonClient } = vi.hoisted(() => ({
  createSupabaseAnonClient: vi.fn((_opts?: { fetchTimeoutMs?: number }) => ({ tag: 'client' })),
}));
vi.mock('@pcm/adapters', () => ({ createSupabaseAnonClient }));

import { CATALOG_FETCH_TIMEOUT_MS, createCatalogAnonClient } from './catalog-anon-client';

const read = (rel: string) => readFileSync(join(__dirname, rel), 'utf8');

describe('createCatalogAnonClient', () => {
  it('把 15 秒上限傳進 factory', () => {
    expect(createCatalogAnonClient()).toEqual({ tag: 'client' });
    expect(createSupabaseAnonClient).toHaveBeenCalledWith({ fetchTimeoutMs: 15_000 });
    expect(CATALOG_FETCH_TIMEOUT_MS).toBe(15_000);
  });

  it('讀路四檔只叫 createCatalogAnonClient、不再直接叫 createSupabaseAnonClient()', () => {
    for (const rel of ['products.ts', 'search.ts', 'recommendations/fetch-recommendations.ts', 'vehicle-facet-counts.ts']) {
      const src = read(rel);
      expect(src, rel).toContain('createCatalogAnonClient()');
      expect(src, rel).not.toContain('createSupabaseAnonClient()');
    }
  });

  it('🔵 負對照:search-log(寫路)仍直接叫 createSupabaseAnonClient(), 不帶上限', () => {
    expect(read('search-log.ts')).toContain('createSupabaseAnonClient()');
    expect(read('search-log.ts')).not.toContain('createCatalogAnonClient');
  });
});
