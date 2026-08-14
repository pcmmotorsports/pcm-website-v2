import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  authorizeAdminMutation: vi.fn(),
  getRequestId: vi.fn(),
  getTapPayAdapter: vi.fn(),
  findRefundForRecovery: vi.fn(),
  finalizeRecoveryOrderRefund: vi.fn(),
  recordQuery: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('../session/authorize', () => ({ authorizeAdminMutation: mocks.authorizeAdminMutation }));
vi.mock('../audit/context', () => ({ getRequestId: mocks.getRequestId }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient: vi.fn() }));
// 只換函式,error class 用真的(自己造假 class 會讓「分得開」變自我實現;A9d2-1 慣例)
vi.mock('./composition', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./composition')>();
  return { ...actual, getTapPayAdapter: mocks.getTapPayAdapter };
});
vi.mock('./refund-recovery-read', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./refund-recovery-read')>();
  return { ...actual, findRefundForRecovery: mocks.findRefundForRecovery };
});
vi.mock('./refund-repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./refund-repository')>();
  return { ...actual, finalizeRecoveryOrderRefund: mocks.finalizeRecoveryOrderRefund };
});

// 🔴 解析器與判定碼表刻意不 mock —— 餵真 FormData 走真判定,否則「送出當下重判」斷言恆真。
import {
  judgeRefundExceptionAction,
  resolveRefundExceptionAction,
} from './refund-recovery-actions';
import { RefundCallerBugError, RefundFinalizeParseError } from './refund-repository';
import { RecoveryReadIntegrityError } from './refund-recovery-read';
import { REFUND_EXCEPTION_STALL_MS } from './refund-ledger-view';
import {
  RECOVERY_CONFIRM_FIELD,
  RECOVERY_DR_CODE_FIELD,
  RECOVERY_REFUND_ID_FIELD,
  RECOVERY_REQUEST_TOKEN_FIELD,
  RECOVERY_RESOLUTION_FIELD,
  type RefundJudgeState,
  type RefundResolveState,
} from './refund-recovery-state';

const REFUND_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ORDER_ID = '11111111-2222-4333-8444-555555555555';
const TOKEN = '9f8e7d6c-5b4a-4321-a987-654321fedcba';
const REC = 'D20260803TESTrec';
const DR = 'DR20260803gvcV5i';
const CONFIRM = '0087';
const JUDGE_IDLE: RefundJudgeState = { status: 'idle' };
const RESOLVE_IDLE: RefundResolveState = { status: 'idle', requestToken: TOKEN };
const EXCEPTIONS_PATH = '/orders/refund-exceptions';

/** 滯留 31 分的 processing 列(異常入口鏡像可過;evidence=null 走時間軸)。 */
function snapshot(over: Record<string, unknown> = {}) {
  return {
    id: REFUND_ID,
    orderId: ORDER_ID,
    orderDisplayId: 'PCM-2026-0087',
    status: 'processing',
    refundAmount: 250,
    recTradeId: REC,
    recordRefundedBefore: 100,
    providerEvidence: null,
    createdAt: new Date(Date.now() - REFUND_EXCEPTION_STALL_MS - 60_000).toISOString(),
    otherInFlightCount: 0,
    ledgerConfirmedSum: 120,
    confirmedMissingRefundId: 0,
    ...over,
  };
}

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
        refundedAmount: 100, // = baseline ⇒ delta 0(not_executed)
        ...over,
      },
    ],
  };
}

function judgeForm(over: Record<string, string> = {}): FormData {
  const data = new FormData();
  data.set(RECOVERY_REFUND_ID_FIELD, REFUND_ID);
  for (const [name, value] of Object.entries(over)) data.set(name, value);
  return data;
}

function resolveForm(over: Record<string, string> = {}, omit: string[] = []): FormData {
  const data = new FormData();
  const fields: Record<string, string> = {
    [RECOVERY_REFUND_ID_FIELD]: REFUND_ID,
    [RECOVERY_REQUEST_TOKEN_FIELD]: TOKEN,
    [RECOVERY_RESOLUTION_FIELD]: 'mark_failed',
    [RECOVERY_CONFIRM_FIELD]: CONFIRM,
    ...over,
  };
  for (const [name, value] of Object.entries(fields)) {
    if (!omit.includes(name)) data.set(name, value);
  }
  return data;
}

const recoverForm = (over: Record<string, string> = {}) =>
  resolveForm({
    [RECOVERY_RESOLUTION_FIELD]: 'recover_confirmed',
    [RECOVERY_DR_CODE_FIELD]: DR,
    [RECOVERY_CONFIRM_FIELD]: '',
    ...over,
  });

/** get() 會爆的地雷 FormData:授權閘若不是絕對第一,這顆就炸(斷言真的短路)。 */
const MINE = { get: () => { throw new Error('觸爆:授權前讀了表單'); } } as unknown as FormData;

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.authorizeAdminMutation.mockResolvedValue({ sid: 'sid-1', actorId: 'sean' });
  // header id 與表單 token 刻意不同值(冪等鍵接錯來源就恆綠;A9d2-1 H9)。
  mocks.getRequestId.mockResolvedValue('req_http-side-id');
  mocks.getTapPayAdapter.mockReturnValue({ recordQuery: mocks.recordQuery });
  mocks.findRefundForRecovery.mockResolvedValue(snapshot());
  mocks.recordQuery.mockResolvedValue(recordResult());
  mocks.finalizeRecoveryOrderRefund.mockResolvedValue({
    result: 'FINALIZED',
    statusAfter: 'failed',
    paymentStatusAfter: 'paid',
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('judgeRefundExceptionAction — 閘序與失敗碼', () => {
  it('🔴 授權閘絕對第一(地雷 FormData 不炸=denied 在讀表單之前)', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    await expect(judgeRefundExceptionAction(JUDGE_IDLE, MINE)).resolves.toMatchObject({
      status: 'failed',
      code: 'denied',
    });
    expect(mocks.findRefundForRecovery).not.toHaveBeenCalled();
  });

  it('refund_id 非 uuid → invalid;查無 → not_found;非 processing → already_finalized', async () => {
    await expect(
      judgeRefundExceptionAction(JUDGE_IDLE, judgeForm({ [RECOVERY_REFUND_ID_FIELD]: 'x' })),
    ).resolves.toMatchObject({ code: 'invalid' });
    mocks.findRefundForRecovery.mockResolvedValue(null);
    await expect(judgeRefundExceptionAction(JUDGE_IDLE, judgeForm())).resolves.toMatchObject({
      code: 'not_found',
    });
    mocks.findRefundForRecovery.mockResolvedValue(snapshot({ status: 'confirmed' }));
    await expect(judgeRefundExceptionAction(JUDGE_IDLE, judgeForm())).resolves.toMatchObject({
      code: 'already_finalized',
    });
  });

  // 🔴 #473(Sean 2026-08-14):`already_finalized` 的文案**不得叫員工去做一件沒有結果的事**。
  //    舊文案末句是「請重新整理清單確認現況」—— 而這個狀態**沒有出口**
  //    (本檔 action 只吃 `processing`;狀態機三終態不可再轉)⇒ 他重新整理十次都一樣。
  //    ⚠️ 做成守門而不是寫在註解裡:同日我已經兩次「知道規則卻沒執行」,靠記得不管用。
  it('🔴 #473 already_finalized 文案:要給真的下一步(找工程師),不得叫人白做工', async () => {
    mocks.findRefundForRecovery.mockResolvedValue(snapshot({ status: 'confirmed' }));
    const state = (await judgeRefundExceptionAction(JUDGE_IDLE, judgeForm())) as {
      message: string;
    };
    // ① 真的下一步:後台改不了 ⇒ 找人
    expect(state.message).toContain('聯絡工程師');
    // ② 「錢與帳有沒有被動到」必須明寫。
    //    ⚠️ 用「沒有更動任何退款資料」不用「沒有執行任何動作」(關卡2 codex nit):
    //    早退前確實有授權檢查、log 與兩次 DB 讀,後者按字面是假的。
    expect(state.message).toContain('沒有更動任何退款資料');
    // ③ 🔴 白做工字面。⚠️ 「重新整理」能被列進禁語**是因為下面第⑥道**:
    //    action 在這條路徑上會 revalidate、清單自己會更新 ⇒ 不需要叫員工去手動整理。
    //    (關卡2 codex 抓到我第一版:禁了「重新整理」卻沒讓畫面真的更新 ⇒ 反而封死了誠實的說法。)
    expect(state.message).not.toMatch(/重新整理|稍後再試|再試一次|稍候/);
    // ④ 擋 **ASCII 內部識別字**(表名/狀態值/RPC 名/SQL)。
    //    ⚠️ **它的射程就到這裡** —— 擋不到中文的內部語彙(例:「狀態機終態」「CAS 已鎖」),
    //    那類要靠人看(關卡2 code-reviewer 實測指出:註解若寫「不寫內部語彙」就是宣稱大於事實)。
    //    ⚠️ 字集第一版只列 4 個 token,`confirmed`/`deferred`/RPC 名全漏(關卡2 codex)⇒ 已擴。
    // ⑦ 要指出**真正看得到結果的地方** = 訂單頁的退款紀錄。
    //    ⚠️ 原註解寫「結案後這一列會從異常清單消失,叫他看清單是白做工」——
    //       `#473b-2` 之後那句**只對 confirmed/deferred 成立**,`manual_failed` 的列**留在清單上**。
    //       文案本身已刪掉那個宣稱(`refund-recovery-state.ts` v4);理由一併更正為:
    //       指向訂單頁不是因為「清單那筆會消失」,而是**訂單頁看得到結果、清單不一定**。
    //       ⚠️ 不寫「一定」(關卡2 codex nit):訂單頁的帳本區塊也有上限
    //          (`ORDER_REFUNDS_LIMIT`),同一張訂單退款筆數爆量時較舊的列一樣會被截掉。
    expect(state.message).toContain('訂單頁');
    expect(state.message).not.toMatch(
      /order_refunds|payment_refunds|manual_failed|not_sent|rejected_out_of_range|processing|confirmed|deferred|admin_[a-z_]+|SQL|status/i,
    );
    // ⑤ 純文字輸出不得混 Markdown。⚠️ 第一版只擋 `**`,反引號/`#`/連結/底線強調全漏
    //    (關卡2 codex)⇒ 字集擴到整組。
    expect(state.message).not.toMatch(/\*\*|`|^#|\[[^\]]*\]\([^)]*\)|_[^_]+_/m);
    // ⑥ 🔴 這條路徑必須 revalidate,否則清單停在舊狀態、上面那句「清單已更新」就是假話。
    //    這格紅的時候是誰讓它紅的:把早退裡的兩行 revalidatePath 拿掉。
    expect(mocks.revalidatePath).toHaveBeenCalled();
  });

  it('🔴 異常入口鏡像:滯留未逾閾且無證據 → not_exception_yet、零 Record 呼叫(同步流程可能還在跑)', async () => {
    mocks.findRefundForRecovery.mockResolvedValue(
      snapshot({ createdAt: new Date().toISOString() }),
    );
    await expect(judgeRefundExceptionAction(JUDGE_IDLE, judgeForm())).resolves.toMatchObject({
      code: 'not_exception_yet',
    });
    expect(mocks.recordQuery).not.toHaveBeenCalled();
  });

  it('🔴 created_at 不可解析 → 擋(動作面 fail-closed=不可解鎖;方向與顯示面 isRefundException 相反)', async () => {
    mocks.findRefundForRecovery.mockResolvedValue(snapshot({ createdAt: '不是時間' }));
    await expect(judgeRefundExceptionAction(JUDGE_IDLE, judgeForm())).resolves.toMatchObject({
      code: 'not_exception_yet',
    });
  });

  it('證據列不等 30 分(fable N4):有證據的新列照樣可判', async () => {
    mocks.findRefundForRecovery.mockResolvedValue(
      snapshot({ providerEvidence: 'EVI123', createdAt: new Date().toISOString() }),
    );
    await expect(judgeRefundExceptionAction(JUDGE_IDLE, judgeForm())).resolves.toMatchObject({
      status: 'judged',
    });
  });

  it('Record 反查失敗 → record_unavailable;adapter 設定錯 → config;完整性異常 → bug(停手不重試)', async () => {
    mocks.recordQuery.mockRejectedValue(new Error('timeout'));
    await expect(judgeRefundExceptionAction(JUDGE_IDLE, judgeForm())).resolves.toMatchObject({
      code: 'record_unavailable',
    });
    const { TapPayConfigError } = await import('./composition');
    mocks.getTapPayAdapter.mockImplementation(() => {
      throw new TapPayConfigError('缺 env');
    });
    await expect(judgeRefundExceptionAction(JUDGE_IDLE, judgeForm())).resolves.toMatchObject({
      code: 'config',
    });
    mocks.getTapPayAdapter.mockReturnValue({ recordQuery: mocks.recordQuery });
    mocks.findRefundForRecovery.mockRejectedValue(new RecoveryReadIntegrityError('截斷'));
    await expect(judgeRefundExceptionAction(JUDGE_IDLE, judgeForm())).resolves.toMatchObject({
      code: 'bug',
    });
  });
});

describe('judgeRefundExceptionAction — 讀數與 RF8 結論', () => {
  it('judged:verdict + 兩讀數 + RF8(not_executed 期望和=已登記 ⇒ 120≠100 → 不一致告警)', async () => {
    const state = await judgeRefundExceptionAction(JUDGE_IDLE, judgeForm());
    expect(state).toMatchObject({
      status: 'judged',
      verdict: 'not_executed',
      baseline: 100,
      refundedNow: 100,
      delta: 0,
      refundAmount: 250,
      ledgerConfirmedSum: 120,
      ledgerMatchesRecord: false,
      confirmedMissingRefundId: 0,
    });
    if (state.status === 'judged') {
      expect(Number.isFinite(Date.parse(state.judgedAtIso))).toBe(true);
    }
  });

  it('🔴 RF8 期望和把本列算進去(opus C1):executed(sum=120+本列 250=370=現值)→ 一致、不拉假警報', async () => {
    mocks.recordQuery.mockResolvedValue(recordResult({ refundedAmount: 350 }));
    mocks.findRefundForRecovery.mockResolvedValue(snapshot({ ledgerConfirmedSum: 100 }));
    await expect(judgeRefundExceptionAction(JUDGE_IDLE, judgeForm())).resolves.toMatchObject({
      verdict: 'executed',
      ledgerMatchesRecord: true,
    });
    // not_executed 且已登記=現值 → 也一致。
    mocks.recordQuery.mockResolvedValue(recordResult());
    await expect(judgeRefundExceptionAction(JUDGE_IDLE, judgeForm())).resolves.toMatchObject({
      verdict: 'not_executed',
      ledgerMatchesRecord: true,
    });
  });

  it('🔴 evidence 矛盾(opus M1):證據非空 + delta=0 → evidence_contradiction、RF8 不下結論(null)', async () => {
    mocks.findRefundForRecovery.mockResolvedValue(snapshot({ providerEvidence: 'DRHOLD1' }));
    await expect(judgeRefundExceptionAction(JUDGE_IDLE, judgeForm())).resolves.toMatchObject({
      status: 'judged',
      verdict: 'evidence_contradiction',
      ledgerMatchesRecord: null,
    });
  });

  it('shape 異常(欄缺)→ verdict=record_shape_bad、讀數=null(嚴禁翻 0 假讀數)', async () => {
    mocks.recordQuery.mockResolvedValue(
      recordResult({ refundedAmount: undefined }),
    );
    await expect(judgeRefundExceptionAction(JUDGE_IDLE, judgeForm())).resolves.toMatchObject({
      status: 'judged',
      verdict: 'record_shape_bad',
      refundedNow: null,
      delta: null,
      ledgerMatchesRecord: null,
    });
  });
});

describe('resolveRefundExceptionAction — 閘序與判定閘', () => {
  it('🔴 授權閘絕對第一(地雷 FormData)', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    await expect(resolveRefundExceptionAction(RESOLVE_IDLE, MINE)).resolves.toMatchObject({
      status: 'failed',
      code: 'denied',
    });
    expect(mocks.finalizeRecoveryOrderRefund).not.toHaveBeenCalled();
  });

  it('矛盾表單(mark_failed 帶 DR 碼 / 缺確認碼)→ invalid、零 finalize', async () => {
    await expect(
      resolveRefundExceptionAction(RESOLVE_IDLE, resolveForm({ [RECOVERY_DR_CODE_FIELD]: DR })),
    ).resolves.toMatchObject({ code: 'invalid' });
    await expect(
      resolveRefundExceptionAction(RESOLVE_IDLE, resolveForm({}, [RECOVERY_CONFIRM_FIELD])),
    ).resolves.toMatchObject({ code: 'invalid' });
    expect(mocks.finalizeRecoveryOrderRefund).not.toHaveBeenCalled();
  });

  it('🔴 確認碼閘(opus C3):與訂單號末 4 碼不符 → confirm_mismatch、零 finalize、輸入帶回;且**不燒 Record 呼叫**(opus R2 N3:便宜閘先跑)', async () => {
    const state = await resolveRefundExceptionAction(
      RESOLVE_IDLE,
      resolveForm({ [RECOVERY_CONFIRM_FIELD]: '9999' }),
    );
    expect(state).toMatchObject({ code: 'confirm_mismatch', confirmCode: '9999' });
    expect(mocks.finalizeRecoveryOrderRefund).not.toHaveBeenCalled();
    expect(mocks.recordQuery).not.toHaveBeenCalled();
  });

  it('確認碼大小寫不敏感(opus R2 N1:display_id 字母表全大寫,小寫輸入不得恆撞牆)', async () => {
    mocks.findRefundForRecovery.mockResolvedValue(snapshot({ orderDisplayId: 'PCM-2026-00B7' }));
    await resolveRefundExceptionAction(
      RESOLVE_IDLE,
      resolveForm({ [RECOVERY_CONFIRM_FIELD]: '00b7' }),
    );
    expect(mocks.finalizeRecoveryOrderRefund).toHaveBeenCalledTimes(1);
  });

  it('母單編號缺(資料異常)→ bug、零 finalize(確認碼閘 fail-closed,不是跳過)', async () => {
    mocks.findRefundForRecovery.mockResolvedValue(snapshot({ orderDisplayId: null }));
    await expect(resolveRefundExceptionAction(RESOLVE_IDLE, resolveForm())).resolves.toMatchObject(
      { code: 'bug' },
    );
    expect(mocks.finalizeRecoveryOrderRefund).not.toHaveBeenCalled();
  });

  it('🔴 送出當下重判:Record 差額不等(150≠0)→ mark_failed 被 verdict_mismatch 擋、零 finalize', async () => {
    mocks.recordQuery.mockResolvedValue(recordResult({ refundedAmount: 150 }));
    const state = await resolveRefundExceptionAction(RESOLVE_IDLE, resolveForm());
    expect(state).toMatchObject({ code: 'verdict_mismatch', requestToken: TOKEN });
    expect(mocks.finalizeRecoveryOrderRefund).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('🔴 交叉負測①(opus C2):錢已退(executed)卻按「標記失敗」→ 擋(否則=釋出額度+引導重發起=二退)', async () => {
    mocks.recordQuery.mockResolvedValue(recordResult({ refundedAmount: 350 }));
    await expect(resolveRefundExceptionAction(RESOLVE_IDLE, resolveForm())).resolves.toMatchObject(
      { code: 'verdict_mismatch' },
    );
    expect(mocks.finalizeRecoveryOrderRefund).not.toHaveBeenCalled();
  });

  it('🔴 交叉負測②(opus C2):錢沒動(not_executed)卻按「恢復結案」→ 擋(否則=翻 payment_status 記假帳)', async () => {
    await expect(
      resolveRefundExceptionAction(RESOLVE_IDLE, recoverForm()),
    ).resolves.toMatchObject({ code: 'verdict_mismatch' });
    expect(mocks.finalizeRecoveryOrderRefund).not.toHaveBeenCalled();
  });

  it('🔴 evidence 矛盾列(opus M1):證據非空+delta=0 → 標記失敗被擋(矛盾讀數兩個動作都不可達)', async () => {
    mocks.findRefundForRecovery.mockResolvedValue(snapshot({ providerEvidence: 'DRHOLD1' }));
    await expect(resolveRefundExceptionAction(RESOLVE_IDLE, resolveForm())).resolves.toMatchObject(
      { code: 'verdict_mismatch' },
    );
    expect(mocks.finalizeRecoveryOrderRefund).not.toHaveBeenCalled();
  });

  it('🔴 欄缺(shape_bad)一樣擋結案 —— 讀數不可信時兩個結案動作都不可達', async () => {
    mocks.recordQuery.mockResolvedValue(recordResult({ refundedAmount: undefined }));
    await expect(resolveRefundExceptionAction(RESOLVE_IDLE, resolveForm())).resolves.toMatchObject(
      { code: 'verdict_mismatch' },
    );
    expect(mocks.finalizeRecoveryOrderRefund).not.toHaveBeenCalled();
  });

  it('🔴 delta 對但同單另有在途列(other_in_flight)→ 恢復被擋(§4-1:差額歸屬不明)', async () => {
    mocks.findRefundForRecovery.mockResolvedValue(snapshot({ otherInFlightCount: 1 }));
    mocks.recordQuery.mockResolvedValue(recordResult({ refundedAmount: 350 }));
    await expect(
      resolveRefundExceptionAction(RESOLVE_IDLE, recoverForm()),
    ).resolves.toMatchObject({ code: 'verdict_mismatch' });
    expect(mocks.finalizeRecoveryOrderRefund).not.toHaveBeenCalled();
  });

  it('record_unavailable / not_exception_yet 直通失敗碼、零 finalize', async () => {
    mocks.recordQuery.mockRejectedValue(new Error('down'));
    await expect(resolveRefundExceptionAction(RESOLVE_IDLE, resolveForm())).resolves.toMatchObject(
      { code: 'record_unavailable' },
    );
    mocks.findRefundForRecovery.mockResolvedValue(
      snapshot({ createdAt: new Date().toISOString() }),
    );
    await expect(resolveRefundExceptionAction(RESOLVE_IDLE, resolveForm())).resolves.toMatchObject(
      { code: 'not_exception_yet' },
    );
    expect(mocks.finalizeRecoveryOrderRefund).not.toHaveBeenCalled();
  });
});

describe('resolveRefundExceptionAction — mark_failed 正向鏈', () => {
  it('🔴 delta=0+確認碼符 → finalize(manual_failed)帶兩讀數 detail、token 是表單那把(≠ header id)→ PRG', async () => {
    await resolveRefundExceptionAction(RESOLVE_IDLE, resolveForm());
    expect(mocks.finalizeRecoveryOrderRefund).toHaveBeenCalledExactlyOnceWith({
      refundId: REFUND_ID,
      outcome: 'manual_failed',
      tappayRefundId: null,
      failedDetail: expect.stringMatching(/record_refunded_before=100.*現值=100.*差額=0/),
      actor: 'sean',
      requestId: TOKEN,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(EXCEPTIONS_PATH);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/orders/${ORDER_ID}`);
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(
      `${EXCEPTIONS_PATH}?r=refund_marked_failed`,
    );
  });
});

describe('resolveRefundExceptionAction — recover_confirmed 正向鏈與證據閘', () => {
  it('🔴 delta=凍結額 → finalize(recovered_confirmed)帶 Portal 真碼 → PRG', async () => {
    mocks.recordQuery.mockResolvedValue(recordResult({ refundedAmount: 350 }));
    mocks.finalizeRecoveryOrderRefund.mockResolvedValue({
      result: 'FINALIZED',
      statusAfter: 'confirmed',
      paymentStatusAfter: 'partiallyRefunded',
    });
    await resolveRefundExceptionAction(RESOLVE_IDLE, recoverForm());
    expect(mocks.finalizeRecoveryOrderRefund).toHaveBeenCalledExactlyOnceWith({
      refundId: REFUND_ID,
      outcome: 'recovered_confirmed',
      tappayRefundId: DR,
      failedDetail: null,
      actor: 'sean',
      requestId: TOKEN,
    });
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(
      `${EXCEPTIONS_PATH}?r=refund_recovered`,
    );
  });

  it('🔴 hold 列證據閘(P7C13 鏡像):輸入碼 ≠ 保存證據 → evidence_mismatch、零 finalize;相等 → 放行', async () => {
    mocks.recordQuery.mockResolvedValue(recordResult({ refundedAmount: 350 }));
    mocks.finalizeRecoveryOrderRefund.mockResolvedValue({
      result: 'FINALIZED',
      statusAfter: 'confirmed',
      paymentStatusAfter: 'partiallyRefunded',
    });
    mocks.findRefundForRecovery.mockResolvedValue(snapshot({ providerEvidence: 'DR_OTHER' }));
    const state = await resolveRefundExceptionAction(RESOLVE_IDLE, recoverForm());
    expect(state).toMatchObject({ code: 'evidence_mismatch', drCode: DR });
    expect(mocks.finalizeRecoveryOrderRefund).not.toHaveBeenCalled();
    // 便宜閘先跑(opus R2 N3):證據不符時 Record 零呼叫。
    expect(mocks.recordQuery).not.toHaveBeenCalled();

    mocks.findRefundForRecovery.mockResolvedValue(snapshot({ providerEvidence: DR }));
    await resolveRefundExceptionAction(RESOLVE_IDLE, recoverForm());
    expect(mocks.finalizeRecoveryOrderRefund).toHaveBeenCalledTimes(1);
  });
});

describe('resolveRefundExceptionAction — finalize 出口收斂', () => {
  it('RAISE(RefundCallerBugError,含 CAS 已被結案)→ finalize_rejected、無 redirect、token/輸入原樣帶回', async () => {
    mocks.finalizeRecoveryOrderRefund.mockRejectedValue(new RefundCallerBugError('CAS 失敗'));
    const state = await resolveRefundExceptionAction(RESOLVE_IDLE, resolveForm());
    expect(state).toMatchObject({
      code: 'finalize_rejected',
      requestToken: TOKEN,
      confirmCode: CONFIRM,
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('🔴 其他 throw → finalize_unknown(codex MF:結果不明、可能已寫入 —— 不得宣稱「沒有完成」)', async () => {
    mocks.finalizeRecoveryOrderRefund.mockRejectedValue(new Error('連線斷在回應路上'));
    const state = await resolveRefundExceptionAction(RESOLVE_IDLE, resolveForm());
    expect(state).toMatchObject({ code: 'finalize_unknown' });
    if (state.status === 'failed') {
      expect(state.message).toContain('結果不明');
      expect(state.message).toContain('勿');
      expect(state.message).not.toContain('沒有完成');
    }
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('🔴 23 類 SQLSTATE(如 23505 撞 tappay_refund_id UNIQUE)=交易回滾零寫入 → finalize_rejected 而非 unknown(修後 E2E 實錘:抄錯 Portal 編號的真實路)', async () => {
    mocks.finalizeRecoveryOrderRefund.mockRejectedValue(
      Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505',
      }),
    );
    await expect(resolveRefundExceptionAction(RESOLVE_IDLE, resolveForm())).resolves.toMatchObject(
      { code: 'finalize_rejected' },
    );
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('🔴 回應解析失敗(codex R2 MF:交易已 commit、只是回傳形狀不可信)→ finalize_unknown 而非「沒寫入」', async () => {
    mocks.finalizeRecoveryOrderRefund.mockRejectedValue(
      new RefundFinalizeParseError('admin_finalize_order_refund 回傳缺 status_after'),
    );
    const state = await resolveRefundExceptionAction(RESOLVE_IDLE, resolveForm());
    expect(state).toMatchObject({ code: 'finalize_unknown' });
    if (state.status === 'failed') {
      expect(state.message).not.toContain('沒有寫入');
    }
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('REFUND_NOT_FOUND → not_found;非預期碼(HELD)→ bug', async () => {
    mocks.finalizeRecoveryOrderRefund.mockResolvedValue({ result: 'REFUND_NOT_FOUND' });
    await expect(resolveRefundExceptionAction(RESOLVE_IDLE, resolveForm())).resolves.toMatchObject(
      { code: 'not_found' },
    );
    mocks.finalizeRecoveryOrderRefund.mockResolvedValue({
      result: 'HELD_AMOUNT_MISMATCH',
      statusAfter: 'processing',
      paymentStatusAfter: 'paid',
    });
    await expect(resolveRefundExceptionAction(RESOLVE_IDLE, resolveForm())).resolves.toMatchObject(
      { code: 'bug' },
    );
  });

  it('🔴 statusAfter 語意漂移(codex nit):manual_failed 回 confirmed → bug、不宣稱「錢沒動」', async () => {
    mocks.finalizeRecoveryOrderRefund.mockResolvedValue({
      result: 'FINALIZED',
      statusAfter: 'confirmed',
      paymentStatusAfter: 'partiallyRefunded',
    });
    await expect(resolveRefundExceptionAction(RESOLVE_IDLE, resolveForm())).resolves.toMatchObject(
      { code: 'bug' },
    );
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('🔴 redirect 在一切 try 之外(NEXT_REDIRECT 原樣往外拋,不得被吞成失敗 state)', async () => {
    mocks.redirect.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT');
    });
    await expect(resolveRefundExceptionAction(RESOLVE_IDLE, resolveForm())).rejects.toThrow(
      'NEXT_REDIRECT',
    );
  });
});
