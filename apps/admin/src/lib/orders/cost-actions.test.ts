import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const h = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  revalidatePath: vi.fn(),
  authorizeManagerMutation: vi.fn(),
  getRequestId: vi.fn(async () => 'req-1'),
  setOrderItemCostsViaRpc: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: h.redirect }));
vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }));
vi.mock('../session/authorize', () => ({ authorizeManagerMutation: h.authorizeManagerMutation }));
vi.mock('../audit/context', () => ({ getRequestId: h.getRequestId }));
vi.mock('./cost-repository', () => ({ setOrderItemCostsViaRpc: h.setOrderItemCostsViaRpc }));

import { MESSAGES } from '../../components/orders/result-banner';
import { setOrderItemCostsAction } from './cost-actions';
import { COST_ROWS_FIELD, type CostResultCode } from './cost-view';

// cost-actions.test.ts — 「老闆:成本」寫入 action。
// 🔴 最承重的一格:沒權限 ⇒ **RPC 一次都沒被呼叫**(不是只有錯誤訊息)。

const UUID = '0f9a3c2e-1b4d-4e6f-8a9b-0c1d2e3f4a5b';
const GOOD_ROWS = JSON.stringify([{ orderItemId: UUID, costPrice: '10', costShipping: '0', costTax: '1.5', currency: 'EUR' }]);

function form(rows: string | null = GOOD_ROWS, returnTo = '/orders?status=open') {
  const f = new FormData();
  if (rows !== null) f.set(COST_ROWS_FIELD, rows);
  f.set('return_to', returnTo);
  return f;
}

async function run(fd: FormData): Promise<string> {
  try {
    await setOrderItemCostsAction(fd);
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
  h.authorizeManagerMutation.mockResolvedValue({ sid: 's', actorId: 'alice' });
  h.setOrderItemCostsViaRpc.mockResolvedValue({ kind: 'ok', written: 1 });
});

describe('setOrderItemCostsAction', () => {
  it('成功:RPC 收到解析後的列 + actor + request_id,revalidate /orders,回列表帶 ?r=cost_saved', async () => {
    expect(await run(form())).toBe('/orders?status=open&r=cost_saved');
    expect(h.setOrderItemCostsViaRpc).toHaveBeenCalledWith(
      'alice',
      [{ orderItemId: UUID, costPrice: '10', costShipping: '0', costTax: '1.5', currency: 'EUR' }],
      'req-1',
    );
    expect(h.revalidatePath).toHaveBeenCalledWith('/orders');
  });

  it('沒權限 ⇒ cost_denied 且 RPC 一次都沒被呼叫', async () => {
    h.authorizeManagerMutation.mockResolvedValue(null);
    expect(await run(form())).toBe('/orders?status=open&r=cost_denied');
    expect(h.setOrderItemCostsViaRpc).not.toHaveBeenCalled();
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it('欄位壞 ⇒ cost_invalid,不打 RPC', async () => {
    expect(await run(form(null))).toBe('/orders?status=open&r=cost_invalid');
    expect(await run(form('[{"orderItemId":"x"}]'))).toBe('/orders?status=open&r=cost_invalid');
    expect(h.setOrderItemCostsViaRpc).not.toHaveBeenCalled();
  });

  it('RPC 結果對應:denied / 沒匯率 / 其他拒絕 / 丟出來的錯', async () => {
    h.setOrderItemCostsViaRpc.mockResolvedValue({ kind: 'denied' });
    expect(await run(form())).toBe('/orders?status=open&r=cost_denied');
    h.setOrderItemCostsViaRpc.mockResolvedValue({ kind: 'rejected', message: 'EUR 還沒設過匯率,先到 設定 › 匯率 填' });
    expect(await run(form())).toBe('/orders?status=open&r=cost_no_fx');
    h.setOrderItemCostsViaRpc.mockResolvedValue({ kind: 'rejected', message: '品項不存在' });
    expect(await run(form())).toBe('/orders?status=open&r=cost_rejected');
    h.setOrderItemCostsViaRpc.mockRejectedValue(Object.assign(new Error('boom'), { code: '42P01' }));
    expect(await run(form())).toBe('/orders?status=open&r=cost_error');
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it('return_to 不在白名單 ⇒ 退回 /orders(不是 /orders/)', async () => {
    expect(await run(form(GOOD_ROWS, 'https://evil.example/x'))).toBe('/orders?r=cost_saved');
    expect(await run(form(GOOD_ROWS, '/customers'))).toBe('/orders?r=cost_saved');
  });

  it('六種 code 在 result-banner 都有字(否則 ?r= 到了畫面什麼都不顯示)', () => {
    const codes: CostResultCode[] = ['cost_saved', 'cost_denied', 'cost_invalid', 'cost_no_fx', 'cost_rejected', 'cost_error'];
    for (const c of codes) expect(MESSAGES[c]?.text, c).toBeTruthy();
  });
});
