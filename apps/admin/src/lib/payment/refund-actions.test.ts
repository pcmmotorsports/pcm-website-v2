import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  authorizeAdminMutation: vi.fn(),
  getRequestId: vi.fn(),
  getTapPayAdapter: vi.fn(),
  findOrderForRefund: vi.fn(),
  initiateOrderRefund: vi.fn(),
  finalizeOrderRefund: vi.fn(),
  recordQuery: vi.fn(),
  refund: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('../session/authorize', () => ({ authorizeAdminMutation: mocks.authorizeAdminMutation }));
vi.mock('../audit/context', () => ({ getRequestId: mocks.getRequestId }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient: vi.fn() }));
// 🔴 只換掉函式,error class 用真的(自己造假 class 會讓「分得開」變自我實現;A9d2-1 慣例)
vi.mock('./composition', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./composition')>();
  return { ...actual, getTapPayAdapter: mocks.getTapPayAdapter };
});
vi.mock('./refund-repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./refund-repository')>();
  return {
    ...actual,
    findOrderForRefund: mocks.findOrderForRefund,
    initiateOrderRefund: mocks.initiateOrderRefund,
    finalizeOrderRefund: mocks.finalizeOrderRefund,
  };
});

// 🔴 解析器與 G0 checker 刻意不 mock —— 餵真 FormData 走真檢查,否則守門斷言恆真。
import { initiateRefundAction } from './refund-actions';
import { RefundCallerBugError } from './refund-repository';
import {
  REFUND_AMOUNT_FIELD,
  REFUND_CONFIRM_FIELD,
  REFUND_KIND_FIELD,
  REFUND_ORDER_ID_FIELD,
  REFUND_REASON_FIELD,
  REFUND_REQUEST_TOKEN_FIELD,
  type RefundActionState,
} from './refund-action-state';

const ORDER_ID = '11111111-2222-3333-4444-555555555555';
const TOKEN = '9f8e7d6c-5b4a-4321-a987-654321fedcba';
const REC = 'D20260803TESTrec';
const DETAIL = `/orders/${ORDER_ID}`;
const IDLE: RefundActionState = { status: 'idle', requestToken: TOKEN };
const REASON = '客人取消訂單,依約定退款';

function refundForm(over: Record<string, string> = {}, omit: string[] = []): FormData {
  const data = new FormData();
  const fields: Record<string, string> = {
    [REFUND_ORDER_ID_FIELD]: ORDER_ID,
    [REFUND_REQUEST_TOKEN_FIELD]: TOKEN,
    [REFUND_KIND_FIELD]: 'partial',
    [REFUND_AMOUNT_FIELD]: '500',
    [REFUND_CONFIRM_FIELD]: '0087',
    [REFUND_REASON_FIELD]: REASON,
    ...over,
  };
  for (const [name, value] of Object.entries(fields)) {
    if (!omit.includes(name)) data.set(name, value);
  }
  return data;
}

const ORDER = { displayId: '250087', paymentStatus: 'paid', tappayRecTradeId: REC };

function recordResult(over: Record<string, unknown> = {}) {
  return {
    queryStatus: 0,
    numberOfTransactions: 1,
    records: [
      {
        recTradeId: REC,
        orderNumber: '250087',
        merchantId: 'PCM_TEST',
        amount: 600,
        currency: 'TWD',
        recordStatus: 1,
        isCaptured: true,
        refundedAmount: 100,
        ...over,
      },
    ],
  };
}

let savedFlag: string | undefined;

beforeEach(() => {
  savedFlag = process.env.REFUND_UI_ENABLED;
  process.env.REFUND_UI_ENABLED = '1';
  mocks.authorizeAdminMutation.mockResolvedValue({ sid: 'sid-1', actorId: 'sean' });
  // 🔴 header id 與表單 token **刻意不同值**:斷言 RPC 收到的是 token 不是 header
  //    (A9d2-1 H9/F1:兩者 mock 成同值的話,「冪等鍵接錯來源」恆綠)。
  mocks.getRequestId.mockResolvedValue('req_http-side-id');
  mocks.getTapPayAdapter.mockReturnValue({ recordQuery: mocks.recordQuery, refund: mocks.refund });
  mocks.findOrderForRefund.mockResolvedValue({ ...ORDER });
  mocks.recordQuery.mockResolvedValue(recordResult());
  mocks.initiateOrderRefund.mockResolvedValue({
    result: 'INITIATED',
    refundId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    bankRefundId: 'bk1234567890',
    refundAmount: 500,
  });
  mocks.refund.mockResolvedValue({
    status: 'accepted',
    refundId: 'DR20260804abc',
    refundAmount: 500,
    bankRefundId: 'bk1234567890',
    rawResponse: {},
  });
  mocks.finalizeOrderRefund.mockResolvedValue({
    result: 'FINALIZED',
    statusAfter: 'confirmed',
    paymentStatusAfter: 'partiallyRefunded',
  });
  mocks.redirect.mockImplementation(() => {
    throw new Error('NEXT_REDIRECT'); // 真 redirect 是拋;不拋的話「包進 try」的突變殺不掉
  });
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  if (savedFlag === undefined) {
    delete process.env.REFUND_UI_ENABLED;
  } else {
    process.env.REFUND_UI_ENABLED = savedFlag;
  }
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('initiateRefundAction — 閘門順序', () => {
  it('未授權 → denied、全下游零呼叫、input 空(授權閘在讀表單之前的已知代價)', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    const state = await initiateRefundAction(IDLE, refundForm());
    expect(state).toMatchObject({
      status: 'failed',
      code: 'denied',
      input: { kind: '', amount: '', reason: '', confirmCode: '' },
    });
    expect(mocks.findOrderForRefund).not.toHaveBeenCalled();
    expect(mocks.recordQuery).not.toHaveBeenCalled();
    expect(mocks.initiateOrderRefund).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('🔴 未授權時根本不碰表單(get() 會爆的地雷 FormData 仍平安回 denied)', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    const landmine = {
      get() {
        throw new Error('表單不該被碰到');
      },
    } as unknown as FormData;
    await expect(initiateRefundAction(IDLE, landmine)).resolves.toMatchObject({ code: 'denied' });
  });

  it('🔴 REFUND_UI_ENABLED 非 "1" → disabled(action 自己就是閘;藏按鈕擋不住直接 POST)', async () => {
    for (const value of [undefined, '', '0', 'true', 'on']) {
      if (value === undefined) {
        delete process.env.REFUND_UI_ENABLED;
      } else {
        process.env.REFUND_UI_ENABLED = value;
      }
      const state = await initiateRefundAction(IDLE, refundForm());
      expect(state).toMatchObject({ status: 'failed', code: 'disabled' });
    }
    expect(mocks.findOrderForRefund).not.toHaveBeenCalled();
    expect(mocks.initiateOrderRefund).not.toHaveBeenCalled();
  });

  it('解析失敗 → invalid、訂單重讀零呼叫、輸入原樣帶回(Q1=A)', async () => {
    const state = await initiateRefundAction(
      IDLE,
      refundForm({ [REFUND_AMOUNT_FIELD]: '-5' }),
    );
    expect(state).toMatchObject({
      status: 'failed',
      code: 'invalid',
      input: { kind: 'partial', amount: '-5', reason: REASON, confirmCode: '0087' },
      requestToken: TOKEN,
    });
    expect(mocks.findOrderForRefund).not.toHaveBeenCalled();
  });
});

describe('initiateRefundAction — server 重讀訂單(app 層縱深)', () => {
  it('重讀失敗 → error(token 原樣;錢沒動、可同表單重試)、Record 零呼叫', async () => {
    mocks.findOrderForRefund.mockRejectedValue(new Error('db down'));
    const state = await initiateRefundAction(IDLE, refundForm());
    expect(state).toMatchObject({ code: 'error', requestToken: TOKEN });
    expect(mocks.recordQuery).not.toHaveBeenCalled();
  });

  it('查無訂單 → order_not_found', async () => {
    mocks.findOrderForRefund.mockResolvedValue(null);
    await expect(initiateRefundAction(IDLE, refundForm())).resolves.toMatchObject({
      code: 'order_not_found',
    });
  });

  it('🔴 確認碼 ≠ 訂單號末 4 碼 → confirm_mismatch、TapPay 零接觸(Q2=A server 端驗)', async () => {
    const state = await initiateRefundAction(IDLE, refundForm({ [REFUND_CONFIRM_FIELD]: '9999' }));
    expect(state).toMatchObject({ code: 'confirm_mismatch', input: { confirmCode: '9999' } });
    expect(mocks.getTapPayAdapter).not.toHaveBeenCalled();
    expect(mocks.recordQuery).not.toHaveBeenCalled();
  });

  it('舊制單號(PCM-YYYY-NNNN)的末 4 碼一樣可過(比對對象=display_id 字串末 4 字元)', async () => {
    mocks.findOrderForRefund.mockResolvedValue({ ...ORDER, displayId: 'PCM-2026-0087' });
    await expect(initiateRefundAction(IDLE, refundForm())).rejects.toThrow('NEXT_REDIRECT');
  });

  it('🔴 payment_status=refunded → already_refunded 硬擋(Q1=A;RPC G12 之外的 app 鏡像)', async () => {
    mocks.findOrderForRefund.mockResolvedValue({ ...ORDER, paymentStatus: 'refunded' });
    await expect(initiateRefundAction(IDLE, refundForm())).resolves.toMatchObject({
      code: 'already_refunded',
    });
    expect(mocks.recordQuery).not.toHaveBeenCalled();
  });

  it('無 tappay_rec_trade_id(null / 空白)→ no_card_transaction', async () => {
    for (const rec of [null, '  ']) {
      mocks.findOrderForRefund.mockResolvedValue({ ...ORDER, tappayRecTradeId: rec });
      await expect(initiateRefundAction(IDLE, refundForm())).resolves.toMatchObject({
        code: 'no_card_transaction',
      });
    }
  });
});

describe('initiateRefundAction — 設定錯 vs transient(N4 前置債)', () => {
  it('🔴 TapPayConfigError → config(「找管理者」,不是「請重試」)、Record/RPC 零呼叫', async () => {
    const { TapPayConfigError } = await import('./composition');
    mocks.getTapPayAdapter.mockImplementation(() => {
      // 訊息不寫 env 字面 —— wiring 掃描守門連測試檔一起掃(大寫 env 名只准出現在 composition)
      throw new TapPayConfigError('缺少必要環境變數(測試替身)');
    });
    const state = await initiateRefundAction(IDLE, refundForm());
    expect(state).toMatchObject({ code: 'config' });
    expect(mocks.recordQuery).not.toHaveBeenCalled();
    expect(mocks.initiateOrderRefund).not.toHaveBeenCalled();
  });

  it('adapter 建構拋裸 Error → error(不誤標成設定錯)', async () => {
    mocks.getTapPayAdapter.mockImplementation(() => {
      throw new Error('boom');
    });
    await expect(initiateRefundAction(IDLE, refundForm())).resolves.toMatchObject({ code: 'error' });
  });
});

describe('initiateRefundAction — G0 baseline(真 checker、假 Record 資料)', () => {
  it('recordQuery 失敗/逾時 → record_unavailable、RPC 零呼叫(fail-closed;錢沒動)', async () => {
    mocks.recordQuery.mockRejectedValue(new Error('TimeoutError'));
    await expect(initiateRefundAction(IDLE, refundForm())).resolves.toMatchObject({
      code: 'record_unavailable',
      requestToken: TOKEN,
    });
    expect(mocks.initiateOrderRefund).not.toHaveBeenCalled();
  });

  it('🔴 recordQuery 收到 recTradeId 且**帶 AbortSignal**(RW2b 契約債:port 預設無逾時)', async () => {
    await expect(initiateRefundAction(IDLE, refundForm())).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.recordQuery).toHaveBeenCalledExactlyOnceWith(
      { recTradeId: REC },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('record_status=3(已退畢)→ record_state_bad、RPC 零呼叫', async () => {
    mocks.recordQuery.mockResolvedValue(recordResult({ recordStatus: 3 }));
    await expect(initiateRefundAction(IDLE, refundForm())).resolves.toMatchObject({
      code: 'record_state_bad',
    });
    expect(mocks.initiateOrderRefund).not.toHaveBeenCalled();
  });

  it('🔴 refunded_amount 欄缺 → record_shape_bad、RPC 零呼叫(嚴禁 ?? 0;G0 ③)', async () => {
    mocks.recordQuery.mockResolvedValue(recordResult({ refundedAmount: undefined }));
    await expect(initiateRefundAction(IDLE, refundForm())).resolves.toMatchObject({
      code: 'record_shape_bad',
    });
    expect(mocks.initiateOrderRefund).not.toHaveBeenCalled();
  });

  it('full × Record amount=0 → nothing_left、RPC 零呼叫', async () => {
    mocks.recordQuery.mockResolvedValue(recordResult({ amount: 0 }));
    await expect(
      initiateRefundAction(IDLE, refundForm({ [REFUND_KIND_FIELD]: 'full' }, [REFUND_AMOUNT_FIELD])),
    ).resolves.toMatchObject({ code: 'nothing_left' });
    expect(mocks.initiateOrderRefund).not.toHaveBeenCalled();
  });
});

describe('initiateRefundAction — RPC initiate 參數(深度相等)', () => {
  it('🔴 partial:amount=員工輸入、recordAmount=null、requestId=表單 token(≠ HTTP header id)', async () => {
    await expect(initiateRefundAction(IDLE, refundForm())).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.initiateOrderRefund).toHaveBeenCalledExactlyOnceWith({
      orderId: ORDER_ID,
      kind: 'partial',
      amount: 500,
      recordRefundedBefore: 100,
      recordAmount: null,
      reason: REASON,
      actor: 'sean',
      requestId: TOKEN,
    });
  });

  it('🔴 full:amount=null、recordAmount=Record 剩餘額 600(G3 凍結額來源)', async () => {
    await expect(
      initiateRefundAction(IDLE, refundForm({ [REFUND_KIND_FIELD]: 'full' }, [REFUND_AMOUNT_FIELD])),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.initiateOrderRefund.mock.calls[0]?.[0]).toMatchObject({
      kind: 'full',
      amount: null,
      recordAmount: 600,
      recordRefundedBefore: 100,
    });
  });
});

describe('initiateRefundAction — initiate 錯誤與 revalidate 紀律', () => {
  it('initiate 拋 RefundCallerBugError → bug、refund() 零呼叫、明細頁 revalidate', async () => {
    mocks.initiateOrderRefund.mockRejectedValue(new RefundCallerBugError('契約違反'));
    await expect(initiateRefundAction(IDLE, refundForm())).resolves.toMatchObject({ code: 'bug' });
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith(DETAIL);
  });

  it('🔴 initiate 拋 transient → error 且 **token 原樣帶回**(INSERT 可能已 commit;同表單重試會被 G4 認出)', async () => {
    mocks.initiateOrderRefund.mockRejectedValue(new Error('fetch failed'));
    const state = await initiateRefundAction(IDLE, refundForm());
    expect(state).toMatchObject({ code: 'error', requestToken: TOKEN });
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith(DETAIL);
  });

  it('initiate 之前的失敗不 revalidate(帳本零變化:confirm_mismatch / record_unavailable)', async () => {
    await initiateRefundAction(IDLE, refundForm({ [REFUND_CONFIRM_FIELD]: '9999' }));
    mocks.recordQuery.mockRejectedValue(new Error('down'));
    await initiateRefundAction(IDLE, refundForm());
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe('initiateRefundAction — log 紀律(H11 同型)', () => {
  it('🔴 attempt log:記 reason_length 與雙 id(header + token),**不記 reason 全文**', async () => {
    const info = vi.mocked(console.info);
    await expect(initiateRefundAction(IDLE, refundForm())).rejects.toThrow('NEXT_REDIRECT');
    const attempt = info.mock.calls.find(([tag]) =>
      String(tag).includes('order_refund.initiate.attempt'),
    );
    expect(attempt).toBeDefined();
    const payload = attempt?.[1] as Record<string, unknown>;
    expect(payload).toMatchObject({
      request_id: 'req_http-side-id',
      request_token: TOKEN,
      order_id: ORDER_ID,
      kind: 'partial',
      amount: 500,
      reason_length: [...REASON].length,
    });
    expect(payload).not.toHaveProperty('reason');
    expect(JSON.stringify(payload)).not.toContain(REASON);
  });

  it('🔴 DB error log 不得帶 details / hint(PG DETAIL 會攜整列內容)', async () => {
    const error = Object.assign(new Error('insert failed'), {
      code: '23514',
      details: '整列內容外洩面',
      hint: '不該出現',
    });
    mocks.initiateOrderRefund.mockRejectedValue(error);
    const errorLog = vi.mocked(console.error);
    await initiateRefundAction(IDLE, refundForm());
    const dumped = JSON.stringify(errorLog.mock.calls);
    expect(dumped).not.toContain('整列內容外洩面');
    expect(dumped).not.toContain('不該出現');
    expect(dumped).toContain('23514');
  });
});
