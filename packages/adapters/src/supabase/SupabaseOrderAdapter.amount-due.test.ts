// ⟦Q1 甲⟧ Sean 2026-09-16「應收改成取消後剩下的金額」:adapter 算應收與未結待退款的兩支私有方法。
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { SupabaseOrderAdapter } from './SupabaseOrderAdapter';

type Result = { data: unknown; error: unknown };

function adapterWith(opts: { rpc?: () => Promise<Result>; pending?: () => Promise<Result> }) {
  const rpc = vi.fn(opts.rpc ?? (() => Promise.reject(new Error('rpc 不該被叫'))));
  const is2 = vi.fn(opts.pending ?? (() => Promise.reject(new Error('pending 不該被查'))));
  const from = vi.fn(() => ({ select: () => ({ eq: () => ({ is: () => ({ is: is2 }) }) }) }));
  const adapter = new SupabaseOrderAdapter({ rpc, from } as unknown as SupabaseClient);
  return { adapter, rpc, from };
}

describe('amountDueAfterCancel', () => {
  it('沒取消 ⇒ 原總額,不打 RPC;整單取消 ⇒ 0,不打 RPC', async () => {
    const { adapter, rpc } = adapterWith({});
    expect(await adapter['amountDueAfterCancel']('o1', 14300, null, false)).toBe(14300);
    expect(await adapter['amountDueAfterCancel']('o1', 14300, '2026-09-15T00:00:00Z', true)).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('部分取消 ⇒ pcm_order_remaining_receivable(bigint 字串也吃)', async () => {
    const { adapter, rpc } = adapterWith({ rpc: () => Promise.resolve({ data: '9220', error: null }) });
    expect(await adapter['amountDueAfterCancel']('o1', 14300, null, true)).toBe(9220);
    expect(rpc).toHaveBeenCalledWith('pcm_order_remaining_receivable', { p_order_id: 'o1' });
  });

  it('RPC 回 NULL / 錯誤 / throw / 負數 ⇒ 落回原總額(改前口徑),不是 0', async () => {
    for (const rpc of [
      () => Promise.resolve({ data: null, error: null }),
      () => Promise.resolve({ data: 9220, error: { code: '42501' } }),
      () => Promise.reject(new Error('boom')),
      () => Promise.resolve({ data: -1, error: null }),
    ]) {
      expect(await adapterWith({ rpc }).adapter['amountDueAfterCancel']('o1', 14300, null, true)).toBe(14300);
    }
  });
});

describe('openPendingRefundTotal', () => {
  it('未結列合計;查 order_pending_refunds', async () => {
    const { adapter, from } = adapterWith({
      pending: () => Promise.resolve({ data: [{ amount_at_cancel: 5080 }, { amount_at_cancel: '100' }], error: null }),
    });
    expect(await adapter['openPendingRefundTotal']('o1')).toBe(5180);
    expect(from).toHaveBeenCalledWith('order_pending_refunds');
  });

  it('沒有列 ⇒ 0;讀失敗 / 壞列 ⇒ null(不補 0)', async () => {
    expect(await adapterWith({ pending: () => Promise.resolve({ data: [], error: null }) }).adapter['openPendingRefundTotal']('o1')).toBe(0);
    for (const pending of [
      () => Promise.resolve({ data: null, error: { code: 'x' } }),
      () => Promise.reject(new Error('boom')),
      () => Promise.resolve({ data: [{ amount_at_cancel: null }], error: null }),
    ]) {
      expect(await adapterWith({ pending }).adapter['openPendingRefundTotal']('o1')).toBeNull();
    }
  });
});
