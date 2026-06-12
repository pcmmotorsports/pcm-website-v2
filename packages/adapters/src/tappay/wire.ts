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
};

/**
 * 防禦性解析 TapPay JSON 回應 → narrow `TapPayPayByPrimeResponse`。
 *
 * `status` 非 number(或非物件)→ throw(adapter 視為 transport/格式異常 → use-case 映 charge_unknown,
 * 不誤判成 charge_failed)。其餘欄缺則 undefined(由 adapter 依 status 決定是否為異常)。
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
  };
}
