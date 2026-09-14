import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import { requestOrderItemAmountViaRpc, reviewOrderItemAmountViaRpc } from './amount-request-repository';

// M-4b-03 repository 契約(codex 20260915130000 R1 nit):action 測試把本檔整支 mock 掉 ⇒ 漏讀 `result` 它照樣全綠。
// 🔴 誠實邊界:這裡全是 mock ⇒ 證的是「RPC 回什麼形狀, 這裡就怎麼解」, 不是 RPC 在正式站的行為(那個在探針 drill)。

const ROW = '0f9a3c2e-1b4d-4e6f-8a9b-0c1d2e3f4a5b';
const ORDER = 'aaaa3c2e-1b4d-4e6f-8a9b-0c1d2e3f4a5b';
const REVIEW = { requestRowId: ROW, decision: 'approve' as const, reviewNote: null, actorId: 'sean', requestId: 'req-1' };

function ok(over: Record<string, unknown> = {}) {
  return { data: { result: 'ok', request_row_id: ROW, status: 'approved', order_id: ORDER, ...over }, error: null };
}

beforeEach(() => {
  mocks.rpc.mockReset();
});

describe('reviewOrderItemAmountViaRpc — 解 RPC 回傳', () => {
  it('approve 成功 ⇒ kind ok, result 原樣帶出', async () => {
    mocks.rpc.mockResolvedValue(ok());
    expect(await reviewOrderItemAmountViaRpc(REVIEW)).toEqual({ kind: 'ok', requestRowId: ROW, status: 'approved', orderId: ORDER, result: 'ok' });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_review_order_item_amount', expect.objectContaining({ p_request_row_id: ROW, p_decision: 'approve', p_actor: 'sean' }));
  });

  it('🔴 第 2 代自動退回 ⇒ status rejected + result stale_rejected 都要帶到 action(它靠 result 分辨誰退的)', async () => {
    mocks.rpc.mockResolvedValue(ok({ status: 'rejected', result: 'stale_rejected' }));
    expect(await reviewOrderItemAmountViaRpc(REVIEW)).toMatchObject({ kind: 'ok', status: 'rejected', result: 'stale_rejected' });
  });

  it('🔴 第 2 代撞三道硬擋自動退回 ⇒ result blocked_rejected 原樣帶出', async () => {
    mocks.rpc.mockResolvedValue(ok({ status: 'rejected', result: 'blocked_rejected' }));
    expect(await reviewOrderItemAmountViaRpc(REVIEW)).toMatchObject({ kind: 'ok', status: 'rejected', result: 'blocked_rejected' });
  });

  it('單已取消 ⇒ superseded 原樣帶出', async () => {
    mocks.rpc.mockResolvedValue(ok({ status: 'superseded', result: 'superseded' }));
    expect(await reviewOrderItemAmountViaRpc(REVIEW)).toMatchObject({ kind: 'ok', status: 'superseded', result: 'superseded' });
  });

  it('🔴 缺 result ⇒ throw(不默默當 ok —— 那會讓自動退回被印成「你退回了」)', async () => {
    mocks.rpc.mockResolvedValue({ data: { request_row_id: ROW, status: 'rejected', order_id: ORDER }, error: null });
    await expect(reviewOrderItemAmountViaRpc(REVIEW)).rejects.toThrow('result');
  });

  it('缺 order_id ⇒ throw', async () => {
    mocks.rpc.mockResolvedValue({ data: { result: 'ok', request_row_id: ROW, status: 'approved' }, error: null });
    await expect(reviewOrderItemAmountViaRpc(REVIEW)).rejects.toThrow('order_id');
  });

  it('P0001 管理者閘那句 ⇒ denied;P0001 其他人話 ⇒ rejected 帶訊息;非 P0001 ⇒ throw', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: '無權執行此操作' } });
    expect(await reviewOrderItemAmountViaRpc(REVIEW)).toEqual({ kind: 'denied' });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: '單價已經是 50 了' } });
    expect(await reviewOrderItemAmountViaRpc(REVIEW)).toEqual({ kind: 'rejected', message: '單價已經是 50 了' });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(reviewOrderItemAmountViaRpc(REVIEW)).rejects.toMatchObject({ code: '42501' });
  });
});

describe('requestOrderItemAmountViaRpc — 員工那支同一個解析器', () => {
  it('pending 成功 ⇒ kind ok(result 必填對它也成立)', async () => {
    mocks.rpc.mockResolvedValue(ok({ status: 'pending' }));
    const out = await requestOrderItemAmountViaRpc({
      orderId: ORDER, orderItemId: ROW, expectedVersion: 3, toUnitPrice: 50, zeroPriceReason: null, reason: '老客', actorId: 'staff_1', requestId: 'r',
    });
    expect(out).toEqual({ kind: 'ok', requestRowId: ROW, status: 'pending', orderId: ORDER, result: 'ok' });
  });
});
