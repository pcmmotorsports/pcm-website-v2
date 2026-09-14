// 部分取消信掃描 adapter —— 只釘第 22 件 ② codex R1 MF2 那一格:讓路的列要在【LIMIT 之前】濾掉。
// 🔴 少了 `vi.mock('server-only')` vitest 印的是【no tests】不是紅色(同 SupabaseUnpaidCancelledOrderScannerAdapter.test.ts)。
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { SupabasePartiallyCancelledOrderScannerAdapter } from './SupabasePartiallyCancelledOrderScannerAdapter';

type Call = [string, unknown[]];

/** 每一發 `.from()` 各給一個 builder, 記下鏈式呼叫;page 那發回空列, head 那兩發回 count。 */
function makeClient(count: number) {
  const queries: Call[][] = [];
  const from = vi.fn(() => {
    const calls: Call[] = [];
    queries.push(calls);
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'not', 'is', 'gte', 'order', 'limit']) {
      b[m] = (...args: unknown[]) => {
        calls.push([m, args]);
        return b;
      };
    }
    (b as { then: unknown }).then = (res: (v: unknown) => unknown) => res({ data: [], error: null, count });
    return b;
  });
  return { client: { from } as never, queries };
}

const IN = { cutoff: '2026-09-15T00:00:00.000Z', limit: 50 };
const eqs = (calls: Call[]) => calls.filter(([m]) => m === 'eq').map(([, a]) => a);
const hasLimit = (calls: Call[]) => calls.some(([m]) => m === 'limit');

describe('SupabasePartiallyCancelledOrderScannerAdapter — 讓路要在 LIMIT 之前(第 22 件 ② codex R1 MF2)', () => {
  it('🔴 yieldToBank ⇒ 取列那一發帶 bank_line_eligible = false(與 limit 同一發);另開一發精確 count 數讓路了幾列', async () => {
    const { client, queries } = makeClient(7);
    const r = await new SupabasePartiallyCancelledOrderScannerAdapter(client).listPartiallyCancelledWithoutEmail({ ...IN, yieldToBank: true });
    const page = queries.find(hasLimit)!;
    expect(eqs(page)).toEqual([['bank_line_eligible', false]]);
    const yieldedHead = queries.filter((q) => !hasLimit(q)).find((q) => eqs(q).some(([k, v]) => k === 'bank_line_eligible' && v === true));
    expect(yieldedHead).toBeDefined();
    expect(r.yieldedInView).toBe(7);
  });

  it('🛑 沒上膛 ⇒ 任何一發都不帶 bank_line_eligible(不濾、不數)', async () => {
    const { client, queries } = makeClient(3);
    const r = await new SupabasePartiallyCancelledOrderScannerAdapter(client).listPartiallyCancelledWithoutEmail({ ...IN, yieldToBank: false });
    expect(queries.flatMap(eqs).filter(([k]) => k === 'bank_line_eligible')).toEqual([]);
    expect(r.yieldedInView).toBe(0);
  });
});
