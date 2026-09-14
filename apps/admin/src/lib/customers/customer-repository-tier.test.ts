// customer-repository-tier.test.ts — #954:setCustomerTier 永遠送 p_expected_before;
// 只有 PGRST202(六參簽章不在 = migration 20260914130000 還沒貼)才退回五參打一次。
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ rpc }),
  SupabaseWalletAdapter: class {},
}));
vi.mock('@pcm/adapters', () => ({ SupabaseCustomerAdapter: class {}, availabilityToBool: () => true }));

import { isSixArgSignatureMissing, setCustomerTier } from './customer-repository';

const ARGS = {
  customerId: '11111111-2222-3333-4444-555555555555',
  tier: 'store' as const,
  from: 'general' as const,
  note: '經銷申請審核通過',
  actor: 'staff-a',
  requestId: 'req-1',
};

describe('setCustomerTier · #954 from → p_expected_before', () => {
  it('六參一發:p_expected_before = from;STALE 原樣回', async () => {
    rpc.mockReset();
    rpc.mockResolvedValueOnce({ data: 'STALE', error: null });
    await expect(setCustomerTier(ARGS)).resolves.toBe('STALE');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_expected_before: 'general', p_tier: 'store' });
  });

  it('PGRST202(舊庫只有五參)⇒ 退回五參再打一次,第二發沒有 p_expected_before', async () => {
    rpc.mockReset();
    rpc
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'no matching function' } })
      .mockResolvedValueOnce({ data: 'UPDATED', error: null });
    await expect(setCustomerTier(ARGS)).resolves.toBe('UPDATED');
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1]?.[1]).not.toHaveProperty('p_expected_before');
  });

  it('42883 且訊息點名本函式六參(cache 記得六參、DB 已回滾)⇒ 也退回五參', async () => {
    rpc.mockReset();
    rpc
      .mockResolvedValueOnce({
        data: null,
        error: { code: '42883', message: 'function public.admin_set_customer_tier(uuid, text, text, text, text, text) does not exist' },
      })
      .mockResolvedValueOnce({ data: 'UPDATED', error: null });
    await expect(setCustomerTier(ARGS)).resolves.toBe('UPDATED');
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1]?.[1]).not.toHaveProperty('p_expected_before');
  });

  it('🔵 負對照:42883 而點名的是【別的】函式(RPC 體內叫到不存在的東西)⇒ 不退回、裸 throw', async () => {
    rpc.mockReset();
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42883', message: 'function public.some_helper(text) does not exist' },
    });
    await expect(setCustomerTier(ARGS)).rejects.toMatchObject({ code: '42883' });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(isSixArgSignatureMissing({ code: 'PGRST203', message: 'ambiguous' })).toBe(false);
  });

  it('🔵 負對照:其他錯不退回,裸 throw', async () => {
    rpc.mockReset();
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'tier 非法' } });
    await expect(setCustomerTier(ARGS)).rejects.toMatchObject({ code: 'P0001' });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
