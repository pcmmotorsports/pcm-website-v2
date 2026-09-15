import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { readPartialCancelReconciliationCounts } from './partial-cancel-reconciliation-read';

function fakeClient(result: { data: unknown; error: unknown; count: number | null }) {
  const limit = vi.fn().mockResolvedValue(result);
  const inFn = vi.fn(() => ({ limit }));
  const select = vi.fn(() => ({ in: inFn }));
  const from = vi.fn(() => ({ select }));
  return { client: { from } as never, from, select, inFn };
}

describe('readPartialCancelReconciliationCounts', () => {
  it('🔴 只向 DB 要 missing_row / rail_mismatch(Q5 甲;雜訊列不會把真的漏開擠出 LIMIT)', async () => {
    const f = fakeClient({ data: [], error: null, count: 0 });
    await readPartialCancelReconciliationCounts(f.client);
    expect(f.from).toHaveBeenCalledWith('pcm_partial_cancel_refund_reconciliation_v');
    expect(f.select).toHaveBeenCalledWith('kind', { count: 'exact' });
    expect(f.inFn).toHaveBeenCalledWith('kind', ['missing_row', 'rail_mismatch']);
  });

  it('total 用 exact count(不是抓回來的列數);細分逐 kind 數', async () => {
    const f = fakeClient({
      data: [{ kind: 'missing_row' }, { kind: 'missing_row' }, { kind: 'rail_mismatch' }],
      error: null,
      count: 1200,
    });
    await expect(readPartialCancelReconciliationCounts(f.client)).resolves.toEqual({
      total: 1200,
      missingRow: 2,
      railMismatch: 1,
    });
  });

  it('🔴 讀失敗 ⇒ throw(不回 0 —— 0 會被讀成「沒有差額」)', async () => {
    const f = fakeClient({ data: null, error: { code: '42501', message: 'permission denied' }, count: null });
    await expect(readPartialCancelReconciliationCounts(f.client)).rejects.toMatchObject({ code: '42501' });
  });
});
