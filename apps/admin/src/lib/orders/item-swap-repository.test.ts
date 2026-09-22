import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import { mapItemSwapOutcome, swapOrderItemViaRpc } from './item-swap-repository';

const ARGS = {
  orderId: '0f9a3c2e-1b4d-4e6f-8a9b-0c1d2e3f4a5b',
  itemId: '1f9a3c2e-1b4d-4e6f-8a9b-0c1d2e3f4a5b',
  expectedVersion: 4,
  newVariantId: '3f9a3c2e-1b4d-4e6f-8a9b-0c1d2e3f4a5b',
  actorId: 'staff_1',
  requestId: '2f9a3c2e-1b4d-4e6f-8a9b-0c1d2e3f4a5b',
};

const N1 = '4f9a3c2e-1b4d-4e6f-8a9b-0c1d2e3f4a5b';

beforeEach(() => {
  mocks.rpc.mockReset();
});

describe('swapOrderItemViaRpc', () => {
  it('參數名與函式簽章逐字對上', async () => {
    mocks.rpc.mockResolvedValue({ data: { result: 'swapped', new_item_id: N1 }, error: null });
    await expect(swapOrderItemViaRpc(ARGS)).resolves.toEqual({ kind: 'swapped', newItemId: N1 });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_swap_order_item', {
      p_actor: 'staff_1',
      p_request_id: ARGS.requestId,
      p_order_id: ARGS.orderId,
      p_item_id: ARGS.itemId,
      p_expected_order_version: 4,
      p_new_variant_id: ARGS.newVariantId,
    });
  });
});

describe('mapItemSwapOutcome', () => {
  it('五種正常結果', () => {
    expect(mapItemSwapOutcome({ result: 'idempotent', new_item_id: N1 }, null)).toEqual({ kind: 'idempotent', newItemId: N1 });
    expect(mapItemSwapOutcome({ result: 'conflict' }, null)).toEqual({ kind: 'conflict' });
    expect(mapItemSwapOutcome({ result: 'noop' }, null)).toEqual({ kind: 'noop' });
    expect(mapItemSwapOutcome({ result: 'rejected', reason: 'price_mismatch', source_price: 1000, target_price: 1200 }, null))
      .toEqual({ kind: 'rejected', reason: 'price_mismatch' });
  });

  it('不是員工(P0001 + 固定訊息)⇒ denied;其他錯誤原樣往上丟', () => {
    expect(mapItemSwapOutcome(null, { code: 'P0001', message: '無權執行此操作' })).toEqual({ kind: 'denied' });
    const other = { code: 'P0001', message: 'admin_swap_order_item: 訂單不存在' };
    expect(() => mapItemSwapOutcome(null, other)).toThrow();
  });

  it('🔴 形狀不對或代碼不認得 ⇒ 丟錯, 不猜成某一種結果', () => {
    expect(() => mapItemSwapOutcome({ result: 'rejected', reason: 'something_new' }, null)).toThrow(/不認得的拒絕代碼/);
    expect(() => mapItemSwapOutcome({ result: 'swapped' }, null)).toThrow(/new_item_id/);
    expect(() => mapItemSwapOutcome({ result: 'weird' }, null)).toThrow(/不認得的 result/);
    expect(() => mapItemSwapOutcome(null, null)).toThrow(/形狀不對/);
    for (const result of ['swapped', 'idempotent']) {
      for (const bad of ['', 'not-a-uuid', 123]) {
        expect(() => mapItemSwapOutcome({ result, new_item_id: bad }, null), `${result}:${String(bad)}`).toThrow(/new_item_id/);
      }
    }
  });
});
