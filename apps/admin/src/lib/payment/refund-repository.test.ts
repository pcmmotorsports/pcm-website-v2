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
  RefundCallerBugError,
  RefundCapGuardError,
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
  // ⛔ ~~'initiate 9 碼(第 9 碼 = #445 步 6b,445b 才會吐)'~~
  //    🔴 **2026-08-31 `⟦b4-EXCEEDSDEAD⟧` 甲:第 9 碼刪了 ⇒ 8 碼。**
  //    📌 **而這一行是【突變照出來的,不是我看出來的】** —— 我改完實碼、三綠全過、
  //       34 支測試全綠,**而這個標題整段時間都在說謊**:它斷言 8 個而自稱 9 個。
  //       ⇒ 一個測試的**標題**沒有任何東西在驗它,它是註解穿了測試的衣服。
  it('initiate 8 碼(第 9 碼 `REFUND_EXCEEDS_REMAINING` 已刪 —— 那支 RPC 從來沒吐過)、finalize 3 碼', () => {
    expect(INITIATE_RESULT_CODES).toEqual([
      'INITIATED',
      'DUPLICATE_REQUEST',
      'ORDER_NOT_FOUND',
      'ORDER_NOT_REFUNDABLE',
      'ORDER_NO_CARD_TRANSACTION',
      'REFUND_LEDGER_FULL',
      'REFUND_IN_FLIGHT',
      'REFUND_NOTHING_LEFT',
    ]);
    expect(FINALIZE_RESULT_CODES).toEqual(['FINALIZED', 'HELD_AMOUNT_MISMATCH', 'REFUND_NOT_FOUND']);
  });

  it('blocked_by 三值(#445 §4-4;新增第 4 值時本格與 EXCEEDS_FAILURE_CODE 一起紅)', () => {
    // ⛔ ~~`expect(REFUND_BLOCKED_BY_VALUES).toEqual(['amount','in_flight','unknown'])`~~
    //    🔴 常數本身已刪(見 `refund-repository.ts` 那段)。而這一行值得留一句:
    //    它驗的是「這個常數的內容是什麼」—— **一個只驗自己的斷言**,
    //    ⇒ 📌 **它在【有人用它】與【沒有人用它】兩個世界印同一個綠。**
  });
});

// ⛔ ~~describe('initiate — REFUND_EXCEEDS_REMAINING 的形狀驗(#445 步 6b;445b 才會吐)')~~
// 🔴 **2026-08-31 整段刪(`⟦b4-EXCEEDSDEAD⟧` 甲案,`-48` 批)** ——
//    那四格驗的是【一條到不了的分支】:那支 RPC 自己列出的回傳碼是 8 個
//    (`20260803150000:415-416`(座標已訂正,見本檔上方那一處)(⛔ ~~舊座標~~ 🔴 **2026-08-31 訂正:那支 RPC 的【最新一代】是 `20260812170000:480` 的 `CREATE OR REPLACE`,不是 `20260803150000`** —— 用 `scripts/latest-definition-of.sh admin_initiate_order_refund` 查到的。✅ **結論不變**:在最新那一代裡重數,仍然恰 8 碼、與 `INITIATE_RESULT_CODES` 逐字相同,而 `REFUND_EXCEEDS_REMAINING` / `blocked_by` 在該代 **0 命中**(負對照現造字面亦 0)。📌 **⇒ 我的結論是對的,而我的【證據指著一份已經被取代的定義】—— 那份舊的當時也是 8 碼,所以【指錯代】與【指對代】印出同一個答案。**) 逐字),**沒有 `REFUND_EXCEEDS_REMAINING`**;
//    而 `blocked_by` 在整個 `supabase/` ⇒ **0 處**。
//    ⇒ 📌 **它們是綠的,而那個綠灌大了覆蓋率的印象。**
// ✅ **而它們原本要守的那件事【今天有人在守】**:`445b` 的 trigger 吐 `PCM04`,
//    由 `RefundCapGuardError` / `CAP_GUARD_FAILURE_CODE` 接 ——
//    而那條路是**端到端量過的**(`scripts/pcm04-transport-probe.sh`,PASS=6)。
//    ⇒ 🔵 **所以這不是「刪掉覆蓋」,是【覆蓋搬到了真的那條路上】。**

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
  it('🔴🔴 前提若破了,它要【叫】—— 餵回已刪的 `REFUND_EXCEEDS_REMAINING` ⇒ 拋,不得靜默', async () => {
    // 📌 這一格是 `⟦b4-EXCEEDSDEAD⟧` 甲案的**安全網**,不是覆蓋率。
    //    甲案的前提是「那支 RPC 不會吐這個碼」(`20260803150000:415-416`(座標已訂正,見本檔上方那一處) 逐字 8 個碼)。
    //    🔴 **而前提會被別人後來加的東西弄假,那時沒有任何東西紅** ——
    //       除非「未列在 `INITIATE_RESULT_CODES` 裡的碼一律拋」這件事被【明寫成一格】。
    //    ⇒ 它守的不是今天的行為,是**那個前提破掉的那一天會不會有人知道**。
    mocks.rpc.mockResolvedValue({
      data: { result: 'REFUND_EXCEEDS_REMAINING', remaining_refundable: 300, blocked_by: 'amount' },
      error: null,
    });
    await expect(initiateOrderRefund(INITIATE_ARGS)).rejects.toBeInstanceOf(RefundCallerBugError);
    await expect(initiateOrderRefund(INITIATE_ARGS)).rejects.toThrow(/回傳非預期碼/);
  });

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

  // ── 445b 上限閘的三個碼 ────────────────────────────────────────────────
  it('🔴 PCM04/05/06 → RefundCapGuardError,且 sqlstate 逐碼帶對', async () => {
    for (const code of ['PCM04', 'PCM05', 'PCM06'] as const) {
      mocks.rpc.mockResolvedValue({ data: null, error: { code, message: `擋下 ${code}` } });
      await expect(initiateOrderRefund(INITIATE_ARGS)).rejects.toSatisfy(
        (e) => e instanceof RefundCapGuardError && e.sqlstate === code,
      );
    }
  });

  // ⚠️ **射程**(關卡2 nit 12):這一條在【完全沒有映射】的世界也會過 —— 原始 PostgrestError
  //    本來就不是 RefundCallerBugError。它殺得掉「讓 CapGuard 繼承 CallerBug」那個突變,
  //    **殺不掉「整片沒做」**。承重的是上面那條(sqlstate 逐碼帶對)。
  it('🔴 上限閘**不得**是 RefundCallerBugError —— 合流會讓「改金額」被說成「停手」', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PCM04', message: '超額' } });
    await expect(initiateOrderRefund(INITIATE_ARGS)).rejects.toSatisfy(
      (e) => !(e instanceof RefundCallerBugError),
    );
  });

  // 🔴 **finalize 那一側今天【打不到】,而我仍然接了它 —— 所以要有一格在守它**
  //    (codex 關卡2 nit 3:「刪掉 finalize 的 toCapGuard 分支也不會讓任何測試變紅」)。
  //    445b 是 `BEFORE INSERT ROW`(migration `:332-334`),而 finalize 走 UPDATE ⇒ 今天不可達。
  // 📌 **而「不可達」與「不用接」是兩件事**:哪天有人在 order_refunds 加一道 BEFORE UPDATE 的
  //    上限閘,finalize 就會拿到 PCM04 —— 那時**沒接**的話員工會拿到原始例外,
  //    而那正是本片存在的理由。⇒ 這一格讓那個分支【現在就有人在看】。
  it('🔴 finalize 也認得上限閘的碼(今天不可達,而接了就要有東西守著它)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PCM04', message: '超額' } });
    await expect(finalizeOrderRefund(FINALIZE_ARGS)).rejects.toSatisfy(
      (e) => e instanceof RefundCapGuardError && e.sqlstate === 'PCM04',
    );
  });

  it('🔴 `code` 要留在【頂層】—— 事故當天照 SQLSTATE 撈 log 的人讀的是它,不是 cause', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PCM06', message: '隔離級別', details: 'd', hint: 'h' },
    });
    await expect(initiateOrderRefund(INITIATE_ARGS)).rejects.toSatisfy(
      (e) =>
        (e as { code?: unknown }).code === 'PCM06' &&
        // 原始物件仍在 cause 上 ⇒ details/hint 沒有消失
        ((e as { cause?: { details?: unknown } }).cause?.details === 'd'),
    );
  });

  it('🔴 負對照:P0001 仍走 RefundCallerBugError、**不得**變成 CapGuard(證明沒弄壞既有那道)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'raise' } });
    await expect(initiateOrderRefund(INITIATE_ARGS)).rejects.toSatisfy(
      (e) => e instanceof RefundCallerBugError && !(e instanceof RefundCapGuardError),
    );
  });

  it('🔴 負對照二:不認得的碼(PCM99/XX999)兩道都不接、原樣拋', async () => {
    for (const code of ['PCM99', 'XX999']) {
      mocks.rpc.mockResolvedValue({ data: null, error: { code, message: 'nope' } });
      await expect(initiateOrderRefund(INITIATE_ARGS)).rejects.toSatisfy(
        (e) => !(e instanceof RefundCapGuardError) && !(e instanceof RefundCallerBugError),
      );
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
