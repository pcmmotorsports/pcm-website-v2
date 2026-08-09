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

import type { ITapPayAdapter, TapPayRecordQueryOptions, TapPayRefundOptions } from '@pcm/ports';
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
import { toMoneyAmount, TAPPAY_REFUND_STATUS, TapPayRefundNotSentError } from '@pcm/domain';
import {
  parseTapPayResponse,
  parseTapPayRecordResponse,
  parseTapPayRefundResponse,
  type TapPayRecordWire,
  type TapPayRefundResponseWire,
} from './wire';

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
  /** Refund API endpoint(M-3 退款線第一片);同上由 env 決定、adapter 不寫死。 */
  refundUrl: string;
};

/** refund 預設逾時(官方建議 30s;🔴 恆在 —— 呼叫端有給 signal 也以 AbortSignal.any 合成、不移除)。 */
export const REFUND_DEFAULT_TIMEOUT_MS = 30_000;

/** rec_trade_id pre-flight 形狀(官方 String 20;非空、無空白)。 */
const REC_TRADE_ID_RE = /^\S{1,20}$/;
/** bank_refund_id pre-flight 形狀(官方 String 20 + 帳本 CHECK 1-20;涵蓋 BRID-SEED-01 慣例;UUID 36 字放不下)。 */
const BANK_REFUND_ID_RE = /^[A-Za-z0-9_-]{1,20}$/;

/** wire→domain:Record API 單筆 trade_record(金額走 toMoneyAmount 守門整數;currency 原值留 1b 斷言)。 */
function toTradeRecord(w: TapPayRecordWire): TapPayTradeRecord {
  return {
    recTradeId: w.recTradeId,
    orderNumber: w.orderNumber,
    bankTransactionId: w.bankTransactionId,
    merchantId: w.merchantId,
    amount: toMoneyAmount(w.amount),
    // #301:原始金額(不因退款減少);缺值不補 amount,由消費端明寫 fallback。
    originalAmount: w.originalAmount !== undefined ? toMoneyAmount(w.originalAmount) : undefined,
    currency: w.currency,
    recordStatus: w.recordStatus,
    isCaptured: w.isCaptured,
    refundedAmount: w.refundedAmount !== undefined ? toMoneyAmount(w.refundedAmount) : undefined,
    timeMillis: w.timeMillis,
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

  /**
   * Refund API(M-3 退款線第一片):組 refund body → `fetch` → 三態(accepted/deferred/rejected)或 throw。
   *
   * 🔴 fail-closed 錯誤二分(port JSDoc 詳):pre-flight 違規 → `TapPayRefundNotSentError`
   * (確定未送出、fetch 零呼叫);送出後一切異常(HTTP/transport/逾時/格式/未實證碼)→ 一般
   * throw = unknown-state、呼叫端絕不得自動重發。deferred(10024)/rejected(10051)只在
   * `kind='partial'` 可達 —— 零副作用實證全是 partial 情境,full 撞任何非 0 碼=未實證組合、throw。
   * 🔴 runtime 守門不信 TS 型別(呼叫端可能是 JS/any):payload 逐欄驗過才碰網路。
   * 🔴 log 紀律:fetch 前 `attempt_started`(transport 失敗也留「開始送出」紀錄);status=0 先落
   * `accepted` log 再驗欄位完整性(TapPay 已受理、錢在動,後續 throw 不得讓本次呼叫零紀錄);
   * 格式異常路徑補第二筆 `accepted_malformed`(讓 log 與真成功不同形、值班不會誤判「不用管」)。
   */
  async refund(
    payload: TapPayRefundPayload,
    options?: TapPayRefundOptions,
  ): Promise<TapPayRefundResult> {
    // ── pre-flight(任一違反 → TapPayRefundNotSentError、fetch 零呼叫、零 log)──────────────
    const p: unknown = payload;
    if (typeof p !== 'object' || p === null) {
      throw new TapPayRefundNotSentError(
        'refund payload 非物件(rec 不可得 / bank_refund 不可得;未送出)',
      );
    }
    const rec = p as Record<string, unknown>;
    // 兩把對帳鍵 best-effort 進每條錯誤訊息(值班反查用;String() 呈現、截 24 字防灌爆、空值顯示「(空)」)。
    const showKey = (v: unknown): string => {
      const s = String(v).slice(0, 24);
      return s === '' ? '(空)' : s;
    };
    const keyCtx = `rec ${showKey(rec.transactionId)} / bank_refund ${showKey(rec.bankRefundId)}`;
    const kind = rec.kind;
    if (kind !== 'full' && kind !== 'partial') {
      // TS union 擋不住 runtime 資料;discriminant 打錯字若放行,partial 意圖會滑成全額退。
      throw new TapPayRefundNotSentError(
        `refund kind 須為 full|partial(got ${String(kind)};${keyCtx};未送出)`,
      );
    }
    const transactionId = rec.transactionId;
    if (typeof transactionId !== 'string' || !REC_TRADE_ID_RE.test(transactionId)) {
      throw new TapPayRefundNotSentError(
        `refund transactionId 非法(需 1-20 字、非空、無空白;${keyCtx};未送出)`,
      );
    }
    const bankRefundId = rec.bankRefundId;
    if (typeof bankRefundId !== 'string' || !BANK_REFUND_ID_RE.test(bankRefundId)) {
      throw new TapPayRefundNotSentError(
        `refund bankRefundId 非法(需 ^[A-Za-z0-9_-]{1,20}$;UUID 36 字放不下、不要傳 row id;${keyCtx};未送出)`,
      );
    }
    if (kind === 'full' && 'amount' in rec) {
      // JS 呼叫端 discriminant 寫錯時 amount 被靜默忽略=意外全額退 → 顯式拒絕(codex 關卡1 R3)。
      throw new TapPayRefundNotSentError(
        `refund kind=full 不得帶 amount(部分退請用 kind=partial;${keyCtx};未送出)`,
      );
    }
    let requestedAmount: number | null = null;
    if (kind === 'partial') {
      const amountRaw = rec.amount;
      if (typeof amountRaw !== 'object' || amountRaw === null) {
        throw new TapPayRefundNotSentError(`refund partial 缺 amount(Money 物件;${keyCtx};未送出)`);
      }
      const money = amountRaw as Record<string, unknown>;
      if (money.currency !== 'TWD') {
        throw new TapPayRefundNotSentError(
          `refund partial 幣別非 TWD(got ${String(money.currency)};${keyCtx};未送出)`,
        );
      }
      const value = money.amount;
      if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        throw new TapPayRefundNotSentError(
          `refund partial 金額須正整數(got ${String(value)};${keyCtx};未送出)`,
        );
      }
      requestedAmount = value;
    }

    // ── attempt_started:fetch 前落 log(transport 層失敗也至少留「開始送出」紀錄)────────────
    this.logRefund({
      recTradeId: transactionId,
      outcome: 'attempt_started',
      wireStatus: null,
      refundId: null,
      bankRefundId,
      bankResultCode: null,
      kind,
      requestedAmount,
    });

    const body: Record<string, unknown> = {
      partner_key: this.config.partnerKey,
      rec_trade_id: transactionId,
      bank_refund_id: bankRefundId,
    };
    if (kind === 'partial') {
      body.amount = requestedAmount; // kind 判斷、非 truthy(amount=0 已在 pre-flight 擋)
    }

    // 🔴 30s 逾時恆在:呼叫端有給 signal → any() 合成(先到先中止、reason 原樣),不移除逾時上限。
    const timeoutSignal = AbortSignal.timeout(REFUND_DEFAULT_TIMEOUT_MS);
    const signal = options?.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;

    let response: Response;
    try {
      response = await fetch(this.config.refundUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.partnerKey,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      // 🔴 送出後不存在「未送出」(codex 關卡2):caller 若拿 TapPayRefundNotSentError 當 abort
      //   reason,原樣外拋會讓 unknown-state 被誤讀成「可安全重發」→ 雙退 ⇒ 重包裸 Error。
      //   其餘 transport/abort 錯誤**原樣外拋、身分保留**(TimeoutError/自訂 reason 不得被吞或
      //   改寫;兩鍵已在 attempt_started log 可反查)。單向重包、反方向物理上不存在。
      if (err instanceof TapPayRefundNotSentError) {
        throw new Error(
          `TapPay refund 已送出後中止、abort reason 誤用 NotSentError(狀態未知、不得自動重發;${keyCtx})`,
        );
      }
      throw err;
    }
    if (!response.ok) {
      throw new Error(`TapPay refund HTTP ${response.status}(狀態未知、不得自動重發;${keyCtx})`);
    }
    let raw: unknown;
    try {
      raw = await response.json();
    } catch (err) {
      if (err instanceof TapPayRefundNotSentError) {
        throw new Error(
          `TapPay refund 已送出後中止、abort reason 誤用 NotSentError(狀態未知、不得自動重發;${keyCtx})`,
        );
      }
      if (signal.aborted && err === signal.reason) {
        // body 讀取中被中止:丟出的就是 signal.reason 本體 → 身分保留(同上 transport 紀律)。
        // 🔴 判別式必須比對物件同一性、不能只看 aborted 旗標(codex 關卡2 殘確):SyntaxError
        //   與 abort 競態時 aborted 可能恰為 true,只看旗標會把解碼錯誤誤放行成 abort 身分。
        throw err;
      }
      // HTTP 2xx 但 body 解碼失敗(非法 JSON 等)= 格式異常,補兩鍵(codex 關卡2 R2 #1)。
      throw new Error(
        `TapPay refund 回應解碼失敗(${err instanceof Error ? err.message : String(err)};狀態未知、不得自動重發;${keyCtx})`,
      );
    }

    let wire: TapPayRefundResponseWire;
    try {
      wire = parseTapPayRefundResponse(raw);
    } catch (err) {
      // wire 格式異常補兩鍵(parser 本身不知道鍵;值班從錯誤訊息即可反查帳本列)。
      throw new Error(
        `TapPay refund 回應格式異常(${err instanceof Error ? err.message : String(err)};狀態未知、不得自動重發;${keyCtx})`,
      );
    }

    if (wire.status === 0) {
      // 🔴 先落 log 再驗欄位完整性:TapPay 已受理、錢在動,後續任何 throw 都不得讓本次呼叫零紀錄。
      this.logRefund({
        recTradeId: transactionId,
        outcome: 'accepted',
        wireStatus: 0,
        refundId: wire.refundId ?? null,
        bankRefundId,
        bankResultCode: wire.bankResultCode ?? null,
        kind,
        requestedAmount,
      });
      const refundId = wire.refundId;
      const refundAmount = wire.refundAmount;
      if (
        typeof refundId !== 'string' ||
        refundId === '' ||
        refundId.trim() !== refundId ||
        refundAmount === undefined ||
        !Number.isInteger(refundAmount) ||
        refundAmount < 0
      ) {
        // 與真成功不同形的第二筆 log:值班看 log 才不會把這筆當「已受理、不用管」(fable R3 F2)。
        this.logRefund({
          recTradeId: transactionId,
          outcome: 'accepted_malformed',
          wireStatus: 0,
          refundId: refundId ?? null,
          bankRefundId,
          bankResultCode: wire.bankResultCode ?? null,
          kind,
          requestedAmount,
        });
        throw new Error(
          `TapPay refund 受理回應格式異常(refund_id ${refundId ?? '缺'} / refund_amount ${wire.refundAmount ?? '缺'};狀態未知、不得自動重發;rec ${transactionId} / bank_refund ${bankRefundId})`,
        );
      }
      return {
        status: 'accepted',
        refundId,
        refundAmount: toMoneyAmount(refundAmount),
        isCaptured: wire.isCaptured,
        bankRefundId,
        rawResponse: raw,
      };
    }

    if (kind === 'partial' && wire.status === TAPPAY_REFUND_STATUS.NOT_CAPTURED_PARTIAL) {
      this.logRefund({
        recTradeId: transactionId,
        outcome: 'deferred',
        wireStatus: wire.status,
        refundId: null,
        bankRefundId,
        bankResultCode: wire.bankResultCode ?? null,
        kind,
        requestedAmount,
      });
      return {
        status: 'deferred',
        wireStatus: TAPPAY_REFUND_STATUS.NOT_CAPTURED_PARTIAL,
        msg: wire.msg,
        bankResultCode: wire.bankResultCode,
        rawResponse: raw,
      };
    }
    if (kind === 'partial' && wire.status === TAPPAY_REFUND_STATUS.OUT_OF_RANGE_AMOUNT) {
      this.logRefund({
        recTradeId: transactionId,
        outcome: 'rejected',
        wireStatus: wire.status,
        refundId: null,
        bankRefundId,
        bankResultCode: wire.bankResultCode ?? null,
        kind,
        requestedAmount,
      });
      return {
        status: 'rejected',
        wireStatus: TAPPAY_REFUND_STATUS.OUT_OF_RANGE_AMOUNT,
        msg: wire.msg,
        bankResultCode: wire.bankResultCode,
        rawResponse: raw,
      };
    }

    // 其餘非 0 碼(含 kind='full' 的任何非 0 碼 —— 零副作用實證全是 partial 情境、組合未實證)。
    this.logRefund({
      recTradeId: transactionId,
      outcome: 'unknown_wire_status',
      wireStatus: wire.status,
      refundId: wire.refundId ?? null,
      bankRefundId,
      bankResultCode: wire.bankResultCode ?? null,
      kind,
      requestedAmount,
    });
    throw new Error(
      `TapPay refund 未實證回應碼 ${wire.status}(kind ${kind};狀態未知、不得自動重發;rec ${transactionId} / bank_refund ${bankRefundId})`,
    );
  }

  /**
   * Record API 反查(3DS-1a):依交易識別鍵查 TapPay 交易紀錄 → 解析白名單欄回給 3DS-1b。
   *
   * 🔴 **不下裁決**:忠實送查 + 解析 top status / trade_records;judging 成立(paid)= settleCharge(1b)以
   * record_status ∈ {0 AUTH,1 OK} + 識別/金額/幣別閘判定(S1 授權即成立、不再要求 is_captured;is_captured
   * 僅保留解析/audit)。HTTP 非 2xx / 格式異常 → throw(1b 映 pending)。
   * fail-closed:三把識別鍵全空 → 拒(絕不送無 filter 全表查 → 防誤命中他單)。`merchant_id` 每查必帶(限本商戶)。
   */
  async recordQuery(
    query: TapPayRecordQuery,
    options?: TapPayRecordQueryOptions,
  ): Promise<TapPayRecordResult> {
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
      // M-4b E10 A15:可選中止訊號(未給 = undefined = 既有無逾時行為,零行為改動)。
      // 🔴 settleCharge 是唯一刻意不傳 signal 的呼叫端;要逾時的注入呼叫端才傳
      //    (原設想的「第 3 批退款 worker」已被 A7c 拍板取消,機制保留)。中止時 fetch 丟出
      //    signal.reason(可能是 AbortError、TimeoutError 或自訂值),走與「Record 失敗」
      //    同一條 throw 路 → 上游映 pending / record_unreachable(保留、不誤判 failed)。
      //    消費端不得按錯誤 name 分支,理由見 ITapPayAdapter 的 TapPayRecordQueryOptions。
      signal: options?.signal,
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
      // 🔴 M-4b L2:「這個筆數是 TapPay 回的、還是 parser 用 records.length 推的」原樣帶到 use-case;
      //    settleCharge 只在 true 時才允許把零筆判成 record_not_found(= L5 的自動釋鎖依據)。
      numberOfTransactionsReported: wire.numberOfTransactionsReported,
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

  /**
   * 🔴 #16 refund log:只記非 PII 對帳鍵與結果碼;**零 rawResponse、零 msg/bank_result_msg
   * 自由文字、零 partnerKey**。outcome 語意:`attempt_started`=fetch 前(只證「開始送」非「已送達」)/
   * `accepted`=wire status 0(可能緊跟 `accepted_malformed`=欄位不完整、狀態未知)/
   * `deferred`/`rejected`=實證乾淨拒絕 / `unknown_wire_status`=未實證碼、已 throw。
   */
  private logRefund(entry: {
    recTradeId: string;
    outcome:
      | 'attempt_started'
      | 'accepted'
      | 'accepted_malformed'
      | 'deferred'
      | 'rejected'
      | 'unknown_wire_status';
    wireStatus: number | null;
    refundId: string | null;
    bankRefundId: string;
    bankResultCode: string | null;
    kind: 'full' | 'partial';
    requestedAmount: number | null;
  }): void {
    console.info('[TapPayChargeAdapter] refund', entry);
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
