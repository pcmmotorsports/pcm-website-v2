import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  authorizeAdminMutation: vi.fn(),
  getRequestId: vi.fn(),
  recordItemReceipt: vi.fn(),
  findDuplicateOutcome: vi.fn(),
  findProcurementRemaining: vi.fn(),
  listProcurementChoices: vi.fn(),
  deleteItemReceipt: vi.fn(),
  findReceiptIdByRequestId: vi.fn(),
  findOrderItemIdForReceipt: vi.fn(),
  findOrderIdForItem: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('../session/authorize', () => ({ authorizeAdminMutation: mocks.authorizeAdminMutation }));
vi.mock('../audit/context', () => ({ getRequestId: mocks.getRequestId }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient: vi.fn() }));

// 🔴 只換掉會打 DB 的函式,`ReceiptCallerBugError` 用真的那一個
//    (自己造假 class 的話,「bug 與 error 分得開」就變成自我實現)。
vi.mock('./receipt-repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./receipt-repository')>();
  return {
    ...actual,
    recordItemReceipt: mocks.recordItemReceipt,
    findDuplicateOutcome: mocks.findDuplicateOutcome,
    findProcurementRemaining: mocks.findProcurementRemaining,
    listProcurementChoices: mocks.listProcurementChoices,
    deleteItemReceipt: mocks.deleteItemReceipt,
    findReceiptIdByRequestId: mocks.findReceiptIdByRequestId,
    findOrderItemIdForReceipt: mocks.findOrderItemIdForReceipt,
  };
});
vi.mock('./procurement-repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./procurement-repository')>();
  return { ...actual, findOrderIdForItem: mocks.findOrderIdForItem };
});

// 🔴 解析器**刻意不 mock** —— 餵真 FormData 走真解析器,否則「爛表單擋得住」是恆真斷言。
import {
  fetchItemProcurementChoices,
  recordItemReceiptAction,
  undoItemReceiptAction,
} from './receipt-actions';
import { ReceiptCallerBugError } from './receipt-repository';
import {
  RCPT_NOTE_FIELD,
  RCPT_ORDER_ID_FIELD,
  RCPT_ORDER_ITEM_ID_FIELD,
  RCPT_PROCUREMENT_ID_FIELD,
  RCPT_INLINE_FIELD,
  RCPT_QUANTITY_FIELD,
  RCPT_RECEIVED_AT_LOCAL_FIELD,
  RCPT_REQUEST_ID_FIELD,
  RCPT_SURPLUS_FIELD,
  RECEIPT_DUPLICATE_RESULT_CODE,
  RECEIPT_RECORDED_RESULT_CODE,
  type ReceiptActionState,
} from './receipt-action-state';
import { ORDER_RETURN_TO_FIELD } from './order-return-to';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const ITEM_ID = '22222222-2222-4222-8222-222222222222';
const PROC_ID = '33333333-3333-4333-8333-333333333333';
/** 🔴 表單鑄的一次性冪等鍵。與下面 HTTP request id **刻意不同**,兩者混用是本檔要抓的 bug。 */
const FORM_KEY = 'form-key-0001';
const HTTP_REQUEST_ID = 'req_http_9999';

const IDLE: ReceiptActionState = { status: 'idle' };

function formData(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    [RCPT_ORDER_ID_FIELD]: ORDER_ID,
    [RCPT_ORDER_ITEM_ID_FIELD]: ITEM_ID,
    [RCPT_PROCUREMENT_ID_FIELD]: PROC_ID,
    [RCPT_REQUEST_ID_FIELD]: FORM_KEY,
    [RCPT_RECEIVED_AT_LOCAL_FIELD]: '2026-08-11T10:30',
    [RCPT_QUANTITY_FIELD]: '2',
    [RCPT_SURPLUS_FIELD]: '0',
    [RCPT_NOTE_FIELD]: '',
    [ORDER_RETURN_TO_FIELD]: `/orders/${ORDER_ID}`,
    ...over,
  };
  for (const [k, v] of Object.entries(base)) fd.append(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorizeAdminMutation.mockResolvedValue({ sid: 'sid-1', actorId: 'staff-1' });
  mocks.getRequestId.mockResolvedValue(HTTP_REQUEST_ID);
  mocks.findOrderIdForItem.mockResolvedValue(ORDER_ID);
  mocks.recordItemReceipt.mockResolvedValue('RECORDED');
  mocks.redirect.mockImplementation(() => {
    throw new Error('NEXT_REDIRECT');
  });
});

/** `redirect()` 在真實 Next 是拋例外 ⇒ 這裡照樣拋,再把它吞掉、回傳被導去的網址。 */
async function runExpectingRedirect(fd: FormData): Promise<string> {
  await expect(recordItemReceiptAction(IDLE, fd)).rejects.toThrow('NEXT_REDIRECT');
  return String(mocks.redirect.mock.calls.at(-1)?.[0] ?? '');
}

// 🔴 wire 格式守門(#15-B2-b2 R2 MF1 跨檔修一起補):頁層讀的是 `r` 參數,
//    這裡原本直接接裸碼 ⇒ `?receipt_recorded` ⇒ 橫幅在正式站永遠讀不到,而所有測試照樣綠。
//    ⇒ 這一格釘住 wire 格式本身,兩支 action(到貨/收款)各有一份。
describe('🔴 結果碼一定要以 `r=` 送出', () => {
  it('成功 ⇒ 網址帶 `r=receipt_recorded`(裸碼會讓橫幅永遠讀不到)', async () => {
    const target = await runExpectingRedirect(formData());
    expect(target).toMatch(/[?&]r=receipt_recorded(&|$)/);
  });

  it('冪等重放 ⇒ 網址帶 `r=receipt_duplicate`', async () => {
    mocks.recordItemReceipt.mockResolvedValue('DUPLICATE_REQUEST');
    mocks.findDuplicateOutcome.mockResolvedValue('alive');
    const target = await runExpectingRedirect(formData());
    expect(target).toMatch(/[?&]r=receipt_duplicate(&|$)/);
  });
});

describe('recordItemReceiptAction — 冪等鍵', () => {
  // 🔴🔴 R1 Important 4 突變①:把 `requestId: parsed.requestId` 改成 HTTP 的 `requestId`
  //    ⇒ 每次送出都是一把新鍵 ⇒ **冪等完全失效**,員工手滑按兩次就記兩筆到貨。
  //    這格就是釘住「送進 RPC 的是表單那把鍵」。
  it('🔴 送進 RPC 的是表單鑄的一次性鍵,不是每次請求的 HTTP request id', async () => {
    await runExpectingRedirect(formData());
    expect(mocks.recordItemReceipt).toHaveBeenCalledTimes(1);
    const args = mocks.recordItemReceipt.mock.calls[0]![0] as { requestId: string };
    expect(args.requestId).toBe(FORM_KEY);
    expect(args.requestId).not.toBe(HTTP_REQUEST_ID);
  });

  it('偏移由 server 補 Asia/Taipei(不是把 datetime-local 原字面送下去)', async () => {
    await runExpectingRedirect(formData());
    const args = mocks.recordItemReceipt.mock.calls[0]![0] as { receivedAt: string };
    expect(args.receivedAt).toBe('2026-08-11T10:30:00+08:00');
  });
});

describe('recordItemReceiptAction — DUPLICATE_REQUEST 兩種結局', () => {
  beforeEach(() => mocks.recordItemReceipt.mockResolvedValue('DUPLICATE_REQUEST'));

  it('產物還在 → 導向成功碼(對員工等同成功)', async () => {
    mocks.findDuplicateOutcome.mockResolvedValue('alive');
    expect(await runExpectingRedirect(formData())).toContain(RECEIPT_DUPLICATE_RESULT_CODE);
  });

  // 🔴🔴 R1 Important 4 突變②:拿掉 `outcome === 'deleted'` 分支 ⇒ 產物已被刪也顯示成功。
  //    RPC 對這種情況**不重新建立**(`20260811010000:181`)⇒ 顯示成功 = 對員工說謊,
  //    他會以為貨記在帳上,而帳面是空的。
  it('🔴 產物已被刪 → **不得**導向成功,要回可見的警告', async () => {
    mocks.findDuplicateOutcome.mockResolvedValue('deleted');
    const state = await recordItemReceiptAction(IDLE, formData());
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(state.status).toBe('failed');
    if (state.status !== 'failed') return;
    expect(state.code).toBe('DUPLICATE_DELETED');
    // 🔴 上一版是 `toContain('沒有')` —— 近乎恆真(訊息裡「沒有寫入」之類到處都是)。
    //    釘住這條訊息唯一要傳達的事實:**這次沒有重新建立**。
    expect(state.message).toContain('沒有重新建立');
  });

  it('查不到狀態 → 保守說法,一樣不導向成功', async () => {
    mocks.findDuplicateOutcome.mockResolvedValue('unknown');
    const state = await recordItemReceiptAction(IDLE, formData());
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(state.status === 'failed' && state.code).toBe('DUPLICATE_UNKNOWN');
  });

  // 查詢本身炸掉不可以變成「成功」—— fail-safe 方向要釘住。
  it('冪等產物查詢炸掉 → 退到 unknown,不導向成功', async () => {
    mocks.findDuplicateOutcome.mockRejectedValue(new Error('boom'));
    const state = await recordItemReceiptAction(IDLE, formData());
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(state.status === 'failed' && state.code).toBe('DUPLICATE_UNKNOWN');
  });
});

describe('recordItemReceiptAction — 品項歸屬閘', () => {
  // 🔴🔴 R1 Important 4 突變④:拿掉歸屬閘 ⇒ A 單的表單寫得進 B 單的品項。
  //    RPC 只認 `procurement_id`,`order_id` 是表單 hidden 欄 ⇒ 這道閘是唯一防線。
  it('🔴 品項不屬於這張單 → 拒寫,而且一個 byte 都不送 RPC', async () => {
    mocks.findOrderIdForItem.mockResolvedValue('99999999-9999-4999-8999-999999999999');
    const state = await recordItemReceiptAction(IDLE, formData());
    expect(mocks.recordItemReceipt).not.toHaveBeenCalled();
    expect(state.status === 'failed' && state.code).toBe('bug');
  });

  it('查無品項 → 拒寫(fail-closed)', async () => {
    mocks.findOrderIdForItem.mockResolvedValue(null);
    const state = await recordItemReceiptAction(IDLE, formData());
    expect(mocks.recordItemReceipt).not.toHaveBeenCalled();
    expect(state.status === 'failed' && state.code).toBe('bug');
  });

  it('歸屬查詢本身炸掉 → 拒寫(不是當成通過)', async () => {
    mocks.findOrderIdForItem.mockRejectedValue(new Error('boom'));
    const state = await recordItemReceiptAction(IDLE, formData());
    expect(mocks.recordItemReceipt).not.toHaveBeenCalled();
    expect(state.status === 'failed' && state.code).toBe('error');
  });
});

describe('recordItemReceiptAction — 授權與形狀', () => {
  it('未授權 → denied,且連解析都不做(不對未授權者洩漏表單規則)', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    const state = await recordItemReceiptAction(IDLE, formData());
    expect(state.status === 'failed' && state.code).toBe('denied');
    expect(mocks.findOrderIdForItem).not.toHaveBeenCalled();
    expect(mocks.recordItemReceipt).not.toHaveBeenCalled();
  });

  // 🔴🔴 R2 must-fix ①:`invalid` 必須帶著 procurementId 回去,否則小視窗的
  //    `state.procurementId === procurementId` 恆不等 ⇒ 橫幅不渲染、員工按下去零回饋。
  it('🔴 invalid 要帶 procurementId(否則畫面上完全沒有反應)', async () => {
    const state = await recordItemReceiptAction(
      IDLE,
      formData({ [RCPT_RECEIVED_AT_LOCAL_FIELD]: '' }),
    );
    expect(state.status === 'failed' && state.code).toBe('invalid');
    expect(state.status === 'failed' && state.procurementId).toBe(PROC_ID);
  });

  it('quantity 送兩份 → invalid,**不得**被靜默寫成「到貨 0 件」', async () => {
    const fd = formData();
    fd.append(RCPT_QUANTITY_FIELD, '5');
    const state = await recordItemReceiptAction(IDLE, fd);
    expect(mocks.recordItemReceipt).not.toHaveBeenCalled();
    expect(state.status === 'failed' && state.code).toBe('invalid');
  });

  it('到貨時間格式壞掉 → 不送 RPC(不把空字串當成時刻送下去)', async () => {
    const state = await recordItemReceiptAction(
      IDLE,
      formData({ [RCPT_RECEIVED_AT_LOCAL_FIELD]: '不是時間' }),
    );
    expect(mocks.recordItemReceipt).not.toHaveBeenCalled();
    expect(state.status === 'failed' && state.code).toBe('RECEIVED_AT_REQUIRED');
  });
});

describe('recordItemReceiptAction — RPC 回傳碼分派', () => {
  it('RECORDED → 導向成功碼', async () => {
    expect(await runExpectingRedirect(formData())).toContain(RECEIPT_RECORDED_RESULT_CODE);
  });

  it('取消後到貨(到貨 0 / 溢收 3)照樣送得出去且導成功', async () => {
    await runExpectingRedirect(
      formData({ [RCPT_QUANTITY_FIELD]: '0', [RCPT_SURPLUS_FIELD]: '3' }),
    );
    const args = mocks.recordItemReceipt.mock.calls[0]![0] as {
      quantity: number;
      surplusQuantity: number;
    };
    expect(args.quantity).toBe(0);
    expect(args.surplusQuantity).toBe(3);
  });

  it('EXCEEDS_ROOM_AFTER_CANCELLATION → 回可改輸入的訊息、不導向', async () => {
    mocks.recordItemReceipt.mockResolvedValue('EXCEEDS_ROOM_AFTER_CANCELLATION');
    const state = await recordItemReceiptAction(IDLE, formData());
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(state.status === 'failed' && state.code).toBe('EXCEEDS_ROOM_AFTER_CANCELLATION');
  });

  it('QUANTITY_EXCEEDS_ALLOCATED → 附上拆分建議的確切數字', async () => {
    mocks.recordItemReceipt.mockResolvedValue('QUANTITY_EXCEEDS_ALLOCATED');
    mocks.findProcurementRemaining.mockResolvedValue(1);
    const state = await recordItemReceiptAction(IDLE, formData({ [RCPT_QUANTITY_FIELD]: '3' }));
    if (state.status !== 'failed') throw new Error('應為 failed');
    expect(state.message).toContain('1 件');
    expect(state.message).toContain('2 件');
  });

  // 🔴 R2 nit:`remaining` 是鎖外讀的,併發下可能**比送出當下更大** ⇒ 差額 ≤ 0,
  //    而訊息會白紙黑字寫「溢收填 -1 件」。算不出正數就不給數字。
  it.each([
    ['差額為 0', 3],
    ['差額為負(併發下 remaining 變大)', 5],
  ])('%s ⇒ 不給拆分建議(不吐負數)', async (_label, remaining) => {
    mocks.recordItemReceipt.mockResolvedValue('QUANTITY_EXCEEDS_ALLOCATED');
    mocks.findProcurementRemaining.mockResolvedValue(remaining);
    const state = await recordItemReceiptAction(IDLE, formData({ [RCPT_QUANTITY_FIELD]: '3' }));
    if (state.status !== 'failed') throw new Error('應為 failed');
    expect(state.message).not.toContain('建議');
    expect(state.message).not.toMatch(/-\d/);
  });

  it('拆分建議查不到 → 不編數字,只給基本訊息', async () => {
    mocks.recordItemReceipt.mockResolvedValue('QUANTITY_EXCEEDS_ALLOCATED');
    mocks.findProcurementRemaining.mockResolvedValue(null);
    const state = await recordItemReceiptAction(IDLE, formData({ [RCPT_QUANTITY_FIELD]: '3' }));
    if (state.status !== 'failed') throw new Error('應為 failed');
    expect(state.message).not.toContain('建議');
  });

  it('呼叫端契約違反 → bug(不是 error)', async () => {
    mocks.recordItemReceipt.mockRejectedValue(new ReceiptCallerBugError('契約違反'));
    const state = await recordItemReceiptAction(IDLE, formData());
    expect(state.status === 'failed' && state.code).toBe('bug');
  });

  it('其他例外 → error,且文案要說「可能已經寫進去了」', async () => {
    mocks.recordItemReceipt.mockRejectedValue(new Error('boom'));
    const state = await recordItemReceiptAction(IDLE, formData());
    if (state.status !== 'failed') throw new Error('應為 failed');
    expect(state.code).toBe('error');
    expect(state.message).toContain('可能已經寫進去');
  });
});

// 🔴🔴 E1 的兩格「不倒灌」守門(主視窗要求②):**成對**釘住 ——
//    彈窗模式成功不 redirect / 列表模式成功仍 redirect。
//    只釘前者的話,有人把 redirect 整條拿掉會全綠,而「成功一律 PRG」那條慣例就這樣沒了。
describe('recordItemReceiptAction — E1 彈窗模式(具名例外,不得倒灌成常態)', () => {
  it('🔴 彈窗模式 RECORDED → 回 recorded_inline,**不** redirect', async () => {
    const state = await recordItemReceiptAction(IDLE, formData({ [RCPT_INLINE_FIELD]: '1' }));
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(state.status).toBe('recorded_inline');
    if (state.status !== 'recorded_inline') return;
    expect(state.outcome).toBe('recorded');
    expect(state.procurementId).toBe(PROC_ID);
  });

  it('🔴 列表模式 RECORDED → 仍然 redirect(例外不得倒灌)', async () => {
    expect(await runExpectingRedirect(formData())).toContain(RECEIPT_RECORDED_RESULT_CODE);
  });

  it('彈窗模式 DUPLICATE 且產物還在 → recorded_inline(outcome=duplicate)', async () => {
    mocks.recordItemReceipt.mockResolvedValue('DUPLICATE_REQUEST');
    mocks.findDuplicateOutcome.mockResolvedValue('alive');
    const state = await recordItemReceiptAction(IDLE, formData({ [RCPT_INLINE_FIELD]: '1' }));
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(state.status === 'recorded_inline' && state.outcome).toBe('duplicate');
  });

  // 🔴 產物已被刪那條**不因彈窗模式而變成功** —— 它是本片最不能說謊的一格。
  it('🔴 彈窗模式 DUPLICATE 但產物已刪 → 仍是 failed,不是 recorded_inline', async () => {
    mocks.recordItemReceipt.mockResolvedValue('DUPLICATE_REQUEST');
    mocks.findDuplicateOutcome.mockResolvedValue('deleted');
    const state = await recordItemReceiptAction(IDLE, formData({ [RCPT_INLINE_FIELD]: '1' }));
    expect(state.status === 'failed' && state.code).toBe('DUPLICATE_DELETED');
  });

  // 🔴 fail-closed:旗標形狀不對一律當列表模式(走既有且已審過的 redirect 路)。
  it.each([
    ['值不是 1', '0'],
    ['空字串', ''],
  ])('inline 旗標 %s ⇒ 當列表模式、照舊 redirect', async (_label, raw) => {
    expect(await runExpectingRedirect(formData({ [RCPT_INLINE_FIELD]: raw }))).toContain(
      RECEIPT_RECORDED_RESULT_CODE,
    );
  });

  it('inline 送兩份 ⇒ 當列表模式、照舊 redirect(不因送兩份而取得例外待遇)', async () => {
    const fd = formData({ [RCPT_INLINE_FIELD]: '1' });
    fd.append(RCPT_INLINE_FIELD, '1');
    expect(await runExpectingRedirect(fd)).toContain(RECEIPT_RECORDED_RESULT_CODE);
  });
});

// ── #352-b-2 I1:新 server action 的三道閘各自要有守門 ──────────────────
//
// 🔴 這支吐的是**供應商身分**(`service_role only` 的內部資料)⇒ 它的「讀」不比「寫」鬆:
//    沒有歸屬閘的話,它就是一支「給我任意品項的供應商」的查詢。
describe('fetchItemProcurementChoices — 三道閘', () => {
  const ROWS = [
    { procurementId: 'p-1', supplierLabel: 'RPM', allocatedQuantity: 3, receivedQuantity: 1 },
  ];

  it('正常路徑:兩道閘都過 → 回採購列', async () => {
    mocks.listProcurementChoices.mockResolvedValue(ROWS);
    await expect(fetchItemProcurementChoices(ORDER_ID, ITEM_ID)).resolves.toEqual(ROWS);
  });

  // 🔴 突變靶:拿掉授權閘 ⇒ 這格紅。
  it('🔴 未授權 → null,而且**一次 DB 都不查**', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    await expect(fetchItemProcurementChoices(ORDER_ID, ITEM_ID)).resolves.toBeNull();
    expect(mocks.findOrderIdForItem).not.toHaveBeenCalled();
    expect(mocks.listProcurementChoices).not.toHaveBeenCalled();
  });

  // 🔴 突變靶:拿掉歸屬閘 ⇒ 這格紅。沒有它 = 拿別張單的品項 id 就能問出供應商。
  it('🔴 品項不屬於這張單 → null,且不吐任何採購列', async () => {
    mocks.findOrderIdForItem.mockResolvedValue('99999999-9999-4999-8999-999999999999');
    await expect(fetchItemProcurementChoices(ORDER_ID, ITEM_ID)).resolves.toBeNull();
    expect(mocks.listProcurementChoices).not.toHaveBeenCalled();
  });

  it('查無品項 → null(fail-closed,不是當成沒有採購列)', async () => {
    mocks.findOrderIdForItem.mockResolvedValue(null);
    await expect(fetchItemProcurementChoices(ORDER_ID, ITEM_ID)).resolves.toBeNull();
    expect(mocks.listProcurementChoices).not.toHaveBeenCalled();
  });

  it('查詢炸掉 → null(不把例外往上丟給 client 元件)', async () => {
    mocks.listProcurementChoices.mockRejectedValue(new Error('boom'));
    await expect(fetchItemProcurementChoices(ORDER_ID, ITEM_ID)).resolves.toBeNull();
  });

  // 🔴 `[]` 與 `null` **必須分得出來**:前者=真的沒有採購列(去建一筆),
  //    後者=被拒或失敗(重試/找工程)。合併成一個值會讓彈窗對員工說錯話。
  it('🔴 沒有採購列回 [](不是 null)—— 兩者語意不可合併', async () => {
    mocks.listProcurementChoices.mockResolvedValue([]);
    await expect(fetchItemProcurementChoices(ORDER_ID, ITEM_ID)).resolves.toEqual([]);
  });
});

// ── 「改軟」線片 1:撤銷到貨的四道閘 ───────────────────────────────────
describe('undoItemReceiptAction — 閘序與結果分派', () => {
  const OWNER = '11111111-1111-4111-8111-111111111111';

  function undoForm(over: Record<string, string> = {}) {
    const fd = new FormData();
    fd.set(RCPT_ORDER_ID_FIELD, OWNER);
    fd.set(RCPT_ORDER_ITEM_ID_FIELD, 'i-1');
    fd.set(RCPT_REQUEST_ID_FIELD, 'k-consumed');
    for (const [k, v] of Object.entries(over)) fd.set(k, v);
    return fd;
  }

  function ok() {
    mocks.authorizeAdminMutation.mockResolvedValue({ actorId: 'staff-1', sid: 's-1' });
    mocks.getRequestId.mockResolvedValue('http-req-1');
    mocks.findOrderIdForItem.mockResolvedValue(OWNER);
    mocks.findReceiptIdByRequestId.mockResolvedValue('r-1');
    mocks.findOrderItemIdForReceipt.mockResolvedValue('i-1');
  }

  it('🔴 未授權 → denied,而且**一個 byte 都不送 RPC**(授權閘絕對第一)', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    const out = await undoItemReceiptAction({ status: 'idle' }, undoForm());
    expect(out.status).toBe('failed');
    expect(mocks.deleteItemReceipt).not.toHaveBeenCalled();
    expect(mocks.findReceiptIdByRequestId, '未授權卻已經去查冪等帳了').not.toHaveBeenCalled();
  });

  // ⚠️ 這道閘守的範圍**比登錄路徑窄**:它只證「表單送來的 item 屬於這張單」,
  //    沒有證「被刪的那筆 receipt 屬於這個 item」(receipt id 是冪等鍵反查來的)。
  //    殘餘風險已寫進 action 的 docstring 與 commit body,不在這格假裝守到了。
  it('🔴🔴 品項不屬於這張單 → 拒撤,不送 RPC(撤銷也是寫入路徑,閘不放寬)', async () => {
    ok();
    mocks.findOrderIdForItem.mockResolvedValue('99999999-9999-4999-8999-999999999999');
    const out = await undoItemReceiptAction({ status: 'idle' }, undoForm());
    expect(out).toMatchObject({ status: 'failed', code: 'bug' });
    expect(mocks.deleteItemReceipt).not.toHaveBeenCalled();
  });

  it('🔴🔴 **被刪的那筆不屬於這個品項 → 拒刪**(第二道歸屬,鐵則 12② 不降級)', async () => {
    // 🔴 這道閘擋的是「receipt id 由 client 送來的冪等鍵反查」這條路:上一版沒有它,
    //    真正撐住的是「鍵猜不到 + 有 SSO」兩個**本檔管不到的外部條件**,而它們破了不會有格轉紅。
    // 🔴 **對不起來與查不到放同一格**:兩者是**同一道閘**的兩半(`=== null || !==`)⇒
    //    拆兩格的話拿掉那道閘會紅兩格,而「恰 1 紅」才證得出這格對準的就是它。
    ok();
    for (const owner of ['i-OTHER', null]) {
      mocks.deleteItemReceipt.mockClear();
      mocks.findOrderItemIdForReceipt.mockResolvedValue(owner);
      const out = await undoItemReceiptAction({ status: 'idle' }, undoForm());
      expect(out, `owner=${String(owner)}`).toMatchObject({ status: 'failed', code: 'bug' });
      expect(mocks.deleteItemReceipt, '不屬於這個品項卻已經把刪除送出去了').not.toHaveBeenCalled();
    }
  });

  it('🔴 第二道歸屬**查詢本身炸掉** → error 且不刪(這格對準 try/catch,不是那道 if)', async () => {
    ok();
    mocks.deleteItemReceipt.mockClear();
    mocks.findOrderItemIdForReceipt.mockRejectedValue(new Error('boom'));
    expect(await undoItemReceiptAction({ status: 'idle' }, undoForm())).toMatchObject({
      status: 'failed',
      code: 'error',
    });
    expect(mocks.deleteItemReceipt).not.toHaveBeenCalled();
  });

  it('🔴 冪等鍵查無產物 → bug,不是 already_gone(別謊稱「本來有、現在沒了」)', async () => {
    ok();
    mocks.findReceiptIdByRequestId.mockResolvedValue(null);
    const out = await undoItemReceiptAction({ status: 'idle' }, undoForm());
    expect(out).toMatchObject({ status: 'failed', code: 'bug' });
    expect(mocks.deleteItemReceipt).not.toHaveBeenCalled();
  });

  it('🔴🔴 P4A03 的訊息**原文往上帶**,不改寫、不截短(硬條款)', async () => {
    ok();
    const msg = '刪不掉這筆到貨紀錄:…\n尚未出貨的包裹:\n  K7X2MP:1 件\n  M3QQ8Z:1 件\n要先把那些包裹作廢…';
    mocks.deleteItemReceipt.mockResolvedValue({ kind: 'blocked', message: msg });
    const out = await undoItemReceiptAction({ status: 'idle' }, undoForm());
    expect(out).toEqual({ status: 'blocked', message: msg });
  });

  it('DELETED → undone;ALREADY_DELETED / RECEIPT_NOT_FOUND → already_gone', async () => {
    ok();
    mocks.deleteItemReceipt.mockResolvedValue({ kind: 'code', code: 'DELETED' });
    expect((await undoItemReceiptAction({ status: 'idle' }, undoForm())).status).toBe('undone');
    for (const code of ['ALREADY_DELETED', 'RECEIPT_NOT_FOUND']) {
      mocks.deleteItemReceipt.mockResolvedValue({ kind: 'code', code });
      expect((await undoItemReceiptAction({ status: 'idle' }, undoForm())).status).toBe(
        'already_gone',
      );
    }
  });

  it('🔴 例外路徑也要 revalidate(RPC 可能已 commit、回應斷在路上)', async () => {
    ok();
    mocks.revalidatePath.mockClear();
    mocks.deleteItemReceipt.mockRejectedValue(new Error('boom'));
    const out = await undoItemReceiptAction({ status: 'idle' }, undoForm());
    expect(out).toMatchObject({ status: 'failed', code: 'error' });
    expect(mocks.revalidatePath, '不重取 ⇒ 員工停在一個數字其實已經變了的畫面').toHaveBeenCalled();
  });

  it('🔴 `ReceiptCallerBugError` 分到 bug、不分到 error(兩者對員工的下一步不同)', async () => {
    ok();
    mocks.deleteItemReceipt.mockRejectedValue(new ReceiptCallerBugError('契約違反'));
    const out = await undoItemReceiptAction({ status: 'idle' }, undoForm());
    expect(out).toMatchObject({ status: 'failed', code: 'bug' });
  });

  it('🔴 撤銷送的 `p_request_id` 是 HTTP request id、不是表單那把冪等鍵', async () => {
    // 🔴 那支的 `p_request_id` 不用於冪等判斷(`20260810233000:283`)⇒ 沿用表單鍵會讓稽核指向錯的請求。
    ok();
    mocks.deleteItemReceipt.mockResolvedValue({ kind: 'code', code: 'DELETED' });
    await undoItemReceiptAction({ status: 'idle' }, undoForm());
    expect(mocks.deleteItemReceipt).toHaveBeenCalledWith({
      receiptId: 'r-1',
      actor: 'staff-1',
      requestId: 'http-req-1',
    });
  });
});
