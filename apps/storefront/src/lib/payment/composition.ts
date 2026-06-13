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
import type { ITapPayAdapter, IPaymentConfirmer, IChargeAttemptStore } from '@pcm/ports';
// eslint-disable-next-line no-restricted-imports -- 受控例外:composition root 注入金流 server-only adapter;TapPayChargeAdapter 持 Partner Key、PaymentConfirmer/PgChargeAttempt 持 PAYMENT_CONFIRMER_DB_URL raw DB credential、皆 server-only 不進 client bundle(pg 亦只在 @pcm/adapters/server subpath)
import {
  TapPayChargeAdapter,
  PaymentConfirmerAdapter,
  PgChargeAttemptAdapter,
  SupabaseChargeAttemptFallbackAdapter,
  ChargeAttemptStoreWithFallback,
} from '@pcm/adapters/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

/** 讀必要 env、缺則 throw(fail fast、對齊 lib/auth/line.ts + supabase/server.ts requireEnv 模式)。 */
function requireEnv(name: string): string {
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
