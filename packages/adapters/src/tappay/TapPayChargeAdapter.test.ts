// node env;mock 'server-only'(TapPayChargeAdapter 檔頭 import 'server-only'、node 環境直接 import 會 throw)。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { toMoneyAmount, type TapPayChargePayload } from '@pcm/domain';

vi.mock('server-only', () => ({}));

import { TapPayChargeAdapter } from './TapPayChargeAdapter';

const CONFIG = {
  partnerKey: 'partner_test_key',
  merchantId: 'M_test',
  payByPrimeUrl: 'https://sandbox.tappaysdk.com/tpc/payment/pay-by-prime',
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
