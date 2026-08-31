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
  // 🔴 `#890` 片4:server 閘 ④-b 會讀帳本 + 更正紀錄。
  //    **預設 = 零帳本列** ⇒ 那道閘直接放過 ⇒ 本檔既有每一格行為一個字不變。
  listOrderRefunds: vi.fn(),
  findEffectiveVerdicts: vi.fn(),
}));
vi.mock('./refund-read', () => ({ listOrderRefunds: mocks.listOrderRefunds }));
vi.mock('./refund-correction-read', () => ({
  findEffectiveVerdicts: mocks.findEffectiveVerdicts,
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
import { RefundCapGuardError } from './refund-repository';
import {
  refundFailure,
  EMPTY_REFUND_INPUT,
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
  mocks.listOrderRefunds.mockResolvedValue({ rows: [], truncated: false });
  mocks.findEffectiveVerdicts.mockResolvedValue(new Map());
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
    // 🔴 抽成具名常數才釘得住分母。**這個 3 是分母** ——
    //    拿掉其中一種錯誤 ⇒ 迴圈只是少跑一格而不會說,而那一種從此沒有人守。
    //    要改它,先問:**那個錯誤形狀是不是真的不會再出現了?**
    const errors = [
      new Error('TapPay refund HTTP 500(狀態未知、不得自動重發)'),
      new Error('TimeoutError'),
      new Error('TapPay refund 未實證回應碼 6002'),
    ];
    expect(errors).toHaveLength(3);
    for (const error of errors) {
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

// ⛔ ~~describe('#445 步 6b 超退閘 → state(blocked_by 三分;445b 才會吐)')~~
// 🔴 **2026-08-31 改寫,而不是刪(`⟦b4-EXCEEDSDEAD⟧` 甲案)** ——
//    原本它從 RPC 的 `REFUND_EXCEEDS_REMAINING` 進去,而那個碼 DB 從來沒有回過。
// 🔵 **而它守的東西【仍然活著】**:那三句訊息各自要帶對「下一步該做什麼」。
//    ⇒ 📌 **所以刪的是【路】,不是【它在守的那件事】** —— 改成走今天真的那條路(PCM04/05)。
describe('超額三句話 → state(而它們今天走的是 445b 的 PCM 碼,不是 RPC 回傳碼)', () => {
  // 🔴 這張表釘的是「每一句該叫員工做的那個動作」——
  //    第一版只斷言 `new Set(messages).size === 3`,而那是**恆綠的**:
  //    把兩句的操作指示對調、或三句全改成錯的「錢已動」,size 仍是 3。
  const ACTION_ANCHOR: Record<string, string> = {
    exceeds_remaining: '降低金額',
    exceeds_unknown: '通知系統維護',
  };
  const CASES: [string, keyof typeof ACTION_ANCHOR][] = [
    ['PCM04', 'exceeds_remaining'],
    ['PCM05', 'exceeds_unknown'],
  ];

  it.each(CASES)('%s → %s,而那句話要帶對「下一步該做什麼」', async (sqlstate, stateCode) => {
    mocks.initiateOrderRefund.mockRejectedValue(new RefundCapGuardError(sqlstate as never, '擋下'));
    const state = (await initiateRefundAction(IDLE, refundForm())) as {
      code: string;
      message: string;
      requestToken: string;
    };
    expect(state).toMatchObject({ status: 'failed', code: stateCode, requestToken: TOKEN });
    expect(state.message).toContain(ACTION_ANCHOR[stateCode]);
    // 三句都必須說明錢沒有動 —— 動錢路徑的人因防線(檔頭鐵律)
    expect(state.message).toContain('錢沒有動');
    // 措辭鐵律:禁語一個都不准出現(與來源無關)
    expect(state.message).not.toMatch(/還能退|剩餘可退/);
    // 🔴 純文字輸出,不得混 Markdown(員工會看到字面星號)
    expect(state.message).not.toContain('**');
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it('🔴 `exceeds_in_flight` 今天【沒有任何產生者】—— 而它的訊息仍然要守住那三條措辭鐵律', () => {
    // 🔴 **codex 對抗審查 must-fix 2 質疑這一格**:「新增測試反而保護一個不可達訊息」。
    //    ✅ **保留,而理由要寫出來**:它驗的不是「這條路走得到」,是**那句話的措辭**——
    //       而措辭鐵律(`refund-ledger-view.ts:4-8`)的存在理由與可達性無關。
    //    🔵 它今天是**留著的空位**(`445b` 只做 `BEFORE INSERT`,在途那種未來可能要它),
    //       不是遺留死碼 —— ⚠️ **而兩者在 code 上長得一樣,差別只在這段字。**
    //    🛑 **⇒ 若將來判定它永遠不會有產生者 ⇒ 連它跟這一格一起刪,不要只刪測試。**
    // 當場量:`'exceeds_in_flight'` 在 lib/payment 的非 state、非測試檔 ⇒ **0 處**
    //   (🔵 正對照 `'exceeds_remaining'` ⇒ 1 處 = CAP_GUARD_FAILURE_CODE 的 PCM04)
    // ⇒ 📌 **它是第三個「寫好了而沒有路走到它」的碼** —— 而我【不刪它】:
    //    它與另外兩句是同一組措辭,刪掉會讓那一組只剩兩句而看不出來少了什麼。
    //    ⚠️ 而「沒有產生者」這件事寫在這裡,免得下一個人以為它在用。
    // 🔵 走 `refundFailure`(已 export)而不是把 `FAILURE_MESSAGES` 開出來 ——
    //    **不為了一格測試把內部表變成公開 API。**
    const msg = (
      refundFailure('exceeds_in_flight', EMPTY_REFUND_INPUT, TOKEN) as { message: string }
    ).message;
    expect(msg).toContain('退款紀錄');
    expect(msg).toContain('錢沒有動');
    expect(msg).not.toMatch(/還能退|剩餘可退/);
    expect(msg).not.toContain('**');
  });
});
