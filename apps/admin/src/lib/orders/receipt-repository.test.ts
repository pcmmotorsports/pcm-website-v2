import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));

import {
  RECEIPT_RECORD_RESULT_CODES,
  ReceiptCallerBugError,
  findDuplicateOutcome,
  findProcurementRemaining,
  recordItemReceipt,
} from './receipt-repository';

const ARGS = {
  procurementId: 'p-1',
  quantity: 2,
  surplusQuantity: 0,
  receivedAt: '2026-08-11T10:30:00+08:00',
  note: null,
  actor: 'staff-1',
  requestId: 'k-1',
};

beforeEach(() => vi.clearAllMocks());

describe('recordItemReceipt — 固定碼窮盡收斂', () => {
  it.each(RECEIPT_RECORD_RESULT_CODES)('%s 原樣回傳', async (code) => {
    mocks.rpc.mockResolvedValue({ data: code, error: null });
    await expect(recordItemReceipt(ARGS)).resolves.toBe(code);
  });

  // 🔴🔴 R1 Important 4 突變③:拿掉 `RECORD_CODE_SET.has(data)` ⇒ 未知碼被當成功回傳。
  //    這是本片最貴的失敗形狀:「到貨沒記進去」長得跟成功一模一樣 —— instock 不動、
  //    出貨彈窗照樣說「未到貨」,而員工已經看到綠色橫幅了。
  it.each([
    ['未知碼(RPC 漂移)', 'SOMETHING_NEW'],
    ['null', null],
    ['數字', 42],
    ['物件', { ok: true }],
    ['空字串', ''],
  ])('🔴 %s ⇒ 拋 CallerBugError,**不得**當成功', async (_label, data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expect(recordItemReceipt(ARGS)).rejects.toBeInstanceOf(ReceiptCallerBugError);
  });

  it('逐欄具名送(不 spread、不漏欄)', async () => {
    mocks.rpc.mockResolvedValue({ data: 'RECORDED', error: null });
    await recordItemReceipt({ ...ARGS, note: '外箱破損' });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_record_item_receipt', {
      p_procurement_id: 'p-1',
      p_quantity: 2,
      p_surplus_quantity: 0,
      p_received_at: '2026-08-11T10:30:00+08:00',
      p_note: '外箱破損',
      p_actor: 'staff-1',
      p_request_id: 'k-1',
    });
  });
});

describe('recordItemReceipt — RAISE 分類', () => {
  it.each(['P0001', 'P2B02'])('%s ⇒ 呼叫端 bug', async (code) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: 'x' } });
    await expect(recordItemReceipt(ARGS)).rejects.toBeInstanceOf(ReceiptCallerBugError);
  });

  // 🔴 其他 SQLSTATE **不得**被認領成「已知的呼叫端 bug」—— 認領了就等於把真正的異常
  //    (例如未被翻譯的守門)包裝成一句「請重新整理」,而它需要的是進通用 error 被看見。
  it.each(['23514', '40P01', 'PGRST301'])('%s ⇒ 原樣往上拋,不當 bug', async (code) => {
    const raw = { code, message: 'x' };
    mocks.rpc.mockResolvedValue({ data: null, error: raw });
    await expect(recordItemReceipt(ARGS)).rejects.toBe(raw);
  });
});

describe('findDuplicateOutcome', () => {
  /**
   * 兩次 `.from()` 依序回傳:冪等帳、receipt 本體。
   * 🔴 **把 table / select / eq 的參數記下來**(R2 nit):上一版 `eq: () => …` 直接吃掉參數
   * ⇒「到底查了哪一張表的哪一欄」從來沒被斷言,把 `request_id` 打成 `receipt_id` 也全綠。
   */
  const calls: { table: string; column: string; value: unknown }[] = [];
  function chain(ledger: unknown, receipt: unknown) {
    const make = (data: unknown, table: string) => ({
      select: () => ({
        eq: (column: string, value: unknown) => {
          calls.push({ table, column, value });
          return { maybeSingle: async () => ({ data, error: null }) };
        },
      }),
    });
    mocks.from
      .mockImplementationOnce((t: string) => make(ledger, t))
      .mockImplementationOnce((t: string) => make(receipt, t));
  }

  beforeEach(() => {
    calls.length = 0;
    mocks.from.mockReset();
  });

  it('查的是冪等帳的 request_id,再拿 receipt_id 查 receipt 本體', async () => {
    chain({ receipt_id: 'r-1' }, { id: 'r-1' });
    await findDuplicateOutcome('k-1');
    expect(calls).toEqual([
      { table: 'order_item_receipt_requests', column: 'request_id', value: 'k-1' },
      { table: 'order_item_procurement_receipts', column: 'id', value: 'r-1' },
    ]);
  });

  // 🔴 查詢炸掉**不可以**被吞成某個結論 —— 呼叫端(action)要自己決定退到哪裡,
  //    在這一層靜默回 'unknown' 會讓「查不到」與「查壞了」永遠分不出來。
  it.each([
    ['冪等帳查詢炸掉', true],
    ['receipt 查詢炸掉', false],
  ])('%s ⇒ 原樣拋,不吞', async (_label, ledgerFails) => {
    const boom = { message: 'boom' };
    const ok = (data: unknown) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error: null }) }) }),
    });
    const bad = () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: boom }) }) }),
    });
    if (ledgerFails) mocks.from.mockImplementationOnce(bad);
    else mocks.from.mockImplementationOnce(() => ok({ receipt_id: 'r-1' })).mockImplementationOnce(bad);
    await expect(findDuplicateOutcome('k-1')).rejects.toBe(boom);
  });

  it('產物還在 ⇒ alive', async () => {
    chain({ receipt_id: 'r-1' }, { id: 'r-1' });
    await expect(findDuplicateOutcome('k-1')).resolves.toBe('alive');
  });

  // 🔴 這條是 `DUPLICATE_DELETED` 文案的來源:帳本列不可刪、receipt 可刪
  //    ⇒ 鍵查得到但產物查不到 = 先前登錄過、後來被刪、而且**沒有**重新建立。
  it('帳本有鍵但產物查不到 ⇒ deleted', async () => {
    chain({ receipt_id: 'r-1' }, null);
    await expect(findDuplicateOutcome('k-1')).resolves.toBe('deleted');
  });

  it('連鍵都查不到 ⇒ unknown(退回保守文案,不猜)', async () => {
    chain(null, null);
    await expect(findDuplicateOutcome('k-1')).resolves.toBe('unknown');
  });
});

describe('findProcurementRemaining', () => {
  // 🔴 `vi.clearAllMocks()` **不會清掉 `mockImplementationOnce` 的佇列** ——
  //    上面兩個 describe 排進去的 once 實作會殘留到這裡、把第一次 `.from()` 吃掉。
  //    (第一版就是這樣紅的:三格全回 null。)⇒ 這裡明確 reset 再裝。
  beforeEach(() => mocks.from.mockReset());

  function row(data: unknown, error: unknown = null) {
    mocks.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error }) }) }),
    }));
  }

  it('回 allocated − received', async () => {
    row({ allocated_quantity: 5, received_quantity: 2 });
    await expect(findProcurementRemaining('p-1')).resolves.toBe(3);
  });

  // 查無 ⇒ null,讓呼叫端「不給數字」而不是給一個編出來的 0
  it('查無 ⇒ null', async () => {
    row(null);
    await expect(findProcurementRemaining('p-1')).resolves.toBeNull();
  });

  it('查詢炸掉 ⇒ 原樣拋(呼叫端自己 catch 成不給建議)', async () => {
    const boom = { message: 'boom' };
    row(null, boom);
    await expect(findProcurementRemaining('p-1')).rejects.toBe(boom);
  });
});
