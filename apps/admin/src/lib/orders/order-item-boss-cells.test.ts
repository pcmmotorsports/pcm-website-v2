import { describe, expect, it, vi } from 'vitest';
import type { AdminOrderSummary } from '@pcm/domain';

// A1 → B2 接線:列表那份 orders → 六格顯示字串。repository 換替身(它打 DB), cost-view 用真的(純函式, B2 自己的測試守它)。
const repo = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('./cost-repository', () => ({ loadOrderItemCosts: repo.load }));

import { loadOrderItemCostCells } from './order-item-boss-cells';

const line = (id: string, quantity: number, lineTotal: number) =>
  ({ id, quantity, lineTotal: { amount: lineTotal, currency: 'TWD' } }) as unknown as AdminOrderSummary['lines'][number];
const orders = [
  { id: 'o1', lines: [line('l1', 2, 10000), line('l2', 1, 500)] },
  { id: 'o2', lines: [line('l3', 1, 800)] },
] as unknown as AdminOrderSummary[];
const cost = (over: Record<string, string>) => ({
  orderItemId: 'x',
  costPrice: '100.0000',
  costShipping: '15.5000',
  costTax: '3.2500',
  currency: 'EUR',
  fxRate: '35.200000',
  fxRateId: 1,
  updatedBy: 'boss',
  updatedAt: '2026-09-14T00:00:00Z',
  ...over,
});

describe('loadOrderItemCostCells', () => {
  it('🔴 第二發吃的是這一頁【全部品項】的 id(跨單、去重由 repository 做), 讀失敗 ⇒ 整批 unreadable', async () => {
    repo.load.mockResolvedValueOnce({ costs: new Map([['l1', cost({})]]), readFailed: true });
    expect(await loadOrderItemCostCells(orders)).toBe('unreadable');
    expect(repo.load).toHaveBeenLastCalledWith(['l1', 'l2', 'l3']);
  });

  it('🔴 有填的品項算 TWD(只 round 一次)+ 尾 0 去掉 + 千分位;沒填的品項不在 Map 裡(表格印 —)', async () => {
    repo.load.mockResolvedValueOnce({ costs: new Map([['l1', cost({})]]), readFailed: false });
    const cells = await loadOrderItemCostCells(orders);
    expect(cells).not.toBe('unreadable');
    const m = cells as ReadonlyMap<string, unknown>;
    expect([...m.keys()]).toEqual(['l1']);
    // (100 + 15.5 + 3.25×2) × 35.2 = 122 × 35.2 = 4294.4 ⇒ 4,294;利潤 10000 − 4294 = 5,706
    expect(m.get('l1')).toEqual({
      costPrice: '100',
      costShipping: '15.5',
      costTax: '3.25',
      currency: 'EUR',
      fxRate: '35.2',
      totalTwd: '4,294',
      profitTwd: '5,706',
    });
  });

  it('利潤可以是負的(成本大於售價要看得到, 不是藏起來)', async () => {
    repo.load.mockResolvedValueOnce({ costs: new Map([['l2', cost({ costPrice: '20.0000', costShipping: '0', costTax: '0' })]]), readFailed: false });
    const m = (await loadOrderItemCostCells(orders)) as ReadonlyMap<string, { totalTwd: string; profitTwd: string }>;
    expect(m.get('l2')).toMatchObject({ totalTwd: '704', profitTwd: '-204' });
  });

  it('算不出來(匯率不合法)⇒ 總計 / 利潤印 —, 三欄外幣照印', async () => {
    repo.load.mockResolvedValueOnce({ costs: new Map([['l3', cost({ fxRate: 'abc' })]]), readFailed: false });
    const m = (await loadOrderItemCostCells(orders)) as ReadonlyMap<string, { totalTwd: string; profitTwd: string; costPrice: string }>;
    expect(m.get('l3')).toMatchObject({ costPrice: '100', totalTwd: '—', profitTwd: '—' });
  });
});
