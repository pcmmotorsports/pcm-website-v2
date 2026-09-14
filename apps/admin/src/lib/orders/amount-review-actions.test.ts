import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const h = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  revalidatePath: vi.fn(),
  authorizeManagerMutation: vi.fn(),
  getRequestId: vi.fn(async () => 'req-1'),
  reviewOrderItemAmountViaRpc: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: h.redirect }));
vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }));
vi.mock('../session/authorize', () => ({ authorizeManagerMutation: h.authorizeManagerMutation }));
vi.mock('../audit/context', () => ({ getRequestId: h.getRequestId }));
vi.mock('./amount-request-repository', () => ({ reviewOrderItemAmountViaRpc: h.reviewOrderItemAmountViaRpc }));

import { MESSAGES } from '../../components/orders/result-banner';
import { reviewOrderItemAmountAction } from './amount-review-actions';

// M-4b-03 C:管理者核 / 退 action。閘 = 管理者閘(非管理者 ⇒ denied, RPC 零呼叫);七顆結果碼都要在 result-banner 有字。
const ROW = '0f9a3c2e-1b4d-4e6f-8a9b-0c1d2e3f4a5b';
const ORDER_A = 'aaaa3c2e-1b4d-4e6f-8a9b-0c1d2e3f4a5b';
const ORDER_B = 'bbbb3c2e-1b4d-4e6f-8a9b-0c1d2e3f4a5b';

function form(over: Record<string, string | null> = {}) {
  const f = new FormData();
  const base: Record<string, string> = { amount_request_row_id: ROW, decision: 'approve', return_to: `/orders?open=${ORDER_A}` };
  for (const [k, v] of Object.entries({ ...base, ...over })) if (v !== null) f.set(k, v);
  return f;
}

async function run(fd: FormData): Promise<string> {
  try {
    await reviewOrderItemAmountAction(fd);
  } catch (error) {
    const m = /^REDIRECT:(.*)$/.exec(String((error as Error).message));
    if (m?.[1] !== undefined) return m[1];
    throw error;
  }
  throw new Error('預期會 redirect 而它沒有');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  h.redirect.mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  });
  h.authorizeManagerMutation.mockResolvedValue({ sid: 's', actorId: 'sean' });
  h.reviewOrderItemAmountViaRpc.mockResolvedValue({ kind: 'ok', requestRowId: ROW, status: 'approved', orderId: ORDER_A, result: 'ok' });
});

describe('reviewOrderItemAmountAction', () => {
  it('核准:RPC 收到 approve + 管理者 actor, 回 ?r=amount_review_approved', async () => {
    expect(await run(form())).toBe(`/orders?open=${ORDER_A}&r=amount_review_approved`);
    expect(h.reviewOrderItemAmountViaRpc).toHaveBeenCalledWith({ requestRowId: ROW, decision: 'approve', reviewNote: null, actorId: 'sean', requestId: 'req-1' });
  });

  it('退回:要理由;有理由 ⇒ rejected 碼', async () => {
    expect(await run(form({ decision: 'reject' }))).toBe(`/orders?open=${ORDER_A}&r=amount_review_invalid`);
    expect(h.reviewOrderItemAmountViaRpc).not.toHaveBeenCalled();
    h.reviewOrderItemAmountViaRpc.mockResolvedValue({ kind: 'ok', requestRowId: ROW, status: 'rejected', orderId: ORDER_A, result: 'ok' });
    expect(await run(form({ decision: 'reject', review_note: ' 成本撐不住 ' }))).toBe(`/orders?open=${ORDER_A}&r=amount_review_rejected`);
    expect(h.reviewOrderItemAmountViaRpc).toHaveBeenCalledWith(expect.objectContaining({ decision: 'reject', reviewNote: '成本撐不住' }));
  });

  it('🔴 非管理者 / 沒票 ⇒ amount_review_denied, RPC 零呼叫', async () => {
    h.authorizeManagerMutation.mockResolvedValue(null);
    expect(await run(form())).toBe(`/orders?open=${ORDER_A}&r=amount_review_denied`);
    expect(h.reviewOrderItemAmountViaRpc).not.toHaveBeenCalled();
  });

  it('🔴 row id 不是 UUID / decision 不認得 ⇒ invalid, RPC 零呼叫', async () => {
    expect(await run(form({ amount_request_row_id: 'nope' }))).toBe(`/orders?open=${ORDER_A}&r=amount_review_invalid`);
    expect(await run(form({ decision: 'maybe' }))).toBe(`/orders?open=${ORDER_A}&r=amount_review_invalid`);
    expect(h.reviewOrderItemAmountViaRpc).not.toHaveBeenCalled();
  });

  it('RPC 拒(版本不符 / 終態 / 同價)⇒ refused;superseded ⇒ superseded;RPC denied ⇒ denied;丟錯 ⇒ error', async () => {
    h.reviewOrderItemAmountViaRpc.mockResolvedValue({ kind: 'rejected', message: '這張單在提案之後被改過' });
    expect(await run(form())).toBe(`/orders?open=${ORDER_A}&r=amount_review_refused`);
    h.reviewOrderItemAmountViaRpc.mockResolvedValue({ kind: 'ok', requestRowId: ROW, status: 'superseded', orderId: ORDER_A, result: 'superseded' });
    expect(await run(form())).toBe(`/orders?open=${ORDER_A}&r=amount_review_superseded`);
    h.reviewOrderItemAmountViaRpc.mockResolvedValue({ kind: 'denied' });
    expect(await run(form())).toBe(`/orders?open=${ORDER_A}&r=amount_review_denied`);
    h.reviewOrderItemAmountViaRpc.mockRejectedValue(new Error('boom'));
    expect(await run(form())).toBe(`/orders?open=${ORDER_A}&r=amount_review_error`);
  });

  // codex C 片 must-fix:return_to 的 open= 可被換成別張單 ⇒ 導頁綁 RPC 回的 order_id, 不信表單。
  it('🔴 A 單的申請 + return_to 指到 B 單 ⇒ 核了 A、導回 A(open= 被覆寫), 沒 open= 的 return_to 原樣', async () => {
    expect(await run(form({ return_to: `/orders?open=${ORDER_B}&status=open` }))).toBe(`/orders?open=${ORDER_A}&status=open&r=amount_review_approved`);
    expect(await run(form({ return_to: '/orders?status=open' }))).toBe('/orders?status=open&r=amount_review_approved');
  });

  it('🔴 RPC 回不認得的 status ⇒ error 碼(不當退回成功)', async () => {
    h.reviewOrderItemAmountViaRpc.mockResolvedValue({ kind: 'ok', requestRowId: ROW, status: 'weird', orderId: ORDER_A, result: 'ok' });
    expect(await run(form())).toBe(`/orders?open=${ORDER_A}&r=amount_review_error`);
  });

  // 🔴 20260915130000 第 2 代(跨片審查 confirmed high):核准撞「單子在提案後被改過」⇒ RPC 自動退回、回 result = stale_rejected。
  //    同是 status = rejected, 不能印「退回了, 員工看得到你的理由」—— 那不是管理者退的, 也沒有「你的理由」。
  it('🔴 核准撞單子被改過 ⇒ RPC 自動退回(stale_rejected)⇒ amount_review_stale, 不是 amount_review_rejected', async () => {
    h.reviewOrderItemAmountViaRpc.mockResolvedValue({ kind: 'ok', requestRowId: ROW, status: 'rejected', orderId: ORDER_A, result: 'stale_rejected' });
    expect(await run(form())).toBe(`/orders?open=${ORDER_A}&r=amount_review_stale`);
    expect(h.revalidatePath).toHaveBeenCalledWith('/orders');
  });

  it('🔴 正向對照:管理者自己按退回(result = ok)仍是 amount_review_rejected(證明上一格不是把 rejected 全吃掉)', async () => {
    h.reviewOrderItemAmountViaRpc.mockResolvedValue({ kind: 'ok', requestRowId: ROW, status: 'rejected', orderId: ORDER_A, result: 'ok' });
    expect(await run(form({ decision: 'reject', review_note: '不行' }))).toBe(`/orders?open=${ORDER_A}&r=amount_review_rejected`);
  });

  it('🔴 管理者看到的兩句話不再互指:stale 與 refused 都不叫「請員工重提」而申請還掛著', () => {
    expect(MESSAGES.amount_review_stale?.text).toContain('自動');
    expect(MESSAGES.amount_review_refused?.text).not.toContain('(請員工重提)');
    expect(MESSAGES.amount_review_refused?.text).toContain('退回');
  });

  it('🔴 八顆結果碼在 result-banner 都有字', () => {
    for (const c of ['amount_review_approved', 'amount_review_rejected', 'amount_review_superseded', 'amount_review_stale', 'amount_review_denied', 'amount_review_invalid', 'amount_review_refused', 'amount_review_error']) {
      expect(MESSAGES[c as keyof typeof MESSAGES]?.text, c).toBeTruthy();
    }
  });
});
