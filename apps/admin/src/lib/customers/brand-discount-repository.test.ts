import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { pages, calls } = vi.hoisted(() => ({ pages: [] as unknown[][], calls: [] as [number, number][] }));
vi.mock('@pcm/adapters/server', () => {
  const q = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'is', 'in', 'order']) chain[m] = () => chain;
    chain.range = (a: number, b: number) => {
      calls.push([a, b]);
      const data = table === 'order_item_costs' ? (pages.shift() ?? []) : [];
      return Promise.resolve({ data, error: null });
    };
    chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
    return chain;
  };
  return { createSupabaseServiceClient: () => ({ from: q }), SupabaseDealerApplicationAdapter: class {} };
});

import { loadCostedVariants } from './brand-discount-repository';

const costRow = (i: number) => ({
  order_item_id: `oi-${String(i).padStart(5, '0')}`,
  updated_at: '2026-09-20T00:00:00Z',
  cost_price: '1',
  cost_shipping: '0',
  cost_tax: '0',
  fx_rate: '1',
  order_items: { variant_id: `v${i}`, quantity: 1 },
});

beforeEach(() => {
  pages.length = 0;
  calls.length = 0;
});

describe('🔴 成本資料分頁讀到底(Codex E4 R1:伺服器單次上限會靜靜截斷)', () => {
  it('第一頁滿 1000 筆 ⇒ 繼續讀下一頁, 直到不滿', async () => {
    pages.push(Array.from({ length: 1000 }, (_, i) => costRow(i)), [costRow(1000)]);
    const r = await loadCostedVariants();
    expect(calls.slice(0, 2)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(r?.unitCost.size).toBe(1001);
  });
});
