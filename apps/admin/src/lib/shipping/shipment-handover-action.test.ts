import { beforeEach, describe, expect, it, vi } from 'vitest';

// P0-1 片 5:「確認已交貨」action 的閘。真權威在 RPC(`is_manager` / 理由 / 狀態), 這裡守的是:
//   ① 非管理者(或沒有具名 actor)⇒ 一發 RPC 都不打
//   ② 理由空白 ⇒ 不打
//   ③ actor 取自 server 端授權結果, 不是 client 送的任何東西

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const authorizeManagerMutation = vi.fn();
vi.mock('../session/authorize', () => ({ authorizeManagerMutation: () => authorizeManagerMutation() }));
const confirmHctHandover = vi.fn();
vi.mock('./shipment-repository', () => ({ confirmHctHandover: (a: unknown) => confirmHctHandover(a) }));
vi.mock('../audit/context', () => ({ getRequestId: async () => 'req-1' }));

const ARGS = { shipmentId: 'sid-1', shipmentReference: 'BCDFGH', reason: '司機簽收單 123, 14:30 新竹陳小姐確認' };

describe('confirmHctHandoverAction', () => {
  beforeEach(() => {
    authorizeManagerMutation.mockReset();
    confirmHctHandover.mockReset();
  });

  it('非管理者 / 沒有 actor ⇒ 不打 RPC', async () => {
    authorizeManagerMutation.mockResolvedValue(null);
    const { confirmHctHandoverAction } = await import('./shipment-handover-action');
    const out = await confirmHctHandoverAction(ARGS);
    expect(out.ok).toBe(false);
    expect(confirmHctHandover).not.toHaveBeenCalled();
  });

  it('理由空白 ⇒ 不打 RPC', async () => {
    authorizeManagerMutation.mockResolvedValue({ sid: 's', actorId: 'mgr@pcm' });
    const { confirmHctHandoverAction } = await import('./shipment-handover-action');
    const out = await confirmHctHandoverAction({ ...ARGS, reason: '  \t ' });
    expect(out.ok).toBe(false);
    expect(confirmHctHandover).not.toHaveBeenCalled();
  });

  it('管理者 + 理由 ⇒ 打 RPC, actor 用授權結果', async () => {
    authorizeManagerMutation.mockResolvedValue({ sid: 's', actorId: 'mgr@pcm' });
    confirmHctHandover.mockResolvedValue(undefined);
    const { confirmHctHandoverAction } = await import('./shipment-handover-action');
    expect(await confirmHctHandoverAction(ARGS)).toEqual({ ok: true });
    expect(confirmHctHandover).toHaveBeenCalledWith({
      shipmentReference: 'BCDFGH',
      actor: 'mgr@pcm',
      reason: ARGS.reason,
      requestId: 'req-1',
    });
  });

  it('RPC 丟錯 ⇒ 原句給人看(RPC 的訊息本來就是中文人話)', async () => {
    authorizeManagerMutation.mockResolvedValue({ sid: 's', actorId: 'mgr@pcm' });
    confirmHctHandover.mockRejectedValue(new Error('確認已交貨:出貨單 BCDFGH 已作廢, 不能確認交貨'));
    const { confirmHctHandoverAction } = await import('./shipment-handover-action');
    expect(await confirmHctHandoverAction(ARGS)).toEqual({
      ok: false,
      message: '確認已交貨:出貨單 BCDFGH 已作廢, 不能確認交貨',
    });
  });
});
