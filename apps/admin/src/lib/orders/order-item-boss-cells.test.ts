import { describe, expect, it, vi } from 'vitest';
import type { AdminOrderSummary } from '@pcm/domain';

// A1 → B2 接線:列表那份 orders → 六格顯示字串。repository 換替身(它打 DB), item-costs-view 用真的(純函式, B2 自己的測試守它)。
const repo = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('./item-costs-repository', () => ({ loadOrderItemCosts: repo.load }));

import { loadOrderItemCostCells } from './order-item-boss-cells';
import { previewItemCostText } from './item-costs-view';

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

// 🆕 2026-10-02 輸入中即時試算:畫面上打字時算的總計 / 利潤,必須跟【存檔後】這支 server 算的逐字相同。
//    做法 = 把輸入照 RPC 的樣子存成 numeric(4 位小數、匯率 = 該幣別現在生效那列)餵 loadOrderItemCostCells,
//    再跟 previewItemCostText 的結果比。兩邊各自算 ⇒ 公式一漂就紅。

describe('🔴 輸入中試算 = 存檔後列表顯示(同一條公式)', () => {
  const RATES = 'EUR:35.2,USD:31.123456,TWD:1';
  const rateOf = (code: string) => RATES.split(',').map((p) => p.split(':')).find(([c]) => c === code)![1]!;
  const asNumeric = (s: string, scale: number) => {
    const t = s.trim() === '' ? '0' : s.trim();
    const [i, f = ''] = t.split('.');
    return `${i}.${f.padEnd(scale, '0')}`;
  };
  const cases = [
    { name: '一般外幣 + 稅金 × 數量', v: { costPrice: '100', costShipping: '15.5', costTax: '3.25', currency: 'EUR' }, q: 2, total: 10000 },
    { name: '空格當 0、台幣', v: { costPrice: '', costShipping: '120', costTax: '', currency: 'TWD' }, q: 1, total: 500 },
    { name: '剛好 .5 往上進', v: { costPrice: '0.5', costShipping: '0', costTax: '0', currency: 'TWD' }, q: 1, total: 0 },
    { name: '四位小數 × 六位匯率、利潤為負', v: { costPrice: '12.3456', costShipping: '0.0001', costTax: '7', currency: 'USD' }, q: 3, total: 300 },
  ];
  for (const c of cases) {
    it(c.name, async () => {
      const id = 'l1';
      const stored = cost({
        costPrice: asNumeric(c.v.costPrice, 4),
        costShipping: asNumeric(c.v.costShipping, 4),
        costTax: asNumeric(c.v.costTax, 4),
        currency: c.v.currency,
        fxRate: c.v.currency === 'TWD' ? '1' : asNumeric(rateOf(c.v.currency), 6),
      });
      repo.load.mockResolvedValueOnce({ costs: new Map([[id, stored]]), readFailed: false });
      const server = (await loadOrderItemCostCells([{ id: 'o', lines: [line(id, c.q, c.total)] }] as unknown as AdminOrderSummary[])) as ReadonlyMap<string, { totalTwd: string; profitTwd: string }>;
      const preview = previewItemCostText(c.v, RATES, { quantity: c.q, lineTotal: c.total });
      expect(server.get(id)!.totalTwd).not.toBe('—');
      expect({ totalTwd: preview.totalTwd, profitTwd: preview.profitTwd }).toEqual({ totalTwd: server.get(id)!.totalTwd, profitTwd: server.get(id)!.profitTwd });
    });
  }
  it('該幣別還沒設匯率 / 金額打壞 ⇒ 印 —(不印 0)', () => {
    expect(previewItemCostText({ costPrice: '1', costShipping: '', costTax: '', currency: 'JPY' }, RATES, { quantity: 1, lineTotal: 100 })).toEqual({ totalTwd: '—', profitTwd: '—', fxRate: null });
    expect(previewItemCostText({ costPrice: '1.2.3', costShipping: '', costTax: '', currency: 'EUR' }, RATES, { quantity: 1, lineTotal: 100 }).totalTwd).toBe('—');
  });
});
