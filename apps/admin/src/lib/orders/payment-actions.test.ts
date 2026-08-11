import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  authorizeAdminMutation: vi.fn(),
  getRequestId: vi.fn(),
  recordManualPayment: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('../session/authorize', () => ({ authorizeAdminMutation: mocks.authorizeAdminMutation }));
vi.mock('../audit/context', () => ({ getRequestId: mocks.getRequestId }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient: vi.fn() }));

// 🔴 只換掉會打 DB 的那一支;`PaymentWroteButUnreadableError` / `PaymentWriteError` 用**真的**那兩個
//    —— 自己造假 class 的話,「已寫入與沒寫入分得開」就變成自我實現的斷言。
vi.mock('./payment-repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./payment-repository')>();
  return { ...actual, recordManualPayment: mocks.recordManualPayment };
});

import { recordManualPaymentAction } from './payment-actions';
import { PaymentWriteError, PaymentWroteButUnreadableError } from './payment-repository';
import {
  PAY_AMOUNT_FIELD,
  PAY_BANK_REFERENCE_FIELD,
  PAY_CASH_RECEIVED_AT_FIELD,
  PAY_ORDER_ID_FIELD,
  PAY_PAYER_NOTE_FIELD,
  PAY_RAIL_FIELD,
  PAY_RECEIVED_DATE_FIELD,
  PAY_REQUEST_ID_FIELD,
} from './payment-action-state';

// payment-actions.test.ts — #15-B2-b2。
//
// 🔴 解析器**刻意不 mock** —— 餵真 FormData 走真解析器,否則「爛表單擋得住」是恆真斷言。
// 🔴 本檔守的兩條硬條款(B2-b 四輪審查交下來的):
//    ① catch 一律走 `paymentFailureCodeForThrown`(已寫入 ⇒ `'error'`,不得講成「沒有寫入」)
//    ② `redirect()` 在 try 之外(它是 throw ⇒ 包進去會把成功分類成失敗 ⇒ 重複入帳)

const ORDER_ID = '11111111-2222-4333-8444-555555555555';
const REQUEST_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const MINTED_AT = '2026-08-11T06:30:00.000Z';

function bankForm(over: Record<string, string> = {}): FormData {
  const f = new FormData();
  const entries: Record<string, string> = {
    [PAY_ORDER_ID_FIELD]: ORDER_ID,
    [PAY_REQUEST_ID_FIELD]: REQUEST_ID,
    [PAY_RAIL_FIELD]: 'bank_transfer',
    [PAY_AMOUNT_FIELD]: '1180',
    [PAY_RECEIVED_DATE_FIELD]: '2026-08-11',
    [PAY_CASH_RECEIVED_AT_FIELD]: MINTED_AT,
    [PAY_BANK_REFERENCE_FIELD]: '國泰 12345',
    [PAY_PAYER_NOTE_FIELD]: '',
    ...over,
  };
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

function cashForm(over: Record<string, string> = {}): FormData {
  return bankForm({
    [PAY_RAIL_FIELD]: 'cash',
    [PAY_AMOUNT_FIELD]: '500',
    [PAY_RECEIVED_DATE_FIELD]: '',
    [PAY_CASH_RECEIVED_AT_FIELD]: MINTED_AT,
    [PAY_BANK_REFERENCE_FIELD]: '',
    ...over,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // 🔴 每一支 mock 都要重設:漏一支 ⇒ 呼叫次數跨測試累加,症狀長得像被測程式多跑一次。
  mocks.authorizeAdminMutation.mockReset();
  mocks.getRequestId.mockReset();
  mocks.recordManualPayment.mockReset();
  mocks.revalidatePath.mockReset();
  mocks.redirect.mockReset();
  mocks.authorizeAdminMutation.mockResolvedValue({ sid: 'sid-1', actorId: 'staff:sean' });
  mocks.getRequestId.mockResolvedValue('req-1');
});

describe('🔴 授權閘排第一', () => {
  it('未授權 ⇒ denied,而且**根本沒打 RPC**', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    const state = await recordManualPaymentAction({ status: 'idle' }, bankForm());
    expect(state).toMatchObject({ status: 'failed', code: 'denied' });
    expect(mocks.recordManualPayment).not.toHaveBeenCalled();
  });

  it('🔴 未授權者送**爛表單**也拿到 denied(不是 invalid)—— 否則等於洩漏表單規則', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    const state = await recordManualPaymentAction({ status: 'idle' }, bankForm({ [PAY_AMOUNT_FIELD]: 'abc' }));
    expect(state).toMatchObject({ code: 'denied' });
  });
});

describe('解析失敗', () => {
  it('爛表單 ⇒ invalid,不打 RPC,而且帶回員工打的內容', async () => {
    const state = await recordManualPaymentAction({ status: 'idle' }, bankForm({ [PAY_AMOUNT_FIELD]: '1,180' }));
    expect(state).toMatchObject({ status: 'failed', code: 'invalid' });
    expect(state.status === 'failed' && state.values.amount).toBe('1,180');
    expect(mocks.recordManualPayment).not.toHaveBeenCalled();
  });
});

describe('成功路徑', () => {
  it('匯款軌:送進去的 args 逐欄正確(含 server 算的 received_at)', async () => {
    mocks.recordManualPayment.mockResolvedValue({ paymentId: 'pay-1', idempotent: false });
    await recordManualPaymentAction({ status: 'idle' }, bankForm());
    expect(mocks.recordManualPayment).toHaveBeenCalledWith({
      rail: 'bank_transfer',
      orderId: ORDER_ID,
      requestId: REQUEST_ID,
      actor: 'staff:sean',
      amount: 1180,
      receivedAt: '2026-08-11T00:00:00+08:00',
      bankReference: '國泰 12345',
      payerNote: null,
    });
    expect(mocks.redirect).toHaveBeenCalledTimes(1);
    expect(String(mocks.redirect.mock.calls[0]?.[0])).toContain('payment_recorded');
    // 🔴 成功路徑的 revalidate 也要逐條比路徑(關卡2 F3:只驗「有呼叫」是零判別力)。
    expect(mocks.revalidatePath.mock.calls.flat()).toEqual([`/orders/${ORDER_ID}`]);
  });

  it('現金軌:時點用表單上蓋的章,**不是** server 當下時鐘', async () => {
    mocks.recordManualPayment.mockResolvedValue({ paymentId: 'pay-2', idempotent: false });
    await recordManualPaymentAction({ status: 'idle' }, cashForm());
    expect(mocks.recordManualPayment).toHaveBeenCalledWith(
      expect.objectContaining({ rail: 'cash', receivedAt: MINTED_AT }),
    );
  });

  it('🔴 冪等重放帶不同的結果碼(不能講成剛剛才記的)', async () => {
    mocks.recordManualPayment.mockResolvedValue({ paymentId: 'pay-3', idempotent: true });
    await recordManualPaymentAction({ status: 'idle' }, bankForm());
    expect(String(mocks.redirect.mock.calls[0]?.[0])).toContain('payment_duplicate');
  });

  it('🔴 `p_request_id` 用的是**表單帶來的鍵**,不是 HTTP request id', async () => {
    mocks.getRequestId.mockResolvedValue('http-req-99');
    mocks.recordManualPayment.mockResolvedValue({ paymentId: 'pay-4', idempotent: false });
    await recordManualPaymentAction({ status: 'idle' }, bankForm());
    expect(mocks.recordManualPayment).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: REQUEST_ID }),
    );
  });
});

describe('🔴🔴 硬條款①:失敗分派一律走 paymentFailureCodeForThrown', () => {
  it('🔴 已寫入但讀不懂 ⇒ error(「可能已經寫進去了」),**絕不可**是 bug', async () => {
    mocks.recordManualPayment.mockRejectedValue(
      new PaymentWroteButUnreadableError('admin_record_manual_payment:回傳不是物件'),
    );
    const state = await recordManualPaymentAction({ status: 'idle' }, bankForm());
    expect(state).toMatchObject({ status: 'failed', code: 'error' });
    expect(state.status === 'failed' && state.message).toContain('可能已經寫進去');
  });

  it.each([
    ['P2B41', 'refunded_state'],
    ['P2B40', 'row_count'],
    ['P0001', 'rejected'],
    ['08006', 'error'],
    ['22007', 'bug'],
  ])('SQLSTATE %s ⇒ %s', async (sqlstate, code) => {
    mocks.recordManualPayment.mockRejectedValue(new PaymentWriteError(sqlstate, 'x'));
    const state = await recordManualPaymentAction({ status: 'idle' }, bankForm());
    expect(state).toMatchObject({ code });
  });

  it('沒預期到的例外 ⇒ bug(fail-closed)', async () => {
    mocks.recordManualPayment.mockRejectedValue(new Error('boom'));
    const state = await recordManualPaymentAction({ status: 'idle' }, bankForm());
    expect(state).toMatchObject({ code: 'bug' });
  });

  // 🔴 關卡2 F3:原本這格只驗「有呼叫」⇒ 傳錯 orderId / returnTo / scope 照樣全綠。
  //    改成**逐條比路徑**:明細頁 + return_to 那條(去掉 query,`revalidatePath` 不吃 query)。
  it('🔴 失敗路徑也要 revalidate,而且路徑要對(文案叫員工「先看收款明細」,畫面不更新就沒東西可看)', async () => {
    mocks.recordManualPayment.mockRejectedValue(new PaymentWriteError('08006', 'x'));
    await recordManualPaymentAction({ status: 'idle' }, bankForm());
    expect(mocks.revalidatePath.mock.calls.flat()).toEqual([`/orders/${ORDER_ID}`]);
  });

  // 🔴🔴 關卡2 F2 是**誤報**,但這一格把「為什麼不成立」變成可重跑的證據:
  //    `order-revalidate.ts` 逐條各包各的 try、**拋錯一律不外傳**(該檔 docblock 逐字)
  //    ⇒ revalidate 炸掉不會蓋掉真實結果。這裡讓它真的炸,驗成功路徑照樣 redirect。
  it('🔴 revalidate 自己炸掉 ⇒ **不影響**寫入結果(照樣 redirect,不會變成失敗 state)', async () => {
    mocks.recordManualPayment.mockResolvedValue({ paymentId: 'pay-7', idempotent: false });
    mocks.revalidatePath.mockImplementation(() => {
      throw new Error('revalidate boom');
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await recordManualPaymentAction({ status: 'idle' }, bankForm());
    expect(mocks.redirect).toHaveBeenCalledTimes(1);
    expect(String(mocks.redirect.mock.calls[0]?.[0])).toContain('payment_recorded');
    // 而且那次失敗要留下獨立的 log(災難當天分得出「畫面沒更新」與「沒寫進去」)
    expect(JSON.stringify(err.mock.calls)).toContain('revalidate');
    err.mockRestore();
  });
});

describe('🔴🔴 硬條款②:redirect 在 try 之外', () => {
  // 🔴 這一格是那條硬條款的**機制化**:Next 的 `redirect()` 是用 throw 實作的。
  //    若哪天有人把它挪進 try,寫入成功之後的 `NEXT_REDIRECT` 會被 catch 接住
  //    ⇒ 分派成 `'bug'`(逐字「沒有寫入」)⇒ 員工再登一次 ⇒ **重複入帳**。
  //    ⇒ 這裡讓 redirect 真的丟東西:正確的實作**必須讓它往外傳**,而不是回一個失敗 state。
  it('🔴 redirect 拋出來的東西必須往外傳,不得被 catch 吞成失敗 state', async () => {
    mocks.recordManualPayment.mockResolvedValue({ paymentId: 'pay-5', idempotent: false });
    const nextRedirect = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;push;/x' });
    mocks.redirect.mockImplementation(() => {
      throw nextRedirect;
    });
    await expect(recordManualPaymentAction({ status: 'idle' }, bankForm())).rejects.toBe(nextRedirect);
  });

  it('對照組:RPC 自己丟的東西**要**被接住(證明上一格不是「什麼都往外丟」)', async () => {
    mocks.recordManualPayment.mockRejectedValue(new PaymentWriteError('P0001', 'x'));
    await expect(recordManualPaymentAction({ status: 'idle' }, bankForm())).resolves.toMatchObject({
      status: 'failed',
    });
  });
});

describe('🔴 wire 格式:結果碼一定要以 `r=` 送出(R2 MF1)', () => {
  // 🔴 `appendResultQuery` **只接 `?` 或 `&`、不補鍵名**;頁層讀的是 `r`
  //    (`cancel-action-state.ts:187` 逐字 `CANCEL_RESULT_PARAM = 'r'`)
  //    ⇒ 少了 `r=` 會產出 `?payment_recorded`,橫幅**永遠不出現**而所有測試照樣綠。
  //    到貨那支就是這樣漏的(正式站活著),本片一起修 —— 這一格是兩支共用的守門形狀。
  it.each([
    [false, 'payment_recorded'],
    [true, 'payment_duplicate'],
  ])('idempotent=%s ⇒ 網址帶 r=%s', async (idempotent, code) => {
    mocks.recordManualPayment.mockResolvedValue({ paymentId: 'p', idempotent });
    await recordManualPaymentAction({ status: 'idle' }, bankForm());
    expect(String(mocks.redirect.mock.calls[0]?.[0])).toMatch(new RegExp(`[?&]r=${code}(&|$)`));
  });
});

describe('🔴 return_to 那條路(R2 MF3:19 格全沒走到)', () => {
  // 🔴 原本 fixture 沒有 return_to ⇒ 一律 fallback 成 `/orders/<id>` ⇒ 與明細頁同路徑
  //    ⇒ `new Set` 併成一條 ⇒ 「兩條路徑都重取」與「只重取一條」在測試上**不可分辨**。
  //    這一格同時是 `appendResultQuery` 走 `&` 那條分支唯一會被走到的地方。
  const PANEL_RETURN_TO = `/orders?panel=${ORDER_ID}`;

  it('🔴 兩條路徑都 revalidate,而且 query 有被剝掉(revalidatePath 不吃 query)', async () => {
    mocks.recordManualPayment.mockResolvedValue({ paymentId: 'p', idempotent: false });
    const f = bankForm();
    f.append('return_to', PANEL_RETURN_TO);
    await recordManualPaymentAction({ status: 'idle' }, f);
    expect(mocks.revalidatePath.mock.calls.flat().sort()).toEqual([`/orders`, `/orders/${ORDER_ID}`]);
  });

  it('🔴 已經有 query 的 return_to 要用 `&` 接結果碼(不是第二個 `?`)', async () => {
    mocks.recordManualPayment.mockResolvedValue({ paymentId: 'p', idempotent: false });
    const f = bankForm();
    f.append('return_to', PANEL_RETURN_TO);
    await recordManualPaymentAction({ status: 'idle' }, f);
    const target = String(mocks.redirect.mock.calls[0]?.[0]);
    expect(target).toBe(`${PANEL_RETURN_TO}&r=payment_recorded`);
    expect(target.match(/\?/g)?.length).toBe(1);
  });
});

describe('🔴 失敗時把印章原樣帶回(R2 MF2:不帶回 = 下一次送出換新鍵 = 多一筆收款)', () => {
  it.each([
    ['08006', 'error'],
    ['P0001', 'rejected'],
  ])('SQLSTATE %s(⇒ %s)的失敗 state 帶回 requestId 與 cashReceivedAt', async (sqlstate) => {
    mocks.recordManualPayment.mockRejectedValue(new PaymentWriteError(sqlstate, 'x'));
    const state = await recordManualPaymentAction({ status: 'idle' }, cashForm());
    expect(state.status === 'failed' && state.values.requestId).toBe(REQUEST_ID);
    expect(state.status === 'failed' && state.values.cashReceivedAt).toBe(MINTED_AT);
  });

  it('🔴 「已寫入但讀不懂」那條更要帶回(它正是重送最危險的一條)', async () => {
    mocks.recordManualPayment.mockRejectedValue(new PaymentWroteButUnreadableError('x'));
    const state = await recordManualPaymentAction({ status: 'idle' }, cashForm());
    expect(state.status === 'failed' && state.values).toMatchObject({
      requestId: REQUEST_ID,
      cashReceivedAt: MINTED_AT,
    });
  });
});

describe('log 不記內容,只記有沒有', () => {
  it('🔴 備註與單號的**內容**不得進 log(內部營運資料)', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    mocks.recordManualPayment.mockResolvedValue({ paymentId: 'pay-6', idempotent: false });
    await recordManualPaymentAction(
      { status: 'idle' },
      bankForm({ [PAY_PAYER_NOTE_FIELD]: '客人說週五匯款', [PAY_BANK_REFERENCE_FIELD]: '國泰 98765' }),
    );
    const dumped = JSON.stringify(info.mock.calls);
    expect(dumped).not.toContain('客人說週五匯款');
    expect(dumped).not.toContain('98765');
    expect(dumped).toContain('has_payer_note');
    info.mockRestore();
  });
});
