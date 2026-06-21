/**
 * @module @pcm/adapters/tappay/wire — TapPay pay-by-prime wire 型別 + 防禦性解析
 *
 * wire 形狀以 context7 核實 TapPay 官方 pay-by-prime API 為準(非憑記憶):
 *   success resp `{ status:0, msg, rec_trade_id, bank_transaction_id, amount(整數), currency, card_info, ... }`
 *   business 失敗(卡拒等)`{ status:<非0>, msg, ... }`(可能無 rec_trade_id/amount)。
 *
 * 🔴 #16 PII:`card_info`(last_four/bin_code 等)+ 持卡人欄絕不解析進 domain、絕不寫 log;
 * 本層只取 status/msg/rec_trade_id/amount/currency,其餘 wire 欄留在 rawResponse(adapter 不寫 log)。
 *
 * @see docs/specs/2026-06-12-m3-stage2-2-tappay-adapter-plan.md §7
 */

/** TapPay pay-by-prime wire 回應(只 narrow 業務必要欄;status 必為 number 否則視為格式異常)。 */
export type TapPayPayByPrimeResponse = {
  /** 0 = 成功;非 0 = 業務失敗(msg 帶原因)。 */
  status: number;
  msg: string;
  /** 成功才有;業務失敗可能缺。 */
  recTradeId?: string;
  /** 成功才有;TapPay 實扣金額(TWD 為元位整數)。 */
  amount?: number;
  /** 成功才有;預期 'TWD'。 */
  currency?: string;
  /**
   * 🔴 3DS 啟動才有(`three_domain_secure:true`):付款頁跳轉網址。同步 charge 回應無此欄。
   * 含 token query → adapter 絕不寫 log。
   */
  paymentUrl?: string;
  /**
   * TapPay 交易訂單編號(同步成功 + 3DS 啟動回應皆可能回;caller 自帶時 TapPay 原樣回)。
   * 非 PII;3DS-5a 對帳次順位鍵。
   */
  bankTransactionId?: string;
};

/**
 * 防禦性解析 TapPay JSON 回應 → narrow `TapPayPayByPrimeResponse`。
 *
 * `status` 非 number(或非物件)→ throw(adapter 視為 transport/格式異常 → use-case 映 charge_unknown,
 * 不誤判成 charge_failed)。其餘欄缺則 undefined(由 adapter 依 status 決定是否為異常)。
 * 🔴 3DS-5a:新增白名單解析 `payment_url` / `bank_transaction_id`(選填;簽章不變、同步 charge 用法零影響、向後相容)。
 */
export function parseTapPayResponse(raw: unknown): TapPayPayByPrimeResponse {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('TapPay 回應格式異常(非物件)');
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.status !== 'number') {
    throw new Error('TapPay 回應缺 status');
  }
  return {
    status: r.status,
    msg: typeof r.msg === 'string' ? r.msg : '',
    recTradeId: typeof r.rec_trade_id === 'string' ? r.rec_trade_id : undefined,
    amount: typeof r.amount === 'number' ? r.amount : undefined,
    currency: typeof r.currency === 'string' ? r.currency : undefined,
    paymentUrl: typeof r.payment_url === 'string' ? r.payment_url : undefined,
    bankTransactionId: typeof r.bank_transaction_id === 'string' ? r.bank_transaction_id : undefined,
  };
}

// ── M-3 3DS-1a:Record API(交易紀錄反查)wire 型別 + 防禦性解析 ──────────────────────────────
//
// wire 形狀(endpoint + 欄位名)以 TapPay 官方 Record API reference 核實(docs.tappaysdk.com、非憑記憶):
//   POST `/tpc/transaction/query`,resp `{ status, msg, number_of_transactions, trade_records:[
//     { rec_trade_id, order_number, bank_transaction_id, merchant_id, amount(int), currency,
//       record_status(int -1~5,值見下方型別), is_captured(bool), refunded_amount(int), transaction_time_millis } ] }`。
//   top `status`:0=查詢成功有紀錄 / 2=查詢成功(已無更多分頁)(皆查詢成功、≠交易狀態;有無紀錄看 trade_records、與 status 正交)。
//   🔴 record_status enum 7 值經審查側逐字複核釘死(reference.html #record_status anchor);小模型萃取曾幻覺、勿信。
//
// 🔴 #16 PII:trade_record 的 cardholder / card_info / pay_info(masked card)欄一律**不解析**進 domain、
//    本層只取白名單對帳欄(adapter 亦不寫 log)。

/** TapPay Record API `trade_records[]` 單筆 wire(白名單欄;snake→camel narrow)。 */
export type TapPayRecordWire = {
  recTradeId: string;
  orderNumber: string;
  bankTransactionId?: string;
  merchantId: string;
  /** 整數最小貨幣單位。 */
  amount: number;
  currency?: string;
  /** -1=ERROR / 0=AUTH / 1=OK / 2=PARTIALREFUNDED / 3=REFUNDED / 4=PENDING / 5=CANCEL(官方 reference 逐字)。 */
  recordStatus: number;
  isCaptured: boolean;
  refundedAmount?: number;
  transactionTimeMillis?: number;
};

/** TapPay Record API 反查回應 wire(top status + 計數 + 解析後 records)。 */
export type TapPayRecordResponseWire = {
  /** top-level:0=查詢成功有紀錄 / 2=查詢成功(已無更多分頁)(皆查詢成功、≠交易狀態;有無紀錄看 trade_records、與 status 正交)。 */
  status: number;
  msg: string;
  numberOfTransactions: number;
  records: TapPayRecordWire[];
};

/**
 * 防禦性解析 TapPay Record API JSON 回應 → narrow `TapPayRecordResponseWire`。
 *
 * `status` 非 number(或非物件)→ throw(adapter 視為 transport/格式異常 → 1b 映 pending 保留、不誤判 failed)。
 * `trade_records` 缺/非陣列 → 空陣列(與 status 值正交:status=2 仍可帶紀錄〔已無更多分頁〕、亦可空〔本頁無紀錄〕);單筆缺必要欄 → throw(格式異常 fail-closed)。
 */
export function parseTapPayRecordResponse(raw: unknown): TapPayRecordResponseWire {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('TapPay Record 回應格式異常(非物件)');
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.status !== 'number') {
    throw new Error('TapPay Record 回應缺 status');
  }
  const rawRecords = Array.isArray(r.trade_records) ? r.trade_records : [];
  const records = rawRecords.map(parseTapPayRecordWire);
  return {
    status: r.status,
    msg: typeof r.msg === 'string' ? r.msg : '',
    // number_of_transactions 缺則退回實得筆數(誠實計數、不虛報)。
    numberOfTransactions:
      typeof r.number_of_transactions === 'number' ? r.number_of_transactions : records.length,
    records,
  };
}

/** 解析單筆 trade_record;缺任一必要欄(rec/order/merchant/amount/record_status/is_captured)→ throw。 */
function parseTapPayRecordWire(raw: unknown): TapPayRecordWire {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('TapPay Record trade_record 格式異常(非物件)');
  }
  const r = raw as Record<string, unknown>;
  if (
    typeof r.rec_trade_id !== 'string' ||
    typeof r.order_number !== 'string' ||
    typeof r.merchant_id !== 'string' ||
    typeof r.amount !== 'number' ||
    typeof r.record_status !== 'number' ||
    typeof r.is_captured !== 'boolean'
  ) {
    throw new Error(
      'TapPay Record trade_record 缺必要欄(rec_trade_id/order_number/merchant_id/amount/record_status/is_captured)',
    );
  }
  return {
    recTradeId: r.rec_trade_id,
    orderNumber: r.order_number,
    bankTransactionId: typeof r.bank_transaction_id === 'string' ? r.bank_transaction_id : undefined,
    merchantId: r.merchant_id,
    amount: r.amount,
    currency: typeof r.currency === 'string' ? r.currency : undefined,
    recordStatus: r.record_status,
    isCaptured: r.is_captured,
    refundedAmount: typeof r.refunded_amount === 'number' ? r.refunded_amount : undefined,
    transactionTimeMillis:
      typeof r.transaction_time_millis === 'number' ? r.transaction_time_millis : undefined,
  };
}
