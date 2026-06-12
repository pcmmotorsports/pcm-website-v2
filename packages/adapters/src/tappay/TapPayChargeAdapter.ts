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
  TapPayRefundPayload,
  TapPayRefundResult,
} from '@pcm/domain';
import { toMoneyAmount } from '@pcm/domain';
import { parseTapPayResponse } from './wire';

/**
 * TapPayChargeConfig:adapter 連線設定(env 由 composition root 讀、DI 注入、可測)。
 * `payByPrimeUrl` 由 env 決定 sandbox vs prod(adapter 不寫死 endpoint)。
 */
export type TapPayChargeConfig = {
  partnerKey: string;
  merchantId: string;
  payByPrimeUrl: string;
};

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

  async refund(_payload: TapPayRefundPayload): Promise<TapPayRefundResult> {
    // Phase 1 不接退款(refund 留 Phase 2、kickoff §7);interface 要求方法存在 → 誠實 throw、不假裝實作。
    throw new Error('TapPay refund 未實作(Phase 2)');
  }

  /** 🔴 #16:只記非 PII(orderId/status/recTradeId);cardholder + rawResponse 絕不入 log。 */
  private logOutcome(orderId: OrderId, status: ChargeStatus, recTradeId: string | undefined): void {
    console.info('[TapPayChargeAdapter] charge', {
      orderId,
      status,
      recTradeId: recTradeId ?? null,
    });
  }
}
