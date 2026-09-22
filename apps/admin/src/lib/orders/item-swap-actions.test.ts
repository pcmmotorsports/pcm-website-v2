import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const h = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  revalidatePath: vi.fn(),
  authorizeAdminMutation: vi.fn(),
  getRequestId: vi.fn(async () => 'req-1'),
  swapOrderItemViaRpc: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: h.redirect }));
vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }));
vi.mock('../session/authorize', () => ({ authorizeAdminMutation: h.authorizeAdminMutation }));
vi.mock('../audit/context', () => ({ getRequestId: h.getRequestId }));
vi.mock('./item-swap-repository', () => ({ swapOrderItemViaRpc: h.swapOrderItemViaRpc }));

import { MESSAGES } from '../../components/orders/result-banner';
import { swapOrderItemAction } from './item-swap-actions';
import { ITEM_SWAP_REJECT_REASONS, itemSwapRejectResultCode } from './item-swap-state';

const O = '0f9a3c2e-1b4d-4e6f-8a9b-0c1d2e3f4a5b';
const I = '1f9a3c2e-1b4d-4e6f-8a9b-0c1d2e3f4a5b';
const V = '3f9a3c2e-1b4d-4e6f-8a9b-0c1d2e3f4a5b';
const R = '2f9a3c2e-1b4d-4e6f-8a9b-0c1d2e3f4a5b';

function form(over: Record<string, string | null> = {}) {
  const f = new FormData();
  const base: Record<string, string> = {
    order_id: O, order_item_id: I, version: '3', new_variant_id: V, swap_request_id: R,
    return_to: `/orders?open=${O}`,
  };
  for (const [k, v] of Object.entries({ ...base, ...over })) if (v !== null) f.set(k, v);
  return f;
}

async function run(fd: FormData): Promise<string> {
  try {
    await swapOrderItemAction(fd);
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
  h.swapOrderItemViaRpc.mockResolvedValue({ kind: 'swapped', newItemId: 'new-1' });
});

describe('swapOrderItemAction', () => {
  it('換成功 ⇒ 帶表單的參數呼叫函式、revalidate、導回原頁 r=item_swapped', async () => {
    const url = await run(form());
    expect(h.swapOrderItemViaRpc).toHaveBeenCalledWith({
      orderId: O, itemId: I, expectedVersion: 3, newVariantId: V, actorId: 'staff_1', requestId: R,
    });
    expect(h.revalidatePath).toHaveBeenCalledWith('/orders');
    expect(url).toContain('r=item_swapped');
    expect(url).toContain(`open=${O}`);
  });

  it('重送回原結果(idempotent)⇒ 一樣顯示已更換', async () => {
    h.swapOrderItemViaRpc.mockResolvedValue({ kind: 'idempotent', newItemId: 'new-1' });
    expect(await run(form())).toContain('r=item_swapped');
  });

  it('沒登入 / 不是員工 ⇒ item_swap_denied, 不呼叫函式', async () => {
    h.authorizeAdminMutation.mockResolvedValue(null);
    expect(await run(form())).toContain('r=item_swap_denied');
    expect(h.swapOrderItemViaRpc).not.toHaveBeenCalled();
  });

  it('表單缺欄或格式錯 ⇒ item_swap_invalid, 不呼叫函式', async () => {
    const bads: Record<string, string | null>[] = [{ new_variant_id: 'x' }, { swap_request_id: null }, { version: '0' }, { order_item_id: 'y' }];
    for (const bad of bads) {
      expect(await run(form(bad))).toContain('r=item_swap_invalid');
    }
    expect(h.swapOrderItemViaRpc).not.toHaveBeenCalled();
  });

  it('conflict / noop / denied 各自對應', async () => {
    h.swapOrderItemViaRpc.mockResolvedValue({ kind: 'conflict' });
    expect(await run(form())).toContain('r=item_swap_conflict');
    h.swapOrderItemViaRpc.mockResolvedValue({ kind: 'noop' });
    expect(await run(form())).toContain('r=item_swap_noop');
    h.swapOrderItemViaRpc.mockResolvedValue({ kind: 'denied' });
    expect(await run(form())).toContain('r=item_swap_denied');
  });

  it.each(ITEM_SWAP_REJECT_REASONS)('拒絕代碼 %s ⇒ 自己的結果碼, 而且提示條有對應文字', async (reason) => {
    h.swapOrderItemViaRpc.mockResolvedValue({ kind: 'rejected', reason });
    const url = await run(form());
    const code = itemSwapRejectResultCode(reason);
    expect(url).toContain(`r=${code}`);
    expect(MESSAGES[code]?.text).toBeTruthy();
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it('返回網址展開的是別張訂單或 open 重複 ⇒ 退回這張訂單的詳細頁', async () => {
    const B = '9f9a3c2e-1b4d-4e6f-8a9b-0c1d2e3f4a5b';
    let url = await run(form({ return_to: `/orders?open=${B}` }));
    expect(url).toContain(`/orders/${O}`);
    expect(url).not.toContain(B);
    url = await run(form({ return_to: `/orders?open=${O}&open=${B}` }));
    expect(url).toContain(`/orders/${O}`);
    expect(url).not.toContain(B);
    // 正對照:同一張單 ⇒ 保留原本的返回網址
    expect(await run(form())).toContain(`open=${O}`);
  });

  it('函式丟錯 ⇒ item_swap_error(結果不明), log 不含錯誤訊息全文', async () => {
    h.swapOrderItemViaRpc.mockRejectedValue(Object.assign(new Error('secret detail'), { code: 'XX000' }));
    expect(await run(form())).toContain('r=item_swap_error');
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls);
    expect(logged).not.toContain('secret detail');
    expect(logged).toContain('XX000');
  });

  it('成功、不明與每一種拒絕的提示文字都在提示條裡', () => {
    for (const code of ['item_swapped', 'item_swap_noop', 'item_swap_conflict', 'item_swap_denied', 'item_swap_invalid', 'item_swap_error']) {
      expect(MESSAGES[code]?.text, code).toBeTruthy();
    }
    // 結果不明時不能叫員工直接重送(文案標準:結果不明先確認)
    expect(MESSAGES.item_swap_error?.text).toContain('重新整理');
  });
});
