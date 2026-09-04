import { readFileSync } from 'node:fs';
import path from 'node:path';
// node env;mock 'server-only'(adapter 檔頭 import 'server-only')。
import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { PgChargeAttemptAdapter, PG_BUSINESS_REJECT } from './PgChargeAttemptAdapter';
import type { PgClientLike } from './PaymentConfirmerAdapter';

const ORDER = 'order-uuid-1';
const ATTEMPT = 'attempt-uuid-1';
const TOKEN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
// 🔴 刻意與 ORDER 不同值:同值會讓「回錯單」這一族錯誤看不出來(fixture 撞號 = 守門恆真)。
const IN_FLIGHT_ORDER = 'order-uuid-in-flight-9';

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

  // ── 🔴 M-4b L4:user_in_flight 的 in_flight_order_id(server-only、migration 20260809210000)──
  //    plan §5-6:這裡只有 **app 新 × DB 舊**(6a)有真正的單元證據;
  //    「DB 新 × app 舊」那個方向靠的是舊 parser 不讀未知 key 的既有形狀,單元測試證不到。

  it('🔴 6a(app 新 × DB 舊):payload **無** in_flight_order_id → 不帶 inFlight(不 throw)', async () => {
    // migration 未 apply 時的真實 payload。這一格是「L4b 先上線也不會壞」的唯一證據:
    // 沒有 inFlight ⇒ action 層即時對帳整段 skip ⇒ 退回今天的行為。
    const { client } = makeClient({
      query: async () => beginRows({ acquired: false, reason: 'user_in_flight' }),
    });
    const res = await new PgChargeAttemptAdapter('conn', () => client).begin(ORDER);
    expect(res).toStrictEqual({ acquired: false, reason: 'user_in_flight' }); // 見下方 toEqual 的坑
    expect('inFlight' in res).toBe(false); // 突變:把該欄改必填 ⇒ 上一行 throw、本格紅
  });

  // ⚠️ 這一格**不是**「DB 新 × app 舊」(codex 關卡2 抓到我的標籤說謊):它跑的是本片的新 parser
  //    ⇒ 實際測到的是 **DB 新 × app 新**。真正的「DB 新 × app 舊」要拿 L4a-2 之前的 parser 來跑,
  //    那不是單元測試證得了的東西 —— 它的依據是「舊 parser 不讀未知 key」這個既有形狀(靜態論證)。
  //    ⇒ 在寫出那格之前,**不得宣稱兩個方向都有單元測試**。
  it('🔴 DB 新 × app 新:payload **帶** in_flight_order_id → 解析出 inFlight.orderId', async () => {
    const { client } = makeClient({
      query: async () =>
        beginRows({ acquired: false, reason: 'user_in_flight', in_flight_order_id: IN_FLIGHT_ORDER }),
    });
    const res = await new PgChargeAttemptAdapter('conn', () => client).begin(ORDER);
    expect(res).toEqual({
      acquired: false,
      reason: 'user_in_flight',
      inFlight: { orderId: IN_FLIGHT_ORDER },
    });
  });

  it('🔴 in_flight_order_id **只**掛在 user_in_flight;order_locked 帶了也不得長出 inFlight', async () => {
    // 型別層已用 discriminated union 擋住,但 RPC 是 runtime 邊界 —— 型別擋不到真的送進來的 payload。
    // 沒有這一格,「哪天有人在 order_locked 也塞這個欄」會被靜默接受。
    const { client } = makeClient({
      query: async () =>
        beginRows({ acquired: false, reason: 'order_locked', in_flight_order_id: IN_FLIGHT_ORDER }),
    });
    const res = await new PgChargeAttemptAdapter('conn', () => client).begin(ORDER);
    // 🔴 toStrictEqual + `in` 兩道(codex 關卡2):`toEqual` **忽略值為 undefined 的 key**
    //    ⇒ 回 `{..., inFlight: undefined}` 時它照樣綠,但那個欄已經存在、契約已經破。
    expect(res).toStrictEqual({ acquired: false, reason: 'order_locked' });
    expect('inFlight' in res).toBe(false);
  });

  it.each([
    ['null(新 migration 在 IF FOUND 內必填 ⇒ null = 契約違反,不當成舊版)', null],
    ['數字', 123],
    ['物件', { orderId: 'x' }],
    ['false', false],
    ['空字串', ''],
  ])(
    '🔴 in_flight_order_id 型別/值不合(%s)→ fail-closed throw、**不**靜默降級成「舊 migration」',
    async (_label, bad) => {
      // 靜默降級的後果:一個真的壞掉的 RPC 看起來只是「版本比較舊」,
      // 即時對帳安靜地永遠不跑,而且沒有任何症狀。
      const { client } = makeClient({
        query: async () =>
          beginRows({ acquired: false, reason: 'user_in_flight', in_flight_order_id: bad }),
      });
      await expect(new PgChargeAttemptAdapter('conn', () => client).begin(ORDER)).rejects.toThrow(
        '回應格式異常',
      );
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

// 🔴 L5b-2 片2a:第四欄 superseded_at。fixture 用 **`Date` 物件**,不是字串 ——
//    node-postgres 對 timestamptz 欄回的就是 Date(2026-08-11 實測)。
//    用字串當 fixture 會讓這組測試對真實驅動行為失去判別力(fixture 撒謊型假綠)。
const SUP_AT = new Date('2026-08-10T15:04:05.678Z');
const STUCK_ROW = { attempt_id: ATTEMPT, order_id: ORDER, settle_attempt_count: 2, superseded_at: null };
const EXPIRED_ROW = { attempt_id: ATTEMPT, order_id: ORDER, needs_manual_review: true };

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
      { attemptId: ATTEMPT, orderId: ORDER, settleCount: 2, supersededAt: null },
      { attemptId: ATTEMPT, orderId: ORDER, settleCount: 5, supersededAt: null },
    ]);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toMatch(/claim_stuck_unsettled_attempts\(\$1::integer, \$2::integer\)/); // 🔴 鎖 cast
    // 🔴 鎖**完整 projection 字面**,不是只鎖 `superseded_at` 出現過(對抗審查 R1 打中):
    //    只鎖欄名時,把它改成 `NULL::timestamptz AS superseded_at` 照樣綠,
    //    而正式環境會永遠拿到 null ⇒ 補償線靜默跳過每一筆。
    // ⚠️ 對抗審查 R2 指出這樣鎖得偏死(未來合法地改欄序/加第五欄/加 alias 都會紅)。**刻意保留**:
    //    這是一支**正在收錢的 RPC 的 projection**,改它應該是有意識的動作,順手改到就該有一格逼你回頭看。
    //    代價是那種改動要同步改本行 —— 這個成本我們認,它換到的是「恆 NULL 這種改法殺得掉」。
    expect(sql).toContain(
      'SELECT attempt_id, order_id, settle_attempt_count, superseded_at FROM public.claim_stuck_unsettled_attempts',
    );
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
    // 🔴 L5b-2 片2a:第四欄的三種壞法各一發
    //    ①**row 上沒有這個 key**。⚠️ 這格證的是「parser 拒絕畸形回應」,
    //      **不是**「migration 未 apply 的長相」—— 對抗審查 R1 更正了我原本的說法:
    //      migration 未 apply 時,`SELECT … superseded_at` 會在 **PG 端就 42703(column does not exist)**,
    //      根本進不到 parser。真正的錯序防線是**發布順序**(見 IChargeAttemptStore 該方法註解),不是這一格。
    //      這格仍要留:它擋的是「RPC 回了少一欄的 row」那種畸形,而把它讀成「未讓路」會讓補償線安靜空轉。
    ['superseded_at 這個 key 不在 row 上(畸形回應)', { attempt_id: ATTEMPT, order_id: ORDER, settle_attempt_count: 2 }],
    //    ②字串(照抄 jsonb 路徑那種寫法時會拿到的東西)⇒ 也要紅,不得默默接受
    ['superseded_at 是字串而非 Date', { ...STUCK_ROW, superseded_at: '2026-08-10T15:04:05.678Z' }],
    //    ③Invalid Date:toISOString() 會丟 RangeError ⇒ 在 parse 就 fail-closed
    ['superseded_at 是 Invalid Date', { ...STUCK_ROW, superseded_at: new Date('nope') }],
  ])('SETOF 列形狀不符(%s)→ throw 通用(fail-closed)', async (_l, row) => {
    const { client } = makeClient({ query: async () => ({ rows: [row] }) });
    await expect(
      new PgChargeAttemptAdapter('conn', () => client).claimStuckUnsettled(600, 50),
    ).rejects.toThrow('回應格式異常');
  });

  // 🔴 42703(應用層先於 migration 上線)必須換成自我診斷訊息,而不是原樣拋 PG 錯。
  //    ⚠️ 這格證的是**訊息可診斷**,不是「錯序被擋住了」——沒有任何東西擋得住錯序上線(見 port 註解)。
  it('42703(舊三欄 RPC)→ 錯誤訊息指名 migration 20260811060000', async () => {
    const pgErr = Object.assign(new Error('column "superseded_at" does not exist'), { code: '42703' });
    const { client } = makeClient({
      query: async () => {
        throw pgErr;
      },
    });
    await expect(
      new PgChargeAttemptAdapter('conn', () => client).claimStuckUnsettled(600, 50),
    ).rejects.toThrow('20260811060000');
  });

  it('其他 PG 錯誤(非 42703)走既有分類、**不被誤標**成 migration 問題', async () => {
    // 🔴 期望值是實跑校正過的:本 adapter 的 `run()` 外層本來就把 PG 錯誤包成
    //    `charge 簿記主軌失敗(<code>)`,不會原樣透出 PG 的訊息。我第一版寫成期望
    //    'deadlock detected' 是**我對既有分層的假設寫錯**,不是程式行為錯 —— 照實跑結果改。
    //    這一格真正要釘的是:**40P01 不可以被貼上 migration 未 apply 的標籤**。
    const pgErr = Object.assign(new Error('deadlock detected'), { code: '40P01' });
    const { client } = makeClient({
      query: async () => {
        throw pgErr;
      },
    });
    const run = new PgChargeAttemptAdapter('conn', () => client).claimStuckUnsettled(600, 50);
    await expect(run).rejects.toThrow('40P01');
    await expect(run).rejects.not.toThrow('20260811060000');
  });

  // 🔴 正向那一側:讓路的列必須把**該列真正的時間**帶出來(轉 ISO 字串),不是被塞成 null。
  //    與上面「未讓路 → null」成對 —— 少了任一半,「回傳寫死一個值」都會全綠。
  it('讓路的列 → supersededAt = 該 Date 的 ISO 字串(未讓路那列仍為 null)', async () => {
    const { client } = makeClient({
      query: async () => ({ rows: [{ ...STUCK_ROW, superseded_at: SUP_AT }, STUCK_ROW] }),
    });
    const res = await new PgChargeAttemptAdapter('conn', () => client).claimStuckUnsettled(600, 50);
    expect(res.map((r) => r.supersededAt)).toEqual(['2026-08-10T15:04:05.678Z', null]);
  });
});

describe('PgChargeAttemptAdapter.claimExpiredPendingAttempts(12h 孤兒原子 claim、B1a)', () => {
  it('SETOF → 映 ExpiredOrphanAttempt[];SQL 鎖 claim_expired_pending_attempts($1::integer)、參數=[limit]', async () => {
    const { client, query, connect, end } = makeClient({
      query: async () => ({ rows: [EXPIRED_ROW, { ...EXPIRED_ROW, needs_manual_review: false }] }),
    });
    const res = await new PgChargeAttemptAdapter('conn', () => client).claimExpiredPendingAttempts(50);
    expect(res).toEqual([
      { attemptId: ATTEMPT, orderId: ORDER, needsManualReview: true },
      { attemptId: ATTEMPT, orderId: ORDER, needsManualReview: false },
    ]);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toMatch(/claim_expired_pending_attempts\(\$1::integer\)/); // 🔴 鎖 cast
    expect(sql).toMatch(/needs_manual_review/); // 🔴 回 needs_manual_review(B1 不清、僅觀察)
    expect(values).toEqual([50]);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('空 rows(本輪無 due)→ []', async () => {
    const { client } = makeClient({ query: async () => ({ rows: [] }) });
    expect(
      await new PgChargeAttemptAdapter('conn', () => client).claimExpiredPendingAttempts(50),
    ).toEqual([]);
  });

  it.each([
    ['attempt_id 非字串', { ...EXPIRED_ROW, attempt_id: 1 }],
    ['order_id 缺', { attempt_id: ATTEMPT, needs_manual_review: true }],
    ['needs_manual_review 非 boolean', { ...EXPIRED_ROW, needs_manual_review: 'true' }],
  ])('SETOF 列形狀不符(%s)→ throw 通用(fail-closed)', async (_l, row) => {
    const { client } = makeClient({ query: async () => ({ rows: [row] }) });
    await expect(
      new PgChargeAttemptAdapter('conn', () => client).claimExpiredPendingAttempts(50),
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

  // 🔴 M-3 RF2a:PAYMENT_STATUSES 是手抄的 fail-closed 白名單(readonly PaymentStatus[]),
  //    少列一個值**不是型別錯誤** ⇒ typecheck 抓不到。漏抄的後果不是顯示問題,而是
  //    該狀態訂單只要有 active charge attempt 就 ChargeAttemptParseError throw、付款流程直接斷。
  //    本測試**硬編碼全 5 值**(刻意不從 adapter 常數或型別衍生,否則同源假綠),
  //    PaymentStatus 加值而忘了同步該陣列時會轉紅。
  it.each([
    'unpaid',
    'paid',
    'partiallyPaid',
    'refunded',
    'partiallyRefunded',
  ] as const)('🔴 order_payment_status=%s → 解析成功(fail-closed 白名單須涵蓋全 enum)', async (ps) => {
    const { client } = makeClient({
      query: async () => beginRows({ ...ACTIVE_BASE, status: 'pending', order_payment_status: ps }),
    });
    const res = await new PgChargeAttemptAdapter('conn', () => client).findActiveByOrderId(ORDER);
    expect(res?.orderPaymentStatus).toBe(ps);
  });

  it('🔴 未知 payment_status 仍 fail-closed throw(白名單不是裝飾)', async () => {
    const { client } = makeClient({
      query: async () =>
        beginRows({ ...ACTIVE_BASE, status: 'pending', order_payment_status: 'bogus_status' }),
    });
    await expect(
      new PgChargeAttemptAdapter('conn', () => client).findActiveByOrderId(ORDER),
    ).rejects.toThrow();
  });

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

// ══ ⟦b4-MONEY2⟧ capture_state 那兩支 —— 2026-09-01 補 ═══════════════════════
//
// 🔴 **為什麼是這兩支而不是板上排 ① 的那支**:板列 `⟦b4-MONEY2⟧` 逐字寫
//    「11 支碰錢的 DB 函式,**應用碼在呼叫它**,而它一個測試都沒有」——
//    而 2026-09-01 逐支查呼叫端:**「應用碼在呼叫它」對 9 支不成立**。
//    真的有 TS 呼叫端的只有這兩支(本檔受測的 adapter `:143` / `:154`),
//    其餘 8 支只命中 `scripts/*-verify.sh` / `docs/` / 產生的 `database.types.ts`,
//    ⚠️ 加上 `admin_correct_refund_manual_verdict` 另有一處在 `apps/admin/.../refund-recovery-state.ts:74`
//    —— **那是一句註解,不是呼叫**(code-reviewer 補的偏差:原句寫「其餘是 scripts 與 docs」
//    **字面不全**,少了 `apps/admin/` 這一處)。
//    ⛔ ~~而 `redeem_coupon` **全 repo 零呼叫端**~~ 🔴 **那句錯了 —— 就地訂正(2026-09-01 08:5x)**:
//      它**有**呼叫端,而且在**結帳主線**上 —— `create_order` 這支 DB 函式呼叫它
//      (`20260901021000_m4b_coupon_p3b_create_order_redeem.sql`,`:12`/`:93`/`:270` 逐字提到試算呼叫)。
//      ⇒ 而我錯在**兩個地方**,兩個都是分母:
//        ① 我掃的是【應用碼】(`apps/**` `packages/**`)⇒ **呼叫它的是另一支 DB 函式**,不在我的分母裡
//        ② 🔴 更根本的:**我在自己那條落後的分支上量** —— 那支 `20260901021000` 當時
//           在我的工作樹裡**根本不存在**(`test -e` ⇒ 不在),而它在 `origin/dev` 上
//        ⇒ 📌 **一把尺量到 0,而它量的是一棵【比世界舊】的樹 —— 而那個 0 讀起來完全正常。**
//      ✅ 而 app 側**仍然是 0**:`origin/dev` 上 `apps+packages` 命中 3 處,**逐處開檔全是註解**
//        (`mappers/order.ts:88`/`:166`、`domain/src/order/types.ts:1632`,都在說「金額由 DB 那側算」)
//        🟢 正對照 同法查 `create_order` ⇒ **34 支** ⇒ 尺會動。
//      🛑 **⇒ 而結論的方向沒變**(它不該被排在真的在走的那兩支前面),
//        **變的是理由** —— 而 📌 **對的結論配上錯的證據,會讓下一個人推翻證據時連結論一起推翻。**
//    🔵 而「零測試」要講精確:這兩個【方法名】在 repo 內有 60+ 命中
//    (`recheck-capture-state.test.ts` / `settle-charge.test.ts` …),**而全部是 port mock**
//    ⇒ 一格都沒跑到本 adapter 的 SQL 與 parse ⇒ **正確的宣稱是「adapter 層 0」, 不是「0 命中」。**
//    📌 **⇒ 而那個差別正是這片要補的洞:port 層那些綠會讓人以為它們已經有測試了。**
//    ⇒ 📌 **排序把兩個沒有人在走的排在真的在走的前面 —— 那不是排序失誤,是前提是假的。**
//    盤點 `~/pcm-mailbox/段一-MONEY2那11支誰真的在走-20260901.md`。
//
// 🔵 **而這兩支走得到**:`PgChargeAttemptAdapter` ← `recheck-capture-state`
//    ← `apps/storefront/src/app/api/cron/capture-recheck/route.ts`,而
//    `packages/domain/src/ops/cron-jobs.ts` 登記 `pcm-capture-recheck` `*/10 * * * *`。
//    ⚠️ **而「登記」不等於「在跑」** —— 那是 `pg_cron`,在正式庫,本片驗不到。
//
// 🛑 **本片只加測試,不動 adapter 一個字。**
describe('PgChargeAttemptAdapter.recordCaptureState(⟦b4-MONEY2⟧ 補測)', () => {
  it('RPC true → 回 true;SQL 呼 record_charge_capture_state(三 cast)、params 三格', async () => {
    const { client, query, connect, end } = makeClient({ query: async () => boolRows(true) });
    const got = await new PgChargeAttemptAdapter('conn', () => client).recordCaptureState(
      ATTEMPT,
      ORDER,
      'captured',
    );
    expect(got).toBe(true);
    const [sql, values] = query.mock.calls[0]!;
    // 🔴 **釘 SQL 字面**:這支 RPC 是 `SECURITY DEFINER`(繞過 RLS),
    //    函式名或 cast 被改掉 ⇒ 打到的是另一支函式,而回傳型別相同 ⇒ 行為測試看不出來。
    expect(sql).toMatch(/record_charge_capture_state\(\$1::uuid, \$2::uuid, \$3::text\)/);
    expect(values).toEqual([ATTEMPT, ORDER, 'captured']);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1); // finally 永遠釋放
  });

  it('🔴 RPC false(雙鍵不符 / 查無)→ 回 false 而【不 throw】;而第三參數要原樣傳', async () => {
    const { client, query } = makeClient({ query: async () => boolRows(false) });
    // 🛑 這一格守的是「best-effort」那個設計:改成 throw 會讓一次寫不進去
    //    把整條 capture-recheck 掃描打斷,而那條掃描是每 10 分鐘跑的。
    await expect(
      new PgChargeAttemptAdapter('conn', () => client).recordCaptureState(ATTEMPT, ORDER, 'authorized'),
    ).resolves.toBe(false);
    // 🔴🔴 **這一行是 code-reviewer 抓到的真缺口**:上面那格輸入 `'captured'`、
    //    而 T3/T4 走 throw 路徑根本不看 values ⇒ **把第三參數寫死成 `'captured'` 的改法四格全綠**。
    //    ⇒ 後果:只授權未請款的單被記成 `captured`,而 RPC 值域檢查放行(兩個都是合法值)
    //      ⇒ 📌 **RAISE 不會叫, 而帳上那一格是錯的。**
    //    ⚠️ 而 use-case 那一側的 `recheck-capture-state.test.ts` 擋不住它 ——
    //      它斷言的是 use-case 對 **port mock** 的呼叫,不是 adapter 對 SQL 的轉發。
    expect(query.mock.calls[0]![1]).toEqual([ATTEMPT, ORDER, 'authorized']);
  });

  it.each([
    ['result 非 boolean(字串)', boolRows('true')],
    ['空 rows', { rows: [] as Array<Record<string, unknown>> }],
  ])('回應形狀不符(%s)→ throw,不回一個看起來像 false 的值', async (_l, rows) => {
    const { client } = makeClient({ query: async () => rows });
    // 🔴 **這一格與上一格是一對**:上面要「false 不 throw」,這裡要「壞掉要 throw」——
    //    少了這一格,一個把 parse 失敗吞成 `false` 的改法會全綠,
    //    而那會讓「RPC 說沒寫成」與「回應壞了」在呼叫端長得一樣。
    await expect(
      new PgChargeAttemptAdapter('conn', () => client).recordCaptureState(ATTEMPT, ORDER, 'captured'),
    ).rejects.toThrow('回應格式異常');
  });

  it('RPC RAISE(值域非 authorized|captured)→ throw 帶 code、通用訊息不含 pg 原文', async () => {
    const { client } = makeClient({
      query: async () => {
        throw Object.assign(new Error('record_charge_capture_state: 值域不合法'), { code: 'P0001' });
      },
    });
    await expect(
      new PgChargeAttemptAdapter('conn', () => client).recordCaptureState(ATTEMPT, ORDER, 'captured'),
    ).rejects.toMatchObject({ code: PG_BUSINESS_REJECT, message: expect.stringContaining('主軌失敗') });
  });
});

describe('PgChargeAttemptAdapter.listForCaptureRecheck(⟦b4-MONEY2⟧ 補測)', () => {
  const ROW = { attempt_id: ATTEMPT, order_id: ORDER, rec_trade_id: REC };

  it('三欄齊全 → snake→camel 映射;SQL 呼 list_charge_attempts_for_capture_recheck(兩 int cast)', async () => {
    const { client, query, end } = makeClient({ query: async () => ({ rows: [ROW, ROW] }) });
    const got = await new PgChargeAttemptAdapter('conn', () => client).listForCaptureRecheck(7, 50);
    expect(got).toEqual([
      { attemptId: ATTEMPT, orderId: ORDER, recTradeId: REC },
      { attemptId: ATTEMPT, orderId: ORDER, recTradeId: REC },
    ]);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toMatch(/list_charge_attempts_for_capture_recheck\(\$1::int, \$2::int\)/);
    // 🔴 **順序也要釘**:`(cutoffDays, limit)` 兩個都是 int,調換不會型別錯,
    //    而它會把「掃 7 天最多 50 筆」變成「掃 50 天最多 7 筆」—— 兩者都回一個合法的結果。
    expect(values).toEqual([7, 50]);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('空集合 → 回 []', async () => {
    const { client } = makeClient({ query: async () => ({ rows: [] }) });
    await expect(
      new PgChargeAttemptAdapter('conn', () => client).listForCaptureRecheck(7, 50),
    ).resolves.toEqual([]);
  });

  it.each([
    ['attempt_id 不是字串', { ...ROW, attempt_id: 123 }],
    ['order_id 是 null', { ...ROW, order_id: null }],
    ['rec_trade_id 缺欄', { attempt_id: ATTEMPT, order_id: ORDER }],
  ])('🔴 形狀不對(%s)→ throw,而【不是】回一個看起來像空集合的結果', async (_l, bad) => {
    const { client } = makeClient({ query: async () => ({ rows: [bad] }) });
    // 🛑 adapter 註解逐字:「不回一個『看起來像空集合』的結果 —— 那會讓【掃不到】與【掃壞了】
    //    在呼叫端長得一樣」。而這條掃描的呼叫端是排程 ⇒ **沒有人在看它回幾筆。**
    //
    // 🔴🔴 **而這一格【記錄的是現況,不是我想要的行為】——我第一版寫 `.toThrow('回應形狀異常')` 而它紅了:**
    //    `run()` 把錯誤丟進 `sanitizeError()`,而它**只憑類別放行** `ChargeAttemptParseError`
    //    / `ChargeAttemptNotDurableError` 兩種。而 `listForCaptureRecheck` 丟的是**一個裸的
    //    `new Error(...)`** ⇒ 被包成 `charge 簿記主軌失敗(transport)`。
    //    ⇒ 📌 **所以「形狀壞了」在呼叫端與「連線斷了」長得一樣** —— 而那正是這支函式
    //      自己的註解說要避免的那件事,只是它避免的是「與空集合長一樣」,沒避免「與斷線長一樣」。
    //    🛑 **本片不動 adapter(只寫測試)⇒ 這一格釘住現況,而那個不對稱另案處理。**
    //    🔵 對照組就在隔壁:`recordCaptureState` 的形狀錯走 `parseBooleanResult`
    //      ⇒ 丟 branded ⇒ 訊息**保留**成「回應格式異常」。**同一支 adapter,兩種待遇。**
    await expect(
      new PgChargeAttemptAdapter('conn', () => client).listForCaptureRecheck(7, 50),
    ).rejects.toThrow('主軌失敗');
  });

  it('🟢 負對照:一列好的 + 一列壞的 → 仍然 throw(不得只回好的那一列)', async () => {
    // 🔴 這一格證明上面那三格不是靠「整批都壞」才紅 ——
    //    一個「跳過壞列、回好列」的改法會讓那三格全綠,而它正是最像善意的那種改法。
    const { client } = makeClient({ query: async () => ({ rows: [ROW, { ...ROW, order_id: 7 }] }) });
    await expect(
      new PgChargeAttemptAdapter('conn', () => client).listForCaptureRecheck(7, 50),
    ).rejects.toThrow('主軌失敗');
  });

  it('🟢 好列在前、壞列在後 ⇒ 仍然 throw,而連線仍然被釋放', async () => {
    // ⛔ ~~本格原本還有一行 `rejects.not.toBeInstanceOf(Array)`~~ **刪掉了 —— 它是恆真的**
    //    (code-reviewer 抓到):上一行已斷言 `toBeInstanceOf(Error)`,而 Error 永遠不是 Array
    //    ⇒ 它只在上一行已經紅的時候才可能紅。而我寫的理由(「不得已經 resolve」)
    //    **`rejects` 自己就守完了** ⇒ 📌 **那一格的【理由】與它【實際做的事】是兩件事。**
    const { client, end } = makeClient({ query: async () => ({ rows: [ROW, { ...ROW, attempt_id: null }] }) });
    await expect(
      new PgChargeAttemptAdapter('conn', () => client).listForCaptureRecheck(7, 50),
    ).rejects.toBeInstanceOf(Error);
    // 🔴🔴 **這一行補的是【全檔既有】的空缺**(code-reviewer 抓到):本檔 9 處
    //    `end).toHaveBeenCalled` **全在成功路徑,錯誤路徑零斷言**
    //    ⇒ 把 `await client.end()` 從 `finally` 搬進 `try`,**全檔照樣全綠**。
    //    ⇒ 而這條掃描每 10 分鐘跑、遇壞列必 throw ⇒ 📌 **那會每次漏一條 pg 連線。**
    expect(end).toHaveBeenCalledTimes(1);
  });
});

/**
 * `begin_charge_attempt` 的 reason 值域 · **三邊契約**(2026-09-05, 板列 `⟦b4-PIECEBGATEGAPS⟧` ①)。
 *
 * 🔴 **為什麼要有它**:板上 ① 原本寫「`not_card_order` TS 那側不認識」——
 *    而它**已經被 `51c99010b` 補掉了**(-mail 09-05 順手收, 板未動)。
 *    🛑 **而它留下的是**:那組值域**一個測試都沒有在守**
 *    (當場量:`grep -rl not_card_order --include='*.test.ts'` ⇒ **0**;
 *     🟢 正對照 同尺找 `user_in_flight` ⇒ **4** ⇒ 尺會動)。
 *    ⇒ 📌 **它剛被修好一次, 而【下一次同樣的事發生時, 還是沒有東西會叫】。**
 *
 * 🔬 **而 adapter 那側是【兩段】不是一段** —— 我第一版差點報成缺陷:
 * ```
 * DB(20260904050000 的 begin_charge_attempt)回【六個】reason
 * :323 duplicate      早退 return   ┐
 * :335 needs_settle   早退 return   ┘ 這兩個【不在】:361 的白名單裡, 而那是對的
 * :361 白名單四個:user_in_flight / order_locked / not_unpaid / not_card_order
 * ```
 * ⇒ 🎯 **所以契約不是「DB 六值 = 白名單」, 是【DB 六值 = 早退兩值 ∪ 白名單四值】。**
 *    這樣寫的好處:DB **多回任何一個新 reason**, 不論它該走哪一條分支, 這一格都會紅。
 *
 * 🛑 **天花板**:三邊都是讀【repo 裡的字面】——
 *    ① SQL 那邊是 migration 檔, **不是正式庫**(Sean 手貼, 檔與庫可以分岔而本格印綠)
 *    ② TS 兩邊是原始碼字面, 不是編譯後的型別(`ChargeLockReason` 是純型別 union, 執行期不存在)
 */
describe('begin_charge_attempt reason 值域 · DB ↔ adapter ↔ domain 三邊', () => {
  const ROOT = path.resolve(__dirname, '../../../..');
  const MIG = path.join(ROOT, 'supabase/migrations/20260904050000_m4b_supersede_bank_order_on_card.sql');
  const ADAPTER = path.join(ROOT, 'packages/adapters/src/payment/PgChargeAttemptAdapter.ts');
  const DOMAIN = path.join(ROOT, 'packages/domain/src/payment/types.ts');

  /** 🔴 先剝【區塊】再剝【行】註解 —— 反過來會讓 `--` 吃掉區塊的結尾標記。 */
  const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');

  function dbReasons(): string[] {
    const body = codeOnly(readFileSync(MIG, 'utf8'));
    return [...new Set([...body.matchAll(/'reason',\s*'([a-z_]+)'/g)].map((m) => m[1]!))].sort();
  }
  function adapterEarly(): string[] {
    const body = readFileSync(ADAPTER, 'utf8').replace(/\/\/[^\n]*/g, '');
    return [...new Set([...body.matchAll(/r\.reason === '([a-z_]+)'/g)].map((m) => m[1]!))].sort();
  }
  function adapterWhitelist(): string[] {
    const body = readFileSync(ADAPTER, 'utf8').replace(/\/\/[^\n]*/g, '');
    return [...new Set([...body.matchAll(/r\.reason !== '([a-z_]+)'/g)].map((m) => m[1]!))].sort();
  }
  function domainUnion(): string[] {
    const body = readFileSync(DOMAIN, 'utf8').replace(/\/\/[^\n]*/g, '');
    const m = body.match(/export type ChargeLockReason\s*=([\s\S]*?);/);
    return [...new Set([...(m?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!))].sort();
  }

  it('🔵 前提:四把尺都抓得到東西(抓不到 ⇒ 是尺壞了, 不是「三邊一致」)', () => {
    expect(dbReasons().length).toBeGreaterThan(0);
    expect(adapterEarly().length).toBeGreaterThan(0);
    expect(adapterWhitelist().length).toBeGreaterThan(0);
    expect(domainUnion().length).toBeGreaterThan(0);
  });

  it('🔴 DB 的 reason 值域 = adapter 的【早退分支 ∪ 白名單】—— 多一個少一個都要紅', () => {
    // 🎯 這樣寫 ⇒ DB 多回任何一個新 reason, 不論它該走哪條分支, 這一格都會紅。
    expect([...new Set([...adapterEarly(), ...adapterWhitelist()])].sort()).toEqual(dbReasons());
  });

  it('🔴 adapter 的白名單四值 = domain 的 ChargeLockReason union', () => {
    // 🔵 早退那兩個【不在】union 裡 —— 它們有自己的回傳形狀(帶 existing_* 欄位)。
    expect(adapterWhitelist()).toEqual(domainUnion());
  });

  it('🔴 而那些相等不是空對空 —— 六個值逐字都要在 DB 那邊', () => {
    for (const v of ['user_in_flight', 'order_locked', 'not_unpaid', 'not_card_order', 'duplicate', 'needs_settle']) {
      expect(dbReasons()).toContain(v);
    }
  });

  it('🔵 尺會動:把 DB 那組去掉一個 ⇒ 上面那格必須翻面', () => {
    // 🔴 沒有這一格,「三邊一致」與「抽取器回了空的」印同一個綠。
    const shrunk = dbReasons().filter((v) => v !== 'not_card_order');
    expect([...new Set([...adapterEarly(), ...adapterWhitelist()])].sort()).not.toEqual(shrunk);
  });

  it('🔵 剝註解那步真的在做事:註解裡的假 reason 不得被抽到', () => {
    const fake = "-- RETURN jsonb_build_object('reason', 'zzq_ghost')\nRETURN x('reason', 'real');";
    const got = [...codeOnly(fake).matchAll(/'reason',\s*'([a-z_]+)'/g)].map((m) => m[1]!);
    expect(got).toEqual(['real']);
  });
});
