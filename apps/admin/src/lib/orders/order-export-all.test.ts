import { describe, expect, it } from 'vitest';
import {
  taipeiDayEndExclusiveIso,
  taipeiDayStartIso,
  toMoneyAmount,
  type AdminOrderFilter,
  type AdminOrderLine,
  type AdminOrderListResult,
  type AdminOrderSummary,
} from '@pcm/domain';
import { CSV_BOM } from './order-export';
import {
  ORDER_EXPORT_ALL_BATCH,
  ORDER_EXPORT_ALL_CAP,
  buildOrderAllCsv,
  collectOrdersForExport,
  orderAllExportFilename,
  orderExportAllHref,
  orderExportFilterNote,
  taipeiDataAsOf,
} from './order-export-all';

// order-export-all.test.ts — 訂單匯出第一片:一次匯出【全部篩選結果】(M-4a-24, Sean 2026-09-27 F1 甲)。
// 守的是「整份」:少讀一批、讀到一半資料位移、超過上限被偷偷截斷, 三種都要**擋下並講出來**, 不能交出半份檔。

function line(over: Partial<AdminOrderLine> = {}): AdminOrderLine {
  return {
    id: 'l-1',
    variantSku: 'SKU-001',
    title: '排氣管',
    brand: 'Akrapovic',
    quantity: 1,
    unitPrice: { amount: toMoneyAmount(12000), currency: 'TWD' },
    lineTotal: { amount: toMoneyAmount(12000), currency: 'TWD' },
    workflowStatus: null,
    version: 1,
    vehicle: null,
    quantitySummary: {
      quantity: 1,
      orderedQuantity: 0,
      instockQuantity: 0,
      shippedQuantity: 0,
      cancelledQuantity: 0,
      cancellableQuantity: 1,
    },
    ...over,
  };
}

/** 欄位照 `order-export-page.test.ts` 的基準 fixture, 只換 id / 單號。 */
function order(i: number): AdminOrderSummary {
  return {
    id: `ord-${i}`,
    itemsTruncated: false,
    displayId: `PCM-${String(i).padStart(4, '0')}`,
    createdAt: '2026-08-13T02:00:00.000Z',
    paymentStatus: 'paid',
    fulfillmentStatus: 'notOrdered',
    orderSource: 'web',
    paymentChannel: 'tappay',
    total: { amount: toMoneyAmount(12000), currency: 'TWD' },
    taxTotal: { amount: toMoneyAmount(0), currency: 'TWD' },
    customerUserId: 'cu-1',
    customerName: '王小明',
    shippingAddress: { name: '收件人', phone: '0912345678', line: '台北市信義區 1 號' },
    tierAtCheckout: 'general',
    invoiceStatus: 'not_issued',
    invoiceRequested: true,
    balanceDue: 0,
    cancelledAt: null,
    displayPosition: null,
    lines: [line({ id: `l-${i}` })],
  };
}

/** 假的 repo:照 offset / limit 切一份固定的訂單清單, 記下每一發。 */
function fakeList(all: AdminOrderSummary[], over: Partial<AdminOrderListResult> = {}) {
  const calls: { offset: number; limit: number }[] = [];
  const list = async (_f: AdminOrderFilter, p: { limit: number; offset?: number }) => {
    const offset = p.offset ?? 0;
    calls.push({ offset, limit: p.limit });
    return {
      items: all.slice(offset, offset + p.limit),
      total: all.length,
      keywordTruncated: false,
      keywordMatchCount: null,
      supplierOrderNoMatchedSuppliers: null,
      ...over,
    } as unknown as AdminOrderListResult;
  };
  return { list, calls };
}

const orders = (n: number) => Array.from({ length: n }, (_, i) => order(i + 1));

describe('collectOrdersForExport —— 讀【全部】, 少一張都不交', () => {
  it('跨好幾批讀完, 筆數等於總數, 順序照來源', async () => {
    const n = ORDER_EXPORT_ALL_BATCH * 2 + 7;
    const { list, calls } = fakeList(orders(n));
    const r = await collectOrdersForExport(list, {});
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.orders).toHaveLength(n);
    expect(r.orders.map((o) => o.id)).toEqual(orders(n).map((o) => o.id));
    expect(calls.map((c) => c.offset)).toEqual([0, ORDER_EXPORT_ALL_BATCH, ORDER_EXPORT_ALL_BATCH * 2]);
    expect(calls.every((c) => c.limit === ORDER_EXPORT_ALL_BATCH)).toBe(true);
  });

  it('零筆也是合法的一份(只有表頭)', async () => {
    const r = await collectOrdersForExport(fakeList([]).list, {});
    expect(r).toEqual({ kind: 'ok', orders: [], total: 0 });
  });

  it('超過上限 ⇒ 擋下並講總數, 而且不再往下讀(不偷偷截斷)', async () => {
    const { list, calls } = fakeList(orders(ORDER_EXPORT_ALL_CAP + 1));
    const r = await collectOrdersForExport(list, {});
    expect(r).toEqual({ kind: 'too_many', total: ORDER_EXPORT_ALL_CAP + 1 });
    expect(calls).toHaveLength(1);
  });

  it('剛好等於上限 ⇒ 放行', async () => {
    const r = await collectOrdersForExport(fakeList(orders(ORDER_EXPORT_ALL_CAP)).list, {});
    expect(r.kind).toBe('ok');
  });

  it('關鍵字搜尋被截斷(只回前 100)⇒ 擋下', async () => {
    const r = await collectOrdersForExport(fakeList(orders(3), { keywordTruncated: true }).list, {});
    expect(r.kind).toBe('keyword_truncated');
  });

  it('讀到一半資料位移(同一張單出現兩次、另一張沒讀到)⇒ 擋下, 不交出看起來完整的半份', async () => {
    const all = orders(ORDER_EXPORT_ALL_BATCH + 5);
    const list = async (_f: AdminOrderFilter, p: { limit: number; offset?: number }) => {
      const offset = p.offset ?? 0;
      // 第二批開始時, 新進一張單把整串往後推一格 ⇒ 第二批的第一張 = 第一批的最後一張
      const src = offset === 0 ? all : [order(9999), ...all];
      return {
        items: src.slice(offset, offset + p.limit),
        total: all.length,
        keywordTruncated: false,
        keywordMatchCount: null,
        supplierOrderNoMatchedSuppliers: null,
      } as unknown as AdminOrderListResult;
    };
    const r = await collectOrdersForExport(list, {});
    expect(r.kind).toBe('changed_while_reading');
  });

  it('後面某一批回報的總數跟第一批不同(讀到一半有單進出)⇒ 擋下, 不管最後張數湊不湊得上', async () => {
    // 一張進、一張出:總數前後都一樣, 但中途那一批看到的總數不同 ⇒ 資料在讀的時候變過
    const all = orders(ORDER_EXPORT_ALL_BATCH + 5);
    const list = async (_f: AdminOrderFilter, p: { limit: number; offset?: number }) => {
      const offset = p.offset ?? 0;
      return {
        items: all.slice(offset, offset + p.limit),
        total: offset === 0 ? all.length : all.length + 1,
        keywordTruncated: false,
        keywordMatchCount: null,
        supplierOrderNoMatchedSuppliers: null,
      } as unknown as AdminOrderListResult;
    };
    const r = await collectOrdersForExport(list, {});
    expect(r.kind).toBe('changed_while_reading');
  });

  it('來源沒回總筆數 ⇒ 無法核對完整, 丟錯不給檔', async () => {
    await expect(collectOrdersForExport(fakeList(orders(3), { total: undefined }).list, {})).rejects.toThrow('總筆數');
  });

  it('有單的品項沒載入完整 ⇒ 擋下並列出單號', async () => {
    const all = orders(3);
    all[1] = { ...all[1]!, itemsTruncated: true };
    const r = await collectOrdersForExport(fakeList(all).list, {});
    expect(r).toEqual({ kind: 'items_truncated', displayIds: ['PCM-0002'] });
  });

  it('來源回的比總數少(讀漏)⇒ 擋下', async () => {
    const all = orders(ORDER_EXPORT_ALL_BATCH + 5);
    const list = async (_f: AdminOrderFilter, p: { limit: number; offset?: number }) => ({
      items: all.slice(p.offset ?? 0, (p.offset ?? 0) + p.limit).slice(0, p.offset ? 2 : p.limit),
      total: all.length,
      keywordTruncated: false,
      keywordMatchCount: null,
      supplierOrderNoMatchedSuppliers: null,
    }) as unknown as AdminOrderListResult;
    const r = await collectOrdersForExport(list, {});
    expect(r.kind).toBe('changed_while_reading');
  });
});

describe('buildOrderAllCsv / 檔名 / 篩選說明', () => {
  it('第一列寫「全部篩選結果、共幾張單、資料截至」, 走共用 toCsv(有 BOM)', () => {
    const csv = buildOrderAllCsv(orders(2), { total: 2, filterNote: '建立日期 2026-03-27 至 2026-09-27', dataAsOf: '2026-09-27 12:00' });
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const first = csv.slice(CSV_BOM.length).split('\r\n')[0]!;
    expect(first).toContain('篩選結果(不分頁)');
    expect(first).toContain('共 2 張單');
    expect(first).toContain('建立日期 2026-03-27 至 2026-09-27');
    expect(first).toContain('資料截至 2026-09-27 12:00');
    expect(csv).toContain('PCM-0001');
    expect(csv).toContain('PCM-0002');
  });

  it('檔名帶「篩選結果」, 與單頁匯出分得開', () => {
    expect(orderAllExportFilename(new Date('2026-09-27T04:00:00Z'))).toMatch(/篩選結果\.csv$/);
  });

  it('篩選說明:寫日期區間;有關鍵字只說有, 不寫內容(關鍵字是個資)', () => {
    // 真實形狀:filter 裡是台北午夜的絕對時刻, 上界是【隔天】午夜(半開區間)⇒ 直接印會差一天
    const note = orderExportFilterNote({
      createdFrom: taipeiDayStartIso('2026-03-27')!,
      createdTo: taipeiDayEndExclusiveIso('2026-09-27')!,
      keyword: '0912345678',
    });
    expect(note).toContain('建立日期 2026-03-27 至 2026-09-27');
    expect(note).not.toContain('2026-09-28');
    expect(note).toContain('關鍵字');
    expect(note).not.toContain('0912345678');
  });

  it('篩選說明:只有值真的有設才算(undefined / false / 空陣列不算 —— 舊版恆真的那個洞)', () => {
    expect(orderExportFilterNote({ paymentStatus: undefined, pendingOnly: false, goodsAxes: [] })).toBe('無篩選');
    expect(orderExportFilterNote({ pendingOnly: true })).toContain('其他篩選');
  });

  it('匯出網址 = 列表網址換路徑, 篩選參數原樣保留', () => {
    expect(orderExportAllHref('/orders?pay=paid&den=c')).toBe('/orders/export?pay=paid&den=c');
    expect(orderExportAllHref('/orders')).toBe('/orders/export');
    expect(orderExportAllHref('/orders-x?a=1')).toBe('/orders-x?a=1');
  });

  it('資料截至用台灣時間(UTC+8), 不是 UTC', () => {
    expect(taipeiDataAsOf(new Date('2026-09-27T04:05:00Z'))).toBe('2026-09-27 12:05');
    expect(taipeiDataAsOf(new Date('2026-09-27T17:30:00Z'))).toBe('2026-09-28 01:30');
  });
});
