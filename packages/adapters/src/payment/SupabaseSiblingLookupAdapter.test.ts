// node env;mock 'server-only'(adapter 檔頭 import 'server-only')。
import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { SupabaseSiblingLookupAdapter } from './SupabaseSiblingLookupAdapter';
import type { SupabaseClient } from '@supabase/supabase-js';

const CART = 'cart-uuid-1';
const ORDER = 'order-uuid-1';
const ATTEMPT = 'attempt-uuid-1';
const DISPLAY = 'PCM-2026-0099';

type RpcResult = { data: unknown; error: { code?: string } | null };

function makeSupabase(result: RpcResult) {
  const rpc = vi.fn(async () => result);
  const supabase = { rpc } as unknown as SupabaseClient;
  return { supabase, rpc };
}

describe('SupabaseSiblingLookupAdapter.lookup(find_active_sibling_own、authenticated own-only)', () => {
  it('kind=none → {kind:none};rpc 參數 = (find_active_sibling_own, {p_cart_session_id})', async () => {
    const { supabase, rpc } = makeSupabase({ data: { kind: 'none' }, error: null });
    const res = await new SupabaseSiblingLookupAdapter(supabase).lookup(CART);
    expect(res).toEqual({ kind: 'none' });
    expect(rpc).toHaveBeenCalledWith('find_active_sibling_own', { p_cart_session_id: CART });
  });

  it('kind=paid → 映 {kind:paid, existingOrderId, displayId}', async () => {
    const { supabase } = makeSupabase({
      data: { kind: 'paid', existingOrderId: ORDER, displayId: DISPLAY },
      error: null,
    });
    const res = await new SupabaseSiblingLookupAdapter(supabase).lookup(CART);
    expect(res).toEqual({ kind: 'paid', existingOrderId: ORDER, displayId: DISPLAY });
  });

  it('🔴 kind=active → 映 {kind:active, existingOrderId, attemptId, displayId}(無 rec/bank 資料最小化)', async () => {
    const { supabase } = makeSupabase({
      data: {
        kind: 'active',
        existingOrderId: ORDER,
        attemptId: ATTEMPT,
        displayId: DISPLAY,
        // 即使 RPC 多帶髒欄位也不得進回傳(資料最小化、白名單投影)
        recTradeId: 'D-should-not-leak',
        bankTransactionId: 'B-should-not-leak',
      },
      error: null,
    });
    const res = await new SupabaseSiblingLookupAdapter(supabase).lookup(CART);
    expect(res).toEqual({
      kind: 'active',
      existingOrderId: ORDER,
      attemptId: ATTEMPT,
      displayId: DISPLAY,
    });
    expect(res).not.toHaveProperty('recTradeId');
    expect(res).not.toHaveProperty('bankTransactionId');
  });

  it('PostgREST error → throw 通用訊息(帶 code 分類、零原文)', async () => {
    const { supabase } = makeSupabase({ data: null, error: { code: 'PGRST301' } });
    await expect(new SupabaseSiblingLookupAdapter(supabase).lookup(CART)).rejects.toThrow(
      'sibling lookup 失敗',
    );
  });

  it.each([
    ['data=null', null],
    ['kind 缺', {}],
    ['未知 kind', { kind: 'weird' }],
    ['paid 缺 displayId', { kind: 'paid', existingOrderId: ORDER }],
    ['active 缺 attemptId', { kind: 'active', existingOrderId: ORDER, displayId: DISPLAY }],
    ['active existingOrderId 非字串', { kind: 'active', existingOrderId: 1, attemptId: ATTEMPT, displayId: DISPLAY }],
  ])('回應形狀不符(%s)→ throw 通用訊息(fail-closed、不靜默轉 none)', async (_l, data) => {
    const { supabase } = makeSupabase({ data, error: null });
    await expect(new SupabaseSiblingLookupAdapter(supabase).lookup(CART)).rejects.toThrow(
      '回應格式異常',
    );
  });
});
