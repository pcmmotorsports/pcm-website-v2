import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (key: string, value: string) => ({
          maybeSingle: () => mocks.maybeSingle({ table, columns, key, value }),
        }),
      }),
    }),
  }),
}));

import {
  FINALIZE_RESULT_CODES,
  INITIATE_RESULT_CODES,
  REFUND_BLOCKED_BY_VALUES,
  RefundCallerBugError,
  RefundFinalizeParseError,
  finalizeOrderRefund,
  finalizeRecoveryOrderRefund,
  findOrderForRefund,
  initiateOrderRefund,
} from './refund-repository';

// refund-repository.test.ts — RW2c:兩支退款 RPC 的呼叫端契約。
// 🔴 P0001/P7Cxx 的 mock 帶真實 PostgrestError 形狀的 `code` 欄(A9d2-1 H6 的教訓:
//    mock 裸 Error 會讓「bug 與 error 分得開」那格恆綠)。

const ORDER_ID = '11111111-2222-3333-4444-555555555555';
const REFUND_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const TOKEN = '9f8e7d6c-5b4a-4321-a987-654321fedcba';

const INITIATE_ARGS = {
  orderId: ORDER_ID,
  kind: 'partial' as const,
  amount: 500,
  recordRefundedBefore: 100,
  recordAmount: null,
  reason: '客人取消',
  actor: 'sean',
  requestId: TOKEN,
};

const FINALIZE_ARGS = {
  refundId: REFUND_ID,
  outcome: 'accepted' as const,
  tappayRefundId: 'DR20260804abc',
  refundAmountWire: 500,
  failedDetail: null,
  actor: 'sean',
  requestId: TOKEN,
};

beforeEach(() => {
  mocks.rpc.mockResolvedValue({ data: { result: 'INITIATED', refund_id: REFUND_ID, bank_refund_id: 'bk1234567890', refund_amount: 500, status: 'processing' }, error: null });
  mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('碼全集常數(與 migration COMMENT 對齊;RW1a `20260803150000:414-416` / `:607`)', () => {
  it('initiate 9 碼(第 9 碼 = #445 步 6b,445b 才會吐)、finalize 3 碼', () => {
    expect(INITIATE_RESULT_CODES).toEqual([
      'INITIATED',
      'DUPLICATE_REQUEST',
      'ORDER_NOT_FOUND',
      'ORDER_NOT_REFUNDABLE',
      'ORDER_NO_CARD_TRANSACTION',
      'REFUND_LEDGER_FULL',
      'REFUND_IN_FLIGHT',
      'REFUND_NOTHING_LEFT',
      'REFUND_EXCEEDS_REMAINING',
    ]);
    expect(FINALIZE_RESULT_CODES).toEqual(['FINALIZED', 'HELD_AMOUNT_MISMATCH', 'REFUND_NOT_FOUND']);
  });

  it('blocked_by 三值(#445 §4-4;新增第 4 值時本格與 EXCEEDS_FAILURE_CODE 一起紅)', () => {
    expect(REFUND_BLOCKED_BY_VALUES).toEqual(['amount', 'in_flight', 'unknown']);
  });
});

describe('initiate — REFUND_EXCEEDS_REMAINING 的形狀驗(#445 步 6b;445b 才會吐)', () => {
  const exceeds = (extra: Record<string, unknown>) =>
    mocks.rpc.mockResolvedValue({
      data: { result: 'REFUND_EXCEEDS_REMAINING', ...extra },
      error: null,
    });

  it('remaining 正整數 + blocked_by=amount ⇒ 收斂成 union', async () => {
    exceeds({ remaining: 300, blocked_by: 'amount' });
    await expect(initiateOrderRefund(INITIATE_ARGS)).resolves.toEqual({
      result: 'REFUND_EXCEEDS_REMAINING',
      remaining: 300,
      blockedBy: 'amount',
    });
  });

  // 🔴 這格擋的是「用 falsy 判斷有沒有拿到數字」——0 是合法上限(已無可退),不是「沒拿到」。
  it('🔴 remaining = 0 是合法值,不得被當成缺值', async () => {
    exceeds({ remaining: 0, blocked_by: 'amount' });
    await expect(initiateOrderRefund(INITIATE_ARGS)).resolves.toEqual({
      result: 'REFUND_EXCEEDS_REMAINING',
      remaining: 0,
      blockedBy: 'amount',
    });
  });

  it('remaining = null(RPC 的 guard 算不出來)⇒ null + blocked_by=unknown', async () => {
    exceeds({ remaining: null, blocked_by: 'unknown' });
    await expect(initiateOrderRefund(INITIATE_ARGS)).resolves.toEqual({
      result: 'REFUND_EXCEEDS_REMAINING',
      remaining: null,
      blockedBy: 'unknown',
    });
  });

  it('🔴 remaining 負值 = 合約漂移 ⇒ 拋,不讓它流進 UI 變成被照著操作的數字', async () => {
    exceeds({ remaining: -1, blocked_by: 'amount' });
    await expect(initiateOrderRefund(INITIATE_ARGS)).rejects.toBeInstanceOf(RefundCallerBugError);
  });

  it('🔴 remaining 非整數 ⇒ 拋', async () => {
    exceeds({ remaining: 12.5, blocked_by: 'amount' });
    await expect(initiateOrderRefund(INITIATE_ARGS)).rejects.toBeInstanceOf(RefundCallerBugError);
  });

  // 🔴 分不出三種情況 = §0-E 第 2 條的「擋得莫名其妙」⇒ 寧可拋,不猜、不降級成「打太多」。
  it('🔴 blocked_by 不認得 ⇒ 拋', async () => {
    exceeds({ remaining: 300, blocked_by: 'because_i_said_so' });
    await expect(initiateOrderRefund(INITIATE_ARGS)).rejects.toBeInstanceOf(RefundCallerBugError);
  });

  it('🔴 blocked_by 缺欄 ⇒ 拋', async () => {
    exceeds({ remaining: 300 });
    await expect(initiateOrderRefund(INITIATE_ARGS)).rejects.toBeInstanceOf(RefundCallerBugError);
  });

  // 🔴 關卡2 MF1:缺欄 ≠ null。第一版把兩者收斂成同一個 null ⇒ 一次協定漂移
  //    會偽裝成一次「算不出來」,而後者是我們會照著顯示給員工的合法狀態。
  it('🔴 remaining **缺欄**(不是 null)⇒ 拋,不得靜默當成 null', async () => {
    exceeds({ blocked_by: 'unknown' });
    await expect(initiateOrderRefund(INITIATE_ARGS)).rejects.toBeInstanceOf(RefundCallerBugError);
  });

  // 🔴 關卡2 MF2:兩欄各自合法 ≠ 組合合法。
  it('🔴 blocked_by=unknown 卻帶得出數字 ⇒ 拋(矛盾組合)', async () => {
    exceeds({ remaining: 300, blocked_by: 'unknown' });
    await expect(initiateOrderRefund(INITIATE_ARGS)).rejects.toBeInstanceOf(RefundCallerBugError);
  });

  it('🔴 blocked_by=amount 卻沒有數字 ⇒ 拋(矛盾組合)', async () => {
    exceeds({ remaining: null, blocked_by: 'amount' });
    await expect(initiateOrderRefund(INITIATE_ARGS)).rejects.toBeInstanceOf(RefundCallerBugError);
  });
});

describe('findOrderForRefund — 窄讀', () => {
  it('🔴 投影恰三欄(display_id / payment_status / tappay_rec_trade_id;不擴顯示層投影)', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { display_id: '250001', payment_status: 'paid', tappay_rec_trade_id: 'D2026rec' },
      error: null,
    });
    const snapshot = await findOrderForRefund(ORDER_ID);
    expect(mocks.maybeSingle).toHaveBeenCalledWith({
      table: 'orders',
      columns: 'display_id, payment_status, tappay_rec_trade_id',
      key: 'id',
      value: ORDER_ID,
    });
    expect(snapshot).toEqual({
      displayId: '250001',
      paymentStatus: 'paid',
      tappayRecTradeId: 'D2026rec',
    });
  });

  it('查無 → null;讀取錯誤 → 原樣拋(呼叫端映 error)', async () => {
    await expect(findOrderForRefund(ORDER_ID)).resolves.toBeNull();
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(findOrderForRefund(ORDER_ID)).rejects.toMatchObject({ message: 'boom' });
  });
});

describe('initiateOrderRefund — 參數逐欄具名(深度相等;加欄/漏欄轉紅)', () => {
  it('partial:p_amount=員工輸入、p_record_amount=null', async () => {
    await initiateOrderRefund(INITIATE_ARGS);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_initiate_order_refund', {
      p_order_id: ORDER_ID,
      p_kind: 'partial',
      p_amount: 500,
      p_record_refunded_before: 100,
      p_record_amount: null,
      p_reason: '客人取消',
      p_actor: 'sean',
      p_request_id: TOKEN,
    });
  });

  it('🔴 full:p_amount=null、p_record_amount=Record 剩餘額(互斥鏡像;弄反=RPC RAISE)', async () => {
    await initiateOrderRefund({ ...INITIATE_ARGS, kind: 'full', amount: null, recordAmount: 600 });
    expect(mocks.rpc.mock.calls[0]?.[1]).toMatchObject({
      p_kind: 'full',
      p_amount: null,
      p_record_amount: 600,
    });
  });
});

describe('initiateOrderRefund — 回傳收斂', () => {
  it('INITIATED:三欄必在、缺任一 = RefundCallerBugError', async () => {
    await expect(initiateOrderRefund(INITIATE_ARGS)).resolves.toEqual({
      result: 'INITIATED',
      refundId: REFUND_ID,
      bankRefundId: 'bk1234567890',
      refundAmount: 500,
    });
    mocks.rpc.mockResolvedValue({ data: { result: 'INITIATED', refund_id: REFUND_ID }, error: null });
    await expect(initiateOrderRefund(INITIATE_ARGS)).rejects.toBeInstanceOf(RefundCallerBugError);
  });

  it('DUPLICATE_REQUEST:帶 rowStatus;status 非 processing/confirmed = bug(G4 合約:終結列是 RAISE 不是 DUPLICATE)', async () => {
    mocks.rpc.mockResolvedValue({
      data: { result: 'DUPLICATE_REQUEST', refund_id: REFUND_ID, bank_refund_id: 'bk1', refund_amount: 500, status: 'confirmed' },
      error: null,
    });
    await expect(initiateOrderRefund(INITIATE_ARGS)).resolves.toMatchObject({
      result: 'DUPLICATE_REQUEST',
      rowStatus: 'confirmed',
    });
    mocks.rpc.mockResolvedValue({
      data: { result: 'DUPLICATE_REQUEST', refund_id: REFUND_ID, bank_refund_id: 'bk1', refund_amount: 500, status: 'deferred' },
      error: null,
    });
    await expect(initiateOrderRefund(INITIATE_ARGS)).rejects.toBeInstanceOf(RefundCallerBugError);
  });

  it('六個業務碼原樣收斂、不帶多餘欄', async () => {
    for (const code of ['ORDER_NOT_FOUND', 'ORDER_NOT_REFUNDABLE', 'ORDER_NO_CARD_TRANSACTION', 'REFUND_LEDGER_FULL', 'REFUND_IN_FLIGHT', 'REFUND_NOTHING_LEFT']) {
      mocks.rpc.mockResolvedValue({ data: { result: code }, error: null });
      await expect(initiateOrderRefund(INITIATE_ARGS)).resolves.toEqual({ result: code });
    }
  });

  it('🔴 未知碼 / null / 非物件 / 陣列 = RefundCallerBugError(不得靜默當任何一種)', async () => {
    for (const data of [{ result: 'WAT' }, { result: null }, null, 'INITIATED', [{ result: 'INITIATED' }]]) {
      mocks.rpc.mockResolvedValue({ data, error: null });
      await expect(initiateOrderRefund(INITIATE_ARGS)).rejects.toBeInstanceOf(RefundCallerBugError);
    }
  });
});

describe('RAISE 分流(真實 PostgrestError 形狀)', () => {
  it('🔴 P0001(RPC RAISE)→ RefundCallerBugError', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'request_id 非法' } });
    await expect(initiateOrderRefund(INITIATE_ARGS)).rejects.toBeInstanceOf(RefundCallerBugError);
  });

  it('🔴 P7Cxx(帳本 trigger 守門)→ RefundCallerBugError(守門被打中=前置沒篩到=停手)', async () => {
    for (const code of ['P7C02', 'P7C15']) {
      mocks.rpc.mockResolvedValue({ data: null, error: { code, message: 'guard' } });
      await expect(finalizeOrderRefund(FINALIZE_ARGS)).rejects.toBeInstanceOf(RefundCallerBugError);
    }
  });

  it('其他錯誤(網路/PostgREST)原樣拋、不得包成 bug(呼叫端要映 error/unknown_state)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST301', message: 'timeout' } });
    await expect(initiateOrderRefund(INITIATE_ARGS)).rejects.toSatisfy(
      (e) => !(e instanceof RefundCallerBugError),
    );
    mocks.rpc.mockResolvedValue({ data: null, error: { message: '無 code 欄' } });
    await expect(finalizeOrderRefund(FINALIZE_ARGS)).rejects.toSatisfy(
      (e) => !(e instanceof RefundCallerBugError),
    );
  });
});

describe('finalizeOrderRefund — 參數與收斂', () => {
  it('accepted:逐欄具名(深度相等)', async () => {
    mocks.rpc.mockResolvedValue({
      data: { result: 'FINALIZED', status_after: 'confirmed', payment_status_after: 'refunded' },
      error: null,
    });
    await expect(finalizeOrderRefund(FINALIZE_ARGS)).resolves.toEqual({
      result: 'FINALIZED',
      statusAfter: 'confirmed',
      paymentStatusAfter: 'refunded',
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_finalize_order_refund', {
      p_refund_id: REFUND_ID,
      p_outcome: 'accepted',
      p_tappay_refund_id: 'DR20260804abc',
      p_refund_amount_wire: 500,
      p_failed_detail: null,
      p_actor: 'sean',
      p_request_id: TOKEN,
    });
  });

  it('HELD_AMOUNT_MISMATCH 帶 after 欄;REFUND_NOT_FOUND 不帶', async () => {
    mocks.rpc.mockResolvedValue({
      data: { result: 'HELD_AMOUNT_MISMATCH', status_after: 'processing', payment_status_after: 'paid' },
      error: null,
    });
    await expect(finalizeOrderRefund(FINALIZE_ARGS)).resolves.toMatchObject({
      result: 'HELD_AMOUNT_MISMATCH',
      statusAfter: 'processing',
    });
    mocks.rpc.mockResolvedValue({ data: { result: 'REFUND_NOT_FOUND' }, error: null });
    await expect(finalizeOrderRefund(FINALIZE_ARGS)).resolves.toEqual({ result: 'REFUND_NOT_FOUND' });
  });

  it('FINALIZED 缺 status_after = RefundCallerBugError;未知碼同', async () => {
    mocks.rpc.mockResolvedValue({ data: { result: 'FINALIZED' }, error: null });
    await expect(finalizeOrderRefund(FINALIZE_ARGS)).rejects.toBeInstanceOf(RefundCallerBugError);
    mocks.rpc.mockResolvedValue({ data: { result: 'DONE' }, error: null });
    await expect(finalizeOrderRefund(FINALIZE_ARGS)).rejects.toBeInstanceOf(RefundCallerBugError);
  });

  it('🔴 型別分岔(codex R2 MF):解析失敗=RefundFinalizeParseError(交易已 commit);RAISE=父類非子類(確定回滾)—— 兩者員工指示相反,型別必須分得開', async () => {
    mocks.rpc.mockResolvedValue({ data: { result: 'FINALIZED' }, error: null });
    await expect(finalizeOrderRefund(FINALIZE_ARGS)).rejects.toBeInstanceOf(
      RefundFinalizeParseError,
    );
    mocks.rpc.mockResolvedValue({ data: { result: 'DONE' }, error: null });
    await expect(finalizeOrderRefund(FINALIZE_ARGS)).rejects.toBeInstanceOf(
      RefundFinalizeParseError,
    );
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'RAISE' } });
    await expect(finalizeOrderRefund(FINALIZE_ARGS)).rejects.toSatisfy(
      (e) => e instanceof RefundCallerBugError && !(e instanceof RefundFinalizeParseError),
    );
  });
});

describe('finalizeRecoveryOrderRefund — RW4 恢復出口(參數矩陣鏡像 RPC 步 2 恢復半邊)', () => {
  it('recovered_confirmed:帶 Portal 真 DR 碼、wire 金額必 null(帶了 RPC 會 RAISE)', async () => {
    mocks.rpc.mockResolvedValue({
      data: { result: 'FINALIZED', status_after: 'confirmed', payment_status_after: 'partiallyRefunded' },
      error: null,
    });
    await expect(
      finalizeRecoveryOrderRefund({
        refundId: REFUND_ID,
        outcome: 'recovered_confirmed',
        tappayRefundId: 'DR20260803gvcV5i',
        failedDetail: null,
        actor: 'sean',
        requestId: TOKEN,
      }),
    ).resolves.toEqual({
      result: 'FINALIZED',
      statusAfter: 'confirmed',
      paymentStatusAfter: 'partiallyRefunded',
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_finalize_order_refund', {
      p_refund_id: REFUND_ID,
      p_outcome: 'recovered_confirmed',
      p_tappay_refund_id: 'DR20260803gvcV5i',
      p_refund_amount_wire: null,
      p_failed_detail: null,
      p_actor: 'sean',
      p_request_id: TOKEN,
    });
  });

  it('manual_failed:帶 Record 證據數字的 failed_detail、對帳碼必 null', async () => {
    mocks.rpc.mockResolvedValue({
      data: { result: 'FINALIZED', status_after: 'failed', payment_status_after: 'paid' },
      error: null,
    });
    await expect(
      finalizeRecoveryOrderRefund({
        refundId: REFUND_ID,
        outcome: 'manual_failed',
        tappayRefundId: null,
        failedDetail: 'Record 對帳:baseline=100;現值=100;差額=0',
        actor: 'sean',
        requestId: TOKEN,
      }),
    ).resolves.toMatchObject({ result: 'FINALIZED', statusAfter: 'failed' });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_finalize_order_refund', {
      p_refund_id: REFUND_ID,
      p_outcome: 'manual_failed',
      p_tappay_refund_id: null,
      p_refund_amount_wire: null,
      p_failed_detail: 'Record 對帳:baseline=100;現值=100;差額=0',
      p_actor: 'sean',
      p_request_id: TOKEN,
    });
  });

  it('🔴 RAISE(含 G5 CAS 失敗=已被結案)→ RefundCallerBugError(呼叫端映「停手+重新整理」,不是 error 重試)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'CAS 失敗' } });
    await expect(
      finalizeRecoveryOrderRefund({
        refundId: REFUND_ID,
        outcome: 'manual_failed',
        tappayRefundId: null,
        failedDetail: 'x',
        actor: 'sean',
        requestId: TOKEN,
      }),
    ).rejects.toBeInstanceOf(RefundCallerBugError);
  });
});
