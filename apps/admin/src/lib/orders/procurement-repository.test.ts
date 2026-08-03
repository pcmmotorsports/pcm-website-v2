import { beforeEach, describe, expect, it, vi } from 'vitest';

// `import 'server-only'` 在 vitest 的 node 環境解析不到(`note-repository.test.ts:3` 同一個處置)
vi.mock('server-only', () => ({}));

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ rpc }),
}));

import {
  PROCUREMENT_RESULT_CODES,
  ProcurementCallerBugError,
  upsertItemProcurement,
} from './procurement-repository';

// M-4b E10 A10b:`admin_upsert_item_procurement` 唯一呼叫端。
// 合約 = migration 20260803160000(17 固定碼 + 11 參數 + 兩個 RAISE SQLSTATE)。

// 大括號 body 是必要的(理由見 supplier.test.ts:17-22:簡潔箭頭會回傳 mock、被當 teardown 呼叫)。
beforeEach(() => {
  rpc.mockReset();
});

const ARGS = {
  orderItemId: 'item-1',
  supplierId: 'sup-1',
  allocatedQuantity: 2,
  replyStatus: 'confirmed' as const,
  contactChannel: null,
  submittedAt: null,
  supplierOrderNo: null,
  exceptionReason: null,
  expectedArrivalDate: null,
  actor: 'sean',
  requestId: 'req-1',
};

describe('upsertItemProcurement — 17 碼合約', () => {
  it('🔴 碼全集恰 17 個、無重複(migration 檔頭 :27-31 逐字)', () => {
    expect(PROCUREMENT_RESULT_CODES).toHaveLength(17);
    expect(new Set(PROCUREMENT_RESULT_CODES).size).toBe(17);
  });

  it.each(PROCUREMENT_RESULT_CODES)('%s → 原樣回傳(全部 17 個都收)', async (code) => {
    rpc.mockResolvedValue({ data: code, error: null });
    await expect(upsertItemProcurement(ARGS)).resolves.toBe(code);
  });

  // 🔴 memory feedback_null-dispatch-rpc-silently-downgrades:未知碼靜默當成功,
  //    症狀就是「採購沒寫進去」長得跟成功一樣、零錯誤。
  it.each([
    ['未知碼', 'SOMETHING_ELSE'],
    ['空字串', ''],
    ['小寫', 'created'],
    ['null', null],
    ['數字', 1],
    ['物件', { code: 'CREATED' }],
  ])('%s → 拋 CallerBugError,**不得**靜默當成功', async (_label, data) => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(upsertItemProcurement(ARGS)).rejects.toBeInstanceOf(ProcurementCallerBugError);
  });
});

describe('upsertItemProcurement — RAISE 面', () => {
  // 兩個 SQLSTATE 都是 caller bug(migration :32 逐條:P0001 = actor/request_id/防衛枝、P2B02 = 隔離閘)
  it.each(['P0001', 'P2B02'])('%s → CallerBugError(叫員工停手,不是「稍後再試」)', async (code) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: 'boom' } });
    await expect(upsertItemProcurement(ARGS)).rejects.toBeInstanceOf(ProcurementCallerBugError);
  });

  // 🔴 P2B01 刻意**不**認領:A5a 自己 catch 起來翻成 OVER_ALLOCATION 固定碼(:368-377/:398-403)
  //    ⇒ 走到 JS 層代表它沒被翻譯 = 真的異常,要落進通用 error 而不是被說成已知的呼叫端 bug。
  it('P2B01 → 原樣上拋(不是 CallerBugError)—— 它本該被 RPC 翻成 OVER_ALLOCATION', async () => {
    const raw = { code: 'P2B01', message: 'allocation guard' };
    rpc.mockResolvedValue({ data: null, error: raw });
    await expect(upsertItemProcurement(ARGS)).rejects.toBe(raw);
  });

  it('一般 DB 錯誤(連線斷)→ 原樣上拋', async () => {
    const raw = { code: '08006', message: 'connection failure' };
    rpc.mockResolvedValue({ data: null, error: raw });
    await expect(upsertItemProcurement(ARGS)).rejects.toBe(raw);
  });
});

describe('upsertItemProcurement — wire', () => {
  it('🔴 逐欄具名送 11 參數(全量 payload;漏一欄 = 那欄被寫成 NULL)', async () => {
    rpc.mockResolvedValue({ data: 'CREATED', error: null });
    await upsertItemProcurement({
      ...ARGS,
      contactChannel: 'LINE',
      submittedAt: '2026-08-04T02:00:00.000Z',
      supplierOrderNo: 'SO-123',
      exceptionReason: '原廠缺料',
      expectedArrivalDate: '2026-09-30',
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0]!;
    expect(fn).toBe('admin_upsert_item_procurement');
    expect(args).toEqual({
      p_order_item_id: 'item-1',
      p_supplier_id: 'sup-1',
      p_allocated_quantity: 2,
      p_reply_status: 'confirmed',
      p_contact_channel: 'LINE',
      p_submitted_at: '2026-08-04T02:00:00.000Z',
      p_supplier_order_no: 'SO-123',
      p_exception_reason: '原廠缺料',
      p_expected_arrival_date: '2026-09-30',
      p_actor: 'sean',
      p_request_id: 'req-1',
    });
    // 🔴 參數個數釘死 = 11(migration :107-119);多送/少送都會讓 PostgREST 找不到函式多載
    expect(Object.keys(args as object)).toHaveLength(11);
  });

  it('選填欄為 null 時**照樣送出 null**(不是省略 —— 省略 = 該欄不動,語意完全不同)', async () => {
    rpc.mockResolvedValue({ data: 'UPDATED', error: null });
    await upsertItemProcurement(ARGS);
    const [, args] = rpc.mock.calls[0]!;
    const payload = args as Record<string, unknown>;
    for (const key of [
      'p_contact_channel',
      'p_submitted_at',
      'p_supplier_order_no',
      'p_exception_reason',
      'p_expected_arrival_date',
    ]) {
      expect(key in payload, `${key} 必須出現在 payload 裡`).toBe(true);
      expect(payload[key]).toBeNull();
    }
  });
});
