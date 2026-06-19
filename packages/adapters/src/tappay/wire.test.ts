import { describe, it, expect } from 'vitest';
import { parseTapPayResponse } from './wire';

// ── M-3 3DS-5a:parseTapPayResponse 新增 payment_url / bank_transaction_id 白名單解析(向後相容)──

describe('parseTapPayResponse — 既有欄(向後相容、簽章不變)', () => {
  it('同步 charge 成功回應:status/msg/rec_trade_id/amount/currency 解析;3DS 新欄缺 → undefined', () => {
    const res = parseTapPayResponse({
      status: 0,
      msg: 'Success',
      rec_trade_id: 'D2026',
      amount: 1050,
      currency: 'TWD',
    });
    expect(res).toEqual({
      status: 0,
      msg: 'Success',
      recTradeId: 'D2026',
      amount: 1050,
      currency: 'TWD',
      paymentUrl: undefined, // 同步 charge 回應無此欄 → undefined(不影響既有用法)
      bankTransactionId: undefined,
    });
  });

  it('status 非 number → throw(transport/格式異常)', () => {
    expect(() => parseTapPayResponse({ msg: 'x' })).toThrow(/缺 status/);
  });

  it('非物件 → throw', () => {
    expect(() => parseTapPayResponse('nope')).toThrow(/非物件/);
  });
});

describe('parseTapPayResponse — 3DS 啟動新欄(payment_url / bank_transaction_id)', () => {
  it('3DS 啟動回應:payment_url + bank_transaction_id 白名單解析', () => {
    const res = parseTapPayResponse({
      status: 0,
      msg: '',
      rec_trade_id: 'D-3ds',
      bank_transaction_id: 'PABCDEFGHJKMNPQRSTV',
      payment_url: 'https://tappay.example/3ds?token=secret',
    });
    expect(res.paymentUrl).toBe('https://tappay.example/3ds?token=secret');
    expect(res.bankTransactionId).toBe('PABCDEFGHJKMNPQRSTV');
    expect(res.recTradeId).toBe('D-3ds');
    // 3DS 啟動無實扣金額 → amount/currency 缺 → undefined
    expect(res.amount).toBeUndefined();
    expect(res.currency).toBeUndefined();
  });

  it('payment_url 非字串 → undefined(防禦性解析、不誤帶非法值)', () => {
    const res = parseTapPayResponse({ status: 0, payment_url: 12345, bank_transaction_id: null });
    expect(res.paymentUrl).toBeUndefined();
    expect(res.bankTransactionId).toBeUndefined();
  });
});
