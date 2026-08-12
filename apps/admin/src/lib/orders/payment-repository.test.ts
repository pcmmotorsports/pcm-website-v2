import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { createSupabaseServiceClient } = vi.hoisted(() => ({
  createSupabaseServiceClient: vi.fn(),
}));

vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient }));

import {
  listOrderPayments,
  PaymentListShapeError,
  PaymentWroteButUnreadableError,
  recordManualPayment,
  reverseManualPayment,
} from './payment-repository';

// payment-repository.test.ts — #15-B2-a(讀)+ B2-b(寫)。
//
// 🔴 本檔守的是**三態不可混為一談**與**形狀 fail-closed**。
//    這兩件事一旦壞掉,症狀都是「畫面說沒有收款」,而員工會照著再登一次 ⇒ 重複入帳。
//    ⚠️ 誠實邊界:mock 證不了 RPC 真的回什麼 —— 它只證「回這個形狀時我們怎麼處理」。
//    090000 **已 apply**,但本檔對它**零真實往返**;真契約要等 B2-b 接上畫面、真的讀一次才驗得到。

function makeClient(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  createSupabaseServiceClient.mockReturnValue({ rpc });
  return rpc;
}

const ROW = {
  id: 'p1',
  rail: 'cash',
  amount: 100,
  received_at: '2026-08-01T02:00:00+00:00',
  created_at: '2026-08-01T02:00:00+00:00',
  actor: 'staff:sean',
  bank_reference: null,
  rec_trade_id: null,
  payer_note: null,
  reverses_payment_id: null,
  reversal_reason: null,
  is_reversal: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  // 🔴 每一支 mock 都要進這個清單:漏一支 ⇒ 呼叫次數跨測試累加,
  //    症狀長得像被測程式多跑一次,而你會去修一個不存在的 bug(四代教訓)。
  createSupabaseServiceClient.mockReset();
});

describe('三態必須分得開', () => {
  it('SQL NULL ⇒ null(訂單不存在),**不得**收斂成空陣列', async () => {
    makeClient({ data: null, error: null });
    await expect(listOrderPayments('o1')).resolves.toBeNull();
  });

  it('空陣列 ⇒ [](訂單在、還沒收款)', async () => {
    makeClient({ data: [], error: null });
    await expect(listOrderPayments('o1')).resolves.toEqual([]);
  });

  it('error ⇒ 拋(讀取失敗),**不得**回空陣列', async () => {
    makeClient({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(listOrderPayments('o1')).rejects.toThrow(/42501/);
  });

  // 突變靶:把 `if (data === null) return null` 改成 `return []` ⇒ 第一格轉紅、其餘不動。
  it('null 與 [] 的回傳值本身不相等(這兩態在下游要能分辨)', async () => {
    makeClient({ data: null, error: null });
    const notFound = await listOrderPayments('o1');
    makeClient({ data: [], error: null });
    const empty = await listOrderPayments('o1');
    expect(notFound).not.toEqual(empty);
  });
});

describe('形狀 fail-closed(錢的帳不寬容)', () => {
  it('正常列解析成 camelCase', async () => {
    makeClient({ data: [ROW], error: null });
    const rows = await listOrderPayments('o1');
    expect(rows?.[0]).toMatchObject({ id: 'p1', rail: 'cash', amount: 100, isReversal: false });
  });

  it('amount 是浮點 ⇒ 拋(欄位是 int4 整數元,浮點代表管線壞了)', async () => {
    makeClient({ data: [{ ...ROW, amount: 100.5 }], error: null });
    await expect(listOrderPayments('o1')).rejects.toBeInstanceOf(PaymentListShapeError);
  });

  it('amount 是字串 ⇒ 拋(不得靠 JS 隱式轉型矇混)', async () => {
    makeClient({ data: [{ ...ROW, amount: '100' }], error: null });
    await expect(listOrderPayments('o1')).rejects.toBeInstanceOf(PaymentListShapeError);
  });

  it('🔴 is_reversal 不是 boolean ⇒ 拋 —— 它是「不准看金額正負」那條規則的唯一依據', async () => {
    makeClient({ data: [{ ...ROW, is_reversal: 'true' }], error: null });
    await expect(listOrderPayments('o1')).rejects.toBeInstanceOf(PaymentListShapeError);
  });

  it('少一個必填欄 ⇒ 拋(不得靜默補預設值)', async () => {
    const { actor: _actor, ...noActor } = ROW;
    makeClient({ data: [noActor], error: null });
    await expect(listOrderPayments('o1')).rejects.toBeInstanceOf(PaymentListShapeError);
  });

  it('回傳既不是陣列也不是 null ⇒ 拋', async () => {
    makeClient({ data: { rows: [] }, error: null });
    await expect(listOrderPayments('o1')).rejects.toBeInstanceOf(PaymentListShapeError);
  });

  it('🔴 nullable 欄位的**鍵不存在** ⇒ 拋(那是欄位沒回來,不是「這筆沒填」)', async () => {
    const { payer_note: _note, ...noNote } = ROW;
    makeClient({ data: [noNote], error: null });
    await expect(listOrderPayments('o1')).rejects.toBeInstanceOf(PaymentListShapeError);
  });

  it('nullable 欄位收 null(正常),收數字則拋', async () => {
    makeClient({ data: [{ ...ROW, payer_note: null }], error: null });
    await expect(listOrderPayments('o1')).resolves.not.toBeNull();
    makeClient({ data: [{ ...ROW, payer_note: 123 }], error: null });
    await expect(listOrderPayments('o1')).rejects.toBeInstanceOf(PaymentListShapeError);
  });
});

describe('呼叫面', () => {
  it('用具名參數 p_order_id 呼叫那支 RPC', async () => {
    const rpc = makeClient({ data: [], error: null });
    await listOrderPayments('order-42');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('admin_list_order_payments', { p_order_id: 'order-42' });
  });
});

// ── B2-b:寫入(`admin_record_manual_payment`)────────────────────────────────

const OK = { recorded: true, idempotent: false, payment_id: 'pay-1' };

const BANK_ARGS = {
  rail: 'bank_transfer',
  orderId: 'o1',
  requestId: 'r1',
  actor: 'staff:sean',
  amount: 1180,
  receivedAt: '2026-08-11T00:00:00+08:00',
  bankReference: '國泰 12345',
  payerNote: null,
} as const;

const CASH_ARGS = {
  rail: 'cash',
  orderId: 'o1',
  requestId: 'r1',
  actor: 'staff:sean',
  amount: 500,
  receivedAt: '2026-08-11T06:30:00.000Z',
  payerNote: '現場付',
} as const;

describe('🔴 送出去的 args(DEFAULT NULL 的鍵要整個省掉,不是送 null)', () => {
  it('匯款軌:七個鍵,含 p_bank_reference', async () => {
    const rpc = makeClient({ data: OK, error: null });
    await recordManualPayment(BANK_ARGS);
    const [fn, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(fn).toBe('admin_record_manual_payment');
    expect(args).toEqual({
      p_order_id: 'o1',
      p_request_id: 'r1',
      p_actor: 'staff:sean',
      p_amount: 1180,
      p_received_at: '2026-08-11T00:00:00+08:00',
      p_rail: 'bank_transfer',
      p_bank_reference: '國泰 12345',
    });
    // 🔴 `payerNote: null` ⇒ 那個鍵**不存在**(不是 `undefined`):
    //    生成型別是 `p_payer_note?: string`,送 null 會是型別謊、也讓 DEFAULT NULL 那條路失效。
    expect(Object.keys(args)).not.toContain('p_payer_note');
  });

  it('現金軌:連 p_bank_reference 這個鍵都不存在(型別上就送不出「現金帶單號」)', async () => {
    const rpc = makeClient({ data: OK, error: null });
    await recordManualPayment(CASH_ARGS);
    const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(args).toEqual({
      p_order_id: 'o1',
      p_request_id: 'r1',
      p_actor: 'staff:sean',
      p_amount: 500,
      p_received_at: '2026-08-11T06:30:00.000Z',
      p_rail: 'cash',
      p_payer_note: '現場付',
    });
    expect(Object.keys(args)).not.toContain('p_bank_reference');
  });

  // 🔴 「匯款軌單號留空」那一格**已經刪掉**(關卡2 codex MF2 折面):
  //    型別收緊成 `bankReference: string` 之後,那個輸入**編譯不過**
  //    (實測:改回傳 null 會噴 TS2322)⇒ 留著它就是在測一個構造不出來的輸入。
  //    真正的守門移到解析層(`payment-form.test.ts` 的「匯款軌單號空白 ⇒ 拒」兩格)+ 型別層。
});

describe('🔴 SQLSTATE 要**原樣帶出去**(收斂成 Error 就再也回不來)', () => {
  it.each(['P8C01', 'P2B38', 'P2B39', 'P2B40', 'P2B41', 'P0001', '42501'])(
    '%s ⇒ PaymentWriteError 且 sqlstate 逐字相同',
    async (code) => {
      makeClient({ data: null, error: { code, message: 'x' } });
      await expect(recordManualPayment(CASH_ARGS)).rejects.toMatchObject({
        name: 'PaymentWriteError',
        sqlstate: code,
      });
    },
  );

  it('連線層錯誤(沒有 code 這個鍵)⇒ sqlstate = null', async () => {
    makeClient({ data: null, error: { message: 'fetch failed' } });
    await expect(recordManualPayment(CASH_ARGS)).rejects.toMatchObject({
      name: 'PaymentWriteError',
      sqlstate: null,
    });
  });

  // 🔴 opus R2 nit5:**真實**的 client 端 fetch 失敗不是「缺鍵」,是 `code: ''`
  //    (postgrest-js `PostgrestBuilder.ts:378` 逐字 `let code = ''`、`:430` 原樣塞進 error)。
  //    這條路徑原本零覆蓋 ⇒ 補一格,並確認它經映射後落在「可能已經寫進去了」那句。
  it("🔴 真實 fetch 失敗形狀 `code:''` ⇒ sqlstate 是空字串(不是 null),映射成 error", async () => {
    makeClient({ data: null, error: { code: '', message: 'TypeError: fetch failed' } });
    await expect(recordManualPayment(CASH_ARGS)).rejects.toMatchObject({
      name: 'PaymentWriteError',
      sqlstate: '',
    });
  });
});

describe('🔴 成功 payload 形狀不完整 ⇒ 拋「已寫入但讀不懂」(error==null 不等於成功)', () => {
  // 🔴🔴 opus R2 MF2:這條路徑跑到的時候 **RPC 已經 COMMIT** ⇒ 拋的類別必須與讀路徑分得開,
  //    否則下游會給「沒有寫入」那句話,員工再登一次會帶**新的 request_id** ⇒ G8 擋不到 ⇒ 重複入帳。
  it('🔴 拋的**不是**讀路徑那個類別,而且帶得出 `wrote` 旗標', async () => {
    makeClient({ data: { recorded: true, idempotent: false }, error: null });
    await expect(recordManualPayment(CASH_ARGS)).rejects.toBeInstanceOf(
      PaymentWroteButUnreadableError,
    );
    makeClient({ data: { recorded: true, idempotent: false }, error: null });
    await expect(recordManualPayment(CASH_ARGS)).rejects.not.toBeInstanceOf(PaymentListShapeError);
    makeClient({ data: { recorded: true, idempotent: false }, error: null });
    await expect(recordManualPayment(CASH_ARGS)).rejects.toMatchObject({ wrote: true });
  });

  it('正常 payload ⇒ 回 paymentId + idempotent', async () => {
    makeClient({ data: { recorded: true, idempotent: true, payment_id: 'pay-9' }, error: null });
    await expect(recordManualPayment(CASH_ARGS)).resolves.toEqual({
      paymentId: 'pay-9',
      idempotent: true,
    });
  });

  it('🔴 recorded 不是 true ⇒ 拋(「錢沒記進去但畫面說記了」是最貴的形狀)', async () => {
    makeClient({ data: { recorded: false, idempotent: false, payment_id: 'pay-1' }, error: null });
    await expect(recordManualPayment(CASH_ARGS)).rejects.toBeInstanceOf(
      PaymentWroteButUnreadableError,
    );
  });

  it('缺 payment_id ⇒ 拋', async () => {
    makeClient({ data: { recorded: true, idempotent: false }, error: null });
    await expect(recordManualPayment(CASH_ARGS)).rejects.toBeInstanceOf(
      PaymentWroteButUnreadableError,
    );
  });

  it('idempotent 不是 boolean ⇒ 拋(它決定文案要不要說「先前已經登錄過」)', async () => {
    makeClient({ data: { recorded: true, idempotent: 'true', payment_id: 'p' }, error: null });
    await expect(recordManualPayment(CASH_ARGS)).rejects.toBeInstanceOf(
      PaymentWroteButUnreadableError,
    );
  });

  it.each([null, [], 'ok', 42])('回傳不是物件(%s)⇒ 拋', async (data) => {
    makeClient({ data, error: null });
    await expect(recordManualPayment(CASH_ARGS)).rejects.toBeInstanceOf(
      PaymentWroteButUnreadableError,
    );
  });
});

// ── #372-A12 沖銷 ────────────────────────────────────────────────────────────
// 🔴 **本節是關卡2 R1 MF3 補的**:原本 `wrote` 那條路只在碼表層用手捏的 `{wrote:true}` 測,
//    **畸形的成功 payload 從來沒有真的走過 `parseReverseResult`** ⇒ 那支若改拋
//    `PaymentWriteError`(沒有 `wrote` 旗標),**已經沖掉的那筆會被講成「這次沒有沖成」**,
//    員工回頭去沖列表上新出現的負數列 ⇒ 原款被加回帳上 —— 而整套測試照樣全綠。

describe('🔴 沖銷:成功 payload 形狀不完整 ⇒ 拋「已寫入但讀不懂」(不是「沒寫入」)', () => {
  it.each([
    ['不是物件', 'not-an-object'],
    ['是陣列', [{ reversed: true, reversal_id: 'r1' }]],
    ['reversed 不是 true', { reversed: 'true', reversal_id: 'r1' }],
    ['reversed 是 false', { reversed: false, reversal_id: 'r1' }],
    ['缺 reversal_id', { reversed: true }],
    ['reversal_id 是空字串', { reversed: true, reversal_id: '' }],
  ])('%s ⇒ PaymentWroteButUnreadableError 且 wrote === true', async (_label, data) => {
    makeClient({ data, error: null });
    await expect(
      reverseManualPayment({ paymentId: 'p1', actor: 'staff-1', reason: '登錯' }),
    ).rejects.toBeInstanceOf(PaymentWroteButUnreadableError);
  });

  it('🔴 `wrote` 旗標要真的在丟出來的物件上(下游靠它分派,不靠 instanceof)', async () => {
    makeClient({ data: { reversed: false }, error: null });
    await reverseManualPayment({ paymentId: 'p1', actor: 'staff-1', reason: '登錯' }).then(
      () => {
        throw new Error('不該成功');
      },
      (e: unknown) => {
        expect((e as { wrote?: unknown }).wrote).toBe(true);
      },
    );
  });

  it('形狀完整 ⇒ 回 reversalId', async () => {
    makeClient({ data: { reversed: true, reversal_id: 'rev-9' }, error: null });
    await expect(
      reverseManualPayment({ paymentId: 'p1', actor: 'staff-1', reason: '登錯' }),
    ).resolves.toEqual({ reversalId: 'rev-9' });
  });
});

describe('🔴 沖銷:送出去的 args 三欄逐字(接錯 = 沖錯列)', () => {
  it('p_payment_id / p_actor / p_reason,且沒有 p_request_id 這個鍵', async () => {
    const rpc = makeClient({ data: { reversed: true, reversal_id: 'rev-9' }, error: null });
    await reverseManualPayment({ paymentId: 'p1', actor: 'staff-1', reason: '登錯' });
    expect(rpc).toHaveBeenCalledWith('admin_reverse_manual_payment', {
      p_payment_id: 'p1',
      p_actor: 'staff-1',
      p_reason: '登錯',
    });
  });

  it('🔴 error 沒有 code 欄(閘道 502/504 那種非 JSON body)⇒ sqlstate 帶 null', async () => {
    // `typeof error.code === 'string'` 的 **false 側**原本零覆蓋(關卡2 R2 nit5)。
    // 這條路真的會發生:postgrest-js 對非 2xx 走 `JSON.parse(body)`,而閘道回的
    // 502/504 是 HTML/純文字 ⇒ 解出來的物件沒有 `code`。
    // 帶 null 才會被映成 `unknown`(可能已 commit);若改寫成 `String(error.code)`
    // 會得到字串 `"undefined"` ⇒ 落 `bug` ⇒ 逐字對員工說「這次沒有沖成」,而錢可能已經沖掉了。
    makeClient({ data: null, error: { message: 'Bad Gateway' } });
    await reverseManualPayment({ paymentId: 'p1', actor: 'staff-1', reason: '登錯' }).then(
      () => {
        throw new Error('不該成功');
      },
      (e: unknown) => {
        expect((e as { sqlstate?: unknown }).sqlstate).toBeNull();
      },
    );
  });

  it('🔴 RPC 拒收時 SQLSTATE 原樣帶出去', async () => {
    makeClient({ data: null, error: { code: 'P2B44', message: '該列已被沖銷' } });
    await reverseManualPayment({ paymentId: 'p1', actor: 'staff-1', reason: '登錯' }).then(
      () => {
        throw new Error('不該成功');
      },
      (e: unknown) => {
        expect((e as { sqlstate?: unknown }).sqlstate).toBe('P2B44');
        // 反面:**不可**帶 `wrote` —— 它代表已 commit,而拒收那條路什麼也沒寫。
        expect((e as { wrote?: unknown }).wrote).toBeUndefined();
      },
    );
  });
});
