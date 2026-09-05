import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import {
  listPendingRefundAmounts,
  PendingRefundShapeError,
  PENDING_REFUND_RPC_NAME,
} from './pending-refund-repository';

const MIGRATION = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../supabase/migrations/20260902030000_m4b_crossrail_pending_refund_net.sql',
);
const ORDER = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

beforeEach(() => mocks.rpc.mockReset());

describe('listPendingRefundAmounts —— `pcm_pending_refund_amounts` 的讀端', () => {
  it('有待退款:逐 rail 的金額原樣回來, 而參數送對', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        { rail: 'bank_transfer', amount: 600 },
        { rail: 'cash', amount: 400 },
      ],
      error: null,
    });
    await expect(listPendingRefundAmounts(ORDER)).resolves.toEqual([
      { rail: 'bank_transfer', amount: 600 },
      { rail: 'cash', amount: 400 },
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith(PENDING_REFUND_RPC_NAME, { p_order_id: ORDER });
  });

  it('沒有待退款:RPC 回空陣列 ⇒ 空陣列(不是錯)', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await expect(listPendingRefundAmounts(ORDER)).resolves.toEqual([]);
  });

  // 🔴🔴 **這一格是這支檔存在的理由**:讀失敗與「沒有待退款」在畫面上長得一模一樣,
  //    而它們差一筆該退給客人的錢。收斂成 `[]` / `0` ⇒ 錢靜靜地不見。
  it('RPC 失敗:拋, 不回 0 也不回空陣列', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(listPendingRefundAmounts(ORDER)).rejects.toThrow(/42501/);
  });

  it('負對照:上一格若寫成回空陣列, 這一格要能分辨 —— 錯誤路徑不得與空結果同形', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const ok = await listPendingRefundAmounts(ORDER);
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'x' } });
    const bad = await listPendingRefundAmounts(ORDER).then(
      () => 'resolved',
      () => 'rejected',
    );
    expect([ok.length, bad]).toEqual([0, 'rejected']);
  });

  it.each([
    ['不是物件', ['x']],
    ['rail 空字串', [{ rail: '', amount: 1 }]],
    ['amount 是字串', [{ rail: 'cash', amount: '1' }]],
    ['amount 非整數', [{ rail: 'cash', amount: 1.5 }]],
    ['回傳不是陣列', { rail: 'cash' }],
  ])('形狀壞掉就拋(%s)', async (_name, data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expect(listPendingRefundAmounts(ORDER)).rejects.toBeInstanceOf(PendingRefundShapeError);
  });

  // 🔴 型別縫的看守者:`database.types.ts` 沒有這支 RPC ⇒ 名字打錯編譯器【不會叫】。
  it('RPC 名字逐字對得上 migration 裡的那一個', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain(`CREATE FUNCTION public.${PENDING_REFUND_RPC_NAME}(p_order_id uuid)`);
  });
});
