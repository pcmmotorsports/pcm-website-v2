// node env;mock 'server-only'(TapPayChargeAdapter 檔頭 import 'server-only'、node 環境直接 import 會 throw)。
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  toMoneyAmount,
  TAPPAY_REFUND_STATUS,
  TapPayRefundNotSentError,
  type TapPayChargePayload,
  type TapPayInitiationPayload,
  type TapPayRecordQuery,
  type TapPayRefundPayload,
} from '@pcm/domain';

vi.mock('server-only', () => ({}));

import { TapPayChargeAdapter, REFUND_DEFAULT_TIMEOUT_MS } from './TapPayChargeAdapter';

const CONFIG = {
  partnerKey: 'partner_test_key',
  merchantId: 'M_test',
  payByPrimeUrl: 'https://sandbox.tappaysdk.com/tpc/payment/pay-by-prime',
  recordQueryUrl: 'https://sandbox.tappaysdk.com/tpc/transaction/query',
  refundUrl: 'https://sandbox.tappaysdk.com/tpc/transaction/refund',
};

const PAYLOAD: TapPayChargePayload = {
  prime: 'prime_token_xyz',
  amount: { amount: toMoneyAmount(1050), currency: 'TWD' },
  orderId: 'order-uuid-1',
  cardholder: { name: '王小明', email: 'buyer@example.com', phoneNumber: '0912345678' },
};

/** TapPay pay-by-prime 成功回應(含 PII-敏感 card_info、用於驗 adapter 不寫進 log)。 */
const SUCCESS_WIRE = {
  status: 0,
  msg: 'Success',
  rec_trade_id: 'D20260612001234567',
  bank_transaction_id: '99887766',
  amount: 1050,
  currency: 'TWD',
  card_info: { bin_code: '424242', last_four: '4242', issuer: 'Sample Bank' },
  transaction_time_millis: 1700000000000,
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TapPayChargeAdapter.charge — wire→domain 映射', () => {
  it('status===0 → succeeded、transactionId=rec_trade_id、amount=Money{實扣,TWD}', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(SUCCESS_WIRE)));
    const res = await new TapPayChargeAdapter(CONFIG).charge(PAYLOAD);
    expect(res.status).toBe('succeeded');
    expect(res.transactionId).toBe('D20260612001234567');
    expect(res.amount).toEqual({ amount: 1050, currency: 'TWD' });
    expect(res.rawResponse).toEqual(SUCCESS_WIRE);
  });

  it('送出 body:partner_key/prime/amount(整數)/merchant_id/cardholder + x-api-key header', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(SUCCESS_WIRE));
    vi.stubGlobal('fetch', fetchFn);
    await new TapPayChargeAdapter(CONFIG).charge(PAYLOAD);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(CONFIG.payByPrimeUrl);
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).headers).toMatchObject({ 'x-api-key': 'partner_test_key' });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      partner_key: 'partner_test_key',
      prime: 'prime_token_xyz',
      amount: 1050, // 整數、server 算的 total(client 永不送價)
      merchant_id: 'M_test',
      order_number: 'order-uuid-1', // TapPay 訂單識別欄(孤兒對帳回連 PCM order)
      cardholder: { name: '王小明', email: 'buyer@example.com', phone_number: '0912345678' },
    });
  });

  it('status≠0(卡拒)→ failed(未扣款、use-case 可安全重試)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ status: 10003, msg: 'Card declined' })),
    );
    const res = await new TapPayChargeAdapter(CONFIG).charge(PAYLOAD);
    expect(res.status).toBe('failed');
  });
});

describe('TapPayChargeAdapter.charge — 異常路徑(use-case 映 charge_unknown)', () => {
  it('fetch transport reject → 傳遞 throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    await expect(new TapPayChargeAdapter(CONFIG).charge(PAYLOAD)).rejects.toThrow();
  });

  it('HTTP 非 2xx → throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 401)));
    await expect(new TapPayChargeAdapter(CONFIG).charge(PAYLOAD)).rejects.toThrow(/HTTP 401/);
  });

  it('status===0 但幣別非 TWD → throw(單位斷言)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ ...SUCCESS_WIRE, currency: 'USD' })),
    );
    await expect(new TapPayChargeAdapter(CONFIG).charge(PAYLOAD)).rejects.toThrow(/非 TWD/);
  });

  it('status===0 但缺 rec_trade_id → throw(格式異常)', async () => {
    const { rec_trade_id, ...noRec } = SUCCESS_WIRE;
    void rec_trade_id;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(noRec)));
    await expect(new TapPayChargeAdapter(CONFIG).charge(PAYLOAD)).rejects.toThrow(/格式異常/);
  });

  it('回應非物件 → throw(parseTapPayResponse 守)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse('not-json')));
    await expect(new TapPayChargeAdapter(CONFIG).charge(PAYLOAD)).rejects.toThrow();
  });
});

describe('TapPayChargeAdapter — #16 PII mask', () => {
  it('log 不含 cardholder PII(email/name/phone)+ 不含 rawResponse(card_info)', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(SUCCESS_WIRE)));
    await new TapPayChargeAdapter(CONFIG).charge(PAYLOAD);
    const logged = JSON.stringify(infoSpy.mock.calls);
    expect(logged).not.toContain('buyer@example.com'); // email
    expect(logged).not.toContain('王小明'); // name
    expect(logged).not.toContain('0912345678'); // phone
    expect(logged).not.toContain('4242'); // card_info.last_four(rawResponse 不入 log)
    // 但非 PII 對帳欄(orderId/status/recTradeId)應有
    expect(logged).toContain('order-uuid-1');
    expect(logged).toContain('D20260612001234567');
  });
});

// ── M-3 3DS-1a:Record API 反查(解析、不下裁決)─────────────────────────────────────────────

/** Record API OK+captured 回應 fixture(record_status=1 + is_captured;含 PII 欄 card_info/cardholder 用於驗白名單剝離)。 */
const RECORD_CAPTURED_WIRE = {
  status: 0,
  msg: '',
  number_of_transactions: 1,
  records_per_page: 50,
  page: 0,
  total_page_count: 1,
  trade_records: [
    {
      rec_trade_id: 'D20260612001234567',
      order_number: 'order-uuid-1',
      bank_transaction_id: '99887766',
      merchant_id: 'M_test',
      amount: 1050,
      original_amount: 1050, // #301:未退款時兩欄同值
      currency: 'TWD',
      record_status: 1, // 1=OK 交易完成(此 fixture is_captured=true;1a 不裁決、成立判定在 1b)
      is_captured: true,
      refunded_amount: 0,
      time: 1700000000000, // #301:本 API 的交易時間欄是 `time`(毫秒),不是 transaction_time_millis
      // 🔴 PII 欄(白名單外、不應被解析進 domain):
      cardholder: { name: '王小明', email: 'buyer@example.com', phone_number: '0912345678' },
      card_info: { bin_code: '424242', last_four: '4242' },
    },
  ],
};

const REC_QUERY: TapPayRecordQuery = { recTradeId: 'D20260612001234567' };

describe('TapPayChargeAdapter.recordQuery — wire→domain 解析(不下裁決)', () => {
  it('queryStatus/numberOfTransactions/records 忠實解析、record_status+is_captured 原值回(不判 paid)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(RECORD_CAPTURED_WIRE)));
    const res = await new TapPayChargeAdapter(CONFIG).recordQuery(REC_QUERY);
    expect(res.queryStatus).toBe(0);
    expect(res.numberOfTransactions).toBe(1);
    expect(res.records).toHaveLength(1);
    expect(res.records[0]).toEqual({
      recTradeId: 'D20260612001234567',
      orderNumber: 'order-uuid-1',
      bankTransactionId: '99887766',
      merchantId: 'M_test',
      amount: 1050,
      originalAmount: 1050,
      currency: 'TWD',
      recordStatus: 1,
      isCaptured: true,
      refundedAmount: 0,
      timeMillis: 1700000000000,
    });
    // 🔴 不下裁決:回傳物件無「paid / verdict」欄,只有原始解析欄。
    expect(res).not.toHaveProperty('paid');
  });

  it('送出 body:partner_key/filters(merchant_id Array + rec_trade_id)/records_per_page/page + x-api-key + POST + recordQueryUrl', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(RECORD_CAPTURED_WIRE));
    vi.stubGlobal('fetch', fetchFn);
    await new TapPayChargeAdapter(CONFIG).recordQuery(REC_QUERY);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(CONFIG.recordQueryUrl);
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).headers).toMatchObject({ 'x-api-key': 'partner_test_key' });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      partner_key: 'partner_test_key',
      filters: { merchant_id: ['M_test'], rec_trade_id: 'D20260612001234567' },
      records_per_page: 50,
      page: 0,
    });
  });

  it('order_number + bank_transaction_id 鍵 → filters 同時帶上(merchant_id 恆帶)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ status: 2, trade_records: [] }));
    vi.stubGlobal('fetch', fetchFn);
    await new TapPayChargeAdapter(CONFIG).recordQuery({
      orderNumber: 'order-uuid-1',
      bankTransactionId: 'bank-xyz',
    });
    const body = JSON.parse((fetchFn.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.filters).toEqual({
      merchant_id: ['M_test'],
      order_number: 'order-uuid-1',
      bank_transaction_id: 'bank-xyz',
    });
    expect(body.filters).not.toHaveProperty('rec_trade_id');
  });

  it('AUTH-only(record_status=0、is_captured=false)三態可辨、原值回不誤判 paid', async () => {
    const authWire = {
      status: 0,
      number_of_transactions: 1,
      trade_records: [
        {
          rec_trade_id: 'D-auth',
          order_number: 'order-uuid-1',
          merchant_id: 'M_test',
          amount: 1050,
          record_status: 0, // 0=AUTH(僅授權未請款)
          is_captured: false,
        },
      ],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(authWire)));
    const res = await new TapPayChargeAdapter(CONFIG).recordQuery(REC_QUERY);
    expect(res.records[0]!.recordStatus).toBe(0);
    expect(res.records[0]!.isCaptured).toBe(false);
  });

  it('A1(querystatus-fix)raw status=2 有紀錄 → queryStatus=2 + records.length===1 + count===1(忠實解析、不丟 trade_records)', async () => {
    // 2026-06-21 真實情境(PCM-2026-0018):3DS 授權成功單查詢回 top status=2(已無更多分頁)+ 1 筆 AUTH 交易;
    //   adapter 須忠實解析、不因 status=2 丟掉 trade_records(status 值與有無紀錄正交)。
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ...RECORD_CAPTURED_WIRE, status: 2 })));
    const res = await new TapPayChargeAdapter(CONFIG).recordQuery(REC_QUERY);
    expect(res.queryStatus).toBe(2);
    expect(res.numberOfTransactions).toBe(1);
    expect(res.records).toHaveLength(1);
    expect(res.records[0]!.recTradeId).toBe('D20260612001234567');
  });

  it('top status=2 + 本頁無 trade_records → queryStatus 2 + records 空 + count 退實得 0(status 值與有無紀錄正交、非 status=2≡無紀錄)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ status: 2, msg: 'no more' })));
    const res = await new TapPayChargeAdapter(CONFIG).recordQuery(REC_QUERY);
    expect(res.queryStatus).toBe(2);
    expect(res.records).toEqual([]);
    expect(res.numberOfTransactions).toBe(0);
  });
});

describe('TapPayChargeAdapter.recordQuery — fail-closed + 異常路徑', () => {
  it('三把識別鍵全空 → throw、fetch 不被呼叫(不送無 filter 全表查)', async () => {
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    await expect(new TapPayChargeAdapter(CONFIG).recordQuery({})).rejects.toThrow(/至少一把/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('HTTP 非 2xx → throw(1b 映 pending、不誤判 failed)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 401)));
    await expect(new TapPayChargeAdapter(CONFIG).recordQuery(REC_QUERY)).rejects.toThrow(/HTTP 401/);
  });

  it('回應非物件 → throw(parseTapPayRecordResponse 守)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse('not-json')));
    await expect(new TapPayChargeAdapter(CONFIG).recordQuery(REC_QUERY)).rejects.toThrow();
  });

  it('trade_record 缺必要欄(無 rec_trade_id)→ throw(格式異常 fail-closed)', async () => {
    const bad = {
      status: 0,
      number_of_transactions: 1,
      trade_records: [{ order_number: 'order-uuid-1', merchant_id: 'M_test', amount: 1050, record_status: 1, is_captured: true }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(bad)));
    await expect(new TapPayChargeAdapter(CONFIG).recordQuery(REC_QUERY)).rejects.toThrow(/缺必要欄/);
  });

  it('回應含非本商戶紀錄(merchant_id≠filter)→ throw(wire 完整性、防誤採他商戶;codex 關卡2)', async () => {
    const foreign = {
      status: 0,
      number_of_transactions: 1,
      trade_records: [{ ...RECORD_CAPTURED_WIRE.trade_records[0], merchant_id: 'M_other' }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(foreign)));
    await expect(new TapPayChargeAdapter(CONFIG).recordQuery(REC_QUERY)).rejects.toThrow(/非本商戶/);
  });
});

describe('TapPayChargeAdapter.recordQuery — #16 PII 零落地', () => {
  it('解析結果剝除 card_info/cardholder PII 欄;log 不含 PII、只含對帳識別鍵', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(RECORD_CAPTURED_WIRE)));
    const res = await new TapPayChargeAdapter(CONFIG).recordQuery(REC_QUERY);
    // 解析後 domain record 不帶任何 PII 欄
    const recordStr = JSON.stringify(res.records[0]);
    expect(recordStr).not.toContain('buyer@example.com');
    expect(recordStr).not.toContain('王小明');
    expect(recordStr).not.toContain('0912345678');
    expect(recordStr).not.toContain('4242');
    expect(res.records[0]).not.toHaveProperty('cardholder');
    expect(res.records[0]).not.toHaveProperty('card_info');
    // log 同樣不含 PII、但有非 PII 對帳鍵
    const logged = JSON.stringify(infoSpy.mock.calls);
    expect(logged).not.toContain('buyer@example.com');
    expect(logged).not.toContain('4242');
    expect(logged).toContain('D20260612001234567');
  });
});

// ── M-3 3DS-5a:initiateThreeDSCharge(3DS 啟動、回 payment_url 跳轉、不請款)──────────────────────

const INIT_PAYLOAD: TapPayInitiationPayload = {
  prime: 'prime_token_xyz',
  amount: { amount: toMoneyAmount(1050), currency: 'TWD' },
  orderId: 'order-uuid-1',
  cardholder: { name: '王小明', email: 'buyer@example.com', phoneNumber: '0912345678' },
  bankTransactionId: 'PABCDEFGHJKMNPQRSTV', // 19 字大寫英數(5b use-case 自產;adapter 透傳)
  frontendRedirectUrl: 'https://shop.pcm.example/checkout/callback?order=order-uuid-1',
  backendNotifyUrl: 'https://shop.pcm.example/api/checkout/tappay-notify/secret-seg',
};

/** TapPay 3DS 啟動成功回應:status=0 + payment_url(跳轉、含 token)+ rec_trade_id;無實扣 amount。 */
const INIT_SUCCESS_WIRE = {
  status: 0,
  msg: '',
  rec_trade_id: 'D20260619-3ds-001',
  bank_transaction_id: 'PABCDEFGHJKMNPQRSTV',
  payment_url: 'https://sandbox.tappaysdk.com/3ds/redirect?token=top-secret-token',
  // 🔴 含 PII / 敏感欄、驗不入 log:
  card_info: { bin_code: '424242', last_four: '4242' },
};

describe('TapPayChargeAdapter.initiateThreeDSCharge — 3DS 啟動 happy path', () => {
  it('status=0 + payment_url + rec_trade_id → pending_3ds(paymentUrl/recTradeId/回送 bankTransactionId)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(INIT_SUCCESS_WIRE)));
    const res = await new TapPayChargeAdapter(CONFIG).initiateThreeDSCharge(INIT_PAYLOAD);
    expect(res).toEqual({
      status: 'pending_3ds',
      paymentUrl: 'https://sandbox.tappaysdk.com/3ds/redirect?token=top-secret-token',
      recTradeId: 'D20260619-3ds-001',
      bankTransactionId: 'PABCDEFGHJKMNPQRSTV', // 回送 caller 自產鍵(已 durable)
    });
  });

  it('送出 body:共同欄 + three_domain_secure:true + result_url + bank_transaction_id;🔴 不送 delay_capture_in_days', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(INIT_SUCCESS_WIRE));
    vi.stubGlobal('fetch', fetchFn);
    await new TapPayChargeAdapter(CONFIG).initiateThreeDSCharge(INIT_PAYLOAD);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(CONFIG.payByPrimeUrl);
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).headers).toMatchObject({ 'x-api-key': 'partner_test_key' });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      partner_key: 'partner_test_key',
      prime: 'prime_token_xyz',
      amount: 1050, // 整數、server 算的 total
      merchant_id: 'M_test',
      order_number: 'order-uuid-1',
      cardholder: { name: '王小明', email: 'buyer@example.com', phone_number: '0912345678' },
      three_domain_secure: true,
      result_url: {
        frontend_redirect_url: 'https://shop.pcm.example/checkout/callback?order=order-uuid-1',
        backend_notify_url: 'https://shop.pcm.example/api/checkout/tappay-notify/secret-seg',
      },
      bank_transaction_id: 'PABCDEFGHJKMNPQRSTV',
    });
    // 🔴 不送 delay_capture_in_days(省略=預設 0 當天請款、避免停 AUTH)
    expect(body).not.toHaveProperty('delay_capture_in_days');
  });

  it('🔴 回 caller 自產 bankTransactionId(非 wire 回值):wire 異值 / 缺欄皆鎖死回 payload 值', async () => {
    // wire 回不同的 bank_transaction_id(模擬 TapPay 回異值)→ 仍回 caller 自產鍵、非 wire 值。
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ ...INIT_SUCCESS_WIRE, bank_transaction_id: 'WIRE_DIFFERENT_VAL' }),
      ),
    );
    const res = await new TapPayChargeAdapter(CONFIG).initiateThreeDSCharge(INIT_PAYLOAD);
    expect(res.bankTransactionId).toBe('PABCDEFGHJKMNPQRSTV'); // payload 值,非 wire 'WIRE_DIFFERENT_VAL'

    // wire 完全缺 bank_transaction_id → 一樣回 payload 值(對帳鍵權威 = 本機已 durable 值,不依賴 TapPay 回欄)。
    const { bank_transaction_id, ...noBankTxn } = INIT_SUCCESS_WIRE;
    void bank_transaction_id;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(noBankTxn)));
    const res2 = await new TapPayChargeAdapter(CONFIG).initiateThreeDSCharge(INIT_PAYLOAD);
    expect(res2.bankTransactionId).toBe('PABCDEFGHJKMNPQRSTV');
  });
});

describe('TapPayChargeAdapter.initiateThreeDSCharge — 非成功一律 throw(無 failed 態、不過寬釋鎖)', () => {
  it('status≠0(含模糊態)→ throw(adapter 不自判 failed;use-case 映 charge_unknown 不釋鎖)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ status: 421, msg: 'Operation timeout' })),
    );
    await expect(
      new TapPayChargeAdapter(CONFIG).initiateThreeDSCharge(INIT_PAYLOAD),
    ).rejects.toThrow(/啟動未成功|status 421/);
  });

  it('status=0 但缺 payment_url → throw(格式異常、不可釋鎖)', async () => {
    const { payment_url, ...noUrl } = INIT_SUCCESS_WIRE;
    void payment_url;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(noUrl)));
    await expect(
      new TapPayChargeAdapter(CONFIG).initiateThreeDSCharge(INIT_PAYLOAD),
    ).rejects.toThrow(/payment_url\/rec_trade_id/);
  });

  it('status=0 但缺 rec_trade_id → throw', async () => {
    const { rec_trade_id, ...noRec } = INIT_SUCCESS_WIRE;
    void rec_trade_id;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(noRec)));
    await expect(
      new TapPayChargeAdapter(CONFIG).initiateThreeDSCharge(INIT_PAYLOAD),
    ).rejects.toThrow(/payment_url\/rec_trade_id/);
  });

  it('HTTP 非 2xx → throw(啟動狀態未知)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 500)));
    await expect(
      new TapPayChargeAdapter(CONFIG).initiateThreeDSCharge(INIT_PAYLOAD),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('fetch transport reject → 傳遞 throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ETIMEDOUT')));
    await expect(
      new TapPayChargeAdapter(CONFIG).initiateThreeDSCharge(INIT_PAYLOAD),
    ).rejects.toThrow();
  });

  it('回應非物件 → throw(parseTapPayResponse 守)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse('not-json')));
    await expect(
      new TapPayChargeAdapter(CONFIG).initiateThreeDSCharge(INIT_PAYLOAD),
    ).rejects.toThrow();
  });
});

describe('TapPayChargeAdapter.initiateThreeDSCharge — #16 PII：payment_url / cardholder 零落地 log', () => {
  it('log 不含 cardholder PII、不含 payment_url(token)、不含 card_info;含 orderId/recTradeId/bankTransactionId', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(INIT_SUCCESS_WIRE)));
    await new TapPayChargeAdapter(CONFIG).initiateThreeDSCharge(INIT_PAYLOAD);
    const logged = JSON.stringify(infoSpy.mock.calls);
    expect(logged).not.toContain('buyer@example.com'); // email
    expect(logged).not.toContain('王小明'); // name
    expect(logged).not.toContain('0912345678'); // phone
    expect(logged).not.toContain('top-secret-token'); // 🔴 payment_url token 不入 log
    expect(logged).not.toContain('4242'); // card_info(rawResponse 不入 log)
    // 非 PII 對帳欄應有
    expect(logged).toContain('order-uuid-1');
    expect(logged).toContain('D20260619-3ds-001');
    expect(logged).toContain('PABCDEFGHJKMNPQRSTV'); // bank_transaction_id(非 PII)
  });
});

// ── M-4b E10 A15:recordQuery 的可選中止訊號 ────────────────────────────────
// 規格 = docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md §5.1 A15。
// 目的:經 port 注入的呼叫端必須傳得了 signal 才有逾時控制(原設想的「第 3 批退款 worker」
// 已被 A7c 拍板取消〔2026-08-01、無 worker〕;機制保留給任何需要逾時的注入呼叫端)。
function abortError(): Error {
  const e = new Error('The operation was aborted');
  e.name = 'AbortError';
  return e;
}

describe('TapPayChargeAdapter.recordQuery — A15 中止訊號', () => {
  it('有給 signal → 原樣傳進 fetch init', async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ status: 2, trade_records: [] }));
    vi.stubGlobal('fetch', fetchFn);
    await new TapPayChargeAdapter(CONFIG).recordQuery(REC_QUERY, { signal: controller.signal });
    const init = fetchFn.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBe(controller.signal);
  });

  it('🔴 未給 options → init.signal 為 undefined(既有 settleCharge 路徑零行為改動)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ status: 2, trade_records: [] }));
    vi.stubGlobal('fetch', fetchFn);
    await new TapPayChargeAdapter(CONFIG).recordQuery(REC_QUERY);
    const init = fetchFn.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeUndefined();
  });

  it('🔴 中止 → 丟出 AbortError,絕不得被吞成「查無紀錄」', async () => {
    // 逾時不是「這筆沒付款」的證據。若 adapter 把中止吞成 records: [],
    // 上游 settleCharge 會把一張可能已扣款的單判成 failed 而移走 = 金流事故。
    const controller = new AbortController();
    const fetchFn = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal;
          if (!signal) throw new Error('本測試要求 signal 必須被傳進 fetch');
          if (signal.aborted) {
            reject(abortError());
            return;
          }
          signal.addEventListener('abort', () => reject(abortError()));
        }),
    );
    vi.stubGlobal('fetch', fetchFn);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const pending = new TapPayChargeAdapter(CONFIG).recordQuery(REC_QUERY, {
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toThrow(/aborted/i);
    expect(controller.signal.aborted).toBe(true);
    // 沒有走到解析與 log ⇒ 沒有半個「假裝查到東西」的產物
    expect(infoSpy).not.toHaveBeenCalled();
    infoSpy.mockRestore();
  });

  it('🔴 已中止的 signal → 立刻失敗,不留半掛請求', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchFn = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          if (init.signal?.aborted) {
            reject(abortError());
            return;
          }
          // 沒有中止就永遠不 settle = 若 signal 沒被傳進來,測試會逾時而不是假綠
        }),
    );
    vi.stubGlobal('fetch', fetchFn);
    await expect(
      new TapPayChargeAdapter(CONFIG).recordQuery(REC_QUERY, { signal: controller.signal }),
    ).rejects.toThrow(/aborted/i);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('中止只影響帶 signal 的那一次呼叫,不影響後續查詢', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchFn = vi.fn((_url: string, init: RequestInit) => {
      if (init.signal?.aborted) return Promise.reject(abortError());
      return Promise.resolve(jsonResponse({ status: 2, trade_records: [] }));
    });
    vi.stubGlobal('fetch', fetchFn);
    const adapter = new TapPayChargeAdapter(CONFIG);
    await expect(adapter.recordQuery(REC_QUERY, { signal: controller.signal })).rejects.toThrow();
    await expect(adapter.recordQuery(REC_QUERY)).resolves.toMatchObject({
      numberOfTransactions: 0,
    });
  });
});

// ── M-3 退款線第一片:refund(三態 + fail-closed 錯誤二分)──────────────────────────────────
// 規格 = 2026-08-03 slice plan v4.1(關卡1:面板 3 lens + codex R1/R2/R3 + fable R3 全折入)。
// 🔴 錯誤二分是安全模型的地基:pre-flight 違規 → TapPayRefundNotSentError(確定未送出、可重試);
//    送出後一切異常 → 一般 Error(unknown-state、絕不重發)。C 區每格都斷言「非 NotSentError」——
//    類別搞混=呼叫端把 unknown 當「未送出」自動重發=雙退(fable R3 F1)。

const REFUND_TXN = 'D20260612001234567';

const FULL_PAYLOAD: TapPayRefundPayload = {
  kind: 'full',
  transactionId: REFUND_TXN,
  bankRefundId: 'BRID-TEST-01',
};

const PARTIAL_PAYLOAD: TapPayRefundPayload = {
  kind: 'partial',
  transactionId: REFUND_TXN,
  amount: { amount: toMoneyAmount(300), currency: 'TWD' },
  bankRefundId: 'BRID-TEST-02',
};

/**
 * 受理回應 fixture(欄名=官方 §2.3 + probe 實測鍵)。
 * 🔴 證據邊界:refund_id 值有 probe 實測背書(DR20260801bHUZv8);`refund_amount` 的值是**合成的**
 * (probe 未保存其值、語意未證)。msg / bank_result_msg / raw_canary = log 誘餌(斷言零落地)。
 */
const REFUND_ACCEPTED_WIRE = {
  status: 0,
  msg: 'REFUND-MSG-DECOY-accepted',
  refund_id: 'DR20260801bHUZv8',
  refund_amount: 300,
  is_captured: true,
  bank_result_code: 'BRC-00',
  bank_result_msg: 'BANK-MSG-DECOY-accepted',
  raw_canary: 'RAW-CANARY-accepted',
};

/** 取 refund log 的 outcome 序列(log 次數與順序斷言用;非 refund log 一律排除)。 */
function refundLogOutcomes(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls
    .filter((c) => c[0] === '[TapPayChargeAdapter] refund')
    .map((c) => (c[1] as { outcome: string }).outcome);
}

describe('TapPayChargeAdapter.refund — 送出面 + accepted', () => {
  it('kind=full:body 鍵集恰三鍵(無 amount)+ headers/POST/refundUrl;→ accepted 全鍵 toEqual、fetch 1 次', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(REFUND_ACCEPTED_WIRE));
    vi.stubGlobal('fetch', fetchFn);
    const res = await new TapPayChargeAdapter(CONFIG).refund(FULL_PAYLOAD);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(CONFIG.refundUrl);
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).headers).toMatchObject({
      'Content-Type': 'application/json',
      'x-api-key': 'partner_test_key',
    });
    const body = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
    // 🔴 鍵集恰等(非 toMatchObject):spread payload 混入多餘欄位也要紅(fable R3 F6)
    expect(Object.keys(body).sort()).toEqual(['bank_refund_id', 'partner_key', 'rec_trade_id']);
    expect(body).toMatchObject({
      partner_key: 'partner_test_key',
      rec_trade_id: REFUND_TXN,
      bank_refund_id: 'BRID-TEST-01',
    });
    expect(res).toEqual({
      status: 'accepted',
      refundId: 'DR20260801bHUZv8',
      refundAmount: 300,
      isCaptured: true,
      bankRefundId: 'BRID-TEST-01',
      rawResponse: REFUND_ACCEPTED_WIRE,
    });
  });

  it('kind=partial:body 鍵集恰四鍵、amount 為整數原值(kind 判斷、非 truthy)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(REFUND_ACCEPTED_WIRE));
    vi.stubGlobal('fetch', fetchFn);
    await new TapPayChargeAdapter(CONFIG).refund(PARTIAL_PAYLOAD);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchFn.mock.calls[0]![1] as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    expect(Object.keys(body).sort()).toEqual([
      'amount',
      'bank_refund_id',
      'partner_key',
      'rec_trade_id',
    ]);
    expect(body).toHaveProperty('amount', 300);
  });

  it('wire 無 is_captured → isCaptured undefined(accepted 仍成立)', async () => {
    const { is_captured, ...noCaptured } = REFUND_ACCEPTED_WIRE;
    void is_captured;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(noCaptured)));
    const res = await new TapPayChargeAdapter(CONFIG).refund(FULL_PAYLOAD);
    expect(res.status).toBe('accepted');
    expect((res as { isCaptured?: boolean }).isCaptured).toBeUndefined();
  });

  it('is_captured=false 保真(typeof boolean、非 truthy 掉成 undefined)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ ...REFUND_ACCEPTED_WIRE, is_captured: false })),
    );
    const res = await new TapPayChargeAdapter(CONFIG).refund(FULL_PAYLOAD);
    expect(res.status).toBe('accepted');
    expect((res as { isCaptured?: boolean }).isCaptured).toBe(false);
  });
});

describe('TapPayChargeAdapter.refund — 三態(deferred/rejected 僅 partial 可達)', () => {
  it('partial + 10051 → rejected(wireStatus/msg/bankResultCode)、不 throw、fetch 1 次', async () => {
    const wire = {
      status: 10051,
      msg: 'Out of range : amount',
      bank_result_code: 'BRC-51',
      bank_result_msg: 'BANK-MSG-DECOY-rejected',
    };
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(wire));
    vi.stubGlobal('fetch', fetchFn);
    const res = await new TapPayChargeAdapter(CONFIG).refund(PARTIAL_PAYLOAD);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(res).toEqual({
      status: 'rejected',
      wireStatus: TAPPAY_REFUND_STATUS.OUT_OF_RANGE_AMOUNT,
      msg: 'Out of range : amount',
      bankResultCode: 'BRC-51',
      rawResponse: wire,
    });
  });

  it('partial + 10024 → deferred(「還不能做」;非 rejected、非 throw)、fetch 1 次', async () => {
    const wire = {
      status: 10024,
      msg: 'Authorized transaction cannot be partially refunded',
      bank_result_code: 'BRC-24',
    };
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(wire));
    vi.stubGlobal('fetch', fetchFn);
    const res = await new TapPayChargeAdapter(CONFIG).refund(PARTIAL_PAYLOAD);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(res).toEqual({
      status: 'deferred',
      wireStatus: TAPPAY_REFUND_STATUS.NOT_CAPTURED_PARTIAL,
      msg: 'Authorized transaction cannot be partially refunded',
      bankResultCode: 'BRC-24',
      rawResponse: wire,
    });
  });

  it('未實證非 0 碼(421 / 99999)→ throw、非 NotSentError、log 含 unknown_wire_status', async () => {
    for (const code of [421, 99999]) {
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ status: code, msg: 'x' })));
      const err = await new TapPayChargeAdapter(CONFIG)
        .refund(PARTIAL_PAYLOAD)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(TapPayRefundNotSentError);
      expect((err as Error).message).toMatch(new RegExp(`未實證回應碼 ${code}`));
      expect(refundLogOutcomes(infoSpy)).toEqual(['attempt_started', 'unknown_wire_status']);
      infoSpy.mockRestore();
    }
  });

  it('🔴 kind=full + 10024/10051 → throw(零副作用實證全是 partial 情境;未實證組合不回結果態)', async () => {
    for (const code of [10024, 10051]) {
      vi.spyOn(console, 'info').mockImplementation(() => {});
      const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ status: code, msg: 'x' }));
      vi.stubGlobal('fetch', fetchFn);
      const err = await new TapPayChargeAdapter(CONFIG)
        .refund(FULL_PAYLOAD)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(TapPayRefundNotSentError);
      expect((err as Error).message).toMatch(/未實證回應碼/);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    }
  });
});

describe('TapPayChargeAdapter.refund — unknown-state throw(每格斷言非 NotSentError)', () => {
  it('HTTP 非 2xx → throw /HTTP 500/、訊息帶 rec + bank_refund 兩鍵、log 僅 attempt_started', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 500)));
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const err = await new TapPayChargeAdapter(CONFIG)
      .refund(FULL_PAYLOAD)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(TapPayRefundNotSentError);
    expect((err as Error).message).toMatch(/HTTP 500/);
    expect((err as Error).message).toContain(REFUND_TXN);
    expect((err as Error).message).toContain('BRID-TEST-01');
    expect(refundLogOutcomes(infoSpy)).toEqual(['attempt_started']);
  });

  it('transport reject → throw 非 NotSentError、attempt_started 已落恰 1 筆(送過與否可辨)', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    vi.stubGlobal('fetch', fetchFn);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const err = await new TapPayChargeAdapter(CONFIG)
      .refund(FULL_PAYLOAD)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(TapPayRefundNotSentError);
    expect((err as Error).message).toBe('ECONNRESET');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(refundLogOutcomes(infoSpy)).toEqual(['attempt_started']);
  });

  it('🔴 caller 拿 NotSentError 當 abort reason → 重包裸 Error(送出後不存在「未送出」;codex 關卡2)', async () => {
    const controller = new AbortController();
    const trap = new TapPayRefundNotSentError('trap-not-sent-reason');
    const fetchFn = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal;
          if (!signal) throw new Error('本測試要求 signal 必須被傳進 fetch');
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
    );
    vi.stubGlobal('fetch', fetchFn);
    const pending = new TapPayChargeAdapter(CONFIG).refund(FULL_PAYLOAD, {
      signal: controller.signal,
    });
    controller.abort(trap);
    const err = await pending.catch((e: unknown) => e);
    // 🔴 若原樣外拋,呼叫端 instanceof 判「未送出、可安全重發」→ 對已在途的退款重發=雙退。
    expect(err).not.toBe(trap);
    expect(err).not.toBeInstanceOf(TapPayRefundNotSentError);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/已送出後中止/);
    expect((err as Error).message).toContain(REFUND_TXN);
  });

  it('🔴 HTTP 2xx 但 body 非法 JSON(json() reject)→ /解碼失敗/ 帶兩鍵、非 NotSentError(codex 關卡2 R2 #1)', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON');
        },
      } as unknown as Response),
    );
    const err = await new TapPayChargeAdapter(CONFIG)
      .refund(FULL_PAYLOAD)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(TapPayRefundNotSentError);
    expect((err as Error).message).toMatch(/解碼失敗/);
    expect((err as Error).message).toContain(REFUND_TXN);
    expect((err as Error).message).toContain('BRID-TEST-01');
    expect(refundLogOutcomes(infoSpy)).toEqual(['attempt_started']);
  });

  it('回應非物件 / status 非 number → throw 帶兩鍵、非 NotSentError、log 僅 attempt_started', async () => {
    for (const bad of ['not-json', { msg: 'no status' }]) {
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(bad)));
      const err = await new TapPayChargeAdapter(CONFIG)
        .refund(FULL_PAYLOAD)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(TapPayRefundNotSentError);
      expect((err as Error).message).toMatch(/格式異常/);
      expect((err as Error).message).toContain(REFUND_TXN);
      expect((err as Error).message).toContain('BRID-TEST-01');
      expect(refundLogOutcomes(infoSpy)).toEqual(['attempt_started']);
      infoSpy.mockRestore();
    }
  });

  it('status=0 缺 refund_id → /格式異常/、log 序列含 accepted→accepted_malformed', async () => {
    const { refund_id, ...noId } = REFUND_ACCEPTED_WIRE;
    void refund_id;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(noId)));
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const err = await new TapPayChargeAdapter(CONFIG)
      .refund(FULL_PAYLOAD)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(TapPayRefundNotSentError);
    expect((err as Error).message).toMatch(/格式異常/);
    expect(refundLogOutcomes(infoSpy)).toEqual([
      'attempt_started',
      'accepted',
      'accepted_malformed',
    ]);
  });

  it('refund_id 空字串 / 全空白 / 前後空白 → /格式異常/、log 序列含 malformed(不靜默 trim)', async () => {
    for (const badId of ['', '   ', ' DR123 ']) {
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ ...REFUND_ACCEPTED_WIRE, refund_id: badId })),
      );
      const err = await new TapPayChargeAdapter(CONFIG)
        .refund(FULL_PAYLOAD)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(TapPayRefundNotSentError);
      expect((err as Error).message).toMatch(/格式異常/);
      expect(refundLogOutcomes(infoSpy)).toEqual([
        'attempt_started',
        'accepted',
        'accepted_malformed',
      ]);
      infoSpy.mockRestore();
    }
  });

  it('🔴 status=0 缺 refund_amount → /格式異常/ 帶 refundId、log 序列 attempt→accepted→malformed(值班可反查)', async () => {
    const { refund_amount, ...noAmount } = REFUND_ACCEPTED_WIRE;
    void refund_amount;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(noAmount)));
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const err = await new TapPayChargeAdapter(CONFIG)
      .refund(FULL_PAYLOAD)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(TapPayRefundNotSentError);
    expect((err as Error).message).toMatch(/格式異常/);
    expect((err as Error).message).toContain('DR20260801bHUZv8');
    expect(refundLogOutcomes(infoSpy)).toEqual([
      'attempt_started',
      'accepted',
      'accepted_malformed',
    ]);
    expect(JSON.stringify(infoSpy.mock.calls)).toContain('DR20260801bHUZv8');
  });
});

describe('TapPayChargeAdapter.refund — pre-flight(NotSentError + fetch 零呼叫 + 零 log)', () => {
  /**
   * 共用斷言:pre-flight 違規=確定未送出(NotSentError + /未送出/ 訊息、fetch 零呼叫、零 log)。
   * 預設另斷言訊息帶兩鍵 keyCtx(rec … / bank_refund …);payload 整包不可得時傳 keys:false。
   */
  async function expectNotSent(payload: unknown, opts: { keys?: boolean } = {}): Promise<void> {
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const err = await new TapPayChargeAdapter(CONFIG)
      .refund(payload as TapPayRefundPayload)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TapPayRefundNotSentError);
    expect((err as Error).message).toMatch(/未送出/);
    if (opts.keys !== false) {
      expect((err as Error).message).toMatch(/rec .+ \/ bank_refund /);
    }
    expect(fetchFn).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    infoSpy.mockRestore();
  }

  it('payload null / kind 打錯字(partail)→ NotSentError(TS union 擋不住 runtime 資料)', async () => {
    await expectNotSent(null, { keys: false });
    await expectNotSent({ ...FULL_PAYLOAD, kind: 'partail' });
    // null payload 拿不到兩鍵 → 訊息以「不可得」placeholder 明示(codex 關卡2 R2 #2)
    const err = await new TapPayChargeAdapter(CONFIG)
      .refund(null as unknown as TapPayRefundPayload)
      .catch((e: unknown) => e);
    expect((err as Error).message).toMatch(/rec 不可得 \/ bank_refund 不可得/);
  });

  it('transactionId 非 string / 空 / 21 字 / 含空白 → NotSentError', async () => {
    await expectNotSent({ ...FULL_PAYLOAD, transactionId: 123 });
    await expectNotSent({ ...FULL_PAYLOAD, transactionId: '' });
    await expectNotSent({ ...FULL_PAYLOAD, transactionId: 'A'.repeat(21) });
    await expectNotSent({ ...FULL_PAYLOAD, transactionId: 'D2026 0612' });
  });

  it('keyCtx placeholder 三態釘死:null→"null" / undefined→"undefined" / 空字串→"(空)"', async () => {
    const cases: Array<[unknown, string]> = [
      [null, 'rec null'],
      [undefined, 'rec undefined'],
      ['', 'rec (空)'],
    ];
    for (const [bad, expected] of cases) {
      vi.stubGlobal('fetch', vi.fn());
      const err = await new TapPayChargeAdapter(CONFIG)
        .refund({ ...FULL_PAYLOAD, transactionId: bad } as unknown as TapPayRefundPayload)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TapPayRefundNotSentError);
      expect((err as Error).message).toContain(expected);
    }
  });

  it('🔴 SyntaxError 撞上已中止 signal(競態)→ 仍走 /解碼失敗/ 帶兩鍵、不被誤放行成 abort 身分', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          controller.abort(new Error('RACE-ABORT-REASON')); // json 失敗「同時」signal 已中止
          throw new SyntaxError('Unexpected token');
        },
      } as unknown as Response),
    );
    const err = await new TapPayChargeAdapter(CONFIG)
      .refund(FULL_PAYLOAD, { signal: controller.signal })
      .catch((e: unknown) => e);
    // err 非 signal.reason 本體 ⇒ 是解碼錯誤,必須重包帶兩鍵、不得原樣放行
    expect((err as Error).message).toMatch(/解碼失敗/);
    expect((err as Error).message).toContain(REFUND_TXN);
  });

  it('bankRefundId UUID 36 字 / 含空白 / 21 字 / 非字串(數字)→ NotSentError', async () => {
    await expectNotSent({
      ...FULL_PAYLOAD,
      bankRefundId: '123e4567-e89b-12d3-a456-426614174000',
    });
    await expectNotSent({ ...FULL_PAYLOAD, bankRefundId: 'BR ID' });
    await expectNotSent({ ...FULL_PAYLOAD, bankRefundId: 'a'.repeat(21) });
    // 🔴 數字 123 過 RegExp.test 會被隱式轉字串 '123' 而 match ⇒ typeof 守門必須存在(codex 關卡2)
    await expectNotSent({ ...FULL_PAYLOAD, bankRefundId: 123 });
    await expectNotSent({ ...FULL_PAYLOAD, transactionId: 456 });
  });

  it('🔴 bankRefundId 正向邊界:小寫+底線+連字號混排、恰 20 字 → 通過並送出(釘字元集與上限)', async () => {
    const twentyChars = 'aB3-x_9Zk-qW7_pL2-e5';
    expect(twentyChars).toHaveLength(20);
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(REFUND_ACCEPTED_WIRE));
    vi.stubGlobal('fetch', fetchFn);
    await new TapPayChargeAdapter(CONFIG).refund({ ...FULL_PAYLOAD, bankRefundId: twentyChars });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchFn.mock.calls[0]![1] as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    expect(body.bank_refund_id).toBe(twentyChars);
  });

  it('🔴 kind=full 帶 amount 欄 → NotSentError(JS discriminant 寫錯=amount 被靜默忽略=意外全額退)', async () => {
    await expectNotSent({
      ...FULL_PAYLOAD,
      amount: { amount: toMoneyAmount(300), currency: 'TWD' },
    });
  });

  it('partial amount 0 / 負數 / 小數 / 非物件 → NotSentError(不信 MoneyAmount brand)', async () => {
    await expectNotSent({ ...PARTIAL_PAYLOAD, amount: { amount: 0, currency: 'TWD' } });
    await expectNotSent({ ...PARTIAL_PAYLOAD, amount: { amount: -50, currency: 'TWD' } });
    await expectNotSent({ ...PARTIAL_PAYLOAD, amount: { amount: 1.5, currency: 'TWD' } });
    await expectNotSent({ ...PARTIAL_PAYLOAD, amount: undefined });
  });

  it('partial 幣別非 TWD → NotSentError(執行期驗、不信型別)', async () => {
    await expectNotSent({ ...PARTIAL_PAYLOAD, amount: { amount: 300, currency: 'USD' } });
  });
});

describe('TapPayChargeAdapter.refund — signal(30s 逾時恆在)', () => {
  it('未給 options → AbortSignal.timeout(30_000) 被呼叫、init.signal === 其回傳', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(REFUND_ACCEPTED_WIRE));
    vi.stubGlobal('fetch', fetchFn);
    await new TapPayChargeAdapter(CONFIG).refund(FULL_PAYLOAD);
    expect(timeoutSpy).toHaveBeenCalledWith(REFUND_DEFAULT_TIMEOUT_MS);
    const init = fetchFn.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBe(timeoutSpy.mock.results[0]!.value);
  });

  it('🔴 有給 signal → 30s 仍在:AbortSignal.any([caller, timeout]) 合成、init.signal=合成訊號', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const anySpy = vi.spyOn(AbortSignal, 'any');
    const controller = new AbortController();
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(REFUND_ACCEPTED_WIRE));
    vi.stubGlobal('fetch', fetchFn);
    await new TapPayChargeAdapter(CONFIG).refund(FULL_PAYLOAD, { signal: controller.signal });
    expect(timeoutSpy).toHaveBeenCalledWith(REFUND_DEFAULT_TIMEOUT_MS);
    expect(anySpy).toHaveBeenCalledTimes(1);
    const anyArgs = anySpy.mock.calls[0]![0] as AbortSignal[];
    expect(anyArgs[0]).toBe(controller.signal);
    expect(anyArgs[1]).toBe(timeoutSpy.mock.results[0]!.value);
    const init = fetchFn.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBe(anySpy.mock.results[0]!.value);
  });

  it('caller abort(自訂 reason)→ 原樣 reject、fetch 1 次、僅 attempt_started log(不吞成結果態)', async () => {
    const controller = new AbortController();
    const reason = new Error('CUSTOM-ABORT-REASON');
    const fetchFn = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal;
          if (!signal) throw new Error('本測試要求 signal 必須被傳進 fetch');
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
    );
    vi.stubGlobal('fetch', fetchFn);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const pending = new TapPayChargeAdapter(CONFIG).refund(FULL_PAYLOAD, {
      signal: controller.signal,
    });
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(refundLogOutcomes(infoSpy)).toEqual(['attempt_started']);
  });

  it('TimeoutError 形狀 reject → 原樣傳出、非 NotSentError(逾時=unknown-state、不得重發)', async () => {
    const timeoutErr = new DOMException('The operation timed out', 'TimeoutError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutErr));
    const err = await new TapPayChargeAdapter(CONFIG)
      .refund(FULL_PAYLOAD)
      .catch((e: unknown) => e);
    expect(err).toBe(timeoutErr);
    expect(err).not.toBeInstanceOf(TapPayRefundNotSentError);
  });
});

describe('TapPayChargeAdapter.refund — #16 log 零 PII / 零自由文字 / 零 partnerKey', () => {
  it('accepted:誘餌(msg/bank_result_msg/raw_canary/partnerKey)零落地;含對帳鍵;次數=attempt+outcome', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(REFUND_ACCEPTED_WIRE)));
    await new TapPayChargeAdapter(CONFIG).refund(FULL_PAYLOAD);
    const logged = JSON.stringify(infoSpy.mock.calls);
    expect(logged).not.toContain('REFUND-MSG-DECOY');
    expect(logged).not.toContain('BANK-MSG-DECOY');
    expect(logged).not.toContain('RAW-CANARY');
    expect(logged).not.toContain('partner_test_key');
    expect(logged).toContain(REFUND_TXN);
    expect(logged).toContain('BRID-TEST-01');
    expect(logged).toContain('DR20260801bHUZv8');
    expect(refundLogOutcomes(infoSpy)).toEqual(['attempt_started', 'accepted']);
  });

  it('rejected(10051):自由文字/raw_canary 誘餌零落地;含 wireStatus/bankResultCode;次數=attempt+outcome', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          status: 10051,
          msg: 'REFUND-MSG-DECOY-rejected',
          bank_result_code: 'BRC-51',
          bank_result_msg: 'BANK-MSG-DECOY-rejected',
          raw_canary: 'RAW-CANARY-rejected',
        }),
      ),
    );
    await new TapPayChargeAdapter(CONFIG).refund(PARTIAL_PAYLOAD);
    const logged = JSON.stringify(infoSpy.mock.calls);
    expect(logged).not.toContain('REFUND-MSG-DECOY');
    expect(logged).not.toContain('BANK-MSG-DECOY');
    expect(logged).not.toContain('RAW-CANARY');
    expect(logged).not.toContain('partner_test_key');
    expect(logged).toContain('10051');
    expect(logged).toContain('BRC-51');
    expect(refundLogOutcomes(infoSpy)).toEqual(['attempt_started', 'rejected']);
  });

  it('🔴 deferred(10024):獨立 call site 的誘餌測試(誤把 msg 加進 deferred log 會被抓;fable 關卡2 C1)', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        status: 10024,
        msg: 'REFUND-MSG-DECOY-deferred',
        bank_result_code: 'BRC-24',
        bank_result_msg: 'BANK-MSG-DECOY-deferred',
        raw_canary: 'RAW-CANARY-deferred',
      }),
    );
    vi.stubGlobal('fetch', fetchFn);
    await new TapPayChargeAdapter(CONFIG).refund(PARTIAL_PAYLOAD);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(infoSpy.mock.calls);
    expect(logged).not.toContain('REFUND-MSG-DECOY');
    expect(logged).not.toContain('BANK-MSG-DECOY');
    expect(logged).not.toContain('RAW-CANARY');
    expect(logged).not.toContain('partner_test_key');
    expect(logged).toContain('10024');
    expect(logged).toContain('BRC-24');
    expect(refundLogOutcomes(infoSpy)).toEqual(['attempt_started', 'deferred']);
  });

  it('unknown_wire_status:自由文字/raw_canary 誘餌零落地(誤記整包 wire 會被抓)', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          status: 99999,
          msg: 'REFUND-MSG-DECOY-unknown',
          bank_result_msg: 'BANK-MSG-DECOY-unknown',
          raw_canary: 'RAW-CANARY-unknown',
        }),
      ),
    );
    await new TapPayChargeAdapter(CONFIG).refund(PARTIAL_PAYLOAD).catch(() => undefined);
    const logged = JSON.stringify(infoSpy.mock.calls);
    expect(logged).not.toContain('REFUND-MSG-DECOY');
    expect(logged).not.toContain('BANK-MSG-DECOY');
    expect(logged).not.toContain('RAW-CANARY');
    expect(logged).toContain('99999');
    expect(refundLogOutcomes(infoSpy)).toEqual(['attempt_started', 'unknown_wire_status']);
  });
});
