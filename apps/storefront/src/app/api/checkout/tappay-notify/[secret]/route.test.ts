// @vitest-environment node
// route.test.ts — /api/checkout/tappay-notify/[secret] POST handler 測試(M-3 3DS-2b)
//
// node env(route 用 node:crypto timingSafeEqual/createHash + Buffer + 全域 Request/Response)。
// mock:server-only / next/server(after)/ @pcm/use-cases(settleCharge)/ @/lib/payment/composition
// (getWebhookInbox.recordEvent + getSettleChargeDeps.attempts.findActiveByOrderId)。
// 驗:secret 不符/弱→404/500 / 缺鍵·非UUID·超長→200 drop零DB / 對不上本機單→200 drop不insert /
//     首見→200+after(settleCharge) / 重送→200不排 / fail-closed throw→503 / hash-before-parse / content-type
//     matrix / oversized→413 / 背景 settleCharge throw 不影響 200 + log 零 payload。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

vi.mock('server-only', () => ({}));

const { afterSpy, recordEventSpy, findActiveSpy, settleChargeSpy } = vi.hoisted(() => ({
  afterSpy: vi.fn(),
  recordEventSpy: vi.fn(),
  findActiveSpy: vi.fn(),
  settleChargeSpy: vi.fn(),
}));

vi.mock('next/server', () => ({ after: afterSpy }));
vi.mock('@pcm/use-cases', () => ({ settleCharge: settleChargeSpy }));
vi.mock('@/lib/payment/composition', () => ({
  getWebhookInbox: () => ({ recordEvent: recordEventSpy }),
  // 存在性閘走 DB-only reader(解耦 TapPay env);快路徑 settleCharge 在 after() 才用 getSettleChargeDeps。
  getChargeAttemptReader: () => ({ findActiveByOrderId: findActiveSpy }),
  getSettleChargeDeps: () => ({
    attempts: { findActiveByOrderId: findActiveSpy },
    tappay: {},
    confirmer: {},
  }),
}));

import { POST } from './route';

const SECRET = 'a'.repeat(48); // ≥32 URL-safe
const ORDER = '11111111-2222-3333-4444-555555555555';
const REC = 'D20260615ABC';

const ATTEMPT = {
  attemptId: 'attempt-1',
  status: 'pending' as const,
  recTradeId: null,
  bankTransactionId: null,
  attemptCreatedAt: '2026-06-15T00:00:00.000Z',
  orderTotal: 12345,
  orderPaymentStatus: 'unpaid' as const,
  orderDisplayId: 'PCM-1',
};

function body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    rec_trade_id: REC,
    order_number: ORDER,
    status: 0,
    amount: 12345,
    bank_transaction_id: 'BANK1',
    transaction_time_millis: 1_750_000_000_000,
    ...overrides,
  });
}

function makeReq(raw: string, contentType: string | null = 'application/json'): Request {
  const headers: Record<string, string> = {};
  if (contentType !== null) headers['content-type'] = contentType;
  return new Request('http://localhost:3000/api/checkout/tappay-notify/seg', {
    method: 'POST',
    headers,
    body: raw,
  });
}

const ctx = (secret: string = SECRET) => ({ params: Promise.resolve({ secret }) });

beforeEach(() => {
  process.env.TAPPAY_NOTIFY_PATH_SECRET = SECRET;
  afterSpy.mockReset();
  recordEventSpy.mockReset().mockResolvedValue(true);
  findActiveSpy.mockReset().mockResolvedValue(ATTEMPT);
  settleChargeSpy.mockReset().mockResolvedValue({ kind: 'paid', idempotent: false, displayId: 'PCM-1' });
});

afterEach(() => {
  delete process.env.TAPPAY_NOTIFY_PATH_SECRET;
  vi.clearAllMocks();
});

describe('POST /api/checkout/tappay-notify/[secret] — 祕密路徑段', () => {
  it('secret 不符 → 404、零 DB、零 settle(不揭端點存在)', async () => {
    const res = await POST(makeReq(body()), ctx('wrong-secret-but-also-long-enough-1234567890'));
    expect(res.status).toBe(404);
    expect(findActiveSpy).not.toHaveBeenCalled();
    expect(recordEventSpy).not.toHaveBeenCalled();
    expect(afterSpy).not.toHaveBeenCalled();
  });

  it('env secret 未設 → 500 fail-closed、不放行', async () => {
    delete process.env.TAPPAY_NOTIFY_PATH_SECRET;
    const res = await POST(makeReq(body()), ctx());
    expect(res.status).toBe(500);
    expect(findActiveSpy).not.toHaveBeenCalled();
  });

  it('env secret <32 → 500(強度不足)', async () => {
    process.env.TAPPAY_NOTIFY_PATH_SECRET = 'short';
    const res = await POST(makeReq(body()), ctx('short'));
    expect(res.status).toBe(500);
  });

  it('env secret 含非 URL-safe(/)→ 500', async () => {
    process.env.TAPPAY_NOTIFY_PATH_SECRET = `${'a'.repeat(40)}/${'b'.repeat(8)}`;
    const res = await POST(makeReq(body()), ctx('whatever'));
    expect(res.status).toBe(500);
  });
});

describe('POST tappay-notify — 廉價 drop(無 DB、200 ack)', () => {
  it('rec_trade_id 缺 → 200 drop、零 DB', async () => {
    const res = await POST(makeReq(body({ rec_trade_id: undefined })), ctx());
    expect(res.status).toBe(200);
    expect(findActiveSpy).not.toHaveBeenCalled();
    expect(recordEventSpy).not.toHaveBeenCalled();
  });

  it('order_number 缺 → 200 drop、零 DB', async () => {
    const res = await POST(makeReq(body({ order_number: undefined })), ctx());
    expect(res.status).toBe(200);
    expect(findActiveSpy).not.toHaveBeenCalled();
  });

  it('order_number 非 UUID → 200 drop、零 DB(避 $1::uuid cast throw)', async () => {
    const res = await POST(makeReq(body({ order_number: 'not-a-uuid' })), ctx());
    expect(res.status).toBe(200);
    expect(findActiveSpy).not.toHaveBeenCalled();
  });

  it('rec_trade_id 超長(>128)→ 200 drop、零 DB(避 RPC RAISE → 503 loop)', async () => {
    const res = await POST(makeReq(body({ rec_trade_id: 'x'.repeat(129) })), ctx());
    expect(res.status).toBe(200);
    expect(findActiveSpy).not.toHaveBeenCalled();
  });

  it('malformed JSON → 200 ack drop、零 DB(取不到鍵、不上洩)', async () => {
    const res = await POST(makeReq('{not valid json', 'application/json'), ctx());
    expect(res.status).toBe(200);
    expect(findActiveSpy).not.toHaveBeenCalled();
    expect(recordEventSpy).not.toHaveBeenCalled();
  });
});

describe('POST tappay-notify — 本機 active attempt 存在性閘', () => {
  it('findActiveByOrderId null(對不上本機單)→ 200 drop、不 insert、零 Record', async () => {
    findActiveSpy.mockResolvedValue(null);
    const res = await POST(makeReq(body()), ctx());
    expect(res.status).toBe(200);
    expect(findActiveSpy).toHaveBeenCalledWith(ORDER);
    expect(recordEventSpy).not.toHaveBeenCalled();
    expect(afterSpy).not.toHaveBeenCalled();
  });

  it('findActiveByOrderId throw → 503 fail-closed(TapPay 重送)、不 insert', async () => {
    findActiveSpy.mockRejectedValue(new Error('conn fail'));
    const res = await POST(makeReq(body()), ctx());
    expect(res.status).toBe(503);
    expect(recordEventSpy).not.toHaveBeenCalled();
  });
});

describe('POST tappay-notify — durable insert + 快路徑', () => {
  it('合法首見 + 本機單存在 → recordEvent(白名單欄)、200、after(settleCharge) 排程', async () => {
    const res = await POST(makeReq(body()), ctx());
    expect(res.status).toBe(200);
    expect(findActiveSpy).toHaveBeenCalledWith(ORDER);
    expect(recordEventSpy).toHaveBeenCalledTimes(1);
    expect(recordEventSpy.mock.calls[0]![0]).toMatchObject({
      recTradeId: REC,
      orderNumber: ORDER,
      reportedStatus: 0,
      amount: 12345,
      bankTransactionId: 'BANK1',
      transactionTimeMillis: 1_750_000_000_000,
    });
    expect(afterSpy).toHaveBeenCalledTimes(1);
    // 跑被排程的背景 callback → settleCharge(deps, {orderId})
    await afterSpy.mock.calls[0]![0]();
    expect(settleChargeSpy).toHaveBeenCalledWith(expect.anything(), { orderId: ORDER });
  });

  it('重送(inserted=false)→ 200、不排 settleCharge 快路徑', async () => {
    recordEventSpy.mockResolvedValue(false);
    const res = await POST(makeReq(body()), ctx());
    expect(res.status).toBe(200);
    expect(recordEventSpy).toHaveBeenCalledTimes(1);
    expect(afterSpy).not.toHaveBeenCalled();
  });

  it('recordEvent throw → 503(沒 durable 落 DB 不可回 200、令 TapPay 重送)', async () => {
    recordEventSpy.mockRejectedValue(new Error('db fail'));
    const res = await POST(makeReq(body()), ctx());
    expect(res.status).toBe(503);
    expect(afterSpy).not.toHaveBeenCalled();
  });
});

describe('POST tappay-notify — PII / parse / 背景', () => {
  it('rawHash = raw body sha256(hash-before-parse、不存原文)', async () => {
    const raw = body();
    await POST(makeReq(raw), ctx());
    expect(recordEventSpy.mock.calls[0]![0].rawHash).toBe(
      createHash('sha256').update(raw, 'utf8').digest('hex'),
    );
  });

  it('form-urlencoded body → 正確解析白名單欄 → 200 + recordEvent', async () => {
    const form = `rec_trade_id=${REC}&order_number=${ORDER}&status=0&amount=12345&bank_transaction_id=BANK1&transaction_time_millis=1750000000000`;
    const res = await POST(makeReq(form, 'application/x-www-form-urlencoded'), ctx());
    expect(res.status).toBe(200);
    expect(recordEventSpy.mock.calls[0]![0]).toMatchObject({
      recTradeId: REC,
      orderNumber: ORDER,
      reportedStatus: 0,
      amount: 12345,
      bankTransactionId: 'BANK1',
    });
  });

  it('oversized body(>16KB)→ 413、不解析、零 DB', async () => {
    const big = JSON.stringify({ rec_trade_id: REC, order_number: ORDER, pad: 'x'.repeat(20000) });
    const res = await POST(makeReq(big), ctx());
    expect(res.status).toBe(413);
    expect(findActiveSpy).not.toHaveBeenCalled();
    expect(recordEventSpy).not.toHaveBeenCalled();
  });

  it('背景 settleCharge throw → 已回 200 不受影響;log 僅 orderId、零 payload', async () => {
    settleChargeSpy.mockRejectedValue(new Error('settle boom'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(makeReq(body()), ctx());
    expect(res.status).toBe(200); // 回應不受背景影響
    await afterSpy.mock.calls[0]![0](); // 跑背景 callback(內含 try/catch、不外拋)
    expect(errSpy).toHaveBeenCalled();
    const logged = JSON.stringify(errSpy.mock.calls);
    expect(logged).toContain(ORDER); // 只記 orderId
    expect(logged).not.toContain('BANK1'); // 零 payload 欄
    expect(logged).not.toContain(REC);
    errSpy.mockRestore();
  });
});

describe('POST tappay-notify — defensive parse 數值/空白收界(M1/M2、畸形選填欄省略不 503)', () => {
  it('amount 超 int4(9999999999)→ 200 + amount 省略(NULL、非 503)', async () => {
    const res = await POST(makeReq(body({ amount: 9_999_999_999 })), ctx());
    expect(res.status).toBe(200);
    expect(recordEventSpy).toHaveBeenCalledTimes(1);
    expect(recordEventSpy.mock.calls[0]![0].amount).toBeUndefined();
  });

  it('amount 浮點(1.5)→ 200 + amount 省略', async () => {
    const res = await POST(makeReq(body({ amount: 1.5 })), ctx());
    expect(res.status).toBe(200);
    expect(recordEventSpy.mock.calls[0]![0].amount).toBeUndefined();
  });

  it('reportedStatus(status)超 int4 → 200 + reportedStatus 省略', async () => {
    const res = await POST(makeReq(body({ status: 5_000_000_000 })), ctx());
    expect(res.status).toBe(200);
    expect(recordEventSpy.mock.calls[0]![0].reportedStatus).toBeUndefined();
  });

  it('transaction_time_millis 超 safe-int → 200 + 省略', async () => {
    const res = await POST(makeReq(body({ transaction_time_millis: 99999999999999999999 })), ctx());
    expect(res.status).toBe(200);
    expect(recordEventSpy.mock.calls[0]![0].transactionTimeMillis).toBeUndefined();
  });

  it('rec_trade_id 純空白("   ")→ 200 drop、零 DB(對齊 0a btrim()=\'\' RAISE、避 503)', async () => {
    const res = await POST(makeReq(body({ rec_trade_id: '   ' })), ctx());
    expect(res.status).toBe(200);
    expect(findActiveSpy).not.toHaveBeenCalled();
    expect(recordEventSpy).not.toHaveBeenCalled();
  });

  it('rec_trade_id 前後空白 → trim 後規範化落地(去空白、dedup 鍵乾淨)', async () => {
    await POST(makeReq(body({ rec_trade_id: `  ${REC}  ` })), ctx());
    expect(recordEventSpy.mock.calls[0]![0].recTradeId).toBe(REC);
  });

  it('content-type 謊報(text/plain)但 body 為 JSON → 嗅探正確解析 → 200', async () => {
    const res = await POST(makeReq(body(), 'text/plain'), ctx());
    expect(res.status).toBe(200);
    expect(recordEventSpy).toHaveBeenCalledTimes(1);
  });
});
