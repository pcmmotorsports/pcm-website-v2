import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));

import { readFileSync } from 'node:fs';
import {
  RECEIPT_DELETE_RESULT_CODES,
  RECEIPT_RECORD_RESULT_CODES,
  ReceiptCallerBugError,
  deleteItemReceipt,
  findDuplicateOutcome,
  findProcurementRemaining,
  findReceiptIdByRequestId,
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

// ── #352-b-2 I1 第三道:逐欄具名 select(不得 `*`)──────────────────────
describe('listProcurementChoices — 欄位白名單', () => {
  // 🔴 **掃原始碼**:這一條擋的是「日後有人加欄時**自動**把它送到 client」,
  //    而那件事在行為測試裡看不到(mock 回什麼就是什麼)⇒ 只能在文字層釘。
  //    ⚠️ 它擋不住「有人具名多加一個敏感欄」——那要靠 review;這裡守的是 `*` 這個**類別**的錯。
  const RAW = readFileSync(new URL('./receipt-repository.ts', import.meta.url), 'utf8');

  it('🔴 採購列查詢逐欄具名,沒有 select(\'*\')', () => {
    const line = RAW.split('\n').find((l) => l.includes(".from('order_item_procurement')"));
    expect(line, "找不到採購列查詢 —— 這格的錨點沒了,不是通過").toBeTruthy();
    expect(RAW).not.toMatch(/\.select\(\s*['"`]\*/);
  });

  it('🔴 回傳形狀不含價格類欄名', () => {
    const banned = ['unit_price', 'line_total', 'price', 'cost', 'amount'];
    const hit = banned.filter((w) => RAW.includes(w));
    expect(hit, `receipt-repository.ts 出現價格欄名:${hit.join(', ')}`).toEqual([]);
  });
});

// ── 「改軟」線片 1:撤銷到貨 ────────────────────────────────────────────
describe('deleteItemReceipt — 三類結果嚴格分開', () => {
  const DEL = { receiptId: 'r-1', actor: 'staff-1', requestId: 'req-1' };

  /**
   * DB 原文的形狀。**這是手抄的副本,不是從正式庫撈的** ——
   * 來源 = `supabase/migrations/20260810233000_m4b_e10_352a2_receipt_write_rpcs.sql:428-433`
   * (那段 RAISE 的註解也指回本 fixture)。改那段 SQL 的訊息時要回來對一次;
   * 🔴 刻意**不做自動同步**:自動抓字串會讓「訊息被改壞」也一起同步過來、守門變恆真。
   */
  const P4A03_MESSAGE =
    '刪不掉這筆到貨紀錄:刪掉之後這個品項的可出數量會不夠。\n' +
    '已出貨 1 件、已裝進尚未出貨的包裹 2 件,而刪除後只剩 2 件。\n' +
    '尚未出貨的包裹:\n  K7X2MP:1 件\n  M3QQ8Z:1 件\n' +
    '要先把那些包裹作廢、或從包裹裡移除這個品項,才能刪掉這筆到貨紀錄。';

  it('三個固定碼原樣回傳', async () => {
    for (const code of RECEIPT_DELETE_RESULT_CODES) {
      mocks.rpc.mockResolvedValueOnce({ data: code, error: null });
      await expect(deleteItemReceipt(DEL)).resolves.toEqual({ kind: 'code', code });
    }
  });

  it('🔴🔴 P4A03 = 業務拒絕:訊息**一個字都不准少**(硬條款)', async () => {
    // 🔴 這格守的是原作者交辦的那條:DB 訊息逐箱列出包裹編號與件數,是員工唯一能照做的資訊。
    //    在這層做任何 slice / 改寫(同檔 `recordItemReceipt` 就有 `.slice(0, 200)` 的前例)
    //    都會把它切掉,而 UI 那 7 格因為 mock 掉 action **照樣全綠** —— 所以這格必須在這裡。
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'P4A03', message: P4A03_MESSAGE },
    });
    const out = await deleteItemReceipt(DEL);
    expect(out).toEqual({ kind: 'blocked', message: P4A03_MESSAGE });
    if (out.kind !== 'blocked') throw new Error('unreachable');
    expect(out.message, '包裹清單被切掉了').toContain('M3QQ8Z');
    expect(out.message.length, `訊息被截短:${out.message.length} < ${P4A03_MESSAGE.length}`).toBe(
      P4A03_MESSAGE.length,
    );
  });

  it('🔴 P0001 / P2B02 = 呼叫端 bug,拋 `ReceiptCallerBugError`(不得回成功)', async () => {
    for (const code of ['P0001', 'P2B02']) {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { code, message: 'x' } });
      await expect(deleteItemReceipt(DEL)).rejects.toBeInstanceOf(ReceiptCallerBugError);
    }
  });

  it('🔴 未知碼一律拋,**不得靜默當成功**(「以為撤掉了、其實沒撤」)', async () => {
    mocks.rpc.mockResolvedValue({ data: 'SOMETHING_NEW', error: null });
    await expect(deleteItemReceipt(DEL)).rejects.toBeInstanceOf(ReceiptCallerBugError);
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } });
    await expect(deleteItemReceipt(DEL)).rejects.toBeTruthy();
  });

  it('🔴 參數逐欄具名送(欄名錯了 RPC 會吃到 null)', async () => {
    mocks.rpc.mockResolvedValue({ data: 'DELETED', error: null });
    await deleteItemReceipt(DEL);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_delete_item_receipt', {
      p_receipt_id: 'r-1',
      p_actor: 'staff-1',
      p_request_id: 'req-1',
    });
  });
});

describe('findReceiptIdByRequestId — 撤銷唯一拿得到 receipt id 的路', () => {
  function ledger(data: unknown, error: unknown = null) {
    mocks.from.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error }) }) }),
    });
  }

  it('查到就回 id', async () => {
    ledger({ receipt_id: 'r-9' });
    await expect(findReceiptIdByRequestId('k-1')).resolves.toBe('r-9');
  });

  it('🔴 查無回 null(呼叫端要當「這把鍵沒登錄成功過」,不是「本來有、現在沒了」)', async () => {
    ledger(null);
    await expect(findReceiptIdByRequestId('k-1')).resolves.toBeNull();
  });

  it('🔴 查詢本身失敗要拋,不得回 null(fail-closed:回 null 會被讀成查無)', async () => {
    ledger(null, { message: 'boom' });
    await expect(findReceiptIdByRequestId('k-1')).rejects.toBeTruthy();
  });
});
