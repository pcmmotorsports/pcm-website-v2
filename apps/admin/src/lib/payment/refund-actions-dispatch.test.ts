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

import { TapPayRefundNotSentError } from '@pcm/domain';
import { initiateRefundAction } from './refund-actions';
import {
  REFUND_AMOUNT_FIELD,
  REFUND_CONFIRM_FIELD,
  REFUND_KIND_FIELD,
  REFUND_ORDER_ID_FIELD,
  REFUND_REASON_FIELD,
  REFUND_REQUEST_TOKEN_FIELD,
  REFUND_SUBMITTED_RESULT_CODE,
  isRefundRequestToken,
  type RefundActionState,
} from './refund-action-state';

// refund-actions-dispatch.test.ts — RW2c:refund() 之後的分派矩陣(plan §3 表逐列)
// + token 三種去向。閘門/G0/initiate 面在 refund-actions.test.ts。

const ORDER_ID = '11111111-2222-3333-4444-555555555555';
const TOKEN = '9f8e7d6c-5b4a-4321-a987-654321fedcba';
const REC = 'D20260803TESTrec';
const REFUND_ROW_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const DETAIL = `/orders/${ORDER_ID}`;
const IDLE: RefundActionState = { status: 'idle', requestToken: TOKEN };

function refundForm(over: Record<string, string> = {}, omit: string[] = []): FormData {
  const data = new FormData();
  const fields: Record<string, string> = {
    [REFUND_ORDER_ID_FIELD]: ORDER_ID,
    [REFUND_REQUEST_TOKEN_FIELD]: TOKEN,
    [REFUND_KIND_FIELD]: 'partial',
    [REFUND_AMOUNT_FIELD]: '500',
    [REFUND_CONFIRM_FIELD]: '0087',
    [REFUND_REASON_FIELD]: '客人取消訂單',
    ...over,
  };
  for (const [name, value] of Object.entries(fields)) {
    if (!omit.includes(name)) data.set(name, value);
  }
  return data;
}

function fullForm(): FormData {
  return refundForm({ [REFUND_KIND_FIELD]: 'full' }, [REFUND_AMOUNT_FIELD]);
}

let savedFlag: string | undefined;

beforeEach(() => {
  savedFlag = process.env.REFUND_UI_ENABLED;
  process.env.REFUND_UI_ENABLED = '1';
  mocks.authorizeAdminMutation.mockResolvedValue({ sid: 'sid-1', actorId: 'sean' });
  mocks.getRequestId.mockResolvedValue('req_http-side-id');
  mocks.getTapPayAdapter.mockReturnValue({ recordQuery: mocks.recordQuery, refund: mocks.refund });
  mocks.findOrderForRefund.mockResolvedValue({
    displayId: '250087',
    paymentStatus: 'paid',
    tappayRecTradeId: REC,
  });
  mocks.recordQuery.mockResolvedValue({
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
      },
    ],
  });
  mocks.initiateOrderRefund.mockResolvedValue({
    result: 'INITIATED',
    refundId: REFUND_ROW_ID,
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
    throw new Error('NEXT_REDIRECT');
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

describe('refund() payload(逐欄 toEqual;多欄/漏欄轉紅)', () => {
  it('🔴 partial:amount=Money(凍結額=initiate 回值)、transactionId=訂單的 rec', async () => {
    await expect(initiateRefundAction(IDLE, refundForm())).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.refund).toHaveBeenCalledExactlyOnceWith({
      kind: 'partial',
      transactionId: REC,
      amount: { amount: 500, currency: 'TWD' },
      bankRefundId: 'bk1234567890',
    });
  });

  it('🔴 full:**不帶 amount 鍵**(帶了=在 TapPay 端變部分退;toEqual 精確比對)', async () => {
    mocks.initiateOrderRefund.mockResolvedValue({
      result: 'INITIATED',
      refundId: REFUND_ROW_ID,
      bankRefundId: 'bk1234567890',
      refundAmount: 600,
    });
    await expect(initiateRefundAction(IDLE, fullForm())).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.refund).toHaveBeenCalledExactlyOnceWith({
      kind: 'full',
      transactionId: REC,
      bankRefundId: 'bk1234567890',
    });
  });
});

describe('accepted 分派(§3 表第 1-2 列)', () => {
  it('🔴 金額相符 → finalize(accepted, wire 值)→ FINALIZED → redirect 成功頁(在 try 之外)', async () => {
    await expect(initiateRefundAction(IDLE, refundForm())).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.finalizeOrderRefund).toHaveBeenCalledExactlyOnceWith({
      refundId: REFUND_ROW_ID,
      outcome: 'accepted',
      tappayRefundId: 'DR20260804abc',
      refundAmountWire: 500,
      failedDetail: null,
      actor: 'sean',
      requestId: TOKEN,
    });
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(
      `${DETAIL}?r=${REFUND_SUBMITTED_RESULT_CODE}`,
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(DETAIL);
  });

  it('🔴 金額不符(RPC 判)→ HELD_AMOUNT_MISMATCH → held、不 redirect、token 原樣', async () => {
    mocks.finalizeOrderRefund.mockResolvedValue({
      result: 'HELD_AMOUNT_MISMATCH',
      statusAfter: 'processing',
      paymentStatusAfter: 'paid',
    });
    const state = await initiateRefundAction(IDLE, refundForm());
    expect(state).toMatchObject({ code: 'held', requestToken: TOKEN });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('accepted 後 finalize 回 REFUND_NOT_FOUND → bug(合約漂移)', async () => {
    mocks.finalizeOrderRefund.mockResolvedValue({ result: 'REFUND_NOT_FOUND' });
    await expect(initiateRefundAction(IDLE, refundForm())).resolves.toMatchObject({ code: 'bug' });
  });

  it('🔴 accepted 後 finalize 拋錯 → unknown_state(錢已受理、勿重試;token 原樣)', async () => {
    mocks.finalizeOrderRefund.mockRejectedValue(new Error('db gone'));
    const state = await initiateRefundAction(IDLE, refundForm());
    expect(state).toMatchObject({ code: 'unknown_state', requestToken: TOKEN });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe('deferred / rejected / not_sent 分派(§3 表第 3-5 列;token 換新)', () => {
  it('🔴 deferred(10024)→ finalize(deferred_not_captured, 全 null)→ deferred、**新 token**', async () => {
    mocks.refund.mockResolvedValue({ status: 'deferred', wireStatus: 10024, msg: 'not captured', rawResponse: {} });
    const state = await initiateRefundAction(IDLE, refundForm());
    expect(mocks.finalizeOrderRefund).toHaveBeenCalledExactlyOnceWith({
      refundId: REFUND_ROW_ID,
      outcome: 'deferred_not_captured',
      tappayRefundId: null,
      refundAmountWire: null,
      failedDetail: null,
      actor: 'sean',
      requestId: TOKEN,
    });
    expect(state).toMatchObject({ status: 'failed', code: 'deferred' });
    // 🔴 列已終結、token 被 S4 永久消耗 ⇒ 必須換新的(舊的重送會撞 G4 RAISE 變 bug 畫面)
    const failed = state as Extract<RefundActionState, { status: 'failed' }>;
    expect(failed.requestToken).not.toBe(TOKEN);
    expect(isRefundRequestToken(failed.requestToken)).toBe(true);
  });

  it('🔴 rejected(10051)→ finalize(rejected_out_of_range, failed_detail 帶碼)→ rejected、新 token', async () => {
    mocks.refund.mockResolvedValue({ status: 'rejected', wireStatus: 10051, msg: 'out of range', rawResponse: {} });
    const state = await initiateRefundAction(IDLE, refundForm());
    expect(mocks.finalizeOrderRefund.mock.calls[0]?.[0]).toMatchObject({
      outcome: 'rejected_out_of_range',
      tappayRefundId: null,
      refundAmountWire: null,
      failedDetail: expect.stringContaining('10051'),
    });
    const failed = state as Extract<RefundActionState, { status: 'failed' }>;
    expect(failed.code).toBe('rejected');
    expect(failed.requestToken).not.toBe(TOKEN);
  });

  it('🔴 NotSentError → finalize(not_sent, detail=訊息)→ not_sent、新 token(可修正重送=新請求)', async () => {
    mocks.refund.mockRejectedValue(new TapPayRefundNotSentError('amount 非法(未送出)'));
    const state = await initiateRefundAction(IDLE, refundForm());
    expect(mocks.finalizeOrderRefund.mock.calls[0]?.[0]).toMatchObject({
      outcome: 'not_sent',
      failedDetail: expect.stringContaining('amount 非法'),
    });
    const failed = state as Extract<RefundActionState, { status: 'failed' }>;
    expect(failed.code).toBe('not_sent');
    expect(failed.requestToken).not.toBe(TOKEN);
    expect(isRefundRequestToken(failed.requestToken)).toBe(true);
  });

  it('零動錢分支 finalize 拋錯 → finalize_failed(列卡 processing 待 RW4;不是「可重試」)', async () => {
    mocks.refund.mockResolvedValue({ status: 'deferred', wireStatus: 10024, msg: 'nc', rawResponse: {} });
    mocks.finalizeOrderRefund.mockRejectedValue(new Error('db gone'));
    await expect(initiateRefundAction(IDLE, refundForm())).resolves.toMatchObject({
      code: 'finalize_failed',
    });
  });

  it('零動錢分支 finalize 回非 FINALIZED → bug', async () => {
    mocks.refund.mockRejectedValue(new TapPayRefundNotSentError('未送出'));
    mocks.finalizeOrderRefund.mockResolvedValue({ result: 'REFUND_NOT_FOUND' });
    await expect(initiateRefundAction(IDLE, refundForm())).resolves.toMatchObject({ code: 'bug' });
  });
});

describe('🔴 unknown-state 鐵律(§3 表末列;本片最重要的一格)', () => {
  it('refund() 拋非 NotSentError(HTTP 500 / 逾時 / 6002 / 10050 / full 非 0 碼)→ **finalize 零呼叫**、列留 processing、unknown_state、token 原樣', async () => {
    for (const error of [
      new Error('TapPay refund HTTP 500(狀態未知、不得自動重發)'),
      new Error('TimeoutError'),
      new Error('TapPay refund 未實證回應碼 6002'),
    ]) {
      mocks.finalizeOrderRefund.mockClear();
      mocks.refund.mockRejectedValue(error);
      const state = await initiateRefundAction(IDLE, refundForm());
      expect(state).toMatchObject({ code: 'unknown_state', requestToken: TOKEN });
      expect(mocks.finalizeOrderRefund).not.toHaveBeenCalled();
      expect(mocks.redirect).not.toHaveBeenCalled();
    }
  });

  it('🔴 refund() resolve 出**非三態**物件(合約漂移/畸形值)→ 同樣 unknown_state、finalize 零呼叫(關卡2 兩線同抓:誤入 rejected 分支會 finalize→failed+換新 token=雙退窗)', async () => {
    mocks.refund.mockResolvedValue({ status: 'settled', msg: '未來新增的第四態', rawResponse: {} });
    const state = await initiateRefundAction(IDLE, refundForm());
    expect(state).toMatchObject({ code: 'unknown_state', requestToken: TOKEN });
    expect(mocks.finalizeOrderRefund).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe('token 反向釘(關卡2 nit:正向「換新」有格、反向「不得換」也要有)', () => {
  it('finalize_failed(零動錢分支結案失敗)→ token **原樣帶回**(列仍 processing,換新=誤導可重發)', async () => {
    mocks.refund.mockResolvedValue({ status: 'deferred', wireStatus: 10024, msg: 'nc', rawResponse: {} });
    mocks.finalizeOrderRefund.mockRejectedValue(new Error('db gone'));
    await expect(initiateRefundAction(IDLE, refundForm())).resolves.toMatchObject({
      code: 'finalize_failed',
      requestToken: TOKEN,
    });
  });

  it('bug(accepted 後 REFUND_NOT_FOUND / 零動錢分支非預期碼)→ token 原樣帶回', async () => {
    mocks.finalizeOrderRefund.mockResolvedValue({ result: 'REFUND_NOT_FOUND' });
    await expect(initiateRefundAction(IDLE, refundForm())).resolves.toMatchObject({
      code: 'bug',
      requestToken: TOKEN,
    });
    mocks.refund.mockRejectedValue(new TapPayRefundNotSentError('未送出'));
    await expect(initiateRefundAction(IDLE, refundForm())).resolves.toMatchObject({
      code: 'bug',
      requestToken: TOKEN,
    });
  });
});

describe('DUPLICATE_REQUEST 重播(G4 查驗式冪等)', () => {
  it('🔴 前次已 confirmed → 視同成功 redirect;refund() 零呼叫(不重打 TapPay)', async () => {
    mocks.initiateOrderRefund.mockResolvedValue({
      result: 'DUPLICATE_REQUEST',
      refundId: REFUND_ROW_ID,
      bankRefundId: 'bk1234567890',
      refundAmount: 500,
      rowStatus: 'confirmed',
    });
    await expect(initiateRefundAction(IDLE, refundForm())).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(
      `${DETAIL}?r=${REFUND_SUBMITTED_RESULT_CODE}`,
    );
  });

  it('🔴 前次仍 processing → in_flight、**refund() 零呼叫**(wire 發過沒有無從得知;fail-closed 交給 S5+RW4)', async () => {
    mocks.initiateOrderRefund.mockResolvedValue({
      result: 'DUPLICATE_REQUEST',
      refundId: REFUND_ROW_ID,
      bankRefundId: 'bk1234567890',
      refundAmount: 500,
      rowStatus: 'processing',
    });
    const state = await initiateRefundAction(IDLE, refundForm());
    expect(state).toMatchObject({ code: 'in_flight', requestToken: TOKEN });
    expect(mocks.refund).not.toHaveBeenCalled();
  });
});

describe('initiate 業務碼 → state(refund() 全零呼叫)', () => {
  const cases: Array<[string, string]> = [
    ['REFUND_IN_FLIGHT', 'in_flight'],
    ['REFUND_LEDGER_FULL', 'ledger_full'],
    ['ORDER_NOT_FOUND', 'order_not_found'],
    ['ORDER_NOT_REFUNDABLE', 'not_refundable'],
    ['ORDER_NO_CARD_TRANSACTION', 'no_card_transaction'],
    ['REFUND_NOTHING_LEFT', 'nothing_left'],
  ];
  for (const [rpcCode, stateCode] of cases) {
    it(`${rpcCode} → ${stateCode}`, async () => {
      mocks.initiateOrderRefund.mockResolvedValue({ result: rpcCode });
      const state = await initiateRefundAction(IDLE, refundForm());
      expect(state).toMatchObject({ status: 'failed', code: stateCode, requestToken: TOKEN });
      expect(mocks.refund).not.toHaveBeenCalled();
      expect(mocks.redirect).not.toHaveBeenCalled();
    });
  }
});

describe('#445 步 6b 超退閘 → state(blocked_by 三分;445b 才會吐這個碼)', () => {
  // 🔴 三個 blocked_by 值必須映到**三個不同**的 state code —— 它們的處置完全不同
  //    (改金額 / 去處理另一筆 / 停手找人)。壓成同一句話 = §0-E 第 2 條說的「擋得莫名其妙」。
  const cases: Array<[string, string]> = [
    ['amount', 'exceeds_remaining'],
    ['in_flight', 'exceeds_in_flight'],
    ['unknown', 'exceeds_unknown'],
  ];
  for (const [blockedBy, stateCode] of cases) {
    it(`blocked_by=${blockedBy} → ${stateCode}`, async () => {
      mocks.initiateOrderRefund.mockResolvedValue({
        result: 'REFUND_EXCEEDS_REMAINING',
        // 🔴 fixture 要與 repository 的交叉驗一致(`unknown` ⇔ `remaining === null`)——
        //    造一個 repository 根本不會放行的組合,等於在測一個到不了的狀態。
        remaining: blockedBy === 'unknown' ? null : 300,
        blockedBy,
      });
      const state = await initiateRefundAction(IDLE, refundForm());
      expect(state).toMatchObject({ status: 'failed', code: stateCode, requestToken: TOKEN });
      expect(mocks.refund).not.toHaveBeenCalled();
      expect(mocks.redirect).not.toHaveBeenCalled();
    });
  }

  // 🔴 關卡2 nit3:第一版只斷言 `new Set(messages).size === 3` —— **那是恆綠的**:
  //    把 amount 與 in_flight 的操作指示對調、或三句全改成錯的「錢已動」,size 仍是 3。
  //    ⇒ 改成釘每一句**該叫員工做的那個動作**,那才是 §0-E 第 2 條要的判別力。
  const ACTION_ANCHOR: Record<string, string> = {
    exceeds_remaining: '降低金額',
    exceeds_in_flight: '退款紀錄',
    exceeds_unknown: '通知系統維護',
  };
  it('🔴 三句各自帶對「下一步該做什麼」(對調兩句就會紅)', async () => {
    for (const [blockedBy, stateCode] of cases) {
      mocks.initiateOrderRefund.mockResolvedValue({
        result: 'REFUND_EXCEEDS_REMAINING',
        remaining: blockedBy === 'unknown' ? null : 300,
        blockedBy,
      });
      const state = (await initiateRefundAction(IDLE, refundForm())) as { message: string };
      expect(state.message).toContain(ACTION_ANCHOR[stateCode]);
      // 三句都必須說明錢沒有動 —— 動錢路徑的人因防線(檔頭鐵律)
      expect(state.message).toContain('錢沒有動');
      // 措辭鐵律:禁語一個都不准出現(與來源無關)
      expect(state.message).not.toMatch(/還能退|剩餘可退/);
      // 🔴 純文字輸出,不得混 Markdown(關卡2 nit:員工會看到字面星號)
      expect(state.message).not.toContain('**');
    }
  });

  // 🔴 token 專格已刪(關卡2 nit2):上面三個映射格的 `toMatchObject` 已經含
  //    `requestToken: TOKEN`,單獨再寫一格**被嚴格蘊含、零額外訊號** —— 正是本輪
  //    在別人 plan 裡抓了 8 個的那種恆綠格,不能自己再種一個。
});
