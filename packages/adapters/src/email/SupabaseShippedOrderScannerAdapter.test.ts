// M-4b E4-a 出貨信掃描 adapter 的測試。
//
// 🔴 **這支檔存在的理由是 codex 2026-08-22 R2 的一句話**(逐字):
//    「整支新 scanner 零測試;把 nullable 非字串重新吞成 null、移除 tie-breaker、
//      改壞 limit+1/truncated —— **現有測試都不會紅**。」
// ⇒ 所以本檔的驗收不是「有沒有測到」,是**那三個改法各自要有一格會紅**。
import { describe, it, expect } from 'vitest';

import {
  SupabaseShippedOrderScannerAdapter,
  ShippedScanQueryError,
  SHIPPED_EMAIL_PENDING_VIEW,
  type ShippedOrderScannerClient,
} from './SupabaseShippedOrderScannerAdapter';

const CUTOFF = '2026-08-22T00:00:00.000Z';

function goodRow(over: Record<string, unknown> = {}) {
  return {
    shipment_id: 'shp-1',
    shipment_reference: 'BCDF23',
    shipped_at: '2026-08-22T10:00:00.000Z',
    order_id: 'ord-1',
    display_id: 'PCM-2026-0001',
    notification_email: 'member@example.com',
    customer_email: 'frozen@example.com',
    ...over,
  };
}

/** 記下每一段呼叫,讓「排序帶了幾段」「limit 傳了多少」變成可斷言的東西。 */
function makeClient(data: unknown[] | null, error: { code?: string } | null = null) {
  const calls = {
    table: '' as string,
    columns: '' as string,
    gt: [] as Array<[string, string]>,
    order: [] as Array<[string, { ascending: boolean }]>,
    limit: 0,
  };
  const orderable = {
    order(column: string, opts: { ascending: boolean }) {
      calls.order.push([column, opts]);
      return orderable;
    },
    limit(count: number) {
      calls.limit = count;
      return Promise.resolve({ data, error });
    },
  };
  const client = {
    from(table: string) {
      calls.table = table;
      return {
        select(columns: string) {
          calls.columns = columns;
          return {
            gt(column: string, value: string) {
              calls.gt.push([column, value]);
              return orderable;
            },
          };
        },
      };
    },
  } as unknown as ShippedOrderScannerClient;
  return { client, calls };
}

const scan = (c: ShippedOrderScannerClient, limit = 25, cutoff = CUTOFF) =>
  new SupabaseShippedOrderScannerAdapter(c).listShippedWithoutShippedEmail({ cutoff, limit });

describe('SupabaseShippedOrderScannerAdapter — 查詢形狀', () => {
  it('查的是那支 view、cutoff 走【嚴格大於】shipped_at', async () => {
    const { client, calls } = makeClient([goodRow()]);
    await scan(client);

    expect(calls.table).toBe(SHIPPED_EMAIL_PENDING_VIEW);
    expect(calls.gt).toEqual([['shipped_at', CUTOFF]]);
  });

  it('🔴 排序帶唯一鍵(三段全序)—— 少任何一段,同時戳記的兩箱在兩次查詢間順序不穩', async () => {
    const { client, calls } = makeClient([goodRow()]);
    await scan(client);

    expect(calls.order.map(([c]) => c)).toEqual(['shipped_at', 'shipment_id', 'order_id']);
    expect(calls.order.every(([, o]) => o.ascending)).toBe(true);
  });

  it('🔴 limit 要多要一列當探針(limit + 1),否則 truncated 永遠是假的', async () => {
    const { client, calls } = makeClient([goodRow()]);
    await scan(client, 25);

    expect(calls.limit).toBe(26);
  });

  it('🔴 拿到 limit + 1 列 ⇒ truncated=true,而**回傳只給 limit 列**', async () => {
    const rows = Array.from({ length: 4 }, (_, i) => goodRow({ order_id: `ord-${i}` }));
    const { client } = makeClient(rows);
    const r = await scan(client, 3);

    expect(r.truncated).toBe(true);
    expect(r.rows).toHaveLength(3);
    expect(r.rows.map((x) => x.orderId)).toEqual(['ord-0', 'ord-1', 'ord-2']);
  });

  it('剛好 limit 列 ⇒ truncated=false(「收滿」與「後面還有」不可混為一談)', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => goodRow({ order_id: `ord-${i}` }));
    const { client } = makeClient(rows);
    const r = await scan(client, 3);

    expect(r.truncated).toBe(false);
    expect(r.rows).toHaveLength(3);
  });
});

describe('SupabaseShippedOrderScannerAdapter — 契約閘(fail-closed)', () => {
  it('🔴 沒帶 cutoff ⇒ throw,**不是「沒給就撈全部」**', async () => {
    const { client } = makeClient([]);
    await expect(scan(client, 25, '')).rejects.toThrow(/cutoff/);
    await expect(scan(client, 25, '   ')).rejects.toThrow(/cutoff/);
  });

  it('limit 超出 1..200 ⇒ throw(探針要遠小於 db-max-rows,否則 truncated 假陰性)', async () => {
    const { client } = makeClient([]);
    await expect(scan(client, 0)).rejects.toThrow(/limit/);
    await expect(scan(client, 201)).rejects.toThrow(/limit/);
    await expect(scan(client, 1.5)).rejects.toThrow(/limit/);
  });

  it('查詢回 error ⇒ 丟 ShippedScanQueryError,而訊息只帶固定 code(不帶 DB 原文)', async () => {
    const { client } = makeClient(null, { code: '42501' });
    await expect(scan(client)).rejects.toBeInstanceOf(ShippedScanQueryError);
    await expect(scan(client)).rejects.toThrow(/42501/);
    // 🔴 反面:訊息裡不可以出現任何看起來像信箱的東西。
    await expect(scan(client)).rejects.not.toThrow(/@/);
  });
});

describe('SupabaseShippedOrderScannerAdapter — 逐列形狀檢查(三條路)', () => {
  it('✅ 路一:null ⇒ 合法的「沒有這個信箱」', async () => {
    const { client } = makeClient([goodRow({ notification_email: null })]);
    const r = await scan(client);

    expect(r.rows[0]?.notificationEmail).toBeNull();
    expect(r.rows[0]?.customerEmail).toBe('frozen@example.com');
  });

  it('✅ 路一之二:空字串 / 全空白 也算「沒有」', async () => {
    const { client } = makeClient([goodRow({ notification_email: '   ', customer_email: '' })]);
    const r = await scan(client);

    expect(r.rows[0]?.notificationEmail).toBeNull();
    expect(r.rows[0]?.customerEmail).toBeNull();
  });

  it('🔴 路二:欄根本沒回來(undefined)⇒ missing_column,**不可以當成 null**', async () => {
    const row = goodRow();
    delete (row as Record<string, unknown>).customer_email;
    const { client } = makeClient([row]);

    await expect(scan(client)).rejects.toThrow(/missing_column:customer_email/);
  });

  it('🔴 路三:型別壞掉(number / object)⇒ bad_row_shape,**不可以靜默吞成 null**', async () => {
    // 吞成 null 的話,呼叫端會記成 noRecipient
    // ⇒ 維運看到的是「這位客人沒有信箱」,而真相是「我們的查詢回了奇怪的東西」。
    const { client: c1 } = makeClient([goodRow({ customer_email: 42 })]);
    await expect(scan(c1)).rejects.toThrow(/bad_row_shape:customer_email/);

    const { client: c2 } = makeClient([goodRow({ notification_email: { a: 1 } })]);
    await expect(scan(c2)).rejects.toThrow(/bad_row_shape:notification_email/);
  });

  it('必填欄空掉 ⇒ bad_row_shape(只講欄名、不講值)', async () => {
    const { client } = makeClient([goodRow({ display_id: '' })]);
    await expect(scan(client)).rejects.toThrow(/bad_row_shape:display_id/);
  });

  it('資料回 null(不是空陣列)⇒ 當成 0 列,不是崩潰', async () => {
    const { client } = makeClient(null);
    const r = await scan(client);

    expect(r.rows).toEqual([]);
    expect(r.truncated).toBe(false);
  });
});
