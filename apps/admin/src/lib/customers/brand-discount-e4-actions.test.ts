import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { staff, manager, repo } = vi.hoisted(() => ({
  staff: vi.fn(),
  manager: vi.fn(),
  repo: {
    saveBrandDiscounts: vi.fn(),
    loadPercents: vi.fn(),
    loadBrandPreview: vi.fn(),
    loadCostedVariants: vi.fn(),
  },
}));
vi.mock('../session/authorize', () => ({ authorizeAdminMutation: () => staff(), authorizeManagerMutation: () => manager() }));
vi.mock('../staff', () => ({ isActiveManager: async (id: string) => id === 'boss' }));
vi.mock('../audit/context', () => ({ getRequestId: async () => 'req-1' }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('./brand-discount-repository', () => repo);

import {
  checkBelowCostAction,
  loadCopyDiscountsAction,
  previewBrandAction,
  saveBrandDiscountsAction,
} from './brand-discount-actions';

const C = '55555555-5555-4555-8555-555555555555';
const S2 = '77777777-7777-4777-8777-777777777777';
const B = '66666666-6666-4666-8666-666666666666';
const costed = {
  variants: [{ variantId: 'v1', brandId: B, dealerPrice: 1000 }],
  unitCost: new Map([['v1', 900]]),
};

beforeEach(() => {
  for (const f of [staff, manager, ...Object.values(repo)]) f.mockReset();
  staff.mockResolvedValue({ actorId: 'ming', sid: 's' });
  manager.mockResolvedValue({ actorId: 'boss', sid: 's' });
  repo.saveBrandDiscounts.mockResolvedValue('SAVED');
  repo.loadCostedVariants.mockResolvedValue(costed);
  repo.loadBrandPreview.mockResolvedValue([
    { productId: 'p1', title: '排氣管', generalPrice: 1100, dealerPrice: 1000, basisVariantId: 'v1' },
  ]);
});

describe('複製設定(片 E4)', () => {
  it('員工都可以帶入(只是填進表格, 儲存仍限管理者);只回 %', async () => {
    repo.loadPercents.mockResolvedValue({ [B]: 7.5 });
    expect(await loadCopyDiscountsAction({ sourceCustomerId: S2 })).toEqual({ kind: 'ok', percents: { [B]: 7.5 } });
  });
  it('🔴 未登入 ⇒ denied;來源編號不對 ⇒ invalid', async () => {
    staff.mockResolvedValue(null);
    expect((await loadCopyDiscountsAction({ sourceCustomerId: S2 })).kind).toBe('denied');
    staff.mockResolvedValue({ actorId: 'ming', sid: 's' });
    expect((await loadCopyDiscountsAction({ sourceCustomerId: 'x' })).kind).toBe('invalid');
  });
});

describe('預覽(片 E4)', () => {
  it('🔴 非管理者 ⇒ 只有價格, 回應裡沒有任何成本欄位', async () => {
    const r = await previewBrandAction({ brandId: B });
    expect(r.kind).toBe('ok');
    expect(JSON.stringify(r)).not.toMatch(/unitCost|900/);
    expect(repo.loadCostedVariants).not.toHaveBeenCalled();
  });
  it('管理者 ⇒ 多帶最近一筆訂單的單件成本(沒有資料是 null)', async () => {
    staff.mockResolvedValue({ actorId: 'boss', sid: 's' });
    const r = await previewBrandAction({ brandId: B });
    expect(r.kind === 'ok' && r.items[0]).toMatchObject({ dealerPrice: 1000, unitCost: 900 });
  });
});

describe('低於成本檢查(片 E4)', () => {
  it('🔴 非管理者直接呼叫 ⇒ denied, 不讀成本', async () => {
    manager.mockResolvedValue(null);
    expect(await checkBelowCostAction({ percents: { [B]: 12 } })).toEqual({ kind: 'denied' });
    expect(repo.loadCostedVariants).not.toHaveBeenCalled();
  });
  it('折扣後 880 < 成本 900 ⇒ 列出品牌;讀不到成本 ⇒ failed(不能當成沒有低於成本)', async () => {
    expect(await checkBelowCostAction({ percents: { [B]: 12 } })).toEqual({ kind: 'ok', belowCost: [B] });
    expect(await checkBelowCostAction({ percents: { [B]: 10 } })).toEqual({ kind: 'ok', belowCost: [] });
    repo.loadCostedVariants.mockResolvedValue(null);
    expect((await checkBelowCostAction({ percents: { [B]: 12 } })).kind).toBe('failed');
  });
});

describe('🔴 儲存時 server 重算低於成本', () => {
  const save = (reason: string, percent = 12) =>
    saveBrandDiscountsAction({
      customerId: C,
      changes: [{ brand_id: B, percent, below_cost_reason: reason }],
      expected: { [B]: null },
      overCapConfirmed: false,
    });
  it('低於成本而沒填原因 ⇒ 不存, 回品牌', async () => {
    expect(await save('')).toEqual({ kind: 'below_cost_reason_required', brands: [B] });
    expect(repo.saveBrandDiscounts).not.toHaveBeenCalled();
  });
  it('填了原因 ⇒ 存;沒有低於成本 ⇒ 存', async () => {
    expect((await save('清庫存')).kind).toBe('saved');
    expect((await save('', 10)).kind).toBe('saved');
  });
  it('讀不到成本 ⇒ 不存(cost_check_failed)', async () => {
    repo.loadCostedVariants.mockResolvedValue(null);
    expect((await save('')).kind).toBe('cost_check_failed');
    expect(repo.saveBrandDiscounts).not.toHaveBeenCalled();
  });
});

describe('🔴 品牌編號只收小寫(Codex E4 R1)', () => {
  it('大寫品牌編號 ⇒ invalid, 不會繞過低於成本檢查', async () => {
    const UP = 'ABCDEF66-6666-4666-8666-666666666666';
    const r = await saveBrandDiscountsAction({
      customerId: C,
      changes: [{ brand_id: UP, percent: 12, below_cost_reason: '' }],
      expected: { [UP]: null },
      overCapConfirmed: false,
    });
    expect(r.kind).toBe('invalid');
    expect(repo.saveBrandDiscounts).not.toHaveBeenCalled();
    expect((await checkBelowCostAction({ percents: { [UP]: 12 } })).kind).toBe('invalid');
  });
});
