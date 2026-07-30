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
// 🔴 **來源分層(backlog #301、2026-07-30 更正;關卡2 R2-7 再收斂措辭)**——
//   ①**欄名是否存在** = 官方 reference 逐字(https://docs.tappaysdk.com/tutorial/zh/reference.html
//     的 `trade_records` 欄位表,以原始 HTML 自行解析、非小模型摘要)**+ 正式商戶實測鍵集**
//     (`~/.pcm-d1/d1b1-evidence-20260730.json` 的 `responseShapes`,單筆實回 33 鍵)⇒ 雙來源。
//   ②**欄位語意** = **只有官方文件**這一個來源。
//   ③**實際值被觀察過的欄位只有**(證據檔 `parsedResults`,0102/0104 兩筆):
//     `rec_trade_id` / `order_number` / `bank_transaction_id` / `merchant_id` / `currency` /
//     `amount`(=0)/ `refunded_amount`(=101 / 1180)/ `record_status`(=3)/ `is_captured`(=false)。
//     🔴 **`original_amount` 與 `time` 的值從未被觀察過**(當時的 parser 根本沒讀這兩欄)⇒
//     它們只有「鍵存在」+「官方語意」兩件事有來源,**任何測試 fixture 內這兩欄的數字都是合成的**。
//   ⚠️ **舊註解宣稱「以官方 reference 核實」但有三處與實回應不符**(#301 觸發原因),已逐條更正如下。
//
//   POST `/tpc/transaction/query`,resp `{ status, msg, number_of_transactions, records_per_page, page,
//     total_page_count, trade_records:[ { rec_trade_id, order_number, bank_transaction_id, merchant_id,
//       amount(int), original_amount(int), currency, record_status(int -1~5), is_captured(bool),
//       refunded_amount(int), time(long, epoch ms), cap_millis, transaction_complete_millis,
//       bank_transaction_start_millis, bank_transaction_end_millis, …(PII 欄不解析) } ] }`。
//   top `status`:0=查詢成功有紀錄 / 2=查詢成功(已無更多分頁)(皆查詢成功、≠交易狀態;有無紀錄看 trade_records、與 status 正交)。
//   🔴 record_status enum 7 值經審查側逐字複核釘死(reference.html #record_status anchor);小模型萃取曾幻覺、勿信。
//
// 🔴 **#301 三處更正(官方逐字 + 正式商戶實測)**:
//   ① `amount` = 官方逐字「交易金額,**會因退款而減少**」⇒ 全額退款後實回 **0**,
//      **不是**授權金額。原始金額在 `original_amount`(官方逐字「一筆交易的原始金額
//      此金額不會因款項被退款而受影響」)⇒ 要拿「這筆本來收多少」對帳,一律用 `original_amount`。
//   ② `refunded_amount` = 官方逐字「**退款金額**」(已退多少)。
//      🔴 07-30 實測只有「全額退款」樣本(回 101 / 1180 = 原額),該樣本**在型式上分辨不出**
//      「已退金額」與「原始金額」兩種解讀(全退時兩者恆等)⇒ 語意以官方文件為準,
//      不得再從那筆實測推論成「它放的是原本金額」(backlog #301 原文第 ② 條即為此誤推,已更正)。
//      實測與官方一致的旁證:`amount + refunded_amount === original_amount`(0 + 101 = 101)。
//   ③ 🔴 `transaction_time_millis` **不是本 API 的欄位** —— 官方 reference 該詞條的 Related topics
//      只列 payByPrime / payByToken(charge 回應與 backend notify payload 確有此欄、那兩處用法正確),
//      `trade_records` 欄位表內**沒有**它;正式商戶實回的 33 個鍵亦無。
//      本 API 的交易時間欄叫 **`time`**(官方逐字「交易時間,單位為毫秒」)⇒ 解析為 `timeMillis`。
//      舊 wire 讀不存在的欄 ⇒ 該值恆 undefined,連帶讓 `settle-charge` 弱識別時間窗恆 fail-closed。
//
// 🔴 #16 PII:trade_record 的 cardholder / card_info / pay_info(masked card)欄一律**不解析**進 domain、
//    本層只取白名單對帳欄(adapter 亦不寫 log)。

/** TapPay Record API `trade_records[]` 單筆 wire(白名單欄;snake→camel narrow)。 */
export type TapPayRecordWire = {
  recTradeId: string;
  orderNumber: string;
  bankTransactionId?: string;
  merchantId: string;
  /**
   * wire `amount`:整數最小貨幣單位。🔴 官方逐字「交易金額,**會因退款而減少**」——
   * 全額退款後為 0。要比對「本來收多少」請用 `originalAmount`。
   */
  amount: number;
  /**
   * wire `original_amount`:官方逐字「一筆交易的原始金額 此金額不會因款項被退款而受影響」。
   * 🔴 標成選填是**防禦性相容假設,不是已知事實** —— 官方欄位表未標必填,而 07-30 實測的
   * 兩筆(0102/0104)都有帶。缺值時由消費端自行決定是否退回 `amount`(見 settle-charge)。
   */
  originalAmount?: number;
  currency?: string;
  /** -1=ERROR / 0=AUTH / 1=OK / 2=PARTIALREFUNDED / 3=REFUNDED / 4=PENDING / 5=CANCEL(官方 reference 逐字)。 */
  recordStatus: number;
  isCaptured: boolean;
  /** wire `refunded_amount`:官方逐字「退款金額」(**已退多少**,非原始金額;見檔頭 #301 ②)。 */
  refundedAmount?: number;
  /**
   * wire **`time`**(官方逐字「交易時間,單位為毫秒」)。
   * 🔴 **不是 `transaction_time_millis`** —— 那是 payByPrime / notify 的欄位、本 API 沒有(#301 ③)。
   */
  timeMillis?: number;
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
    originalAmount: typeof r.original_amount === 'number' ? r.original_amount : undefined,
    currency: typeof r.currency === 'string' ? r.currency : undefined,
    recordStatus: r.record_status,
    isCaptured: r.is_captured,
    refundedAmount: typeof r.refunded_amount === 'number' ? r.refunded_amount : undefined,
    // 🔴 #301 ③:交易時間欄是 `time`;`transaction_time_millis` 本 API 不回、刻意不讀(負向測試釘住)。
    timeMillis: typeof r.time === 'number' ? r.time : undefined,
  };
}
