// ⟦5b-TRACKNUMGAP1⟧ 片 C:更正信掃描 adapter 的測試。
//
// 🔴🔴 **本檔【證不到】PostgREST 對這些條件的真實語意** —— 它用假 client 斷言參數,
//    也就是「查詢條件沒有被刪掉」。差集本身住在 SQL view 裡, 由 migration 的字面釘樁守。
//    ⇒ 📌 兩層各守一半, 而**兩層都不知道對方在**, 所以這句話要寫在兩邊。
import { describe, it, expect, vi } from 'vitest';
import {
  SupabaseTrackingCorrectedScannerAdapter,
  TrackingCorrectedScanQueryError,
  TRACKING_CORRECTED_PENDING_VIEW,
  type TrackingCorrectedScannerClient,
} from './SupabaseTrackingCorrectedScannerAdapter';

const RAW = {
  shipment_id: 'ship-1',
  shipment_reference: 'BCDF23',
  tracking_number: 'HCT-99887766',
  carrier_code: 'hct',
  tracking_corrected_at: '2026-09-04T10:00:00.000Z',
  corrected_at_key: '20260904100000000000',
  order_id: 'order-1',
  display_id: 'PCM-2026-0001',
  notification_email: 'member@example.com',
  customer_email: 'frozen@example.com',
  order_source: 'manual_phone',
};

function client(data: unknown[] | null, error: { code?: string } | null = null) {
  const orders: [string, { ascending: boolean }][] = [];
  const limit = vi.fn(async (n: number) => ({ data, error, _n: n }) as never);
  const select = vi.fn();
  const from = vi.fn();
  const orderable = {
    order(col: string, o: { ascending: boolean }) {
      orders.push([col, o]);
      return orderable;
    },
    limit,
  };
  select.mockReturnValue(orderable);
  from.mockReturnValue({ select });
  const c = { from } as unknown as TrackingCorrectedScannerClient;
  return { c, from, select, limit, orders };
}

describe('SupabaseTrackingCorrectedScannerAdapter', () => {
  it('🔴 打的是那個 view, 而且【十一個欄位一個都不能少】(⛔ ~~九~~ / ~~十~~ ⇒ 片 B 加了 order_source;而【九】那個字面在片 B 之前就已經與清單不符了)', async () => {
    const { c, from, select } = client([RAW]);
    await new SupabaseTrackingCorrectedScannerAdapter(c).listTrackingCorrectedWithoutEmail({
      limit: 25,
    });
    expect(from).toHaveBeenCalledWith(TRACKING_CORRECTED_PENDING_VIEW);
    // 🔴 承重:少一欄 ⇒ toRow 會丟 missing_column, 而那要到跑的時候才知道。這裡當場釘。
    const cols = (select.mock.calls[0]![0] as string).split(',').map((s) => s.trim());
    expect(cols).toEqual([
      'shipment_id',
      'shipment_reference',
      'tracking_number',
      'carrier_code',
      'tracking_corrected_at',
      'corrected_at_key',
      'order_id',
      'display_id',
      'notification_email',
      'customer_email',
      // 🔴 片 B(2026-09-05)新增。這一格逐字釘欄位清單 ⇒ 它【本來就該紅】,
      //    而它紅了正是這道釘樁還活著的證據。
      'order_source',
    ]);
  });

  it('🔴 排序的最後兩把鍵是【唯一】的 —— 只按時間排會在翻頁時跳列或重複', async () => {
    const { c, orders } = client([RAW]);
    await new SupabaseTrackingCorrectedScannerAdapter(c).listTrackingCorrectedWithoutEmail({
      limit: 25,
    });
    expect(orders.map(([col]) => col)).toEqual([
      'tracking_corrected_at',
      'shipment_id',
      'order_id',
    ]);
    expect(orders.every(([, o]) => o.ascending)).toBe(true);
  });

  it('🔴 多撈一列判 truncated:limit 25 ⇒ 真的送 26', async () => {
    const { c, limit } = client([RAW]);
    await new SupabaseTrackingCorrectedScannerAdapter(c).listTrackingCorrectedWithoutEmail({
      limit: 25,
    });
    expect(limit).toHaveBeenCalledWith(26);
  });

  it('🔴 回 limit+1 列 ⇒ truncated=true 而且【只回 limit 列】', async () => {
    const { c } = client([RAW, { ...RAW, shipment_id: 's2' }, { ...RAW, shipment_id: 's3' }]);
    const r = await new SupabaseTrackingCorrectedScannerAdapter(
      c,
    ).listTrackingCorrectedWithoutEmail({ limit: 2 });
    expect(r.truncated).toBe(true);
    expect(r.rows).toHaveLength(2);
  });

  it('🔵 負對照:回的列數 <= limit ⇒ truncated=false(證明上一格不是恆真)', async () => {
    const { c } = client([RAW]);
    const r = await new SupabaseTrackingCorrectedScannerAdapter(
      c,
    ).listTrackingCorrectedWithoutEmail({ limit: 2 });
    expect(r.truncated).toBe(false);
    expect(r.rows).toHaveLength(1);
  });

  it('🔵 欄位對映:snake_case 進來, camelCase 出去, 值逐字不變', async () => {
    const { c } = client([RAW]);
    const r = await new SupabaseTrackingCorrectedScannerAdapter(
      c,
    ).listTrackingCorrectedWithoutEmail({ limit: 5 });
    expect(r.rows[0]).toEqual({
      shipmentId: 'ship-1',
      shipmentReference: 'BCDF23',
      trackingNumber: 'HCT-99887766',
      carrierCode: 'hct',
      trackingCorrectedAt: '2026-09-04T10:00:00.000Z',
      trackingCorrectedKey: '20260904100000000000',
      // 🔴 片 B(2026-09-05):這一格是 toStrictEqual 整包比 ⇒ 多一欄它本來就該紅
      orderSource: 'manual_phone',
      orderId: 'order-1',
      displayId: 'PCM-2026-0001',
      notificationEmail: 'member@example.com',
      customerEmail: 'frozen@example.com',
    });
  });

  it('🔴 空號碼【當場丟】—— 一封空號碼的更正信比不寄糟', async () => {
    const { c } = client([{ ...RAW, tracking_number: '' }]);
    await expect(
      new SupabaseTrackingCorrectedScannerAdapter(c).listTrackingCorrectedWithoutEmail({
        limit: 5,
      }),
    ).rejects.toThrow(TrackingCorrectedScanQueryError);
  });

  it('🔵 email 欄空白 ⇒ 正規化成 null(不是空字串)', async () => {
    const { c } = client([{ ...RAW, notification_email: '   ' }]);
    const r = await new SupabaseTrackingCorrectedScannerAdapter(
      c,
    ).listTrackingCorrectedWithoutEmail({ limit: 5 });
    expect(r.rows[0]!.notificationEmail).toBeNull();
  });

  it('🔵 少一欄 ⇒ missing_column(不是靜靜當 null)', async () => {
    const { customer_email: _drop, ...missing } = RAW;
    const { c } = client([missing]);
    await expect(
      new SupabaseTrackingCorrectedScannerAdapter(c).listTrackingCorrectedWithoutEmail({
        limit: 5,
      }),
    ).rejects.toThrow(/missing_column:customer_email/);
  });

  it('🔴 PostgREST 回 error ⇒ 丟, 【不回空集合】—— 空集合會被讀成「沒有信要寄」', async () => {
    const { c } = client(null, { code: '42501' });
    await expect(
      new SupabaseTrackingCorrectedScannerAdapter(c).listTrackingCorrectedWithoutEmail({
        limit: 5,
      }),
    ).rejects.toThrow(/42501/);
  });

  it.each([0, -1, 1.5, 201, Number.NaN])('🔵 limit %s 不合法 ⇒ 丟, 一發請求都不打', async (n) => {
    const { c, from } = client([RAW]);
    await expect(
      new SupabaseTrackingCorrectedScannerAdapter(c).listTrackingCorrectedWithoutEmail({
        limit: n,
      }),
    ).rejects.toThrow();
    expect(from).not.toHaveBeenCalled();
  });
});

// ══ 片 B(⟦f3-MAILFALLBACKVSRULING⟧, 2026-09-05)——「撈得到 order_source」════════
// 🔴 **兩個宣稱, 各一格**:①它在 select 字串裡 ②它真的走到 port 物件上。
//    少了②, 一個「加進 select 而忘了對映」的實作【第①格照樣綠】。
// 🔵 而 fixture 刻意用 'manual_phone' 不用 'web' —— 一個把它寫死成 'web' 的對映
//    在 'web' 的 fixture 上完全看不出來。
describe('片 B:order_source 接出來了', () => {
  it('①select 字串帶了它, 而②它走到 port 物件上', async () => {
    const { c, select } = client([RAW]);
    const r = await new SupabaseTrackingCorrectedScannerAdapter(
      c,
    ).listTrackingCorrectedWithoutEmail({ limit: 50 });
    expect(String(select.mock.calls[0]![0])).toContain('order_source');
    expect(r.rows[0]?.orderSource).toBe('manual_phone');
  });
});
