// node env;mock 'server-only'(adapter 檔頭 import 'server-only')。
import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { PgChargeAttemptAdapter, PG_BUSINESS_REJECT } from './PgChargeAttemptAdapter';
import type { PgClientLike } from './PaymentConfirmerAdapter';

const ORDER = 'order-uuid-1';
const ATTEMPT = 'attempt-uuid-1';
const TOKEN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

type QueryRows = { rows: Array<Record<string, unknown>> };

function makeClient(opts: {
  connect?: () => Promise<void>;
  query?: (text: string, values: unknown[]) => Promise<QueryRows>;
}) {
  const connect = vi.fn(opts.connect ?? (async () => {}));
  const query = vi.fn<(text: string, values: unknown[]) => Promise<QueryRows>>(
    opts.query ?? (async () => ({ rows: [] })),
  );
  const end = vi.fn(async () => {});
  const client = { connect, query, end } as unknown as PgClientLike;
  return { client, connect, query, end };
}

function beginRows(result: Record<string, unknown>): QueryRows {
  return { rows: [{ result }] };
}

describe('PgChargeAttemptAdapter.begin', () => {
  it('acquired:true → 映 {acquired, attemptId, fallbackToken}(snake→camel)', async () => {
    const { client, connect, end } = makeClient({
      query: async () =>
        beginRows({ acquired: true, attempt_id: ATTEMPT, fallback_token: TOKEN }),
    });
    const res = await new PgChargeAttemptAdapter('conn', () => client).begin(ORDER);
    expect(res).toEqual({ acquired: true, attemptId: ATTEMPT, fallbackToken: TOKEN });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1); // finally 永遠釋放
  });

  it.each(['user_in_flight', 'order_locked', 'not_unpaid'] as const)(
    'acquired:false reason=%s → 原樣回(預期業務路徑、非 throw)',
    async (reason) => {
      const { client } = makeClient({
        query: async () => beginRows({ acquired: false, reason }),
      });
      const res = await new PgChargeAttemptAdapter('conn', () => client).begin(ORDER);
      expect(res).toEqual({ acquired: false, reason });
    },
  );

  it('query 參數 = [orderId]、SQL 呼 begin_charge_attempt', async () => {
    const { client, query } = makeClient({
      query: async () => beginRows({ acquired: false, reason: 'order_locked' }),
    });
    await new PgChargeAttemptAdapter('conn', () => client).begin(ORDER);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain('begin_charge_attempt');
    expect(values).toEqual([ORDER]);
  });

  it.each([
    ['空 rows', { rows: [] as Array<Record<string, unknown>> }],
    ['acquired 非 boolean', beginRows({ acquired: 'yes' })],
    ['acquired:true 缺 token', beginRows({ acquired: true, attempt_id: ATTEMPT })],
    ['acquired:false 未知 reason', beginRows({ acquired: false, reason: 'weird' })],
  ])('回應形狀不符(%s)→ throw 通用訊息', async (_label, rows) => {
    const { client } = makeClient({ query: async () => rows });
    await expect(new PgChargeAttemptAdapter('conn', () => client).begin(ORDER)).rejects.toThrow(
      '回應格式異常',
    );
  });

  // ── 3DS-0b cart-instance dedup outcome(duplicate / needs_settle;在既有 3-reason 前分支)──

  it('reason=duplicate(D2 sibling 已 paid)→ 映 {existingDisplayId, existingPaid:true}(snake→camel)', async () => {
    const { client } = makeClient({
      query: async () =>
        beginRows({
          acquired: false,
          reason: 'duplicate',
          existing_display_id: 'PCM-2026-0009',
          existing_paid: true,
        }),
    });
    const res = await new PgChargeAttemptAdapter('conn', () => client).begin(ORDER);
    expect(res).toEqual({
      acquired: false,
      reason: 'duplicate',
      existingDisplayId: 'PCM-2026-0009',
      existingPaid: true,
    });
  });

  it('reason=needs_settle(D4 charged-未-paid)happy 全欄 → snake→camel(rec/bank 皆非 null)', async () => {
    const { client } = makeClient({
      query: async () =>
        beginRows({
          acquired: false,
          reason: 'needs_settle',
          existing_order_id: 'order-uuid-2',
          existing_display_id: 'PCM-2026-0010',
          existing_rec_trade_id: 'REC-A2',
          existing_bank_transaction_id: 'BANK-1',
        }),
    });
    const res = await new PgChargeAttemptAdapter('conn', () => client).begin(ORDER);
    expect(res).toEqual({
      acquired: false,
      reason: 'needs_settle',
      existingOrderId: 'order-uuid-2',
      existingDisplayId: 'PCM-2026-0010',
      existingRecTradeId: 'REC-A2',
      existingBankTransactionId: 'BANK-1',
    });
  });

  it('🔴 needs_settle nullable 慣例:缺 bank_transaction_id 欄(0b-only)+ rec 為 JSON null(pending orphan)→ 皆 null', async () => {
    const { client } = makeClient({
      query: async () =>
        beginRows({
          acquired: false,
          reason: 'needs_settle',
          existing_order_id: 'order-uuid-3',
          existing_display_id: 'PCM-2026-0011',
          existing_rec_trade_id: null, // pending orphan 無 rec
          // existing_bank_transaction_id 缺欄(0c 才加)
        }),
    });
    const res = await new PgChargeAttemptAdapter('conn', () => client).begin(ORDER);
    expect(res).toEqual({
      acquired: false,
      reason: 'needs_settle',
      existingOrderId: 'order-uuid-3',
      existingDisplayId: 'PCM-2026-0011',
      existingRecTradeId: null,
      existingBankTransactionId: null,
    });
  });

  it.each([
    ['duplicate 缺 existing_display_id', beginRows({ acquired: false, reason: 'duplicate', existing_paid: true })],
    ['duplicate existing_paid 非 true', beginRows({ acquired: false, reason: 'duplicate', existing_display_id: 'PCM-1', existing_paid: false })],
    ['needs_settle 缺 existing_order_id', beginRows({ acquired: false, reason: 'needs_settle', existing_display_id: 'PCM-1' })],
    ['needs_settle 缺 existing_display_id', beginRows({ acquired: false, reason: 'needs_settle', existing_order_id: 'o2' })],
    // 🔴 nullable 欄錯型別(非 string/null/undefined)= RPC 契約違反、不靜默轉 null → throw(codex 關卡2 must-fix)
    ['needs_settle existing_rec_trade_id 為 number', beginRows({ acquired: false, reason: 'needs_settle', existing_order_id: 'o2', existing_display_id: 'PCM-1', existing_rec_trade_id: 123 })],
    ['needs_settle existing_bank_transaction_id 為 object', beginRows({ acquired: false, reason: 'needs_settle', existing_order_id: 'o2', existing_display_id: 'PCM-1', existing_bank_transaction_id: { x: 1 } })],
  ])('dedup outcome 形狀不符(%s)→ throw 通用(fail-closed)', async (_label, rows) => {
    const { client } = makeClient({ query: async () => rows });
    await expect(new PgChargeAttemptAdapter('conn', () => client).begin(ORDER)).rejects.toThrow(
      '回應格式異常',
    );
  });

  it('connect 失敗 → throw 通用訊息 + code 屬性、不含 pg 原文;end 仍被呼', async () => {
    const { client, end } = makeClient({
      connect: async () => {
        throw Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:5432 secret-host-details'), {
          code: 'ECONNREFUSED',
        });
      },
    });
    const err = (await new PgChargeAttemptAdapter('conn', () => client)
      .begin(ORDER)
      .catch((e: unknown) => e)) as Error & { code?: string };
    expect(err.code).toBe('ECONNREFUSED');
    expect(String(err)).not.toContain('secret-host-details'); // PF-E:零 pg 原文
    expect(end).toHaveBeenCalledTimes(1);
  });
});

describe('PgChargeAttemptAdapter.markCharged / markFailed(主軌、雙鍵驗參數)', () => {
  it('markCharged:params = [attemptId, orderId, recTradeId]、🔴 fallbackToken 不入 query', async () => {
    const { client, query } = makeClient({});
    await new PgChargeAttemptAdapter('conn', () => client).markCharged({
      attemptId: ATTEMPT,
      orderId: ORDER,
      recTradeId: 'D20260612X1',
      fallbackToken: TOKEN,
    });
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain('mark_charge_attempt_charged');
    expect(sql).not.toContain('fallback');
    expect(values).toEqual([ATTEMPT, ORDER, 'D20260612X1']);
    expect(JSON.stringify(values)).not.toContain(TOKEN); // token 零洩漏
  });

  it('markFailed:params = [attemptId, orderId]', async () => {
    const { client, query } = makeClient({});
    await new PgChargeAttemptAdapter('conn', () => client).markFailed({
      attemptId: ATTEMPT,
      orderId: ORDER,
    });
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain('mark_charge_attempt_failed');
    expect(values).toEqual([ATTEMPT, ORDER]);
  });

  it('RPC RAISE(P0001)→ throw 帶 code=P0001(供複合早停)+ 通用訊息不含 pg 原文', async () => {
    const { client } = makeClient({
      query: async () => {
        throw Object.assign(new Error('mark_charge_attempt_charged: 付款處理失敗'), {
          code: 'P0001',
        });
      },
    });
    await expect(
      new PgChargeAttemptAdapter('conn', () => client).markCharged({
        attemptId: ATTEMPT,
        orderId: ORDER,
        recTradeId: 'R1',
        fallbackToken: TOKEN,
      }),
    ).rejects.toMatchObject({ code: PG_BUSINESS_REJECT, message: expect.stringContaining('主軌失敗') });
  });
});

// ── M-3 3DS-4 sweeper(主軌-only;claim_stuck / mark_attempt_settle_retry / flag_non_unpaid_active)──

const STUCK_ROW = { attempt_id: ATTEMPT, order_id: ORDER, settle_attempt_count: 2 };

describe('PgChargeAttemptAdapter.expireStuckAtCeiling(ceiling-expirer、3DS-4a-2)', () => {
  it('回轉換筆數;SQL 呼 expire_stuck_attempts_at_ceiling()、無參數', async () => {
    const { client, query } = makeClient({ query: async () => ({ rows: [{ result: 1 }] }) });
    const res = await new PgChargeAttemptAdapter('conn', () => client).expireStuckAtCeiling();
    expect(res).toBe(1);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toMatch(/expire_stuck_attempts_at_ceiling\(\)/);
    expect(values).toEqual([]);
  });

  it('回應非整數 → throw 通用(fail-closed)', async () => {
    const { client } = makeClient({ query: async () => ({ rows: [{ result: 1.5 }] }) });
    await expect(
      new PgChargeAttemptAdapter('conn', () => client).expireStuckAtCeiling(),
    ).rejects.toThrow('回應格式異常');
  });
});

describe('PgChargeAttemptAdapter.claimStuckUnsettled(原子 lease claim、3DS-4a-2)', () => {
  it('SETOF → 映 StuckChargeAttempt[];SQL 鎖 claim_stuck_unsettled_attempts($1::integer, $2::integer)、參數=[ageSeconds, limit]', async () => {
    const { client, query, connect, end } = makeClient({
      query: async () => ({ rows: [STUCK_ROW, { ...STUCK_ROW, settle_attempt_count: 5 }] }),
    });
    const res = await new PgChargeAttemptAdapter('conn', () => client).claimStuckUnsettled(600, 50);
    expect(res).toEqual([
      { attemptId: ATTEMPT, orderId: ORDER, settleCount: 2 },
      { attemptId: ATTEMPT, orderId: ORDER, settleCount: 5 },
    ]);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toMatch(/claim_stuck_unsettled_attempts\(\$1::integer, \$2::integer\)/); // 🔴 鎖 cast
    expect(values).toEqual([600, 50]);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('空 rows(本輪無 due)→ []', async () => {
    const { client } = makeClient({ query: async () => ({ rows: [] }) });
    expect(
      await new PgChargeAttemptAdapter('conn', () => client).claimStuckUnsettled(600, 50),
    ).toEqual([]);
  });

  it.each([
    ['attempt_id 非字串', { ...STUCK_ROW, attempt_id: 1 }],
    ['order_id 缺', { attempt_id: ATTEMPT, settle_attempt_count: 2 }],
    ['settle_attempt_count 非數字', { ...STUCK_ROW, settle_attempt_count: '2' }],
    ['settle_attempt_count 非整數(1.5)', { ...STUCK_ROW, settle_attempt_count: 1.5 }], // 🔴 claim token 必整數(codex K2 must-fix)
    ['settle_attempt_count NaN', { ...STUCK_ROW, settle_attempt_count: Number.NaN }],
  ])('SETOF 列形狀不符(%s)→ throw 通用(fail-closed)', async (_l, row) => {
    const { client } = makeClient({ query: async () => ({ rows: [row] }) });
    await expect(
      new PgChargeAttemptAdapter('conn', () => client).claimStuckUnsettled(600, 50),
    ).rejects.toThrow('回應格式異常');
  });
});

describe('PgChargeAttemptAdapter.markSettleRetry / flagNonUnpaidActive(回 affected)', () => {
  it('markSettleRetry:回 affected;SQL 呼 mark_attempt_settle_retry、參數=[attemptId, count, reason]', async () => {
    const { client, query } = makeClient({ query: async () => ({ rows: [{ result: 1 }] }) });
    const res = await new PgChargeAttemptAdapter('conn', () => client).markSettleRetry(
      ATTEMPT,
      2,
      'record_unreachable',
    );
    expect(res).toBe(1);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toMatch(/mark_attempt_settle_retry\(\$1::uuid, \$2::integer, \$3::text\)/); // 🔴 鎖 cast
    expect(values).toEqual([ATTEMPT, 2, 'record_unreachable']);
  });

  it('markSettleRetry:stale/manual/平行已付款 → affected=0(no-op)', async () => {
    const { client } = makeClient({ query: async () => ({ rows: [{ result: 0 }] }) });
    expect(
      await new PgChargeAttemptAdapter('conn', () => client).markSettleRetry(ATTEMPT, 99, 'x'),
    ).toBe(0);
  });

  it('flagNonUnpaidActive:回標記筆數;SQL 呼 flag_non_unpaid_active_attempts、參數=[limit]', async () => {
    const { client, query } = makeClient({ query: async () => ({ rows: [{ result: 3 }] }) });
    const res = await new PgChargeAttemptAdapter('conn', () => client).flagNonUnpaidActive(50);
    expect(res).toBe(3);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toMatch(/flag_non_unpaid_active_attempts\(\$1::integer\)/); // 🔴 鎖 cast
    expect(values).toEqual([50]);
  });

  it.each([
    ['result 非數字', { rows: [{ result: '1' }] }],
    ['result 非整數', { rows: [{ result: 1.5 }] }],
    ['空 rows', { rows: [] as Array<Record<string, unknown>> }],
  ])('affected 形狀不符(%s)→ throw 通用(fail-closed)', async (_l, rows) => {
    const { client } = makeClient({ query: async () => rows });
    await expect(
      new PgChargeAttemptAdapter('conn', () => client).flagNonUnpaidActive(50),
    ).rejects.toThrow('回應格式異常');
  });
});

// ── M-3 3DS-5b initiate 寫入(record_charge_bank_txn / record_charge_pending_rec、RETURNS boolean persisted)──

const BANK_TXN = 'P01234567890ABCDEF'; // 19 字 `^[A-Z0-9]{1,19}$`
const REC = 'D20260619001234567';

function boolRows(result: unknown): QueryRows {
  return { rows: [{ result }] };
}

describe('PgChargeAttemptAdapter.recordInitiationBankTxn(charge 前寫 bank_txn)', () => {
  it('RPC true → resolve;params=[attemptId, orderId, bankTxn]、SQL 呼 record_charge_bank_txn(三 cast)', async () => {
    const { client, query, connect, end } = makeClient({ query: async () => boolRows(true) });
    await new PgChargeAttemptAdapter('conn', () => client).recordInitiationBankTxn(ATTEMPT, ORDER, BANK_TXN);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toMatch(/record_charge_bank_txn\(\$1::uuid, \$2::uuid, \$3::text\)/);
    expect(values).toEqual([ATTEMPT, ORDER, BANK_TXN]);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1); // finally 永遠釋放
  });

  it('🔴 RPC false(未 durable)→ throw 未 durable(use-case 映 init_failed、零 TapPay)', async () => {
    const { client } = makeClient({ query: async () => boolRows(false) });
    await expect(
      new PgChargeAttemptAdapter('conn', () => client).recordInitiationBankTxn(ATTEMPT, ORDER, BANK_TXN),
    ).rejects.toThrow('未 durable');
  });

  it.each([
    ['result 非 boolean(字串)', boolRows('true')],
    ['result 非 boolean(數字)', boolRows(1)],
    ['空 rows', { rows: [] as Array<Record<string, unknown>> }],
  ])('回應形狀不符(%s)→ throw 通用訊息(連線/parse 失敗 throw)', async (_l, rows) => {
    const { client } = makeClient({ query: async () => rows });
    await expect(
      new PgChargeAttemptAdapter('conn', () => client).recordInitiationBankTxn(ATTEMPT, ORDER, BANK_TXN),
    ).rejects.toThrow('回應格式異常');
  });

  it('RPC RAISE(P0001、撞 UNIQUE / guard 拒)→ throw 帶 code=P0001、通用訊息不含 pg 原文', async () => {
    const { client } = makeClient({
      query: async () => {
        throw Object.assign(new Error('record_charge_bank_txn: 付款處理失敗'), { code: 'P0001' });
      },
    });
    await expect(
      new PgChargeAttemptAdapter('conn', () => client).recordInitiationBankTxn(ATTEMPT, ORDER, BANK_TXN),
    ).rejects.toMatchObject({ code: PG_BUSINESS_REJECT, message: expect.stringContaining('主軌失敗') });
  });
});

describe('PgChargeAttemptAdapter.recordInitiationRec(charge 後寫 rec、維持 pending)', () => {
  it('RPC true → resolve;params=[attemptId, orderId, recTradeId]、SQL 呼 record_charge_pending_rec(三 cast)', async () => {
    const { client, query, end } = makeClient({ query: async () => boolRows(true) });
    await new PgChargeAttemptAdapter('conn', () => client).recordInitiationRec(ATTEMPT, ORDER, REC);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toMatch(/record_charge_pending_rec\(\$1::uuid, \$2::uuid, \$3::text\)/);
    expect(values).toEqual([ATTEMPT, ORDER, REC]);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('🔴 RPC false(未 durable)→ throw 未 durable(use-case best-effort catch→log)', async () => {
    const { client } = makeClient({ query: async () => boolRows(false) });
    await expect(
      new PgChargeAttemptAdapter('conn', () => client).recordInitiationRec(ATTEMPT, ORDER, REC),
    ).rejects.toThrow('未 durable');
  });

  it.each([
    ['result 非 boolean(字串)', boolRows('false')],
    ['空 rows', { rows: [] as Array<Record<string, unknown>> }],
  ])('回應形狀不符(%s)→ throw 通用訊息', async (_l, rows) => {
    const { client } = makeClient({ query: async () => rows });
    await expect(
      new PgChargeAttemptAdapter('conn', () => client).recordInitiationRec(ATTEMPT, ORDER, REC),
    ).rejects.toThrow('回應格式異常');
  });
});

// ── M-3 3DS 乙路 R2a:get_active 反查 parser 對 released + released failure observation RPC ──────────

/** get_active_charge_attempt RPC jsonb 完整對帳欄(parseActiveAttempt 必填鍵齊全)。 */
const ACTIVE_BASE = {
  attempt_id: ATTEMPT,
  attempt_created_at: '2026-06-25T00:00:00.000Z',
  rec_trade_id: REC,
  bank_transaction_id: BANK_TXN,
  order_total: 1500,
  order_payment_status: 'unpaid',
  order_display_id: 'PCM-2026-0099',
};

describe('PgChargeAttemptAdapter.findActiveByOrderId(parseActiveAttempt;R2a active 集含 released)', () => {
  it.each(['pending', 'charged', 'released'] as const)(
    '🔴 status=%s → 解析成功(released = R2a 新放行、原僅 pending/charged 會 throw)',
    async (status) => {
      const { client, query } = makeClient({
        query: async () => beginRows({ ...ACTIVE_BASE, status }),
      });
      const res = await new PgChargeAttemptAdapter('conn', () => client).findActiveByOrderId(ORDER);
      expect(res).toEqual({
        attemptId: ATTEMPT,
        status,
        recTradeId: REC,
        bankTransactionId: BANK_TXN,
        attemptCreatedAt: '2026-06-25T00:00:00.000Z',
        orderTotal: 1500,
        orderPaymentStatus: 'unpaid',
        orderDisplayId: 'PCM-2026-0099',
      });
      const [sql, values] = query.mock.calls[0]!;
      expect(sql).toContain('get_active_charge_attempt');
      expect(values).toEqual([ORDER]);
    },
  );

  it('RPC NULL → null(無單 / 無 active attempt)', async () => {
    const { client } = makeClient({ query: async () => ({ rows: [{ result: null }] }) });
    const res = await new PgChargeAttemptAdapter('conn', () => client).findActiveByOrderId(ORDER);
    expect(res).toBeNull();
  });

  it('🔴 未知 status(非 pending/charged/released)→ throw 通用訊息(fail-closed、不靜默放行)', async () => {
    const { client } = makeClient({ query: async () => beginRows({ ...ACTIVE_BASE, status: 'weird' }) });
    await expect(
      new PgChargeAttemptAdapter('conn', () => client).findActiveByOrderId(ORDER),
    ).rejects.toThrow('回應格式異常');
  });
});

describe('PgChargeAttemptAdapter.recordReleasedFailureObservation(R2a、三參數雙鍵、RETURNS void)', () => {
  it('resolve;params=[attemptId, orderId, observedStatus]、SQL 呼 record_released_failure_observation(uuid,uuid,integer)', async () => {
    const { client, query, connect, end } = makeClient({ query: async () => ({ rows: [] }) });
    await new PgChargeAttemptAdapter('conn', () => client).recordReleasedFailureObservation(ATTEMPT, ORDER, 5);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toMatch(/record_released_failure_observation\(\$1::uuid, \$2::uuid, \$3::integer\)/);
    expect(values).toEqual([ATTEMPT, ORDER, 5]);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1); // finally 永遠釋放
  });

  it('🔴 RPC RAISE(P0001、fail-closed:非 -1/5 / 雙鍵不符 / 非 released / 已付款)→ throw code=P0001、通用訊息不含 pg 原文', async () => {
    const { client } = makeClient({
      query: async () => {
        throw Object.assign(new Error('record_released_failure_observation: 付款處理失敗'), { code: 'P0001' });
      },
    });
    await expect(
      new PgChargeAttemptAdapter('conn', () => client).recordReleasedFailureObservation(ATTEMPT, ORDER, -1),
    ).rejects.toMatchObject({ code: PG_BUSINESS_REJECT, message: expect.stringContaining('主軌失敗') });
  });
});
