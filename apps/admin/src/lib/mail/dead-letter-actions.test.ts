import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const h = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  revalidatePath: vi.fn(),
  authorizeManagerMutation: vi.fn(),
  authorizeAdminMutation: vi.fn(),
  getRequestId: vi.fn(async () => 'req-1'),
  record: vi.fn(),
  rpc: vi.fn(),
  findDeadLetterForAudit: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: h.redirect }));
vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }));
vi.mock('../session/authorize', () => ({
  authorizeManagerMutation: h.authorizeManagerMutation,
  authorizeAdminMutation: h.authorizeAdminMutation,
}));
vi.mock('../audit/context', () => ({ getRequestId: h.getRequestId }));
vi.mock('../orders/order-repository', () => ({
  getAdminAuditLogRepository: () => ({ record: h.record }),
}));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ rpc: h.rpc }),
}));
vi.mock('./dead-letter-read', () => ({ findDeadLetterForAudit: h.findDeadLetterForAudit }));

import { requeueDeadEmailAction } from './dead-letter-actions';

// dead-letter-actions.test.ts — ⟦b4-MAILDEAD⟧ / ⟦b4-MAILAUDIT⟧。
//
// 🔴 **本檔最承重的兩格,而它們守的是【沒有做某件事】**:
//    ① 沒有權限的人按 ⇒ **RPC 一次都沒有被呼叫**(不是「有錯誤訊息」而已)
//    ② 稽核寫不成 ⇒ **RPC 一次都沒有被呼叫**(fail-closed;與 `staff-actions.ts:86` 的既有慣例相反)
//    ⇒ 📌 「沒有發生」這種事沒有畫面、沒有 log、沒有任何東西會紅 —— 只有測試看得到。

const DEAD = {
  id: 'ob-1',
  orderId: 'or-1',
  eventType: 'order_shipped',
  status: 'failed',
  attempts: 5,
  maxAttempts: 5,
  lastErrorCode: 'provider_error',
  createdAt: '2026-09-01T00:00:00Z',
  isDead: true,
};

function form(id: string | null = 'ob-1') {
  const f = new FormData();
  if (id !== null) f.set('outbox_id', id);
  return f;
}

async function runExpectingRedirect(fd: FormData): Promise<string> {
  try {
    await requeueDeadEmailAction(fd);
  } catch (error) {
    const m = /^REDIRECT:(.*)$/.exec(String((error as Error).message));
    if (m?.[1] !== undefined) return m[1];
    throw error;
  }
  throw new Error('預期會 redirect 而它沒有');
}

beforeEach(() => {
  vi.clearAllMocks();
  h.redirect.mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  });
  h.authorizeManagerMutation.mockResolvedValue({ sid: 's', actorId: 'alice' });
  h.findDeadLetterForAudit.mockResolvedValue(DEAD);
  h.record.mockResolvedValue(undefined);
  h.rpc.mockResolvedValue({ data: {}, error: null });
});

describe('requeueDeadEmailAction', () => {
  it('should go through the MANAGER gate, not the plain admin gate', async () => {
    // 🔴🔴 **這一格是本片最重要的突變靶**:把授權換回 `authorizeAdminMutation`
    //    ⇒ 任何登入者都按得動重排 ⇒ 而畫面、log、型別**全部不會有反應**。
    await runExpectingRedirect(form());

    expect(h.authorizeManagerMutation).toHaveBeenCalledTimes(1);
    expect(h.authorizeAdminMutation).not.toHaveBeenCalled();
  });

  it('should never call the RPC when the caller is not a manager', async () => {
    h.authorizeManagerMutation.mockResolvedValue(null);

    const url = await runExpectingRedirect(form());

    expect(url).toContain('r=denied');
    // 🔴 正文:不是「有沒有錯誤訊息」,是**那支 RPC 一次都沒被呼叫**。
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.record).not.toHaveBeenCalled();
  });

  it('should never requeue when the audit write fails (fail-closed)', async () => {
    h.record.mockRejectedValue(new Error('audit down'));

    const url = await runExpectingRedirect(form());

    expect(url).toContain('r=audit_failed');
    // 🔴 這一格與 `staff-actions.ts:86`(稽核失敗、變更已生效)**方向相反**,
    //    而兩者用的是同一條判準:重排晚一點沒差,「誰按的」查不回來。
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('should write the audit BEFORE calling the RPC', async () => {
    const order: string[] = [];
    h.record.mockImplementation(async () => void order.push('audit'));
    h.rpc.mockImplementation(async () => {
      order.push('rpc');
      return { data: {}, error: null };
    });

    const url = await runExpectingRedirect(form());

    // 🔴 三筆:請求的稽核 → RPC → 完成的稽核(codex R1 must-fix 2 之後)
    //    而【第一筆必須在 RPC 之前】—— 那是 fail-closed 的全部。
    expect(order).toEqual(['audit', 'rpc', 'audit']);
    expect(url).toContain('r=requeued');
  });

  it('should capture last_error_code in the audit before the RPC wipes it', async () => {
    // 🔴 那支 RPC 把 `last_error_code` 清成 NULL ⇒ 那個值**只有按下去之前讀得到**。
    await runExpectingRedirect(form());

    const entry = h.record.mock.calls[0]?.[0] as { before?: Record<string, unknown> };
    expect(entry.before?.last_error_code).toBe('provider_error');
    const ctx = h.record.mock.calls[0]?.[1] as { actor?: string };
    expect(ctx.actor).toBe('alice');
  });

  it('should reject rows that are not actually dead', async () => {
    // 🟢 正對照:述詞要與 RPC 白名單同義(兩邊都認 pending/failed + attempts 燒完)。
    h.findDeadLetterForAudit.mockResolvedValue({ ...DEAD, attempts: 2 });
    expect(await runExpectingRedirect(form())).toContain('r=rejected');

    h.findDeadLetterForAudit.mockResolvedValue({ ...DEAD, status: 'sent' });
    expect(await runExpectingRedirect(form())).toContain('r=rejected');

    // 🟢 而尺不是恆拒:合格的那一列要過。
    h.findDeadLetterForAudit.mockResolvedValue(DEAD);
    expect(await runExpectingRedirect(form())).toContain('r=requeued');
  });

  it('should surface RPC failure without claiming success', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'boom' } });
    expect(await runExpectingRedirect(form())).toContain('r=error');
  });
});
