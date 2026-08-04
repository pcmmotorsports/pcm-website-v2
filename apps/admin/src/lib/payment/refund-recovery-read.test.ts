import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ from: mocks.from }),
}));

import {
  RECOVERY_SIBLINGS_LIMIT,
  RecoveryReadIntegrityError,
  TERMINAL_REFUND_STATUSES,
  findRefundForRecovery,
} from './refund-recovery-read';

// refund-recovery-read.test.ts — RW4 對帳窄讀的查詢形狀與讀數計算。
// 🔴 誠實邊界(RW3 同註;codex R1 nit 修詞):鏈式 mock 只證「本層送出什麼形狀」,
//    不證 PostgREST/DB 行為;真資料路徑證據不在本檔 —— 在真機 E2E 段
//    (handoff `2026-08-03-day-refund-wire.md` §3i:local 真 PostgREST + 真 Record 三鏈)。

const REFUND_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ORDER_ID = '11111111-2222-4333-8444-555555555555';

function rowData(over: Record<string, unknown> = {}) {
  return {
    id: REFUND_ID,
    order_id: ORDER_ID,
    status: 'processing',
    refund_amount: 250,
    rec_trade_id: 'D20260803TESTrec',
    record_refunded_before: 100,
    provider_refund_id_evidence: null,
    created_at: '2026-08-03T12:00:00+00:00',
    orders: { display_id: 'PCM-2026-0087' },
    ...over,
  };
}

/** 兩段式 chain mock:第一段 eq→maybeSingle(本列)、第二段 eq→neq→limit(兄弟列)。 */
function arm(row: unknown, siblings: { data: unknown; error: unknown }) {
  const calls = {
    rowSelect: [] as unknown[][],
    rowEq: [] as unknown[][],
    sibSelect: [] as unknown[][],
    sibEq: [] as unknown[][],
    sibNeq: [] as unknown[][],
    sibLimit: [] as unknown[][],
  };
  mocks.from
    .mockImplementationOnce((table: string) => ({
      select: (...selectArgs: unknown[]) => {
        calls.rowSelect.push([table, ...selectArgs]);
        return {
          eq: (...eqArgs: unknown[]) => {
            calls.rowEq.push(eqArgs);
            return { maybeSingle: () => Promise.resolve({ data: row, error: null }) };
          },
        };
      },
    }))
    .mockImplementationOnce((table: string) => ({
      select: (...selectArgs: unknown[]) => {
        calls.sibSelect.push([table, ...selectArgs]);
        return {
          eq: (...eqArgs: unknown[]) => {
            calls.sibEq.push(eqArgs);
            return {
              neq: (...neqArgs: unknown[]) => {
                calls.sibNeq.push(neqArgs);
                return {
                  limit: (...limitArgs: unknown[]) => {
                    calls.sibLimit.push(limitArgs);
                    return Promise.resolve(siblings);
                  },
                };
              },
            };
          },
        };
      },
    }));
  return calls;
}

beforeEach(() => {
  mocks.from.mockReset();
});

describe('findRefundForRecovery — 查詢形狀', () => {
  it('本列:order_refunds、對帳材料欄齊(rec/baseline/證據)+ 母單編號 embed(確認碼閘用)', async () => {
    const calls = arm(rowData(), { data: [], error: null });
    await findRefundForRecovery(REFUND_ID);
    expect(calls.rowSelect[0]![0]).toBe('order_refunds');
    const columns = String(calls.rowSelect[0]![1]);
    const tokens = columns.split(',').map((s) => s.trim());
    // 逗號切詞精確比對(RW3 教訓:子字串 toContain 對 id 恆真)。
    for (const column of [
      'id',
      'order_id',
      'status',
      'refund_amount',
      'rec_trade_id',
      'record_refunded_before',
      'provider_refund_id_evidence',
      'created_at',
      'orders(display_id)',
    ]) {
      expect(tokens, `本列 select 缺 ${column}`).toContain(column);
    }
    // 死欄不留(opus nit):kind 零消費、不進投影。
    expect(tokens).not.toContain('kind');
    expect(calls.rowEq[0]).toEqual(['id', REFUND_ID]);
  });

  it('兄弟列:同單、排除本列、顯式上限 N+1(截斷讀數不可信=寧可 throw)', async () => {
    const calls = arm(rowData(), { data: [], error: null });
    await findRefundForRecovery(REFUND_ID);
    expect(calls.sibEq[0]).toEqual(['order_id', ORDER_ID]);
    expect(calls.sibNeq[0]).toEqual(['id', REFUND_ID]);
    expect(calls.sibLimit[0]).toEqual([RECOVERY_SIBLINGS_LIMIT + 1]);
  });

  it('查無 → null(不打兄弟查詢);orders embed 缺(防禦)→ orderDisplayId=null', async () => {
    arm(null, { data: [], error: null });
    await expect(findRefundForRecovery(REFUND_ID)).resolves.toBeNull();
    expect(mocks.from).toHaveBeenCalledTimes(1);

    mocks.from.mockReset();
    arm(rowData({ orders: null }), { data: [], error: null });
    await expect(findRefundForRecovery(REFUND_ID)).resolves.toMatchObject({
      orderDisplayId: null,
    });
  });
});

describe('findRefundForRecovery — 讀數計算', () => {
  it('快照映射 + 三讀數:非終態計數 / confirmed SUM / 缺對帳碼筆數(混合狀態 fixture)', async () => {
    arm(rowData(), {
      data: [
        { id: 's1', status: 'processing', refund_amount: 30, tappay_refund_id: null },
        { id: 's2', status: 'confirmed', refund_amount: 70, tappay_refund_id: 'DR1' },
        { id: 's3', status: 'confirmed', refund_amount: 50, tappay_refund_id: null },
        { id: 's4', status: 'failed', refund_amount: 999, tappay_refund_id: null },
        { id: 's5', status: 'deferred', refund_amount: 888, tappay_refund_id: null },
      ],
      error: null,
    });
    const snapshot = await findRefundForRecovery(REFUND_ID);
    expect(snapshot).toMatchObject({
      id: REFUND_ID,
      orderId: ORDER_ID,
      orderDisplayId: 'PCM-2026-0087',
      status: 'processing',
      refundAmount: 250,
      recTradeId: 'D20260803TESTrec',
      recordRefundedBefore: 100,
      providerEvidence: null,
      // failed/deferred 不進任何讀數(999/888 是誘餌:混進 SUM 這格就紅)。
      otherInFlightCount: 1,
      ledgerConfirmedSum: 120,
      confirmedMissingRefundId: 1,
    });
  });

  it('🔴 在途計數=非終態反面數(opus C4):未知新狀態被當在途(fail-closed),不會靜默歸 0', async () => {
    arm(rowData(), {
      data: [
        { id: 's1', status: 'weird_new_status', refund_amount: 10, tappay_refund_id: null },
        { id: 's2', status: 'confirmed', refund_amount: 70, tappay_refund_id: 'DR1' },
      ],
      error: null,
    });
    await expect(findRefundForRecovery(REFUND_ID)).resolves.toMatchObject({
      otherInFlightCount: 1,
    });
    // 終態 allowlist 字面釘死(S6 現況三終態;新增狀態必回訪 refund-recovery-read.ts)。
    expect([...TERMINAL_REFUND_STATUSES]).toEqual(['confirmed', 'failed', 'deferred']);
  });

  it('🔴 兄弟列超上限 → RecoveryReadIntegrityError(重試不會好;呼叫端映停手不映重試)', async () => {
    const over = Array.from({ length: RECOVERY_SIBLINGS_LIMIT + 1 }, (_, i) => ({
      id: `s${i}`,
      status: 'confirmed',
      refund_amount: 1,
      tappay_refund_id: 'DR',
    }));
    arm(rowData(), { data: over, error: null });
    await expect(findRefundForRecovery(REFUND_ID)).rejects.toBeInstanceOf(
      RecoveryReadIntegrityError,
    );
  });

  it('本列/兄弟列查詢 error → throw(不得靜默;讀數缺席≠讀數為零)', async () => {
    mocks.from.mockImplementationOnce(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
        }),
      }),
    }));
    await expect(findRefundForRecovery(REFUND_ID)).rejects.toBeTruthy();

    arm(rowData(), { data: null, error: { message: 'boom' } });
    await expect(findRefundForRecovery(REFUND_ID)).rejects.toBeTruthy();
  });
});
