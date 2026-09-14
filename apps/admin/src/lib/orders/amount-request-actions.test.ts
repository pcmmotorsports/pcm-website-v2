import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const h = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  revalidatePath: vi.fn(),
  authorizeAdminMutation: vi.fn(),
  getRequestId: vi.fn(async () => 'req-1'),
  requestOrderItemAmountViaRpc: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: h.redirect }));
vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }));
vi.mock('../session/authorize', () => ({ authorizeAdminMutation: h.authorizeAdminMutation }));
vi.mock('../audit/context', () => ({ getRequestId: h.getRequestId }));
vi.mock('./amount-request-repository', () => ({ requestOrderItemAmountViaRpc: h.requestOrderItemAmountViaRpc }));

import { MESSAGES } from '../../components/orders/result-banner';
import { requestOrderItemAmountAction } from './amount-request-actions';

// M-4b-03 B:員工提申請 action。閘 = 一般員工閘(提案不碰錢);五顆結果碼都要在 result-banner 有字。
const O = '0f9a3c2e-1b4d-4e6f-8a9b-0c1d2e3f4a5b';
const I = '1f9a3c2e-1b4d-4e6f-8a9b-0c1d2e3f4a5b';
const R = '2f9a3c2e-1b4d-4e6f-8a9b-0c1d2e3f4a5b';

function form(over: Record<string, string | null> = {}) {
  const f = new FormData();
  const base: Record<string, string> = {
    order_id: O, order_item_id: I, version: '3', unit_price: '5000', return_to: `/orders?open=${O}`,
    request_reason: '老客', amount_request_id: R,
  };
  for (const [k, v] of Object.entries({ ...base, ...over })) if (v !== null) f.set(k, v);
  return f;
}

async function run(fd: FormData): Promise<string> {
  try {
    await requestOrderItemAmountAction(fd);
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
  h.authorizeAdminMutation.mockResolvedValue({ sid: 's', actorId: 'staff_1' });
  h.requestOrderItemAmountViaRpc.mockResolvedValue({ kind: 'ok', requestRowId: 'row-1', status: 'pending', orderId: O });
});

describe('requestOrderItemAmountAction', () => {
  it('成功:RPC 收到解析後的值(actor 來自閘、request_id 來自表單 hidden), 回 return_to 帶 ?r=amount_request_sent', async () => {
    expect(await run(form())).toBe(`/orders?open=${O}&r=amount_request_sent`);
    expect(h.requestOrderItemAmountViaRpc).toHaveBeenCalledWith({
      orderId: O, orderItemId: I, expectedVersion: 3, toUnitPrice: 5000, zeroPriceReason: null, reason: '老客', actorId: 'staff_1', requestId: R,
    });
    expect(h.revalidatePath).toHaveBeenCalledWith('/orders');
  });

  it('🔴 沒票 ⇒ amount_request_denied, RPC 零呼叫', async () => {
    h.authorizeAdminMutation.mockResolvedValue(null);
    expect(await run(form())).toBe('/orders?r=amount_request_denied');
    expect(h.requestOrderItemAmountViaRpc).not.toHaveBeenCalled();
  });

  it('🔴 表單壞(原因空)⇒ amount_request_invalid 導回明細頁, RPC 零呼叫', async () => {
    expect(await run(form({ request_reason: '  ' }))).toBe(`/orders/${O}?r=amount_request_invalid`);
    expect(h.requestOrderItemAmountViaRpc).not.toHaveBeenCalled();
  });

  it('RPC 拒(已有待審 / 版本不符 / 同價)⇒ amount_request_rejected;RPC 丟錯 ⇒ amount_request_error;RPC denied ⇒ denied', async () => {
    h.requestOrderItemAmountViaRpc.mockResolvedValue({ kind: 'rejected', message: '這一項已經有一條待審的申請' });
    expect(await run(form())).toBe(`/orders?open=${O}&r=amount_request_rejected`);
    h.requestOrderItemAmountViaRpc.mockRejectedValue(new Error('boom'));
    expect(await run(form())).toBe(`/orders?open=${O}&r=amount_request_error`);
    h.requestOrderItemAmountViaRpc.mockResolvedValue({ kind: 'denied' });
    expect(await run(form())).toBe(`/orders?open=${O}&r=amount_request_denied`);
  });

  it('🔴 五顆結果碼在 result-banner 都有字', () => {
    for (const c of ['amount_request_sent', 'amount_request_denied', 'amount_request_invalid', 'amount_request_rejected', 'amount_request_error']) {
      expect(MESSAGES[c as keyof typeof MESSAGES]?.text, c).toBeTruthy();
    }
  });
});
