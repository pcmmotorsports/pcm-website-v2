import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const h = vi.hoisted(() => ({
  in: vi.fn(),
  rpc: vi.fn(),
  select: vi.fn(),
}));

vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => ({
      select: (cols: string) => {
        h.select(table, cols);
        return { in: h.in };
      },
    }),
    rpc: h.rpc,
  }),
}));

import { loadOrderItemCosts, setOrderItemCostsViaRpc } from './cost-repository';

// cost-repository.test.ts — 第二發讀(`::text`、分批)與 RPC 結果對應。
// 🔴 金額一定 `::text` 取回:PostgREST 把 numeric 當 JSON number 吐,4 位小數會走樣 ⇒ select 字串是承重的。

const ROW = {
  order_item_id: 'a',
  cost_price: '10.0000',
  cost_shipping: '0.0000',
  cost_tax: '1.5000',
  currency: 'EUR',
  fx_rate: '35.123456',
  fx_rate_id: 7,
  updated_by: 'alice',
  updated_at: '2026-09-14T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  h.in.mockResolvedValue({ data: [ROW], error: null });
});

describe('loadOrderItemCosts', () => {
  it('select 用 ::text 取金額與匯率;去重;回 Map', async () => {
    const { costs: m, readFailed } = await loadOrderItemCosts(['a', 'a']);
    expect(readFailed).toBe(false);
    expect(h.select).toHaveBeenCalledWith('order_item_costs', expect.any(String));
    const cols = h.select.mock.calls[0]![1] as string;
    for (const c of ['cost_price', 'cost_shipping', 'cost_tax', 'fx_rate']) {
      expect(cols, c).toContain(`${c}::text`);
      expect(cols, c).not.toMatch(new RegExp(`${c}(?![:_])`)); // 沒有裸欄位(`fx_rate_id` 是另一欄,放行)
    }
    expect(h.in).toHaveBeenCalledTimes(1);
    expect(h.in).toHaveBeenCalledWith('order_item_id', ['a']);
    expect(m.get('a')).toEqual({
      orderItemId: 'a',
      costPrice: '10.0000',
      costShipping: '0.0000',
      costTax: '1.5000',
      currency: 'EUR',
      fxRate: '35.123456',
      fxRateId: 7,
      updatedBy: 'alice',
      updatedAt: '2026-09-14T00:00:00Z',
    });
  });

  it('空清單不打 DB', async () => {
    expect(await loadOrderItemCosts([])).toEqual({ costs: new Map(), readFailed: false });
    expect(h.in).not.toHaveBeenCalled();
  });

  it('超過 200 個 id 分批', async () => {
    const ids = Array.from({ length: 401 }, (_, i) => `id-${i}`);
    await loadOrderItemCosts(ids);
    expect(h.in).toHaveBeenCalledTimes(3);
    expect(h.in.mock.calls[2]![1]).toEqual(['id-400']);
  });

  it('金額不是字串(沒 ::text 的世界)⇒ 那列丟掉,不當數字用', async () => {
    h.in.mockResolvedValue({ data: [{ ...ROW, cost_price: 10 }], error: null });
    expect((await loadOrderItemCosts(['a'])).costs.size).toBe(0);
  });

  it('讀失敗(例:表還沒貼 42P01)⇒ readFailed:true + console.error,不丟出去;不是「沒填」', async () => {
    h.in.mockResolvedValue({ data: null, error: { code: '42P01', message: 'relation does not exist' } });
    expect(await loadOrderItemCosts(['a'])).toEqual({ costs: new Map(), readFailed: true });
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('第二批失敗 ⇒ readFailed:true,第一批讀到的還在(畫面標讀取失敗,不會把它們當空格)', async () => {
    h.in
      .mockResolvedValueOnce({ data: [ROW], error: null })
      .mockResolvedValueOnce({ data: null, error: { code: '57014', message: 'statement timeout' } });
    const r = await loadOrderItemCosts(Array.from({ length: 201 }, (_, i) => `id-${i}`));
    expect(r.readFailed).toBe(true);
    expect(r.costs.get('a')?.costPrice).toBe('10.0000');
  });
});

describe('setOrderItemCostsViaRpc', () => {
  const rows = [{ orderItemId: 'a', costPrice: '10', costShipping: '0', costTax: '1.5', currency: 'EUR' }];

  it('送 RPC 的欄位名與參數;金額字串原樣;回 written', async () => {
    h.rpc.mockResolvedValue({ data: { result: 'ok', written: 1 }, error: null });
    expect(await setOrderItemCostsViaRpc('alice', rows, 'req-1')).toEqual({ kind: 'ok', written: 1 });
    expect(h.rpc).toHaveBeenCalledWith('admin_set_order_item_costs', {
      p_actor: 'alice',
      p_rows: [{ order_item_id: 'a', cost_price: '10', cost_shipping: '0', cost_tax: '1.5', currency: 'EUR' }],
      p_request_id: 'req-1',
    });
  });

  it('沒 error 但形狀不對(data null / written 對不上)⇒ throw,不印「存好了」', async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    await expect(setOrderItemCostsViaRpc('alice', rows, 'r')).rejects.toMatchObject({ code: 'COST_RPC_SHAPE' });
    h.rpc.mockResolvedValue({ data: { result: 'ok', written: 2 }, error: null });
    await expect(setOrderItemCostsViaRpc('alice', rows, 'r')).rejects.toMatchObject({ code: 'COST_RPC_SHAPE' });
  });

  it('P0001 無權 ⇒ denied;P0001 其他人話 ⇒ rejected 帶原句;其餘 throw', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: '無權執行此操作' } });
    expect(await setOrderItemCostsViaRpc('bob', rows, 'r')).toEqual({ kind: 'denied' });
    h.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'EUR 還沒設過匯率,先到 設定 › 匯率 填' } });
    expect(await setOrderItemCostsViaRpc('alice', rows, 'r')).toEqual({ kind: 'rejected', message: 'EUR 還沒設過匯率,先到 設定 › 匯率 填' });
    h.rpc.mockResolvedValue({ data: null, error: { code: '42883', message: 'function does not exist' } });
    await expect(setOrderItemCostsViaRpc('alice', rows, 'r')).rejects.toMatchObject({ code: '42883' });
  });
});
