// node env;mock 'server-only'(TapPayChargeAdapter 檔頭 import 'server-only'、node 環境直接 import 會 throw)。
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  toMoneyAmount,
  type TapPayChargePayload,
  type TapPayInitiationPayload,
  type TapPayRecordQuery,
} from '@pcm/domain';

vi.mock('server-only', () => ({}));

import { TapPayChargeAdapter } from './TapPayChargeAdapter';

const CONFIG = {
  partnerKey: 'partner_test_key',
  merchantId: 'M_test',
  payByPrimeUrl: 'https://sandbox.tappaysdk.com/tpc/payment/pay-by-prime',
  recordQueryUrl: 'https://sandbox.tappaysdk.com/tpc/transaction/query',
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

/** Record API 已請款(paid 候選)回應;含 PII 欄 card_info/cardholder 用於驗白名單剝離。 */
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
      currency: 'TWD',
      record_status: 1, // 1=OK(交易完成;配 is_captured=true = 已付款)
      is_captured: true,
      refunded_amount: 0,
      transaction_time_millis: 1700000000000,
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
      currency: 'TWD',
      recordStatus: 1,
      isCaptured: true,
      refundedAmount: 0,
      transactionTimeMillis: 1700000000000,
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

  it('top status=2 無紀錄(trade_records 缺)→ queryStatus 2 + records 空 + count 退實得 0', async () => {
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
