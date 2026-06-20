/**
 * @module @pcm/adapters/tappay/TapPayChargeAdapter — TapPay pay-by-prime 真實作(M-3 階段②-②a)
 *
 * **🔴 server-only**(檔頭 `import 'server-only'`、編譯期擋 client import):
 * - 持 Partner Key(server-only secret、`x-api-key`);**絕不進 client bundle**。
 * - 走 `@pcm/adapters/server` subpath 匯出(非 root barrel)、composition root 唯一受控注入點
 *   (對齊 ADR-0005 §7 + WalletAdapter/AuthAdapter 前例;結構守門見 eslint no-restricted-imports)。
 *
 * 職責邊界(忠實 wire→domain 映射、不做業務判斷):
 * - `charge`:組 pay-by-prime body → `fetch` → 解析 → `status===0`?succeeded:failed。
 *   - 成功:`result.amount` = `toMoneyAmount(wire.amount)` + currency 斷言 'TWD'(單位斷言);
 *     供 use-case PF-X3 比對 server total(adapter 不做金額比對、那是 use-case 業務層)。
 *   - 業務失敗(status≠0、卡拒等):status='failed'(未扣款、use-case 可安全重試)。
 *   - transport/HTTP/格式異常:throw(use-case 映 charge_unknown、扣款狀態未知不重刷)。
 * - `recordQuery`(M-3 3DS-1a):組 Record API filter → `fetch` → 解析 trade_records 白名單欄;
 *   **不下裁決**(判 paid 是 3DS-1b settleCharge 的事)、HTTP/格式異常 → throw(1b 映 pending 保留)。
 * - 🔴 #16 PII:logging 只記非 PII(orderId/status/recTradeId);cardholder + rawResponse 絕不入 log。
 *
 * @see docs/specs/2026-06-12-m3-stage2-2-tappay-adapter-plan.md §2/§5/§7
 * @see packages/ports/src/ITapPayAdapter.ts
 */
import 'server-only';

import type { ITapPayAdapter } from '@pcm/ports';
import type {
  ChargeStatus,
  Currency,
  OrderId,
  TapPayChargePayload,
  TapPayChargeResult,
  TapPayInitiationPayload,
  TapPayInitiationResult,
  TapPayRefundPayload,
  TapPayRefundResult,
  TapPayRecordQuery,
  TapPayRecordResult,
  TapPayTradeRecord,
} from '@pcm/domain';
import { toMoneyAmount } from '@pcm/domain';
import { parseTapPayResponse, parseTapPayRecordResponse, type TapPayRecordWire } from './wire';

/**
 * TapPayChargeConfig:adapter 連線設定(env 由 composition root 讀、DI 注入、可測)。
 * `payByPrimeUrl` 由 env 決定 sandbox vs prod(adapter 不寫死 endpoint)。
 */
export type TapPayChargeConfig = {
  partnerKey: string;
  merchantId: string;
  payByPrimeUrl: string;
  /** Record API(交易紀錄反查)endpoint;由 env(TAPPAY_ENV)決定 sandbox vs prod、adapter 不寫死。 */
  recordQueryUrl: string;
};

/** wire→domain:Record API 單筆 trade_record(金額走 toMoneyAmount 守門整數;currency 原值留 1b 斷言)。 */
function toTradeRecord(w: TapPayRecordWire): TapPayTradeRecord {
  return {
    recTradeId: w.recTradeId,
    orderNumber: w.orderNumber,
    bankTransactionId: w.bankTransactionId,
    merchantId: w.merchantId,
    amount: toMoneyAmount(w.amount),
    currency: w.currency,
    recordStatus: w.recordStatus,
    isCaptured: w.isCaptured,
    refundedAmount: w.refundedAmount !== undefined ? toMoneyAmount(w.refundedAmount) : undefined,
    transactionTimeMillis: w.transactionTimeMillis,
  };
}

/** 幣別斷言:TapPay 回應非 TWD → throw(視為金額/設定異常 → use-case charge_unknown)。 */
function assertTwdCurrency(currency: string | undefined): Currency {
  if (currency !== 'TWD') {
    throw new Error(`TapPay 回應幣別非 TWD(got ${currency ?? 'undefined'})`);
  }
  return 'TWD';
}

export class TapPayChargeAdapter implements ITapPayAdapter {
  constructor(private readonly config: TapPayChargeConfig) {}

  async charge(payload: TapPayChargePayload): Promise<TapPayChargeResult> {
    // 🔴 卡資料(PAN/CVV)永不進 server:只收 prime(一次性 token)+ cardholder PII;amount=server 算的整數。
    const body = {
      partner_key: this.config.partnerKey,
      prime: payload.prime,
      amount: payload.amount.amount, // MoneyAmount(整數、最小貨幣單位);client 永不送價、此為 server 權威 total
      merchant_id: this.config.merchantId,
      // 🔴 order_number = TapPay 訂單識別欄(官方 pay-by-prime、WebFetch docs.tappaysdk.com/tutorial/zh/back.html 核實:
      //   「自定義訂單編號、用於 TapPay 做訂單識別、若帶入則不能為空」)。孤兒單(charge_unknown / confirm 失敗)
      //   時 ②-⑥ webhook(notify)+ TapPay Record API 靠此回連 PCM order 對帳;orderId 恆非空。details 另留人類可讀。
      order_number: payload.orderId,
      details: `PCM Order ${payload.orderId}`,
      cardholder: {
        name: payload.cardholder.name,
        email: payload.cardholder.email,
        // phoneNumber domain 必填(②-③ 從結帳地址取、恆有);官方標 name/email/phone 必填、不送空字串。
        phone_number: payload.cardholder.phoneNumber,
      },
    };

    const response = await fetch(this.config.payByPrimeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.partnerKey,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      // HTTP 層失敗(auth/infra)= 扣款狀態未知 → throw(use-case charge_unknown、不誤判未扣款)。
      throw new Error(`TapPay pay-by-prime HTTP ${response.status}`);
    }

    const raw: unknown = await response.json();
    const wire = parseTapPayResponse(raw);

    if (wire.status !== 0) {
      // 業務失敗(卡拒等)、未扣款 → failed;use-case status-first 短路、amount/transactionId 為佔位不讀。
      this.logOutcome(payload.orderId, 'failed', wire.recTradeId);
      return {
        status: 'failed',
        transactionId: wire.recTradeId ?? '',
        amount: { amount: toMoneyAmount(0), currency: 'TWD' },
        rawResponse: raw,
      };
    }

    // status===0 = 成功扣款 → 必有 rec_trade_id + amount(缺則格式異常 → charge_unknown)。
    if (!wire.recTradeId || wire.amount === undefined) {
      throw new Error('TapPay 成功回應缺 rec_trade_id / amount(格式異常)');
    }
    const result: TapPayChargeResult = {
      status: 'succeeded',
      transactionId: wire.recTradeId,
      amount: { amount: toMoneyAmount(wire.amount), currency: assertTwdCurrency(wire.currency) },
      rawResponse: raw,
    };
    this.logOutcome(payload.orderId, 'succeeded', wire.recTradeId);
    return result;
  }

  /**
   * 3DS charge 啟動(3DS-5a):組 3DS body → `fetch` → 回 `payment_url` 跳轉網址 + `rec_trade_id`,**不請款**。
   *
   * 🔴 與同步 `charge` 獨立(語意不同、既有 `charge` 與測試零改);body 加 `three_domain_secure:true` +
   * `result_url{frontend_redirect_url, backend_notify_url}` + caller 帶入唯一 `bank_transaction_id`;
   * 🔴 **不送 `delay_capture_in_days`**(省略=預設 0 當天請款、避免停 AUTH;master plan §7 + r3)。
   *
   * 🔴 解析(codex 關卡1 #2、不可過寬釋鎖):**唯** `status===0` **且**有 `payment_url`+`rec_trade_id` →
   * `pending_3ds`。其餘一律 throw:`status!==0`(含 421 操作逾時/網關 timeout 等模糊態、卡拒、缺 payment_url)、
   * HTTP 非 2xx、JSON 格式異常。理由 = 3DS 啟動非成功未必「明確未扣款」(timeout 可能 OTP 後已成交)→ adapter
   * 不自判 failed、不給 use-case 釋鎖依據;最終由 settleCharge / Record API 唯一權威裁決。
   * 🔴 #16 PII:只記 orderId/status/recTradeId/bankTransactionId;cardholder / rawResponse / **payment_url**(含 token)不入 log。
   */
  async initiateThreeDSCharge(payload: TapPayInitiationPayload): Promise<TapPayInitiationResult> {
    // 🔴 卡資料(PAN/CVV)永不進 server:只收 prime + cardholder PII;amount=server 算的整數;bank_transaction_id=caller 自產唯一鍵。
    const body = {
      partner_key: this.config.partnerKey,
      prime: payload.prime,
      amount: payload.amount.amount, // MoneyAmount(整數、最小貨幣單位);client 永不送價、此為 server 權威 total
      merchant_id: this.config.merchantId,
      order_number: payload.orderId, // TapPay 訂單識別欄(孤兒對帳回連 PCM order;同步 charge 同慣例)
      details: `PCM Order ${payload.orderId}`,
      cardholder: {
        name: payload.cardholder.name,
        email: payload.cardholder.email,
        phone_number: payload.cardholder.phoneNumber, // domain 必填、不送空字串
      },
      // 🔴 3DS 啟動專屬欄(同步 charge body 無):
      three_domain_secure: true,
      result_url: {
        frontend_redirect_url: payload.frontendRedirectUrl, // 銀行 OTP 後前端跳轉(https)
        backend_notify_url: payload.backendNotifyUrl, // 結算 server 通知(webhook 祕密路徑段)
      },
      bank_transaction_id: payload.bankTransactionId, // caller 自產唯一鍵(charge 前已 durable;adapter 不自產)
      // 🔴 不送 delay_capture_in_days(省略=預設 0 當天請款、避免停 AUTH;master plan §7 + r3)。
    };

    const response = await fetch(this.config.payByPrimeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.partnerKey,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      // HTTP 層失敗 = 啟動狀態未知(timeout 後可能已成交)→ throw(use-case charge_unknown、不釋鎖)。
      throw new Error(`TapPay pay-by-prime(3DS)HTTP ${response.status}`);
    }

    const raw: unknown = await response.json();
    const wire = parseTapPayResponse(raw);
    this.logInitiation(payload.orderId, wire.status, wire.recTradeId, payload.bankTransactionId);

    // 🔴 唯 status===0 且有 payment_url + rec_trade_id → pending_3ds;其餘一律 throw(過寬釋鎖風險、codex 關卡1 #2)。
    if (wire.status !== 0 || !wire.paymentUrl || !wire.recTradeId) {
      throw new Error(
        `TapPay 3DS 啟動未成功或缺 payment_url/rec_trade_id(status ${wire.status})`,
      );
    }

    return {
      status: 'pending_3ds',
      paymentUrl: wire.paymentUrl,
      recTradeId: wire.recTradeId,
      bankTransactionId: payload.bankTransactionId, // 回送 caller 自產鍵(已 durable;非依賴 TapPay 回欄)
    };
  }

  async refund(_payload: TapPayRefundPayload): Promise<TapPayRefundResult> {
    // Phase 1 不接退款(refund 留 Phase 2、kickoff §7);interface 要求方法存在 → 誠實 throw、不假裝實作。
    throw new Error('TapPay refund 未實作(Phase 2)');
  }

  /**
   * Record API 反查(3DS-1a):依交易識別鍵查 TapPay 交易紀錄 → 解析白名單欄回給 3DS-1b。
   *
   * 🔴 **不下裁決**:忠實送查 + 解析 top status / trade_records;judging 成立(paid)= settleCharge(1b)以
   * record_status ∈ {0 AUTH,1 OK} + 識別/金額/幣別閘判定(S1 授權即成立、不再要求 is_captured;is_captured
   * 僅保留解析/audit)。HTTP 非 2xx / 格式異常 → throw(1b 映 pending)。
   * fail-closed:三把識別鍵全空 → 拒(絕不送無 filter 全表查 → 防誤命中他單)。`merchant_id` 每查必帶(限本商戶)。
   */
  async recordQuery(query: TapPayRecordQuery): Promise<TapPayRecordResult> {
    if (!query.recTradeId && !query.orderNumber && !query.bankTransactionId) {
      throw new Error('recordQuery 需至少一把交易識別鍵(recTradeId/orderNumber/bankTransactionId)');
    }
    // filters:只帶 caller 給的識別鍵 + 恆帶 merchant_id(Array;限本商戶、防跨商戶誤命中)。
    const filters: Record<string, unknown> = { merchant_id: [this.config.merchantId] };
    if (query.recTradeId) filters.rec_trade_id = query.recTradeId;
    if (query.orderNumber) filters.order_number = query.orderNumber;
    if (query.bankTransactionId) filters.bank_transaction_id = query.bankTransactionId;

    const response = await fetch(this.config.recordQueryUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.partnerKey,
      },
      body: JSON.stringify({
        partner_key: this.config.partnerKey,
        filters,
        records_per_page: 50,
        page: 0,
      }),
    });
    if (!response.ok) {
      // HTTP 層失敗 = 查不到真狀態 → throw(1b 映 pending 保留、不誤判 failed)。
      throw new Error(`TapPay Record API HTTP ${response.status}`);
    }

    const raw: unknown = await response.json();
    const wire = parseTapPayRecordResponse(raw);
    // 🔴 wire 完整性(非業務裁決;codex 關卡2):filter 已帶 merchant_id → 回應每筆 merchant_id 必為本商戶,
    //   否則視為 wire 異常 throw(1b 映 pending 保留、不誤採他商戶紀錄)。
    for (const rec of wire.records) {
      if (rec.merchantId !== this.config.merchantId) {
        throw new Error('TapPay Record 回應含非本商戶紀錄(merchant_id 不符 filter)');
      }
    }
    this.logRecordQuery(query, wire.status, wire.numberOfTransactions);
    return {
      queryStatus: wire.status,
      numberOfTransactions: wire.numberOfTransactions,
      records: wire.records.map(toTradeRecord),
    };
  }

  /** 🔴 #16:只記非 PII(orderId/status/recTradeId);cardholder + rawResponse 絕不入 log。 */
  private logOutcome(orderId: OrderId, status: ChargeStatus, recTradeId: string | undefined): void {
    console.info('[TapPayChargeAdapter] charge', {
      orderId,
      status,
      recTradeId: recTradeId ?? null,
    });
  }

  /**
   * 🔴 #16:3DS 啟動 log 只記非 PII 對帳識別鍵 + wire status;
   * cardholder / rawResponse / **payment_url**(含 token query)絕不入 log。
   */
  private logInitiation(
    orderId: OrderId,
    status: number,
    recTradeId: string | undefined,
    bankTransactionId: string,
  ): void {
    console.info('[TapPayChargeAdapter] initiateThreeDSCharge', {
      orderId,
      status,
      recTradeId: recTradeId ?? null,
      bankTransactionId,
    });
  }

  /** 🔴 #16:只記非 PII 對帳識別鍵 + 查詢結果計數;trade_records / card_info 絕不入 log。 */
  private logRecordQuery(query: TapPayRecordQuery, status: number, count: number): void {
    console.info('[TapPayChargeAdapter] recordQuery', {
      recTradeId: query.recTradeId ?? null,
      orderNumber: query.orderNumber ?? null,
      bankTransactionId: query.bankTransactionId ?? null,
      status,
      numberOfTransactions: count,
    });
  }
}
