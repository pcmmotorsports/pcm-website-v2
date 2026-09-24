import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const authorize = vi.fn();
const save = vi.fn();
const revalidatePath = vi.fn();
vi.mock('../session/authorize', () => ({ authorizeManagerMutation: () => authorize(), authorizeAdminMutation: () => authorize() }));
vi.mock('../audit/context', () => ({ getRequestId: async () => 'req-1' }));
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock('../staff', () => ({ isActiveManager: async () => true }));
vi.mock('./brand-discount-repository', () => ({
  saveBrandDiscounts: (a: unknown) => save(a),
  loadCostedVariants: async () => ({ variants: [], unitCost: new Map() }),
}));

import { saveBrandDiscountsAction } from './brand-discount-actions';

const C = '55555555-5555-4555-8555-555555555555';
const B = '66666666-6666-4666-8666-666666666666';
const input = (over: Record<string, unknown> = {}) => ({
  customerId: C,
  changes: [{ brand_id: B, percent: 7.5, below_cost_reason: '' }],
  expected: { [B]: null },
  overCapConfirmed: false,
  ...over,
});

beforeEach(() => {
  authorize.mockReset();
  save.mockReset();
  revalidatePath.mockReset();
  authorize.mockResolvedValue({ actorId: 'boss', sid: 's1' });
  save.mockResolvedValue('SAVED');
});

describe('儲存經銷品牌折扣(片 E3)', () => {
  it('🔴 不是管理者(或未登入 / Origin 不對)⇒ denied, 不寫', async () => {
    authorize.mockResolvedValue(null);
    expect(await saveBrandDiscountsAction(input())).toEqual({ kind: 'denied' });
    expect(save).not.toHaveBeenCalled();
  });

  it('成功 ⇒ saved;actor 取登入身分, 原樣帶 changes 與 expected', async () => {
    expect(await saveBrandDiscountsAction(input())).toEqual({ kind: 'saved' });
    expect(save).toHaveBeenCalledWith({
      customerId: C,
      changes: [{ brand_id: B, percent: 7.5, below_cost_reason: '' }],
      expected: { [B]: null },
      actor: 'boss',
      requestId: 'req-1',
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/customers/${C}/brand-discounts`);
  });

  it('🔴 超過 20% 沒有勾確認 ⇒ need_cap_confirm, 不寫;勾了才寫', async () => {
    const over = { changes: [{ brand_id: B, percent: 25, below_cost_reason: '' }] };
    expect(await saveBrandDiscountsAction(input(over))).toEqual({ kind: 'need_cap_confirm' });
    expect(save).not.toHaveBeenCalled();
    expect(await saveBrandDiscountsAction(input({ ...over, overCapConfirmed: true }))).toEqual({ kind: 'saved' });
  });

  it.each([
    [{ customerId: 'x' }],
    [{ changes: [] }],
    [{ changes: [{ brand_id: 'x', percent: 5, below_cost_reason: '' }] }],
    [{ changes: [{ brand_id: B, percent: 7.55, below_cost_reason: '' }] }],
    [{ changes: [{ brand_id: B, percent: 100, below_cost_reason: '' }] }],
    [{ changes: [{ brand_id: B, below_cost_reason: '' }] }],
    [{ expected: {} }],
  ])('格式不對 ⇒ invalid, 不寫(%#)', async (over) => {
    expect((await saveBrandDiscountsAction(input(over))).kind).toBe('invalid');
    expect(save).not.toHaveBeenCalled();
  });

  it.each([
    ['NO_CHANGE', 'no_change'],
    ['STALE', 'stale'],
    ['NOT_FOUND', 'not_found'],
    ['NOT_DEALER', 'not_dealer'],
    ['WHAT', 'unknown'],
  ])('資料庫回 %s ⇒ %s', async (db, kind) => {
    save.mockResolvedValue(db);
    expect((await saveBrandDiscountsAction(input())).kind).toBe(kind);
  });

  it('🔴 呼叫失敗 ⇒ unknown(不說失敗)', async () => {
    save.mockRejectedValue(new Error('boom'));
    expect((await saveBrandDiscountsAction(input())).kind).toBe('unknown');
  });
});
