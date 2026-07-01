// lib/payment/composition.ts — 付款 composition root(M-3 ②-②b 建、②-③e 擴;鏡像 lib/auth/composition.ts)
//
// storefront 唯一注入金流 server-only adapter(TapPay charge / PaymentConfirmer / ChargeAttempt 雙軌複合)的
// 「受控單檔」:charge action(②-③e)只 import 本檔三個 factory、不直接碰 @pcm/adapters/server。
// - eslint.config.js L110-126 禁整個 apps/storefront/**/*.{ts,tsx} import @pcm/adapters/server;本檔以
//   inline eslint-disable + 意圖註解開「受控小門」(比 files-override 更可審、code-reviewer 在 import 點即見例外)。
// - 結構守門 = eslint 擋全部 storefront import、只剩本檔顯式 disable;pg 只在 @pcm/adapters/server subpath、
//   不污染 root barrel(@pcm/adapters)的 tree-shaking(lib/products.ts 零 pg)。
//
// 🔴 server-only(本檔 import 'server-only'):TapPayChargeAdapter 持 Partner Key、PaymentConfirmerAdapter 持
//   PAYMENT_CONFIRMER_DB_URL raw DB credential、皆絕不進 client bundle;env 在 factory 內讀(per-request、
//   不 module-top throw)。TapPay/Confirmer 為同步 factory(建構無需 request context);getChargeAttemptStore
//   為 async request-scoped(備軌需 await cookie client、round4 MF1、見該 factory JSDoc)。

import 'server-only';
import type {
  ITapPayAdapter,
  IPaymentConfirmer,
  IChargeAttemptStore,
  IWebhookInbox,
  IPollSettleThrottle,
  ISiblingLookup,
  IReleaseSibling,
  IAlertNotifier,
} from '@pcm/ports';
import {
  settleCharge,
  type SettleChargeDeps,
  type PreflightReleaseSiblingDeps,
  type CheckAnomalyAlertsDeps,
} from '@pcm/use-cases';
// eslint-disable-next-line no-restricted-imports -- 受控例外:composition root 注入金流 server-only adapter;TapPayChargeAdapter 持 Partner Key、PaymentConfirmer/PgChargeAttempt/PgWebhookInbox/PgPollSettleThrottle 持 PAYMENT_CONFIRMER_DB_URL raw DB credential、皆 server-only 不進 client bundle(pg 亦只在 @pcm/adapters/server subpath)
import {
  TapPayChargeAdapter,
  PaymentConfirmerAdapter,
  PgChargeAttemptAdapter,
  SupabaseChargeAttemptFallbackAdapter,
  ChargeAttemptStoreWithFallback,
  PgWebhookInboxAdapter,
  PgPollSettleThrottleAdapter,
  SupabaseSiblingLookupAdapter,
  PgReleaseSiblingAdapter,
  PgAnomalyAlertReaderAdapter,
  LineAlertNotifierAdapter,
  EmailAlertNotifierAdapter,
} from '@pcm/adapters/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

/** 讀必要 env、缺則 throw(fail fast、對齊 lib/auth/line.ts + supabase/server.ts requireEnv 模式)。 */
function requireEnv(name: string): string {
  // eslint-disable-next-line no-restricted-syntax -- 受控例外:本檔 server-only(L15 import 'server-only')、動態 requireEnv 不進 client bundle、無 env inlining 風險(backlog #182 規則 + #179 item 4 requireEnv dedup 追蹤)
  const value = process.env[name];
  if (!value) {
    throw new Error(`缺少必要環境變數:${name}`);
  }
  return value;
}

/** TapPay pay-by-prime endpoint(by TAPPAY_ENV;官方 WebFetch docs.tappaysdk.com 核實)。 */
const PAY_BY_PRIME_URL = {
  sandbox: 'https://sandbox.tappaysdk.com/tpc/payment/pay-by-prime',
  production: 'https://prod.tappaysdk.com/tpc/payment/pay-by-prime',
} as const;

/** TapPay Record API(交易紀錄反查)endpoint(by TAPPAY_ENV;官方 WebFetch docs.tappaysdk.com 核實;3DS-1a)。 */
const RECORD_QUERY_URL = {
  sandbox: 'https://sandbox.tappaysdk.com/tpc/transaction/query',
  production: 'https://prod.tappaysdk.com/tpc/transaction/query',
} as const;

/**
 * 建 ITapPayAdapter(TapPayChargeAdapter + server-only Partner Key)。
 * `TAPPAY_ENV` fail-closed 只接 'sandbox'|'production'(防誤打誤中 prod);Partner Key/Merchant ID server-only。
 */
export function getTapPayAdapter(): ITapPayAdapter {
  const env = requireEnv('TAPPAY_ENV');
  if (env !== 'sandbox' && env !== 'production') {
    throw new Error(`TAPPAY_ENV 須為 'sandbox' 或 'production'(got '${env}')`);
  }
  return new TapPayChargeAdapter({
    partnerKey: requireEnv('TAPPAY_PARTNER_KEY'),
    merchantId: requireEnv('TAPPAY_MERCHANT_ID'),
    payByPrimeUrl: PAY_BY_PRIME_URL[env],
    recordQueryUrl: RECORD_QUERY_URL[env],
  });
}

/**
 * 建 IPaymentConfirmer(PaymentConfirmerAdapter + payment_confirmer 窄權連線)。
 *
 * 🔴 `PAYMENT_CONFIRMER_DB_URL` = Supabase **session pooler**(2026-06-12 實測修正、原「直連 5432」作廢):
 * `postgresql://payment_confirmer.<ref>:<pwd>@aws-1-<region>.pooler.supabase.com:5432/postgres`
 * (直連 host `db.<ref>.supabase.co` 為 IPv6-only、Vercel 連不到;session pooler IPv4 可達、以 payment_confirmer
 * 登入無 SET ROLE 實測 SECDEF 不斷)。🔴 SSL 安全**由 adapter 端硬性把關**(`ssl:{ca,rejectUnauthorized:true,
 * servername:host}`、完整鏈+hostname 驗證)、**與連線字串 sslmode 無關**:adapter 把連線字串解析成離散欄位 +
 * **剝除 sslmode 等 SSL 參數**(buildPgConfig;pg 8.21 連線字串 sslmode 會弱化/關閉 ssl 物件、不可同傳)+ **host
 * 釘死 Supabase pooler DNS 網域**(非 IP/非空、否則 throw)+ **顯式 servername**,adapter 唯一指定 CA 驗證、
 * verify-full 對所有輸入真成立(MITM 縱深)。故連線字串 sslmode 設什麼都不削弱安全(也不必特別設)。
 */
export function getPaymentConfirmer(): IPaymentConfirmer {
  return new PaymentConfirmerAdapter(requireEnv('PAYMENT_CONFIRMER_DB_URL'));
}

/**
 * 建 IChargeAttemptStore(charge 簿記/防雙扣鎖、複合雙軌;M-3 ②-③e、plan v6 §6)。
 *
 * 🔴 **async request-scoped(codex 關卡1 round4 MF1)**:備軌(SupabaseChargeAttemptFallbackAdapter、
 * PostgREST 第二 transport)需**使用者 cookie JWT** 的 authenticated client(fallback RPC 內
 * auth.uid() 歸屬驗)— 模組級/同步建構拿不到 → 備軌 auth.uid()=null 永敗 = 靜默退化單軌。
 * 故本 factory async、charge action 於登入 gate 後 await;主軌(PgChargeAttemptAdapter)同
 * payment_confirmer 鑰匙(Q1=A、零新 env)、連線縱深同 getPaymentConfirmer(buildPgConfig)。
 */
export async function getChargeAttemptStore(): Promise<IChargeAttemptStore> {
  const supabase = await createServerSupabaseClient();
  return new ChargeAttemptStoreWithFallback(
    new PgChargeAttemptAdapter(requireEnv('PAYMENT_CONFIRMER_DB_URL')),
    new SupabaseChargeAttemptFallbackAdapter(supabase),
  );
}

/**
 * 建 SettleChargeDeps(M-3 3DS-1b 對帳脊椎;三路 route〔3DS-2/3〕+ sweeper cron〔3DS-4〕注入 settleCharge)。
 *
 * 🔴 **sync cookieless(缺陷B)**:settleCharge 在 webhook/sweeper **無 cookie/JWT** → 不可走會 `await cookies()`
 * 的 `getChargeAttemptStore()`(cron throw)。故 `attempts` = **主軌-only** `PgChargeAttemptAdapter`(payment_confirmer
 * 窄權直連、buildPgConfig CA 縱深、無 cookie 依賴)、**不**經 `ChargeAttemptStoreWithFallback`(備軌需 user JWT);
 * 對帳讀失敗 → settleCharge 回 pending、sweeper 重來。markCharged 主軌刻意不用 fallbackToken(settleCharge 傳 '' 佔位)。
 * `confirmer` 同鑰(confirm + 0c record_pending_invoice);`tappay` recordQuery 反查。
 */
export function getSettleChargeDeps(): SettleChargeDeps {
  return {
    tappay: getTapPayAdapter(),
    attempts: new PgChargeAttemptAdapter(requireEnv('PAYMENT_CONFIRMER_DB_URL')),
    confirmer: getPaymentConfirmer(),
  };
}

/**
 * 建 ISiblingLookup(M-3 3DS 乙路 R2b/R3;立即重刷 preflight own-only 反查兄弟單)。
 *
 * 🔴 **async request-scoped + authenticated own-only**(鏡像 getChargeAttemptStore 備軌紀律):
 * SupabaseSiblingLookupAdapter 呼 `find_active_sibling_own`、RPC 內 `auth.uid()` 歸屬反查同會員兄弟單 →
 * 需**使用者 cookie JWT** 的 authenticated client(模組級/同步建構拿不到 → own-only 永遠查不到自己)。
 * 故本 factory async、charge action 於登入 gate 後 await。active 分支不含 rec/bank(資料最小化、§4 R1a2)。
 */
export async function getSiblingLookup(): Promise<ISiblingLookup> {
  const supabase = await createServerSupabaseClient();
  return new SupabaseSiblingLookupAdapter(supabase);
}

/**
 * 建 IReleaseSibling(M-3 3DS 乙路 R2b/R3;立即重刷 release CAS)。
 *
 * 🔴 同 getPaymentConfirmer 的 payment_confirmer 窄權鑰(`PAYMENT_CONFIRMER_DB_URL`、零新密鑰)+ buildPgConfig
 * 連線縱深;server-only(pg 不進 client bundle)。呼 §4 R1a3 `mark_charge_attempt_released_for_user` 四閘 CAS。
 */
export function getReleaseSibling(): IReleaseSibling {
  return new PgReleaseSiblingAdapter(requireEnv('PAYMENT_CONFIRMER_DB_URL'));
}

/**
 * 建 PreflightReleaseSiblingDeps(M-3 3DS 乙路 R3;chargePaymentAction 於 placeOrder「前」呼 preflightReleaseSibling)。
 *
 * 🔴 `settle` = **注入函式**(非直接 import settleCharge):包 settleCharge〔getSettleChargeDeps 窄權主軌、cookieless〕,
 * 解耦 preflight 與 settleCharge 的 tappay/attempts/confirmer deps(use-case 設計的注入點、§2.3 狀態機可單元測)。
 * siblingLookup = authenticated own-only(await、需 user JWT);releaseSibling = server-only payment_confirmer。
 */
export async function getPreflightReleaseSiblingDeps(): Promise<PreflightReleaseSiblingDeps> {
  return {
    siblingLookup: await getSiblingLookup(),
    releaseSibling: getReleaseSibling(),
    settle: (input) => settleCharge(getSettleChargeDeps(), input),
  };
}

/**
 * 建 IWebhookInbox(M-3 3DS-2a;②-⑥ webhook route〔3DS-2b〕durable 落 inbox 去重)。
 *
 * 🔴 同 getPaymentConfirmer / getSettleChargeDeps 的 payment_confirmer 窄權鑰(`PAYMENT_CONFIRMER_DB_URL`、
 * 零新密鑰)+ buildPgConfig 連線縱深;cookieless(webhook 無 cookie/JWT)。呼 3DS-0a record_webhook_event RPC。
 */
export function getWebhookInbox(): IWebhookInbox {
  return new PgWebhookInboxAdapter(requireEnv('PAYMENT_CONFIRMER_DB_URL'));
}

/**
 * 建 IChargeAttemptStore reader(M-3 3DS-2b;webhook 存在性閘 DB-only、解耦 TapPay env;codex 關卡2 consider)。
 *
 * 🔴 只建主軌 `PgChargeAttemptAdapter`(payment_confirmer 同鑰、**零 TapPay env**)→ webhook route 在 durable
 * insert「前」的本機 active attempt 存在性閘 + durable 捕獲不依賴 TapPay 設定;TapPay env 漂移時 webhook 仍能
 * durable 落 inbox(快路徑 settleCharge 在 route `after()` 內才建 full `getSettleChargeDeps`、降級不影響捕獲)。
 * cookieless(webhook 無 cookie/JWT;對帳讀失敗 → 上層 503/sweeper 重來)。
 */
export function getChargeAttemptReader(): IChargeAttemptStore {
  return new PgChargeAttemptAdapter(requireEnv('PAYMENT_CONFIRMER_DB_URL'));
}

/**
 * 建 IPollSettleThrottle(M-3 3DS-S2b;輪詢端點 payment-status route 主動 settleCharge 前的 per-order Record 限流)。
 *
 * 🔴 同 getSettleChargeDeps / getWebhookInbox 的 payment_confirmer 窄權鑰(`PAYMENT_CONFIRMER_DB_URL`、零新密鑰)
 * + buildPgConfig 連線縱深;cookieless(輪詢端點 own-only 歸屬閘已用 user cookie 讀 orders、throttle 走窄權主軌)。
 * 呼 3DS-S2b `claim_order_poll_settle` RPC(原子 throttle、閘對齊 4a-2 claim:unpaid + 非 manual + ceiling)。
 * lazy(對齊既有 factory;N2 sweeper 不變式 — factory 必 lazy、env 在呼叫時才讀)。
 */
export function getPollSettleThrottle(): IPollSettleThrottle {
  return new PgPollSettleThrottleAdapter(requireEnv('PAYMENT_CONFIRMER_DB_URL'));
}

/**
 * 建 CheckAnomalyAlertsDeps(M-3 #250 雙扣 anomaly 主動告警 cron 的 reader + 推播管道)。
 *
 * 🔴 lazy(對齊既有 factory + N2 sweeper 不變式 — env 在呼叫時才讀、零 module-top、零連線建立;cron route 的
 * ANOMALY_ALERT_ENABLED disabled 路徑「零 DB env 依賴」仰賴此:gate 在建 deps 前 return,不觸發本 factory)。
 *
 * - reader = PgAnomalyAlertReaderAdapter(payment_confirmer 窄權鑰 `PAYMENT_CONFIRMER_DB_URL`、零新密鑰;
 *   呼 SECDEF 聚合 RPC 受控窗讀零 PII 計數)。
 * - notifiers = 依「主密鑰存在性」逐管道組(Q1=A+C LINE+Email;primary 密鑰在 → requireEnv 其餘部件、
 *   **部分設定 = fail-fast throw** 防漏設);🔴 enabled 但零管道 → throw(沉默告警 = 最糟、fail-closed)。
 */
export function getAnomalyAlertDeps(): CheckAnomalyAlertsDeps {
  const reader = new PgAnomalyAlertReaderAdapter(requireEnv('PAYMENT_CONFIRMER_DB_URL'));
  const notifiers: IAlertNotifier[] = [];

  // LINE(Q1=A):primary = LINE_CHANNEL_ACCESS_TOKEN;存在即視為「要 LINE」→ requireEnv 對象 id(漏設 fail-fast)。
  if (process.env.LINE_CHANNEL_ACCESS_TOKEN) {
    notifiers.push(
      new LineAlertNotifierAdapter({
        accessToken: requireEnv('LINE_CHANNEL_ACCESS_TOKEN'),
        to: requireEnv('LINE_ALERT_TO'),
      }),
    );
  }

  // Email(Q1=C):primary = RESEND_API_KEY;存在即視為「要 Email」→ requireEnv 寄件/收件(漏設 fail-fast)。
  if (process.env.RESEND_API_KEY) {
    notifiers.push(
      new EmailAlertNotifierAdapter({
        apiKey: requireEnv('RESEND_API_KEY'),
        from: requireEnv('ALERT_EMAIL_FROM'),
        to: requireEnv('ALERT_EMAIL_TO'),
      }),
    );
  }

  if (notifiers.length === 0) {
    // enabled 但一個管道都沒設 = 誤設(告警永遠送不出去)→ fail-closed(route 503、可見),不靜默。
    throw new Error('ANOMALY_ALERT_ENABLED=true 但未設定任何告警管道(LINE/Email)');
  }

  return { reader, notifiers };
}
