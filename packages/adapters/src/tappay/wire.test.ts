import { describe, it, expect } from 'vitest';
import { parseTapPayRecordResponse, parseTapPayRefundResponse, parseTapPayResponse } from './wire';

// ── M-3 退款線第一片:parseTapPayRefundResponse(Refund API 白名單)────────────────────────────
//
// 🔴 證據邊界(比照下方 #301 紀律):sandbox probe 保存過值的只有 status / msg / refund_id
//   (`DR20260801bHUZv8`);**`refund_amount` 的值是合成的**(probe 未保存、語意「本次 vs 累計」未證)。
//   `bank_result_msg`(自由文字)刻意不解析 —— 斷言它不出現在解析結果。

describe('parseTapPayRefundResponse — Refund API 白名單(退款線第一片)', () => {
  it('受理回應:六欄白名單解析;bank_result_msg 刻意不解析、不出現在結果', () => {
    const res = parseTapPayRefundResponse({
      status: 0,
      msg: 'Success',
      refund_id: 'DR20260801bHUZv8', // probe 實測值
      refund_amount: 300, // 🔴 合成值(probe 未保存;語意未證)
      is_captured: false,
      bank_result_code: '00',
      bank_result_msg: 'free-text-not-parsed',
    });
    expect(res).toEqual({
      status: 0,
      msg: 'Success',
      refundId: 'DR20260801bHUZv8',
      refundAmount: 300,
      isCaptured: false,
      bankResultCode: '00',
    });
    expect(JSON.stringify(res)).not.toContain('free-text-not-parsed');
    // is_captured=false 保真(typeof boolean、非 truthy 掉成 undefined)
    expect(res.isCaptured).toBe(false);
  });

  it('status 非 number → throw;非物件 → throw(格式異常=unknown-state)', () => {
    expect(() => parseTapPayRefundResponse({ msg: 'x' })).toThrow(/缺 status/);
    expect(() => parseTapPayRefundResponse('nope')).toThrow(/非物件/);
  });

  it('refund_amount / refund_id 非預期型別 → undefined(防禦性;格式異常裁決留 adapter)', () => {
    const res = parseTapPayRefundResponse({ status: 0, refund_id: 123, refund_amount: '300' });
    expect(res.refundId).toBeUndefined();
    expect(res.refundAmount).toBeUndefined();
    expect(res.msg).toBe('');
  });
});

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

// ── backlog #301:Record API 真實回應形狀(2026-07-30 對正式商戶實測 + 官方 reference 逐字)──
//
// 🔴 **證據邊界(關卡2 F6 更正)**:實測證據 `~/.pcm-d1/d1b1-evidence-20260730.json` 只保存了
//   ①`responseShapes` 的**鍵名**(單筆 trade_record 實回 33 鍵)②`parsedResults` 裡當時 parser
//   讀得到的**值**(`amount=0` / `refundedAmount=101` / `recordStatus=3` / `isCaptured=false`)。
//   `original_amount` 與 `time` 當時的 parser 根本沒讀 ⇒ **它們的實際值從未被觀察過**;
//   本 fixture 內這兩欄的數值是**合成的**,只有「鍵存在」與其官方語意有來源。
//   ⚠️ 特別是 `time` 的單位(毫秒)目前**只有官方文件背書、無實測值佐證**。
// 官方語意來源:https://docs.tappaysdk.com/tutorial/zh/reference.html
//   `amount`「交易金額,會因退款而減少」/ `original_amount`「一筆交易的原始金額 此金額不會因款項被退款而受影響」
//   / `refunded_amount`「退款金額」/ `time`「交易時間,單位為毫秒」。

/** 正式商戶實回的 33 個鍵(逐字);未列出的值只是佔位,鍵名才是本 fixture 的重點。 */
function productionShapedRecord(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    amount: 101,
    app_name: 'PCM',
    auth_code: '123456',
    authentication_method: 'BANK_3D',
    bank_result_code: '00',
    bank_result_msg: '',
    bank_transaction_end_millis: 1753000001000,
    bank_transaction_id: 'P16NVJ2BJ04SQM32KH7',
    bank_transaction_start_millis: 1753000000000,
    cap_millis: 1753086400000,
    card_identifier: 'card-ident',
    card_info: { bin_code: '424242', last_four: '4242' }, // PII:不得進 domain
    cardholder: { name: '王小明', email: 'buyer@example.com' }, // PII:不得進 domain
    currency: 'TWD',
    details: 'PCM Order 2b75b50a-91c9-42b0-a9cd-35b17a2a7215',
    is_captured: true,
    is_rba_verified: false,
    kyc_info: {},
    merchant_id: 'tppf_pcmmoto_5803001',
    merchant_name: 'PCM',
    order_number: '2b75b50a-91c9-42b0-a9cd-35b17a2a7215',
    original_amount: 101,
    partial_card_number: '424242****4242', // PII:不得進 domain
    pay_by_instalment: false,
    pay_by_redeem: false,
    payment_method: 'direct_pay',
    rec_trade_id: 'D20260724gUTcg1',
    record_status: 1,
    refunded_amount: 0,
    three_domain_secure: true,
    time: 1753000000000,
    transaction_complete_millis: 1753000002000,
    transaction_method_details: {},
    ...over,
  };
}

const recordResponse = (rec: Record<string, unknown>) => ({
  status: 2,
  msg: 'End of list',
  number_of_transactions: 1,
  records_per_page: 50,
  page: 0,
  total_page_count: 1,
  trade_records: [rec],
});

describe('parseTapPayRecordResponse — #301 真實回應形狀', () => {
  it('未退款筆:amount = original_amount、refunded_amount = 0、時間取自 `time`', () => {
    const res = parseTapPayRecordResponse(recordResponse(productionShapedRecord()));
    const r = res.records[0]!;
    expect(r.amount).toBe(101);
    expect(r.originalAmount).toBe(101);
    expect(r.refundedAmount).toBe(0);
    expect(r.timeMillis).toBe(1753000000000);
    expect(r.recordStatus).toBe(1);
  });

  it('🔴 全額退款筆(形狀取自 0102/0104,`original_amount`/`time` 為合成值):amount 歸 0、原額在 original_amount、refunded_amount = 已退金額', () => {
    const res = parseTapPayRecordResponse(
      recordResponse(
        productionShapedRecord({ amount: 0, refunded_amount: 101, record_status: 3, is_captured: false }),
      ),
    );
    const r = res.records[0]!;
    expect(r.amount).toBe(0); // 官方:會因退款而減少
    expect(r.originalAmount).toBe(101); // 官方:不受退款影響
    expect(r.refundedAmount).toBe(101); // 官方:退款金額
    expect(r.recordStatus).toBe(3);
    // ⚠️ 這條等式是**從官方三欄語意推導**的,官方欄位表沒有明文寫它;
    //    且 0102 的 `original_amount` 值未被觀察過 ⇒ **不能宣稱「實測逐格成立」**(關卡2 R2-8)。
    //    這裡只是斷言本 fixture 自己的一致性,不是在證明 TapPay 保證這條等式。
    expect(r.amount + r.refundedAmount!).toBe(r.originalAmount);
  });

  it('🔴 負向:`transaction_time_millis` 不是本 API 的欄位 ⇒ 只有它、沒有 `time` 時 timeMillis 必為 undefined', () => {
    const { time: _dropped, ...withoutTime } = productionShapedRecord();
    const res = parseTapPayRecordResponse(
      recordResponse({ ...withoutTime, transaction_time_millis: 1753000000000 }),
    );
    expect(res.records[0]!.timeMillis).toBeUndefined();
  });

  it('缺 original_amount(舊紀錄)→ undefined,不自動補 amount(fallback 由消費端明寫)', () => {
    const { original_amount: _dropped, ...withoutOriginal } = productionShapedRecord();
    const res = parseTapPayRecordResponse(recordResponse(withoutOriginal));
    expect(res.records[0]!.originalAmount).toBeUndefined();
    expect(res.records[0]!.amount).toBe(101);
  });

  it('#16 PII:解析結果的鍵集恰為白名單欄(cardholder / card_info / partial_card_number 皆不在內)', () => {
    const res = parseTapPayRecordResponse(recordResponse(productionShapedRecord()));
    expect(Object.keys(res.records[0]!).sort()).toEqual(
      [
        'amount',
        'bankTransactionId',
        'currency',
        'isCaptured',
        'merchantId',
        'orderNumber',
        'originalAmount',
        'recTradeId',
        'recordStatus',
        'refundedAmount',
        'timeMillis',
      ].sort(),
    );
  });
});

describe('🔴 M-4b 生命週期 L2 — numberOfTransactionsReported(count 是 TapPay 回的還是我們推的)', () => {
  // 為什麼需要這個旗標:settleCharge 用「count===0 且 records.length===0」判 record_not_found,
  // 而 L5 會拿那個 reason 去自動釋鎖。parser 在 count 欄缺席時以 records.length 補 ⇒ 兩個條件塌成一個
  // ⇒ 只回 {status,msg} 的異常回應會長得跟「TapPay 說沒有這筆」一模一樣。旗標把兩者分開。

  it('L2-W1 回應有 number_of_transactions → reported = true(值照回、不改)', () => {
    const res = parseTapPayRecordResponse({ status: 0, msg: 'ok', number_of_transactions: 0, trade_records: [] });
    expect(res.numberOfTransactions).toBe(0);
    expect(res.numberOfTransactionsReported).toBe(true);
  });

  it('🔴 L2-W2 回應缺 number_of_transactions → reported = false(count 仍退回 records.length、行為不變)', () => {
    const res = parseTapPayRecordResponse({ status: 0, msg: 'ok' });
    expect(res.numberOfTransactions).toBe(0); // 既有 fallback 行為零改動
    expect(res.numberOfTransactionsReported).toBe(false); // 但「這是推的」如實帶出
  });

  it.each([['字串', 'x'], ['物件', { a: 1 }], ['數字', 0]] as const)(
    '🔴 L2-W4 trade_records 有值但是%s(非陣列)→ throw,不得靜默折成空陣列',
    (_label, bad) => {
      // codex 關卡2 R2:折成 [] 之後,搭配「回報 count=0」會長得跟「TapPay 說沒有這筆」一樣
      // ⇒ 形狀異常的回應被誤判成 record_not_found(L5 的釋鎖依據)。突變(拿掉 throw)⇒ 這三條紅。
      expect(() =>
        parseTapPayRecordResponse({ status: 0, msg: 'ok', number_of_transactions: 0, trade_records: bad }),
      ).toThrow(/trade_records/);
    },
  );

  it.each([['缺欄', undefined], ['null', null]] as const)(
    'L2-W5 trade_records %s = 合法空回應(照舊不 throw、records=[])',
    (_label, v) => {
      const body: Record<string, unknown> = { status: 0, msg: 'ok', number_of_transactions: 0 };
      if (v === null) body.trade_records = null;
      const res = parseTapPayRecordResponse(body);
      expect(res.records).toEqual([]);
    },
  );

  it('🔴 L2-W3 number_of_transactions 型別不對(字串 "0")→ reported = false(不採信非數字)', () => {
    const res = parseTapPayRecordResponse({ status: 0, msg: 'ok', number_of_transactions: '0', trade_records: [] });
    expect(res.numberOfTransactionsReported).toBe(false);
  });
});
