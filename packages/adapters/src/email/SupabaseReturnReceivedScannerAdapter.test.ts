// 退貨收回通知掃描 adapter 的測試(Sean 2026-09-27 A3)。
// 🔴 本檔用假 client 斷言查詢參數;「哪些退貨該寄」的差集住在 view(20260927080000), 由 migration 的後置閘與本機鑽機驗。
import { describe, it, expect, vi } from 'vitest';

// adapter 檔頭 `import 'server-only'`(只准伺服器端載入);測試環境不是 React Server 環境 ⇒ 換成空模組。
vi.mock('server-only', () => ({}));

import {
  SupabaseReturnReceivedScannerAdapter,
  ReturnReceivedScanQueryError,
  RETURN_RECEIVED_PENDING_VIEW,
  type ReturnReceivedScannerClient,
} from './SupabaseReturnReceivedScannerAdapter';

const RAW = {
  order_id: 'order-1',
  return_id: 'ret-1',
  display_id: 'PCM-2026-0001',
  received_at: '2026-09-27T10:00:00.000Z',
  received_items: [
    { title: '煞車拉桿組', quantity: 1 },
    { title: '', quantity: 2 },
    { title: '壞的', quantity: 0 },
    'not-an-object',
  ],
  received_count: 2,
  notification_email: 'member@example.com',
  customer_email: 'frozen@example.com',
  order_source: 'web',
};

function client(data: unknown[] | null, error: { code?: string } | null = null) {
  const calls: Array<[string, unknown[]]> = [];
  const chain = {
    gte(...a: unknown[]) {
      calls.push(['gte', a]);
      return chain;
    },
    order(...a: unknown[]) {
      calls.push(['order', a]);
      return chain;
    },
    limit: vi.fn(async (n: number) => {
      calls.push(['limit', [n]]);
      return { data, error } as never;
    }),
  };
  const select = vi.fn(() => chain);
  const from = vi.fn(() => ({ select }));
  return { c: { from } as unknown as ReturnReceivedScannerClient, from, select, calls };
}

describe('SupabaseReturnReceivedScannerAdapter', () => {
  it('🔴 打那個 view、九個欄位都要、只掃 cutoff 之後收回的、用 return_id 排序、limit+1 探截斷', async () => {
    const { c, from, select, calls } = client([RAW]);
    const res = await new SupabaseReturnReceivedScannerAdapter(c).listReturnReceivedWithoutEmail({
      cutoff: '2026-09-27T00:00:00.000Z',
      limit: 25,
    });
    expect(from).toHaveBeenCalledWith(RETURN_RECEIVED_PENDING_VIEW);
    expect(RETURN_RECEIVED_PENDING_VIEW).toBe('pcm_return_received_email_pending');
    const cols = (select.mock.calls[0] as unknown as [string])[0].split(',').map((s) => s.trim());
    expect(cols).toEqual([
      'order_id',
      'return_id',
      'display_id',
      'received_at',
      'received_items',
      'notification_email',
      'customer_email',
      'order_source',
    ]);
    expect(calls).toEqual([
      ['gte', ['received_at', '2026-09-27T00:00:00.000Z']],
      ['order', ['return_id', { ascending: true }]],
      ['limit', [26]],
    ]);
    expect(res.truncated).toBe(false);
    expect(res.rows).toEqual([
      {
        orderId: 'order-1',
        returnId: 'ret-1',
        displayId: 'PCM-2026-0001',
        receivedAt: '2026-09-27T10:00:00.000Z',
        // 形狀不對的元素丟掉;空白品名轉 null
        receivedItems: [
          { title: '煞車拉桿組', quantity: 1 },
          { title: null, quantity: 2 },
        ],
        notificationEmail: 'member@example.com',
        customerEmail: 'frozen@example.com',
        orderSource: 'web',
      },
    ]);
  });

  it('多出來的那一列 ⇒ truncated = true, 只回 limit 列', async () => {
    const { c } = client([RAW, { ...RAW, return_id: 'ret-2' }, { ...RAW, return_id: 'ret-3' }]);
    const res = await new SupabaseReturnReceivedScannerAdapter(c).listReturnReceivedWithoutEmail({
      cutoff: '2026-09-27T00:00:00.000Z',
      limit: 2,
    });
    expect(res.truncated).toBe(true);
    expect(res.rows.map((r) => r.returnId)).toEqual(['ret-1', 'ret-2']);
  });

  it('🔴 DB 錯誤 / limit 不合法 ⇒ throw(不回空陣列假裝沒有要寄的)', async () => {
    const { c } = client(null, { code: '42P01' });
    await expect(
      new SupabaseReturnReceivedScannerAdapter(c).listReturnReceivedWithoutEmail({ cutoff: 'x', limit: 5 }),
    ).rejects.toBeInstanceOf(ReturnReceivedScanQueryError);
    const ok = client([]);
    await expect(
      new SupabaseReturnReceivedScannerAdapter(ok.c).listReturnReceivedWithoutEmail({ cutoff: 'x', limit: 0 }),
    ).rejects.toBeInstanceOf(ReturnReceivedScanQueryError);
  });
});
